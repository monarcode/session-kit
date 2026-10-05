import { createContext, useCallback, useContext } from "react";

import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { AuthClient } from "../core/types.js";

/**
 * What React bindings need from an auth client: reactive state, and `mount`
 * to start background work while rendered. Any `createAuth` client fits.
 */
export type AuthSource = Pick<AuthClient<unknown, unknown>, "state" | "mount">;

/** The state type of a client. */
export type StateOf<Client extends AuthSource> = ReturnType<
	Client["state"]["get"]
>;

/**
 * Filled by every `AuthProvider`, whichever `createAuthHooks` made it, so
 * components shipped by router adapters can find the nearest client.
 */
export const ClientContext = createContext<AuthSource | null>(null);

export function assertAuthSource(
	value: unknown,
	message: string,
): asserts value is AuthSource {
	if (
		typeof value !== "object" ||
		value === null ||
		!("state" in value) ||
		typeof value.state !== "object" ||
		value.state === null ||
		!("get" in value.state) ||
		typeof value.state.get !== "function" ||
		!("subscribe" in value.state) ||
		typeof value.state.subscribe !== "function" ||
		!("mount" in value) ||
		typeof value.mount !== "function"
	) {
		throw new Error(message);
	}
}

/** The nearest `AuthProvider`'s client, or `client` when given. */
export function useProvidedClient(client?: AuthSource): AuthSource | null {
	const provided = useContext(ClientContext);
	return client ?? provided;
}

/** Subscribes to `client`'s state, re-rendering only when the selection changes. */
export function useAuthState<Client extends AuthSource, T>(
	client: Client,
	selector: (state: StateOf<Client>) => T,
): T {
	const subscribe = useCallback(
		(onChange: () => void) => client.state.subscribe(onChange).unsubscribe,
		[client],
	);
	const getSnapshot = useCallback(() => client.state.get(), [client]);
	return useSyncExternalStoreWithSelector(
		subscribe,
		getSnapshot,
		getSnapshot,
		(value) => selector(value as StateOf<Client>),
	);
}
