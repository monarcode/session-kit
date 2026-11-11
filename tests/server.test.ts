import assert from "node:assert/strict";
import { test } from "node:test";

import { fromAccessToken } from "@monarcode/session-kit";
import {
	createServerAuth,
	type CookieJar,
	type CookieOptions,
	type ServerAuthOptions,
} from "@monarcode/session-kit/server";
import { z } from "zod";

import {
	code,
	deferred,
	jwt,
	SECRET,
	tokens,
	user,
	userSchema,
} from "./helpers.ts";

const OTHER_SECRET = "another-test-secret-at-least-32-chars!";

/**
 * A browser's cookies for the app. Each request reads them as they were when
 * it started, and its writes reach the browser at once, as a response would.
 */
function browser(initial: Record<string, string> = {}) {
	const cookies = new Map(Object.entries(initial));
	const writes: Array<{
		name: string;
		value: string | null;
		options: CookieOptions;
	}> = [];
	return {
		cookies,
		writes,
		request(writable = true): CookieJar {
			const snapshot = new Map(cookies);
			return {
				writable,
				get: (name) => snapshot.get(name),
				set(name, value, options) {
					cookies.set(name, value);
					writes.push({ name, value, options });
				},
				delete(name, options) {
					cookies.delete(name);
					writes.push({ name, value: null, options });
				},
			};
		},
	};
}

function server(options: Partial<ServerAuthOptions<typeof userSchema>> = {}) {
	return createServerAuth({
		name: "test",
		user: userSchema,
		secret: SECRET,
		...options,
	});
}

test("signIn seals the session into an httpOnly cookie that later requests read", async () => {
	const app = server();
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());
	assert.deepEqual(session.user, user);
	assert.deepEqual(Object.keys(session), ["sessionId", "user"]);

	const value = tab.cookies.get("test.session");
	assert.ok(value);
	assert.doesNotMatch(value, /access-1|refresh-1|alice/);
	assert.deepEqual(tab.writes[0]!.options, {
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		path: "/",
		domain: undefined,
		maxAge: 30 * 24 * 60 * 60,
	});

	const next = tab.request();
	assert.deepEqual(await app.getSession(next), session);
	const credentials = await app.credentials.get(next);
	assert.equal(credentials?.accessToken, "access-1");
	assert.equal(credentials?.sessionId, session.sessionId);
	assert.equal(await app.getSession(browser().request()), null);
});

