import { AuthError } from "../core/errors.js";
import { LOGIN_PATH, loginHref, safeReturnTo } from "../core/return-to.js";
import type { Session } from "../core/types.js";
import {
	refreshBeforeRendering,
	refreshWithin,
	type RequestAuth,
	type ServerAuth,
} from "../server/auth.js";
import {
	pairJars,
	type CookieJar,
	type CookieOptions,
} from "../server/cookies.js";
import { handleSession } from "../server/handler.js";

/**
 * A request's cookie store, as `cookies()` from `next/headers` resolves it.
 * {@link nextJar} reads and writes it, and Next's own store fits.
 *
 * @example
 * ```ts
 * import type { NextCookies } from "@monarcode/session-kit/next";
 * import { cookies } from "next/headers";
 *
 * export async function cookieStore(): Promise<NextCookies> {
 * 	return cookies();
 * }
 * ```
 *
 * @since 0.1.0
 */
export type NextCookies = {
	get: (name: string) => { value: string } | undefined;
	set: (name: string, value: string, options: CookieOptions) => unknown;
	delete: (
		options: { name: string } & Omit<CookieOptions, "maxAge">,
	) => unknown;
};

/**
 * The request {@link proxyJar} reads cookies from. A `NextRequest` fits.
 *
 * @example
 * ```ts
 * import type { ProxyRequest } from "@monarcode/session-kit/next";
 * import type { NextRequest } from "next/server";
 *
 * export const fits = (request: NextRequest): ProxyRequest => request;
 * ```
 *
 * @since 0.1.0
 */
export type ProxyRequest = { cookies: Pick<NextCookies, "get"> };

/**
 * The response {@link proxyJar} sets cookies on. A `NextResponse` fits.
 *
 * @example
 * ```ts
 * import type { ProxyResponse } from "@monarcode/session-kit/next";
 * import { NextResponse } from "next/server";
 *
 * export const response: ProxyResponse = NextResponse.next();
 * ```
 *
 * @since 0.1.0
 */
export type ProxyResponse = { cookies: Pick<NextCookies, "set" | "delete"> };

/**
 * Options for {@link nextJar}.
 *
 * @example
 * ```ts
 * import type { NextJarOptions } from "@monarcode/session-kit/next";
 *
 * export const inAnAction: NextJarOptions = { writable: true };
 * ```
 *
 * @since 0.1.0
 */
export type NextJarOptions = {
	/**
	 * Whether the jar can set cookies. Pass `true` in a Server Function (an
	 * action) or a Route Handler. Server Components can't set cookies, so
	 * there the jar is read-only and never refreshes.
	 * @default false
	 */
	writable?: boolean | undefined;
};

function cookieJar(
	read: (name: string) => string | undefined,
	write: Pick<NextCookies, "set" | "delete"> | undefined,
): CookieJar {
	return {
		writable: write !== undefined,
		get: read,
		set(name, value, options) {
			write?.set(name, value, options);
		},
		// Without `maxAge`: Next deletes by expiring the cookie.
		delete(name, { httpOnly, secure, sameSite, path, domain }) {
			write?.delete({ name, httpOnly, secure, sameSite, path, domain });
		},
	};
}

// One jar per store, so every call during one request shares one.
const jars = new WeakMap<
	object,
	{ readOnly?: CookieJar; writable?: CookieJar }
>();

/**
 * The {@link CookieJar} for `cookies()` from `next/headers`, to pass to
 * `serverAuth` from `@monarcode/session-kit/server`.
 *
 * It's read-only unless you pass `writable: true`, which only a Server
 * Function or a Route Handler may do, as Next throws when a Server Component
 * sets a cookie. A read-only jar can't refresh, so refresh before rendering,
 * in Proxy, with {@link proxyJar}.
 *
 * The read-only jar follows the writable jar for the same store, so a
 * sign-in, sign-out or refresh through the writable one shows in it. The
 * same store and `writable` always give the same jar.
 *
 * @example
 * ```ts
 * import { nextJar } from "@monarcode/session-kit/next";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { cookies } from "next/headers";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * // Read-only, for Server Components.
 * export async function getSession() {
 * 	return serverAuth.getSession(nextJar(await cookies()));
 * }
 * ```
 *
 * @example
 * In a Server Function, pass `writable`:
 * ```ts
 * "use server";
 *
 * import { nextJar } from "@monarcode/session-kit/next";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { cookies } from "next/headers";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * export async function signOut() {
 * 	await serverAuth.signOut(nextJar(await cookies(), { writable: true }));
 * }
 * ```
 *
 * @since 0.1.0
 */
