import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createElement as h } from "react";
import * as reactRouter from "react-router";

import {
	createMirrorAuth,
	type Credentials,
	type MirrorAuth,
	type Session,
} from "@monarcode/session-kit";
import {
	cookieJarMiddleware,
	routerJar,
	type RouterContextLike,
} from "@monarcode/session-kit/react-router/server";
import { createServerAuth } from "@monarcode/session-kit/server";

import { act, render, settle, useDom } from "./dom.ts";
import { code, deferred, user, userSchema } from "./helpers.ts";

type User = typeof user;

let refreshes = 0;
/**
 * What the backend answers a refresh with: `null` once it refuses the token,
 * or a promise while it hasn't answered yet.
 */
let refreshAnswer: object | null = {
	accessToken: "access-2",
	refreshToken: "refresh-2",
	expiresIn: 900,
};
const serverAuth = createServerAuth({
	name: "app",
	user: userSchema,
	secret: "a-test-secret-that-is-at-least-32-chars",
	refresh: async () => {
		refreshes++;
		return refreshAnswer as never;
	},
});

beforeEach(() => {
	refreshes = 0;
	refreshAnswer = {
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresIn: 900,
	};
});

const tokens = (overrides: object = {}) => ({
	accessToken: "access-1",
	refreshToken: "refresh-1",
	expiresIn: 900,
	user,
	...overrides,
});

/** A request's `context`, as React Router makes one per request. */
const newContext = (): RouterContextLike => ({ get() {}, set() {} });

/** The `Cookie` header a browser sends after `response`, without deleted cookies. */
const cookieHeader = (response: Response) =>
	response.headers
		.getSetCookie()
		.filter((line) => !/Max-Age=0/.test(line))
		.map((line) => line.split(";")[0])
		.join("; ");

const request = (cookie = "", url = "https://app.test/") =>
	new Request(url, { headers: { cookie } });

/** Runs `work` with the jar of a request that carries `cookie`. */
function handle(
	cookie: string,
	work: (jar: ReturnType<typeof routerJar>) => Promise<unknown>,
	respond: () => Response = () => new Response("ok"),
) {
	const context = newContext();
	return cookieJarMiddleware(
		{ request: request(cookie), context },
		async () => {
			await work(routerJar(context));
			return respond();
		},
	);
}

const deleted = (response: Response) =>
	response.headers
		.getSetCookie()
		.filter((line) => /Max-Age=0; Expires=Thu, 01 Jan 1970/.test(line))
		.map((line) => line.split("=")[0])
		.sort();

test("routerJar needs cookieJarMiddleware", () => {
	assert.throws(() => routerJar(newContext()), code("INVALID_OPTIONS"));
});

test("cookieJarMiddleware sets the cookies a request wrote on its response", async () => {
	const context = newContext();
	let session: Session<User> | undefined;
	const signedIn = await cookieJarMiddleware(
		{ request: request(), context },
		async () => {
			const jar = routerJar(context);
			assert.equal(jar.writable, true);
			assert.equal(routerJar(context), jar);
			session = await serverAuth.signIn(jar, tokens());
			return new Response("ok");
		},
	);
	assert.equal(await signedIn.text(), "ok");
	const [line, ...rest] = signedIn.headers.getSetCookie();
	assert.deepEqual(rest, []);
	assert.match(
		line!,
		/^app\.session=1\.[\w.-]+; Path=\/; Max-Age=\d+; SameSite=Lax; Secure; HttpOnly$/,
	);
	assert.equal(routerJar(context).writable, false);

	await handle(cookieHeader(signedIn), async (jar) => {
		assert.deepEqual(await serverAuth.getSession(jar), session);
	});

	const signedOut = await handle(cookieHeader(signedIn), (jar) =>
		serverAuth.signOut(jar),
	);
	assert.deepEqual(deleted(signedOut), ["app.session"]);
	assert.deepEqual(
		await handle("", async () => {}).then((response) =>
			response.headers.getSetCookie(),
		),
		[],
	);
});

test("cookieJarMiddleware sets each cookie once, and deletes every chunk", async () => {
	const large = await handle("", async (jar) => {
		await serverAuth.signIn(jar, tokens());
		await serverAuth.signIn(jar, tokens({ accessToken: "a".repeat(5000) }));
	});
	assert.deepEqual(
		large.headers
			.getSetCookie()
			.map((line) => line.split("=")[0])
			.sort(),
		["app.session", "app.session.0", "app.session.1"],
	);

	const signedOut = await handle(cookieHeader(large), (jar) =>
		serverAuth.signOut(jar),
	);
	assert.deepEqual(deleted(signedOut), [
		"app.session",
		"app.session.0",
		"app.session.1",
	]);
});

