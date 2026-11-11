import { useRouter, type Register } from "@tanstack/react-router";

import { assertAuthSource } from "../react/context.js";

export { connectAuth } from "./connect.js";
export { redirectIfSignedIn, requireSession } from "./guards.js";
export { SessionOutlet } from "./outlet.js";

export type {
	RedirectIfSignedInOptions,
	RequireSessionOptions,
} from "./guards.js";
export type { SessionOutletProps } from "./outlet.js";

/**
 * The auth client type in your registered Router's context, which
 * {@link useRouterAuth} returns. It's `never` until the Router is registered.
 *
 * @example
 * ```ts
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import type { RegisteredAuth } from "@monarcode/session-kit/tanstack-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()();
 * const router = createRouter({ routeTree: rootRoute, context: { auth } });
 *
 * declare module "@tanstack/react-router" {
 * 	interface Register {
 * 		router: typeof router;
 * 	}
 * }
 *
 * export function userName(client: RegisteredAuth) {
 * 	return client.state.get().user?.name;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredAuth = Register extends {
	router: { options: { context: { auth: infer Client } } };
}
	? Client
	: never;

/**
 * Reads the auth client from Router context, where it's `auth`. Pass it to
 * `createAuthHooks` as `useClient`, so the hooks need no `AuthProvider`.
 * Then mount the client with `connectAuth`.
 *
 * Router context is per request in TanStack Start, so this is safe during
 * server rendering. Throws `INVALID_OPTIONS` when Router context has no
 * `auth`. The client's type comes from your registered Router
 * ({@link RegisteredAuth}).
 *
 * @example
 * ```ts
 * import { createAuthHooks } from "@monarcode/session-kit/react";
 * import { useRouterAuth } from "@monarcode/session-kit/tanstack-router";
 *
 * // With the Router registered, as `RegisteredAuth` shows.
 * export const { useAuth, useAuthClient } = createAuthHooks({
 * 	useClient: useRouterAuth,
 * });
 * ```
 *
 * @since 0.1.0
 */
export function useRouterAuth(): RegisteredAuth {
	const auth: unknown = useRouter().options.context?.auth;
	assertAuthSource(
		auth,
		"Provide an auth client as `auth` in Router context before using auth hooks",
	);
	return auth as RegisteredAuth;
}
