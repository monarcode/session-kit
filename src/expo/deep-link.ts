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

/**
 * Options for {@link rememberDeepLink}, the same as `safeReturnTo`'s. Set
 * `loginPath` when your sign-in screen isn't `/login`, so links to it are
 * dropped rather than kept.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	rememberDeepLink,
 * 	type RememberDeepLinkOptions,
 * } from "@monarcode/session-kit/expo";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * const options: RememberDeepLinkOptions = { loginPath: "/sign-in" };
 *
 * export function redirectSystemPath({ path }: { path: string }) {
 * 	rememberDeepLink(auth, path, options);
 * 	return path;
 * }
 * ```
 *
 * @since 0.1.0
 */
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
 * Keeps an incoming deep link, so `SessionGate` can open it after the user
 * signs in. Without it, `Stack.Protected` sends a signed-out user from a
 * guarded screen to one they may see, and the link is lost.
 *
 * Call it from `redirectSystemPath` in `app/+native-intent.tsx`, which Expo
 * Router calls with every URL that opens the app. `url` can be a full URL or
 * a path. Return the path unchanged, so a signed-in user still lands on it.
 *
 * The path is checked with `safeReturnTo`, so the sign-in path, the root, and
 * anything that could leave the app are ignored. A newer link replaces an
 * older one. The link is kept in memory only, so an app restart forgets it.
 * What `SessionGate` does with it:
 *
 * - **Signed in already**: drops it, since Expo Router opens it as usual.
 * - **Signed out or locked**: opens it with `router.replace` after the next
 *   sign-in or unlock, once `SessionGate`'s `ready` is `true`.
 * - **A screen anyone may see**: drops it once that screen is showing.
 *
 * @example
 * ```ts
 * // app/+native-intent.tsx
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { rememberDeepLink } from "@monarcode/session-kit/expo";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export function redirectSystemPath({ path }: { path: string }) {
 * 	rememberDeepLink(auth, path);
 * 	return path;
 * }
 * ```
 *
 * @since 0.1.0
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
 * The `redirectSystemPath` that {@link deepLinkHandler} makes, for
 * `app/+native-intent.tsx`.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import {
 * 	deepLinkHandler,
 * 	type DeepLinkHandler,
 * } from "@monarcode/session-kit/expo";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const redirectSystemPath: DeepLinkHandler = deepLinkHandler(auth);
 * ```
 *
 * @since 0.1.0
 */
export type DeepLinkHandler = (event: {
	path: string;
	initial: boolean;
}) => string;

/**
 * Makes `redirectSystemPath` for `app/+native-intent.tsx`. It keeps each
 * incoming link with {@link rememberDeepLink}, so `SessionGate` opens it
 * after sign-in, and returns the path unchanged.
 *
 * Use `rememberDeepLink` itself when your `redirectSystemPath` does more,
 * such as rewriting old links.
 *
 * Throws `INVALID_OPTIONS` for a `loginPath` that doesn't start with `/`.
 * It throws when it's made, so a link never meets the error.
 *
 * @example
 * ```ts
 * // app/+native-intent.tsx
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { deepLinkHandler } from "@monarcode/session-kit/expo";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * export const redirectSystemPath = deepLinkHandler(auth);
 * ```
 *
 * @since 0.1.0
 */
export function deepLinkHandler(
	auth: AuthSource,
	options: RememberDeepLinkOptions = {},
): DeepLinkHandler {
	// Checked now: Expo Router warns that a throw on a link can crash the app,
	// and with good options, remembering a link doesn't throw.
	safeReturnTo("/", options);
	return ({ path }) => {
		rememberDeepLink(auth, path, options);
		return path;
	};
}

/**
 * What a change of status or screen does to a remembered link. A sign-in opens
 * a waiting link, and while signed out or locked the link waits. Restoring and
 * unavailable access leave it as it is.
 */
function nextLink(
	link: RememberedLink,
	status: AuthStatus,
	pathname: string,
	launch: string,
): {
	link: RememberedLink | undefined;
	open?: string | undefined;
	why?: string | undefined;
} {
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
		// Locked waits like signed out, and unlocking opens it like a sign-in.
		case "locked":
		case "unauthenticated":
			if (sameRoute(pathname, link.path)) {
				// Either the guards haven't moved off the launch URL yet, or the
				// launch screen is open to anyone. Then the link is dropped at the
				// sign-in, unopened.
				if (pathname === launch) return { link };
				// Its screen is showing to a signed-out user, so anyone may see it.
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
	useEffect(
		function applyRememberedLink() {
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
		},
		[auth, store, link, status, pathname, launch, router, paused],
	);
}
