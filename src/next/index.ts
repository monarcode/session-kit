import type { CookieJar, CookieOptions } from "../server/cookies.js";

/**
 * A request's cookie store, as `cookies()` from `next/headers` resolves it:
 * what {@link nextJar} reads and writes. Next's own store fits.
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
 * What {@link proxyJar} reads from in Proxy: a `NextRequest` fits.
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
 * What {@link proxyJar} sets cookies on in Proxy: a `NextResponse` fits.
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
	 * Whether the jar sets cookies: `true` in a Server Function (an action) or
	 * a Route Handler. Default: `false`, for Server Components, where Next
	 * refuses writes. A read-only jar never refreshes, so it can't spend a
	 * refresh token whose replacement it couldn't save.
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
 * The {@link CookieJar} of `cookies()` from `next/headers`, for `serverAuth`
 * from `@monarcode/session-kit/server`. It is read-only unless `writable` is
 * `true`, which only a Server Function or a Route Handler may pass: Next
 * throws when a Server Component sets a cookie, and a refresh there would
 * lose its new tokens. Refresh before rendering with {@link proxyJar}
 * instead. Every call with the same store and `writable` returns the same
 * jar.
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
	return (cached[key] ??= cookieJar(
		(name) => store.get(name)?.value,
		writable ? store : undefined,
	));
}

const proxyJars = new WeakMap<object, CookieJar>();

/**
 * The {@link CookieJar} of a request in Next's Proxy (`proxy.ts`), for
 * `serverAuth.refreshIfDue`: it reads `request`'s cookies and sets them on
 * `response`. Next passes cookies set there to the Server Components that
 * render the same request on the Node.js runtime, the default, so refreshing
 * in Proxy keeps the access token current for {@link nextJar}'s read-only
 * jars; pages on the Edge runtime may read the old cookie. Return `response`
 * from Proxy, or the cookies are lost. Every call with the same `response`
 * returns the same jar.
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
 * 	await serverAuth.refreshIfDue(proxyJar(request, response)).catch(() => {});
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
