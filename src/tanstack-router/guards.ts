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
	/**
	 * The route's location, from `beforeLoad`'s `location`. Signed-out users
	 * come back to it after signing in.
	 */
	location: { href: string };
	/** Your sign-in page's path, starting with `/`, such as `"/login"`. */
	loginPath: string;
};

/**
 * Guards a route in `beforeLoad`, so only signed-in users get through. They
 * get `{ session }` in route context, typed and never `null`, with no
 * tokens in it.
 *
 * Signed-out users go to `loginPath`, with `?redirectTo=` set to where they
 * were going. A locked session counts as signed out, as locking is for
 * native apps and the router adapters don't unlock.
 *
 * Other errors, such as `REFRESH_FAILED` after a failed refresh, are
 * rethrown to the route's error component, which can offer `auth.retry()`.
 *
 * Render the route's children with `SessionOutlet`, and call `connectAuth`,
 * so the guard runs again when the session changes.
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
	/**
	 * Where to send a signed-in user, usually the `redirectTo` search param.
	 * It's checked with `safeReturnTo`.
	 */
	redirectTo: unknown;
	/**
	 * Your sign-in page's path, or several. `redirectTo` never sends the user
	 * back to one. Default: `"/login"`.
	 */
	loginPath?: string | readonly string[] | undefined;
};

/**
 * Guards your sign-in page in `beforeLoad`, so a signed-in user goes straight
 * to `redirectTo`, made safe with `safeReturnTo`.
 *
 * If the session can't be read, such as after a failed refresh or while
 * locked, the sign-in page shows, so the user can sign in again.
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
