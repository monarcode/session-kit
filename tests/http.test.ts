import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuthFetch } from "@monarcode/session-kit/http";

import {
	input,
	client,
	code,
	credentialsOf,
	setGlobal,
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
