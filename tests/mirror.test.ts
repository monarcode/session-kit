import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createMirrorAuth,
	type ClientCredentials,
	type MirrorAuthOptions,
	type Session,
} from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import {
	createServerAuth,
	type CookieJar,
} from "@monarcode/session-kit/server";

import { code, deferred, user, userSchema } from "./helpers.ts";

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

function mirror(
	options: Partial<MirrorAuthOptions<User, { name: string }>> = {},
) {
	return createMirrorAuth<User, { name: string }>({
		name: "mirror",
		session: alice,
		revalidate: async () => alice,
		signOut: async () => {},
		...options,
	});
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
	await assert.rejects(failing.signIn({ name: "x" }), (error: unknown) => {
		assert.ok(code("USER_VALIDATION_FAILED")(error));
		assert.equal((error as Error).cause, failure);
		return true;
	});
	assert.equal(failing.state.get().sessionId, "s1");
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
		secret: "a-test-secret-that-is-at-least-32-chars",
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
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	globalThis.fetch = async (request) => {
		const authorization = (request as Request).headers.get("Authorization");
		sent.push(authorization);
		return new Response(null, {
			status: authorization === "Bearer access-1" ? 401 : 200,
		});
	};
	const authFetch = createAuthFetch(auth, "https://api.example.com/");
	assert.equal((await authFetch("me")).status, 200);
	assert.deepEqual(sent, ["Bearer access-1", "Bearer access-2"]);

	await auth.signOut();
	assert.equal(cookies.has("app.session"), false);
	assert.equal(await serverAuth.getSession(jar()), null);
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
