import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type AuthDebugEvent,
	createMirrorAuth,
	type ClientCredentials,
	type MirrorAuthOptions,
	type Session,
} from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import {
	createServerAuth,
	sessionHandler,
	type CookieJar,
} from "@monarcode/session-kit/server";

import { code, deferred, SECRET, user, userSchema } from "./helpers.ts";

type User = typeof user;

const alice: Session<User> = Object.freeze({ sessionId: "s1", user });
const bob: Session<User> = Object.freeze({
	sessionId: "s2",
	user: { id: "bob", email: "bob@example.com", role: "member" as const },
});

/** Waits for BroadcastChannel messages, which arrive in a later task. */
const settle = async () => {
	for (let i = 0; i < 5; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Waits up to a second for `done`. For work that leaves the event loop, such
 * as Web Crypto unsealing a cookie, which a fixed number of turns can miss on
 * a slow machine.
 */
const until = async (done: () => boolean) => {
	for (let i = 0; i < 200 && !done(); i++)
		await new Promise((resolve) => setTimeout(resolve, 5));
};

function mirror(
	options: Partial<MirrorAuthOptions<User, { name: string }>> = {},
) {
	return createMirrorAuth<User, { name: string }>({
		name: "mirror",
		session: alice,
		revalidate: async () => alice,
		signOut: async () => {},
		...options,
	} as MirrorAuthOptions<User, { name: string }>);
}

test("starts from the server's session, with no initializing state", async () => {
	let revalidated = 0;
	const auth = mirror({
		revalidate: async () => {
			revalidated++;
			return alice;
		},
	});
	assert.equal(auth.state.get().status, "authenticated");
	assert.deepEqual(auth.state.get().user, user);
	assert.equal(auth.state.get().version, 0);
	assert.deepEqual(await auth.getSession(), alice);
	assert.ok(auth.isCurrent(alice));
	assert.equal(revalidated, 0);
	assert.equal(
		mirror({ session: null }).state.get().status,
		"unauthenticated",
	);
});

test("options and sessions it can't use are rejected", () => {
	assert.throws(() => mirror({ name: "bad name" }), code("INVALID_OPTIONS"));
	assert.throws(
		() => mirror({ revalidate: undefined as never }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() => mirror({ session: { sessionId: "", user } }),
		code("INVALID_SESSION"),
	);
	const auth = mirror();
	assert.throws(() => auth.adopt({ user } as never), code("INVALID_SESSION"));
	assert.throws(
		() => auth.adopt({ sessionId: "s1", user: { at: new Date() } } as never),
		code("USER_VALIDATION_FAILED"),
	);
});

test("adopt changes the version only for another account or user", () => {
	const auth = mirror();
	const before = auth.state.get();
	auth.adopt({ sessionId: "s1", user: { ...user } });
	assert.equal(auth.state.get(), before);
	auth.adopt({ sessionId: "s1", user: { ...user, role: "admin" } });
	assert.equal(auth.state.get().version, 1);
	auth.adopt(bob);
	assert.equal(auth.state.get().version, 2);
	assert.equal(auth.state.get().sessionId, "s2");
	auth.adopt(null);
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(auth.state.get().version, 3);
});

test("signIn forwards the input and adopts the session the server returns", async () => {
	const inputs: unknown[] = [];
	const auth = mirror({
		session: null,
		signIn: async (input) => {
			inputs.push(input);
			return bob;
		},
	});
	assert.deepEqual(await auth.signIn({ name: "bob" }), bob);
	assert.deepEqual(inputs, [{ name: "bob" }]);
	assert.equal(auth.state.get().sessionId, "s2");

	const failure = new Error("Wrong password");
	const failing = mirror({
		signIn: async () => {
			throw failure;
		},
	});
	// The app's own error, unchanged, as a single-page app's sign-in form
	// gets it.
	await assert.rejects(failing.signIn({ name: "x" }), (error: unknown) => {
		assert.equal(error, failure);
		return true;
	});
	assert.equal(failing.state.get().sessionId, "s1");
	const thrown = mirror({
		signIn: () => {
			throw failure;
		},
	});
	await assert.rejects(thrown.signIn({ name: "x" }), (error: unknown) => {
		assert.equal(error, failure);
		return true;
	});
	const notASession = mirror({
		signIn: async () => ({ user }) as never,
	});
	await assert.rejects(
		notASession.signIn({ name: "x" }),
		code("INVALID_SESSION"),
	);
	const signedOut = mirror({ signIn: async () => null as never });
	await assert.rejects(
		signedOut.signIn({ name: "x" }),
		code("INVALID_SESSION"),
	);
	assert.equal(signedOut.state.get().sessionId, "s1");
	assert.equal(
		"signIn" in
			createMirrorAuth<User>({
				name: "mirror",
				session: null,
				revalidate: async () => null,
				signOut: async () => {},
			}),
		false,
	);
});

test("signOut ends the session only once the server has", async () => {
	const answer = deferred();
	const auth = mirror({ signOut: () => answer.promise });
	const signingOut = auth.signOut();
	assert.equal(auth.state.get().status, "authenticated");
	answer.resolve();
	await signingOut;
	assert.equal(auth.state.get().status, "unauthenticated");

	const failing = mirror({
		signOut: async () => {
			throw new Error("offline");
		},
	});
	await assert.rejects(failing.signOut(), code("PERSISTENCE_FAILED"));
	assert.equal(failing.state.get().status, "authenticated");
	assert.equal(failing.state.get().error?.code, "PERSISTENCE_FAILED");
});

test("retry reads the server again; a failure keeps the session", async () => {
	let next: Session<User> | null | Error = bob;
	const auth = mirror({
		revalidate: async () => {
			if (next instanceof Error) throw next;
			return next;
		},
	});
	assert.deepEqual(await auth.retry(), bob);
	assert.equal(auth.state.get().sessionId, "s2");

	next = new Error("offline");
	await assert.rejects(auth.refresh(), code("REFRESH_FAILED"));
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().error?.code, "REFRESH_FAILED");
	next = null;
	assert.equal(await auth.retry(), null);
	assert.equal(auth.state.get().error, null);
});

test("a revalidation that started before a change here doesn't undo it", async () => {
	const answer = deferred<Session<User>>();
	const auth = mirror({ revalidate: () => answer.promise });
	const revalidating = auth.retry();
	auth.adopt(bob);
	answer.resolve(alice);
	assert.deepEqual(await revalidating, bob);
	assert.equal(auth.state.get().sessionId, "s2");
});

test("other tabs revalidate after a change, and when the tab becomes visible", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const reads: string[] = [];
	const other = mirror({
		revalidate: async () => {
			reads.push("other");
			return bob;
		},
	});
	t.after(other.mount());
	const here = mirror();
	here.adopt(bob);
	await settle();
	assert.deepEqual(reads, ["other"]);
	assert.equal(other.state.get().sessionId, "s2");

	const page = Object.assign(new EventTarget(), {
		visibilityState: "visible",
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: page,
	});
	t.after(() => {
		delete (globalThis as { document?: unknown }).document;
	});
	const visible = mirror({
		revalidate: async () => {
			reads.push("visible");
			return alice;
		},
	});
	const unmount = visible.mount();
	// The server answered moments ago, when the page rendered.
	page.dispatchEvent(new Event("visibilitychange"));
	await settle();
	assert.deepEqual(reads, ["other"]);
	t.mock.timers.tick(10_000);
	page.dispatchEvent(new Event("visibilitychange"));
	await settle();
	page.dispatchEvent(new Event("visibilitychange"));
	await settle();
	unmount();
	t.mock.timers.tick(10_000);
	page.dispatchEvent(new Event("visibilitychange"));
	await settle();
	assert.deepEqual(reads, ["other", "visible"]);
});

test("credentials need the option, are cached in memory, and are shared", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	await assert.rejects(mirror().credentials.get(), code("INVALID_OPTIONS"));
	let asked = 0;
	const answer = deferred<ClientCredentials>();
	const auth = mirror({
		credentials: {
			get: () => {
				asked++;
				return answer.promise;
			},
			renew: async () => null,
		},
	});
	const a = auth.credentials.get();
	const b = auth.credentials.get();
	answer.resolve({ sessionId: "s1", accessToken: "access-1", expiresIn: 60 });
	assert.equal((await a)?.accessToken, "access-1");
	assert.equal(await b, await a);
	assert.equal((await a)?.expiresAt, Date.now() + 60_000);
	await auth.credentials.get();
	assert.equal(asked, 1);
	t.mock.timers.tick(56_000);
	await auth.credentials.get();
	assert.equal(asked, 2);
	const signedOut = mirror({
		session: null,
		credentials: {
			get: async () => assert.fail("not asked"),
			renew: async () => null,
		},
	});
	assert.equal(await signedOut.credentials.get(), null);
});

