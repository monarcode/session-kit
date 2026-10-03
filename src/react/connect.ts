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

export type SafeReturnToOptions = {
	/**
	 * Sign-in paths that must not be returned to, to avoid redirect loops.
	 * Matched ignoring case, percent-encoding, and trailing slashes.
	 * Default: `"/login"`.
	 */
	loginPath?: string | readonly string[];
};

/** Normalizes a pathname the way Router matching treats it by default. */
function routeKey(pathname: string): string {
	return decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, "") || "/";
}

export function safeReturnTo(
	value: unknown,
	options: SafeReturnToOptions = {},
): string {
	const loginPaths = [options.loginPath ?? "/login"].flat();
	for (const path of loginPaths) {
		if (!path.startsWith("/"))
			throw new Error(`loginPath must start with "/": ${path}`);
	}
	if (
		typeof value !== "string" ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		/[\\\u0000- \u007f]/.test(value)
	)
		return "/";
	const base = "https://auth.invalid";
	try {
		const url = new URL(value, base);
		const key = routeKey(url.pathname);
		if (
			url.origin !== base ||
			loginPaths.some((path) => routeKey(path) === key)
		)
			return "/";
		return url.pathname + url.search + url.hash;
	} catch {
		return "/";
	}
}
