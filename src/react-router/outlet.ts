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

import { loginHref } from "../core/return-to.js";
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
 * 		loginPath="/login"
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
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
	/**
	 * Shown while the saved session is being restored and, in data mode,
	 * while the loader has yet to accept a new session. Default: nothing.
	 */
	pending?: ReactNode | undefined;
	/**
	 * Shown when access is unavailable, such as after a failed refresh. `retry`
	 * tries again; a repeated failure stays in `state.error`. Without it, the
	 * error is thrown to the nearest error boundary or error element.
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
 * Renders child routes only while someone is signed in, in any mode. In
 * declarative mode it is the guard: signed-out users are sent to `loginPath`
 * with `?redirectTo=` set to the current location, and so are users of a
 * locked session, since locking is for native apps. In data mode, render it
 * as the element of the route whose loader returns `requireSession`'s
 * result: child routes then render only while that session is still the
 * signed-in one, and `pending` shows until `useAuthRevalidation` has
 * re-run the loader for a new one, so no child sees the previous account's
 * loader data. Child routes are keyed by session, so nothing from one account
 * stays mounted for the next. Profile updates and token refreshes keep them
 * mounted. Only what it renders is guarded this way: UI the route renders
 * around it, such as a sidebar, stays mounted until the redirect, so read the
 * user there from state, where it may be `null`. Needs an `AuthProvider`
 * above it, or a `client`.
 *
 * @example
 * ```tsx
 * import { Route, Routes } from "react-router";
 * import { SessionOutlet } from "@monarcode/session-kit/react-router";
 *
 * // Declarative mode, inside `AuthProvider` and `BrowserRouter`.
 * export const routes = (
 * 	<Routes>
 * 		<Route element={<SessionOutlet loginPath="/login" />}>
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
	loginPath,
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
		// Locking is for native apps: a locked session goes to the sign-in
		// page, as a signed-out one does.
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
