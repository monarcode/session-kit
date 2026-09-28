import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "@monarcode/tanstack-auth";
import { connectAuth, safeReturnTo } from "@monarcode/tanstack-auth/react";
import { createAuthFetch } from "@monarcode/tanstack-auth/http";
import { z } from "zod";

// Ported from the v3 reference suite. Exercise the package's emitted public API.
const userSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: z.enum(["admin", "member"]).default("member"),
});
const user = { id: "alice", email: "alice@example.com", role: "member" };
let cookies, values, blockedCookies, blockedStorage, cleanups;
let originalGlobals;
const browserGlobals = [
	"location", "document", "localStorage", "fetch", "self", "scrollTo", "window",
];
const setGlobal = (name, value) => Object.defineProperty(globalThis, name, {
	configurable: true,
	writable: true,
	value,
});
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
};
const flush = async () => {
	for (let i = 0; i < 40; i++) await Promise.resolve();
};
const input = (overrides = {}) => ({
	accessToken: "access-1",
	refreshToken: "refresh-1",
	user,
	...overrides,
});
const client = (options = {}) =>
	createAuth({ name: "test", userSchema, ...options });
const code = (expected) => (error) => error.code === expected;

beforeEach(() => {
	cookies = new Map();
	values = new Map();
	blockedCookies = false;
	blockedStorage = false;
	cleanups = [];
	originalGlobals = new Map(browserGlobals.map((name) => [
		name, Object.getOwnPropertyDescriptor(globalThis, name),
	]));
	setGlobal("location", { protocol: "https:" });
	setGlobal("document", {
		get cookie() {
			return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
		},
		set cookie(text) {
			if (blockedCookies) return;
			const pair = text.split(";")[0];
			const index = pair.indexOf("=");
			const key = pair.slice(0, index),
				value = pair.slice(index + 1);
			if (text.includes("Max-Age=0")) cookies.delete(key);
			else cookies.set(key, value);
		},
	});
	setGlobal("localStorage", {
		getItem(key) {
			if (blockedStorage) throw new Error("Blocked");
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			if (blockedStorage) throw new Error("Quota");
			values.set(key, value);
		},
		removeItem(key) {
			if (blockedStorage) throw new Error("Blocked");
			values.delete(key);
		},
	});
});
afterEach(() => {
	try {
		// Disconnect clients before restoring the browser environment.
		for (const cleanup of cleanups.toReversed()) cleanup();
	} finally {
		for (const [name, descriptor] of originalGlobals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	}
});

test("schema defaults and custom fields survive restoration; tokens stay out of localStorage/state", async () => {
	const auth = client();
	await auth.signIn(input({ user: { id: "alice", email: user.email } }));
	assert.equal(auth.state.get().user.role, "member");
	assert.equal(JSON.stringify([...values]).includes("access-1"), false);
	assert.equal(JSON.stringify(auth.state.get()).includes("refresh-1"), false);
	const restored = await client().getSession();
	assert.equal(restored.user.email, user.email);
	assert.equal(restored.accessToken, "access-1");
});

test("user output is frozen without freezing caller input", async () => {
	const auth = client();
	const data = { ...user };
	await auth.signIn(input({ user: data }));
	assert.equal(Object.isFrozen(auth.state.get().user), true);
	assert.equal(Object.isFrozen(data), false);
});

test("invalid sign-in leaves the current session usable", async () => {
	const auth = client();
	await auth.signIn(input());
	const before = await auth.getSession();
	await assert.rejects(
		auth.signIn(input({ user: { id: 4 } })),
		code("USER_VALIDATION_FAILED"),
	);
	assert.equal((await auth.getSession()).id, before.id);
});

test("cookie/profile mismatch fails closed and removes saved data", async () => {
	await client().signIn(input());
	const saved = JSON.parse(values.get("test:auth:user"));
	values.set(
		"test:auth:user",
		JSON.stringify({ ...saved, writeId: "wrong" }),
	);
	assert.equal(await client().getSession(), null);
	assert.equal(cookies.size, 0);
	assert.equal(values.size, 0);
});

test("malformed stored user fails schema validation", async () => {
	await client().signIn(input());
	const saved = JSON.parse(values.get("test:auth:user"));
	values.set("test:auth:user", JSON.stringify({ ...saved, user: { id: 5 } }));
	assert.equal(await client().getSession(), null);
});

test("storage read failure is operational and can be retried", async () => {
	await client().signIn(input());
	const auth = client();
	blockedStorage = true;
	await assert.rejects(auth.getSession(), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unavailable");
	blockedStorage = false;
	assert.equal((await auth.getSession()).user.id, "alice");
});

test("cookie write failure clears runtime state and fails visibly", async () => {
	const auth = client();
	blockedCookies = true;
	await assert.rejects(auth.signIn(input()), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});

test("signout stays signed out when cookie deletion fails", async () => {
	const auth = client();
	await auth.signIn(input());
	blockedCookies = true;
	await assert.rejects(auth.signOut(), code("PERSISTENCE_FAILED"));
	assert.equal(await auth.getSession(), null);
	assert.equal(auth.state.get().user, null);
});

test("concurrent refresh requests share one backend operation", async () => {
	const gate = deferred();
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return gate.promise;
		},
	});
	await auth.signIn(input());
	const session = await auth.getSession();
	const a = auth.refresh(session),
		b = auth.refresh(session);
	await flush();
	assert.equal(calls, 1);
	gate.resolve({ accessToken: "access-2" });
	assert.equal((await a).accessToken, "access-2");
	assert.equal((await b).accessToken, "access-2");
	assert.equal(
		JSON.parse(decodeURIComponent(cookies.get("test_auth"))).refreshToken,
		"refresh-1",
	);
});