test("credentials follow the server: renew, sign-out, another session", async () => {
	let current: ClientCredentials | null = {
		sessionId: "s1",
		accessToken: "access-1",
	};
	const renewed: unknown[] = [];
	const auth = mirror({
		revalidate: async () => bob,
		credentials: {
			get: async () => current,
			renew: async (rejected) => {
				renewed.push(rejected);
				return { sessionId: "s1", accessToken: "access-2" };
			},
		},
	});
	const first = await auth.credentials.get();
	assert.ok(first);
	assert.equal((await auth.credentials.renew(first))?.accessToken, "access-2");
	assert.deepEqual(renewed, [{ sessionId: "s1", accessToken: "access-1" }]);
	// Already renewed: no second request.
	assert.equal((await auth.credentials.renew(first))?.accessToken, "access-2");
	assert.equal(renewed.length, 1);
	await assert.rejects(
		auth.credentials.renew({ sessionId: "other", accessToken: "x" }),
		code("SESSION_CHANGED"),
	);

	const other = mirror({
		revalidate: async () => bob,
		credentials: {
			get: async () => ({ sessionId: "s2", accessToken: "b" }),
			renew: async () => null,
		},
	});
	await assert.rejects(other.credentials.get(), code("SESSION_CHANGED"));
	await settle();
	assert.equal(other.state.get().sessionId, "s2");

	current = null;
	const ended = mirror({
		credentials: { get: async () => current, renew: async () => null },
	});
	assert.equal(await ended.credentials.get(), null);
	assert.equal(ended.state.get().status, "unauthenticated");
});

