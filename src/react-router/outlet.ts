import {
	createElement,
	Fragment,
	useContext,
	type ReactElement,
	type ReactNode,
} from "react";
import {
	Navigate,
	Outlet,
	UNSAFE_DataRouterStateContext,
	useLoaderData,
	useLocation,
} from "react-router";

import { LOGIN_PATH, loginHref } from "../core/return-to.js";
import {
	renderUnavailable,
	useAdapterClient,
	useAuthState,
	type RetryableSource,
	type UnavailableProps,
} from "../react/context.js";

/**
 * Props for {@link SessionOutlet}.
 *
 * @example
 * ```tsx
 * import { SessionOutlet } from "@monarcode/session-kit/react-router";
 *
 * export const layout = (
 * 	<SessionOutlet
 * 		loginPath="/sign-in"
 * 		pending={<p>Restoring session…</p>}
 * 		unavailable={({ error, retry }) => (
 * 			<div role="alert">
 * 				<p>{error?.message ?? "Can't reach the server."}</p>
 * 				<button onClick={retry}>Try again</button>
 * 			</div>
 * 		)}
 * 	/>
 * );
 * ```
 *
 * @since 0.1.0
 */
export type SessionOutletProps = {
	/**
	 * Your sign-in page's path, starting with `/`. Use the same one as
	 * `requireSession`'s.
	 * @default "/login"
	 */
	loginPath?: string | undefined;
	/**
	 * Shown while the saved session is read and, in data mode, until the
	 * loader has accepted a new session.
	 */
	pending?: ReactNode | undefined;
	/**
	 * Shown when the session is `unavailable`, such as after a failed
	 * refresh ({@link UnavailableProps}). Without it, the error is thrown to
	 * the nearest error boundary or error element.
	 */
	unavailable?: ((props: UnavailableProps) => ReactNode) | undefined;
	/** The client to watch. Default: the nearest `AuthProvider`'s. */
	client?: RetryableSource | undefined;
};

/**
 * The session ID that this route's loader accepted, when it returned
 * `requireSession`'s `{ session }`. `undefined` outside a data router, or when
 * the loader returned no session.
 */
function useGuardedSessionId(): string | undefined {
	// Data and framework mode provide this context; declarative mode does not.
	// That never changes while a component is mounted, so `useLoaderData`
	// below runs on every render or on none.
	const dataRouter = useContext(UNSAFE_DataRouterStateContext);
	if (!dataRouter) return undefined;
	// oxlint-disable-next-line react/rules-of-hooks
	const data = useLoaderData() as
		| { session?: { sessionId?: unknown } }
		| null
		| undefined;
	const id = data?.session?.sessionId;
	return typeof id === "string" ? id : undefined;
}

/**
 * Renders child routes only while someone is signed in, in any mode. It
 * needs an `AuthProvider` above it, or a `client`.
 *
 * Signed-out users, and a locked session, go to `loginPath`, with
 * `?redirectTo=` set to where they were. In declarative mode, that makes it
 * the guard.
 *
 * In data mode, use it as the element of a route whose loader returns
 * `requireSession`'s result. When the account changes, it shows
 * `pending` until the loader has run again, so no child sees the last
 * account's data.
 *
 * Child routes remount for each account, but not on token refreshes or
 * profile updates. UI the route renders around the outlet, such as a
 * sidebar, isn't guarded this way. Read the user there from state, where it
 * may be `null`.
 *
 * @example
 * ```tsx
 * import { Route, Routes } from "react-router";
 * import { SessionOutlet } from "@monarcode/session-kit/react-router";
 *
 * // Declarative mode, inside `AuthProvider` and `BrowserRouter`.
 * export const routes = (
 * 	<Routes>
 * 		<Route element={<SessionOutlet />}>
 * 			<Route index element={<p>Signed in</p>} />
 * 		</Route>
 * 		<Route path="/login" element={<p>Sign in</p>} />
 * 	</Routes>
 * );
 * ```
 *
 * @since 0.1.0
 */
export function SessionOutlet({
	loginPath = LOGIN_PATH,
	pending = null,
	unavailable,
	client,
}: SessionOutletProps): ReactElement {
	const auth = useAdapterClient(client, "SessionOutlet");
	const location = useLocation();
	const state = useAuthState(auth, (value) => value);
	const guarded = useGuardedSessionId();
	switch (state.status) {
		case "authenticated":
		case "refreshing":
			if (guarded !== undefined && guarded !== state.sessionId)
				return createElement(Fragment, null, pending);
			return createElement(Outlet, { key: state.sessionId });
		case "locked":
		case "unauthenticated":
			return createElement(Navigate, {
				to: loginHref(
					loginPath,
					location.pathname + location.search + location.hash,
				),
				replace: true,
			});
		case "unavailable":
			return renderUnavailable(auth, state, unavailable);
		case "initializing":
			// An element, not a bare node, so React 18 type definitions accept it.
			return createElement(Fragment, null, pending);
	}
}
