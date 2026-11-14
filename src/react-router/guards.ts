import { redirect } from "react-router";

import {
	guardSession,
	sessionOrNull,
	type GuardClient,
} from "../core/guard.js";
import { LOGIN_PATH, loginHref, safeReturnTo } from "../core/return-to.js";
import type { Session } from "../core/types.js";
import { stripBasename } from "./basename.js";

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
 * 	loginPath: "/sign-in",
 * 	basename: "/app",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionOptions = RequireSessionLoaderOptions & {
	/**
	 * The loader's `request`. Signed-out users come back to its URL after
	 * signing in.
	 */
	request: Request;
};

/**
 * Options for the loader that `requireSession(auth, options)` makes.
 *
 * @example
 * ```ts
 * import type {
 * 	RequireSessionLoaderOptions,
 * } from "@monarcode/session-kit/react-router";
 *
 * // For a router created with `{ basename: "/app" }`.
 * export const options: RequireSessionLoaderOptions = {
 * 	loginPath: "/sign-in",
 * 	basename: "/app",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionLoaderOptions = {
	/**
	 * Your sign-in page's path, starting with `/`. Use the same one as
	 * `SessionOutlet`'s.
	 * @default "/login"
	 */
	loginPath?: string | undefined;
	/**
	 * The router's `basename`, if it has one. Loaders see URLs that include
	 * it, but redirects add it again, so `redirectTo` must leave it out.
	 */
	basename?: string | undefined;
};

/**
 * The loader that `requireSession(auth)` makes. It resolves `{ session }`,
 * typed with the client's user.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSession,
 * 	type RequireSessionLoader,
 * } from "@monarcode/session-kit/react-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * export const loader: RequireSessionLoader<User> = requireSession(auth);
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionLoader<U> = (args: {
	request: Request;
}) => Promise<{ session: Session<U> }>;

/**
 * Guards a route in its loader, in data or framework mode, so only
 * signed-in users get through. They get `{ session }`, which holds no tokens.
 * `requireSession(auth)` is the loader itself.
 *
 * Signed-out users go to `loginPath`, with `?redirectTo=` set to the URL they
 * asked for. A locked session counts as signed out, as locking is for native
 * apps and the router adapters don't unlock.
 *
 * Other errors, such as `REFRESH_FAILED` after a failed refresh, are
 * rethrown to the route's error element, which can offer `auth.retry()`.
 *
 * Use `SessionOutlet` as the route's element, and call
 * `useAuthRevalidation`, so the loader runs again when the session changes.
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
 * 		loader: requireSession(auth),
 * 		element: <SessionOutlet />,
 * 		children: [{ index: true, element: <p>Signed in</p> }],
 * 	},
 * ]);
 * ```
 *
 * @since 0.1.0
 */
export function requireSession<U>(
	auth: GuardClient<U>,
	options: RequireSessionOptions,
): Promise<{ session: Session<U> }>;
/**
 * The guard as a loader of its own, for `loader` or `clientLoader`. Pass
 * `loginPath` or `basename` when they aren't the defaults.
 *
 * It returns the loader, so pass it as one. Inside a loader of your own,
 * call the form that takes `request`: awaiting this one checks nothing.
 *
 * Throws `INVALID_OPTIONS` when it's made, for a `loginPath` that doesn't
 * start with `/` or a bad `basename`.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { requireSession } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const clientLoader = requireSession(auth, { loginPath: "/sign-in" });
 * ```
 *
 * @since 0.1.0
 */
export function requireSession<U>(
	auth: GuardClient<U>,
	options?: RequireSessionLoaderOptions,
): RequireSessionLoader<U>;
export function requireSession<U>(
	auth: GuardClient<U>,
	options: Partial<RequireSessionOptions> = {},
): RequireSessionLoader<U> | Promise<{ session: Session<U> }> {
	const { request, ...rest } = options;
	if (request)
		return (async () => {
			checkPaths(rest);
			return guard(auth, request, rest);
		})();
	checkPaths(rest);
	return (args) => guard(auth, args.request, rest);
}

