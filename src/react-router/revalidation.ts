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
 * sign-in, sign-out, account switch, profile update, or failed refresh. Token
 * refreshes alone do not. Call it once in the root layout, in data or
 * framework mode; declarative mode has no loaders to re-run.
 *
 * @example
 * function Root() {
 * 	useAuthRevalidation();
 * 	return <Outlet />;
 * }
 */
export function useAuthRevalidation(client?: AuthSource): void {
	const auth = useProvidedClient(client);
	assertAuthSource(
		auth,
		"Render AuthProvider, or pass a client, before using useAuthRevalidation",
	);
	const { revalidate } = useRevalidator();
	const latest = useRef(revalidate);
	useEffect(() => {
		latest.current = revalidate;
	}, [revalidate]);
	useEffect(() => watchVersion(auth, () => latest.current()), [auth]);
}
