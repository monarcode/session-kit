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
	 * Sign-in paths that must not be returned to, to avoid redirect loops.
	 * Matched ignoring case, percent-encoding, and trailing slashes.
	 * Default: `"/login"`.
	 */
	loginPath?: string | readonly string[] | undefined;
};

/** Normalizes a pathname the way Router matching treats it by default. */
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
 * Checks a path to send the user back to after signing in, such as a
 * `?redirectTo=` search param. Returns it, normalized, when it is a path in
 * this app, and `"/"` for anything else: other origins, protocol-relative
 * `//host` paths, backslashes, spaces, control characters, and the sign-in
 * page itself, so a stale `redirectTo` cannot loop. Query and fragment are
 * kept. Throws an `AuthError` with code `INVALID_OPTIONS` when a `loginPath`
 * doesn't start with `/`. See {@link SafeReturnToOptions}.
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
 * The sign-in URL for `loginPath`, with `?redirectTo=` set to `returnTo` so
 * the user comes back after signing in.
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
