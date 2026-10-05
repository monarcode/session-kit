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
};

/**
 * Guards a route in its loader, in data or framework mode. Signed-out users
 * are redirected to `loginPath` with `?redirectTo=` set to the requested URL.
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
	const session = await guardSession(auth);
	if (!session) {
		const url = new URL(options.request.url);
		throw redirect(
			loginHref(options.loginPath, url.pathname + url.search + url.hash),
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
