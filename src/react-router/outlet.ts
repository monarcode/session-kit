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

export type SessionOutletProps = {
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
	/**
	 * Shown while the saved session is being restored and, in data mode,
	 * while the loader has yet to accept a new session. Default: nothing.
	 */
	pending?: ReactNode;
	/**
	 * Shown when access is unavailable, such as after a failed refresh. `retry`
	 * tries again; a repeated failure stays in `state.error`. Without it, the
	 * error is thrown to the nearest error boundary or error element.
	 */
	unavailable?: (props: UnavailableProps) => ReactNode;
	/** The client to watch. Default: the nearest `AuthProvider`'s. */
	client?: RetryableSource;
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
 * with `?redirectTo=` set to the current location. In data mode, render it
 * as the element of the route whose loader returns `requireSession`'s
 * result: child routes then render only while that session is still the
 * signed-in one, and `pending` shows until `useAuthRevalidation` has re-run
 * the loader for a new one, so no child sees the previous account's loader
 * data. Child routes are keyed by session, so nothing from one account stays
 * mounted for the next. Profile updates and token refreshes keep them
 * mounted.
 *
 * @example
 * <Route element={<SessionOutlet loginPath="/login" pending={<Spinner />} />}>
 * 	<Route index element={<Home />} />
 * </Route>
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
