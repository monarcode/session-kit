import { AuthError } from "../core/errors.js";
import { hydrateMirror, isMirror, type MirrorAuth } from "../core/mirror.js";
import type { Session } from "../core/types.js";

/**
 * What {@link sessionHydration} and {@link loadSession} need from a client:
 * any `createMirrorAuth` client fits.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import type { HydratedClient } from "@monarcode/session-kit/tanstack-start";
 *
 * type User = { id: number; firstName: string };
 * declare const auth: MirrorAuth<User>;
 *
 * export const client: HydratedClient<User> = auth;
 * ```
 *
 * @since 0.1.0
 */
export type HydratedClient<U> = Pick<MirrorAuth<U>, "state" | "retry">;

/**
 * The session as the server render hands it to the browser, from
 * {@link sessionHydration}'s `dehydrate`. It holds no tokens.
 *
 * @example
 * ```ts
 * import type { DehydratedSession } from "@monarcode/session-kit/tanstack-start";
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
	 * page. When it didn't, as for a root route with `ssr: false` or a read
	 * that failed, the browser reads the session itself.
	 */
	loaded: boolean;
	/** The session the server read, or `null` when signed out. */
	session: Session<U> | null;
};

/**
 * Router options that carry the session from the server render to the
 * browser: spread them into `createRouter`. On the server, `dehydrate` sends
 * the session {@link loadSession} read; in the browser, `hydrate` starts the
 * client from it before the first render, without running guards again or
 * telling other tabs. When the server didn't read the session, `hydrate`
 * leaves the client as it is, and `loadSession` reads it in the browser.
 * Throws `INVALID_OPTIONS` from `hydrate` for a client that
 * `createMirrorAuth` didn't make.
 *
 * @example
 * ```ts
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { sessionHydration } from "@monarcode/session-kit/tanstack-start";
 * import { connectAuth } from "@monarcode/session-kit/tanstack-router";
 * import { createRootRouteWithContext, createRouter } from "@tanstack/react-router";
 *
 * type User = { id: number; firstName: string };
 * declare function getSessionFn(): Promise<Session<User> | null>;
 * declare function signOutFn(): Promise<void>;
 *
 * export function getRouter() {
 * 	const auth = createMirrorAuth({
 * 		name: "app",
 * 		session: null,
 * 		revalidate: () => getSessionFn(),
 * 		signOut: () => signOutFn(),
 * 	});
 * 	const routeTree = createRootRouteWithContext<{ auth: typeof auth }>()();
 * 	const router = createRouter({
 * 		routeTree,
 * 		context: { auth },
 * 		...sessionHydration(auth),
 * 	});
 * 	connectAuth(router);
 * 	return router;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function sessionHydration<U>(auth: HydratedClient<U>): {
	dehydrate: () => DehydratedSession<U>;
	hydrate: (dehydrated: DehydratedSession<U>) => void;
} {
	return {
		dehydrate() {
			const { sessionId, user } = auth.state.get();
			return {
				loaded: loaded.has(auth.state),
				session:
					sessionId !== null && user !== null ? { sessionId, user } : null,
			};
		},
		hydrate(dehydrated) {
			const hydrated = dehydrated?.loaded
				? hydrateMirror(auth, dehydrated.session)
				: isMirror(auth);
			if (!hydrated)
				throw new AuthError(
					"INVALID_OPTIONS",
					"sessionHydration needs a client from createMirrorAuth",
				);
			if (dehydrated?.loaded) loaded.add(auth.state);
		},
	};
}

// Clients that hold the session of the page they render, by `state`.
const loaded = new WeakSet<object>();

/**
 * Reads this request's session into the client, for the root route's
 * `beforeLoad`. On the server it calls the client's `revalidate`, so guards
 * and the render see the session from the cookie. In the browser it does
 * nothing when {@link sessionHydration}'s `hydrate` brought the session the
 * server read, and otherwise reads it until a read succeeds, as for a root
 * route that didn't render on the server. Rejects as `retry` does.
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
 * export const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()({
 * 	beforeLoad: ({ context }) => loadSession(context.auth),
 * });
 * ```
 *
 * @since 0.1.0
 */
export async function loadSession(
	auth: HydratedClient<unknown>,
): Promise<void> {
	if (typeof document !== "undefined" && loaded.has(auth.state)) return;
	await auth.retry();
	loaded.add(auth.state);
}
