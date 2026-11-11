import { AppState } from "react-native";

import { debuggerOf } from "../core/debug.js";
import type { AuthClient } from "../core/types.js";

/**
 * Re-checks the session each time the app returns to the foreground. iOS
 * suspends timers in the background, so a token can expire with no refresh.
 *
 * It mounts the client, then releases it straight away. Mounting re-checks
 * expiry and retries a restore that failed, such as on a locked keychain.
 * Background work stays with whoever else keeps the client mounted.
 *
 * A failed refresh isn't retried, so an offline app doesn't retry on every
 * return. It stays `unavailable` until `retry()`. Returns a function that
 * stops watching.
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
