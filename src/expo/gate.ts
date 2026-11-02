import {
	createElement,
	Fragment,
	useEffect,
	useState,
	type ReactElement,
	type ReactNode,
} from "react";

import { SplashScreen } from "expo-router";

import {
	renderUnavailable,
	useAdapterClient,
	useAuthState,
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
};

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
 * - **While the session is restored** it renders nothing, so the splash
 *   screen stays up, and hides the splash screen once restoring is done. The
 *   navigator mounts only then, so a cold-start deep link isn't sent to the
 *   sign-in screen first. Call `SplashScreen.preventAutoHideAsync()` at the
 *   top of the root layout.
 * - **While access is unavailable** it renders `unavailable({ error, retry })`
 *   instead of the navigator.
 * - **When the app returns to the foreground** it re-checks the session,
 *   because timers don't run while iOS suspends the app.
 * - **After a sign-in** it opens the deep link `rememberDeepLink` kept, with
 *   `router.replace`.
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
}: SessionGateProps): ReactElement {
	const auth = useAdapterClient(client, "SessionGate");
	const state = useAuthState(auth, (value) => value);
	const restoring = state.status === "initializing";

	useEffect(() => {
		if (!restoring) hideSplash();
	}, [restoring]);
	useEffect(() => watchForeground(auth), [auth]);
	useRememberedLink(auth, state.status);
	const accountKey = useAccountKey(state.sessionId);

	switch (state.status) {
		case "initializing":
			return createElement(Fragment);
		case "unavailable":
			// The effect that would hide it never runs for a thrown render.
			if (!unavailable) hideSplash();
			return renderUnavailable(auth, state, unavailable);
		case "authenticated":
		case "refreshing":
		case "unauthenticated":
			return createElement(Fragment, { key: accountKey }, children);
	}
}
