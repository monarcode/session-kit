import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createElement as h, useState } from "react";

import {
	createMirrorAuth,
	type MirrorAuth,
	type Session,
} from "@monarcode/session-kit";
import {
	nextJar,
	proxyJar,
	type NextCookies,
} from "@monarcode/session-kit/next";
import { createServerAuth } from "@monarcode/session-kit/server";
import { NextRequest, NextResponse } from "next/server.js";

import { act, render, settle, useDom } from "./dom.ts";
import { code, deferred, user, userSchema } from "./helpers.ts";

type User = typeof user;

let refreshes = 0;
const serverAuth = createServerAuth({
	name: "app",
	user: userSchema,
	secret: "a-test-secret-that-is-at-least-32-chars",
	refresh: async () => {
		refreshes++;
		return {
			accessToken: "access-2",
			refreshToken: "refresh-2",
			expiresIn: 900,
		};
	},
});

const tokens = (overrides: object = {}) => ({
	accessToken: "access-1",
	refreshToken: "refresh-1",
	expiresIn: 900,
	user,
	...overrides,
});

/** A request carrying the cookies `response` set, as a browser sends them. */
const nextRequest = (response?: NextResponse) =>
	new NextRequest("https://app.test/", {
		headers: {
			cookie: (response?.headers.getSetCookie() ?? [])
				.map((line) => line.split(";")[0])
				.join("; "),
		},
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

const deleted = (response: NextResponse) =>
	response.headers
		.getSetCookie()
		.filter((line) => /Expires=Thu, 01 Jan 1970/.test(line))
		.map((line) => line.split("=")[0])
		.sort();

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

test("proxyJar refreshes in Proxy, and Next passes the new cookie to the render", async () => {
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
	// What Next merges into `cookies()` for the Server Components.
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

useDom();

type Hook = typeof import("@monarcode/session-kit/next/client");
let hook: Hook;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime.js").AppRouterContext;

beforeEach(async () => {
	hook = await import("@monarcode/session-kit/next/client");
	({ AppRouterContext } =
		await import("next/dist/shared/lib/app-router-context.shared-runtime.js"));
});

const alice: Session<User> = { sessionId: "s1", user };
const bob: Session<User> = {
	sessionId: "s2",
	user: { ...user, id: "bob", email: "bob@example.com" },
};

/**
 * Renders `useMirrorAuth` as a layout would, under a router whose refreshes
 * it counts, and returns a way to render the server's next session.
 */
async function mount(
	initial: Session<User> | null,
	revalidate: () => Promise<Session<User> | null> = async () => null,
) {
	const router = { refreshes: 0, created: 0 };
	let client!: MirrorAuth<User>;
	let serverRenders!: (session: Session<User> | null) => void;
	function Providers() {
		const [session, setSession] = useState(initial);
		serverRenders = setSession;
		client = hook.useMirrorAuth((first) => {
			router.created++;
			return createMirrorAuth({
				name: "next-test",
				session: first,
				revalidate,
				signOut: async () => {},
			});
		}, session);
		return null;
	}
	const appRouter = { refresh: () => router.refreshes++ };
	await render(
		h(AppRouterContext.Provider, { value: appRouter as never }, h(Providers)),
	);
	return {
		router,
		client: () => client,
		async serverRender(session: Session<User> | null) {
			await act(async () => serverRenders(session));
			await settle();
		},
	};
}

test("useMirrorAuth creates the client once and follows the server's session", async () => {
	const app = await mount(alice);
	assert.equal(app.client().state.get().sessionId, "s1");
	const version = app.client().state.get().version;

	await app.serverRender(bob);
	assert.equal(app.client().state.get().sessionId, "s2");
	assert.equal(app.client().state.get().version, version + 1);
	await app.serverRender(structuredClone(bob));
	await app.serverRender(null);
	assert.equal(app.client().state.get().status, "unauthenticated");
	assert.equal(app.router.created, 1);
	assert.equal(app.router.refreshes, 0);
});

test("useMirrorAuth refreshes the router when the browser's session changes", async () => {
	const app = await mount(alice);
	await act(async () => app.client().adopt(null));
	await settle();
	assert.equal(app.router.refreshes, 1);
	// The server catches up: nothing more to do.
	await app.serverRender(null);
	assert.equal(app.router.refreshes, 1);

	await act(async () => app.client().adopt(alice));
	await settle();
	assert.equal(app.router.refreshes, 2);
	await app.serverRender(alice);

	await act(async () =>
		app
			.client()
			.adopt({ ...alice, user: { ...user, email: "new@example.com" } }),
	);
	await settle();
	assert.equal(app.router.refreshes, 3);
});

test("useMirrorAuth keeps a revalidation when the server renders the same session", async () => {
	const answer = deferred<Session<User> | null>();
	const app = await mount(alice, () => answer.promise);
	let revalidated: Promise<unknown> | undefined;
	await act(async () => {
		revalidated = app.client().retry();
	});
	await app.serverRender(structuredClone(alice));
	answer.resolve(bob);
	await act(async () => {
		await revalidated;
	});
	assert.equal(app.client().state.get().sessionId, "s2");
});

test("useMirrorAuth refreshes the router after a sign-out in another tab", async () => {
	let server: Session<User> | null = alice;
	const app = await mount(alice, async () => server);
	const unmount = app.client().mount();
	const otherTab = createMirrorAuth({
		name: "next-test",
		session: alice,
		revalidate: async () => server,
		signOut: async () => {
			server = null;
		},
	});
	try {
		await otherTab.signOut();
		for (let turn = 0; turn < 5 && app.router.refreshes === 0; turn++)
			await settle();
		assert.equal(app.client().state.get().status, "unauthenticated");
		assert.equal(app.router.refreshes, 1);
	} finally {
		unmount();
	}
});
