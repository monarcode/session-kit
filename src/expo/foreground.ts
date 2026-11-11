import { AppState } from "react-native";

import { debuggerOf } from "../core/debug.js";
import type { AuthClient } from "../core/types.js";

/**
 * Re-checks the session each time the app returns to the foreground, because
 * iOS suspends timers in the background. Mounting re-checks expiry and retries
 * a restore that failed, such as on a locked keychain. A failed refresh stays
 * `unavailable` until `retry()`, so an offline app doesn't retry every time.
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
		// Release at once: background work stays with whoever else keeps the
		// client mounted.
		client.mount()();
	});
	return () => subscription.remove();
}
