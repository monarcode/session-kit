import { AuthError } from "../core/errors.js";
import {
	loginHref,
	safeReturnTo,
	type SafeReturnToOptions,
} from "../core/return-to.js";
import type { Session } from "../core/types.js";
import {
	middlewareOptions,
	refreshBeforeRendering,
	type RequestAuth,
	type ServerAuth,
	type SessionMiddlewareOptions,
} from "../server/auth.js";
import type { CookieJar } from "../server/cookies.js";
import {
	requestJar,
	withHeaders,
	type RequestJar,
} from "../server/request-jar.js";
import { stripBasename, withBasename } from "./basename.js";

/**
 * The `context` React Router passes to server middleware, loaders and actions
 * in framework mode: a `RouterContextProvider`, one per request.
 * {@link routerAuth} and {@link cookieJarMiddleware} find the request by it.
 * It's typed by its shape, so this entry point doesn't depend on React
 * Router's types.
 *
 * @example
 * ```ts
 * import type { RouterContextLike } from "@monarcode/session-kit/react-router/server";
 * import type { RequestAuth } from "@monarcode/session-kit/server";
 *
 * declare const auth: (
 * 	context: RouterContextLike,
 * ) => RequestAuth<{ id: number }, { id: number }>;
 *
 * export async function loader({ context }: { context: RouterContextLike }) {
 * 	return { session: await auth(context).getSession() };
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RouterContextLike = {
	get: (key: never) => unknown;
	set: (key: never, value: never) => unknown;
};

// One per request, by its context: every middleware, loader and action of
// the request shares it.
const requests = new WeakMap<
	object,
	{ request: Request; cookies: RequestJar }
>();

/**
 * Server middleware that gives each request a {@link CookieJar}, found with
 * {@link routerJar}. It sets the cookies written to the jar on the response,
 * redirects and error responses included.
 *
 * {@link sessionMiddleware} starts with it, so most apps don't list it
 * themselves. To refresh your own way, list it first in the root route's
 * `middleware`, so it wraps the rest. It needs React Router 8, or 7.9 and
 * later with `future.v8_middleware`.
 *
 * The jar can set cookies until the response leaves the middleware, which
 * first waits for a refresh under way, so its new tokens are saved. After
 * that, such as while a loader's deferred data streams, it's read-only.
 * Nothing is saved, and a call that needs a refresh rejects with
 * `REFRESH_FAILED`. Refresh before rendering, with `refreshIfDue` in
 * middleware.
 *
 * @example
 * ```ts
 * import {
 * 	cookieJarMiddleware,
 * 	type RouterContextLike,
 * } from "@monarcode/session-kit/react-router/server";
 * import type { RequestAuth } from "@monarcode/session-kit/server";
 *
 * declare const auth: (
 * 	context: RouterContextLike,
 * ) => RequestAuth<{ id: number }, { id: number }>;
 *
 * // app/root.tsx: refresh for GET requests only.
 * export const middleware = [
 * 	cookieJarMiddleware,
 * 	async (args: { context: RouterContextLike; request: Request }) => {
 * 		const { context, request } = args;
 * 		if (request.method === "GET")
 * 			await auth(context).refreshIfDue().catch(() => {});
 * 	},
 * ];
 * ```
 *
 * @since 0.1.0
 */
export async function cookieJarMiddleware(
	{ request, context }: { request: Request; context: RouterContextLike },
	next: () => Promise<Response>,
): Promise<Response> {
	// If it runs twice for one request, the outer one owns the jar. `request`
	// is checked too, as an app may reuse a `context` across requests.
	const current = requests.get(context);
	if (current?.request === request && current.cookies.jar.writable)
		return next();
	const cookies = requestJar(request);
	requests.set(context, { request, cookies });
	return cookies.respond(next);
}

