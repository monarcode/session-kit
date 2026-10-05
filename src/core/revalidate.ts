import type { AuthClient } from "./types.js";

/**
 * Calls `revalidate` after auth changes in a way guards care about, when
 * `version` changes: a sign-in, sign-out, account switch, profile update, or
 * failed refresh. Several changes in one turn call it once. `onChange` runs at
 * once on every such change. Returns a function that stops watching and
 * cancels a call not yet made.
 */
export function watchVersion(
	auth: Pick<AuthClient<unknown, unknown>, "state">,
	revalidate: () => unknown,
	onChange?: () => void,
): () => void {
	let active = true;
	let queued = false;
	let previous = auth.state.get().version;
	const { unsubscribe } = auth.state.subscribe((state) => {
		if (state.version === previous) return;
		previous = state.version;
		onChange?.();
		if (queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (!active) return;
			void Promise.resolve()
				.then(revalidate)
				.catch((error: unknown) => {
					console.error("Auth route revalidation failed", error);
				});
		});
	});
	return () => {
		active = false;
		unsubscribe();
	};
}
