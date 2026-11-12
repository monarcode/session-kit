import { AuthError } from "../core/errors.js";
import { mirrorOf, type MirrorAuth } from "../core/mirror.js";
import type { Session } from "../core/types.js";

/**
 * The session the server render sends to the browser, from
 * {@link sessionHydration}'s `dehydrate`. It holds no tokens.
 *
 * @example
 * ```ts
 * import type {
 * 	DehydratedSession,
 * } from "@monarcode/session-kit/tanstack-start";
 *
 * type User = { id: number; firstName: string };
 *
 * export const signedOut: DehydratedSession<User> = {
 * 	loaded: true,
 * 	session: null,
 * };
 * ```
 *
 * @since 0.1.0
 */
export type DehydratedSession<U> = {
	/**
	 * Whether {@link loadSession} read the session on the server for this
	 * page. When it didn't, such as for a root route with `ssr: false` or a
	 * failed read, the browser reads the session itself.
	 */
	loaded: boolean;
	/** The session the server read, or `null` when signed out. */
	session: Session<U> | null;
};

/**
 * The router options {@link sessionHydration} returns, for `createRouter`.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import {
 * 	sessionHydration,
 * 	type SessionHydration,
 * } from "@monarcode/session-kit/tanstack-start";
 *
 * type User = { id: number; firstName: string };
 * declare const auth: MirrorAuth<User>;
 *
 * export const options: SessionHydration<User> = sessionHydration(auth);
 * ```
 *
 * @since 0.1.0
 */
export type SessionHydration<U> = {
	/** On the server: the session to send with the page. */
	dehydrate: () => DehydratedSession<U>;
	/** In the browser: starts the client from what `dehydrate` sent. */
	hydrate: (dehydrated: DehydratedSession<U>) => void;
};

/**
 * Router options that carry the session from the server render to the
 * browser. Spread them into `createRouter`.
 *
 * On the server, `dehydrate` sends the session {@link loadSession} read. In
 * the browser, `hydrate` starts the client from it before the first render,
 * without running guards again or telling other tabs. When the server didn't
 * read the session, `hydrate` leaves the client as it is, and `loadSession`
 * reads it in the browser.
 *
 * `hydrate` throws `INVALID_OPTIONS` for a client that isn't from
 * `createMirrorAuth`.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import { sessionHydration } from "@monarcode/session-kit/tanstack-start";
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 *
 * declare function createAppAuth(): MirrorAuth<{ id: number }>;
 *
 * // Start calls it for each request on the server, and once in the browser.
 * export function getRouter() {
 * 	const auth = createAppAuth();
 * 	const routeTree = createRootRouteWithContext<{ auth: typeof auth }>()();
 * 	return createRouter({
 * 		routeTree,
 * 		context: { auth },
 * 		...sessionHydration(auth),
 * 	});
 * }
 * ```
 *
 * @since 0.1.0
 */
export function sessionHydration<U>(auth: MirrorAuth<U>): SessionHydration<U> {
	return {
		dehydrate() {
			const { sessionId, user } = auth.state.get();
			return {
				loaded: mirrorOf(auth)?.answered ?? false,
				session:
					sessionId !== null && user !== null ? { sessionId, user } : null,
			};
		},
		hydrate(dehydrated) {
			const mirror = mirrorOf(auth);
			if (!mirror)
				throw new AuthError(
					"INVALID_OPTIONS",
					"sessionHydration needs a client from createMirrorAuth",
				);
			// The router passes `undefined` when the server sent no data, as from
			// a router made without these options.
			if (dehydrated?.loaded) mirror.hydrate(dehydrated.session);
		},
	};
}

/**
 * Reads this request's session into the client. Call it in the root route's
 * `beforeLoad`.
 *
 * On the server, it calls the client's `revalidate`, so guards and the page
 * see the session from the cookie. In the browser, it does nothing when
 * {@link sessionHydration} already brought the server's session. Otherwise,
 * such as for a root route that didn't render on the server, it asks the
 * server on each navigation until a read succeeds.
 *
 * Rejects as the client's `retry()` does when the read fails.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import { loadSession } from "@monarcode/session-kit/tanstack-start";
 * import { createRootRouteWithContext } from "@tanstack/react-router";
 *
 * type User = { id: number; firstName: string };
 * declare const auth: MirrorAuth<User>;
 *
 * type Context = { auth: typeof auth };
 *
 * export const rootRoute = createRootRouteWithContext<Context>()({
 * 	beforeLoad: ({ context }) => loadSession(context.auth),
 * });
 * ```
 *
 * @since 0.1.0
 */
export async function loadSession<U>(auth: MirrorAuth<U>): Promise<void> {
	// On the server, always read: each request has its own cookie.
	if (typeof document !== "undefined" && mirrorOf(auth)?.answered) return;
	await auth.retry();
}
