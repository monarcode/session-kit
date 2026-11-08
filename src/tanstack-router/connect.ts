import { watchVersion } from "../core/revalidate.js";
import type { AuthSource } from "../react/context.js";

type AuthRouter = {
	options: { context: { auth: AuthSource } };
	invalidate: () => Promise<unknown>;
	clearCache: () => void;
	/** Set while rendering on a server, such as Start's build-time shell. */
	isServer?: boolean | undefined;
};
const connections = new WeakMap<object, () => void>();

/**
 * Starts auth for a Router whose context holds the client as `auth`: restores
 * the session, runs expiry timers and tab sync, and re-runs guards such as
 * `requireSession` when auth changes. Call it once, beside the Router;
 * it returns a function that stops, and calling it again for the same Router
 * returns that same function. On a server, such as TanStack Start rendering
 * its SPA shell, it does nothing: there is no browser storage to restore
 * from, and the shell keeps the `initializing` state, which renders your
 * pending UI.
 *
 * @example
 * ```tsx
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { connectAuth } from "@monarcode/session-kit/tanstack-router";
 *
 * type User = { name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const rootRoute = createRootRouteWithContext<{ auth: typeof auth }>()();
 *
 * export const router = createRouter({
 * 	routeTree: rootRoute,
 * 	context: { auth },
 * 	defaultPendingComponent: () => <p>Loading…</p>,
 * });
 *
 * export const disconnectAuth = connectAuth(router);
 * ```
 *
 * @since 0.1.0
 */
export function connectAuth(router: AuthRouter): () => void {
	if (router.isServer) return () => {};
	const existing = connections.get(router);
	if (existing) return existing;
	const auth = router.options.context.auth;
	let active = true;
	const unwatch = watchVersion(
		auth,
		() => router.invalidate(),
		() => router.clearCache(),
	);
	const unmount = auth.mount();
	const disconnect = () => {
		if (!active) return;
		active = false;
		unwatch();
		unmount();
		connections.delete(router);
	};
	connections.set(router, disconnect);
	return disconnect;
}
