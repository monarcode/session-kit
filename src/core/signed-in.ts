import type { AuthState } from "./types.js";

/**
 * Whether someone is signed in: `true` while `authenticated` or `refreshing`.
 * It narrows `state`, so `state.user` is set when it's `true`.
 *
 * Check this rather than `status === "authenticated"`, which is `false` for a
 * moment while an expired access token refreshes. A `locked` session is
 * `false`. It has a user, but no access until it's unlocked.
 *
 * @example
 * ```ts
 * import { isSignedIn, type AuthClient } from "@monarcode/session-kit";
 *
 * declare const auth: AuthClient<{ name: string }, { name: string }>;
 *
 * const state = auth.state.get();
 * if (isSignedIn(state)) console.log(state.user.name);
 * ```
 *
 * @since 0.1.0
 */
export function isSignedIn<U>(
	state: AuthState<U>,
): state is Extract<AuthState<U>, { status: "authenticated" | "refreshing" }> {
	return state.status === "authenticated" || state.status === "refreshing";
}