test("renew asks again when the token another call cached has expired too", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let issued = 0;
	const renewed: unknown[] = [];
	const issue = () => ({
		sessionId: "s1",
		accessToken: `access-${++issued}`,
		expiresIn: 60,
	});
	const auth = mirror({
		credentials: {
			get: async () => issue(),
			renew: async (rejected) => {
				renewed.push(rejected.accessToken);
				return issue();
			},
		},
	});
	// A slow request holds the first token while a later call caches the second.
	const first = await auth.credentials.get();
	t.mock.timers.tick(56_000);
	assert.equal((await auth.credentials.get())?.accessToken, "access-2");
	t.mock.timers.tick(61_000);
	assert.ok(first);
	assert.equal((await auth.credentials.renew(first))?.accessToken, "access-3");
	assert.deepEqual(renewed, ["access-1"]);
});

test("credentials.reject signs out only for the current token", async () => {
	let signedOut = 0;
	const auth = mirror({
		signOut: async () => {
			signedOut++;
		},
		credentials: {
			get: async () => ({ sessionId: "s1", accessToken: "access-2" }),
			renew: async () => null,
		},
	});
	await auth.credentials.get();
	await auth.credentials.reject({ sessionId: "s1", accessToken: "access-1" });
	assert.equal(signedOut, 0);
	await auth.credentials.reject({ sessionId: "s1", accessToken: "access-2" });
	assert.equal(signedOut, 1);
	assert.equal(auth.state.get().status, "unauthenticated");
});

test("end to end: browser sign-in sealed on the server, then authFetch", async (t) => {
	const cookies = new Map<string, string>();
	const jar = (): CookieJar => {
		const snapshot = new Map(cookies);
		return {
			writable: true,
			get: (name) => snapshot.get(name),
			set: (name, value) => cookies.set(name, value),
			delete: (name) => cookies.delete(name),
		};
	};
	const serverAuth = createServerAuth({
		name: "app",
		user: userSchema,
		secret: SECRET,
		clientCredentials: true,
		refresh: async () => ({ accessToken: "access-2", expiresIn: 900 }),
	});
	const auth = createMirrorAuth({
		name: "app",
		session: await serverAuth.getSession(jar()),
		// The app's server functions, called over the network in a real app.
		signIn: (tokens: { accessToken: string; refreshToken: string }) =>
			serverAuth.signIn(jar(), { ...tokens, expiresIn: 900, user }),
		signOut: () => serverAuth.signOut(jar()),
		revalidate: () => serverAuth.getSession(jar()),
		credentials: {
			get: () => serverAuth.clientCredentials.get(jar()),
			renew: (rejected) =>
				serverAuth.clientCredentials.renew(jar(), rejected),
		},
	});
	assert.equal(auth.state.get().status, "unauthenticated");
	await auth.signIn({ accessToken: "access-1", refreshToken: "refresh-1" });
	assert.equal(auth.state.get().status, "authenticated");
	assert.ok(cookies.get("app.session"));

	const sent: Array<string | null> = [];
	const originalFetch = globalThis.fetch;
	// The page the client runs in.
	Object.defineProperty(globalThis, "location", {
		value: new URL("https://app.test/dashboard"),
		configurable: true,
	});
	t.after(() => {
		globalThis.fetch = originalFetch;
		delete (globalThis as { location?: unknown }).location;
	});
	globalThis.fetch = async (request) => {
		const authorization = (request as Request).headers.get("Authorization");
		sent.push(authorization);
		return new Response(null, {
			status: authorization === "Bearer access-1" ? 401 : 200,
		});
	};
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	assert.equal((await authFetch("me")).status, 200);
	assert.deepEqual(sent, ["Bearer access-1", "Bearer access-2"]);

	await auth.signOut();
	assert.equal(cookies.has("app.session"), false);
	assert.equal(await serverAuth.getSession(jar()), null);
});

