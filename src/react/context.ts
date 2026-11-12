import {
	createContext,
	createElement,
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	type ReactElement,
	type ReactNode,
} from "react";

import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import { AuthError } from "../core/errors.js";
import type { AuthClient, AuthState } from "../core/types.js";

/**
 * A layout effect where there's a screen (browsers and React Native define
 * `window`), so a session restored at mount shows before the first paint. On
 * a server, a passive one, as React warns about layout effects there.
 */
export function useMountEffect(
	effect: () => void | (() => void),
	deps: readonly unknown[],
): void {
	// The runtime never changes, so every render calls the same hook.
	const useMount = typeof window === "undefined" ? useEffect : useLayoutEffect;
	useMount(effect, deps);
}

/**
 * What the React bindings need from an auth client: its `state`, and `mount`
 * to start background work while rendered. A `createAuth` or
 * `createMirrorAuth` client fits.
 *
 * @example
 * ```ts
 * import type { AuthSource } from "@monarcode/session-kit/react";
 *
 * export function isSignedIn(auth: AuthSource): boolean {
 * 	const { status } = auth.state.get();
 * 	return status === "authenticated" || status === "refreshing";
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthSource = Pick<AuthClient<unknown, unknown>, "state" | "mount">;

/**
 * The state type of a client: what `useAuth()` returns
 * ({@link AuthState}).
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import type { StateOf } from "@monarcode/session-kit/react";
 *
 * type User = { name: string };
 * type AppAuth = AuthClient<User, User>;
 *
 * export const displayName = (state: StateOf<AppAuth>) =>
 * 	state.user?.name ?? "Guest";
 * ```
 *
 * @since 0.1.0
 */
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
		throw new AuthError("INVALID_OPTIONS", message);
	}
}

/** The nearest `AuthProvider`'s client, or `client` when given. */
export function useProvidedClient(client?: AuthSource): AuthSource | null {
	const provided = useContext(ClientContext);
	return client ?? provided;
}

/**
 * Subscribes to `client`'s state; re-renders only when the selection changes.
 */
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

/** What adapter components need from a client: state, `mount`, and `retry`. */
export type RetryableSource = AuthSource &
	Pick<AuthClient<unknown, unknown>, "retry">;

/**
 * What the `unavailable` render prop of an adapter component, such as React
 * Router's `SessionOutlet` or Expo's `SessionGate`, receives.
 *
 * @example
 * ```tsx
 * import {
 * 	SessionOutlet,
 * 	type UnavailableProps,
 * } from "@monarcode/session-kit/react-router";
 *
 * function SessionUnavailable({ error, retry }: UnavailableProps) {
 * 	return (
 * 		<div role="alert">
 * 			<p>{error?.message ?? "Can't reach the server."}</p>
 * 			<button onClick={retry}>Try again</button>
 * 		</div>
 * 	);
 * }
 *
 * export const layout = (
 * 	<SessionOutlet loginPath="/login" unavailable={SessionUnavailable} />
 * );
 * ```
 *
 * @since 0.1.0
 */
export type UnavailableProps = {
	/**
	 * Why access is unavailable, such as a failed refresh or a locked keychain.
	 */
	error: AuthError | null;
	/**
	 * Tries again, as `auth.retry()` does. A repeated failure stays in
	 * `state.error`.
	 */
	retry: () => void;
};

/**
 * The client an adapter component watches: `client`, or the nearest
 * `AuthProvider`'s. Throws, naming `component`, when there is neither. Keeps
 * the client mounted while rendered, so a component given only a `client`
 * restores the session too; mounts are counted, so this is harmless under
 * `AuthProvider`.
 */
export function useAdapterClient(
	client: RetryableSource | undefined,
	component: string,
): RetryableSource {
	const provided = useProvidedClient(client);
	assertAuthSource(
		provided,
		`Render AuthProvider, or pass a client, before rendering ${component}`,
	);
	const auth = provided as RetryableSource;
	useMountEffect(
		function mountClient() {
			return auth.mount();
		},
		[auth],
	);
	return auth;
}

/**
 * Renders `unavailable` for an `unavailable` state, or throws the state's
 * error to the nearest error boundary when there is no `unavailable`.
 */
export function renderUnavailable(
	auth: RetryableSource,
	state: AuthState<unknown> & { status: "unavailable" },
	unavailable: ((props: UnavailableProps) => ReactNode) | undefined,
): ReactElement {
	if (!unavailable)
		throw (
			state.error ?? new AuthError("REFRESH_FAILED", "Access is unavailable")
		);
	const retry = () => {
		// A failure shows in `state.error`, which re-renders this.
		void auth.retry().catch(() => {});
	};
	return createElement(
		Fragment,
		null,
		unavailable({ error: state.error, retry }),
	);
}
