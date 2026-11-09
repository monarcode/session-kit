import { redirect } from "@tanstack/react-router";

import {
	guardSession,
	sessionOrNull,
	type GuardClient,
} from "../core/guard.js";
import { loginHref, safeReturnTo } from "../core/return-to.js";
import type { Session } from "../core/types.js";

/**
 * Options for {@link requireSession}.
 *
 * @example
 * ```ts
 * import type {
 * 	RequireSessionOptions,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * declare const location: { href: string };
 *
 * export const options: RequireSessionOptions = {
 * 	location,
 * 	loginPath: "/login",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionOptions = {
	/** The route location, from `beforeLoad`'s `location`. */
	location: { href: string };
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
};

/**
 * Guards a route in `beforeLoad`. Signed-out users are redirected to
 * `loginPath` with `?redirectTo=` set to where they were going; so are users
 * of a locked session, since locking is for native apps. Signed-in users get
 * `{ session }` in route context, typed and never `null`; it holds no tokens.
 * Errors from `getSession`, such as `REFRESH_FAILED` from a failed refresh
 * or `PERSISTENCE_FAILED` from a failed restore, are rethrown for the route's
 * error component, which can offer `auth.retry()`. Render the guarded route's
 * children through `SessionOutlet`, and call `connectAuth` so the guard runs
 * again when auth changes.
 *
 * @example
 * ```tsx
 * import {
 * 	createRootRouteWithContext,
 * 	createRoute,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSession,
 * 	SessionOutlet,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()();
 *
 * // Child routes read `session` from their route context.
 * export const authenticatedRoute = createRoute({
 * 	getParentRoute: () => rootRoute,
 * 	id: "authenticated",
 * 	beforeLoad: ({ context, location }) =>
 * 		requireSession(context.auth, { location, loginPath: "/login" }),
 * 	component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
 * });
 * ```
 *
 * @since 0.1.0
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

/**
 * Options for {@link redirectIfSignedIn}.
 *
 * @example
 * ```ts
 * import type {
 * 	RedirectIfSignedInOptions,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * declare const redirectTo: string | null;
 *
 * // A sign-up page never returns to either sign-in page.
 * export const options: RedirectIfSignedInOptions = {
 * 	redirectTo,
 * 	loginPath: ["/login", "/sign-up"],
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RedirectIfSignedInOptions = {
	/** Where to send a signed-in user, usually the `redirectTo` search param. */
	redirectTo: unknown;
	/** The sign-in path, never returned to. Default: `"/login"`. */
	loginPath?: string | readonly string[] | undefined;
};

/**
 * Guards the sign-in route in `beforeLoad`: a signed-in user is redirected to
 * `redirectTo`, checked with `safeReturnTo`. If the session cannot be
 * resolved, for example after a failed refresh or while locked, the sign-in
 * page shows so the user can sign in again.
 *
 * @example
 * ```ts
 * import {
 * 	createRootRouteWithContext,
 * 	createRoute,
 * } from "@tanstack/react-router";
 * import { safeReturnTo, type AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()();
 *
 * export const loginRoute = createRoute({
 * 	getParentRoute: () => rootRoute,
 * 	path: "/login",
 * 	validateSearch: (search: Record<string, unknown>) => ({
 * 		redirectTo: safeReturnTo(search.redirectTo),
 * 	}),
 * 	beforeLoad: ({ context, search }) =>
 * 		redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
 * });
 * ```
 *
 * @since 0.1.0
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
