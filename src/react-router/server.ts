import { AuthError } from "../core/errors.js";
import type { CookieJar, CookieOptions } from "../server/cookies.js";

/**
 * The shape of the `context` React Router passes to server middleware,
 * loaders and actions in framework mode: a `RouterContextProvider`, one per
 * request. What {@link routerJar} and {@link cookieJarMiddleware} find the
 * request's jar by. Typed by its shape, so this entry point doesn't depend on
 * React Router's types.
 *
 * @example
 * ```ts
 * import { routerJar, type RouterContextLike } from "@monarcode/session-kit/react-router/server";
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

/** The cookies a request sent and those its response will set. */
type RequestCookies = {
	request: Request;
	jar: CookieJar;
	/** `Set-Cookie` lines by cookie name: the last write to each wins. */
	written: Map<string, string>;
	committed: boolean;
};

// One per request, by its context: every middleware, loader and action of
// the request shares it.
const requests = new WeakMap<object, RequestCookies>();

const SAME_SITE = { lax: "Lax", strict: "Strict", none: "None" } as const;

function setCookieLine(
	name: string,
	value: string,
	options: CookieOptions,
): string {
	return [
		`${name}=${value}`,
		`Path=${options.path}`,
		...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
		...(options.maxAge === undefined
			? ["Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"]
			: [`Max-Age=${options.maxAge}`]),
		`SameSite=${SAME_SITE[options.sameSite]}`,
		...(options.secure ? ["Secure"] : []),
		"HttpOnly",
	].join("; ");
}

/** The `Cookie` header's values by name, the first of each as servers read them. */
function parseCookies(header: string | null): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const pair of header?.split(";") ?? []) {
		const equals = pair.indexOf("=");
		if (equals === -1) continue;
		const name = pair.slice(0, equals).trim();
		if (name && !cookies.has(name))
			cookies.set(name, pair.slice(equals + 1).trim());
	}
	return cookies;
}

function requestCookies(request: Request): RequestCookies {
	let sent: Map<string, string> | undefined;
	const cookies: RequestCookies = {
		request,
		written: new Map(),
		committed: false,
		jar: {
			get writable() {
				return !cookies.committed;
			},
			get: (name) =>
				(sent ??= parseCookies(request.headers.get("cookie"))).get(name),
			set(name, value, options) {
				if (!cookies.committed)
					cookies.written.set(name, setCookieLine(name, value, options));
			},
			delete(name, options) {
				if (!cookies.committed)
					cookies.written.set(
						name,
						setCookieLine(name, "", { ...options, maxAge: undefined }),
					);
			},
		},
	};
	return cookies;
}

/** `response` with `lines` as `Set-Cookie` headers. */
function withCookies(response: Response, lines: string[]): Response {
	try {
		for (const line of lines) response.headers.append("Set-Cookie", line);
		return response;
	} catch {
		// Immutable headers, as on `Response.redirect()` or a `fetch` response.
		const copy = new Response(response.body, response);
		for (const line of lines) copy.headers.append("Set-Cookie", line);
		return copy;
	}
}

/**
 * Server middleware that gives each request a {@link CookieJar}, found with
 * {@link routerJar}, and sets the cookies written to it on the response,
 * redirects and error responses included. List it first in the root route's
 * `middleware`, so it wraps the rest. Needs React Router's middleware: React
 * Router 8, or 7.9 and later with `future.v8_middleware`.
 *
 * The jar can set cookies until the response leaves the middleware. After
 * that, as while a loader's deferred data streams, it is read-only: nothing
 * is refreshed or saved, so refresh before rendering with
 * `serverAuth.refreshIfDue` in middleware.
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
	// Listed twice for one request: the outer one sets the cookies. Never a
	// jar another request made, even with a `context` the app reused.
	const current = requests.get(context);
	if (current?.request === request && !current.committed) return next();
	const cookies = requestCookies(request);
	requests.set(context, cookies);
	let response: Response;
	try {
		response = await next();
	} finally {
		cookies.committed = true;
	}
	return cookies.written.size === 0
		? response
		: withCookies(response, [...cookies.written.values()]);
}

/**
 * The {@link CookieJar} of the request React Router is handling, for
 * `serverAuth` from `@monarcode/session-kit/server`: call it with `context`
 * in server middleware, loaders and actions, after
 * {@link cookieJarMiddleware}. Every call during one request returns the
 * same jar. Throws `INVALID_OPTIONS` when the middleware hasn't run for
 * `context`, as in a client loader.
 *
 * @example
 * ```ts
 * import { routerJar, type RouterContextLike } from "@monarcode/session-kit/react-router/server";
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
	const cookies = requests.get(context);
	if (!cookies)
		throw new AuthError(
			"INVALID_OPTIONS",
			"Add cookieJarMiddleware to the root route's middleware, and call routerJar(context) on the server, in middleware, loaders and actions",
		);
	return cookies.jar;
}
