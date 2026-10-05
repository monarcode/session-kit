import {
	createContext,
	createElement,
	useContext,
	useEffect,
	type ReactElement,
	type ReactNode,
} from "react";

import {
	assertAuthSource,
	ClientContext,
	useAuthState,
	type AuthSource,
	type StateOf,
} from "./context.js";

export type AuthHooksOptions<Client extends AuthSource> = {
	/**
	 * Finds the client instead of reading it from `AuthProvider`, for example
	 * from router context. Called as a hook, on every render of every hook.
	 */
	useClient?: () => Client;
};

export type AuthProviderProps<Client extends AuthSource> = {
	/** The client for this tree. On a server, create one per request. */
	client: Client;
	children?: ReactNode;
};

export type AuthHooks<Client extends AuthSource> = {
	/**
	 * Provides `client` to the hooks below it and mounts it while rendered,
	 * starting expiry timers and cross-tab sync. Effects never run on a server,
	 * so server rendering starts no background work.
	 */
	AuthProvider: (props: AuthProviderProps<Client>) => ReactElement;
	/** The client, for actions such as `signIn` and `signOut`. */
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
 * context, so an app with several clients calls it once per client.
 *
 * @example
 * export const { AuthProvider, useAuth, useAuthClient } =
 * 	createAuthHooks<typeof auth>();
 *
 * root.render(<AuthProvider client={auth}><App /></AuthProvider>);
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
		useEffect(() => client.mount(), [client]);
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
