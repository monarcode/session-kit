import assert from "node:assert/strict";
import { test } from "node:test";

import {
	nextJar,
	nextSession,
	proxyJar,
	sessionRoute,
	type NextCookies,
} from "@monarcode/session-kit/next";
import { createServerAuth } from "@monarcode/session-kit/server";
import { NextRequest, NextResponse } from "next/server.js";

import {
	code,
	cookieHeader,
	deleted,
	SECRET,
	tokens,
	userSchema,
} from "./helpers.ts";

let refreshes = 0;
const serverAuth = createServerAuth({
	name: "app",
	user: userSchema,
	secret: SECRET,
	refresh: async () => {
		refreshes++;
		return {
			accessToken: "access-2",
			refreshToken: "refresh-2",
			expiresIn: 900,
		};
	},
});

/** A request carrying the cookies `response` set, as a browser sends them. */
const nextRequest = (response?: NextResponse) =>
	new NextRequest("https://app.test/", {
		headers: { cookie: response ? cookieHeader(response) : "" },
	});

/**
 * The cookie store `cookies()` gives a Server Function: it reads `request`'s
 * cookies and sets `response`'s.
 */
function actionStore(request: NextRequest, response: NextResponse) {
	for (const { name, value } of request.cookies.getAll())
		response.cookies.set(name, value);
	response.headers.delete("set-cookie");
	return response.cookies as unknown as NextCookies;
}

test("nextJar is read-only unless writable, with one jar per store and mode", async () => {
	const response = NextResponse.next();
	const store = actionStore(nextRequest(), response);
	const readOnly = nextJar(store);
	assert.equal(readOnly.writable, false);
	assert.equal(nextJar(store), readOnly);
	const writable = nextJar(store, { writable: true });
	assert.equal(writable.writable, true);
	assert.notEqual(writable, readOnly);
	assert.equal(nextJar(store, { writable: true }), writable);

	await assert.rejects(
		serverAuth.signIn(readOnly, tokens()),
		code("INVALID_OPTIONS"),
	);
	const session = await serverAuth.signIn(writable, tokens());
	const [line] = response.headers.getSetCookie();
	assert.match(line!, /^app\.session=1\./);
	assert.match(line!, /HttpOnly/);
	assert.match(line!, /Secure/);
	assert.match(line!, /SameSite=lax/i);
	assert.match(line!, /Path=\//);

	const page = nextRequest(response).cookies as unknown as NextCookies;
	assert.deepEqual(await serverAuth.getSession(nextJar(page)), session);

	const signingOut = NextResponse.next();
	await serverAuth.signOut(
		nextJar(actionStore(nextRequest(response), signingOut), {
			writable: true,
		}),
	);
	assert.deepEqual(deleted(signingOut), ["app.session"]);
});

test("a read-only nextJar sees a sign-in through the writable jar for its store", async () => {
	const store = actionStore(nextRequest(), NextResponse.next());
	assert.equal(await serverAuth.getSession(nextJar(store)), null);
	const session = await serverAuth.signIn(
		nextJar(store, { writable: true }),
		tokens(),
	);
	assert.deepEqual(await serverAuth.getSession(nextJar(store)), session);
	assert.equal(
		(await serverAuth.credentials.get(nextJar(store)))?.accessToken,
		"access-1",
	);
});

test("nextJar deletes every chunk of a large session", async () => {
	const response = NextResponse.next();
	await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), response), { writable: true }),
		tokens({ accessToken: "a".repeat(5000) }),
	);
	assert.equal(response.headers.getSetCookie().length, 3);

	const signingOut = NextResponse.next();
	await serverAuth.signOut(
		nextJar(actionStore(nextRequest(response), signingOut), {
			writable: true,
		}),
	);
	assert.deepEqual(deleted(signingOut), [
		"app.session",
		"app.session.0",
		"app.session.1",
	]);
});

