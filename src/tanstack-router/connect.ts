import { watchVersion } from "../core/revalidate.js";
import { assertAuthSource, type AuthSource } from "../react/context.js";

/**
 * What {@link connectAuth} needs from a TanStack Router: the client in its
 * context as `auth`, and the methods that run guards again and clear cached
 * route data. A Router made by `createRouter` with `context: { auth }` fits.
 *
 * Use it to type a function that takes your Router.
 *
 * @example
 * ```ts
 * import {
 * 	connectAuth,
 * 	type AuthRouter,
 * } from "@monarcode/session-kit/tanstack-router";
 *
 * // Connects a Router and runs its guards once, for a test.
 * export async function startAuth(router: AuthRouter) {
 * 	const disconnect = connectAuth(router);
 * 	await router.invalidate();
 * 	return disconnect;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthRouter = {
	/** The Router's options, whose `context` holds the client as `auth`. */
	options: { context: { auth: AuthSource } };
	/** Runs the matched routes' guards and loaders again. */
	invalidate: () => Promise<unknown>;
	/** Clears cached and preloaded route data. */
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
 * When the session changes, it also clears the Router's cached and preloaded
 * route data, so one account's data never shows for the next.
 *
 * It returns a function that stops. Calling it again for the same Router
 * returns that same function.
 *
 * Throws `INVALID_OPTIONS` when the Router's context has no client as
 * `auth`.
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
	const auth: unknown = router.options.context?.auth;
	assertAuthSource(
		auth,
		"connectAuth needs the auth client in the Router's context, as auth",
	);
	if (router.isServer) return () => {};
	const existing = connections.get(router);
	if (existing) return existing;
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
