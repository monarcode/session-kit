import {
	pairJars,
	type CookieJar,
	type CookieOptions,
} from "../server/cookies.js";

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
