import { AuthError } from "./errors.js";

/**
 * Options for {@link safeReturnTo}.
 *
 * @example
 * ```ts
 * import type { SafeReturnToOptions } from "@monarcode/session-kit";
 *
 * const options: SafeReturnToOptions = { loginPath: ["/login", "/sign-in"] };
 * ```
 *
 * @since 0.1.0
 */
export type SafeReturnToOptions = {
	/**
	 * Your sign-in page's path, or several. A path to it is replaced with
	 * `"/"`, so signing in never sends the user back to sign in. Matched
	 * ignoring case, percent-encoding and trailing slashes.
	 * @default "/login"
	 */
	loginPath?: string | readonly string[] | undefined;
};

/** Normalizes a pathname the way routers match paths by default. */
function routeKey(pathname: string): string {
	return decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, "") || "/";
}

/** `path` without its query and fragment. */
export const pathnameOf = (path: string) => path.replace(/[?#].*$/s, "");

/**
 * Whether two in-app paths lead to the same route, by the rule `loginPath`
 * uses: ignoring case, percent-encoding, and trailing slashes. Query and
 * fragment are ignored.
 */
export function sameRoute(a: string, b: string): boolean {
	try {
		return routeKey(pathnameOf(a)) === routeKey(pathnameOf(b));
	} catch {
		// Malformed percent-encoding.
		return pathnameOf(a) === pathnameOf(b);
	}
}

/**
 * Makes a "send me back here after sign-in" path safe to redirect to, such as
 * a `?redirectTo=` search param. It returns the path, normalized, when it
 * leads somewhere in your app, query and fragment included.
 *
 * Anything else returns `"/"`:
 * - another site, including protocol-relative `//host` paths;
 * - a path with backslashes, spaces or control characters;
 * - the sign-in page itself, so a stale `redirectTo` can't loop.
 *
 * Throws `INVALID_OPTIONS` when a `loginPath` doesn't start with `/`.
 *
 * @example
 * ```ts
 * import { safeReturnTo } from "@monarcode/session-kit";
 *
 * safeReturnTo("/settings?tab=profile"); // "/settings?tab=profile"
 * safeReturnTo("https://evil.example"); // "/"
 * safeReturnTo("/login"); // "/"
 * safeReturnTo(undefined); // "/"
 * ```
 *
 * @since 0.1.0
 */
export function safeReturnTo(
	value: unknown,
	options: SafeReturnToOptions = {},
): string {
	const loginPaths = [options.loginPath ?? "/login"].flat();
	for (const path of loginPaths) {
		if (!path.startsWith("/"))
			throw new AuthError(
				"INVALID_OPTIONS",
				`loginPath must start with "/": ${path}`,
			);
	}
	if (
		typeof value !== "string" ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		// Rejecting backslashes, spaces, and control characters is the point.
		// oxlint-disable-next-line no-control-regex
		/[\\\u0000- \u007f]/.test(value)
	)
		return "/";
	// A placeholder origin (`.invalid` never resolves), only to resolve the
	// path and see whether it leaves the app.
	const base = "https://auth.invalid";
	try {
		const url = new URL(value, base);
		const key = routeKey(url.pathname);
		if (
			url.origin !== base ||
			// Dot segments can resolve to `//host`, which browsers and routers
			// read as another origin: `/.//evil.com` becomes `//evil.com`.
			url.pathname.startsWith("//") ||
			loginPaths.some((path) => routeKey(path) === key)
		)
			return "/";
		return url.pathname + url.search + url.hash;
	} catch {
		return "/";
	}
}

/**
 * Builds the sign-in page's URL, with `?redirectTo=` set to `returnTo`, so
 * the user comes back after signing in. The guards use it. Use it in a guard
 * of your own, such as in a route handler.
 *
 * `returnTo` is encoded as is. Pass a path you read from the request through
 * {@link safeReturnTo} first. Throws `INVALID_OPTIONS` when `loginPath`
 * doesn't start with `/`.
 *
 * @example
 * ```ts
 * import { loginHref, safeReturnTo } from "@monarcode/session-kit";
 *
 * loginHref("/login", "/orders?page=2"); // "/login?redirectTo=%2Forders%3Fpage%3D2"
 *
 * export function signInFirst(request: Request) {
 * 	const url = new URL(request.url);
 * 	const location = loginHref("/login", safeReturnTo(url.pathname + url.search));
 * 	return new Response(null, { status: 302, headers: { location } });
 * }
 * ```
 *
 * @since 0.1.0
 */
export function loginHref(loginPath: string, returnTo: string): string {
	if (!loginPath.startsWith("/"))
		throw new AuthError(
			"INVALID_OPTIONS",
			`loginPath must start with "/": ${loginPath}`,
		);
	const login = new URL(loginPath, "https://auth.invalid");
	login.searchParams.set("redirectTo", returnTo);
	return login.pathname + login.search + login.hash;
}
