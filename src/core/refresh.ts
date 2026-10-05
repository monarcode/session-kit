import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import type { StoredSession } from "./persistence.js";
import type { UserResolver } from "./sources.js";
import { receiveTokens, tokensOf, type SessionTokens } from "./tokens.js";
import type { RefreshFn } from "./types.js";

/** The shortest remaining lifetime worth installing or adopting a token for. */
const MIN_TOKEN_LIFETIME_MS = 5_000;

export type ObtainedTokens<U> = {
	tokens: SessionTokens;
	/** The replacement user, or `undefined` to keep the current one. */
	user: U | undefined;
	/** Whether the tokens came from another tab's save, not the callback. */
	adopted: boolean;
};

/**
 * Gets tokens to replace `current`'s: another tab's newer saved tokens while
 * they stay usable, otherwise the refresh callback's. Resolves `null` when the
 * backend rejected the refresh token.
 */
export async function obtainTokens<U>(input: {
	current: SessionTokens & { user: U };
	/** What storage holds for this session; `undefined` when unreadable. */
	stored: StoredSession | undefined;
	refresh: RefreshFn<unknown>;
	users: UserResolver<U>;
	/** An access token the backend refused, which must not be adopted. */
	rejectedToken: string | undefined;
	signal: AbortSignal;
}): Promise<ObtainedTokens<U> | null> {
	const { current, stored, refresh, users, rejectedToken, signal } = input;
	const savedUser = async (saved: StoredSession) =>
		users.unchanged(saved, current) ? current.user : users.restore(saved);
	if (
		stored &&
		stored.accessToken !== current.accessToken &&
		stored.accessToken !== rejectedToken &&
		(stored.expiresAt === undefined ||
			stored.expiresAt >= Date.now() + MIN_TOKEN_LIFETIME_MS)
	) {
		return {
			tokens: tokensOf(stored),
			user: await savedUser(stored),
			adopted: true,
		};
	}
	const refreshToken = stored?.refreshToken ?? current.refreshToken!;
	const value = await refresh({ refreshToken, signal });
	if (value === null) return null;
	const tokens = receiveTokens(value);
	if (
		tokens.expiresAt !== undefined &&
		tokens.expiresAt < Date.now() + MIN_TOKEN_LIFETIME_MS
	) {
		throw new AuthError(
			"INVALID_SESSION",
			"Refreshed access token must last at least five seconds",
		);
	}
	let user: U | undefined;
	// A derived user always follows the new token.
	if (!users.saved) user = await users.receive(tokens.accessToken, undefined);
	else if (isRecord(value) && value.user !== undefined)
		user = await users.receive(tokens.accessToken, value.user);
	else if (stored) user = await savedUser(stored);
	return {
		tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
		user,
		adopted: false,
	};
}
