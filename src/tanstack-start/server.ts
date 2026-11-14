import type { RequestServerFn } from "@tanstack/react-start";
import {
	deleteCookie,
	getCookie,
	getRequest,
	getResponseHeader,
	setCookie,
	setResponseHeader,
} from "@tanstack/react-start/server";

import { AuthError } from "../core/errors.js";
import {
	lazyRequestAuth,
	middlewareOptions,
	refreshBeforeRendering,
	type RequestAuth,
	type ServerAuth,
	type SessionMiddlewareOptions,
} from "../server/auth.js";
import type { CookieJar, CookieOptions } from "../server/cookies.js";

/** `options` without unset attributes, which Start's types don't accept. */
function attributes({ domain, maxAge, ...rest }: CookieOptions) {
	return {
		...rest,
		...(domain !== undefined && { domain }),
		...(maxAge !== undefined && { maxAge }),
	};
}

// One jar per request, so every call while Start handles it shares one.
const jars = new WeakMap<Request, CookieJar>();

/**
 * The {@link CookieJar} for the request TanStack Start is handling, to pass
 * to `serverAuth` from `@monarcode/session-kit/server`. {@link startAuth}
 * passes it for you. Use it in a server function, request middleware, a
 * server route, or `beforeLoad` and loaders while they run on the server.
 * Every call during one request returns the same jar.
 *
 * Start adds its cookies to the response, a redirect's included, but not
 * once it has started streaming a page. A cookie set after that is lost, so
 * refresh before rendering, in request middleware with
 * `serverAuth.refreshIfDue`.
 *
 * Throws `INVALID_OPTIONS` outside a request, such as in the browser. Import
 * it only from server code, such as a server function's handler, so Start's
 * compiler leaves it out of the browser bundle.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { startJar } from "@monarcode/session-kit/tanstack-start/server";
 * import { createServerFn } from "@tanstack/react-start";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * export const getSessionFn = createServerFn().handler(() =>
 * 	serverAuth.getSession(startJar()),
 * );
 * ```
 *
 * @since 0.1.0
 */
export function startJar(): CookieJar {
	let request: Request;
	try {
		request = getRequest();
	} catch (cause) {
		throw new AuthError(
			"INVALID_OPTIONS",
			"There's no request here: use the session on the server, while TanStack Start handles a request, such as in a server function or request middleware",
			{ cause },
		);
	}
	let jar = jars.get(request);
	if (!jar) {
		jar = {
			// Start gives no sign once a page streams, so this can't turn false.
			writable: true,
			get: (name) => getCookie(name),
			set: (name, value, options) =>
				setCookie(name, value, attributes(options)),
			delete: (name, options) => deleteCookie(name, attributes(options)),
		};
		jars.set(request, jar);
	}
	return jar;
}

/**
 * The session of the request TanStack Start is handling ({@link RequestAuth}),
 * with every `serverAuth` method and no cookie jar. Each call finds the
 * current request, so make it once, at module level, beside `serverAuth`.
 *
 * Use it in server functions, request middleware, server routes, and
 * `beforeLoad` and loaders while they run on the server. As
 * {@link startJar} explains, Start can't set a cookie once a page streams,
 * so refresh before rendering, in request middleware with `refreshIfDue`.
 *
 * Outside a request, such as in the browser, its methods reject with
 * `INVALID_OPTIONS`, and `isCurrent` and `state` throw it. Import it only
 * from server code, as you do `serverAuth`.
 *
 * @example
 * ```ts
 * import { createServerAuth } from "@monarcode/session-kit/server";
 * import { startAuth } from "@monarcode/session-kit/tanstack-start/server";
 * import { createServerFn } from "@tanstack/react-start";
 * import { z } from "zod";
 *
 * declare const secret: string;
 *
 * const serverAuth = createServerAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.number(), firstName: z.string() }),
 * 	secret,
 * });
 * export const session = startAuth(serverAuth);
 *
 * export const getSessionFn = createServerFn().handler(() =>
 * 	session.getSession(),
 * );
 * ```
 *
 * @since 0.1.0
 */
export function startAuth<U, I>(
	serverAuth: ServerAuth<U, I>,
): RequestAuth<U, I> {
	return lazyRequestAuth(serverAuth, startJar);
}

/**
 * Refreshes the session before each request, while the response can still
 * set the cookie. Pass it to Start's `createMiddleware().server()`, and list
 * that middleware in `requestMiddleware` in `src/start.ts`.
 *
 * It refreshes access that expires within `within` seconds, so pages and
 * server functions don't refresh while rendering, once a cookie can't be
 * set. A failed refresh doesn't fail the request. Routes read the session
 * as usual, and an error there reaches the route's error component.
 *
 * It sets `Cache-Control` to `private, no-store` on each response that
 * doesn't set its own, unless you pass `cacheControl`.
 *
 * Start bundles `src/start.ts` for the browser too, and strips only what's
 * inside `.server()` from it. Calling `refreshSession` there keeps
 * `serverAuth` out of the browser bundle.
 *
 * Throws `INVALID_OPTIONS` when `within` is negative.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { refreshSession } from "@monarcode/session-kit/tanstack-start/server";
 * import { createMiddleware, createStart } from "@tanstack/react-start";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * const sessionMiddleware = createMiddleware({ type: "request" }).server(
 * 	refreshSession(serverAuth),
 * );
 *
 * export const startInstance = createStart(() => ({
 * 	requestMiddleware: [sessionMiddleware],
 * }));
 * ```
 *
 * @since 0.1.0
 */
export function refreshSession<U, I, TRegister = {}, TMiddlewares = undefined>(
	serverAuth: ServerAuth<U, I>,
	options?: SessionMiddlewareOptions,
): RequestServerFn<TRegister, TMiddlewares, undefined> {
	const { within, cacheControl } = middlewareOptions(options);
	return async ({ next }) => {
		await refreshBeforeRendering(serverAuth, startJar(), within);
		const result = await next();
		// Start applies helper headers over a response's own: check both.
		if (
			cacheControl !== false &&
			!result.response.headers.has("Cache-Control") &&
			getResponseHeader("Cache-Control") === undefined
		)
			setResponseHeader("Cache-Control", cacheControl);
		return result;
	};
}
