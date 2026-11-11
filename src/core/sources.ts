import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AuthError } from "./errors.js";
import { attempt, chain, type MaybePromise } from "./maybe.js";
import type { StoredSession } from "./persistence.js";
import { decodeJwtPayload, type SessionTokens } from "./tokens.js";
import { sameUser, toUser, validateNewUser, validateUser } from "./user.js";

/**
 * A user read from the access token, made by {@link fromAccessToken}. Pass it
 * as `createAuth`'s `user` option. `C` is the token's claims, and `U` is the
 * user made from them.
 *
 * @example
 * ```ts
 * import { fromAccessToken, type AccessTokenUser } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * const claims = z.object({ sub: z.string(), email: z.string() });
 * type Claims = z.infer<typeof claims>;
 * type AppUser = { id: string; email: string };
 *
 * export const user: AccessTokenUser<Claims, AppUser> = fromAccessToken(
 * 	claims,
 * 	(claims) => ({ id: claims.sub, email: claims.email }),
 * );
 * ```
 *
 * @since 0.1.0
 */
export type AccessTokenUser<C, U> = {
	/** Marks a user read from the access token. */
	readonly kind: "accessToken";
	/** Checks the claims read from the token. */
	readonly claims: StandardSchemaV1<unknown, C>;
	/** Turns the checked claims into the user. */
	readonly map: (claims: C) => U;
	/**
	 * Reads the claims from the access token
	 * ({@link FromAccessTokenOptions.decode}).
	 */
	readonly decode: (accessToken: string) => unknown;
};

/**
 * What `createAuth`'s `user` option takes: a schema, such as Zod's, that
 * checks the `user` passed to `signIn`, or {@link fromAccessToken}, which
 * reads the user from the access token.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage, type UserSource } from "@monarcode/session-kit";
 *
 * // A constraint keeps the user type of whichever source is passed.
 * export function createAppAuth<Src extends UserSource>(user: Src) {
 * 	return createAuth({ name: "my-app", user, storage: webStorage() });
 * }
 * ```
 *
 * @since 0.1.0
 */
export type UserSource = StandardSchemaV1 | AccessTokenUser<any, any>;

/**
 * Options for {@link fromAccessToken}.
 *
 * @example
 * ```ts
 * import type { FromAccessTokenOptions } from "@monarcode/session-kit";
 *
 * declare function verifyJwt(accessToken: string): Promise<unknown>;
 *
 * const options: FromAccessTokenOptions = { decode: verifyJwt };
 * ```
 *
 * @since 0.1.0
 */
export type FromAccessTokenOptions = {
	/**
	 * Reads the claims from the access token. It may return a promise, but then
	 * a saved session can't show before the first render.
	 *
	 * The default doesn't verify the signature. That's fine in a browser,
	 * which trusts its own backend's responses. On a server, pass a function
	 * that verifies the token. Default: the JWT's payload, **unverified**.
	 */
	decode?: ((accessToken: string) => unknown) | undefined;
};

function decodeAccessToken(accessToken: string): Record<string, unknown> {
	const payload = decodeJwtPayload(accessToken);
	if (!payload)
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"The access token is not a readable JWT",
		);
	return payload;
}

/**
 * Reads the user from the access token, rather than from what `signIn` is
 * given. Pass the result as `createAuth`'s `user` option.
 *
 * The `claims` schema checks the token's claims, and `map` turns them into
 * the user. Without `map`, the claims are the user.
 *
 * The client then works a little differently:
 * - `signIn` takes tokens only, and your refresh callback returns tokens
 *   only.
 * - There's no `updateUser`. The user changes when the token does, so call
 *   `auth.refresh()` to pick up a change.
 *
 * `map` runs on every restore and every new token, so keep it pure and
 * synchronous: the same claims must give the same user. Leave out claims that
 * change on every refresh, such as `exp`, `iat` or `jti`. A token that can't be
 * read, or whose claims the schema rejects, fails with
 * `USER_VALIDATION_FAILED`.
 *
 * @example
 * ```ts
 * import { createAuth, fromAccessToken, webStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * declare const accessToken: string;
 * declare const refreshToken: string;
 *
 * const auth = createAuth({
 * 	name: "my-app",
 * 	user: fromAccessToken(
 * 		z.object({ sub: z.string(), email: z.string() }),
 * 		(claims) => ({ id: claims.sub, email: claims.email }),
 * 	),
 * 	storage: webStorage(),
 * });
 *
 * await auth.signIn({ accessToken, refreshToken });
 * ```
 *
 * @see {@link FromAccessTokenOptions} to verify the token yourself
 *
 * @since 0.1.0
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
	/**
	 * Whether the user is saved beside the tokens, rather than read from them.
	 */
	saved: boolean;
	/**
	 * The user for new tokens and `input`; `input` is ignored when not saved.
	 */
	receive: (accessToken: string, input: unknown) => MaybePromise<U>;
	/**
	 * The user for a saved session. Synchronous when the source is, so a
	 * session can be restored before the first render.
	 */
	restore: (saved: StoredSession) => MaybePromise<U>;
	/**
	 * Whether `saved` holds the same user as `current`, without validating it.
	 */
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
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass a Standard Schema or fromAccessToken(…) as the user option",
		);
	}
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
