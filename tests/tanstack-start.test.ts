import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
	createAuth,
	createMirrorAuth,
	memoryStorage,
	type MirrorAuth,
	type Session,
} from "@monarcode/session-kit";
import { Auth } from "@monarcode/session-kit/effect";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { createServerAuth } from "@monarcode/session-kit/server";
import {
	connectSession,
	loadSession,
} from "@monarcode/session-kit/tanstack-start";
import {
	refreshSession,
	sessionRoute,
	startAuth,
	startJar,
} from "@monarcode/session-kit/tanstack-start/server";
import {
	createServerEntry,
	getResponseHeaders,
	setResponseHeader,
} from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";

import { code, deferred, SECRET, tokens, user, userSchema } from "./helpers.ts";

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

// Made once, at module level, as an app does.
const session = startAuth(serverAuth);

test("startAuth finds each request's session, and rejects outside a request", async () => {
	await assert.rejects(session.getSession(), code("INVALID_OPTIONS"));
	await assert.rejects(session.credentials.get(), code("INVALID_OPTIONS"));
	assert.throws(() => session.state.get(), code("INVALID_OPTIONS"));
	assert.ok(Object.isFrozen(session));

	const signedIn = await handle("", () => session.signIn(tokens()));
	assert.match(signedIn.setCookies[0]!, /^app\.session=1\./);
	const cookie = cookieHeader(signedIn.setCookies);

	const read = await handle(cookie, async () => {
		const current = await session.getSession();
		assert.equal(session.isCurrent(current!), true);
		assert.equal(session.state.get().sessionId, current!.sessionId);
		return current;
	});
	assert.deepEqual(read.result, signedIn.result);
	assert.equal((await handle("", () => session.getSession())).result, null);

	const updated = await handle(cookie, () =>
		session.updateUser({ ...user, role: "admin" }),
	);
	assert.equal(updated.result.user.role, "admin");

	const signedOut = await handle(cookieHeader(updated.setCookies), () =>
		session.signOut(),
	);
	assert.match(signedOut.setCookies[0]!, /^app\.session=; Max-Age=0/);
});

/** A server engine whose backend answers refreshes with `answer()`. */
function refreshingAuth(answer: () => Promise<object>) {
	let refreshes = 0;
	const app = createServerAuth({
		name: "app",
		user: userSchema,
		secret: SECRET,
		refresh: async () => {
			refreshes++;
			return (await answer()) as never;
		},
	});
	return { app, refreshes: () => refreshes };
}

/**
 * Runs a request middleware's server function, as Start does for a page,
 * with `respond` standing in for the routes after it.
 */
async function runMiddleware<T>(
	middleware: ReturnType<typeof refreshSession>,
	respond: () => Promise<T>,
	response = new Response("ok"),
) {
	let value!: T;
	const next = async () => {
		value = await respond();
		return { response };
	};
	const result = (await middleware({ next } as never)) as unknown as {
		response: Response;
	};
	assert.equal(result.response, response);
	return value;
}

test("refreshSession refreshes before the request and marks the response private", async () => {
	const { app, refreshes } = refreshingAuth(async () => ({
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresIn: 900,
	}));
	const signedIn = await handle("", () =>
		startAuth(app).signIn(tokens({ expiresIn: 30 })),
	);
	const middleware = refreshSession(app);
	const { result, setCookies } = await handle(
		cookieHeader(signedIn.setCookies),
		async () => {
			const next = await runMiddleware(middleware, async () => {
				const credentials = await startAuth(app).credentials.get();
				return credentials!.accessToken;
			});
			return {
				next,
				cacheControl: getResponseHeaders().get("cache-control"),
			};
		},
	);
	assert.deepEqual(result, {
		next: "access-2",
		cacheControl: "private, no-store",
	});
	assert.equal(refreshes(), 1);
	assert.match(setCookies[0]!, /^app\.session=1\./);
});

test("refreshSession takes the header's value or leaves it alone, and a failed refresh doesn't fail the request", async () => {
	const { app, refreshes } = refreshingAuth(() =>
		Promise.reject(new Error("backend down")),
	);
	const signedIn = await handle("", () =>
		startAuth(app).signIn(tokens({ expiresIn: 30 })),
	);
	const cookie = cookieHeader(signedIn.setCookies);
	const header = (
		middleware: ReturnType<typeof refreshSession>,
		respond: () => Promise<void> = async () => {},
		response?: Response,
	) =>
		handle(cookie, async () => {
			await runMiddleware(middleware, respond, response);
			return getResponseHeaders().get("cache-control");
		});
	assert.equal(
		(
			await header(
				refreshSession(app, { cacheControl: "private, max-age=0" }),
			)
		).result,
		"private, max-age=0",
	);
	assert.equal(refreshes(), 1);
	assert.equal(
		(await header(refreshSession(app, { cacheControl: false }))).result,
		null,
	);
	assert.equal(
		(await header(refreshSession(app, { within: 10 }))).result,
		"private, no-store",
	);

	// A route's own header stays, from its response or Start's helpers.
	const own = new Response("ok", {
		headers: { "Cache-Control": "public, max-age=60" },
	});
	assert.equal(
		(await header(refreshSession(app), async () => {}, own)).result,
		null,
	);
	assert.equal(
		(
			await header(refreshSession(app), async () => {
				setResponseHeader("Cache-Control", "public, max-age=60");
			})
		).result,
		"public, max-age=60",
	);

	assert.throws(
		() => refreshSession(app, { within: -1 }),
		code("INVALID_OPTIONS"),
	);
});

