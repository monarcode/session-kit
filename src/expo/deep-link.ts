import { useCallback, useEffect, useSyncExternalStore } from "react";

import { usePathname, useRouter } from "expo-router";
import { atom, type WritableAtom } from "nanostores";

import {
	safeReturnTo,
	sameRoute,
	type SafeReturnToOptions,
} from "../core/return-to.js";
import type { AuthStatus } from "../core/types.js";
import type { AuthSource } from "../react/context.js";

export type RememberDeepLinkOptions = SafeReturnToOptions;

/**
 * A link kept for after sign-in. `waiting` is set once it was seen while
 * signed out, so it opens after the next sign-in.
 */
type RememberedLink = Readonly<{ path: string; waiting: boolean }>;

// Per client, because `redirectSystemPath` runs outside React, often before
// `AuthProvider` has rendered, and has only the client to go by.
const links = new WeakMap<
	AuthSource,
	WritableAtom<RememberedLink | undefined>
>();

function linkOf(auth: AuthSource) {
	let link = links.get(auth);
	if (!link) links.set(auth, (link = atom(undefined)));
	return link;
}

/**
 * The in-app path of an incoming URL, following Expo Router's rules: a custom
 * scheme's host is the first segment (`myapp://orders/42`), a universal link
 * keeps its path (`https://example.com/orders/42`), and an Expo Go URL keeps
 * what follows `/--/`. Launch URLs that name no screen (Expo Go and QR-code
 * links without `/--/`, and the development build launcher) read as the root,
 * as does a URL that can't be parsed.
 */
export function deepLinkPath(url: string): string {
	const scheme = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(url);
	if (!scheme) return url;
	const name = scheme[1]!.toLowerCase();
	const rest = scheme[2]!;
	if (name === "exp" || name === "exps") {
		const expoGo = rest.indexOf("/--/");
		return expoGo === -1 ? "/" : rest.slice(expoGo + 3);
	}
	if (name === "http" || name === "https") {
		try {
			const parsed = new URL(url);
			// Expo Router reads links to Expo's own hosts as launch URLs, even
			// with `/--/`; only Expo Go's `exp` and `exps` keep what follows it.
			if (/^(exp\.host|u\.expo\.dev)$/i.test(parsed.hostname)) return "/";
			return parsed.pathname + parsed.search + parsed.hash;
		} catch {
			return "/";
		}
	}
	const path = rest.replace(/^\/*/, "/");
	return /^\/expo-development-client(?:[/?#]|$)/i.test(path) ? "/" : path;
}

/**
 * Keeps an incoming deep link, so `SessionGate` can open it once the user has
 * signed in. Call it from `redirectSystemPath` in `app/+native-intent.tsx`,
 * which Expo Router calls with every URL that opens the app, before routing:
 * `Stack.Protected` sends a link to a guarded screen to the first screen the
 * user may see, and the link would be lost.
 *
 * The path is checked with `safeReturnTo`, so the sign-in path, the root,
 * and anything that could leave the app are ignored. `SessionGate` drops the
 * link when the user turns out to be signed in, or when the link opens a
 * screen anyone may see. A newer link replaces an older one.
 *
 * @example
 * // app/+native-intent.tsx
 * export function redirectSystemPath({ path }: { path: string }) {
 * 	rememberDeepLink(auth, path);
 * 	return path;
 * }
 */
export function rememberDeepLink(
	auth: AuthSource,
	url: string,
	options: RememberDeepLinkOptions = {},
): void {
	const path = safeReturnTo(deepLinkPath(url), options);
	if (sameRoute(path, "/")) return;
	linkOf(auth).set({ path, waiting: false });
}

/**
 * What a change of status or screen does to a remembered link: a sign-in
 * opens it if it was waiting and forgets it; while signed out, it waits,
 * unless the screen it names is already showing, since anyone may see that
 * one. Restoring and unavailable access leave it as it is.
 */
function nextLink(
	link: RememberedLink,
	status: AuthStatus,
	pathname: string,
): { link: RememberedLink | undefined; open?: string } {
	switch (status) {
		case "authenticated":
		case "refreshing":
			return { link: undefined, open: link.waiting ? link.path : undefined };
		case "unauthenticated":
			if (sameRoute(pathname, link.path)) return { link: undefined };
			return { link: link.waiting ? link : { ...link, waiting: true } };
		default:
			return { link };
	}
}

/**
 * Opens `auth`'s remembered link with `router.replace` after a sign-in. In
 * an effect, so the navigator has committed the guard that now admits the
 * link's screen.
 */
export function useRememberedLink(auth: AuthSource, status: AuthStatus): void {
	const store = linkOf(auth);
	const link = useSyncExternalStore(
		useCallback((onChange: () => void) => store.listen(onChange), [store]),
		() => store.get(),
	);
	const router = useRouter();
	const pathname = usePathname();
	useEffect(() => {
		// A newer link arrived meanwhile; the effect runs again for it.
		if (!link || store.get() !== link) return;
		const next = nextLink(link, status, pathname);
		if (next.link !== link) store.set(next.link);
		if (next.open) router.replace(next.open);
	}, [store, link, status, pathname, router]);
}