test("options it can't use throw INVALID_OPTIONS", () => {
	assert.throws(() => server({ name: "bad name" }), code("INVALID_OPTIONS"));
	assert.throws(
		() => server({ cookie: { sameSite: "none", secure: false } }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() => server({ user: {} as typeof userSchema }),
		code("INVALID_OPTIONS"),
	);
});

test("a missing or short secret rejects every call, not the creation", async () => {
	for (const secret of ["too-short", [], undefined]) {
		const app = server({ secret: secret as string });
		const tab = browser({ "test.session": "1.sealed" });
		await assert.rejects(
			app.getSession(tab.request()),
			code("INVALID_OPTIONS"),
		);
		await assert.rejects(
			app.getSession(tab.request(false)),
			code("INVALID_OPTIONS"),
		);
		await assert.rejects(
			app.signIn(tab.request(), tokens()),
			code("INVALID_OPTIONS"),
		);
		await assert.rejects(
			app.refreshIfDue(browser().request()),
			code("INVALID_OPTIONS"),
		);
		assert.deepEqual(tab.writes, []);
	}
});

test("secrets rotate: any listed secret opens, and the first seals", async () => {
	const tab = browser();
	const old = await server({ secret: OTHER_SECRET }).signIn(
		tab.request(),
		tokens(),
	);
	const rotated = server({ secret: [SECRET, OTHER_SECRET] });
	assert.deepEqual(await rotated.getSession(tab.request()), old);

	await rotated.updateUser(tab.request(), {
		...user,
		email: "new@example.com",
	});
	const retired = server({ secret: SECRET });
	assert.equal(
		(await retired.getSession(tab.request()))?.user.email,
		"new@example.com",
	);
});

test("a cookie no secret opens reads as signed out and is deleted", async () => {
	const tab = browser();
	await server({ secret: OTHER_SECRET }).signIn(tab.request(), tokens());
	const app = server();

	assert.equal(await app.getSession(tab.request(false)), null);
	assert.ok(
		tab.cookies.has("test.session"),
		"a read-only jar can't delete it",
	);
	assert.equal(await app.getSession(tab.request()), null);
	assert.equal(tab.cookies.has("test.session"), false);
});

test("a tampered or moved cookie reads as signed out", async () => {
	const tab = browser();
	await server().signIn(tab.request(), tokens());
	const sealed = tab.cookies.get("test.session")!;
	const flipped =
		sealed.slice(0, -2) +
		(sealed.at(-2) === "A" ? "B" : "A") +
		sealed.slice(-1);
	assert.equal(
		await server().getSession(browser({ "test.session": flipped }).request()),
		null,
	);
	assert.equal(
		await server({ name: "other" }).getSession(
			browser({ "other.session": sealed }).request(),
		),
		null,
	);
});

test("a large session is split across cookies, and stale chunks are deleted", async () => {
	const tab = browser();
	const bio = "x".repeat(4500);
	const schema = z.object({ id: z.string(), bio: z.string() });
	const big = createServerAuth({ name: "test", user: schema, secret: SECRET });
	const session = await big.signIn(tab.request(), {
		accessToken: "access-1",
		user: { id: "alice", bio },
	});
	assert.match(tab.cookies.get("test.session")!, /^c\d+$/);
	assert.equal(tab.cookies.get("test.session"), "c2");
	assert.ok(tab.cookies.has("test.session.1"));
	assert.deepEqual(await big.getSession(tab.request()), session);

	await big.updateUser(tab.request(), { id: "alice", bio: "short" });
	assert.equal(tab.cookies.has("test.session.0"), false);
	assert.equal((await big.getSession(tab.request()))?.user.bio, "short");
	await big.signOut(tab.request());
	assert.deepEqual([...tab.cookies.keys()], []);
});

test("expired access is refreshed and saved with a writable jar", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const calls: string[] = [];
	const app = server({
		refresh: async ({ refreshToken }) => {
			calls.push(refreshToken);
			return {
				accessToken: "access-2",
				refreshToken: "refresh-2",
				expiresIn: 900,
			};
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);

	assert.equal(
		(await app.credentials.get(tab.request()))?.accessToken,
		"access-2",
	);
	assert.deepEqual(calls, ["refresh-1"]);
	assert.equal(
		(await app.credentials.get(tab.request()))?.accessToken,
		"access-2",
	);
	assert.deepEqual(calls, ["refresh-1"]);
});

test("a read-only jar never refreshes: credentials reject, identity stays", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			return { accessToken: "access-2" };
		},
	});
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());
	const render = tab.request(false);
	assert.equal((await app.credentials.get(render))?.accessToken, "access-1");

	t.mock.timers.tick(901_000);
	await assert.rejects(
		app.credentials.get(tab.request(false)),
		code("REFRESH_FAILED"),
	);
	assert.deepEqual(await app.getSession(tab.request(false)), session);
	await assert.rejects(
		app.credentials.renew(tab.request(false), {
			sessionId: session.sessionId,
			accessToken: "access-1",
		}),
		code("REFRESH_FAILED"),
	);
	for (const write of [
		() => app.signIn(tab.request(false), tokens()),
		() => app.signOut(tab.request(false)),
		() => app.refreshIfDue(tab.request(false)),
		() => app.updateUser(tab.request(false), user),
	])
		await assert.rejects(write, code("INVALID_OPTIONS"));
	assert.equal(calls, 0);
});