/**
 * The {@link CookieJar} for the request React Router is handling, to pass to
 * `serverAuth` from `@monarcode/session-kit/server`. {@link routerAuth}
 * passes it for you. Call it with `context` in server middleware, loaders
 * and actions, after {@link cookieJarMiddleware}. Every call during one
 * request returns the same jar.
 *
 * Throws `INVALID_OPTIONS` when the middleware hasn't run for `context`,
 * such as in a client loader.
 *
 * @example
 * ```ts
 * import {
 * 	routerJar,
 * 	type RouterContextLike,
 * } from "@monarcode/session-kit/react-router/server";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // A sign-out route's action.
 * export async function action({ context }: { context: RouterContextLike }) {
 * 	await serverAuth.signOut(routerJar(context));
 * 	return null;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function routerJar(context: RouterContextLike): CookieJar {
	const current = requests.get(context);
	if (!current)
		throw new AuthError(
			"INVALID_OPTIONS",
			"Add cookieJarMiddleware to the root route's middleware, and read the session on the server, in middleware, loaders and actions",
		);
	return current.cookies.jar;
}

/**
 * Returns a function that gives the session of the request React Router is
 * handling ({@link RequestAuth}), with every `serverAuth` method and no
 * cookie jar. Call it with `context` in server middleware, loaders and
 * actions, after {@link cookieJarMiddleware}. Make it once, at module level.
 *
 * Calling it throws `INVALID_OPTIONS` when the middleware hasn't run for
 * `context`, as {@link routerJar} does.
 *
 * @example
 * ```ts
 * import { createServerAuth } from "@monarcode/session-kit/server";
 * import {
 * 	routerAuth,
 * 	type RouterContextLike,
 * } from "@monarcode/session-kit/react-router/server";
 * import { z } from "zod";
 *
 * declare const secret: string;
 *
 * const serverAuth = createServerAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.number(), firstName: z.string() }),
 * 	secret,
 * });
 * export const auth = routerAuth(serverAuth);
 *
 * export async function loader({ context }: { context: RouterContextLike }) {
 * 	return { session: await auth(context).getSession() };
 * }
 * ```
 *
 * @since 0.1.0
 */
export function routerAuth<U, I>(
	serverAuth: ServerAuth<U, I>,
): (context: RouterContextLike) => RequestAuth<U, I> {
	return (context) => serverAuth.forRequest(routerJar(context));
}

/**
 * The arguments React Router passes to server middleware and loaders, as far
 * as the middleware and guards here read them. It's typed by its shape, like
 * {@link RouterContextLike}.
 *
 * @example
 * ```ts
 * import type { RouterArgs } from "@monarcode/session-kit/react-router/server";
 *
 * export function pathOf({ request, url }: RouterArgs) {
 * 	const { pathname, search } = url ?? new URL(request.url);
 * 	return pathname + search;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RouterArgs = {
	request: Request;
	context: RouterContextLike;
	/**
	 * The URL without React Router's `.data` suffix, from React Router 8.
	 * React Router 7 removes the suffix from `request.url` instead.
	 */
	url?: URL | undefined;
};

/**
 * Server middleware for a route's `middleware`, typed by its shape.
 *
 * @example
 * ```ts
 * import type {
 * 	RouterMiddleware,
 * } from "@monarcode/session-kit/react-router/server";
 *
 * export const noStore: RouterMiddleware = async (_args, next) => {
 * 	const response = await next();
 * 	const page = new Response(response.body, response);
 * 	page.headers.set("Cache-Control", "no-store");
 * 	return page;
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RouterMiddleware = (
	args: RouterArgs,
	next: () => Promise<Response>,
) => Promise<Response>;

/** The URL the request asked for, without React Router's `.data` suffix. */
function urlOf({ request, url }: RouterArgs): URL {
	if (url) return url;
	// React Router 7 passes no `url`. `_routes` is only ever its own param.
	const fromRequest = new URL(request.url);
	fromRequest.searchParams.delete("_routes");
	return fromRequest;
}

/** A redirect, as React Router's `redirect` makes, without importing it. */
function redirectTo(location: string): Response {
	return new Response(null, { status: 302, headers: { Location: location } });
}

