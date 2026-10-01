import type { AuthClient } from "../core/types.js";

type AuthRouter<I, U> = {
	options: { context: { auth: AuthClient<I, U> } };
	invalidate: () => Promise<unknown>;
	clearCache: () => void;
};
const connections = new WeakMap<object, () => void>();

export function connectAuth<I, U>(router: AuthRouter<I, U>): () => void {
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

export function safeReturnTo(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		/[\\\u0000-\u0020\u007f]/.test(value)
	)
		return "/";
	const base = "https://auth.invalid";
	try {
		const url = new URL(value, base);
		if (url.origin !== base || url.pathname === "/login") return "/";
		return url.pathname + url.search + url.hash;
	} catch {
		return "/";
	}
}
