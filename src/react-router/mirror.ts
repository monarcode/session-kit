import { useRevalidator } from "react-router";

import type { MirrorAuth } from "../core/mirror.js";
import type { Session } from "../core/types.js";
import { useServerSession } from "../react/server-session.js";

/**
 * What {@link useMirrorAuth} needs from the client it creates: any
 * `createMirrorAuth` client fits.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import type { ServerSessionClient } from "@monarcode/session-kit/react-router";
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
 * For framework mode with server rendering: creates the browser's client
 * once per mount from the session the root loader read on the server, and
 * keeps the two in step. When the loader brings another session, as after an
 * action signs in or out, the client adopts it and tells other tabs. When the
 * client's session changes in the browser, as after `signOut` or a change in
 * another tab, loaders run again, so server middleware and loaders redirect.
 * Call it in the root route's component with the session its loader
 * returned, and render `AuthProvider` with the client. It replaces
 * `useAuthRevalidation`. Creating the client here, not at module level,
 * keeps one per request on the server.
 *
 * @example
 * ```tsx
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { createAuthHooks } from "@monarcode/session-kit/react";
 * import { useMirrorAuth } from "@monarcode/session-kit/react-router";
 * import { Outlet, useLoaderData } from "react-router";
 *
 * type User = { id: number; firstName: string };
 * declare function fetchSession(): Promise<Session<User> | null>;
 * declare function postSignOut(): Promise<void>;
 * // The root loader: `serverAuth.getSession(routerJar(context))`.
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
 * 	const auth = useMirrorAuth(createAppAuth, session);
 * 	return (
 * 		<AuthProvider client={auth}>
 * 			<Outlet />
 * 		</AuthProvider>
 * 	);
 * }
 * ```
 *
 * @since 0.1.0
 */
export function useMirrorAuth<U, C extends ServerSessionClient<U>>(
	create: (session: Session<U> | null) => C,
	session: Session<U> | null,
): C {
	const { revalidate } = useRevalidator();
	return useServerSession(create, session, revalidate);
}
