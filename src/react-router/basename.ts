import { AuthError } from "../core/errors.js";

/**
 * `pathname` without `basename`, matched ignoring case as React Router does.
 */
export function stripBasename(pathname: string, basename = "/"): string {
	if (!basename.startsWith("/"))
		throw new AuthError(
			"INVALID_OPTIONS",
			`basename must start with "/": ${basename}`,
		);
	const base = basename.replace(/\/+$/, "");
	if (!base) return pathname;
	const lower = pathname.toLowerCase();
	const prefix = base.toLowerCase();
	if (lower === prefix) return "/";
	return lower.startsWith(`${prefix}/`)
		? pathname.slice(base.length)
		: pathname;
}

/** `href`, an in-app path, under `basename`. */
export function withBasename(href: string, basename = "/"): string {
	return basename.replace(/\/+$/, "") + href;
}
