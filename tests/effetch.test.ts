import assert from "node:assert/strict";
import { test } from "node:test";

import * as Fetch from "@monarcode/effetch";
import { retry } from "@monarcode/effetch/plugins";
import { AuthError, createMirrorAuth } from "@monarcode/session-kit";
import { Auth, AuthFailure } from "@monarcode/session-kit/effect";
import {
	sessionBearer,
	type SessionBearerOptions,
} from "@monarcode/session-kit/effetch";
import type { CookieJar } from "@monarcode/session-kit/server";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import {
	cleanups,
	client,
	code,
	credentialsOf,
	input,
	serverSide,
	setGlobal,
	type TestClient,
	tokens,
	user,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

const baseUrl = "https://api.example.com";

type Sent = { url: string; authorization: string | null; init: RequestInit };

/** Answers each request with the next status, recording what was sent. */
function serve(...statuses: number[]) {
	const sent: Sent[] = [];
	setGlobal("fetch", async (url: URL | string, init: RequestInit = {}) => {
		sent.push({
			url: String(url),
			authorization: new Headers(init.headers).get("authorization"),
			init,
		});
		const status = statuses[sent.length - 1] ?? statuses.at(-1) ?? 200;
		return status === 200
			? Response.json({ ok: true })
			: new Response(null, { status });
	});
	return sent;
}

/** An effetch client with `sessionBearer` last, using `auth`. */
const makeApi = (
	auth: TestClient,
	options: Partial<SessionBearerOptions> = {},
) =>
	Effect.runPromise(
		Fetch.make({
			baseUrl,
			plugins: [
				retry({ times: 1, schedule: Schedule.spaced("0 millis") }),
				sessionBearer({ baseUrl, ...options }),
			],
		}).pipe(
			Effect.provide(
				Layer.merge(FetchHttpClient.layer, Auth.layer(auth as never)),
			),
			// Effect reads `globalThis.fetch` once; each test mocks its own.
			Effect.provideService(FetchHttpClient.Fetch, (url, init) =>
				globalThis.fetch(url, init),
			),
		),
	);

/** The call's status: 200 when it succeeds, else its `HttpError`'s. */
const status = <E>(call: Effect.Effect<unknown, E>) =>
	Effect.runPromise(
		call.pipe(
			Effect.as(200),
			Effect.catchIf(
				(error): error is E & Fetch.HttpError =>
					error instanceof Fetch.HttpError,
				(error) => Effect.succeed(error.status),
			),
		),
	);

/** The `AuthFailure` the call fails with. */
const failure = async (call: Effect.Effect<unknown, unknown>) => {
	const failed = await Effect.runPromise(Effect.flip(call));
	assert.ok(failed instanceof AuthFailure);
	return failed;
};

/** A client whose refreshes return `access-2`, `access-3` and so on. */
const renewing = () => {
	let token = 1;
	return client({
		refresh: async () => ({ accessToken: `access-${++token}` }),
	});
};

test("sends the token, and after a 401 renews once and replays a GET", async () => {
	const auth = renewing();
	await auth.signIn(input());
	const api = await makeApi(auth);
	const sent = serve(401, 200);
	assert.equal(await status(api.get("/me")), 200);
	assert.deepEqual(
		sent.map((request) => request.authorization),
		["Bearer access-1", "Bearer access-2"],
	);
	assert.equal(sent[0]?.url, `${baseUrl}/me`);
	assert.equal(sent[0]?.init.redirect, "error");
});

test("works on a createMirrorAuth client with credentials", async () => {
	const mirror = createMirrorAuth({
		name: "effetch-mirror",
		session: { sessionId: "s1", user },
		revalidate: async () => ({ sessionId: "s1", user }),
		signOut: async () => {},
		credentials: {
			get: async () => ({ sessionId: "s1", accessToken: "access-1" }),
			renew: async () => ({ sessionId: "s1", accessToken: "access-2" }),
		},
	});
	Auth.layer(mirror);
	const api = await makeApi(mirror as never);
	const sent = serve(401, 200);
	assert.equal(await status(api.get("/me")), 200);
	assert.deepEqual(
		sent.map((request) => request.authorization),
		["Bearer access-1", "Bearer access-2"],
	);
});

test("tokens stay on the configured origin", async () => {
	const auth = renewing();
	await auth.signIn(input());
	const api = await makeApi(auth);
	const sent = serve(200);
	for (const url of [
		"https://evil.example/me",
		"https://user:pass@api.example.com/me",
	]) {
		const exit = await Effect.runPromiseExit(api.get(url));
		assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		const died = Cause.squash(exit.cause);
		assert.ok(died instanceof AuthError && died.code === "INVALID_OPTIONS");
	}
	assert.equal(sent.length, 0);
	assert.throws(
		() => sessionBearer({ baseUrl: "not a url" }),
		code("INVALID_OPTIONS"),
	);
});

test("mutations are not replayed", async () => {
	const auth = renewing();
	await auth.signIn(input());
	const api = await makeApi(auth);
	const sent = serve(401);
	assert.equal(await status(api.post("/change", { body: { a: 1 } })), 401);
	assert.equal(sent.length, 1);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
});

test("a second 401 signs out, unless configured or overridden per call", async () => {
	const keeping = renewing();
	await keeping.signIn(input());
	serve(401);
	const lenient = await makeApi(keeping, { signOutOnRepeated401: false });
	assert.equal(await status(lenient.get("/me")), 401);
	assert.equal((await credentialsOf(keeping)).accessToken, "access-2");

	const api = await makeApi(keeping);
	assert.equal(
		await status(
			api.get("/me", {
				plugins: { sessionBearer: { signOutOnRepeated401: false } },
			}),
		),
		401,
	);
	assert.equal((await credentialsOf(keeping)).accessToken, "access-3");
	assert.equal(await status(api.get("/me")), 401);
	assert.equal(await keeping.getSession(), null);
});

test("a 401 that ends the session returns the 401", async () => {
	const auth = client({ refresh: async () => null });
	await auth.signIn(input());
	const api = await makeApi(auth);
	const sent = serve(401);
	assert.equal(await status(api.get("/me")), 401);
	assert.equal(sent.length, 1);
	assert.equal(auth.state.get().status, "unauthenticated");
});

test("signed out or locked, calls fail without sending", async () => {
	const auth = client({ locking: true });
	cleanups.push(auth.mount());
	const api = await makeApi(auth);
	const sent = serve(200);
	assert.equal((await failure(api.get("/me"))).code, "UNAUTHENTICATED");
	await auth.signIn(input({ expiresIn: 600 }));
	await auth.lock();
	assert.equal((await failure(api.get("/me"))).code, "LOCKED");
	assert.equal(sent.length, 0);
});

test("optional sends signed-out calls without a token, but not locked ones", async () => {
	let refreshed = 0;
	const auth = client({
		locking: true,
		refresh: async () => {
			refreshed++;
			return { accessToken: "access-2" };
		},
	});
	cleanups.push(auth.mount());
	const api = await makeApi(auth, { optional: true });
	const sent = serve(200, 401);
	assert.equal(await status(api.get("/feed")), 200);
	assert.equal(await status(api.get("/me")), 401);
	assert.deepEqual(
		sent.map((request) => request.authorization),
		[null, null],
	);
	assert.equal(refreshed, 0);
	assert.equal(
		(
			await failure(
				api.get("/me", { plugins: { sessionBearer: { optional: false } } }),
			)
		).code,
		"UNAUTHENTICATED",
	);

	const strict = await makeApi(auth);
	assert.equal(
		await status(
			strict.get("/feed", {
				plugins: { sessionBearer: { optional: true } },
			}),
		),
		401,
	);
	assert.equal(sent.length, 3);

	await auth.signIn(input({ expiresIn: 600 }));
	await auth.lock();
	assert.equal((await failure(api.get("/feed"))).code, "LOCKED");
	assert.equal(sent.length, 3);
});

test("a sign-in during an optional signed-out call fails it with SESSION_CHANGED", async () => {
	const auth = renewing();
	const api = await makeApi(auth, { optional: true });
	const sent: RequestInit[] = [];
	setGlobal("fetch", async (_url: string, init: RequestInit) => {
		sent.push(init);
		await auth.signIn(input());
		return new Response(null, { status: 401 });
	});
	assert.equal((await failure(api.get("/me"))).code, "SESSION_CHANGED");
	assert.equal(sent[0]?.redirect, "error");
	assert.equal(auth.state.get().status, "authenticated");
});

test("a session change during a call fails with SESSION_CHANGED", async () => {
	const auth = renewing();
	await auth.signIn(input());
	const api = await makeApi(auth);
	setGlobal("fetch", async () => {
		await auth.signIn(
			input({ accessToken: "bob-1", user: { ...user, id: "bob" } }),
		);
		return Response.json({ ok: true });
	});
	assert.equal((await failure(api.get("/me"))).code, "SESSION_CHANGED");
});

test("a call can skip it, and retries read the token again", async () => {
	const auth = renewing();
	const api = await makeApi(auth);
	const sent = serve(200);
	assert.equal(
		await status(api.get("/public", { plugins: { sessionBearer: false } })),
		200,
	);
	assert.equal(sent[0]?.authorization, null);

	await auth.signIn(input());
	const retried = serve(503, 200);
	assert.equal(await status(api.get("/me")), 200);
	assert.deepEqual(
		retried.map((request) => request.authorization),
		["Bearer access-1", "Bearer access-1"],
	);
});

test("a request with its own Authorization header is sent as it is", async () => {
	let refreshed = 0;
	const auth = client({
		refresh: async () => {
			refreshed++;
			return { accessToken: "access-2" };
		},
	});
	const api = await makeApi(auth);
	const sent = serve(401);
	const own = { headers: { Authorization: "Token own" } };
	assert.equal(await status(api.get("/me", own)), 401);
	await auth.signIn(input());
	assert.equal(await status(api.get("/me", own)), 401);
	assert.deepEqual(
		sent.map((request) => request.authorization),
		["Token own", "Token own"],
	);
	assert.equal(refreshed, 0);
	assert.equal(auth.state.get().status, "authenticated");
});

test("the app's own RequestInit is kept", async () => {
	const auth = renewing();
	await auth.signIn(input());
	const api = await makeApi(auth);
	const sent = serve(200);
	await Effect.runPromise(
		api.get("/me").pipe(
			Effect.provideService(FetchHttpClient.RequestInit, {
				credentials: "omit",
			}),
		),
	);
	assert.equal(sent[0]?.init.credentials, "omit");
	assert.equal(sent[0]?.init.redirect, "error");
});

test("on a request's server session, sends the cookie's token and saves a renewed one", async () => {
	const { serverAuth, request } = serverSide("effetch-server");
	await serverAuth.signIn(request(), tokens());
	const api = await makeApi(serverAuth.forRequest(request()) as never);
	const sent = serve(401, 200);
	assert.equal(await status(api.get("/me")), 200);
	assert.deepEqual(
		sent.map((call) => call.authorization),
		["Bearer access-1", "Bearer access-2"],
	);
	assert.equal(
		(await serverAuth.credentials.get(request()))?.accessToken,
		"access-2",
	);
});

test("on a request's server session, a repeated 401 signs out with a writable jar only", async () => {
	const writable = serverSide("effetch-server");
	await writable.serverAuth.signIn(writable.request(), tokens());
	const api = await makeApi(
		writable.serverAuth.forRequest(writable.request()) as never,
	);
	serve(401);
	assert.equal(await status(api.get("/me")), 401);
	assert.equal(writable.cookies.has(writable.cookie), false);

	// A read-only jar can't renew: the call fails, and the cookie stays.
	const readOnly = serverSide("effetch-server");
	await readOnly.serverAuth.signIn(readOnly.request(), tokens());
	const render = await makeApi(
		readOnly.serverAuth.forRequest(readOnly.request(false)) as never,
	);
	const sent = serve(401);
	assert.equal((await failure(render.get("/me"))).code, "REFRESH_FAILED");
	assert.equal(sent.length, 1);
	assert.ok(readOnly.cookies.has(readOnly.cookie));
});

test("on a request's server session, optional sends a signed-out call without a token", async () => {
	const { serverAuth, request } = serverSide("effetch-server");
	const api = await makeApi(serverAuth.forRequest(request()) as never, {
		optional: true,
	});
	const sent = serve(200);
	assert.equal(await status(api.get("/public")), 200);
	assert.equal(sent[0]?.authorization, null);
});

test("concurrent requests each build their API client over their own session", async () => {
	const { serverAuth } = serverSide("effetch-server");
	const users = 20;
	const jars = await Promise.all(
		Array.from({ length: users }, async (_, index) => {
			const cookies = new Map<string, string>();
			const jar: CookieJar = {
				writable: true,
				get: (cookie) => cookies.get(cookie),
				set: (cookie, value) => void cookies.set(cookie, value),
				delete: (cookie) => void cookies.delete(cookie),
			};
			await serverAuth.signIn(
				jar,
				tokens({ accessToken: `token-${index}` }),
			);
			return jar;
		}),
	);
	// Later requests answer first, so the calls interleave the same way each run.
	setGlobal("fetch", async (_url: URL | string, init: RequestInit = {}) => {
		const token = new Headers(init.headers).get("authorization");
		const index = Number(token?.split("-")[1]);
		await new Promise((resolve) => setTimeout(resolve, users - index));
		return Response.json({ token });
	});

	const Whoami = Schema.Struct({ token: Schema.NullOr(Schema.String) });
	const whoami = Fetch.endpoint("GET /whoami", { output: Whoami });
	let builds = 0;
	const make = Effect.gen(function* () {
		builds++;
		const api = yield* Fetch.make({
			baseUrl,
			plugins: [sessionBearer({ baseUrl })],
		});
		return {
			api,
			own: api.endpoint("GET /whoami", { output: Whoami }),
			bound: api.bind(whoami),
		};
	});
	class ApiClient extends Context.Service<
		ApiClient,
		Effect.Success<typeof make>
	>()("ApiClient") {}

	// Built once: what belongs to no user. Per request: the session and the
	// client that uses it.
	const runtime = ManagedRuntime.make(
		Layer.merge(
			FetchHttpClient.layer,
			Layer.succeed(FetchHttpClient.Fetch, (url, init) =>
				globalThis.fetch(url, init),
			),
		),
	);
	cleanups.push(() => runtime.dispose());
	// One layer for every request, as an app declares it: each `Effect.provide`
	// must still build it again.
	const ApiClientLive = Layer.effect(ApiClient, make);
	const requestLayer = (jar: CookieJar) =>
		ApiClientLive.pipe(
			Layer.provideMerge(Auth.layer(serverAuth.forRequest(jar))),
		);
	const program = Effect.gen(function* () {
		const { api, own, bound } = yield* ApiClient;
		const session = yield* Auth.session;
		const sent = [
			(yield* api.get("/whoami", { output: Whoami })).token,
			(yield* own()).token,
			(yield* bound()).token,
		];
		return { sent, user: session.sessionId };
	});

	const results = await Promise.all(
		jars.map((jar) =>
			runtime.runPromise(Effect.provide(program, requestLayer(jar))),
		),
	);
	assert.equal(builds, users);
	const sessions = await Promise.all(
		jars.map((jar) => serverAuth.getSession(jar)),
	);
	results.forEach((result, index) => {
		assert.deepEqual(result.sent, Array(3).fill(`Bearer token-${index}`));
		assert.equal(result.user, sessions[index]?.sessionId);
	});
});
