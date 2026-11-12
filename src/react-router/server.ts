import { AuthError } from "../core/errors.js";
import type { CookieJar } from "../server/cookies.js";
import { requestJar, type RequestJar } from "../server/request-jar.js";

/**
 * The `context` React Router passes to server middleware, loaders and actions
 * in framework mode: a `RouterContextProvider`, one per request.
 * {@link routerJar} and {@link cookieJarMiddleware} find the request's jar by
 * it. It's typed by its shape, so this entry point doesn't depend on React
 * Router's types.
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
 * export async function loader({ context }: { context: RouterContextLike }) {
 * 	return { session: await serverAuth.getSession(routerJar(context)) };
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
 * List it first in the root route's `middleware`, so it wraps the rest. It
 * needs React Router 8, or 7.9 and later with `future.v8_middleware`.
 *
 * The jar can set cookies until the response leaves the middleware, which
 * first waits for a refresh under way, so its new tokens are saved. After
 * that, such as while a loader's deferred data streams, it's read-only.
 * Nothing is saved, and a call that needs a refresh rejects with
 * `REFRESH_FAILED`. Refresh before rendering, with `serverAuth.refreshIfDue`
 * in middleware.
 *
 * @example
 * ```ts
 * import {
 * 	cookieJarMiddleware,
 * 	routerJar,
 * 	type RouterContextLike,
 * } from "@monarcode/session-kit/react-router/server";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // app/root.tsx: refresh access that expires within a minute.
 * export const middleware = [
 * 	cookieJarMiddleware,
 * 	async ({ context }: { context: RouterContextLike }) => {
 * 		await serverAuth.refreshIfDue(routerJar(context)).catch(() => {});
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
 * `serverAuth` from `@monarcode/session-kit/server`. Call it with `context`
 * in server middleware, loaders and actions, after
 * {@link cookieJarMiddleware}. Every call during one request returns the
 * same jar.
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
			"Add cookieJarMiddleware to the root route's middleware, and call routerJar(context) on the server, in middleware, loaders and actions",
		);
	return current.cookies.jar;
}
