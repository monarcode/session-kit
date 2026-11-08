import {
	createElement,
	Fragment,
	type ReactElement,
	type ReactNode,
} from "react";

import { Outlet, useMatch, useRouter } from "@tanstack/react-router";

import type { AuthStatus } from "../core/types.js";
import {
	assertAuthSource,
	useAuthState,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

export type SessionOutletProps = {
	/** Shown while the session is being checked again. Default: nothing. */
	pending?: ReactNode;
	/**
	 * The client to watch. Default: the nearest `AuthProvider`'s, then
	 * `auth` in Router context.
	 */
	client?: AuthSource;
};

/**
 * Renders a route guarded by `requireSession`: its child routes while the
 * session the guard accepted is still the signed-in one, and `pending` while
 * the guard has yet to check a change, such as a sign-out or another account
 * signing in. Child routes are keyed by session, so nothing from one account
 * stays mounted for the next. Profile updates and token refreshes keep them
 * mounted.
 *
 * @example
 * component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
 */
export function SessionOutlet({
	pending = null,
	client,
}: SessionOutletProps): ReactElement {
	const router = useRouter();
	const auth = useProvidedClient(client) ?? router.options.context?.auth;
	assertAuthSource(
		auth,
		"Provide an auth client in Router context or AuthProvider before rendering SessionOutlet",
	);
	const signedIn = useAuthState(auth, (state) => {
		const { status, sessionId } = state as {
			status: AuthStatus;
			sessionId: string | null;
		};
		// `status`, not `user`: a locked session has a user but no usable
		// access, and locking is for native apps, so it shows `pending`.
		return status === "authenticated" || status === "refreshing"
			? sessionId
			: null;
	});
	// The nearest match is this route's, whose context holds what its guard returned.
	const match: { context?: { session?: { sessionId?: unknown } } } = useMatch({
		strict: false,
	});
	const guarded = match.context?.session?.sessionId;
	// An element, not a bare node, so React 18 type definitions accept the component.
	if (signedIn === null || signedIn !== guarded)
		return createElement(Fragment, null, pending);
	return createElement(Outlet, { key: signedIn });
}