export function nextJar(
	store: NextCookies,
	options: NextJarOptions = {},
): CookieJar {
	const writable = options.writable === true;
	let cached = jars.get(store);
	if (!cached) {
		cached = {};
		jars.set(store, cached);
	}
	const key = writable ? "writable" : "readOnly";
	const jar = (cached[key] ??= cookieJar(
		(name) => store.get(name)?.value,
		writable ? store : undefined,
	));
	// Paired, so a sign-in through the writable jar shows in the read-only one.
	if (cached.readOnly && cached.writable)
		pairJars(cached.readOnly, cached.writable);
	return jar;
}

const proxyJars = new WeakMap<object, CookieJar>();

/**
 * The {@link CookieJar} for a request in Next's Proxy (`proxy.ts`). It reads
 * `request`'s cookies and sets new ones on `response`. Use it with
 * `serverAuth.refreshIfDue`, so the pages that render the request see a fresh
 * token through {@link nextJar}.
 *
 * Return `response` from Proxy, or the new cookies are lost. Pages on the
 * Edge runtime may still read the old cookie. Every call with the same
 * `response` returns the same jar.
 *
 * @example
 * ```ts
 * import { proxyJar } from "@monarcode/session-kit/next";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { NextResponse, type NextRequest } from "next/server";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * export async function proxy(request: NextRequest) {
 * 	const response = NextResponse.next();
 * 	// If the refresh fails, the page still renders with the cookie as it is.
 * 	const jar = proxyJar(request, response);
 * 	await serverAuth.refreshIfDue(jar).catch(() => {});
 * 	return response;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function proxyJar(
	request: ProxyRequest,
	response: ProxyResponse,
): CookieJar {
	let jar = proxyJars.get(response);
	if (!jar) {
		jar = cookieJar(
			(name) => request.cookies.get(name)?.value,
			response.cookies,
		);
		proxyJars.set(response, jar);
	}
	return jar;
}

/**
 * Options for {@link nextSession}. Pass Next's own `cookies` and `redirect`,
 * as this entry point doesn't import `next`.
 *
 * @example
 * ```ts
 * import type { NextSessionOptions } from "@monarcode/session-kit/next";
 * import { cookies } from "next/headers";
 * import { redirect } from "next/navigation";
 *
 * export const options: NextSessionOptions = {
 * 	cookies,
 * 	redirect,
 * 	loginPath: "/sign-in",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type NextSessionOptions = {
	/** `cookies` from `next/headers`. */
	cookies: () => Promise<NextCookies>;
	/** `redirect` from `next/navigation`. */
	redirect: (url: string) => never;
	/**
	 * Your sign-in page's path, starting with `/`.
	 * @default "/login"
	 */
	loginPath?: string | undefined;
	/**
	 * How soon before the access token expires `refresh` refreshes it, in
	 * seconds, as `serverAuth.refreshIfDue` explains.
	 * @default 60
	 */
	within?: number | undefined;
};

/**
 * The session in a Next.js app, made by {@link nextSession}: reads and
 * guards for Server Components, the request's session for Server Functions
 * and Route Handlers, and the refresh for Proxy.
 *
 * @example
 * ```ts
 * import type { NextSession } from "@monarcode/session-kit/next";
 *
 * type User = { id: number; firstName: string };
 * declare const session: NextSession<User, User>;
 *
 * // app/orders/page.tsx: the user, or the sign-in page.
 * export default async function Orders() {
 * 	const { user } = await session.require("/orders");
 * 	return user.firstName;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type NextSession<U, I> = {
	/**
	 * Resolves who is signed in, from the cookie, or `null`. It doesn't set
	 * cookies, so it works in Server Components. Proxy refreshes first.
	 */
	get: () => Promise<Session<U> | null>;
	/**
	 * Resolves the session, or redirects to the sign-in page with
	 * `?redirectTo=` set to `path`, the page's own path, as Server Components
	 * don't know their URL.
	 *
	 * Next adds a `basePath` to redirects from pages and Server Functions,
	 * but not from Route Handlers. With a `basePath`, a Route Handler should
	 * read the session with `get` and answer 401 instead.
	 */
	require: (path: string) => Promise<Session<U>>;
	/**
	 * For your sign-in page: redirects a signed-in user to `redirectTo`,
	 * usually the `redirectTo` search param, made safe with `safeReturnTo`.
	 * It resolves for a signed-out user, or when the session can't be read.
	 */
	redirectIfSignedIn: (redirectTo: unknown) => Promise<void>;
	/**
	 * The request's session for Server Components, which doesn't set
	 * cookies. Read its `credentials` to call your API while rendering.
	 */
	readOnly: () => Promise<RequestAuth<U, I>>;
	/**
	 * The request's session for Server Functions and Route Handlers, which
	 * sets cookies. Sign in and out with it, and renew the access token.
	 */
	writable: () => Promise<RequestAuth<U, I>>;
	/**
	 * For Proxy: refreshes access that expires within `within` seconds,
	 * setting the new cookie on `response`, and resolves `response`. A
	 * failed refresh is left for the page, which reads the session as it is.
	 */
	refresh: <R extends ProxyResponse>(
		request: ProxyRequest,
		response: R,
	) => Promise<R>;
};

