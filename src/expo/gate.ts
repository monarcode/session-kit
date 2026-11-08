import {
	createElement,
	Fragment,
	useEffect,
	useState,
	type ReactElement,
	type ReactNode,
} from "react";

import { SplashScreen } from "expo-router";

import { debuggerOf } from "../core/debug.js";
import type { AuthError } from "../core/errors.js";
import {
	renderUnavailable,
	useAdapterClient,
	useAuthState,
	type AuthSource,
	type RetryableSource,
	type UnavailableProps,
} from "../react/context.js";
import { useRememberedLink } from "./deep-link.js";
import { watchForeground } from "./foreground.js";

export type { UnavailableProps };

export type SessionGateProps = {
	/** The root navigator, usually a `Stack` guarded with `Stack.Protected`. */
	children?: ReactNode;
	/**
	 * Shown instead of the navigator while access is unavailable, such as
	 * after a failed refresh. Without it, the error is thrown to the root
	 * layout's `ErrorBoundary`. That boundary's `retry` only renders again,
	 * and a failed refresh stays failed until `auth.retry()`, so call both.
	 */
	unavailable?: (props: UnavailableProps) => ReactNode;
	/** The client to watch. Default: the nearest `AuthProvider`'s. */
	client?: RetryableSource;
	/**
	 * Whether the rest of the app is ready for its first screen, such as
	 * fonts or remote config loaded. Until it is `true`, as well as while the
	 * session is restored, the gate renders nothing and keeps the splash
	 * screen up. That holds only before the splash screen is first hidden,
	 * even if the gate remounts: `ready` going `false` later changes nothing
	 * on screen. The deep link opened after a sign-in always waits for it.
	 * Default: `true`.
	 */
	ready?: boolean;
};

// Clients whose first screen was shown, by their `state`, so a gate that
// remounts, as after an error boundary's retry, doesn't hold again with the
// splash screen already hidden.
const shownClients = new WeakSet<object>();

/**
 * Whether the first screen has been shown: `false` until `ready` is first
 * `true`, then `true` for good. Updated during render, so the first screen
 * renders in the same pass that decides to show it.
 */
function useShown(auth: AuthSource, ready: boolean): boolean {
	const [shown, setShown] = useState(() => shownClients.has(auth.state));
	if (ready && !shown) setShown(true);
	return shown || ready;
}

// The last gate event per client. StrictMode runs effects twice, and React
// renders a throwing component again, so an event can repeat with nothing
// new to say.
const lastEvents = new WeakMap<object, readonly unknown[]>();

/** Logs a gate event, unless it repeats the last one for this client. */
function logGate(
	auth: AuthSource,
	message: string,
	error?: AuthError | null,
	detail?: unknown,
) {
	const debug = debuggerOf(auth);
	if (!debug.on) return;
	const event = [message, error, detail];
	const last = lastEvents.get(auth.state);
	if (last?.every((value, index) => value === event[index])) return;
	lastEvents.set(auth.state, event);
	debug.log("gate", message, undefined, error ?? undefined);
}

function hideSplash() {
	void SplashScreen.hideAsync().catch(() => {});
}

/**
 * A key that changes only when one account replaces another without a
 * sign-out between them. Not the `sessionId` itself, as `SessionOutlet`
 * uses: on a sign-in or sign-out, `Stack.Protected` already swaps the
 * screens, so remounting the whole navigator as well would only rebuild it
 * while it opens the screens it now admits. Updated during render, so the
 * account swap and the remount land in the same commit.
 */
function useAccountKey(sessionId: string | null): number {
	const [account, setAccount] = useState({ sessionId, key: 0 });
	if (account.sessionId !== sessionId) {
		const switched = account.sessionId !== null && sessionId !== null;
		setAccount({ sessionId, key: account.key + (switched ? 1 : 0) });
	}
	return account.key;
}

/**
 * Wraps the root navigator in `app/_layout.tsx`, inside `AuthProvider` or
 * with a `client`, and adds what Expo Router's `Stack.Protected` lacks:
 *
 * - **While the session is restored**, and until `ready`, it renders
 *   nothing, so the splash screen stays up, and hides the splash screen once
 *   both are done. The navigator mounts only then, so a cold-start deep link
 *   isn't sent to the sign-in screen first. Call
 *   `SplashScreen.preventAutoHideAsync()` at the top of the root layout.
 * - **While access is unavailable** it renders `unavailable({ error, retry })`
 *   instead of the navigator.
 * - **When the app returns to the foreground** it re-checks the session,
 *   because timers don't run while iOS suspends the app.
 * - **After a sign-in** it opens the deep link `rememberDeepLink` kept, with
 *   `router.replace`, once `ready`.
 * - **When one account replaces another** without a sign-out between them, it
 *   remounts the navigator, so no screen keeps the previous account's
 *   component state. The screens that were open stay open, as the URL does
 *   on the web. A sign-out already removes the guarded screens.
 *
 * @example
 * <AuthProvider client={auth}>
 * 	<SessionGate unavailable={(props) => <Unavailable {...props} />}>
 * 		<RootStack />
 * 	</SessionGate>
 * </AuthProvider>
 */
export function SessionGate({
	children,
	unavailable,
	client,
	ready = true,
}: SessionGateProps): ReactElement {
	const auth = useAdapterClient(client, "SessionGate");
	const state = useAuthState(auth, (value) => value);
	const restoring = state.status === "initializing";
	const shown = useShown(auth, !restoring && ready);

	// What the splash screen waits for, until the first screen is shown.
	const holding = shown
		? undefined
		: restoring
			? "restoring the session"
			: "waiting for ready";
	useEffect(() => {
		if (holding) {
			logGate(auth, `holding the splash screen: ${holding}`);
			return;
		}
		if (!shownClients.has(auth.state)) {
			shownClients.add(auth.state);
			logGate(auth, "hid the splash screen");
		}
		hideSplash();
	}, [holding, auth]);
	useEffect(() => watchForeground(auth), [auth]);
	// Before the first screen, Expo Router's pathname can still be the launch
	// URL's, so the link would be judged by a screen nobody has seen.
	useRememberedLink(auth, state.status, !shown || !ready);
	// A locked session counts as signed out here, so neither unlocking nor
	// a password sign-in from the lock screen remounts the navigator.
	const accountKey = useAccountKey(
		state.status === "locked" ? null : state.sessionId,
	);
	useEffect(() => {
		if (accountKey)
			logGate(
				auth,
				"another account signed in: remounted the navigator",
				undefined,
				accountKey,
			);
	}, [accountKey, auth]);
	const fallback =
		shown && state.status === "unavailable" && unavailable !== undefined;
	useEffect(() => {
		if (fallback) logGate(auth, "showing unavailable", state.error);
	}, [fallback, state.error, auth]);

	if (!shown) return createElement(Fragment);
	switch (state.status) {
		case "initializing":
			return createElement(Fragment);
		case "unavailable":
			if (!unavailable) {
				logGate(
					auth,
					"unavailable, and no unavailable prop: throwing to the error boundary",
					state.error,
				);
				// The effect that would hide it never runs for a thrown render.
				hideSplash();
			}
			return renderUnavailable(auth, state, unavailable);
		case "authenticated":
		case "refreshing":
		// Settled: the navigator routes to the app's unlock screen.
		case "locked":
		case "unauthenticated":
			return createElement(Fragment, { key: accountKey }, children);
	}
}
