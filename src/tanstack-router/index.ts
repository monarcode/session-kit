import { useRouter, type Register } from "@tanstack/react-router";

import {
	assertAuthSource,
	type AuthSource,
	type StateOf,
} from "../react/context.js";
import { createAuthHooks } from "../react/hooks.js";

export { connectAuth } from "./connect.js";
export { redirectIfSignedIn, requireSession } from "./guards.js";
export { SessionOutlet } from "./outlet.js";

export type { AuthRouter } from "./connect.js";
export type {
	RedirectIfSignedInOptions,
	RequireSessionOptions,
} from "./guards.js";
export type { SessionOutletProps } from "./outlet.js";

/**
 * The auth client type in your registered Router's context, as `auth`, which
 * {@link useAuthClient} returns. It's `never` until the Router is registered.
 *
 * @example
 * ```ts
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import type { RouterAuth } from "@monarcode/session-kit/tanstack-router";
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
 * export function userName(client: RouterAuth) {
 * 	return client.state.get().user?.name;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RouterAuth = Register extends {
	router: { options: { context: { auth?: infer Client } } };
}
	? NonNullable<Client> extends AuthSource
		? NonNullable<Client>
		: never
	: never;

/**
 * Returns the auth client from Router context, where it's `auth`, for
 * actions such as `signIn` and `signOut`. It needs no `AuthProvider`:
 * `connectAuth` mounts the client.
 *
 * The client's type comes from your registered Router ({@link RouterAuth}).
 * Router context is per request in TanStack Start, so this is safe during
 * server rendering.
 *
 * Throws `INVALID_OPTIONS` when Router context has no `auth`.
 *
 * @example
 * ```tsx
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { useAuthClient } from "@monarcode/session-kit/tanstack-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 * const routeTree = createRootRouteWithContext<{ auth: typeof auth }>()();
 * const router = createRouter({ routeTree, context: { auth } });
 * declare module "@tanstack/react-router" {
 * 	interface Register {
 * 		router: typeof router;
 * 	}
 * }
 *
 * export function SignOutButton() {
 * 	const auth = useAuthClient();
 * 	return (
 * 		<button onClick={() => void auth.signOut().catch(console.error)}>
 * 			Sign out
 * 		</button>
 * 	);
 * }
 * ```
 *
 * @since 0.1.0
 */
export function useAuthClient(): RouterAuth {
	const auth: unknown = useRouter().options.context?.auth;
	assertAuthSource(
		auth,
		"Provide an auth client as `auth` in Router context before using auth hooks",
	);
	return auth as RouterAuth;
}

/**
 * Reads the current auth state of the client in Router context, or the part
 * `selector` picks, and re-renders when it changes. With a selector, it
 * re-renders only when that part changes.
 *
 * Typed by your registered Router, as {@link useAuthClient} is. Throws
 * `INVALID_OPTIONS` when Router context has no `auth`.
 *
 * @example
 * ```tsx
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { useAuth } from "@monarcode/session-kit/tanstack-router";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 * const routeTree = createRootRouteWithContext<{ auth: typeof auth }>()();
 * const router = createRouter({ routeTree, context: { auth } });
 * declare module "@tanstack/react-router" {
 * 	interface Register {
 * 		router: typeof router;
 * 	}
 * }
 *
 * export function Greeting() {
 * 	const status = useAuth((state) => state.status);
 * 	return <p>{status === "unauthenticated" ? "Signed out" : "Welcome"}</p>;
 * }
 * ```
 *
 * @since 0.1.0
 */
export const useAuth: {
	(): StateOf<RouterAuth>;
	<T>(selector: (state: StateOf<RouterAuth>) => T): T;
} = createAuthHooks<RouterAuth>({ useClient: useAuthClient }).useAuth;