test("the jar is read-only once the response leaves the middleware", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const signedIn = await handle("", (jar) => serverAuth.signIn(jar, tokens()));
	t.mock.timers.tick(901_000);
	let jar!: ReturnType<typeof routerJar>;
	const response = await handle(cookieHeader(signedIn), async (current) => {
		jar = current;
	});
	// As deferred data that resolves while the page streams.
	assert.equal(jar.writable, false);
	await assert.rejects(
		serverAuth.credentials.get(jar),
		code("REFRESH_FAILED"),
	);
	assert.equal(refreshes, 0);
	assert.deepEqual(response.headers.getSetCookie(), []);
});

test("the response waits for a refresh under way, so its tokens are saved", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const signedIn = await handle("", (jar) => serverAuth.signIn(jar, tokens()));
	t.mock.timers.tick(901_000);
	const backend = deferred<object>();
	refreshAnswer = backend.promise;
	let streamed!: Promise<Credentials | null>;
	let sent = false;
	const responded = handle(cookieHeader(signedIn), async (jar) => {
		// Deferred data whose refresh is under way when the page is ready.
		streamed = serverAuth.credentials.get(jar);
		while (refreshes === 0) await new Promise(setImmediate);
	}).then((response) => {
		sent = true;
		return response;
	});
	await new Promise(setImmediate);
	assert.equal(sent, false);
	backend.resolve({
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresIn: 900,
	});
	const response = await responded;
	assert.equal((await streamed)?.accessToken, "access-2");
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	await handle(cookieHeader(response), async (jar) => {
		assert.equal(
			(await serverAuth.credentials.get(jar))?.accessToken,
			"access-2",
		);
	});
	assert.equal(refreshes, 1);
});

test("a refresh that would start after the response left is refused, keeping the session", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const signedIn = await handle("", (jar) => serverAuth.signIn(jar, tokens()));
	t.mock.timers.tick(901_000);
	let streamed!: Promise<Credentials | null>;
	const response = await handle(cookieHeader(signedIn), async (jar) => {
		// Deferred data that reads the cookie only after the page is ready.
		streamed = serverAuth.credentials.get(jar);
	});
	await assert.rejects(streamed, code("REFRESH_FAILED"));
	assert.equal(refreshes, 0);
	assert.deepEqual(response.headers.getSetCookie(), []);
	await handle(cookieHeader(signedIn), async (jar) => {
		assert.equal(
			(await serverAuth.credentials.get(jar))?.accessToken,
			"access-2",
		);
	});
	assert.equal(refreshes, 1);
});

test("cookieJarMiddleware copies a response whose headers are immutable", async () => {
	const response = await handle(
		"",
		(jar) => serverAuth.signIn(jar, tokens()),
		() => Response.redirect("https://app.test/home", 302),
	);
	assert.equal(response.status, 302);
	assert.equal(response.headers.get("Location"), "https://app.test/home");
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
});

test("cookieJarMiddleware listed twice sets the cookies once", async () => {
	const context = newContext();
	const args = { request: request(), context };
	const response = await cookieJarMiddleware(args, () =>
		cookieJarMiddleware(args, async () => {
			await serverAuth.signIn(routerJar(context), tokens());
			return new Response("ok");
		}),
	);
	assert.equal(response.headers.getSetCookie().length, 1);
});

test("cookieJarMiddleware gives each request its own jar, even with a reused context", async () => {
	const context = newContext();
	await cookieJarMiddleware({ request: request(), context }, async () => {
		await serverAuth.signIn(routerJar(context), tokens());
		return new Response("ok");
	});
	let session: unknown = "unread";
	const next = await cookieJarMiddleware(
		{ request: request(), context },
		async () => {
			const jar = routerJar(context);
			assert.equal(jar.writable, true);
			session = await serverAuth.getSession(jar);
			return new Response("ok");
		},
	);
	assert.equal(session, null);
	assert.deepEqual(next.headers.getSetCookie(), []);
});

// React Router's own request handling, with middleware: 7.9 and later.
const middlewareSupported = "RouterContextProvider" in reactRouter;

/**
 * A server build like the one `react-router build` makes, without React:
 * documents answer with the loaders' data. `/` is guarded, `/login` signs in
 * and `/session` is a resource route.
 */