test("sessionRoute's handlers answer the browser client through Start's cookies", async () => {
	const route = sessionRoute(serverAuth);
	const toRoute = (method: string, body?: object) =>
		new Request("https://app.test/api/session", {
			method,
			headers: { "Sec-Fetch-Site": "same-origin" },
			...(body && { body: JSON.stringify(body) }),
		});
	const signedIn = await handle("", () => session.signIn(tokens()));
	const cookie = cookieHeader(signedIn.setCookies);

	const read = await handle(cookie, async () =>
		(await route.GET({ request: toRoute("GET") })).json(),
	);
	assert.deepEqual(read.result, { v: 1, session: signedIn.result });
	const signedOut = await handle(
		cookie,
		async () =>
			(
				await route.POST({
					request: toRoute("POST", { v: 1, action: "signOut" }),
				})
			).status,
	);
	assert.equal(signedOut.result, 200);
	assert.match(signedOut.setCookies[0]!, /^app\.session=; Max-Age=0/);
});

test("startAuth has every member a request's session has, passed through", async () => {
	const app = createServerAuth({
		name: "app",
		user: userSchema,
		secret: SECRET,
		clientCredentials: true,
		refresh: async () => ({
			accessToken: `access-${++refreshes}`,
			expiresIn: 900,
		}),
	});
	let refreshes = 1;
	const lazy = startAuth(app);
	const signedIn = await handle("", () => lazy.signIn(tokens()));
	const { result } = await handle(
		cookieHeader(signedIn.setCookies),
		async () => {
			const view = app.forRequest(startJar());
			const keys = (value: object) => Object.keys(value).sort();
			assert.deepEqual(keys(lazy), keys(view));
			for (const member of [
				"credentials",
				"clientCredentials",
				"state",
			] as const)
				assert.deepEqual(keys(lazy[member]), keys(view[member]));

			assert.deepEqual(await lazy.refreshIfDue(), signedIn.result);
			const credentials = await lazy.credentials.get();
			const renewed = await lazy.credentials.renew(credentials!);
			assert.equal(renewed?.accessToken, "access-2");
			const forBrowser = await lazy.clientCredentials.get();
			assert.equal(forBrowser?.accessToken, "access-2");
			assert.equal(
				(await lazy.clientCredentials.renew(forBrowser!))?.accessToken,
				"access-3",
			);
			const seen: string[] = [];
			const { unsubscribe } = lazy.state.subscribe((state) =>
				seen.push(state.status),
			);
			await lazy.credentials.reject((await lazy.credentials.get())!);
			unsubscribe();
			assert.ok(seen.includes("unauthenticated"));
			return view.state.get().sessionId;
		},
	);
	assert.equal(result, null);
});

test("Auth.layer binds a startAuth session to the request that's current", async () => {
	assert.throws(() => Auth.layer(session), code("INVALID_OPTIONS"));
	const signedIn = await handle("", () => session.signIn(tokens()));
	const read = await handle(cookieHeader(signedIn.setCookies), () =>
		Effect.runPromise(Effect.provide(Auth.session, Auth.layer(session))),
	);
	assert.deepEqual(read.result, signedIn.result);
});

test("one module-level createAuthFetch over startAuth sends each request's own token", async (t) => {
	const alice = await handle("", () =>
		session.signIn(tokens({ accessToken: "alice-token" })),
	);
	const bob = await handle("", () =>
		session.signIn(
			tokens({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
		),
	);
	const authFetch = createAuthFetch(session, { baseUrl: "https://api.test" });

	// Both requests are in flight before either answers.
	const bothSent = deferred();
	let sent = 0;
	t.mock.method(globalThis, "fetch", async (request: Request) => {
		if (++sent === 2) bothSent.resolve();
		await bothSent.promise;
		return new Response(request.headers.get("authorization"));
	});
	const [fromAlice, fromBob] = await Promise.all([
		handle(cookieHeader(alice.setCookies), async () =>
			(await authFetch("/me")).text(),
		),
		handle(cookieHeader(bob.setCookies), async () =>
			(await authFetch("/me")).text(),
		),
	]);
	assert.equal(fromAlice.result, "Bearer alice-token");
	assert.equal(fromBob.result, "Bearer bob-token");
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
