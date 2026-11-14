import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import * as reactRouter from "react-router";

import type { Credentials, Session } from "@monarcode/session-kit";
import {
	cookieJarMiddleware,
	redirectIfSignedIn,
	requireSession,
	routerAuth,
	routerJar,
	sessionMiddleware,
	sessionRoute,
	type RouterArgs,
	type RouterContextLike,
	type RouterMiddleware,
} from "@monarcode/session-kit/react-router/server";
import { createServerAuth } from "@monarcode/session-kit/server";

import {
	code,
	cookieHeader,
	deferred,
	deleted,
	SECRET,
	tokens,
	user,
	userSchema,
} from "./helpers.ts";

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
	secret: SECRET,
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

/** A request's `context`, as React Router makes one per request. */
const newContext = (): RouterContextLike => ({ get() {}, set() {} });

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

test("routerJar needs cookieJarMiddleware", () => {
	assert.throws(() => routerJar(newContext()), code("INVALID_OPTIONS"));
});

test("sessionRoute without the middleware answers with the code the client reads", async () => {
	const response = await sessionRoute(serverAuth).loader({
		request: new Request("https://app.test/auth/session", {
			headers: { "Sec-Fetch-Site": "same-origin" },
		}),
		context: newContext(),
	} as never);
	assert.equal(response.status, 400);
	const body = (await response.json()) as any;
	assert.equal(body.error.code, "INVALID_OPTIONS");
	assert.match(body.error.message, /cookieJarMiddleware/);
});