function requestHandler() {
	const component = () => null;
	const routes = {
		root: {
			id: "root",
			path: "",
			module: {
				default: component,
				middleware: [
					cookieJarMiddleware,
					async ({ context }: { context: RouterContextLike }) => {
						await serverAuth
							.refreshIfDue(routerJar(context))
							.catch(() => {});
					},
				],
				loader: async ({ context }: { context: RouterContextLike }) => ({
					session: await serverAuth.getSession(routerJar(context)),
				}),
			},
		},
		"routes/login": {
			id: "routes/login",
			parentId: "root",
			path: "login",
			module: {
				default: component,
				action: async ({ context }: { context: RouterContextLike }) => {
					await serverAuth.signIn(routerJar(context), tokens());
					throw reactRouter.redirect("/");
				},
			},
		},
		"routes/protected": {
			id: "routes/protected",
			parentId: "root",
			module: {
				default: component,
				middleware: [
					async ({ context }: { context: RouterContextLike }) => {
						if (!(await serverAuth.getSession(routerJar(context))))
							throw reactRouter.redirect("/login");
					},
				],
			},
		},
		"routes/home": {
			id: "routes/home",
			parentId: "routes/protected",
			index: true,
			module: {
				default: component,
				loader: async ({ context }: { context: RouterContextLike }) =>
					(await serverAuth.credentials.get(routerJar(context)))
						?.accessToken,
			},
		},
		"routes/session": {
			id: "routes/session",
			parentId: "root",
			path: "session",
			module: {
				loader: async ({ context }: { context: RouterContextLike }) =>
					Response.json(await serverAuth.getSession(routerJar(context))),
			},
		},
	};
	const build = {
		entry: {
			module: {
				default: (
					_request: Request,
					status: number,
					headers: Headers,
					entry: { staticHandlerContext: { loaderData: unknown } },
				) =>
					Response.json(entry.staticHandlerContext.loaderData, {
						status,
						headers,
					}),
			},
		},
		routes,
		assets: {
			entry: { imports: [], module: "" },
			routes: {},
			url: "/assets/manifest.js",
			version: "test",
		},
		publicPath: "/",
		assetsBuildDirectory: "build/client",
		future: { v8_middleware: true },
		ssr: true,
		isSpaMode: false,
		prerender: [],
		routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
	};
	return reactRouter.createRequestHandler(
		build as unknown as Parameters<
			typeof reactRouter.createRequestHandler
		>[0],
		"test",
	);
}

/** Cookies for a session whose access expires within `refreshIfDue`'s window. */
const expiring = async () =>
	cookieHeader(
		await handle("", (jar) =>
			serverAuth.signIn(jar, tokens({ expiresIn: 30 })),
		),
	);

test(
	"React Router: a page refreshes in middleware, and its loaders and response get the new tokens",
	{ skip: !middlewareSupported },
	async () => {
		const response = await requestHandler()(request(await expiring()));
		assert.equal(response.status, 200);
		assert.equal(refreshes, 1);
		const data = (await response.json()) as Record<string, unknown>;
		assert.equal(data["routes/home"], "access-2");
		assert.deepEqual(
			(data.root as { session: { user: unknown } }).session.user,
			user,
		);
		assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	},
);

test(
	"React Router: an action's redirect sets the cookie, as a document and as data",
	{ skip: !middlewareSupported },
	async () => {
		const handler = requestHandler();
		const form = (url: string) =>
			new Request(url, {
				method: "POST",
				headers: { Origin: "https://app.test" },
				body: new URLSearchParams(),
			});

		const document = await handler(form("https://app.test/login"));
		assert.equal(document.status, 302);
		assert.equal(document.headers.get("Location"), "/");
		assert.match(document.headers.getSetCookie()[0]!, /^app\.session=1\./);

		// Single fetch: the redirect travels in the body, the cookie in the headers.
		const data = await handler(form("https://app.test/login.data"));
		assert.equal(data.status, 202);
		assert.match(data.headers.getSetCookie()[0]!, /^app\.session=1\./);

		const home = await handler(request(cookieHeader(document)));
		assert.equal(home.status, 200);
	},
);

test(
	"React Router: a refused refresh signs out, and the guard's redirect deletes the cookie",
	{ skip: !middlewareSupported },
	async () => {
		const cookie = await expiring();
		refreshAnswer = null;
		const response = await requestHandler()(request(cookie));
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("Location"), "/login");
		assert.deepEqual(deleted(response), ["app.session"]);
	},
);

