"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation.js";

import type { MirrorAuth } from "../core/mirror.js";
import { watchVersion } from "../core/revalidate.js";
import type { Session } from "../core/types.js";
import { sameUser } from "../core/user.js";

/**
 * What {@link useMirrorAuth} needs from the client it creates: any
 * `createMirrorAuth` client fits.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import type { ServerSessionClient } from "@monarcode/session-kit/next/client";
 *
 * type User = { id: number; firstName: string };
 * declare const auth: MirrorAuth<User>;
 *
 * export const client: ServerSessionClient<User> = auth;
 * ```
 *
 * @since 0.1.0
 */
export type ServerSessionClient<U> = Pick<MirrorAuth<U>, "state" | "adopt">;

/**
 * Creates the browser's client once per mount from the session the server
 * rendered, and keeps the two in step: when a server render brings another
 * session, the client adopts it and tells other tabs; when the client's
 * session changes in the browser, as after `signOut` or a change in another
 * tab, Server Components render again with `router.refresh()`, so their
 * redirects run. Call it in the Client Component that renders
 * `AuthProvider`, with the session a Server Component passed it. Creating
 * the client here, not at module level, keeps one per request on the
 * server.
 *
 * @example
 * ```tsx
 * "use client";
 *
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { useMirrorAuth } from "@monarcode/session-kit/next/client";
 * import { createAuthHooks } from "@monarcode/session-kit/react";
 * import type { ReactNode } from "react";
 *
 * type User = { id: number; firstName: string };
 * declare function getSessionAction(): Promise<Session<User> | null>;
 * declare function signOutAction(): Promise<void>;
 *
 * const createAppAuth = (session: Session<User> | null) =>
 * 	createMirrorAuth({
 * 		name: "app",
 * 		session,
 * 		revalidate: getSessionAction,
 * 		signOut: signOutAction,
 * 	});
 * const { AuthProvider } = createAuthHooks<ReturnType<typeof createAppAuth>>();
 *
 * export function Providers(props: {
 * 	session: Session<User> | null;
 * 	children: ReactNode;
 * }) {
 * 	const auth = useMirrorAuth(createAppAuth, props.session);
 * 	return <AuthProvider client={auth}>{props.children}</AuthProvider>;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function useMirrorAuth<U, C extends ServerSessionClient<U>>(
	create: (session: Session<U> | null) => C,
	session: Session<U> | null,
): C {
	const [auth] = useState(() => create(session));
	const router = useRouter();
	const latestRouter = useRef(router);
	// The session the server last rendered, which the client follows.
	const rendered = useRef(session);
	useEffect(
		function trackRouter() {
			latestRouter.current = router;
		},
		[router],
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
		function refreshOnChange() {
			const unwatch = watchVersion(auth, () => {
				const { sessionId, user } = auth.state.get();
				const current = sessionId === null ? null : { sessionId, user };
				if (!sameSession(current, rendered.current))
					latestRouter.current.refresh();
			});
			return function stopRefreshing() {
				unwatch();
			};
		},
		[auth],
	);
	return auth;
}

function sameSession(
	a: { sessionId: string; user: unknown } | null,
	b: { sessionId: string; user: unknown } | null,
): boolean {
	if (a === null || b === null) return a === b;
	return a.sessionId === b.sessionId && sameUser(a.user, b.user);
}