test("a sign-in the app's function refused is reported, with its message only when sensitive", async () => {
	for (const sensitive of [false, true]) {
		const events: AuthDebugEvent[] = [];
		const auth = mirror({
			debug: { log: (event) => events.push(event), sensitive },
			signIn: async () => {
				throw new Error("Wrong password");
			},
		});
		await assert.rejects(auth.signIn({ name: "x" }));
		const rejected = events.find((event) => event.type === "sign-in");
		assert.equal(rejected?.message, "rejected by the signIn option");
		assert.equal(rejected?.error, undefined);
		assert.deepEqual(
			rejected?.data,
			sensitive ? { reason: "Wrong password" } : undefined,
		);
	}
});

test("a failed sign-in leaves a revalidation in flight to apply", async () => {
	const answer = deferred<Session<User> | null>();
	const auth = mirror({
		revalidate: () => answer.promise,
		signIn: async () => {
			throw new Error("Wrong password");
		},
	});
	const revalidating = auth.retry();
	await assert.rejects(auth.signIn({ name: "x" }));
	answer.resolve(null);
	assert.equal(await revalidating, null);
	assert.equal(auth.state.get().status, "unauthenticated");
});

/**
 * A server with a session route at `/api/session`, and `fetch` routed to it
 * as a browser on the same site would send it.
 */
function withSessionRoute(
	t: { after: (fn: () => void) => void },
	options: { clientCredentials?: boolean } = {},
) {
	const cookies = new Map<string, string>();
	const jar = (): CookieJar => {
		const snapshot = new Map(cookies);
		return {
			writable: true,
			get: (name) => snapshot.get(name),
			set: (name, value) => cookies.set(name, value),
			delete: (name) => cookies.delete(name),
		};
	};
	let refreshes = 0;
	const serverAuth = createServerAuth({
		name: "app",
		user: userSchema,
		secret: SECRET,
		...options,
		refresh: async () => ({
			accessToken: `access-${++refreshes + 1}`,
			expiresIn: 900,
		}),
	});
	const handle = sessionHandler(serverAuth);
	const sent: string[] = [];
	const originalFetch = globalThis.fetch;
	// The page the client runs in.
	Object.defineProperty(globalThis, "location", {
		value: new URL("https://app.test/dashboard"),
		configurable: true,
	});
	t.after(() => {
		globalThis.fetch = originalFetch;
		delete (globalThis as { location?: unknown }).location;
	});
	const network = { down: false, site: "same-origin" };
	globalThis.fetch = async (input, init) => {
		if (network.down) throw new TypeError("fetch failed");
		const headers = new Headers(init?.headers);
		headers.set("Sec-Fetch-Site", network.site);
		const request = new Request(new URL(String(input), "https://app.test"), {
			...init,
			headers,
		});
		sent.push(`${request.method} ${request.url}`);
		if (!request.url.endsWith("/api/session"))
			return new Response("<h1>Not found</h1>", { status: 404 });
		return handle(request, jar());
	};
	return { serverAuth, jar, cookies, sent, network };
}

