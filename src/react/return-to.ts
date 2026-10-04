export type SafeReturnToOptions = {
	/**
	 * Sign-in paths that must not be returned to, to avoid redirect loops.
	 * Matched ignoring case, percent-encoding, and trailing slashes.
	 * Default: `"/login"`.
	 */
	loginPath?: string | readonly string[];
};

/** Normalizes a pathname the way Router matching treats it by default. */
function routeKey(pathname: string): string {
	return decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, "") || "/";
}

export function safeReturnTo(
	value: unknown,
	options: SafeReturnToOptions = {},
): string {
	const loginPaths = [options.loginPath ?? "/login"].flat();
	for (const path of loginPaths) {
		if (!path.startsWith("/"))
			throw new Error(`loginPath must start with "/": ${path}`);
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
			loginPaths.some((path) => routeKey(path) === key)
		)
			return "/";
		return url.pathname + url.search + url.hash;
	} catch {
		return "/";
	}
}
