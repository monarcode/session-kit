import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
	createAuth,
	createMirrorAuth,
	memoryStorage,
	type MirrorAuth,
	type Session,
} from "@monarcode/session-kit";
import { createServerAuth } from "@monarcode/session-kit/server";
import {
	connectSession,
	loadSession,
} from "@monarcode/session-kit/tanstack-start";
import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import {
	createServerEntry,
	getResponseHeaders,
} from "@tanstack/react-start/server";

import { code, SECRET, user, userSchema } from "./helpers.ts";

type User = typeof user;

const alice: Session<User> = { sessionId: "s1", user };

const serverAuth = createServerAuth({
	name: "app",
	user: userSchema,
	secret: SECRET,
});

/** Handles one request in Start's request scope, returning `work`'s result and the cookies it set. */
async function handle<T>(cookie: string, work: () => Promise<T>) {
	let result!: T;
	const entry = createServerEntry({
		fetch: async () => {
			result = await work();
			const headers = new Headers();
			for (const line of getResponseHeaders().getSetCookie())
				headers.append("set-cookie", line);
			return new Response(null, { headers });
		},
	});
	const response = await entry.fetch(
		new Request("https://app.test/", { headers: { cookie } }),
	);
	return { result, setCookies: response.headers.getSetCookie() };
}

/** The `name=value` pairs of `setCookies`, as a browser would send them back. */
const cookieHeader = (setCookies: string[]) =>
	setCookies.map((line) => line.split(";")[0]).join("; ");

test("startJar throws INVALID_OPTIONS outside a request", () => {
	assert.throws(() => startJar(), code("INVALID_OPTIONS"));
});

test("startJar reads and sets cookies through Start, one jar per request", async () => {
	const signedIn = await handle("", async () => {
		const jar = startJar();
		assert.equal(startJar(), jar);
		return serverAuth.signIn(jar, {
			accessToken: "access-1",
			refreshToken: "refresh-1",
			expiresIn: 900,
			user,
		});
	});
	assert.equal(signedIn.setCookies.length, 1);
	assert.match(signedIn.setCookies[0]!, /^app\.session=1\./);
	assert.match(signedIn.setCookies[0]!, /HttpOnly/);
	assert.match(signedIn.setCookies[0]!, /Secure/);
	assert.match(signedIn.setCookies[0]!, /SameSite=Lax/);

	let first: unknown;
	const next = await handle(cookieHeader(signedIn.setCookies), async () => {
		first = startJar();
		return serverAuth.getSession(startJar());
	});
	assert.deepEqual(next.result, signedIn.result);
	await handle("", async () => assert.notEqual(startJar(), first));

	const signedOut = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.signOut(startJar()),
	);
	assert.match(signedOut.setCookies[0]!, /^app\.session=; Max-Age=0/);
});

test("startJar sets and deletes every chunk of a large session", async () => {
	const signedIn = await handle("", () =>
		serverAuth.signIn(startJar(), {
			accessToken: "a".repeat(5000),
			refreshToken: "refresh-1",
			expiresIn: 900,
			user,
		}),
	);
	assert.deepEqual(
		signedIn.setCookies.map((line) => line.split("=")[0]).sort(),
		["app.session", "app.session.0", "app.session.1"],
	);
	assert.ok(
		signedIn.setCookies.some((line) => line.startsWith("app.session=c2;")),
	);

	const read = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.getSession(startJar()),
	);
	assert.deepEqual(read.result, signedIn.result);

	const signedOut = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.signOut(startJar()),
	);
	assert.deepEqual(
		signedOut.setCookies
			.filter((line) => /Max-Age=0/.test(line))
			.map((line) => line.split("=")[0])
			.sort(),
		["app.session", "app.session.0", "app.session.1"],
	);
});

/** The app's own data, beside the session, as TanStack Query's would be. */
type Own = { theme: string };

/**
 * A router as Start's `getRouter` makes it, connected, with the calls Start
 * makes to send its data with the page and to read it in the browser.
 */
async function startRouter(
	t: TestContext,
	auth: MirrorAuth<User>,
	isServer: boolean,
	own: Partial<{
		dehydrate: () => Own;
		hydrate: (data: Own) => void;
	}> = {},
) {
	const { createRouter, createRootRouteWithContext, createMemoryHistory } =
		await import("@tanstack/react-router");
	const router = createRouter({
		routeTree: createRootRouteWithContext<{ auth: MirrorAuth<User> }>()(),
		context: { auth },
		history: createMemoryHistory(),
		origin: "https://app.test",
		isServer,
		...own,
	});
	t.after(connectSession(router));
	const { options } = router;
	return {
		router,
		dehydrate: async () => options.dehydrate?.call(options),
		// A copy, as the page carries it.
		hydrate: async (data: unknown) =>
			(options.hydrate as ((data: unknown) => unknown) | undefined)?.call(
				options,
				structuredClone(data),
			),
	};
}