test("parallel requests with the same expired cookie share one refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const answer = deferred();
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			return answer.promise;
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);

	const first = tab.request();
	const second = tab.request();
	const a = app.credentials.get(first);
	const b = app.credentials.get(second);
	answer.resolve({
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresIn: 900,
	});
	assert.equal((await a)?.accessToken, "access-2");
	assert.equal((await b)?.accessToken, "access-2");
	assert.equal(calls, 1);

	// A request that started with the old cookie, after the refresh.
	const late = browser({
		"test.session": [...tab.writes].find((w) => w.value)!.value!,
	});
	assert.equal(
		(await app.credentials.get(late.request()))?.accessToken,
		"access-2",
	);
	assert.ok(late.cookies.get("test.session") !== tab.writes[0]!.value);
	assert.equal(calls, 1);
});

test("parallel requests share a failed refresh, and retry after ten seconds", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			throw new Error("backend down");
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);
	const results = await Promise.allSettled(
		[1, 2, 3, 4].map(() => app.getSession(tab.request())),
	);
	assert.equal(calls, 1);
	for (const result of results)
		assert.ok(
			result.status === "rejected" && code("REFRESH_FAILED")(result.reason),
		);

	t.mock.timers.tick(10_000);
	await assert.rejects(app.getSession(tab.request()), code("REFRESH_FAILED"));
	assert.equal(calls, 2);
});

test("a refresh token the backend rejects signs out every request that carries it", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			return null;
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	const old = tab.cookies.get("test.session")!;
	t.mock.timers.tick(901_000);

	assert.equal(await app.credentials.get(tab.request()), null);
	assert.equal(tab.cookies.has("test.session"), false);
	const late = browser({ "test.session": old });
	assert.equal(await app.getSession(late.request()), null);
	assert.equal(late.cookies.has("test.session"), false);
	assert.equal(calls, 1);
});

test("refreshIfDue refreshes within the window, and ignores a failure while access works", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let fail = false;
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			if (fail) throw new Error("offline");
			return { accessToken: `access-${calls + 1}`, expiresIn: 900 };
		},
	});
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());

	assert.deepEqual(await app.refreshIfDue(tab.request()), session);
	assert.equal(calls, 0);
	t.mock.timers.tick(850_000);
	assert.deepEqual(await app.refreshIfDue(tab.request()), session);
	assert.equal(calls, 1);
	assert.equal(
		(await app.credentials.get(tab.request(false)))?.accessToken,
		"access-2",
	);

	fail = true;
	t.mock.timers.tick(850_000);
	assert.deepEqual(await app.refreshIfDue(tab.request()), session);
	assert.equal(calls, 2);
	t.mock.timers.tick(60_000);
	await assert.rejects(
		app.refreshIfDue(tab.request()),
		code("REFRESH_FAILED"),
	);
	await assert.rejects(
		app.refreshIfDue(tab.request(), { within: -1 }),
		code("INVALID_OPTIONS"),
	);
});

