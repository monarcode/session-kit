import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AuthError } from "./errors.js";
import { attempt, chain, type MaybePromise } from "./maybe.js";
import type { StoredSession } from "./persistence.js";
import { decodeJwtPayload, type SessionTokens } from "./tokens.js";
import { sameUser, toUser, validateNewUser, validateUser } from "./user.js";

/**
 * A user read from the access token's claims, made by `fromAccessToken`.
 * `C` is the validated claims; `U` is the user mapped from them.
 */
export type AccessTokenUser<C, U> = {
	readonly kind: "accessToken";
	readonly claims: StandardSchemaV1<unknown, C>;
	readonly map: (claims: C) => U;
	readonly decode: (accessToken: string) => unknown;
};

/**
 * Where the user comes from: a Standard Schema validating the `user` passed to
 * `signIn`, or `fromAccessToken(…)` reading it from the access token.
 */
export type UserSource = StandardSchemaV1 | AccessTokenUser<any, any>;

export type FromAccessTokenOptions = {
	/**
	 * Turns the access token into the claims to validate. May return a promise.
	 * Default: the JWT payload, decoded **without verifying its signature**.
	 * That suits a browser, which trusts its own backend's responses anyway;
	 * code running on a server must pass a verifier instead.
	 */
	decode?: (accessToken: string) => unknown;
};

function decodeAccessToken(accessToken: string): Record<string, unknown> {
	const payload = decodeJwtPayload(accessToken);
	if (!payload) throw new Error("The access token is not a readable JWT");
	return payload;
}

/**
 * Reads the user from the access token instead of the `signIn` input. The
 * token's claims are validated by `claims`, then `map` turns them into the
 * user; without `map`, the validated claims are the user.
 *
 * `signIn` and the refresh callback then take tokens only, `updateUser` is
 * unavailable, and the user changes whenever the token does. `map` runs on
 * every restore and token change, so keep it pure and synchronous, and leave
 * out claims that change on every refresh, such as `exp`, `iat`, or `jti`.
 *
 * @example
 * user: fromAccessToken(
 * 	z.object({ sub: z.string(), email: z.string() }),
 * 	(claims) => ({ id: claims.sub, email: claims.email }),
 * ),
 */
export function fromAccessToken<
	S extends StandardSchemaV1,
	U = StandardSchemaV1.InferOutput<S>,
>(
	claims: S,
	map?: (claims: StandardSchemaV1.InferOutput<S>) => U,
	options: FromAccessTokenOptions = {},
): AccessTokenUser<StandardSchemaV1.InferOutput<S>, U> {
	return Object.freeze({
		kind: "accessToken",
		claims: claims as StandardSchemaV1<
			unknown,
			StandardSchemaV1.InferOutput<S>
		>,
		map: map ?? ((value: StandardSchemaV1.InferOutput<S>) => value as U),
		decode: options.decode ?? decodeAccessToken,
	});
}

/** How the engine obtains users, whichever the source. */
export type UserResolver<U> = {
	/** Whether the user is saved beside the tokens, rather than derived from them. */
	saved: boolean;
	/** The user for newly received tokens and `input`, which is ignored when derived. */
	receive: (accessToken: string, input: unknown) => MaybePromise<U>;
	/**
	 * The user for a saved session. Synchronous when the source is, so a
	 * session can be restored before the first render.
	 */
	restore: (saved: StoredSession) => MaybePromise<U>;
	/** Whether `saved` holds the same user as `current`, without validating it. */
	unchanged: (
		saved: StoredSession,
		current: SessionTokens & { user: U },
	) => boolean;
};

export function resolveUserSource(source: UserSource): UserResolver<unknown> {
	if (
		(typeof source === "object" || typeof source === "function") &&
		source !== null &&
		"~standard" in source
	) {
		return {
			saved: true,
			receive: (_, input) => validateNewUser(source, input),
			restore: (saved) => validateUser(source, saved.user),
			unchanged: (saved, current) => sameUser(saved.user, current.user),
		};
	}
	if (source?.kind !== "accessToken") {
		throw new Error(
			"Pass a Standard Schema or fromAccessToken(…) as the user option",
		);
	}
	/** Decodes and validates the claims, then maps them to the user. */
	const derive = (accessToken: string) =>
		attempt(
			() =>
				chain(source.decode(accessToken), (decoded) =>
					chain(source.claims["~standard"].validate(decoded), (result) => {
						if (result.issues) {
							throw new AuthError(
								"USER_VALIDATION_FAILED",
								"Invalid access token claims",
								{ issues: result.issues },
							);
						}
						return toUser(source.map(result.value));
					}),
				),
			(cause) => {
				if (cause instanceof AuthError) throw cause;
				throw new AuthError(
					"USER_VALIDATION_FAILED",
					"Could not read the user from the access token",
					{ cause },
				);
			},
		);
	return {
		saved: false,
		receive: (accessToken) => derive(accessToken),
		restore: (saved) => derive(saved.accessToken),
		unchanged: (saved, current) => saved.accessToken === current.accessToken,
	};
}