/**
 * The root route's server middleware, which gives each request a cookie
 * jar and refreshes the session while the response can still set the
 * cookie. Export it as the root route's `middleware`, or spread it first
 * into a list of your own.
 *
 * It refreshes access that expires within `within` seconds, before any
 * loader reads it. A failed refresh doesn't fail the request. Loaders read
 * the session as usual, and an error there reaches the route's error
 * boundary.
 *
 * It sets `Cache-Control` to `private, no-store` on each response that
 * doesn't set its own, unless you pass `cacheControl`.
 *
 * It's {@link cookieJarMiddleware} followed by the refresh, and needs React
 * Router 8, or 7.9 and later with `future.v8_middleware`.
 *
 * Throws `INVALID_OPTIONS` when `within` is negative.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { sessionMiddleware } from "@monarcode/session-kit/react-router/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // app/root.tsx
 * export const middleware = sessionMiddleware(serverAuth);
 * ```
 *
 * @see {@link requireSession} to let only signed-in users through.
 * @since 0.1.0
 */
export function sessionMiddleware<U, I>(
	serverAuth: ServerAuth<U, I>,
	options?: SessionMiddlewareOptions,
): RouterMiddleware[] {
	const { within, cacheControl } = middlewareOptions(options);
	const refresh: RouterMiddleware = async ({ context }, next) => {
		await refreshBeforeRendering(serverAuth, routerJar(context), within);
		const response = await next();
		if (cacheControl === false || response.headers.has("Cache-Control"))
			return response;
		return withHeaders(response, (headers) =>
			headers.set("Cache-Control", cacheControl),
		);
	};
	return [cookieJarMiddleware, refresh];
}

/**
 * Options for {@link requireSession}.
 *
 * @example
 * ```ts
 * import type {
 * 	SessionGuardOptions,
 * } from "@monarcode/session-kit/react-router/server";
 *
 * // For an app built with `basename: "/app"`.
 * export const options: SessionGuardOptions = {
 * 	loginPath: "/sign-in",
 * 	basename: "/app",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type SessionGuardOptions = {
	/**
	 * Your sign-in page's path in the app, starting with `/`, without the
	 * `basename`.
	 * @default "/login"
	 */
	loginPath?: string | undefined;
	/**
	 * The app's `basename`, if it has one. React Router adds it to a
	 * loader's redirects but not to middleware's, so the guard adds it to
	 * its own. It leaves it out of `redirectTo`, which a loader then uses.
	 */
	basename?: string | undefined;
};

/**
 * Server middleware that lets only signed-in users through, made by
 * {@link requireSession}. Call `session(context)` in the loaders and actions
 * it guards for the session, which is never `null` there.
 *
 * @example
 * ```ts
 * import type {
 * 	RouterContextLike,
 * 	SessionGuard,
 * } from "@monarcode/session-kit/react-router/server";
 *
 * declare const signedIn: SessionGuard<{ id: number; firstName: string }>;
 *
 * export function loader({ context }: { context: RouterContextLike }) {
 * 	return { name: signedIn.session(context).user.firstName };
 * }
 * ```
 *
 * @since 0.1.0
 */
export type SessionGuard<U> = RouterMiddleware & {
	/**
	 * The request's session, once the guard has let it through. It's read
	 * when called, so a change by an action shows.
	 *
	 * Throws `INVALID_OPTIONS` when the guard hasn't run for this request,
	 * such as in a route outside the ones it guards. Throws `UNAUTHENTICATED`
	 * once an action signed out, and `REFRESH_FAILED` when the access token
	 * can no longer be refreshed.
	 */
	readonly session: (context: RouterContextLike) => Session<U>;
};

