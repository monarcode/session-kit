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
 * Options for {@link requireSessionLoader}.
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
 * The loader that {@link requireSessionLoader} makes. It resolves `{ session }`,
 * typed with the client's user.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSessionLoader,
 * 	type RequireSessionLoader,
 * } from "@monarcode/session-kit/react-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * export const loader: RequireSessionLoader<User> = requireSessionLoader(auth);
 * ```
 *
 * @since 0.1.0
 */
export type RequireSessionLoader<U> = (args: {
	request: Request;
}) => Promise<{ session: Session<U> }>;

/**
 * Checks for a signed-in user inside a loader of your own, in data or
 * framework mode, and resolves `{ session }`, which holds no tokens. When
 * the loader does nothing else, use {@link requireSessionLoader} as the
 * loader instead.
 *
 * Signed-out users go to `loginPath`, with `?redirectTo=` set to the URL they
 * asked for. A locked session counts as signed out, as locking is for native
 * apps and the router adapters don't unlock.
 *
 * Other errors, such as `REFRESH_FAILED` after a failed refresh, are
 * rethrown to the route's error element, which can offer `auth.retry()`.
 * A `loginPath` that doesn't start with `/`, or a bad `basename`, rejects
 * with `INVALID_OPTIONS`.
 *
 * Use `SessionOutlet` as the route's element, and call
 * `useAuthRevalidation`, so the loader runs again when the session changes.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { requireSession } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 * declare function fetchOrders(): Promise<string[]>;
 *
 * export async function clientLoader({ request }: { request: Request }) {
 * 	const { session } = await requireSession(auth, { request });
 * 	return { name: session.user.name, orders: await fetchOrders() };
 * }
 * ```
 *
 * @since 0.1.0
 */
export async function requireSession<U>(
	auth: GuardClient<U>,
	options: RequireSessionOptions,
): Promise<{ session: Session<U> }> {
	checkPaths(options);
	return guard(auth, options.request, options);
}

/**
 * Makes the loader that guards a route, for `loader` or `clientLoader`, so
 * only signed-in users get through. It resolves `{ session }`, typed with the
 * client's user, and works as {@link requireSession} does.
 *
 * Pass `loginPath` or `basename` when they aren't the defaults. A
 * `loginPath` that doesn't start with `/`, or a bad `basename`, throws
 * `INVALID_OPTIONS` when the loader is made.
 *
 * @example
 * ```tsx
 * import { createBrowserRouter } from "react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSessionLoader,
 * 	SessionOutlet,
 * } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const router = createBrowserRouter([
 * 	{
 * 		loader: requireSessionLoader(auth),
 * 		element: <SessionOutlet />,
 * 		children: [{ index: true, element: <p>Signed in</p> }],
 * 	},
 * ]);
 * ```
 *
 * @since 0.1.0
 */
export function requireSessionLoader<U>(
	auth: GuardClient<U>,
	options: RequireSessionLoaderOptions = {},
): RequireSessionLoader<U> {
	checkPaths(options);
	return ({ request }) => guard(auth, request, options);
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
 * Options for {@link redirectIfSignedInLoader}.
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
 * The loader that {@link redirectIfSignedInLoader} makes. It reads `redirectTo`
 * from the request's URL, and resolves `null` for a signed-out user.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	redirectIfSignedInLoader,
 * 	type RedirectIfSignedInLoader,
 * } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const loader: RedirectIfSignedInLoader = redirectIfSignedInLoader(auth);
 * ```
 *
 * @since 0.1.0
 */
export type RedirectIfSignedInLoader = (args: {
	request: Request;
}) => Promise<null>;

/**
 * Sends a signed-in user from your sign-in page straight to `redirectTo`,
 * made safe with `safeReturnTo`, inside a loader of your own. When the loader
 * does nothing else, use {@link redirectIfSignedInLoader} instead.
 *
 * If the session can't be read, such as after a failed refresh or while
 * locked, the sign-in page shows, so the user can sign in again.
 *
 * @example
 * ```ts
 * import type { LoaderFunctionArgs } from "react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedIn } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export async function loader({ request }: LoaderFunctionArgs) {
 * 	const search = new URL(request.url).searchParams;
 * 	await redirectIfSignedIn(auth, { redirectTo: search.get("next") });
 * 	return { invited: search.has("invite") };
 * }
 * ```
 *
 * @since 0.1.0
 */
export async function redirectIfSignedIn(
	auth: GuardClient<unknown>,
	options: RedirectIfSignedInOptions,
): Promise<void> {
	await sendOn(auth, options.redirectTo, options.loginPath);
}

/**
 * Makes the loader for your sign-in page, for `loader` or `clientLoader`.
 * It reads `?redirectTo=` from the URL and works as
 * {@link redirectIfSignedIn} does.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { redirectIfSignedInLoader } from "@monarcode/session-kit/react-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * // The sign-in route. A sign-up page never returns to either one.
 * export const clientLoader = redirectIfSignedInLoader(auth, {
 * 	loginPath: ["/login", "/sign-up"],
 * });
 * ```
 *
 * @since 0.1.0
 */
export function redirectIfSignedInLoader(
	auth: GuardClient<unknown>,
	options: RedirectIfSignedInLoaderOptions = {},
): RedirectIfSignedInLoader {
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