/** Fails fast on a bad path, before any session is read. */
function checkPaths(options: RequireSessionLoaderOptions) {
	loginHref(options.loginPath ?? LOGIN_PATH, "/");
	stripBasename("/", options.basename);
}

async function guard<U>(
	auth: GuardClient<U>,
	request: Request,
	options: RequireSessionLoaderOptions,
): Promise<{ session: Session<U> }> {
	const session = await guardSession(auth);
	if (!session) {
		const url = new URL(request.url);
		const path = stripBasename(url.pathname, options.basename);
		throw redirect(
			loginHref(
				options.loginPath ?? LOGIN_PATH,
				path + url.search + url.hash,
			),
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
export type RedirectIfSignedInOptions = RedirectIfSignedInLoaderOptions & {
	/**
	 * Where to send a signed-in user, usually the `redirectTo` search param.
	 * It's checked with `safeReturnTo`.
	 */
	redirectTo: unknown;
};

/**
 * Options for the loader that `redirectIfSignedIn(auth, options)` makes.
 *
 * @example
 * ```ts
 * import type {
 * 	RedirectIfSignedInLoaderOptions,
 * } from "@monarcode/session-kit/react-router";
 *
 * // A sign-up page never returns to either sign-in page.
 * export const options: RedirectIfSignedInLoaderOptions = {
 * 	loginPath: ["/login", "/sign-up"],
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RedirectIfSignedInLoaderOptions = {
	/**
	 * Your sign-in page's path, or several. `redirectTo` never sends the user
	 * back to one.
	 * @default "/login"
	 */
	loginPath?: string | readonly string[] | undefined;
};

/**
 * The loader that `redirectIfSignedIn(auth)` makes. It reads `redirectTo`
 * from the request's URL, and resolves `null` for a signed-out user.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	redirectIfSignedIn,
 * 	type RedirectIfSignedInLoader,
 * } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const loader: RedirectIfSignedInLoader = redirectIfSignedIn(auth);
 * ```
 *
 * @since 0.1.0
 */
export type RedirectIfSignedInLoader = (args: {
	request: Request;
}) => Promise<null>;

/**
 * Guards your sign-in page in its loader, so a signed-in user goes straight
 * to `redirectTo`, made safe with `safeReturnTo`. `redirectIfSignedIn(auth)`
 * is the loader itself, and reads `redirectTo` from the URL's search.
 *
 * If the session can't be read, such as after a failed refresh or while
 * locked, the sign-in page shows, so the user can sign in again.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * // The sign-in route.
 * export const clientLoader = redirectIfSignedIn(auth);
 * ```
 *
 * @since 0.1.0
 */
export function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options: RedirectIfSignedInOptions,
): Promise<void>;
/**
 * The guard as a loader of its own, for `loader` or `clientLoader`, with
 * `redirectTo` read from the URL's search.
 *
 * It returns the loader, so pass it as one. Inside a loader of your own,
 * call the form that takes `redirectTo`: awaiting this one checks nothing.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const loader = redirectIfSignedIn(auth, {
 * 	loginPath: ["/login", "/sign-up"],
 * });
 * ```
 *
 * @since 0.1.0
 */
export function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options?: RedirectIfSignedInLoaderOptions,
): RedirectIfSignedInLoader;
export function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options: Partial<RedirectIfSignedInOptions> = {},
): RedirectIfSignedInLoader | Promise<void> {
	if ("redirectTo" in options)
		return sendOn(auth, options.redirectTo, options.loginPath);
	return async ({ request }) => {
		const redirectTo = new URL(request.url).searchParams.get("redirectTo");
		await sendOn(auth, redirectTo, options.loginPath);
		return null;
	};
}

async function sendOn(
	auth: GuardClient<unknown>,
	redirectTo: unknown,
	loginPath: string | readonly string[] | undefined,
): Promise<void> {
	if (await sessionOrNull(auth))
		throw redirect(safeReturnTo(redirectTo, { loginPath }));
}
