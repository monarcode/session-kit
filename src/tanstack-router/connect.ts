import { watchVersion } from "../core/revalidate.js";
import type { AuthSource } from "../react/context.js";

export type AuthRouter = {
	options: { context: { auth: AuthSource } };
	invalidate: () => Promise<unknown>;
	clearCache: () => void;
	/** Set while rendering on a server, such as Start's build-time shell. */
	isServer?: boolean | undefined;
};
const connections = new WeakMap<object, () => void>();

/**
 * Starts auth for a Router whose context holds the client as `auth`. It
 * restores the session, runs expiry timers, follows other tabs, and runs
 * guards such as `requireSession` again when the session changes. Call it
 * once, beside the Router.
 *
 * It returns a function that stops. Calling it again for the same Router
 * returns that same function.
 *
 * On a server, such as when TanStack Start renders its SPA shell, it does
 * nothing. The shell keeps the `initializing` state, which shows your
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
	// The cache clears at once, so the last account's preloaded data never
	// shows; guards then run again in one batch.
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
