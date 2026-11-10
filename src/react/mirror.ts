import { useEffect, useRef, useState } from "react";

import type { MirrorAuth } from "../core/mirror.js";
import { watchVersion } from "../core/revalidate.js";
import type { Session } from "../core/types.js";
import { sameSession } from "../core/user.js";

/**
 * For server rendering with a `createMirrorAuth` client: creates the client
 * once per mount from the session the server rendered, and keeps the two in
 * step. When a server render brings another session, as after a server
 * action signs in or out, the client adopts it and tells other tabs. When the
 * client's session changes in the browser, as after `signOut` or a change in
 * another tab, it calls `onChange`, which should render on the server again
 * so its redirects run: `router.refresh()` from `useRouter()` in Next.js,
 * `revalidate` from `useRevalidator()` in React Router. Call it in the
 * component that renders `AuthProvider`. Creating the client here, not at
 * module level, keeps one per request on the server. `onChange` may change
 * between renders: the latest one is called.
 *
 * @example
 * ```tsx
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { createAuthHooks, useMirrorAuth } from "@monarcode/session-kit/react";
 * import { Outlet, useLoaderData, useRevalidator } from "react-router";
 *
 * type User = { id: number; firstName: string };
 * declare function fetchSession(): Promise<Session<User> | null>;
 * declare function postSignOut(): Promise<void>;
 * declare function loader(): Promise<{ session: Session<User> | null }>;
 *
 * const createAppAuth = (session: Session<User> | null) =>
 * 	createMirrorAuth({ name: "app", session, revalidate: fetchSession, signOut: postSignOut });
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
			// Only a change: a render begun before a change in the browser
			// mustn't undo it.
			if (!sameSession(previous, session)) auth.adopt(session);
		},
		[auth, session],
	);
	useEffect(
		function renderOnChange() {
			const unwatch = watchVersion(auth, () => {
				const { sessionId, user } = auth.state.get();
				const current = sessionId === null ? null : { sessionId, user };
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