test("signOut clears the cookie, then waits for revoke", async () => {
	const revoked = deferred();
	const seen: unknown[] = [];
	const app = server({
		revoke: async ({ accessToken, refreshToken }) => {
			seen.push({ accessToken, refreshToken });
			await revoked.promise;
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	let done = false;
	const signingOut = app.signOut(tab.request()).then(() => (done = true));
	while (!seen.length) await new Promise((resolve) => setImmediate(resolve));
	assert.equal(tab.cookies.has("test.session"), false);
	assert.equal(done, false);
	revoked.resolve();
	await signingOut;
	assert.deepEqual(seen, [
		{ accessToken: "access-1", refreshToken: "refresh-1" },
	]);
});

test("credentials.reject signs out only the current token, without revoking", async () => {
	let revoked = 0;
	const app = server({
		revoke: async () => {
			revoked++;
		},
	});
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());
	await app.credentials.reject(tab.request(), {
		sessionId: session.sessionId,
		accessToken: "another",
	});
	assert.deepEqual(await app.getSession(tab.request()), session);
	await app.credentials.reject(tab.request(), {
		sessionId: session.sessionId,
		accessToken: "access-1",
	});
	assert.equal(await app.getSession(tab.request()), null);
	assert.equal(revoked, 0);
});

test("signOut and credentials.reject end expired access without refreshing it", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let refreshes = 0;
	const revoked: unknown[] = [];
	const app = server({
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2", expiresIn: 900 };
		},
		revoke: async ({ accessToken, refreshToken }) => {
			revoked.push({ accessToken, refreshToken });
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);
	await app.signOut(tab.request());
	assert.equal(refreshes, 0);
	assert.deepEqual(revoked, [
		{ accessToken: "access-1", refreshToken: "refresh-1" },
	]);
	assert.deepEqual(
		tab.writes.map(({ value }) => value === null),
		[false, true],
	);

	const session = await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);
	await app.credentials.reject(tab.request(), {
		sessionId: session.sessionId,
		accessToken: "access-1",
	});
	assert.equal(refreshes, 0);
	assert.equal(await app.getSession(tab.request(false)), null);
});

test("clientCredentials is opt-in and never includes the refresh token", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const tab = browser();
	const closed = server();
	await closed.signIn(tab.request(), tokens());
	await assert.rejects(
		closed.clientCredentials.get(tab.request()),
		code("INVALID_OPTIONS"),
	);

	const app = server({
		clientCredentials: true,
		refresh: async () => ({ accessToken: "access-2", expiresIn: 900 }),
	});
	const credentials = await app.clientCredentials.get(tab.request());
	assert.deepEqual(Object.keys(credentials!), [
		"sessionId",
		"accessToken",
		"expiresIn",
	]);
	assert.equal(credentials?.accessToken, "access-1");
	assert.equal(credentials?.expiresIn, 900);

	await assert.rejects(
		app.clientCredentials.renew(tab.request(), { accessToken: 1 }),
		code("INVALID_OPTIONS"),
	);
	const renewed = await app.clientCredentials.renew(tab.request(), {
		sessionId: credentials!.sessionId,
		accessToken: "access-1",
	});
	assert.equal(renewed?.accessToken, "access-2");
	assert.equal(await app.clientCredentials.get(browser().request()), null);
});

test("updateUser keeps the session and returns it with the new user", async () => {
	const app = server();
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());
	const updated = await app.updateUser(tab.request(), {
		...user,
		role: "admin",
	});
	assert.equal(updated.sessionId, session.sessionId);
	assert.equal(updated.user.role, "admin");
	assert.equal((await app.getSession(tab.request(false)))?.user.role, "admin");
	await assert.rejects(
		app.updateUser(tab.request(), { id: 1 } as never),
		code("USER_VALIDATION_FAILED"),
	);
});

test("with fromAccessToken, the user is read from the token and there is no updateUser", async () => {
	const app = createServerAuth({
		name: "test",
		user: fromAccessToken(z.object({ sub: z.string() }), (claims) => ({
			id: claims.sub,
		})),
		secret: SECRET,
	});
	const tab = browser();
	const session = await app.signIn(tab.request(), {
		accessToken: jwt({ sub: "alice" }),
	});
	assert.deepEqual(session.user, { id: "alice" });
	assert.equal("updateUser" in app, false);
	assert.deepEqual(await app.getSession(tab.request(false)), session);
});

test("calls in one request share what it read and wrote", async () => {
	const app = server();
	const tab = browser();
	const jar = tab.request();
	const session = await app.signIn(jar, tokens());
	// The jar's own `get` still sees the request's cookies, which had none.
	assert.equal(jar.get("test.session"), undefined);
	assert.deepEqual(await app.getSession(jar), session);
	await app.signOut(jar);
	assert.equal(await app.getSession(jar), null);
});

test("a session too large for two cookies is refused at sign-in", async () => {
	const schema = z.object({ id: z.string(), bio: z.string() });
	const big = createServerAuth({ name: "test", user: schema, secret: SECRET });
	const tab = browser();
	await assert.rejects(
		big.signIn(tab.request(), {
			accessToken: "access-1",
			user: { id: "alice", bio: "x".repeat(6000) },
		}),
		code("PERSISTENCE_FAILED"),
	);
	assert.deepEqual([...tab.cookies.keys()], []);
});

