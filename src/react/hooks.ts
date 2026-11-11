import {
	createContext,
	createElement,
	useContext,
	type ReactElement,
	type ReactNode,
} from "react";

import {
	assertAuthSource,
	ClientContext,
	useAuthState,
	useMountEffect,
	type AuthSource,
	type StateOf,
} from "./context.js";

/**
 * Options for {@link createAuthHooks}.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import type { AuthHooksOptions } from "@monarcode/session-kit/react";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const options: AuthHooksOptions<typeof auth> = {
 * 	useClient: () => auth,
 * };
 * ```
 *
 * @since 0.1.0
 */
export type AuthHooksOptions<Client extends AuthSource> = {
	/**
	 * Finds the client some other way than `AuthProvider`, such as from router
	 * context with `useRouterAuth`. It's called as a hook, inside every hook,
	 * on every render. The hooks then need no `AuthProvider`, so mount the
	 * client another way, such as with `connectAuth`. Default: reads the
	 * nearest `AuthProvider`.
	 */
	useClient?: (() => Client) | undefined;
};

/**
 * Props for the `AuthProvider` that {@link createAuthHooks} returns.
 *
 * @example
 * ```tsx
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	createAuthHooks,
 * 	type AuthProviderProps,
 * } from "@monarcode/session-kit/react";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const { AuthProvider } = createAuthHooks<typeof auth>();
 *
 * export function Providers({
 * 	children,
 * }: Pick<AuthProviderProps<typeof auth>, "children">) {
 * 	return <AuthProvider client={auth}>{children}</AuthProvider>;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthProviderProps<Client extends AuthSource> = {
	/** The client for this tree. On a server, create one per request. */
	client: Client;
	/** The tree that reads `client` through the hooks. */
	children?: ReactNode | undefined;
};

/**
 * The provider and hooks {@link createAuthHooks} returns, typed for one
 * client.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { createAuthHooks, type AuthHooks } from "@monarcode/session-kit/react";
 *
 * type User = { name: string };
 * type AppAuth = AuthClient<User, User>;
 *
 * export const hooks: AuthHooks<AppAuth> = createAuthHooks<AppAuth>();
 * ```
 *
 * @since 0.1.0
 */
export type AuthHooks<Client extends AuthSource> = {
	/**
	 * Gives `client` to the hooks below it, and mounts it while rendered,
	 * which starts expiry timers and following other tabs. Mounting restores
	 * the saved session, before the first paint with synchronous storage and
	 * schemas. On a server, nothing starts, as effects don't run there.
	 */
	AuthProvider: (props: AuthProviderProps<Client>) => ReactElement;
	/**
	 * The client, for actions such as `signIn` and `signOut`. Throws
	 * `INVALID_OPTIONS` when there is no client: no `AuthProvider` above, or
	 * a `useClient` that returned none.
	 */
	useAuthClient: () => Client;
	/**
	 * The current auth state, or the part `selector` picks. Re-renders only
	 * when the selection changes.
	 */
	useAuth: {
		(): StateOf<Client>;
		<T>(selector: (state: StateOf<Client>) => T): T;
	};
};

/**
 * Creates React hooks typed for one auth client. Each call has its own
 * context, so an app with several clients calls it once per client. With
 * TanStack Router, pass `useRouterAuth` as `useClient` instead of
 * rendering `AuthProvider`. See {@link AuthHooksOptions}.
 *
 * @example
 * ```tsx
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { createAuthHooks } from "@monarcode/session-kit/react";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * // Render `<AuthProvider client={auth}>` around the app.
 * export const { AuthProvider, useAuth, useAuthClient } =
 * 	createAuthHooks<typeof auth>();
 *
 * export function SignOutButton() {
 * 	const name = useAuth((state) => state.user?.name);
 * 	const client = useAuthClient();
 * 	const signOut = () => void client.signOut().catch(console.error);
 * 	return <button onClick={signOut}>Sign out {name}</button>;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function createAuthHooks<Client extends AuthSource>(
	options: AuthHooksOptions<Client> = {},
): AuthHooks<Client> {
	const Context = createContext<Client | null>(null);
	// Fixed at creation, so every render calls the same hooks.
	const useResolvedClient =
		options.useClient ??
		function useContextClient(): Client | null {
			return useContext(Context);
		};

	function AuthProvider({ client, children }: AuthProviderProps<Client>) {
		useMountEffect(
			function mountClient() {
				return client.mount();
			},
			[client],
		);
		return createElement(
			ClientContext.Provider,
			{ value: client },
			createElement(Context.Provider, { value: client }, children),
		);
	}

	function useAuthClient(): Client {
		const client = useResolvedClient();
		assertAuthSource(
			client,
			options.useClient
				? "useClient did not return an auth client"
				: "Render AuthProvider with an auth client before using auth hooks",
		);
		return client;
	}

	function useAuth<T>(selector?: (state: StateOf<Client>) => T) {
		return useAuthState(
			useAuthClient(),
			(state) => (selector ? selector(state) : state) as T,
		);
	}

	return {
		AuthProvider,
		useAuthClient,
		useAuth: useAuth as AuthHooks<Client>["useAuth"],
	};
}
