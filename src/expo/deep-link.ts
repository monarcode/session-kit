import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { usePathname, useRouter } from "expo-router";
import { atom, type WritableAtom } from "nanostores";

import { debuggerOf } from "../core/debug.js";
import {
	pathnameOf,
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
// `AuthProvider` has rendered, and has only the client to go by. Keyed by
// its `state`, which a client passed as `{ ...auth }` keeps.
const links = new WeakMap<object, WritableAtom<RememberedLink | undefined>>();

function linkOf(auth: AuthSource) {
	let link = links.get(auth.state);
	if (!link) links.set(auth.state, (link = atom(undefined)));
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
	const debug = debuggerOf(auth);
	const path = safeReturnTo(deepLinkPath(url), options);
	if (sameRoute(path, "/")) {
		debug.log(
			"deep-link",
			`ignored ${pathnameOf(url)}: it names no screen, the sign-in screen, or a path outside the app`,
			debug.secret({ url }),
		);
		return;
	}
	debug.log(
		"deep-link",
		`remembered ${pathnameOf(path)}`,
		debug.secret({ path }),
	);
	linkOf(auth).set({ path, waiting: false });
}

/**
 * What a change of status or screen does to a remembered link: a sign-in
 * opens it if it was waiting and forgets it; while signed out, it waits,
 * unless the screen it names is already showing, since anyone may see that
 * one. Restoring and unavailable access leave it as it is, as does a
 * `pathname` still equal to `launch`, Expo Router's reading of the launch
 * URL: until the navigator applies its guards, it names a screen nobody has
 * seen.
 */
function nextLink(
	link: RememberedLink,
	status: AuthStatus,
	pathname: string,
	launch: string,
): { link: RememberedLink | undefined; open?: string; why?: string } {
	switch (status) {
		case "authenticated":
		case "refreshing":
			return link.waiting
				? {
						link: undefined,
						open: link.path,
						why: "opening it after the sign-in",
					}
				: {
						link: undefined,
						why: "dropped: the app opened signed in, so Expo Router showed it",
					};
		case "unauthenticated":
			if (sameRoute(pathname, link.path)) {
				// A guarded screen moves off it; one open to anyone stays, and the
				// link is dropped at the sign-in, unopened.
				if (pathname === launch) return { link };
				return {
					link: undefined,
					why: "dropped: its screen is open to anyone and already showing",
				};
			}
			return link.waiting
				? { link }
				: {
						link: { ...link, waiting: true },
						why: "waiting for a sign-in",
					};
		default:
			return { link };
	}
}

/**
 * Opens `auth`'s remembered link with `router.replace` after a sign-in. In
 * an effect, so the navigator has committed the guard that now admits the
 * link's screen. While `paused`, the link stays as it is.
 */
export function useRememberedLink(
	auth: AuthSource,
	status: AuthStatus,
	paused: boolean,
): void {
	const store = linkOf(auth);
	const link = useSyncExternalStore(
		useCallback((onChange: () => void) => store.listen(onChange), [store]),
		() => store.get(),
	);
	const router = useRouter();
	const pathname = usePathname();
	// Read before the navigator mounts, which happens after this hook first
	// runs, so it is the launch URL's.
	const [launch] = useState(pathname);
	useEffect(() => {
		// A newer link arrived meanwhile; the effect runs again for it.
		if (paused || !link || store.get() !== link) return;
		const next = nextLink(link, status, pathname, launch);
		if (next.why) {
			const debug = debuggerOf(auth);
			debug.log(
				"deep-link",
				`${pathnameOf(link.path)}: ${next.why}`,
				debug.secret({ path: link.path }),
			);
		}
		if (next.link !== link) store.set(next.link);
		if (next.open) router.replace(next.open);
	}, [auth, store, link, status, pathname, launch, router, paused]);
}