test("connectSession carries the session without running guards again", async (t) => {
	const reads: string[] = [];
	const otherTab = createMirrorAuth({
		name: "hydration",
		session: null,
		revalidate: async () => {
			reads.push("other tab");
			return alice;
		},
		signOut: async () => {},
	});
	t.after(otherTab.mount());

	const server = createMirrorAuth({ ...options(), session: null });
	const page = await startRouter(t, server, true);
	await loadSession(server);
	const sent = await page.dehydrate();
	// The page carries the session and nothing else: no tokens.
	assert.deepEqual(sent, {
		sessionKit: { loaded: true, session: alice },
		app: undefined,
	});

	const browser = createMirrorAuth({ ...options(), session: null });
	const before = browser.state.get().version;
	await (await startRouter(t, browser, false)).hydrate(sent);
	assert.equal(browser.state.get().status, "authenticated");
	assert.deepEqual(browser.state.get().user, user);
	assert.equal(browser.state.get().version, before);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(reads, []);
});

test("connectSession keeps the router's own dehydrate and hydrate", async (t) => {
	const server = createMirrorAuth({ ...options(), session: null });
	const page = await startRouter(t, server, true, {
		dehydrate: () => ({ theme: "dark" }),
	});
	await loadSession(server);
	const sent = await page.dehydrate();
	assert.deepEqual(sent, {
		sessionKit: { loaded: true, session: alice },
		app: { theme: "dark" },
	});

	const received: Own[] = [];
	const browser = createMirrorAuth({ ...options(), session: null });
	const app = await startRouter(t, browser, false, {
		hydrate: (data) => received.push(data),
	});
	await app.hydrate(sent);
	assert.deepEqual(received, [{ theme: "dark" }]);
	assert.equal(browser.state.get().sessionId, "s1");

	// Connecting again neither wraps the options twice nor connects twice.
	const disconnect = connectSession(app.router);
	assert.equal(connectSession(app.router), disconnect);
	await app.hydrate(sent);
	assert.deepEqual(received, [{ theme: "dark" }, { theme: "dark" }]);
});

test("connectSession throws INVALID_OPTIONS without a browser client of a server-rendered app", async (t) => {
	const { createRouter, createRootRouteWithContext } =
		await import("@tanstack/react-router");
	const client = createAuth({
		name: "hydration",
		user: userSchema,
		storage: memoryStorage(),
	});
	const router = createRouter({
		routeTree: createRootRouteWithContext<{ auth: typeof client }>()(),
		context: { auth: client },
		isServer: true,
	});
	// @ts-expect-error The types refuse it too, but JavaScript doesn't.
	assert.throws(() => connectSession(router), code("INVALID_OPTIONS"));
	// Nothing was changed.
	assert.equal(router.options.dehydrate, undefined);

	const withoutContext = createRouter({
		routeTree: createRootRouteWithContext<object>()(),
		isServer: true,
	});
	assert.throws(
		// @ts-expect-error No context, so no client.
		() => connectSession(withoutContext),
		code("INVALID_OPTIONS"),
	);
	void t;
});

function options() {
	return {
		name: "hydration",
		revalidate: async () => alice,
		signOut: async () => {},
	};
}

/** Makes `loadSession` see a browser until the test ends. */
function inBrowser(t: TestContext) {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {},
	});
	t.after(() => {
		delete (globalThis as { document?: unknown }).document;
	});
}

test("the browser reads a session the server didn't load", async (t) => {
	let reads = 0;
	let down = true;
	const make = () =>
		createMirrorAuth({
			...options(),
			session: null,
			revalidate: async () => {
				reads++;
				if (down) throw new Error("The backend is down");
				return alice;
			},
		});
	const failed = make();
	const failedPage = await startRouter(t, failed, true);
	await assert.rejects(loadSession(failed));
	const skipped = make();
	const skippedPage = await startRouter(t, skipped, true);
	const sent = await failedPage.dehydrate();
	assert.deepEqual(sent, {
		sessionKit: { loaded: false, session: null },
		app: undefined,
	});
	for (const page of [failedPage, skippedPage])
		assert.deepEqual(await page.dehydrate(), sent);

	// Made before `document` exists: the router reads more of the browser's
	// globals when it does.
	const browser = make();
	const browserPage = await startRouter(t, browser, false);
	const nothing = make();
	const nothingPage = await startRouter(t, nothing, false);
	inBrowser(t);
	down = false;
	await browserPage.hydrate(sent);
	assert.equal(browser.state.get().sessionId, null);
	await loadSession(browser);
	await loadSession(browser);
	assert.equal(reads, 2);
	assert.equal(browser.state.get().sessionId, "s1");

	// Nothing sent at all, as from a root route that didn't render on the
	// server: the client is left as it is.
	await nothingPage.hydrate(undefined);
	assert.equal(nothing.state.get().sessionId, null);
});

test("loadSession reads on the server every time, in the browser only without hydration", async (t) => {
	let reads = 0;
	const make = () =>
		createMirrorAuth({
			...options(),
			session: null,
			revalidate: async () => {
				reads++;
				return alice;
			},
		});
	const server = make();
	await loadSession(server);
	await loadSession(server);
	assert.equal(reads, 2);
	assert.equal(server.state.get().sessionId, "s1");

	const page = await startRouter(t, server, true);
	const sent = await page.dehydrate();

	const hydrated = make();
	const hydratedPage = await startRouter(t, hydrated, false);
	inBrowser(t);
	await hydratedPage.hydrate(sent);
	await loadSession(hydrated);
	assert.equal(reads, 2);

	const clientOnly = make();
	await loadSession(clientOnly);
	await loadSession(clientOnly);
	assert.equal(reads, 3);
});
