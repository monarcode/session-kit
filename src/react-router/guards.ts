import { redirect } from "react-router";

import {
	guardSession,
	sessionOrNull,
	type GuardClient,
} from "../core/guard.js";
import { loginHref, safeReturnTo } from "../core/return-to.js";

export type RequireSessionOptions = {
	/** The loader's `request`, whose URL signed-out users come back to. */
	request: Request;
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
	/**
	 * The router's `basename`, if it has one. Loaders see URLs that include
	 * it, but redirects add it again, so `redirectTo` must leave it out.
	 */
	basename?: string;
};

/** `pathname` without `basename`, matched ignoring case as React Router does. */
function stripBasename(pathname: string, basename = "/"): string {
	if (!basename.startsWith("/"))
		throw new Error(`basename must start with "/": ${basename}`);
	const base = basename.replace(/\/+$/, "");
	if (!base) return pathname;
	const lower = pathname.toLowerCase();
	const prefix = base.toLowerCase();
	if (lower === prefix) return "/";
	return lower.startsWith(`${prefix}/`)
		? pathname.slice(base.length)
		: pathname;
}

/**
 * Guards a route in its loader, in data or framework mode. Signed-out users
 * are redirected to `loginPath` with `?redirectTo=` set to the requested URL.
 * Pass the router's `basename`, if any, so `redirectTo` leaves it out.
 * Signed-in users get `{ session }`, which holds no tokens. A failed refresh
 * is rethrown as `REFRESH_FAILED` for the route's error element, which can
 * offer `auth.retry()`.
 *
 * @example
 * loader: ({ request }) =>
 * 	requireSession(auth, { request, loginPath: "/login" }),
 */
export async function requireSession<S extends { sessionId: string }>(
	auth: GuardClient<S>,
	options: RequireSessionOptions,
): Promise<{ session: S }> {
	// Fails fast on a bad path, before any session is read.
	loginHref(options.loginPath, "/");
	stripBasename("/", options.basename);
	const session = await guardSession(auth);
	if (!session) {
		const url = new URL(options.request.url);
		const path = stripBasename(url.pathname, options.basename);
		throw redirect(
			loginHref(options.loginPath, path + url.search + url.hash),
		);
	}
	return { session };
}

export type RedirectIfSignedInOptions = {
	/** Where to send a signed-in user, usually the `redirectTo` search param. */
	redirectTo: unknown;
	/** The sign-in path, never returned to. Default: `"/login"`. */
	loginPath?: string | readonly string[];
};

/**
 * Guards the sign-in route in its loader: a signed-in user is redirected to
 * `redirectTo`, checked with `safeReturnTo`. If the session cannot be
 * resolved, for example after a failed refresh, the sign-in page shows so the
 * user can sign in again.
 *
 * @example
 * loader: async ({ request }) => {
 * 	const redirectTo = new URL(request.url).searchParams.get("redirectTo");
 * 	await redirectIfSignedIn(auth, { redirectTo });
 * 	return null;
 * },
 */
export async function redirectIfSignedIn(
	auth: GuardClient<{ sessionId: string }>,
	options: RedirectIfSignedInOptions,
): Promise<void> {
	if (await sessionOrNull(auth)) {
		throw redirect(
			safeReturnTo(options.redirectTo, { loginPath: options.loginPath }),
		);
	}
}
