import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthError } from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import axios from "axios";
import ky from "ky";

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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
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
		createAuthFetch(auth, {
			baseUrl: "https://api.example.com/",
		})("/feed"),
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
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
	const request = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
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
	const authFetch = createAuthFetch(serverAuth.forRequest(request()), {
		baseUrl: "https://api.example.com/",
	});
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
	const authFetch = createAuthFetch(serverAuth.forRequest(request()), {
		baseUrl: "https://api.example.com/",
	});
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
	const authFetch = createAuthFetch(serverAuth.forRequest(request(false)), {
		baseUrl: "https://api.example.com/",
	});
	await assert.rejects(authFetch("/me"), code("REFRESH_FAILED"));
	assert.equal(calls, 1);
	assert.ok(cookies.has(cookie));
	assert.ok(await serverAuth.getSession(request(false)));
});

test("a URL or a Request is sent as fetch would send it", async () => {
	const auth = client();
	await auth.signIn(input());
	const sent: Request[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(request);
		return new Response(null, { status: 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/v1/",
	});
	await authFetch(new URL("https://api.example.com/v1/me?full=1"));
	await authFetch(
		new Request("https://api.example.com/v1/orders", {
			method: "POST",
			headers: { "X-Trace": "from-request" },
			body: "data",
		}),
	);
	await authFetch(new Request("https://api.example.com/v1/orders"), {
		method: "DELETE",
		headers: { "X-Trace": "from-init" },
	});
	assert.deepEqual(
		sent.map((request) => [request.method, request.url]),
		[
			["GET", "https://api.example.com/v1/me?full=1"],
			["POST", "https://api.example.com/v1/orders"],
			["DELETE", "https://api.example.com/v1/orders"],
		],
	);
	assert.deepEqual(
		sent.map((request) => request.headers.get("Authorization")),
		["Bearer access-1", "Bearer access-1", "Bearer access-1"],
	);
	assert.equal(await sent[1]?.text(), "data");
	assert.equal(sent[1]?.headers.get("X-Trace"), "from-request");
	assert.equal(sent[2]?.headers.get("X-Trace"), "from-init");
});

test("a URL or a Request for another origin is refused, and nothing is sent", async () => {
	const auth = client();
	await auth.signIn(input());
	let calls = 0;
	setGlobal("fetch", async () => {
		calls++;
		return new Response(null);
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	for (const target of [
		new URL("https://evil.example/me"),
		new Request("https://evil.example/me"),
		new URL("https://user:secret@api.example.com/me"),
		// Same host, another origin.
		new Request("http://api.example.com/me"),
	])
		await assert.rejects(authFetch(target), code("INVALID_OPTIONS"));
	assert.equal(calls, 0);
});

test("a GET Request is sent again after a 401; a Request with a body is not", async () => {
	let issued = 1;
	const auth = client({
		refresh: async () => ({ accessToken: `access-${++issued}` }),
	});
	await auth.signIn(input());
	const statuses = [401, 200, 401];
	const sent: string[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(
			`${request.method} ${request.headers.get("Authorization")} ${request.headers.get("X-Trace")}`,
		);
		return new Response(null, { status: statuses.shift() ?? 500 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	const get = new Request("https://api.example.com/me", {
		headers: { "X-Trace": "1" },
	});
	assert.equal((await authFetch(get)).status, 200);
	const post = new Request("https://api.example.com/change", {
		method: "POST",
		body: "data",
	});
	assert.equal((await authFetch(post)).status, 401);
	assert.deepEqual(sent, [
		"GET Bearer access-1 1",
		"GET Bearer access-2 1",
		"POST Bearer access-2 null",
	]);
});

test("an HTTP client can take authFetch as its fetch", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	const headers: (string | null)[] = [];
	setGlobal("fetch", async (request: Request) => {
		headers.push(request.headers.get("Authorization"));
		return headers.length === 1
			? new Response(null, { status: 401 })
			: new Response(JSON.stringify({ id: 1 }), {
					headers: { "Content-Type": "application/json" },
				});
	});
	const api = ky.create({
		baseUrl: "https://api.example.com/",
		fetch: createAuthFetch(auth, { baseUrl: "https://api.example.com/" }),
	});
	assert.deepEqual(await api.get("me").json(), { id: 1 });
	assert.deepEqual(headers, ["Bearer access-1", "Bearer access-2"]);
	// ky can't take the token elsewhere either, and passes the error on as
	// it is.
	await assert.rejects(
		api.get("https://evil.example/me"),
		(error: unknown) =>
			error instanceof AuthError && error.code === "INVALID_OPTIONS",
	);
	assert.equal(headers.length, 2);
});

test("createAuthFetch throws INVALID_OPTIONS without a usable baseUrl", () => {
	const auth = client();
	assert.throws(
		// @ts-expect-error The base URL is an option, not an argument.
		() => createAuthFetch(auth, "https://api.example.com/"),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		// @ts-expect-error baseUrl is required.
		() => createAuthFetch(auth, {}),
		code("INVALID_OPTIONS"),
	);
	// @ts-expect-error So is the options object.
	assert.throws(() => createAuthFetch(auth), code("INVALID_OPTIONS"));
	assert.throws(
		() => createAuthFetch(auth, { baseUrl: "not a url" }),
		code("INVALID_OPTIONS"),
	);
});

test("a HEAD Request is sent again after a 401", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	await auth.signIn(input());
	const sent: string[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(`${request.method} ${request.headers.get("Authorization")}`);
		return new Response(null, { status: sent.length === 1 ? 401 : 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	const head = new Request("https://api.example.com/me", { method: "HEAD" });
	assert.equal((await authFetch(head)).status, 200);
	assert.deepEqual(sent, ["HEAD Bearer access-1", "HEAD Bearer access-2"]);
});

test("a call that sends nothing leaves the caller's Request usable", async () => {
	const auth = client();
	const sent: string[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(await request.text());
		return new Response(null, { status: 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	const post = new Request("https://api.example.com/change", {
		method: "POST",
		body: "data",
	});
	const elsewhere = new Request("https://evil.example/change", {
		method: "POST",
		body: "data",
	});
	await assert.rejects(authFetch(post), code("UNAUTHENTICATED"));
	await assert.rejects(authFetch(elsewhere), code("INVALID_OPTIONS"));
	assert.equal(post.bodyUsed, false);
	assert.equal(elsewhere.bodyUsed, false);

	await auth.signIn(input());
	assert.equal((await authFetch(post)).status, 200);
	assert.deepEqual(sent, ["data"]);
	// Sent once, it's used up, as with fetch.
	assert.equal(post.bodyUsed, true);
	await assert.rejects(authFetch(post), TypeError);
});

test("signed out with optional, a Request goes without a token and keeps its own", async () => {
	const auth = client();
	const sent: Request[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(request);
		return new Response(null, { status: 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
		optional: true,
	});
	await authFetch(
		new Request("https://api.example.com/feed", {
			headers: { "X-Trace": "1" },
		}),
	);
	await authFetch(
		new Request("https://api.example.com/login", {
			method: "POST",
			headers: { Authorization: "Basic abc" },
			body: "data",
		}),
	);
	assert.equal(sent[0]?.headers.get("Authorization"), null);
	assert.equal(sent[0]?.headers.get("X-Trace"), "1");
	assert.equal(sent[1]?.headers.get("Authorization"), "Basic abc");
	assert.equal(await sent[1]?.text(), "data");
});

test("a Request's signal still aborts the request that is sent", async () => {
	const auth = client();
	await auth.signIn(input());
	const sent: Request[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(request);
		return new Response(null, { status: 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	const controller = new AbortController();
	await authFetch(
		new Request("https://api.example.com/me", { signal: controller.signal }),
	);
	assert.equal(sent[0]?.signal.aborted, false);
	controller.abort();
	assert.equal(sent[0]?.signal.aborted, true);
});

test("the URL that is checked is the URL that is sent", async () => {
	const auth = client();
	await auth.signIn(input());
	const sent: string[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(request.url);
		return new Response(null, { status: 200 });
	});
	const authFetch = createAuthFetch(auth, {
		baseUrl: "https://api.example.com/",
	});
	// Not a Request, whatever it claims: it's read as fetch reads it, as a
	// string, and never as the URL it names.
	const lookalike = { url: "https://api.example.com/me" };
	await authFetch(lookalike as unknown as Request);
	assert.deepEqual(sent, ["https://api.example.com/[object%20Object]"]);
	for (const missing of [null, undefined])
		await assert.rejects(
			authFetch(missing as unknown as string),
			code("INVALID_OPTIONS"),
		);
	assert.equal(sent.length, 1);
});

test("axios can take authFetch through its fetch adapter", async () => {
	let issued = 1;
	const auth = client({
		refresh: async () => ({ accessToken: `access-${++issued}` }),
	});
	await auth.signIn(input());
	const statuses = [401, 200, 401];
	const sent: string[] = [];
	setGlobal("fetch", async (request: Request) => {
		sent.push(`${request.method} ${request.headers.get("Authorization")}`);
		const status = statuses.shift() ?? 500;
		return new Response(status === 200 ? JSON.stringify({ id: 1 }) : null, {
			status,
			headers: { "Content-Type": "application/json" },
		});
	});
	const http = axios.create({
		baseURL: "https://api.example.com/",
		adapter: "fetch",
		env: {
			fetch: createAuthFetch(auth, { baseUrl: "https://api.example.com/" }),
		},
	});
	assert.deepEqual((await http.get("me")).data, { id: 1 });
	// A write gets the 401 back, after the refresh, and isn't sent twice.
	await assert.rejects(
		http.post("change", { quantity: 1 }),
		(error: unknown) =>
			axios.isAxiosError(error) && error.response?.status === 401,
	);
	assert.deepEqual(sent, [
		"GET Bearer access-1",
		"GET Bearer access-2",
		"POST Bearer access-2",
	]);

	// axios wraps what its fetch rejects with: the code is kept, and the
	// AuthError is the cause.
	const wraps = (expected: string) => (error: unknown) =>
		axios.isAxiosError(error) &&
		error.code === expected &&
		error.cause instanceof AuthError;
	await assert.rejects(
		http.get("https://evil.example/me"),
		wraps("INVALID_OPTIONS"),
	);
	await auth.signOut();
	await assert.rejects(http.get("me"), wraps("UNAUTHENTICATED"));
	assert.equal(sent.length, 3);
});
