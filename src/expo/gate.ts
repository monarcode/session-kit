import {
	createElement,
	Fragment,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
	type ReactElement,
	type ReactNode,
} from "react";

import { SplashScreen, usePathname, useRouter } from "expo-router";

import { AuthError } from "../core/errors.js";
import type { AuthClient } from "../core/types.js";
import {
	assertAuthSource,
	useAuthState,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";
import { rememberedLink, subscribeLinks, updateLink } from "./deep-link.js";
import { watchForeground } from "./foreground.js";

type GateClient = AuthSource & Pick<AuthClient<unknown, unknown>, "retry">;

type GateState = {
	status: string;
	sessionId: string | null;
	error: AuthError | null;
};

export type UnavailableProps = {
	/** Why access is unavailable, such as a failed refresh or a locked keychain. */
	error: AuthError | null;
	/** Tries again. A repeated failure stays in `state.error`. */
	retry: () => void;
};

export type SessionGateProps = {
	/** The root navigator, usually a `Stack` guarded with `Stack.Protected`. */
	children?: ReactNode;
	/**
	 * Shown instead of the navigator while access is unavailable, such as
	 * after a failed refresh. Without it, the error is thrown to the root
	 * layout's `ErrorBoundary`.
	 */
	unavailable?: (props: UnavailableProps) => ReactNode;
	/** The client to watch. Default: the nearest `AuthProvider`'s. */
	client?: GateClient;
};

function hideSplash() {
	void SplashScreen.hideAsync().catch(() => {});
}

/** Whether `pathname` is the path part of `path`, ignoring a trailing slash. */
function samePath(pathname: string, path: string) {
	const trim = (value: string) => value.replace(/\/+$/, "") || "/";
	return trim(pathname) === trim(path.split(/[?#]/)[0]!);
}

/**
 * Wraps the root navigator in `app/_layout.tsx`, inside `AuthProvider`, and
 * adds what Expo Router's `Stack.Protected` lacks:
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
	const provided = useProvidedClient(client);
	assertAuthSource(
		provided,
		"Render AuthProvider, or pass a client, before rendering SessionGate",
	);
	const auth = provided as GateClient;
	const state = useAuthState(auth, (value) => value as GateState);
	const restoring = state.status === "initializing";
	const signedIn =
		state.status === "authenticated" || state.status === "refreshing";

	useEffect(() => {
		if (!restoring) hideSplash();
	}, [restoring]);

	useEffect(() => watchForeground(auth), [auth]);

	// Counts accounts that replaced another without a sign-out between them,
	// updated during render so the swap and the remount land together.
	const [account, setAccount] = useState({
		sessionId: state.sessionId,
		key: 0,
	});
	if (account.sessionId !== state.sessionId) {
		const switched = account.sessionId !== null && state.sessionId !== null;
		setAccount({
			sessionId: state.sessionId,
			key: account.key + (switched ? 1 : 0),
		});
	}

	const link = useSyncExternalStore(
		useCallback(
			(onChange: () => void) => subscribeLinks(auth, onChange),
			[auth],
		),
		() => rememberedLink(auth),
	);
	const router = useRouter();
	const pathname = usePathname();
	useEffect(() => {
		if (!link) return;
		if (signedIn) {
			// After a sign-in. In an effect, so the navigator has committed the
			// guard that now admits the link's screen.
			updateLink(auth, link, undefined);
			if (link.waiting) router.replace(link.path);
		} else if (state.status === "unauthenticated") {
			// The link opened a screen anyone may see, so nothing is owed.
			if (samePath(pathname, link.path)) updateLink(auth, link, undefined);
			else if (!link.waiting)
				updateLink(auth, link, { ...link, waiting: true });
		}
	}, [auth, link, signedIn, state.status, pathname, router]);

	switch (state.status) {
		case "initializing":
			return createElement(Fragment);
		case "unavailable": {
			if (!unavailable) {
				// The effect that would hide it never runs for a thrown render.
				hideSplash();
				throw (
					state.error ??
					new AuthError("REFRESH_FAILED", "Access is unavailable")
				);
			}
			const retry = () => {
				void auth.retry().catch(() => {});
			};
			return createElement(
				Fragment,
				null,
				unavailable({ error: state.error, retry }),
			);
		}
		default:
			return createElement(Fragment, { key: account.key }, children);
	}
}
