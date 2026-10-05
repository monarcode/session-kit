import type { AuthClient } from "../core/types.js";

type AuthRouter = {
	options: { context: { auth: Pick<AuthClient<unknown>, "state" | "mount"> } };
	invalidate: () => Promise<unknown>;
	clearCache: () => void;
	/** Set while rendering on a server, such as Start's build-time shell. */
	isServer?: boolean;
};
const connections = new WeakMap<object, () => void>();

/**
 * Starts auth for a Router: restores the session, runs expiry timers and tab
 * sync, and re-runs guards when auth changes. Returns a function that stops.
 * On a server, such as TanStack Start rendering its SPA shell, it does
 * nothing: there is no browser storage to restore from, and the shell keeps
 * the `initializing` state, which renders your pending UI.
 */
export function connectAuth(router: AuthRouter): () => void {
	if (router.isServer) return () => {};
	const existing = connections.get(router);
	if (existing) return existing;
	const auth = router.options.context.auth;
	let active = true;
	let queued = false;
	let previous = auth.state.get();
	const subscription = auth.state.subscribe((next) => {
		if (next.version === previous.version) return;
		previous = next;
		router.clearCache();
		if (queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (active)
				void router.invalidate().catch((error) => {
					console.error("Auth route revalidation failed", error);
				});
		});
	});
	const unmount = auth.mount();
	const disconnect = () => {
		if (!active) return;
		active = false;
		subscription.unsubscribe();
		unmount();
		connections.delete(router);
	};
	connections.set(router, disconnect);
	return disconnect;
}
