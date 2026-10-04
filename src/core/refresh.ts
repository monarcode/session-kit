import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import type { StoredSession } from "./persistence.js";
import { receiveTokens, tokensOf, type SessionTokens } from "./tokens.js";
import type { RefreshFn, User, UserInput } from "./types.js";
import { sameUser, validateUser } from "./user.js";

/** The shortest remaining lifetime worth installing or adopting a token for. */
const MIN_TOKEN_LIFETIME_MS = 5_000;

/** Types a refresh callback against a user schema before passing it to `createAuth`. */
export function createRefreshFn<I = never>(
	handler: RefreshFn<I>,
): RefreshFn<I> {
	return handler;
}

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
export async function obtainTokens<S extends StandardSchemaV1>(input: {
	current: SessionTokens & { user: User<S> };
	/** What storage holds for this session; `undefined` when unreadable. */
	stored: StoredSession | undefined;
	refresh: RefreshFn<UserInput<S>>;
	userSchema: S;
	/** An access token the backend refused, which must not be adopted. */
	rejectedToken: string | undefined;
	signal: AbortSignal;
}): Promise<ObtainedTokens<User<S>> | null> {
	const { current, stored, refresh, userSchema, rejectedToken, signal } =
		input;
	const savedUser = (saved: StoredSession) =>
		sameUser(saved.user, current.user)
			? current.user
			: validateUser(userSchema, saved.user);
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
	const user =
		isRecord(value) && value.user !== undefined
			? await validateUser(userSchema, value.user)
			: stored
				? await savedUser(stored)
				: undefined;
	return {
		tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
		user,
		adopted: false,
	};
}
