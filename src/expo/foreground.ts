import { AppState } from "react-native";

import { debuggerOf } from "../core/debug.js";
import type { AuthClient } from "../core/types.js";

/**
 * Re-checks the session each time the app returns to the foreground, when
 * `AppState` becomes `active`. iOS suspends JavaScript timers in the
 * background, so an access token can expire, or pass its early-refresh time,
 * with no timer having fired. Re-checking refreshes an expired token at once
 * and re-arms the timers from the current clock.
 *
 * It mounts the client and releases it again straight away: mounting
 * re-checks expiry, and the release leaves background work to whoever else
 * holds the client mounted, such as `AuthProvider`. A restore that failed,
 * as when the app launched in the background before the first unlock and
 * the keychain was locked, runs again. A failed refresh is not retried: it
 * stays `unavailable` until `retry()`, so an offline app doesn't retry on
 * every return. Returns a function that stops watching.
 */
export function watchForeground(
	client: Pick<AuthClient<unknown, unknown>, "mount" | "state">,
): () => void {
	const debug = debuggerOf(client);
	let current = AppState.currentState;
	const subscription = AppState.addEventListener("change", (next) => {
		const returning = next === "active" && current !== "active";
		current = next;
		if (!returning) return;
		debug.log(
			"foreground",
			"back in the foreground: re-checking the session",
		);
		client.mount()();
	});
	return () => subscription.remove();
}