test("proxyJar refreshes in Proxy, and sets the cookie for the browser and, through Next's header, for the render", async () => {
	const signedIn = NextResponse.next();
	await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), signedIn), { writable: true }),
		// Expires within `refreshIfDue`'s default window.
		tokens({ expiresIn: 30 }),
	);

	refreshes = 0;
	const request = nextRequest(signedIn);
	const response = NextResponse.next();
	const jar = proxyJar(request, response);
	assert.equal(proxyJar(request, response), jar);
	assert.equal(jar.writable, true);
	await serverAuth.refreshIfDue(jar);
	assert.equal(refreshes, 1);
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	// The header Next merges into `cookies()` for the Server Components; the
	// render's request below stands in for that merge.
	assert.match(
		response.headers.get("x-middleware-set-cookie") ?? "",
		/^app\.session=1\./,
	);

	const page = nextRequest(response).cookies as unknown as NextCookies;
	const credentials = await serverAuth.credentials.get(nextJar(page));
	assert.equal(credentials?.accessToken, "access-2");
	assert.equal(refreshes, 1);
});

test("proxyJar sets no cookie for a signed-out request", async () => {
	const response = NextResponse.next();
	await serverAuth.refreshIfDue(proxyJar(nextRequest(), response));
	assert.deepEqual(response.headers.getSetCookie(), []);
});

test("a read-only nextJar never refreshes an expired token", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const signedIn = NextResponse.next();
	await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), signedIn), { writable: true }),
		tokens(),
	);
	t.mock.timers.tick(901_000);
	refreshes = 0;
	const page = nextRequest(signedIn).cookies as unknown as NextCookies;
	await assert.rejects(
		serverAuth.credentials.get(nextJar(page)),
		code("REFRESH_FAILED"),
	);
	assert.equal(refreshes, 0);
});

test("a read-only nextJar's forRequest follows a sign-in through the writable jar", async () => {
	const store = actionStore(nextRequest(), NextResponse.next());
	const render = serverAuth.forRequest(nextJar(store));
	assert.equal(await render.getSession(), null);
	const session = await serverAuth.signIn(
		nextJar(store, { writable: true }),
		tokens(),
	);
	assert.equal(render.state.get().sessionId, session.sessionId);
	assert.equal(render.isCurrent(session), true);
	assert.deepEqual(await render.getSession(), session);
});

test("a read-only view keeps its session until the writable jar has one, and reports its changes", async () => {
	const response = NextResponse.next();
	const session = await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), response), { writable: true }),
		tokens(),
	);
	const store = actionStore(nextRequest(response), NextResponse.next());
	const render = serverAuth.forRequest(nextJar(store));
	assert.deepEqual(await render.getSession(), session);
	const seen: Array<string | null> = [];
	const { unsubscribe } = render.state.subscribe((state) =>
		seen.push(state.sessionId),
	);

	// The writable jar's client exists but hasn't read the cookie yet.
	const action = serverAuth.forRequest(nextJar(store, { writable: true }));
	assert.equal(action.state.get().status, "initializing");
	assert.equal(render.state.get().status, "authenticated");
	assert.equal(render.isCurrent(session), true);

	await action.signOut();
	assert.equal(render.state.get().status, "unauthenticated");
	assert.equal(render.isCurrent(session), false);
	assert.deepEqual(seen, [null]);
	unsubscribe();
});

test("a read-only view's version only grows when it moves to the writable jar's session", async () => {
	const store = actionStore(nextRequest(), NextResponse.next());
	const render = serverAuth.forRequest(nextJar(store));
	assert.equal(await render.getSession(), null);
	const signedOut = render.state.get();
	assert.equal(render.state.get(), signedOut);
	await serverAuth.signIn(nextJar(store, { writable: true }), tokens());
	const signedIn = render.state.get();
	assert.equal(signedIn.status, "authenticated");
	assert.ok(signedIn.version > signedOut.version);
});

test("a read-only view's renew returns a token the writable jar already renewed", async () => {
	const response = NextResponse.next();
	await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), response), { writable: true }),
		tokens(),
	);
	const store = actionStore(nextRequest(response), NextResponse.next());
	const render = serverAuth.forRequest(nextJar(store));
	const first = await render.credentials.get();
	assert.equal(first?.accessToken, "access-1");
	const renewed = await serverAuth.credentials.renew(
		nextJar(store, { writable: true }),
		first!,
	);
	assert.equal(renewed?.accessToken, "access-2");
	assert.equal(
		(await render.credentials.renew(first!))?.accessToken,
		"access-2",
	);
	// With nothing newer to give, it still can't renew.
	await assert.rejects(
		render.credentials.renew(renewed!),
		code("REFRESH_FAILED"),
	);
});

/** What Next's `redirect` throws, standing in for it. */
class Redirect extends Error {
	readonly location: string;
	constructor(location: string) {
		super(`Redirect to ${location}`);
		this.location = location;
	}
}
const redirect = (url: string): never => {
	throw new Redirect(url);
};
const redirected = (location: string) => (error: unknown) =>
	error instanceof Redirect && error.location === location;

