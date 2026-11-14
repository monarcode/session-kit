import { useEffect, useRef, useState } from "react";

import { AuthError } from "../core/errors.js";
import type { MirrorAuth } from "../core/mirror.js";
import { watchVersion } from "../core/revalidate.js";
import type { Session } from "../core/types.js";
import { sameSession } from "../core/user.js";

/**
 * Options for {@link useMirrorAuth}.
 *
 * @example
 * ```ts
 * import type { MirrorAuth, Session } from "@monarcode/session-kit";
 * import type { UseMirrorAuthOptions } from "@monarcode/session-kit/react";
 *
 * type User = { id: number; firstName: string };
 * declare function createAppAuth(
 * 	session: Session<User> | null,
 * ): MirrorAuth<User>;
 * declare function refreshPage(): void;
 *
 * export function mirrorOptions(
 * 	session: Session<User> | null,
 * ): UseMirrorAuthOptions<User, MirrorAuth<User>> {
 * 	return { create: createAppAuth, session, onChange: refreshPage };
 * }
 * ```
 *
 * @since 0.1.0
 */
export interface UseMirrorAuthOptions<U, C extends MirrorAuth<U>> {
	/**
	 * Creates the client from the session the page was rendered with. It's
	 * called once, on the first render.
	 */
	create: (session: Session<U> | null) => C;
	/**
	 * The session your server rendered this page with, or `null`. When a new
	 * server render brings another one, the client takes it.
	 */
	session: Session<U> | null;
	/**
	 * Called when the session changes in the browser, such as after
	 * `signOut()` or in another tab. Make it render on the server again, so
	 * its redirects run: `router.refresh()` in Next.js, or `revalidate` from
	 * `useRevalidator()` in React Router. It can be a new function on each
	 * render: the latest one is called.
	 */
	onChange: () => unknown;
}

/**
 * Creates a `createMirrorAuth` client once, from the session the page was
 * rendered with, and keeps it in step with your server. Call it in the
 * component that renders `AuthProvider`.
 *
 * When a new server render brings another session, such as after a server
 * action signs in or out, the client takes it and tells other tabs. When the
 * session changes in the browser, it calls `onChange`.
 *
 * Throws `INVALID_OPTIONS` without a `create` or an `onChange` function.
 *
 * Creating the client here, rather than at module level, keeps one per
 * request during server rendering.
 *
 * @example
 * ```tsx
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { AuthProvider, useMirrorAuth } from "@monarcode/session-kit/react";
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
 *
 * export default function App() {
 * 	const { session } = useLoaderData<typeof loader>();
 * 	const { revalidate } = useRevalidator();
 * 	const auth = useMirrorAuth({
 * 		create: createAppAuth,
 * 		session,
 * 		onChange: revalidate,
 * 	});
 * 	return <AuthProvider client={auth}><Outlet /></AuthProvider>;
 * }
 * ```
 *
 * @see {@link UseMirrorAuthOptions} for `create`, `session` and `onChange`
 *
 * @since 0.1.0
 */
export function useMirrorAuth<U, C extends MirrorAuth<U>>(
	options: UseMirrorAuthOptions<U, C>,
): C {
	if (
		typeof options?.create !== "function" ||
		typeof options.onChange !== "function"
	)
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass useMirrorAuth { create, session, onChange }",
		);
	const { create, session, onChange } = options;
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
