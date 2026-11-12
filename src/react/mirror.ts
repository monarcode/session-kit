import { useEffect, useRef, useState } from "react";

import type { MirrorAuth } from "../core/mirror.js";
import { watchVersion } from "../core/revalidate.js";
import type { Session } from "../core/types.js";
import { sameSession } from "../core/user.js";

/**
 * Creates a `createMirrorAuth` client once, from the session the page was
 * rendered with, and keeps it in step with your server. Call it in the
 * component that renders `AuthProvider`.
 *
 * When a new server render brings another session, such as after a server
 * action signs in or out, the client takes it and tells other tabs.
 *
 * When the session changes in the browser, such as after `signOut()` or in
 * another tab, it calls `onChange`. Make that render on the server again, so
 * its redirects run: `router.refresh()` in Next.js, or `revalidate` from
 * `useRevalidator()` in React Router.
 *
 * Creating the client here, rather than at module level, keeps one per
 * request during server rendering. `onChange` can be a new function on each
 * render, as the latest one is called.
 *
 * @example
 * ```tsx
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import {
 * 	createAuthHooks,
 * 	useMirrorAuth,
 * } from "@monarcode/session-kit/react";
 * import { Outlet, useLoaderData, useRevalidator } from "react-router";
 *
 * type User = { id: number; firstName: string };
 * declare function fetchSession(): Promise<Session<User> | null>;
 * declare function postSignOut(): Promise<void>;
 * declare function loader(): Promise<{ session: Session<User> | null }>;
 *
 * const createAppAuth = (session: Session<User> | null) =>
 * 	createMirrorAuth({
 * 		name: "app",
 * 		session,
 * 		revalidate: fetchSession,
 * 		signOut: postSignOut,
 * 	});
 * const { AuthProvider } = createAuthHooks<ReturnType<typeof createAppAuth>>();
 *
 * export default function App() {
 * 	const { session } = useLoaderData<typeof loader>();
 * 	const { revalidate } = useRevalidator();
 * 	const auth = useMirrorAuth(createAppAuth, session, revalidate);
 * 	return <AuthProvider client={auth}><Outlet /></AuthProvider>;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function useMirrorAuth<U, C extends MirrorAuth<U>>(
	create: (session: Session<U> | null) => C,
	session: Session<U> | null,
	onChange: () => unknown,
): C {
	const [auth] = useState(() => create(session));
	const latestOnChange = useRef(onChange);
	// The session the server last rendered, which the client follows.
	const rendered = useRef(session);
	useEffect(
		function trackOnChange() {
			latestOnChange.current = onChange;
		},
		[onChange],
	);
	useEffect(
		function followServer() {
			const previous = rendered.current;
			rendered.current = session;
			// Only when the server's session changed, so a server render that
			// began before a change in the browser can't undo it.
			if (!sameSession(previous, session)) auth.adopt(session);
		},
		[auth, session],
	);
	useEffect(
		function renderOnChange() {
			const unwatch = watchVersion(auth, () => {
				const { sessionId, user } = auth.state.get();
				const current = sessionId === null ? null : { sessionId, user };
				// Skip a session the server already rendered, such as right after
				// `adopt`, or the two would re-render each other.
				if (!sameSession(current, rendered.current))
					return latestOnChange.current();
			});
			return function stopRendering() {
				unwatch();
			};
		},
		[auth],
	);
	return auth;
}