test("late refresh success cannot restore a signed-out session", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input());
	const pending = auth.refresh(await auth.getSession());
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signOut();
	gate.resolve({ accessToken: "late" });
	await checked;
	await flush();
	assert.equal(await auth.getSession(), null);
	assert.equal(cookies.size, 0);
});

test("late refresh failure cannot clear a new account", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input());
	const pending = auth.refresh(await auth.getSession());
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	gate.reject(new Error("old failure"));
	await checked;
	assert.equal((await auth.getSession()).user.id, "bob");
});

test("async validation cannot commit after logout", async () => {
	const gate = deferred();
	const schema = z
		.object({ id: z.string() })
		.refine(async () => gate.promise);
	const auth = client({ userSchema: schema });
	const pending = auth.signIn(input({ user: { id: "a" } }));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signOut();
	gate.resolve(true);
	await checked;
	assert.equal(await auth.getSession(), null);
});

test("a refresh begun while sign-in validates cannot overwrite the new account", async () => {
	const validation = deferred(),
		refresh = deferred();
	const schema = userSchema.refine(async (u) =>
		u.id === "bob" ? validation.promise : true,
	);
	const auth = client({
		userSchema: schema,
		refresh: async () => refresh.promise,
	});
	await auth.signIn(input());
	const old = await auth.getSession();
	const login = auth.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	const pending = auth.refresh(old);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	validation.resolve(true);
	await login;
	refresh.resolve({ accessToken: "old-rotated" });
	await checked;
	assert.equal((await auth.getSession()).accessToken, "bob-token");
});

test("refresh null ends the session; thrown network errors retain credentials", async () => {
	const auth = client({ refresh: async () => null });
	await auth.signIn(input());
	assert.equal(await auth.refresh(await auth.getSession()), null);
	const retry = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await retry.signIn(input());
	await assert.rejects(
		retry.refresh(await retry.getSession()),
		code("REFRESH_FAILED"),
	);
	assert.equal(retry.state.get().status, "unavailable");
	assert.equal(cookies.size, 1);
});

test("a rejected access token cannot be returned as fresh", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-1" }) });
	await auth.signIn(input());
	await assert.rejects(
		auth.refresh(await auth.getSession()),
		code("INVALID_SESSION"),
	);
	assert.equal(auth.state.get().user, null);
});

