import {
	createElement,
	Fragment,
	type ReactElement,
	type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { AuthError } from "../core/errors.js";
import { loginHref } from "../core/return-to.js";
import {
	assertAuthSource,
	useAuthState,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

type OutletClient = AuthSource & { retry: () => Promise<unknown> };

type OutletState = {
	status: string;
	sessionId: string | null;
	error: AuthError | null;
};

export type SessionOutletProps = {
	/** Where signed-out users go. A same-origin path, such as `"/login"`. */
	loginPath: string;
	/** Shown while the saved session is being restored. Default: nothing. */
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
 * Renders child routes only while someone is signed in, in any mode. In
 * declarative mode it is the guard: signed-out users are sent to `loginPath`
 * with `?redirectTo=` set to the current location. In data mode, pair it
 * with `requireSession` in loaders. Child routes are keyed by session, so
 * nothing from one account stays mounted for the next. Profile updates and
 * token refreshes keep them mounted.
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
	switch (state.status) {
		case "authenticated":
		case "refreshing":
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