test("a chunked cookie missing a part reads as signed out and is deleted", async () => {
	const schema = z.object({ id: z.string(), bio: z.string() });
	const big = createServerAuth({ name: "test", user: schema, secret: SECRET });
	const tab = browser();
	await big.signIn(tab.request(), {
		accessToken: "access-1",
		user: { id: "alice", bio: "x".repeat(4500) },
	});
	tab.cookies.delete("test.session.1");
	assert.equal(await big.getSession(tab.request()), null);
	assert.deepEqual([...tab.cookies.keys()], []);
});

test("another request's refresh serves an old cookie for ten seconds only", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			return { accessToken: `access-${calls + 1}`, expiresIn: 900 };
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	const old = tab.cookies.get("test.session")!;
	t.mock.timers.tick(901_000);
	await app.credentials.get(tab.request());
	assert.equal(calls, 1);

	// A read-only render with the old cookie sees the new token, without saving.
	const render = browser({ "test.session": old });
	assert.equal(
		(await app.credentials.get(render.request(false)))?.accessToken,
		"access-2",
	);
	assert.equal(render.cookies.get("test.session"), old);
	// A writable one saves it, for the whole lifetime the refresh gave it.
	const other = browser({ "test.session": old });
	assert.equal(
		(await app.credentials.get(other.request()))?.accessToken,
		"access-2",
	);
	assert.equal(calls, 1);
	assert.equal(other.writes[0]?.options.maxAge, 30 * 24 * 60 * 60);

	t.mock.timers.tick(10_000);
	assert.equal(
		(await app.credentials.get(browser({ "test.session": old }).request()))
			?.accessToken,
		"access-3",
	);
	assert.equal(calls, 2);
});

test("a jar that turns read-only during a refresh leaves the session to other requests", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	let sending: { writable: boolean } | undefined;
	const app = server({
		refresh: async () => {
			calls++;
			// The response leaves while the backend answers.
			if (sending) sending.writable = false;
			return { accessToken: `access-${calls + 1}`, expiresIn: 900 };
		},
	});
	const tab = browser();
	const session = await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);
	const jar = { ...tab.request(), writable: true as boolean };
	sending = jar;
	await assert.rejects(app.credentials.get(jar));
	sending = undefined;
	assert.equal(tab.writes.length, 1);

	assert.deepEqual(await app.getSession(tab.request()), session);
	assert.equal(calls, 2);
});

test("refreshIfDue refreshes once per request, even for short-lived tokens", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let calls = 0;
	const app = server({
		refresh: async () => {
			calls++;
			return { accessToken: `access-${calls + 1}`, expiresIn: 30 };
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens({ expiresIn: 30 }));
	t.mock.timers.tick(31_000);
	await app.refreshIfDue(tab.request());
	assert.equal(calls, 1);
});

test("forRequest gives one request's session, shaped like a client", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const app = server({
		refresh: async () => ({
			accessToken: "access-2",
			refreshToken: "refresh-2",
			expiresIn: 900,
		}),
	});
	const tab = browser();
	const signedIn = await app.signIn(tab.request(), tokens());

	const jar = tab.request();
	const view = app.forRequest(jar);
	assert.equal(app.forRequest(jar), view);
	assert.notEqual(app.forRequest(tab.request()), view);
	assert.ok(
		Object.isFrozen(view) &&
			Object.isFrozen(view.credentials) &&
			Object.isFrozen(view.state),
	);
	assert.equal(view.state.get().status, "initializing");
	assert.equal(view.isCurrent(signedIn), false);

	assert.deepEqual(await view.getSession(), signedIn);
	assert.equal(view.state.get().sessionId, signedIn.sessionId);
	assert.equal(view.isCurrent(signedIn), true);

	// Expired access is refreshed and saved, as serverAuth's methods do.
	t.mock.timers.tick(901_000);
	const seen: string[] = [];
	const { unsubscribe } = view.state.subscribe((state) =>
		seen.push(state.status),
	);
	const fresh = await view.credentials.get();
	unsubscribe();
	assert.equal(fresh?.accessToken, "access-2");
	assert.ok(seen.includes("refreshing"));
	assert.equal(
		(await app.credentials.get(tab.request()))?.accessToken,
		"access-2",
	);

	await view.signOut();
	assert.equal(view.state.get().sessionId, null);
	assert.equal(view.isCurrent(signedIn), false);
	assert.equal(tab.cookies.has("test.session"), false);
	assert.equal(await app.getSession(tab.request()), null);
});