test("late 401 for a rotated token reuses the newer token", async () => {
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return { accessToken: "access-2" };
		},
	});
	await auth.signIn(input());
	const old = await auth.getSession();
	await auth.refresh(old);
	assert.equal((await auth.refresh(old)).accessToken, "access-2");
	assert.equal(calls, 1);
});

test("an old account rejection cannot sign out the new account", async () => {
	const auth = client();
	await auth.signIn(input());
	const old = await auth.getSession();
	await auth.signIn(input({ user: { ...user, id: "bob" } }));
	await assert.rejects(auth.refresh(old), code("SESSION_CHANGED"));
	await auth.rejectSession(old);
	assert.equal((await auth.getSession()).user.id, "bob");
});

test("explicit profile updates win over a profile returned by in-flight proactive refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	await auth.updateUser({ ...user, email: "new@example.com" });
	gate.resolve({ accessToken: "access-2", expiresAt: 1_040_000, user });
	await flush();
	assert.equal(auth.state.get().user.email, "new@example.com");
	cleanups.pop()();
	t.mock.timers.reset();
});

test("async updateUser captures the session before running the callback", async () => {
	const gate = deferred();
	const auth = client();
	await auth.signIn(input());
	const pending = auth.updateUser(() => gate.promise);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(input({ user: { ...user, id: "bob" } }));
	gate.resolve({ ...user, email: "old" });
	await checked;
	assert.equal(auth.state.get().user.id, "bob");
});

test("proactive failure keeps unexpired access but expiry hides the user", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(auth.state.get().status, "unavailable");
	cleanups.pop()();
	t.mock.timers.reset();
});

test("a handler that ignores abort still times out", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({ refresh: async () => new Promise(() => {}) });
	await auth.signIn(input());
	const pending = auth.refresh(await auth.getSession());
	const checked = assert.rejects(pending, code("REFRESH_FAILED"));
	await flush();
	t.mock.timers.tick(15_000);
	await checked;
	t.mock.timers.reset();
});

test("expiry without a refresh handler signs out", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client();
	await auth.signIn(input({ expiresAt: 1_010_000 }));
	t.mock.timers.tick(10_001);
	assert.equal(await auth.getSession(), null);
	t.mock.timers.reset();
});