/**
 * Gives a Next.js app its session ({@link NextSession}), over {@link nextJar}
 * and {@link proxyJar}. Make it once, beside `serverAuth`, in a module only
 * server code imports.
 *
 * Server Components read it with `get` and guard pages with `require`.
 * Server Functions and Route Handlers sign in and out through `writable()`.
 * `proxy.ts` refreshes with `refresh`, as rendering can't set cookies.
 *
 * Throws `INVALID_OPTIONS` without `cookies` or `redirect`, when
 * `loginPath` doesn't start with `/`, or when `within` is negative.
 *
 * @example
 * ```ts
 * import { nextSession } from "@monarcode/session-kit/next";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { cookies } from "next/headers";
 * import { redirect } from "next/navigation";
 * import { NextResponse, type NextRequest } from "next/server";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * export const session = nextSession(serverAuth, { cookies, redirect });
 *
 * // proxy.ts
 * export function proxy(request: NextRequest) {
 * 	return session.refresh(request, NextResponse.next());
 * }
 * ```
 *
 * @since 0.1.0
 */
export function nextSession<U, I>(
	serverAuth: ServerAuth<U, I>,
	options: NextSessionOptions,
): NextSession<U, I> {
	const cookies = options?.cookies;
	const redirect = options?.redirect;
	if (typeof cookies !== "function" || typeof redirect !== "function")
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass cookies from next/headers and redirect from next/navigation",
		);
	const loginPath = options.loginPath ?? LOGIN_PATH;
	// Fails fast on bad options, before any request.
	loginHref(loginPath, "/");
	const within = refreshWithin({ within: options.within });
	const jar = async (writable: boolean) =>
		nextJar(await cookies(), { writable });
	const get = async () => serverAuth.getSession(await jar(false));
	return {
		get,
		async require(path) {
			const session = await get();
			if (session) return session;
			return redirect(
				loginHref(loginPath, safeReturnTo(path, { loginPath })),
			);
		},
		async redirectIfSignedIn(redirectTo) {
			// Outside the catch: Next's `redirect` throws to redirect.
			if (await get().catch(() => null))
				redirect(safeReturnTo(redirectTo, { loginPath }));
		},
		readOnly: async () => serverAuth.forRequest(await jar(false)),
		writable: async () => serverAuth.forRequest(await jar(true)),
		async refresh(request, response) {
			await refreshBeforeRendering(
				serverAuth,
				proxyJar(request, response),
				within,
			);
			return response;
		},
	};
}

/**
 * The Route Handlers {@link sessionRoute} makes, for `GET` and `POST`.
 *
 * @example
 * ```ts
 * import type { NextSessionRoute } from "@monarcode/session-kit/next";
 *
 * declare const route: NextSessionRoute;
 *
 * export const { GET, POST } = route;
 * ```
 *
 * @since 0.1.0
 */
export type NextSessionRoute = {
	GET: (request: Request) => Promise<Response>;
	POST: (request: Request) => Promise<Response>;
};

/**
 * Options for {@link sessionRoute}. Pass Next's own `cookies`, as this entry
 * point doesn't import `next`.
 *
 * @example
 * ```ts
 * import type { NextSessionRouteOptions } from "@monarcode/session-kit/next";
 * import { cookies } from "next/headers";
 *
 * export const options: NextSessionRouteOptions = { cookies };
 * ```
 *
 * @since 0.1.0
 */
export type NextSessionRouteOptions = {
	/** `cookies` from `next/headers`. */
	cookies: () => Promise<NextCookies>;
};

/**
 * Makes the Route Handlers for your session route, which answers
 * `createMirrorAuth`'s `endpoint`: the browser client reads the session,
 * signs out and gets the access token through it. Pass `cookies` from
 * `next/headers` ({@link NextSessionRouteOptions}).
 *
 * It answers this site's own pages only, as `sessionHandler` from
 * `@monarcode/session-kit/server` explains, and serves the access token only
 * when `createServerAuth` has `clientCredentials`. Sign-in stays your own
 * Server Function.
 *
 * Throws `INVALID_OPTIONS` without `cookies`.
 *
 * @example
 * ```ts
 * import { sessionRoute } from "@monarcode/session-kit/next";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { cookies } from "next/headers";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // app/api/session/route.ts
 * export const { GET, POST } = sessionRoute(serverAuth, { cookies });
 * ```
 *
 * @since 0.1.0
 */
export function sessionRoute<U, I>(
	serverAuth: ServerAuth<U, I>,
	options: NextSessionRouteOptions,
): NextSessionRoute {
	const cookies = options?.cookies;
	if (typeof cookies !== "function")
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass cookies from next/headers to sessionRoute",
		);
	const handle = handleSession(serverAuth);
	const route = (request: Request) =>
		handle(request, async () => nextJar(await cookies(), { writable: true }));
	return { GET: route, POST: route };
}