test("forRequest renews and rejects as serverAuth's credentials do", async () => {
	let refreshes = 0;
	const app = server({
		refresh: async () => {
			refreshes++;
			return { accessToken: `access-${refreshes + 1}`, expiresIn: 900 };
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	const view = app.forRequest(tab.request());

	const first = await view.credentials.get();
	assert.ok(first);
	const renewed = await view.credentials.renew(first);
	assert.equal(renewed?.accessToken, "access-2");
	// A stale token leaves the session; the current one ends it.
	await view.credentials.reject(first);
	assert.ok(await view.getSession());
	await view.credentials.reject(renewed!);
	assert.equal(await view.getSession(), null);
	assert.equal(refreshes, 1);
});

test("forRequest over a read-only jar reads, never writes, and its reject keeps the session", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	let refreshes = 0;
	const app = server({
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2" };
		},
	});
	const tab = browser();
	const signedIn = await app.signIn(tab.request(), tokens());
	const render = app.forRequest(tab.request(false));

	assert.deepEqual(await render.getSession(), signedIn);
	assert.equal(render.isCurrent(signedIn), true);
	const credentials = await render.credentials.get();
	assert.equal(credentials?.accessToken, "access-1");
	await render.credentials.reject(credentials!);
	assert.deepEqual(await render.getSession(), signedIn);
	assert.ok(tab.cookies.has("test.session"));

	t.mock.timers.tick(901_000);
	const expired = app.forRequest(tab.request(false));
	assert.deepEqual(await expired.getSession(), signedIn);
	// Its access has expired and this jar can't refresh it.
	assert.equal(expired.state.get().status, "unavailable");
	assert.equal(expired.state.get().sessionId, signedIn.sessionId);
	assert.equal(expired.isCurrent(signedIn), true);
	await assert.rejects(expired.credentials.get(), code("REFRESH_FAILED"));
	await assert.rejects(
		expired.credentials.renew(credentials!),
		code("REFRESH_FAILED"),
	);
	await assert.rejects(expired.signOut(), code("INVALID_OPTIONS"));
	// serverAuth's own reject still refuses a read-only jar.
	await assert.rejects(
		app.credentials.reject(tab.request(false), credentials!),
		code("INVALID_OPTIONS"),
	);
	assert.deepEqual(await expired.getSession(), signedIn);
	assert.equal(refreshes, 0);
});

test("views of parallel requests with the same expired cookie share one refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const answer = deferred();
	let refreshes = 0;
	const app = server({
		refresh: async () => {
			refreshes++;
			return answer.promise;
		},
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);

	const a = app.forRequest(tab.request()).credentials.get();
	const b = app.forRequest(tab.request()).credentials.get();
	answer.resolve({
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresIn: 900,
	});
	assert.equal((await a)?.accessToken, "access-2");
	assert.equal((await b)?.accessToken, "access-2");
	assert.equal(refreshes, 1);
});

test("forRequest's synchronous members don't throw without a secret", async () => {
	const app = server({ secret: "" });
	const view = app.forRequest(browser().request());
	const state = view.state.get();
	assert.equal(state.status, "unavailable");
	assert.equal(state.error?.code, "INVALID_OPTIONS");
	assert.equal(view.isCurrent({ sessionId: "x" }), false);
	view.state.subscribe(() => {}).unsubscribe();
	await assert.rejects(view.getSession(), code("INVALID_OPTIONS"));
});

test("a writable view with expired access goes straight to refreshing, never unavailable", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const app = server({
		refresh: async () => ({ accessToken: "access-2", expiresIn: 900 }),
	});
	const tab = browser();
	await app.signIn(tab.request(), tokens());
	t.mock.timers.tick(901_000);
	const view = app.forRequest(tab.request());
	const seen: string[] = [];
	view.state.subscribe((state) => seen.push(state.status));
	assert.equal((await view.credentials.get())?.accessToken, "access-2");
	assert.deepEqual(seen, ["refreshing", "authenticated"]);
});
