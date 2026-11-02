import { safeReturnTo, type SafeReturnToOptions } from "../core/return-to.js";
import type { AuthSource } from "../react/context.js";

export type RememberDeepLinkOptions = SafeReturnToOptions;

/**
 * A link kept for after sign-in. `waiting` is set once `SessionGate` saw it
 * while signed out, so it opens after the next sign-in.
 */
export type RememberedLink = Readonly<{ path: string; waiting: boolean }>;

const links = new WeakMap<object, RememberedLink>();
const listeners = new WeakMap<object, Set<() => void>>();

function notify(auth: object) {
	for (const listener of listeners.get(auth) ?? []) listener();
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
	if (path === "/") return;
	links.set(auth, { path, waiting: false });
	notify(auth);
}

/** The link remembered for `auth`, if any. */
export function rememberedLink(auth: object): RememberedLink | undefined {
	return links.get(auth);
}

/** Replaces or forgets `auth`'s remembered link, if it is still `expected`. */
export function updateLink(
	auth: object,
	expected: RememberedLink,
	next: RememberedLink | undefined,
): void {
	if (links.get(auth) !== expected) return;
	if (next) links.set(auth, next);
	else links.delete(auth);
	notify(auth);
}

export function subscribeLinks(auth: object, listener: () => void) {
	let set = listeners.get(auth);
	if (!set) listeners.set(auth, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
	};
}
