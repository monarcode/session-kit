import { redirect } from "@tanstack/react-router";

import {
	guardSession,
	sessionOrNull,
	type GuardClient,
} from "../core/guard.js";
import { loginHref, safeReturnTo } from "../core/return-to.js";
import type { Session } from "../core/types.js";

export type RequireSessionOptions = {
	/** The route location, from `beforeLoad`'s `location`. */
	location: { href: string };
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
};

/**
 * Guards a route in `beforeLoad`. Signed-out users are redirected to
 * `loginPath` with `?redirectTo=` set to where they were going. Signed-in
 * users get `{ session }` in route context, typed and never `null`; it holds
 * no tokens. A failed refresh is rethrown as `REFRESH_FAILED` for the route's
 * error component, which can offer `auth.retry()`. Render the guarded
 * route's children through `SessionOutlet`.
 *
 * @example
 * beforeLoad: ({ context, location }) =>
 * 	requireSession(context.auth, { location, loginPath: "/login" }),
 */
export async function requireSession<U>(
	auth: GuardClient<U>,
	options: RequireSessionOptions,
): Promise<{ session: Session<U> }> {
	// Fails fast on a bad path, before any session is read.
	loginHref(options.loginPath, "/");
	const session = await guardSession(auth);
	if (!session)
		throw redirect({
			href: loginHref(options.loginPath, options.location.href),
		});
	return { session };
}

export type RedirectIfSignedInOptions = {
	/** Where to send a signed-in user, usually the `redirectTo` search param. */
	redirectTo: unknown;
	/** The sign-in path, never returned to. Default: `"/login"`. */
	loginPath?: string | readonly string[];
};

/**
 * Guards the sign-in route in `beforeLoad`: a signed-in user is redirected to
 * `redirectTo`, checked with `safeReturnTo`. If the session cannot be
 * resolved, for example after a failed refresh, the sign-in page shows so the
 * user can sign in again.
 *
 * @example
 * beforeLoad: ({ context, search }) =>
 * 	redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
 */
export async function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options: RedirectIfSignedInOptions,
): Promise<void> {
	const session = await sessionOrNull(auth);
	if (session) {
		throw redirect({
			href: safeReturnTo(options.redirectTo, {
				loginPath: options.loginPath,
			}),
		});
	}
}
