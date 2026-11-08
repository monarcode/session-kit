import assert from "node:assert/strict";
import { test } from "node:test";

import * as Fetch from "@monarcode/effetch";
import { retry } from "@monarcode/effetch/plugins";
import { AuthError } from "@monarcode/session-kit";
import { Auth, AuthFailure } from "@monarcode/session-kit/effect";
import {
	sessionBearer,
	type SessionBearerOptions,
} from "@monarcode/session-kit/effetch";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import {
	cleanups,
	client,
	code,
	credentialsOf,
	input,
	setGlobal,
	type TestClient,
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