test("opaque tokens work and explicit expiry wins over JWT exp", async () => {
	const auth = client();
	await auth.signIn(input());
	assert.equal((await auth.getSession()).expiresAt, undefined);
	const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.x`;
	await auth.signIn(
		input({ accessToken: jwt, expiresAt: Date.now() + 60_000 }),
	);
	assert.ok((await auth.getSession()).expiresAt > Date.now());
});

test("Router connection is idempotent and token-only proactive refresh does not invalidate", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => ({
			accessToken: "access-2",
			expiresAt: 1_050_000,
		}),
	});
	let invalidations = 0;
	const router = {
		options: { context: { auth } },
		clearCache() {},
		async invalidate() {
			invalidations++;
		},
	};
	const off = connectAuth(router);
	cleanups.push(off);
	assert.equal(connectAuth(router), off);
	await flush();
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	await flush();
	const before = invalidations;
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(invalidations, before);
	await auth.updateUser({ ...user, email: "updated" });
	await flush();
	assert.equal(invalidations, before + 1);
	off();
	cleanups.pop();
	t.mock.timers.reset();
});

test("GET retries once; bearer tokens stay on the configured origin", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	const headers = [];
	global.fetch = async (request) => {
		headers.push(request.headers.get("Authorization"));
		return new Response(null, { status: headers.length === 1 ? 401 : 200 });
	};
	const request = createAuthFetch(auth, "https://api.example.com/");
	assert.equal((await request("/me")).status, 200);
	assert.deepEqual(headers, ["Bearer access-1", "Bearer access-2"]);
	await assert.rejects(request("https://evil.example/me"));
	assert.equal(headers.length, 2);
});

test("mutations are not replayed automatically", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	let calls = 0;
	global.fetch = async () => {
		calls++;
		return new Response(null, { status: 401 });
	};
	const request = createAuthFetch(auth, "https://api.example.com/");
	assert.equal(
		(await request("/change", { method: "POST", body: "data" })).status,
		401,
	);
	assert.equal(calls, 1);
});

test("second 401 ends only the matching session", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	global.fetch = async () => new Response(null, { status: 401 });
	const request = createAuthFetch(auth, "https://api.example.com/");
	assert.equal((await request("/me")).status, 401);
	assert.equal(await auth.getSession(), null);
});

test("return URL rejects external origins, backslashes, controls, and login loops", () => {
	for (const value of [
		"//evil.com",
		"/\\evil.com",
		"/\nevil.com",
		"https://evil.com",
		"/login",
		null,
	])
		assert.equal(safeReturnTo(value), "/");
	assert.equal(
		safeReturnTo("/dashboard?tab=one#title"),
		"/dashboard?tab=one#title",
	);
});

test("schemas that return non-JSON output are rejected", async () => {
	const schema = z.object({ created: z.date() });
	const auth = client({ userSchema: schema });
	await assert.rejects(
		auth.signIn(input({ user: { created: new Date() } })),
		code("USER_VALIDATION_FAILED"),
	);
});

test("invalid optional refresh user cannot partially replace tokens", async () => {
	const auth = client({
		refresh: async () => ({ accessToken: "access-2", user: { id: 3 } }),
	});
	await auth.signIn(input());
	await assert.rejects(
		auth.refresh(await auth.getSession()),
		code("USER_VALIDATION_FAILED"),
	);
	const saved = JSON.parse(decodeURIComponent(cookies.get("test_auth")));
	assert.equal(saved.accessToken, "access-1");
});

test("overlapping profile updates commit only the most recent request", async () => {
	const auth = client();
	await auth.signIn(input());
	const gate = deferred();
	const pending = auth.updateUser(() => gate.promise);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.updateUser({ ...user, email: "newest" });
	gate.resolve({ ...user, email: "older" });
	await checked;
	assert.equal(auth.state.get().user.email, "newest");
});

test("remount while initial validation is pending starts a fresh restoration", async () => {
	await client().signIn(input());
	const gate = deferred();
	let calls = 0;
	const schema = userSchema.refine(async () => {
		calls++;
		return gate.promise;
	});
	const auth = client({ userSchema: schema });
	const off = auth.mount();
	await flush();
	off();
	cleanups.push(auth.mount());
	await flush();
	gate.resolve(true);
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.ok(calls >= 2);
});

test("real Router guards rerun after logout and produce a login redirect", async () => {
	global.self = global;
	global.scrollTo = () => {};
	global.window = {
		location: new URL("https://example.com/private"),
		addEventListener() {},
		removeEventListener() {},
	};
	const {
		createRouter,
		createRootRouteWithContext,
		createRoute,
		createMemoryHistory,
		redirect,
	} = await import("@tanstack/react-router");
	const auth = client();
	await auth.signIn(input());
	const root = createRootRouteWithContext()({});
	const login = createRoute({ getParentRoute: () => root, path: "/login" });
	let guardCalls = 0;
	const privateRoute = createRoute({
		getParentRoute: () => root,
		path: "/private",
		beforeLoad: async ({ context }) => {
			guardCalls++;
			if (!(await context.auth.getSession()))
				throw redirect({ to: "/login" });
		},
	});
	const router = createRouter({
		routeTree: root.addChildren([login, privateRoute]),
		context: { auth },
		history: createMemoryHistory({ initialEntries: ["/private"] }),
		isServer: false,
	});
	// Simulate React acknowledging the committed transition.
	router.startTransition = async (fn) => {
		fn();
		return true;
	};
	const off = connectAuth(router);
	cleanups.push(off);
	await router.load();
	assert.equal(router.state.location.pathname, "/private");
	await auth.signOut();
	await new Promise(setImmediate);
	assert.ok(guardCalls >= 2);
	assert.equal(router.state.location.pathname, "/login");
});
