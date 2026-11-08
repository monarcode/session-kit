import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

import { watchVersion } from "../core/revalidate.js";
import {
	assertAuthSource,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

/**
 * Re-runs loaders whenever auth changes in a way guards care about: a
 * sign-in, sign-out, account switch, profile update, lock, or a refresh that
 * fails once access has expired. Token refreshes alone do not, nor does a
 * failed refresh while the access token is still valid. Call it once in the
 * root layout, in data or framework mode, so guards such as `requireSession`
 * run again; declarative mode has no loaders to re-run. Watches `client`, or
 * the nearest `AuthProvider`'s.
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
