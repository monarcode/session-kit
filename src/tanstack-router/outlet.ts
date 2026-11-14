import {
	createElement,
	Fragment,
	type ReactElement,
	type ReactNode,
} from "react";

import { Outlet, useMatch, useRouter } from "@tanstack/react-router";

import { isSignedIn } from "../core/signed-in.js";
import type { AuthState } from "../core/types.js";
import {
	assertAuthSource,
	useAuthState,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

/**
 * Props for {@link SessionOutlet}.
 *
 * @example
 * ```tsx
 * import {
 * 	SessionOutlet,
 * 	type SessionOutletProps,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * export function GuardedLayout(props: Omit<SessionOutletProps, "pending">) {
 * 	return <SessionOutlet {...props} pending={<p>Checking session…</p>} />;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type SessionOutletProps = {
	/**
	 * Shown while the guard checks the session again, such as after a
	 * sign-out.
	 */
	pending?: ReactNode | undefined;
	/**
	 * The client to watch. Default: the nearest `AuthProvider`'s, then
	 * `auth` in Router context.
	 */
	client?: AuthSource | undefined;
};

/**
 * Renders the child routes of a route guarded by `requireSession`, but only
 * while the session it accepted is still the signed-in one.
 *
 * After a change, such as a sign-out or another account signing in, it shows
 * `pending` until the guard has run again. A locked or `unavailable` session
 * shows `pending` too, until the guard redirects or throws.
 *
 * Child routes remount for each account, so nothing from one stays mounted
 * for the next. Token refreshes and profile updates keep them mounted.
 *
 * UI the route renders around the outlet, such as a sidebar, isn't guarded
 * this way. Read the user there from state, where it may be `null`.
 *
 * Throws `INVALID_OPTIONS` when neither an `AuthProvider` nor Router context
 * has a client.
 *
 * @example
 * ```tsx
 * import {
 * 	createRootRouteWithContext,
 * 	createRoute,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	requireSession,
 * 	SessionOutlet,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()();
 *
 * export const authenticatedRoute = createRoute({
 * 	getParentRoute: () => rootRoute,
 * 	id: "authenticated",
 * 	beforeLoad: ({ context, location }) =>
 * 		requireSession(context.auth, { location }),
 * 	component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
 * });
 * ```
 *
 * @since 0.1.0
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
	const signedIn = useAuthState(auth, (value) => {
		const state = value as AuthState<unknown>;
		return isSignedIn(state) ? state.sessionId : null;
	});
	// The nearest match is this route's, whose context holds what its guard
	// returned.
	const match: { context?: { session?: { sessionId?: unknown } } } = useMatch({
		strict: false,
	});
	const guarded = match.context?.session?.sessionId;
	// An element, not a bare node, so React 18 types accept the component.
	if (signedIn === null || signedIn !== guarded)
		return createElement(Fragment, null, pending);
	return createElement(Outlet, { key: signedIn });
}
