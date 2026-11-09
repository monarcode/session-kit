import { redirect } from "react-router";

import { AuthError } from "../core/errors.js";
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
 * } from "@monarcode/session-kit/react-router";
 *
 * declare const request: Request;
 *
 * // For a router created with `{ basename: "/app" }`.
 * export const options: RequireSessionOptions = {
 * 	request,
 * 	loginPath: "/login",
 * 	basename: "/app",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionOptions = {
	/** The loader's `request`, whose URL signed-out users come back to. */
	request: Request;
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
	/**
	 * The router's `basename`, if it has one. Loaders see URLs that include
	 * it, but redirects add it again, so `redirectTo` must leave it out.
	 */
	basename?: string | undefined;
};

/** `pathname` without `basename`, matched ignoring case as React Router does. */
function stripBasename(pathname: string, basename = "/"): string {
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

/**
 * Guards a route in its loader, in data or framework mode. Signed-out users
 * are redirected to `loginPath` with `?redirectTo=` set to the requested URL;
 * so are users of a locked session, since locking is for native apps. Pass
 * the router's `basename`, if any, so `redirectTo` leaves it out. Signed-in
 * users get `{ session }`, which holds no tokens. Errors from `getSession`,
 * such as `REFRESH_FAILED` from a failed refresh or `PERSISTENCE_FAILED` from
 * a failed restore, are rethrown for the route's error element, which can
 * offer `auth.retry()`. Render the route's element as `SessionOutlet`, and
 * call `useAuthRevalidation` so the loader runs again when auth changes.
 *
 * @example
 * ```tsx
 * import { createBrowserRouter } from "react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSession,
 * 	SessionOutlet,
 * } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const router = createBrowserRouter([
 * 	{
 * 		loader: ({ request }) =>
 * 			requireSession(auth, { request, loginPath: "/login" }),
 * 		element: <SessionOutlet loginPath="/login" />,
 * 		children: [{ index: true, element: <p>Signed in</p> }],
 * 	},
 * ]);
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

/**
 * Options for {@link redirectIfSignedIn}.
 *
 * @example
 * ```ts
 * import type {
 * 	RedirectIfSignedInOptions,
 * } from "@monarcode/session-kit/react-router";
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
 * Guards the sign-in route in its loader: a signed-in user is redirected to
 * `redirectTo`, checked with `safeReturnTo`. If the session cannot be
 * resolved, for example after a failed refresh or while locked, the sign-in
 * page shows so the user can sign in again.
 *
 * @example
 * ```ts
 * import type { LoaderFunctionArgs } from "react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/react-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * export async function loginLoader({ request }: LoaderFunctionArgs) {
 * 	const redirectTo = new URL(request.url).searchParams.get("redirectTo");
 * 	await redirectIfSignedIn(auth, { redirectTo });
 * 	return null;
 * }
 * ```
 *
 * @since 0.1.0
 */
export async function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options: RedirectIfSignedInOptions,
): Promise<void> {
	if (await sessionOrNull(auth)) {
		throw redirect(
			safeReturnTo(options.redirectTo, { loginPath: options.loginPath }),
		);
	}
}
