import { redirect } from "@tanstack/react-router";

import { AuthError } from "../core/errors.js";
import { safeReturnTo } from "../core/return-to.js";

/** What the guards need from an auth client. */
type GuardClient<S extends { sessionId: string }> = {
	getSession: () => Promise<S | null>;
	isCurrent: (session: { sessionId: string }) => boolean;
};

/** How often a guard reads the session again when it changes mid-check. */
const MAX_ATTEMPTS = 3;

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
export async function requireSession<S extends { sessionId: string }>(
	auth: GuardClient<S>,
	options: RequireSessionOptions,
): Promise<{ session: S }> {
	if (!options.loginPath.startsWith("/"))
		throw new Error(`loginPath must start with "/": ${options.loginPath}`);
	// A session that changes while it is read gets read again: the change
	// re-runs guards anyway, so an error here would only flash.
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const session = await auth.getSession();
		if (!session) {
			const login = new URL(options.loginPath, "https://auth.invalid");
			login.searchParams.set("redirectTo", options.location.href);
			throw redirect({ href: login.pathname + login.search + login.hash });
		}
		if (auth.isCurrent(session)) return { session };
	}
	throw new AuthError(
		"SESSION_CHANGED",
		"The session kept changing; retry navigation",
	);
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
	auth: GuardClient<{ sessionId: string }>,
	options: RedirectIfSignedInOptions,
): Promise<void> {
	let session: { sessionId: string } | null;
	try {
		session = await auth.getSession();
	} catch {
		return;
	}
	if (session) {
		throw redirect({
			href: safeReturnTo(options.redirectTo, {
				loginPath: options.loginPath,
			}),
		});
	}
}
