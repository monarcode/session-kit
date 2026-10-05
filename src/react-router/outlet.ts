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

import { AuthError } from "../core/errors.js";
import { loginHref } from "../core/return-to.js";
import type { AuthClient } from "../core/types.js";
import {
	assertAuthSource,
	useAuthState,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

type OutletClient = AuthSource & Pick<AuthClient<unknown, unknown>, "retry">;

type OutletState = {
	status: string;
	sessionId: string | null;
	error: AuthError | null;
};

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
	unavailable?: (props: {
		error: AuthError | null;
		retry: () => void;
	}) => ReactNode;
	/** The client to watch. Default: the nearest `AuthProvider`'s. */
	client?: OutletClient;
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
	const auth = useProvidedClient(client);
	assertAuthSource(
		auth,
		"Render AuthProvider, or pass a client, before rendering SessionOutlet",
	);
	const location = useLocation();
	const state = useAuthState(auth, (value) => value as OutletState);
	const guarded = useGuardedSessionId();
	switch (state.status) {
		case "authenticated":
		case "refreshing":
			if (guarded !== undefined && guarded !== state.sessionId)
				return createElement(Fragment, null, pending);
			return createElement(Outlet, { key: state.sessionId });
		case "unauthenticated":
			return createElement(Navigate, {
				to: loginHref(
					loginPath,
					location.pathname + location.search + location.hash,
				),
				replace: true,
			});
		case "unavailable": {
			const error =
				state.error ??
				new AuthError("REFRESH_FAILED", "Access is unavailable");
			if (!unavailable) throw error;
			const retry = () => {
				void (auth as OutletClient).retry().catch(() => {});
			};
			return createElement(
				Fragment,
				null,
				unavailable({ error: state.error, retry }),
			);
		}
		default:
			// An element, not a bare node, so React 18 type definitions accept it.
			return createElement(Fragment, null, pending);
	}
}
