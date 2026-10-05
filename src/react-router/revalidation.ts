import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

import {
	assertAuthSource,
	useProvidedClient,
	type AuthSource,
} from "../react/context.js";

const versionOf = (state: unknown) => (state as { version: number }).version;

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
	useEffect(() => {
		let previous = versionOf(auth.state.get());
		let queued = false;
		const { unsubscribe } = auth.state.subscribe((state) => {
			const next = versionOf(state);
			if (next === previous) return;
			previous = next;
			// Several changes in one turn re-run loaders once.
			if (queued) return;
			queued = true;
			queueMicrotask(() => {
				queued = false;
				void Promise.resolve(latest.current()).catch((error: unknown) => {
					console.error("Auth route revalidation failed", error);
				});
			});
		});
		return unsubscribe;
	}, [auth]);
}
