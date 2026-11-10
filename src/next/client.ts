"use client";

import { useCallback } from "react";

import { useRouter } from "next/navigation.js";

import type { MirrorAuth } from "../core/mirror.js";
import type { Session } from "../core/types.js";
import { useServerSession } from "../react/server-session.js";

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
export function useMirrorAuth<U, C extends MirrorAuth<U>>(
	create: (session: Session<U> | null) => C,
	session: Session<U> | null,
): C {
	const router = useRouter();
	const refresh = useCallback(() => router.refresh(), [router]);
	return useServerSession(create, session, refresh);
}