test("routerAuth gives the request's session by its context", async () => {
	const auth = routerAuth(serverAuth);
	assert.throws(() => auth(newContext()), code("INVALID_OPTIONS"));

	let signedIn: Session<User> | undefined;
	const context = newContext();
	const response = await cookieJarMiddleware(
		{ request: request(), context },
		async () => {
			const session = auth(context);
			assert.equal(auth(context), session);
			assert.equal(session, serverAuth.forRequest(routerJar(context)));
			signedIn = await session.signIn(tokens());
			return new Response("ok");
		},
	);
	const cookie = cookieHeader(response);
	const read = newContext();
	await cookieJarMiddleware(
		{ request: request(cookie), context: read },
		async () => {
			assert.deepEqual(await auth(read).getSession(), signedIn);
			return new Response("ok");
		},
	);
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
function requestHandler({ basename }: { basename?: string } = {}) {
	const guard = basename ? requireSession(serverAuth, { basename }) : signedIn;
	const component = () => null;
	const routes = {
		root: {
			id: "root",
			path: "",
			module: {
				default: component,
				middleware: sessionMiddleware(serverAuth),
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
				loader: redirectIfSignedIn(serverAuth),
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
				middleware: [guard],
				loader: () => null,
			},
		},
		"routes/home": {
			id: "routes/home",
			parentId: "routes/protected",
			index: true,
			module: {
				default: component,
				loader: async ({ context }: { context: RouterContextLike }) => ({
					accessToken: (
						await serverAuth.credentials.get(routerJar(context))
					)?.accessToken,
					user: guard.session(context).user,
				}),
			},
		},
		"routes/auth.session": {
			id: "routes/auth.session",
			parentId: "root",
			path: "auth/session",
			module: sessionRoute(serverAuth),
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
		...(basename && { basename }),
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

/** Runs `middleware` in order around `respond`, as React Router does. */
function run(
	middleware: readonly RouterMiddleware[],
	args: RouterArgs,
	respond: () => Promise<Response> = async () => new Response("ok"),
): Promise<Response> {
	const [first, ...rest] = middleware;
	return first ? first(args, () => run(rest, args, respond)) : respond();
}

/** Calls the redirect a guard throws, or fails. */
async function thrown(promise: Promise<unknown>): Promise<Response> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Response) return error;
		throw error;
	}
	assert.fail("Expected a redirect");
}

const signedIn = requireSession(serverAuth);

test("sessionMiddleware gives the request a jar, refreshes, and marks the response private", async () => {
	const cookie = await expiring();
	refreshes = 0;
	const context = newContext();
	const response = await run(
		sessionMiddleware(serverAuth),
		{ request: request(cookie), context },
		async () => {
			assert.equal(
				(await serverAuth.credentials.get(routerJar(context)))?.accessToken,
				"access-2",
			);
			return Response.json({ ok: true });
		},
	);
	assert.equal(refreshes, 1);
	assert.equal(response.headers.get("Cache-Control"), "private, no-store");
	assert.match(response.headers.getSetCookie()[0]!, /^app\.session=1\./);
	assert.deepEqual(await response.json(), { ok: true });
});

test("sessionMiddleware takes the header's value, or leaves it alone", async () => {
	const custom = await run(
		sessionMiddleware(serverAuth, { cacheControl: "private, max-age=0" }),
		{ request: request(), context: newContext() },
	);
	assert.equal(custom.headers.get("Cache-Control"), "private, max-age=0");

	const own = await run(
		sessionMiddleware(serverAuth, { cacheControl: false }),
		{ request: request(), context: newContext() },
		async () =>
			new Response("ok", { headers: { "Cache-Control": "max-age=60" } }),
	);
	assert.equal(own.headers.get("Cache-Control"), "max-age=60");
});

test("sessionMiddleware refreshes within `within`, and a failed refresh doesn't fail the request", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const cookie = await expiring();
	refreshes = 0;
	await run(sessionMiddleware(serverAuth, { within: 10 }), {
		request: request(cookie),
		context: newContext(),
	});
	assert.equal(refreshes, 0);

	// Expired, and the backend can't refresh it.
	t.mock.timers.tick(31_000);
	const down = Promise.reject(new Error("backend down"));
	down.catch(() => {});
	refreshAnswer = down;
	const context = newContext();
	const response = await run(
		sessionMiddleware(serverAuth),
		{ request: request(cookie), context },
		async () => {
			await assert.rejects(
				serverAuth.credentials.get(routerJar(context)),
				code("REFRESH_FAILED"),
			);
			return new Response("ok");
		},
	);
	assert.equal(refreshes, 1);
	assert.equal(response.status, 200);
});

test("sessionMiddleware, requireSession and redirectIfSignedIn check their options when made", () => {
	assert.throws(
		() => sessionMiddleware(serverAuth, { within: -1 }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() => requireSession(serverAuth, { loginPath: "login" }),
		code("INVALID_OPTIONS"),
	);
	assert.throws(
		() =>
			redirectIfSignedIn(serverAuth, { loginPath: ["/login", "sign-in"] }),
		code("INVALID_OPTIONS"),
	);
});

test("requireSession sends a signed-out request to sign in, and back", async () => {
	const context = newContext();
	const response = await thrown(
		run([cookieJarMiddleware, signedIn], {
			request: request("", "https://app.test/orders.data?page=2"),
			url: new URL("https://app.test/orders?page=2"),
			context,
		}),
	);
	assert.equal(response.status, 302);
	assert.equal(
		response.headers.get("Location"),
		"/login?redirectTo=%2Forders%3Fpage%3D2",
	);
	assert.throws(() => signedIn.session(context), code("INVALID_OPTIONS"));

	// React Router 7 passes no `url`, and a path that leaves the site comes back home.
	const home = await thrown(
		run(
			[
				cookieJarMiddleware,
				requireSession(serverAuth, { loginPath: "/sign-in" }),
			],
			{
				request: request("", "https://app.test//evil.test/"),
				context: newContext(),
			},
		),
	);
	assert.equal(home.headers.get("Location"), "/sign-in?redirectTo=%2F");
});

test("requireSession adds the basename to its redirect, and leaves it out of redirectTo", async () => {
	const response = await thrown(
		run(
			[
				cookieJarMiddleware,
				requireSession(serverAuth, { basename: "/app/" }),
			],
			{
				request: request("", "https://app.test/app/orders?page=2"),
				url: new URL("https://app.test/app/orders?page=2"),
				context: newContext(),
			},
		),
	);
	assert.equal(
		response.headers.get("Location"),
		"/app/login?redirectTo=%2Forders%3Fpage%3D2",
	);
	assert.throws(
		() => requireSession(serverAuth, { basename: "app" }),
		code("INVALID_OPTIONS"),
	);
});

test("requireSession leaves React Router 7's _routes param out of redirectTo", async () => {
	const response = await thrown(
		run([cookieJarMiddleware, signedIn], {
			request: request(
				"",
				"https://app.test/orders?page=2&_routes=routes%2Forders",
			),
			context: newContext(),
		}),
	);
	assert.equal(
		response.headers.get("Location"),
		"/login?redirectTo=%2Forders%3Fpage%3D2",
	);
});

test("requireSession's session follows an action's changes in the same request", async () => {
	const cookie = cookieHeader(
		await handle("", (jar) => serverAuth.signIn(jar, tokens())),
	);
	const context = newContext();
	await run(
		[cookieJarMiddleware, signedIn],
		{ request: request(cookie), context },
		async () => {
			const session = routerAuth(serverAuth)(context);
			await session.updateUser({ ...user, role: "admin" });
			assert.equal(signedIn.session(context).user.role, "admin");
			assert.ok(Object.isFrozen(signedIn.session(context)));
			await session.signOut();
			assert.throws(
				() => signedIn.session(context),
				code("UNAUTHENTICATED"),
			);
			return new Response("ok");
		},
	);
});

test("sessionMiddleware sets Cache-Control on a response that can't change, and leaves a response's own alone", async () => {
	const response = await run(
		sessionMiddleware(serverAuth),
		{ request: request(), context: newContext() },
		async () => Response.redirect("https://app.test/public", 302),
	);
	assert.equal(response.headers.get("Cache-Control"), "private, no-store");
	const own = await run(
		sessionMiddleware(serverAuth),
		{ request: request(), context: newContext() },
		async () =>
			new Response("ok", {
				headers: { "Cache-Control": "public, max-age=60" },
			}),
	);
	assert.equal(own.headers.get("Cache-Control"), "public, max-age=60");
});

test("requireSession lets a signed-in request through, with its session for the loaders", async () => {
	const cookie = cookieHeader(
		await handle("", (jar) => serverAuth.signIn(jar, tokens())),
	);
	const context = newContext();
	const response = await run(
		[cookieJarMiddleware, signedIn],
		{ request: request(cookie), context },
		async () => Response.json(signedIn.session(context).user),
	);
	assert.deepEqual(await response.json(), user);
	assert.throws(
		() => requireSession(serverAuth).session(context),
		code("INVALID_OPTIONS"),
	);

	// A context reused for another request doesn't keep the session.
	await run([cookieJarMiddleware], { request: request(), context });
	assert.throws(() => signedIn.session(context), code("INVALID_OPTIONS"));
});

test("redirectIfSignedIn sends a signed-in user on to a safe redirectTo", async () => {
	const cookie = cookieHeader(
		await handle("", (jar) => serverAuth.signIn(jar, tokens())),
	);
	const loader = redirectIfSignedIn(serverAuth);

	const at = async (cookie: string, url: string) => {
		const context = newContext();
		let result: unknown;
		await run(
			[cookieJarMiddleware],
			{ request: request(cookie, url), context },
			async () => {
				result = await loader({
					request: request(cookie, url),
					context,
				}).catch((error: unknown) => error);
				return new Response("ok");
			},
		);
		return result;
	};

	assert.equal(
		await at("", "https://app.test/login?redirectTo=%2Forders"),
		null,
	);
	const orders = await at(
		cookie,
		"https://app.test/login?redirectTo=%2Forders",
	);
	assert.ok(orders instanceof Response);
	assert.equal(orders.headers.get("Location"), "/orders");
	const unsafe = await at(
		cookie,
		"https://app.test/login?redirectTo=https%3A%2F%2Fevil.test",
	);
	assert.equal((unsafe as Response).headers.get("Location"), "/");
	const back = await at(cookie, "https://app.test/login?redirectTo=%2Flogin");
	assert.equal((back as Response).headers.get("Location"), "/");
});

test(
	"React Router: a page refreshes in middleware, and its loaders and response get the new tokens",
	{ skip: !middlewareSupported },
	async () => {
		const response = await requestHandler()(request(await expiring()));
		assert.equal(response.status, 200);
		assert.equal(refreshes, 1);
		const data = (await response.json()) as Record<string, unknown>;
		assert.deepEqual(data["routes/home"], { accessToken: "access-2", user });
		assert.equal(response.headers.get("Cache-Control"), "private, no-store");
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
		assert.equal(response.headers.get("Location"), "/login?redirectTo=%2F");
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

test(
	"React Router: the guards redirect page loads and navigation in the browser",
	{ skip: !middlewareSupported },
	async () => {
		const handler = requestHandler();
		// Single fetch: the redirect travels in the body, without `.data`.
		const data = await handler(request("", "https://app.test/_.data"));
		assert.equal(data.status, 202);
		const body = await data.text();
		assert.match(body, /\/login\?redirectTo=%2F/);
		assert.doesNotMatch(body, /redirectTo=[^"]*\.data/);

		const cookie = cookieHeader(
			await handle("", (jar) => serverAuth.signIn(jar, tokens())),
		);
		const login = await handler(
			request(cookie, "https://app.test/login?redirectTo=%2Fsession"),
		);
		assert.equal(login.status, 302);
		assert.equal(login.headers.get("Location"), "/session");
		assert.equal(
			(await handler(request("", "https://app.test/login"))).status,
			200,
		);
	},
);

test(
	"React Router: with a basename, the guards' redirects stay under it",
	{ skip: !middlewareSupported },
	async () => {
		const handler = requestHandler({ basename: "/app" });
		const guarded = await handler(request("", "https://app.test/app/"));
		assert.equal(guarded.status, 302);
		assert.equal(
			guarded.headers.get("Location"),
			"/app/login?redirectTo=%2F",
		);

		const cookie = cookieHeader(
			await handle("", (jar) => serverAuth.signIn(jar, tokens())),
		);
		const login = await handler(
			request(cookie, "https://app.test/app/login?redirectTo=%2Fsession"),
		);
		assert.equal(login.status, 302);
		assert.equal(login.headers.get("Location"), "/app/session");
	},
);

test(
	"React Router: sessionRoute is a resource route for the browser client",
	{ skip: !middlewareSupported },
	async () => {
		const handler = requestHandler();
		const toRoute = (cookie: string, method: string, body?: object) =>
			new Request("https://app.test/auth/session", {
				method,
				headers: { cookie, "Sec-Fetch-Site": "same-origin" },
				...(body && { body: JSON.stringify(body) }),
			});
		const cookie = cookieHeader(
			await handle("", (jar) => serverAuth.signIn(jar, tokens())),
		);
		const read = await handler(toRoute(cookie, "GET"));
		assert.equal(read.status, 200);
		assert.equal(read.headers.get("Cache-Control"), "no-store");
		assert.deepEqual(((await read.json()) as any).session.user, user);

		const signedOut = await handler(
			toRoute(cookie, "POST", { v: 1, action: "signOut" }),
		);
		assert.equal(signedOut.status, 200);
		assert.deepEqual(deleted(signedOut), ["app.session"]);

		const elsewhere = await handler(
			new Request("https://app.test/auth/session", {
				headers: { cookie, "Sec-Fetch-Site": "cross-site" },
			}),
		);
		assert.equal(elsewhere.status, 403);
	},
);
