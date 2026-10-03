import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";

import { createAuth } from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { connectAuth, safeReturnTo } from "@monarcode/session-kit/react";
import { z } from "zod";

const userSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: z.enum(["admin", "member"]).default("member"),
});
const user = { id: "alice", email: "alice@example.com", role: "member" };
let cookies, values, blockedStorage, blockedWrites, blockedDeletes, cleanups;
const SESSION = "test:auth:session";
let originalGlobals;
const browserGlobals = [
	"location",
	"document",
	"localStorage",
	"fetch",
	"self",
	"scrollTo",
	"window",
	"navigator",
	"addEventListener",
	"removeEventListener",
];
const setGlobal = (name, value) =>
	Object.defineProperty(globalThis, name, {
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
const createLocks = () => {
	const queues = new Map();
	const aborted = (signal) =>
		new Promise((_, reject) => {
			if (signal?.aborted) reject(signal.reason);
			signal?.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});
	return {
		request(name, { signal } = {}, callback) {
			const previous = queues.get(name) ?? Promise.resolve();
			const run = (async () => {
				await Promise.race([previous, aborted(signal)]);
				return callback({ name });
			})();
			queues.set(name, Promise.allSettled([previous, run]));
			return run;
		},
	};
};
let locks, storageEvents;

beforeEach(() => {
	cookies = new Map();
	values = new Map();
	blockedStorage = false;
	blockedWrites = new Set();
	blockedDeletes = new Set();
	cleanups = [];
	locks = createLocks();
	storageEvents = new EventTarget();
	originalGlobals = new Map(
		browserGlobals.map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	setGlobal("location", { protocol: "https:" });
	setGlobal("navigator", { locks });
	setGlobal("addEventListener", (...args) =>
		storageEvents.addEventListener(...args),
	);
	setGlobal("removeEventListener", (...args) =>
		storageEvents.removeEventListener(...args),
	);
	setGlobal("document", {
		get cookie() {
			return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
		},
		set cookie(text) {
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
			if (blockedStorage || blockedWrites.has(key)) throw new Error("Quota");
			values.set(key, value);
		},
		removeItem(key) {
			if (blockedStorage || blockedDeletes.has(key))
				throw new Error("Blocked");
			values.delete(key);
		},
	});
});
afterEach(() => {
	try {
		for (const cleanup of cleanups.toReversed()) cleanup();
	} finally {
		for (const [name, descriptor] of originalGlobals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	}
});

test("schema defaults and custom fields survive restoration; tokens stay out of the profile/state", async () => {
	const auth = client();
	await auth.signIn(input({ user: { id: "alice", email: user.email } }));
	assert.equal(auth.state.get().user.role, "member");
	assert.equal(JSON.parse(values.get(SESSION)).refreshToken, "refresh-1");
	assert.equal(cookies.size, 0);
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

for (const timeout of [false, true]) {
	for (const canRefresh of [false, true]) {
		test(`expiry during ${timeout ? "timed-out" : "failed"} sign-in ${canRefresh ? "refreshes" : "clears"} the previous session`, async (t) => {
			t.mock.timers.enable({
				apis: ["Date", "setTimeout"],
				now: 1_000_000,
			});
			const validation = deferred();
			const refresh = deferred();
			let refreshCalls = 0;
			const auth = client({
				userSchema: userSchema.refine(async (value) =>
					value.id === "bob" ? validation.promise : true,
				),
				refresh: canRefresh
					? async () => {
							refreshCalls++;
							return refresh.promise;
						}
					: undefined,
			});
			await auth.signIn(input({ expiresAt: 1_001_000 }));
			const previousId = auth.state.get().sessionId;
			cleanups.push(auth.mount());
			await flush();
			const pending = auth.signIn(
				input({
					accessToken: "bob-token",
					user: { ...user, id: "bob" },
				}),
			);
			const checked = assert.rejects(
				pending,
				code("USER_VALIDATION_FAILED"),
			);
			await flush();
			t.mock.timers.tick(1_000);
			if (timeout) t.mock.timers.tick(14_000);
			else validation.resolve(false);
			await checked;
			await flush();
			if (canRefresh) {
				assert.equal(refreshCalls, 1);
				assert.equal(auth.state.get().status, "refreshing");
				assert.equal(auth.state.get().user.id, "alice");
				refresh.resolve({
					accessToken: "access-2",
					expiresAt: Date.now() + 60_000,
				});
				await flush();
				assert.equal(auth.state.get().status, "authenticated");
				assert.equal(auth.state.get().sessionId, previousId);
				assert.equal(auth.state.get().user.id, "alice");
			} else {
				assert.equal(auth.state.get().status, "unauthenticated");
				assert.equal(auth.state.get().user, null);
				assert.equal(auth.state.get().sessionId, null);
				assert.equal(values.size, 0);
			}
			if (timeout) {
				validation.resolve(true);
				await flush();
				assert.notEqual(auth.state.get().user?.id, "bob");
			}
		});
	}
}

test("expiry during validation does not cancel a successful new sign-in", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	const auth = client({
		userSchema: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	const previousId = auth.state.get().sessionId;
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(
		input({
			accessToken: "bob-token",
			user: { ...user, id: "bob" },
		}),
	);
	await flush();
	t.mock.timers.tick(1_000);
	await flush();
	validation.resolve(true);
	await pending;
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().user.id, "bob");
	assert.notEqual(auth.state.get().sessionId, previousId);
});

test("failed sign-in recovery retains expired credentials without a refresh retry loop", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	let refreshCalls = 0;
	const auth = client({
		userSchema: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
		refresh: async () => {
			refreshCalls++;
			throw new Error("offline");
		},
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("USER_VALIDATION_FAILED"));
	await flush();
	t.mock.timers.tick(1_000);
	validation.resolve(false);
	await checked;
	await flush();
	assert.equal(refreshCalls, 1);
	assert.equal(auth.state.get().status, "unavailable");
	assert.equal(auth.state.get().error.code, "REFRESH_FAILED");
	assert.ok(values.has(SESSION));
	t.mock.timers.tick(60_000);
	await flush();
	assert.equal(refreshCalls, 1);
});

test("failed sign-in hides an expired unmounted session until demand retries refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	let refreshCalls = 0;
	const auth = client({
		userSchema: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
		refresh: async () => {
			refreshCalls++;
			return { accessToken: "access-2", expiresAt: Date.now() + 60_000 };
		},
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("USER_VALIDATION_FAILED"));
	await flush();
	t.mock.timers.tick(1_000);
	validation.resolve(false);
	await checked;
	await flush();
	assert.equal(auth.state.get().status, "unavailable");
	assert.equal(auth.state.get().user, null);
	assert.equal(refreshCalls, 0);
	assert.ok(values.has(SESSION));
	assert.equal((await auth.getSession()).accessToken, "access-2");
	assert.equal(refreshCalls, 1);
});

test("a superseded sign-in cannot recover or clear the newer account", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	const auth = client({
		userSchema: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(
		input({ accessToken: "carol-token", user: { ...user, id: "carol" } }),
	);
	t.mock.timers.tick(2_000);
	validation.resolve(false);
	await checked;
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().user.id, "carol");
	assert.equal((await auth.getSession()).accessToken, "carol-token");
});

test("malformed saved session fails closed and removes saved data", async () => {
	await client().signIn(input());
	const saved = JSON.parse(values.get(SESSION));
	values.set(SESSION, JSON.stringify({ ...saved, id: "" }));
	assert.equal(await client().getSession(), null);
	assert.equal(values.size, 0);
});

test("entries from the two-key format are removed, not restored", async () => {
	values.set("test:auth:tokens", JSON.stringify({ v: 2, accessToken: "old" }));
	values.set("test:auth:user", JSON.stringify({ v: 2, user }));
	assert.equal(await client().getSession(), null);
	assert.equal(values.size, 0);
});

test("malformed stored user fails schema validation", async () => {
	await client().signIn(input());
	const saved = JSON.parse(values.get(SESSION));
	values.set(SESSION, JSON.stringify({ ...saved, user: { id: 5 } }));
	assert.equal(await client().getSession(), null);
});

for (const invalidUser of [false, true]) {
	test(`restoring ${invalidUser ? "an invalid user" : "a malformed session"} exposes blocked cleanup and permits retry`, async () => {
		await client().signIn(input());
		if (invalidUser) {
			const saved = JSON.parse(values.get(SESSION));
			values.set(SESSION, JSON.stringify({ ...saved, user: { id: 5 } }));
		} else {
			values.set(SESSION, "invalid-json");
		}
		blockedDeletes.add(SESSION);
		const auth = client();
		let failure;
		await assert.rejects(auth.getSession(), (error) => {
			failure = error;
			return error.code === "PERSISTENCE_FAILED";
		});
		assert.equal(auth.state.get().error, failure);
		assert.equal(auth.state.get().status, "unauthenticated");
		assert.equal(auth.state.get().user, null);
		assert.equal(auth.state.get().sessionId, null);
		assert.ok(failure.cause instanceof AggregateError);
		const [restoration, cleanup] = failure.cause.errors;
		assert.equal(
			restoration.code,
			invalidUser ? "USER_VALIDATION_FAILED" : "INVALID_SESSION",
		);
		if (invalidUser) assert.ok(restoration.issues.length > 0);
		else assert.ok(restoration.cause instanceof Error);
		assert.equal(cleanup.code, "PERSISTENCE_FAILED");
		assert.ok(cleanup.cause instanceof AggregateError);
		assert.ok(values.has(SESSION));
		assert.equal(await auth.getSession(), null);
		assert.equal(auth.state.get().error, failure);
		blockedDeletes.clear();
		await auth.signOut();
		assert.equal(auth.state.get().error, null);
		assert.equal(values.size, 0);
	});
}

test("storage read failure is operational and can be retried", async () => {
	await client().signIn(input());
	const auth = client();
	blockedStorage = true;
	await assert.rejects(auth.getSession(), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unavailable");
	blockedStorage = false;
	assert.equal((await auth.getSession()).user.id, "alice");
});

test("token write failure clears runtime state and fails visibly", async () => {
	const auth = client();
	blockedWrites.add(SESSION);
	await assert.rejects(auth.signIn(input()), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});

test("signout stays signed out when token deletion fails", async () => {
	const auth = client();
	await auth.signIn(input());
	blockedDeletes.add(SESSION);
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
	assert.equal(JSON.parse(values.get(SESSION)).refreshToken, "refresh-1");
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
	assert.equal(values.size, 0);
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
	const schema = z.object({ id: z.string() }).refine(async () => gate.promise);
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
	assert.ok(values.has(SESSION));
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

test("a proactive refresh cancelled by unmount is attempted again after remount", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return new Promise(() => {});
		},
	});
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	const unmount = auth.mount();
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(calls, 1);
	unmount();
	await flush();
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(5_000);
	await flush();
	assert.equal(calls, 2);
	assert.equal(auth.state.get().status, "authenticated");
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

const jwt = (claims) =>
	`e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;

test("JWT lifetime is measured from receipt when the browser clock runs fast", async (t) => {
	const serverNow = 1_000_000;
	t.mock.timers.enable({
		apis: ["Date", "setTimeout"],
		now: (serverNow + 600) * 1000,
	});
	const auth = client();
	await auth.signIn(
		input({ accessToken: jwt({ iat: serverNow, exp: serverNow + 300 }) }),
	);
	assert.equal((await auth.getSession()).expiresAt, Date.now() + 300_000);
	t.mock.timers.reset();
});

test("JWT exp without iat stays absolute", async () => {
	const auth = client();
	const exp = Math.floor(Date.now() / 1000) + 300;
	await auth.signIn(input({ accessToken: jwt({ exp }) }));
	assert.equal((await auth.getSession()).expiresAt, exp * 1000);
	await assert.rejects(
		auth.signIn(input({ accessToken: jwt({ exp: 1 }) })),
		code("INVALID_SESSION"),
	);
});

test("expiresIn seconds are measured from receipt for sign-in and refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => ({ accessToken: "access-2", expiresIn: 120 }),
	});
	await auth.signIn(input({ expiresIn: 60 }));
	assert.equal((await auth.getSession()).expiresAt, 1_060_000);
	t.mock.timers.tick(10_000);
	const refreshed = await auth.refresh(await auth.getSession());
	assert.equal(refreshed.expiresAt, 1_130_000);
	t.mock.timers.reset();
});

test("expiresIn rejects invalid values and conflicts with expiresAt", async () => {
	const auth = client();
	for (const overrides of [
		{ expiresIn: 0 },
		{ expiresIn: "60" },
		{ expiresIn: 60, expiresAt: Date.now() + 60_000 },
	]) {
		await assert.rejects(
			auth.signIn(input(overrides)),
			code("INVALID_SESSION"),
		);
	}
});

test("restoration keeps the saved expiry instead of re-deriving JWT lifetime", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000_000 });
	const iat = 1_000_000;
	await client().signIn(input({ accessToken: jwt({ iat, exp: iat + 300 }) }));
	t.mock.timers.tick(200_000);
	const restored = await client().getSession();
	assert.equal(restored.expiresAt, 1_000_300_000);
	t.mock.timers.reset();
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

const connectCounting = (auth) => {
	const router = {
		invalidations: 0,
		options: { context: { auth } },
		clearCache() {},
		async invalidate() {
			router.invalidations++;
		},
	};
	cleanups.push(connectAuth(router));
	return router;
};
const recordStates = (auth) => {
	const states = [];
	const subscription = auth.state.subscribe((state) => states.push(state));
	cleanups.push(() => subscription.unsubscribe());
	return states;
};

test("401-triggered token-only refresh keeps the user and does not invalidate", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = { ...auth.state.get(), invalidations: router.invalidations };
	const states = recordStates(auth);
	const pending = auth.refresh(await auth.getSession());
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	assert.equal(auth.state.get().user.id, "alice");
	gate.resolve({ accessToken: "access-2" });
	assert.equal((await pending).accessToken, "access-2");
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().version, before.version);
	assert.equal(router.invalidations, before.invalidations);
	assert.ok(states.every((state) => state.user?.id === "alice"));
});

test("refresh failure after rejection becomes unavailable and invalidates once", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = router.invalidations;
	const states = recordStates(auth);
	const pending = auth.refresh(await auth.getSession());
	const checked = assert.rejects(pending, code("REFRESH_FAILED"));
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	gate.reject(new Error("offline"));
	await checked;
	await flush();
	assert.deepEqual(
		states.map((state) => state.status),
		["refreshing", "unavailable"],
	);
	assert.equal(auth.state.get().user, null);
	assert.equal(auth.state.get().error.code, "REFRESH_FAILED");
	assert.equal(router.invalidations, before + 1);
});

test("terminal refresh rejection signs out with one invalidation", async () => {
	const auth = client({ refresh: async () => null });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = router.invalidations;
	assert.equal(await auth.refresh(await auth.getSession()), null);
	await flush();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(router.invalidations, before + 1);
});

test("expired saved session restores through refreshing", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	await client().signIn(input({ expiresAt: 1_010_000 }));
	t.mock.timers.tick(20_000);
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const states = recordStates(auth);
	cleanups.push(auth.mount());
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	assert.equal(auth.state.get().user.id, "alice");
	gate.resolve({ accessToken: "access-2", expiresAt: 1_100_000 });
	await flush();
	assert.deepEqual(
		states.map((state) => state.status),
		["refreshing", "authenticated"],
	);
	cleanups.pop()();
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

const trackedBody = () => {
	const body = { cancelled: false };
	body.stream = new ReadableStream({
		cancel() {
			body.cancelled = true;
		},
	});
	return body;
};

test("a repeated 401 can keep the session when configured", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	global.fetch = async () => new Response(null, { status: 401 });
	const request = createAuthFetch(auth, "https://api.example.com/", {
		signOutOnRepeated401: false,
	});
	assert.equal((await request("/me")).status, 401);
	assert.equal((await auth.getSession()).accessToken, "access-2");
});

test("a failed refresh after a 401 releases the 401 response body", async () => {
	const auth = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await auth.signIn(input());
	const body = trackedBody();
	global.fetch = async () => new Response(body.stream, { status: 401 });
	const request = createAuthFetch(auth, "https://api.example.com/");
	await assert.rejects(request("/me"), code("REFRESH_FAILED"));
	assert.equal(body.cancelled, true);
});

test("a session change during a request releases its response body", async () => {
	const auth = client();
	await auth.signIn(input());
	const body = trackedBody();
	global.fetch = async () => {
		await auth.signOut();
		return new Response(body.stream);
	};
	const request = createAuthFetch(auth, "https://api.example.com/");
	await assert.rejects(request("/me"), code("SESSION_CHANGED"));
	assert.equal(body.cancelled, true);
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

test("return URL treats login path variants and custom login paths as loops", () => {
	for (const value of [
		"/login/",
		"/LOGIN",
		"/Login?next=1",
		"/log%69n",
		"/%E0",
	])
		assert.equal(safeReturnTo(value), "/");
	assert.equal(safeReturnTo("/login/callback"), "/login/callback");
	const options = { loginPath: ["/sign-in", "/auth/Register/"] };
	for (const value of [
		"/sign-in",
		"/Sign-In/",
		"/auth/register",
		"/auth/register/",
	])
		assert.equal(safeReturnTo(value, options), "/");
	assert.equal(safeReturnTo("/login", options), "/login");
	assert.throws(() => safeReturnTo("/", { loginPath: "sign-in" }));
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
	const saved = JSON.parse(values.get(SESSION));
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

const realRouter = async (auth) => {
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
	const root = createRootRouteWithContext()({});
	const login = createRoute({ getParentRoute: () => root, path: "/login" });
	const privateRoute = createRoute({
		getParentRoute: () => root,
		path: "/private",
		beforeLoad: async ({ context }) => {
			router.guardCalls++;
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
	router.guardCalls = 0;
	router.invalidations = 0;
	router.startTransition = async (fn) => {
		fn();
		return true;
	};
	const invalidate = router.invalidate.bind(router);
	router.invalidate = (...args) => {
		router.invalidations++;
		return invalidate(...args);
	};
	cleanups.push(connectAuth(router));
	await router.load();
	return router;
};
const settle = async () => {
	for (let i = 0; i < 20; i++) await new Promise(setImmediate);
};
const privateMatch = (router) =>
	router.state.matches.find((match) => match.routeId === "/private");

test("real Router guards rerun after logout and produce a login redirect", async () => {
	const auth = client();
	await auth.signIn(input());
	const router = await realRouter(auth);
	assert.equal(router.state.location.pathname, "/private");
	await auth.signOut();
	await new Promise(setImmediate);
	assert.ok(router.guardCalls >= 2);
	assert.equal(router.state.location.pathname, "/login");
});

test("a failed refresh reruns real Router guards once without retrying until retry()", async () => {
	let refreshes = 0;
	let offline = true;
	const auth = client({
		refresh: async () => {
			refreshes++;
			await new Promise(setImmediate);
			if (offline) throw new Error("offline");
			return { accessToken: "access-2" };
		},
	});
	await auth.signIn(input());
	const router = await realRouter(auth);
	const guardCalls = router.guardCalls;
	await assert.rejects(
		auth.refresh(await auth.getSession()),
		code("REFRESH_FAILED"),
	);
	await settle();
	assert.equal(refreshes, 1);
	assert.equal(router.invalidations, 1);
	assert.equal(router.guardCalls, guardCalls + 1);
	assert.equal(auth.state.get().status, "unavailable");
	assert.equal(privateMatch(router).error?.code, "REFRESH_FAILED");
	await assert.rejects(auth.getSession(), code("REFRESH_FAILED"));
	assert.equal(refreshes, 1);

	offline = false;
	assert.equal((await auth.retry()).accessToken, "access-2");
	await settle();
	assert.equal(refreshes, 2);
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(privateMatch(router).status, "success");
});

test("sign-in clears a stored refresh failure", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const auth = client({
		refresh: async () => {
			refreshes++;
			throw new Error("offline");
		},
	});
	await auth.signIn(input());
	await assert.rejects(
		auth.refresh(await auth.getSession()),
		code("REFRESH_FAILED"),
	);
	await auth.signIn(input({ accessToken: "access-2", expiresAt: 1_010_000 }));
	t.mock.timers.tick(20_000);
	await assert.rejects(auth.getSession(), code("REFRESH_FAILED"));
	assert.equal(refreshes, 2);
	t.mock.timers.reset();
});

const rotatingServer = ({ gates = [] } = {}) => {
	let issued = 1;
	const live = new Set(["refresh-1"]);
	const server = {
		calls: 0,
		async refresh({ refreshToken }) {
			await gates[server.calls++];
			if (!live.delete(refreshToken)) return null;
			issued++;
			live.add(`refresh-${issued}`);
			return {
				accessToken: `access-${issued}`,
				refreshToken: `refresh-${issued}`,
			};
		},
	};
	return server;
};
const twoTabs = async (server) => {
	const a = client({ refresh: server.refresh });
	await a.signIn(input());
	const b = client({ refresh: server.refresh });
	assert.equal((await b.getSession()).accessToken, "access-1");
	return { a, b };
};
const saved = () => JSON.parse(values.get(SESSION));

test("a tab refreshing after another tab rotated the token adopts the saved tokens", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	const stale = await b.getSession();
	assert.equal(
		(await a.refresh(await a.getSession())).accessToken,
		"access-2",
	);
	assert.equal((await b.refresh(stale)).accessToken, "access-2");
	assert.equal(server.calls, 1);
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(saved().refreshToken, "refresh-2");
	assert.equal(
		(await b.refresh(await b.getSession())).accessToken,
		"access-3",
	);
	assert.equal(saved().refreshToken, "refresh-3");
});

test("tabs refreshing at once spend the refresh token once", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	const [fromA, fromB] = await Promise.all([
		a.refresh(await a.getSession()),
		b.refresh(await b.getSession()),
	]);
	assert.equal(server.calls, 1);
	assert.equal(fromA.accessToken, "access-2");
	assert.equal(fromB.accessToken, "access-2");
	assert.equal(saved().refreshToken, "refresh-2");
});

test("without Web Locks, a rejected refresh adopts newer saved tokens instead of signing out", async () => {
	setGlobal("navigator", undefined);
	const gates = [deferred(), deferred()];
	const server = rotatingServer({ gates: gates.map((gate) => gate.promise) });
	const { a, b } = await twoTabs(server);
	const fromA = a.refresh(await a.getSession());
	const fromB = b.refresh(await b.getSession());
	await flush();
	assert.equal(server.calls, 2);
	gates[0].resolve();
	assert.equal((await fromA).accessToken, "access-2");
	gates[1].resolve();
	assert.equal((await fromB).accessToken, "access-2");
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(saved().refreshToken, "refresh-2");
});

test("a stale tab's profile update keeps tokens another tab refreshed", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.refresh(await a.getSession());
	await b.updateUser({ ...user, email: "b@example.com" });
	assert.equal(saved().refreshToken, "refresh-2");
	assert.equal(saved().user.email, "b@example.com");
	assert.equal((await b.getSession()).accessToken, "access-2");
});

test("a refresh cannot overwrite an account another tab signed in", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await assert.rejects(
		b.refresh(await b.getSession()),
		code("SESSION_CHANGED"),
	);
	assert.equal(server.calls, 0);
	assert.equal(saved().accessToken, "bob-token");
	assert.equal(b.state.get().user.id, "bob");
});

test("a refresh after another tab signed out ends this tab's session too", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.signOut();
	assert.equal(await b.refresh(await b.getSession()), null);
	assert.equal(server.calls, 0);
	assert.equal(b.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});

test("a second 401 does not clear an account another tab signed in", async () => {
	const { a, b } = await twoTabs(rotatingServer());
	const stale = await b.getSession();
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await assert.rejects(b.rejectSession(stale), code("SESSION_CHANGED"));
	assert.equal(saved().accessToken, "bob-token");
});

const broadcast = async (key = SESSION) => {
	const event = new Event("storage");
	event.key = key;
	storageEvents.dispatchEvent(event);
	await flush();
};
const mountedTabs = async (server = rotatingServer()) => {
	const tabs = await twoTabs(server);
	cleanups.push(tabs.a.mount(), tabs.b.mount());
	await flush();
	return tabs;
};

test("signing out in one tab signs out the others", async () => {
	const { a, b } = await mountedTabs();
	const router = connectCounting(b);
	await flush();
	const before = router.invalidations;
	await a.signOut();
	await broadcast();
	assert.equal(b.state.get().status, "unauthenticated");
	assert.equal(await b.getSession(), null);
	assert.equal(router.invalidations, before + 1);
});

test("signing in in one tab signs in a signed-out tab", async () => {
	const b = client();
	cleanups.push(b.mount());
	await flush();
	assert.equal(b.state.get().status, "unauthenticated");
	await client().signIn(input());
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(b.state.get().user.id, "alice");
});

test("switching accounts in one tab switches the others and cancels their work", async () => {
	const gate = deferred();
	const { a, b } = await mountedTabs({ refresh: async () => gate.promise });
	const aliceId = b.state.get().sessionId;
	const pending = b.refresh(await b.getSession());
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await broadcast();
	await checked;
	assert.equal(b.state.get().user.id, "bob");
	assert.notEqual(b.state.get().sessionId, aliceId);
	assert.equal((await b.getSession()).accessToken, "bob-token");
	gate.resolve({ accessToken: "late" });
	await flush();
	assert.equal(saved().accessToken, "bob-token");
});

test("a refresh in one tab reaches the others without a version change", async () => {
	const server = rotatingServer();
	const { a, b } = await mountedTabs(server);
	const before = b.state.get();
	await a.refresh(await a.getSession());
	await broadcast();
	assert.equal(b.state.get().version, before.version);
	assert.equal(b.state.get().user, before.user);
	assert.equal((await b.getSession()).accessToken, "access-2");
	assert.equal(server.calls, 1);
});

test("a profile update in one tab reaches the others", async () => {
	const { a, b } = await mountedTabs();
	const before = b.state.get().version;
	await a.updateUser({ ...user, email: "new@example.com" });
	await broadcast();
	assert.equal(b.state.get().user.email, "new@example.com");
	assert.equal(b.state.get().version, before + 1);
	assert.equal((await b.getSession()).accessToken, "access-1");
});

test("another tab's successful refresh clears this tab's refresh failure", async () => {
	const server = rotatingServer();
	const a = client({ refresh: server.refresh });
	await a.signIn(input());
	const b = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	cleanups.push(b.mount());
	await flush();
	await assert.rejects(
		b.refresh(await b.getSession()),
		code("REFRESH_FAILED"),
	);
	await assert.rejects(b.getSession(), code("REFRESH_FAILED"));
	await a.refresh(await a.getSession());
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(b.state.get().error, null);
	assert.equal((await b.getSession()).accessToken, "access-2");
});

test("a refresh in flight cannot overwrite an account signed in meanwhile", async () => {
	const gate = deferred();
	const { a, b } = await twoTabs({ refresh: async () => gate.promise });
	const pending = b.refresh(await b.getSession());
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	gate.resolve({ accessToken: "alice-refreshed" });
	await checked;
	assert.equal(saved().accessToken, "bob-token");
	assert.equal(b.state.get().user.id, "bob");
});

test("unmounted tabs and unrelated keys ignore storage events", async () => {
	const { a, b } = await twoTabs(rotatingServer());
	const off = b.mount();
	await flush();
	await a.signOut();
	await broadcast("unrelated");
	assert.equal(b.state.get().status, "authenticated");
	off();
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
});

test("invalid saved data from another tab leaves this tab's session alone", async () => {
	const { b } = await mountedTabs();
	values.set(SESSION, "invalid-json");
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
});