test("endpoint: the client reads, gets the token and signs out through the session route", async (t) => {
	const { serverAuth, jar, cookies, sent } = withSessionRoute(t, {
		clientCredentials: true,
	});
	const signedIn = await serverAuth.signIn(jar(), {
		accessToken: "access-1",
		refreshToken: "refresh-1",
		expiresIn: 900,
		user,
	});
	const auth = createMirrorAuth({
		name: "app",
		session: null as Session<User> | null,
		endpoint: "/api/session",
	});
	assert.deepEqual(await auth.retry(), signedIn);
	assert.equal(auth.state.get().status, "authenticated");

	const credentials = await auth.credentials.get();
	assert.equal(credentials?.accessToken, "access-1");
	const renewed = await auth.credentials.renew(credentials!);
	assert.equal(renewed?.accessToken, "access-2");

	await auth.signOut();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(cookies.has("app.session"), false);
	assert.deepEqual(sent, [
		"GET https://app.test/api/session",
		"POST https://app.test/api/session",
		"POST https://app.test/api/session",
		"POST https://app.test/api/session",
	]);
});

test("endpoint: failures reject with the server's code, or as the app's functions' do", async (t) => {
	const { serverAuth, jar, network } = withSessionRoute(t);
	const session = await serverAuth.signIn(jar(), {
		accessToken: "access-1",
		expiresIn: 900,
		user,
	});
	const auth = createMirrorAuth({
		name: "app",
		session,
		endpoint: "/api/session",
	});
	// Without clientCredentials, the server keeps the token.
	await assert.rejects(auth.credentials.get(), code("INVALID_OPTIONS"));
	network.site = "cross-site";
	await assert.rejects(auth.retry(), code("INVALID_OPTIONS"));
	network.site = "same-origin";
	network.down = true;
	await assert.rejects(auth.retry(), code("REFRESH_FAILED"));
	await assert.rejects(auth.signOut(), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "authenticated");
	network.down = false;

	const elsewhere = createMirrorAuth({
		name: "app",
		session,
		endpoint: "/api/sessions",
	});
	await assert.rejects(elsewhere.retry(), code("REFRESH_FAILED"));
});

test("endpoint: revalidate, signOut and credentials win, and the path is checked", async (t) => {
	const { sent } = withSessionRoute(t);
	const auth = createMirrorAuth({
		name: "app",
		session: alice,
		endpoint: "/api/session",
		revalidate: async () => bob,
		credentials: {
			get: async () => ({ sessionId: "s2", accessToken: "own" }),
			renew: async () => null,
		},
	});
	assert.deepEqual(await auth.retry(), bob);
	assert.equal((await auth.credentials.get())?.accessToken, "own");
	assert.deepEqual(sent, []);

	for (const endpoint of [
		"api/session",
		"//evil.test/session",
		"/\\evil",
		"/\t/evil.test/session",
		"/\n\\evil.test",
		"/api session",
		1,
	])
		assert.throws(
			() =>
				createMirrorAuth({
					name: "app",
					session: null,
					endpoint: endpoint as string,
				}),
			code("INVALID_OPTIONS"),
		);
	assert.throws(
		// @ts-expect-error: neither endpoint nor revalidate and signOut
		() => createMirrorAuth({ name: "app", session: null }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() =>
			// @ts-expect-error: revalidate without signOut
			createMirrorAuth({
				name: "app",
				session: null,
				revalidate: async () => null,
			}),
		code("INVALID_OPTIONS"),
	);
});

test("endpoint: on the server, a call through it rejects with INVALID_OPTIONS", async (t) => {
	withSessionRoute(t);
	delete (globalThis as { location?: unknown }).location;
	const auth = createMirrorAuth({
		name: "app",
		session: alice,
		endpoint: "/api/session",
	});
	await assert.rejects(auth.retry(), code("INVALID_OPTIONS"));
	await assert.rejects(auth.signOut(), code("INVALID_OPTIONS"));
});

test("endpoint: when the server holds another account, renew follows it", async (t) => {
	const { serverAuth, jar } = withSessionRoute(t, { clientCredentials: true });
	const first = await serverAuth.signIn(jar(), {
		accessToken: "access-1",
		expiresIn: 900,
		user,
	});
	const auth = createMirrorAuth({
		name: "app",
		session: first,
		endpoint: "/api/session",
	});
	const credentials = await auth.credentials.get();
	// Another account signs in with a form post: no tab hears of it.
	const second = await serverAuth.signIn(jar(), {
		accessToken: "access-9",
		expiresIn: 900,
		user: { ...user, id: "u2" },
	});
	await assert.rejects(
		auth.credentials.renew(credentials!),
		code("SESSION_CHANGED"),
	);
	await until(() => auth.state.get().sessionId === second.sessionId);
	assert.equal(auth.state.get().sessionId, second.sessionId);
	assert.equal((await auth.credentials.get())?.accessToken, "access-9");
});
