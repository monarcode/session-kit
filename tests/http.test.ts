import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuthFetch } from "@monarcode/session-kit/http";

import {
	cleanups,
	input,
	client,
	code,
	credentialsOf,
	serverSide,
	setGlobal,
	tokens,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

test("GET retries once; bearer tokens stay on the configured origin", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	const headers: (string | null)[] = [];
	setGlobal("fetch", async (request: Request) => {
		headers.push(request.headers.get("Authorization"));
		return new Response(null, { status: headers.length === 1 ? 401 : 200 });
	});
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
	setGlobal("fetch", async () => {
		calls++;
		return new Response(null, { status: 401 });
	});
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
	setGlobal("fetch", async () => new Response(null, { status: 401 }));
	const request = createAuthFetch(auth, "https://api.example.com/");
	assert.equal((await request("/me")).status, 401);
	assert.equal(await auth.getSession(), null);
});

const trackedBody = () => {
	const body: { cancelled: boolean; stream: ReadableStream } = {
		cancelled: false,
		stream: new ReadableStream({
			cancel() {
				body.cancelled = true;
			},
		}),
	};
	return body;
};

test("a repeated 401 can keep the session when configured", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	setGlobal("fetch", async () => new Response(null, { status: 401 }));
	const request = createAuthFetch(auth, "https://api.example.com/", {
		signOutOnRepeated401: false,
	});
	assert.equal((await request("/me")).status, 401);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
});

test("a failed refresh after a 401 releases the 401 response body", async () => {
	const auth = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await auth.signIn(input());
	const body = trackedBody();
	setGlobal("fetch", async () => new Response(body.stream, { status: 401 }));
	const request = createAuthFetch(auth, "https://api.example.com/");
	await assert.rejects(request("/me"), code("REFRESH_FAILED"));
	assert.equal(body.cancelled, true);
});

test("a session change during a request releases its response body", async () => {
	const auth = client();
	await auth.signIn(input());
	const body = trackedBody();
	setGlobal("fetch", async () => {
		await auth.signOut();
		return new Response(body.stream);
	});
	const request = createAuthFetch(auth, "https://api.example.com/");
	await assert.rejects(request("/me"), code("SESSION_CHANGED"));
	assert.equal(body.cancelled, true);
});

test("optional sends signed-out requests without a token, but not locked ones", async () => {
	let refreshed = 0;
	const auth = client({
		locking: true,
		refresh: async () => {
			refreshed++;
			return { accessToken: "access-2" };
		},
	});
	cleanups.push(auth.mount());
	const sent: Request[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(request);
		return new Response(null, { status: sent.length === 1 ? 200 : 401 });
	});
	const request = createAuthFetch(auth, "https://api.example.com/", {
		optional: true,
	});
	assert.equal((await request("/feed")).status, 200);
	assert.equal((await request("/me")).status, 401);
	assert.deepEqual(
		sent.map((sentRequest) => sentRequest.headers.get("Authorization")),
		[null, null],
	);
	assert.equal(sent[0]?.redirect, "error");
	assert.equal(refreshed, 0);
	await assert.rejects(
		request("https://evil.example/feed"),
		code("INVALID_OPTIONS"),
	);
	await assert.rejects(
		createAuthFetch(auth, "https://api.example.com/")("/feed"),
		code("UNAUTHENTICATED"),
	);
	assert.equal(sent.length, 2);

	await auth.signIn(input({ expiresIn: 600 }));
	await auth.lock();
	await assert.rejects(request("/feed"), code("LOCKED"));
	assert.equal(sent.length, 2);
});

test("optional still sends the token, and renews after a 401, when signed in", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	const headers: (string | null)[] = [];
	setGlobal("fetch", async (request: Request) => {
		headers.push(request.headers.get("Authorization"));
		return new Response(null, { status: headers.length === 1 ? 401 : 200 });
	});
	const request = createAuthFetch(auth, "https://api.example.com/", {
		optional: true,
	});
	assert.equal((await request("/me")).status, 200);
	assert.deepEqual(headers, ["Bearer access-1", "Bearer access-2"]);
});

test("a sign-in during an optional signed-out request rejects with SESSION_CHANGED", async () => {
	const auth = client();
	const body = trackedBody();
	setGlobal("fetch", async () => {
		await auth.signIn(input());
		return new Response(body.stream, { status: 401 });
	});
	const request = createAuthFetch(auth, "https://api.example.com/", {
		optional: true,
	});
	await assert.rejects(request("/me"), code("SESSION_CHANGED"));
	assert.equal(body.cancelled, true);
	assert.equal(auth.state.get().status, "authenticated");
});

test("createAuthFetch over a request's view sends the cookie's token and saves a renewed one", async () => {
	const { serverAuth, request } = serverSide("test");
	await serverAuth.signIn(request(), tokens());
	const headers: (string | null)[] = [];
	setGlobal("fetch", async (sent: Request) => {
		headers.push(sent.headers.get("Authorization"));
		return new Response(null, { status: headers.length === 1 ? 401 : 200 });
	});
	const authFetch = createAuthFetch(
		serverAuth.forRequest(request()),
		"https://api.example.com/",
	);
	assert.equal((await authFetch("/me")).status, 200);
	assert.deepEqual(headers, ["Bearer access-1", "Bearer access-2"]);
	// The next request reads the renewed token from the cookie.
	assert.equal(
		(await serverAuth.credentials.get(request()))?.accessToken,
		"access-2",
	);
});

test("createAuthFetch over a request's view ends the session after a repeated 401", async () => {
	const { serverAuth, request, cookies, cookie } = serverSide("test");
	await serverAuth.signIn(request(), tokens());
	setGlobal("fetch", async () => new Response(null, { status: 401 }));
	const authFetch = createAuthFetch(
		serverAuth.forRequest(request()),
		"https://api.example.com/",
	);
	assert.equal((await authFetch("/me")).status, 401);
	assert.equal(cookies.has(cookie), false);
	assert.equal(await serverAuth.getSession(request()), null);
});

test("createAuthFetch over a read-only view can't renew after a 401, and keeps the session", async () => {
	const { serverAuth, request, cookies, cookie } = serverSide("test");
	await serverAuth.signIn(request(), tokens());
	let calls = 0;
	setGlobal("fetch", async () => {
		calls++;
		return new Response(null, { status: 401 });
	});
	const authFetch = createAuthFetch(
		serverAuth.forRequest(request(false)),
		"https://api.example.com/",
	);
	await assert.rejects(authFetch("/me"), code("REFRESH_FAILED"));
	assert.equal(calls, 1);
	assert.ok(cookies.has(cookie));
	assert.ok(await serverAuth.getSession(request(false)));
});