test("nextSession reads and guards for Server Components, and writes for Server Functions", async () => {
	const response = NextResponse.next();
	const store = actionStore(nextRequest(), response);
	const session = nextSession(serverAuth, {
		cookies: async () => store,
		redirect,
	});

	assert.equal(await session.get(), null);
	await assert.rejects(
		session.require("/orders?page=2"),
		redirected("/login?redirectTo=%2Forders%3Fpage%3D2"),
	);
	await session.redirectIfSignedIn("/orders");
	await assert.rejects(
		(await session.readOnly()).signIn(tokens()),
		code("INVALID_OPTIONS"),
	);

	const signedIn = await (await session.writable()).signIn(tokens());
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	assert.deepEqual(await session.get(), signedIn);
	assert.deepEqual(await session.require("/orders"), signedIn);
	assert.equal(
		(await (await session.readOnly()).credentials.get())?.accessToken,
		"access-1",
	);
	await assert.rejects(
		session.redirectIfSignedIn("/orders"),
		redirected("/orders"),
	);
	await assert.rejects(
		session.redirectIfSignedIn("https://evil.test/"),
		redirected("/"),
	);
	await assert.rejects(session.redirectIfSignedIn("/login"), redirected("/"));
});

test("nextSession's guards use loginPath, and bad options throw", async () => {
	const store = actionStore(nextRequest(), NextResponse.next());
	const cookies = async () => store;
	const session = nextSession(serverAuth, {
		cookies,
		redirect,
		loginPath: "/sign-in",
	});
	await assert.rejects(
		session.require("/sign-in"),
		redirected("/sign-in?redirectTo=%2F"),
	);
	assert.throws(
		() => nextSession(serverAuth, {} as never),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() => nextSession(serverAuth, { cookies, redirect, loginPath: "login" }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() => nextSession(serverAuth, { cookies, redirect, within: -1 }),
		code("INVALID_OPTIONS"),
	);
});

test("nextSession's refresh refreshes in Proxy and resolves the response", async () => {
	const signedIn = NextResponse.next();
	await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), signedIn), { writable: true }),
		tokens({ expiresIn: 30 }),
	);
	const cookies = async () => actionStore(nextRequest(), NextResponse.next());

	refreshes = 0;
	const early = NextResponse.next();
	const later = nextSession(serverAuth, { cookies, redirect, within: 10 });
	assert.equal(await later.refresh(nextRequest(signedIn), early), early);
	assert.equal(refreshes, 0);
	assert.deepEqual(early.headers.getSetCookie(), []);

	const response = NextResponse.next();
	const session = nextSession(serverAuth, { cookies, redirect });
	assert.equal(
		await session.refresh(nextRequest(signedIn), response),
		response,
	);
	assert.equal(refreshes, 1);
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);

	const failing = createServerAuth({
		name: "app",
		user: userSchema,
		secret: SECRET,
		refresh: async () => {
			throw new Error("backend down");
		},
	});
	const kept = NextResponse.next();
	assert.equal(
		await nextSession(failing, { cookies, redirect }).refresh(
			nextRequest(signedIn),
			kept,
		),
		kept,
	);
});

test("sessionRoute answers the browser client in a Route Handler, setting cookies", async () => {
	const signedIn = NextResponse.next();
	const session = await serverAuth.signIn(
		nextJar(actionStore(nextRequest(), signedIn), { writable: true }),
		tokens(),
	);
	const response = NextResponse.next();
	const store = actionStore(nextRequest(signedIn), response);
	const { GET, POST } = sessionRoute(serverAuth, async () => store);
	const toRoute = (method: string, body?: object) =>
		new Request("https://app.test/api/session", {
			method,
			headers: { "Sec-Fetch-Site": "same-origin" },
			...(body && { body: JSON.stringify(body) }),
		});

	const read = await GET(toRoute("GET"));
	assert.deepEqual((await read.json()).session, session);
	const signedOut = await POST(toRoute("POST", { v: 1, action: "signOut" }));
	assert.equal(signedOut.status, 200);
	assert.deepEqual(deleted(response), ["app.session"]);
	assert.throws(
		() => sessionRoute(serverAuth, undefined as never),
		code("INVALID_OPTIONS"),
	);
});
