import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

import { watchVersion } from "../core/revalidate.js";
import {
	assertAuthSource,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

/**
 * Runs your loaders again when the session changes, so guards such as
 * `requireSession` check it again. That's on sign-in, sign-out, a switch of
 * account, a profile update, a lock, or a refresh that fails once the access
 * token has expired. A token refresh alone doesn't, nor does a failed
 * refresh while the token is still valid.
 *
 * Call it once in the root layout, in data or framework mode. Declarative
 * mode has no loaders. It watches `client`, or the nearest `AuthProvider`'s,
 * and doesn't mount the client itself.
 *
 * @example
 * ```tsx
 * import { Outlet } from "react-router";
 * import { useAuthRevalidation } from "@monarcode/session-kit/react-router";
 *
 * export function Root() {
 * 	useAuthRevalidation();
 * 	return <Outlet />;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function useAuthRevalidation(client?: AuthSource): void {
	const auth = useProvidedClient(client);
	assertAuthSource(
		auth,
		"Render AuthProvider, or pass a client, before using useAuthRevalidation",
	);
	const { revalidate } = useRevalidator();
	const latest = useRef(revalidate);
	useEffect(
		function trackRevalidate() {
			latest.current = revalidate;
		},
		[revalidate],
	);
	useEffect(
		function watchAuth() {
			return watchVersion(auth, () => latest.current());
		},
		[auth],
	);
}