/**
 * Makes server middleware that lets only signed-in users through to a route
 * and the routes nested in it ({@link SessionGuard}). Their loaders and
 * actions get the session from its `session(context)`, never `null`.
 *
 * Signed-out users go to `loginPath`, with `?redirectTo=` set to the URL
 * they asked for, for page loads and navigation in the browser alike. Other
 * errors, such as `REFRESH_FAILED` after a failed refresh, reach the route's
 * error boundary.
 *
 * List it in the guarded route's `middleware`, with
 * {@link sessionMiddleware} in the root route. Server middleware runs during
 * navigation in the browser only when a route has a loader to fetch, so give
 * the guarded route a `loader`, even `() => null`.
 *
 * Throws `INVALID_OPTIONS` when `loginPath` or `basename` doesn't start with
 * `/`.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { requireSession } from "@monarcode/session-kit/react-router/server";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * // app/auth/session.server.ts
 * export const signedIn = requireSession(serverAuth);
 *
 * // app/routes/protected.tsx
 * export const middleware = [signedIn];
 * export const loader = () => null;
 * ```
 *
 * @see {@link redirectIfSignedIn} for the sign-in page.
 * @since 0.1.0
 */
export function requireSession<U, I>(
	serverAuth: ServerAuth<U, I>,
	options: SessionGuardOptions = {},
): SessionGuard<U> {
	const { loginPath = "/login", basename } = options;
	// Fails fast on bad paths, before any request.
	loginHref(loginPath, "/");
	stripBasename("/", basename);
	// The requests it let through, by their jar.
	const passed = new WeakSet<CookieJar>();
	const guard: RouterMiddleware = async (args, next) => {
		const jar = routerJar(args.context);
		if (!(await serverAuth.getSession(jar))) {
			const { pathname, search } = urlOf(args);
			const returnTo = safeReturnTo(
				stripBasename(pathname, basename) + search,
				{ loginPath },
			);
			throw redirectTo(
				withBasename(loginHref(loginPath, returnTo), basename),
			);
		}
		passed.add(jar);
		return next();
	};
	return Object.assign(guard, {
		session(context: RouterContextLike): Session<U> {
			const jar = routerJar(context);
			if (!passed.has(jar))
				throw new AuthError(
					"INVALID_OPTIONS",
					"Read the session where requireSession guards the route: list it in the middleware of this route or a route above it",
				);
			const state = serverAuth.forRequest(jar).state.get();
			if (state.status === "authenticated" || state.status === "refreshing")
				return Object.freeze({
					sessionId: state.sessionId,
					user: state.user,
				});
			throw state.status === "unavailable"
				? new AuthError(
						"REFRESH_FAILED",
						"The session can't be used: its access token couldn't be refreshed",
					)
				: new AuthError(
						"UNAUTHENTICATED",
						"Signed out since requireSession let the request through",
					);
		},
	});
}

/**
 * A loader typed by its shape, such as {@link redirectIfSignedIn}'s.
 *
 * @example
 * ```ts
 * import type { RouterLoader } from "@monarcode/session-kit/react-router/server";
 *
 * export const loader: RouterLoader = async () => null;
 * ```
 *
 * @since 0.1.0
 */
export type RouterLoader = (args: RouterArgs) => Promise<null>;

/**
 * Makes the loader for your sign-in page, which sends a signed-in user on to
 * the page's `redirectTo` search param, made safe with `safeReturnTo`.
 * Signed-out users see the page. React Router adds the app's `basename` to
 * the redirect.
 *
 * If the session can't be read, such as after a failed refresh, the sign-in
 * page shows, so the user can sign in again.
 *
 * Throws `INVALID_OPTIONS` when a `loginPath` doesn't start with `/`.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/react-router/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // app/routes/login.tsx
 * export const loader = redirectIfSignedIn(serverAuth);
 * ```
 *
 * @since 0.1.0
 */
export function redirectIfSignedIn<U, I>(
	serverAuth: ServerAuth<U, I>,
	options: SafeReturnToOptions = {},
): RouterLoader {
	// Fails fast on a bad path, before any request.
	safeReturnTo("/", options);
	return async (args) => {
		const jar = routerJar(args.context);
		if (await serverAuth.getSession(jar).catch(() => null)) {
			const redirect = urlOf(args).searchParams.get("redirectTo");
			throw redirectTo(safeReturnTo(redirect, options));
		}
		return null;
	};
}
