/**
 * The parts of `expo-router` session-kit uses. `navigation.go` moves to a
 * path, as a navigation or an opened link does, and `usePathname` follows it.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

export const navigation = {
	pathname: "/",
	/** Every `router.replace` href, in order. */
	replaced: [] as string[],
	/** How often the splash screen was hidden. */
	splashHides: 0,
	go(pathname: string) {
		this.pathname = pathname;
		for (const listener of listeners) listener();
	},
	reset() {
		listeners.clear();
		this.pathname = "/";
		this.replaced = [];
		this.splashHides = 0;
	},
};

const router = {
	replace(href: string) {
		navigation.replaced.push(href);
		navigation.go(href.split(/[?#]/)[0]!);
	},
};

export const SplashScreen = {
	async hideAsync() {
		navigation.splashHides++;
	},
};

export function useRouter() {
	return router;
}

export function usePathname(): string {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		() => navigation.pathname,
	);
}