test(
	"React Router: a resource route's response carries the refreshed cookie",
	{ skip: !middlewareSupported },
	async () => {
		const response = await requestHandler()(
			request(await expiring(), "https://app.test/session"),
		);
		assert.equal(response.status, 200);
		assert.deepEqual(
			((await response.json()) as { user: unknown }).user,
			user,
		);
		assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	},
);

useDom();

type Binding = typeof import("@monarcode/session-kit/react-router");
let binding: Binding;
let router: typeof import("react-router");

beforeEach(async () => {
	binding = await import("@monarcode/session-kit/react-router");
	router = await import("react-router");
});

const alice: Session<User> = { sessionId: "s1", user };
const bob: Session<User> = {
	sessionId: "s2",
	user: { ...user, id: "bob", email: "bob@example.com" },
};

/**
 * Renders `useMirrorAuth` in a root route whose loader returns the server's
 * session, counting loader runs, and returns a way to change that session
 * and run the loader again.
 */
async function mount(
	initial: Session<User> | null,
	revalidate: () => Promise<Session<User> | null> = async () => null,
) {
	const counts = { loads: 0, created: 0 };
	let server = initial;
	let client!: MirrorAuth<User>;
	function Root() {
		const { session } = router.useLoaderData() as {
			session: Session<User> | null;
		};
		client = binding.useMirrorAuth((first) => {
			counts.created++;
			return createMirrorAuth({
				name: "react-router-test",
				session: first,
				revalidate,
				signOut: async () => {},
			});
		}, session);
		return null;
	}
	const memory = router.createMemoryRouter([
		{
			path: "/",
			loader: () => {
				counts.loads++;
				return { session: server };
			},
			element: h(Root),
			HydrateFallback: () => null,
		},
	]);
	await render(h(router.RouterProvider, { router: memory }));
	await settle();
	return {
		counts,
		client: () => client,
		set server(session: Session<User> | null) {
			server = session;
		},
		/** The loader reads `session` and the root renders it. */
		async serverRender(session: Session<User> | null) {
			server = session;
			await act(() => memory.revalidate());
			await settle();
		},
	};
}

test("useMirrorAuth creates the client once and follows the root loader's session", async () => {
	const app = await mount(alice);
	assert.equal(app.client().state.get().sessionId, "s1");
	const version = app.client().state.get().version;

	await app.serverRender(bob);
	assert.equal(app.client().state.get().sessionId, "s2");
	assert.equal(app.client().state.get().version, version + 1);
	await app.serverRender(structuredClone(bob));
	await app.serverRender(null);
	assert.equal(app.client().state.get().status, "unauthenticated");
	assert.equal(app.counts.created, 1);
	// One load at start and one per server render: adopting runs none.
	assert.equal(app.counts.loads, 4);
});

test("useMirrorAuth runs loaders again when the browser's session changes", async () => {
	const app = await mount(alice);
	app.server = null;
	await act(async () => app.client().adopt(null));
	await settle();
	assert.equal(app.counts.loads, 2);
	assert.equal(app.client().state.get().status, "unauthenticated");

	app.server = alice;
	await act(async () => app.client().adopt(alice));
	await settle();
	assert.equal(app.counts.loads, 3);

	const renamed = { ...alice, user: { ...user, email: "new@example.com" } };
	app.server = renamed;
	await act(async () => app.client().adopt(renamed));
	await settle();
	assert.equal(app.counts.loads, 4);
});

test("useMirrorAuth keeps a revalidation when the loader returns the same session", async () => {
	const answer = deferred<Session<User> | null>();
	const app = await mount(alice, () => answer.promise);
	let revalidated: Promise<unknown> | undefined;
	await act(async () => {
		revalidated = app.client().retry();
	});
	await app.serverRender(structuredClone(alice));
	answer.resolve(bob);
	app.server = bob;
	await act(async () => {
		await revalidated;
	});
	await settle();
	assert.equal(app.client().state.get().sessionId, "s2");
});

test("useMirrorAuth runs loaders again after a sign-out in another tab", async () => {
	let server: Session<User> | null = alice;
	const app = await mount(alice, async () => server);
	const unmount = app.client().mount();
	const otherTab = createMirrorAuth({
		name: "react-router-test",
		session: alice,
		revalidate: async () => server,
		signOut: async () => {
			server = null;
			app.server = null;
		},
	});
	try {
		await otherTab.signOut();
		for (let turn = 0; turn < 5 && app.counts.loads === 1; turn++)
			await settle();
		assert.equal(app.client().state.get().status, "unauthenticated");
		assert.equal(app.counts.loads, 2);
	} finally {
		unmount();
	}
});
