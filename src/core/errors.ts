import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * What went wrong: the `code` of every {@link AuthError}. Match on it rather
 * than on the message, which may change in any release.
 *
 * @example
 * ```ts
 * import type { AuthErrorCode } from "@monarcode/session-kit";
 *
 * const messages: Partial<Record<AuthErrorCode, string>> = {
 * 	REFRESH_FAILED: "Can't reach the server. Try again.",
 * 	PERSISTENCE_FAILED: "Couldn't save your session.",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type AuthErrorCode =
	/**
	 * The user couldn't be accepted. `issues` holds the schema's issues when
	 * it rejected the user, and `cause` holds the error when something else
	 * failed, such as an `updateUser` function. Otherwise `message` says why,
	 * such as a user that isn't a plain JSON object.
	 *
	 * It also covers a schema that doesn't return its own output unchanged
	 * (saved users are checked again when restored), an access token that
	 * `fromAccessToken` can't read, and a user your refresh callback returned
	 * that the schema rejects.
	 */
	| "USER_VALIDATION_FAILED"
	/**
	 * Tokens or a saved session that can't be used, such as an access token
	 * that already expired at sign-in, or a saved session that's malformed.
	 * Tokens from your refresh callback fail with it too when they last
	 * under five seconds, have already expired, or repeat the access token
	 * your API rejected. In the browser of a server-rendered app, your server
	 * answered with something other than a session or an access token.
	 */
	| "INVALID_SESSION"
	/**
	 * Storage couldn't be read, written or cleared, or `locking.seal` failed.
	 * That includes a session too large to save: over two cookies on the
	 * server, or more than `secureStorage` holds. In the browser of a
	 * server-rendered app, signing out on the server failed.
	 */
	| "PERSISTENCE_FAILED"
	/**
	 * The refresh failed: your refresh callback threw or timed out, or
	 * `refresh()` was called without a `refresh` option or a refresh token.
	 * Without them, an access token that expires or that your API rejects
	 * signs the user out instead, with no error. In the browser of a
	 * server-rendered app, reading the session or the access token from the
	 * server failed. On the server, the access token needed a refresh in a
	 * request that can't set cookies.
	 */
	| "REFRESH_FAILED"
	/**
	 * Your `revoke` callback failed. It shows in `state.error`, and `signOut()`
	 * still resolves.
	 */
	| "REVOKE_FAILED"
	/**
	 * The session changed while the call ran: a newer sign-in, a sign-out, a
	 * newer `updateUser` call, or another tab replaced it. A route guard
	 * rejects with it when the session kept changing while it was read.
	 */
	| "SESSION_CHANGED"
	/** The call needs someone signed in, and no one is. */
	| "UNAUTHENTICATED"
	/** The session is locked. Call `unlock()` first. */
	| "LOCKED"
	/** `locking.open` failed, so the session stays locked. */
	| "UNLOCK_FAILED"
	/**
	 * An option or argument Session kit can't use, or a method called without
	 * the option it needs or where it can't work, such as a server `signIn` in
	 * a request that can't set cookies. In the browser of a server-rendered
	 * app, your session route refused the request, such as one from a page
	 * an older version of your app served.
	 */
	| "INVALID_OPTIONS";

/**
 * Options for creating an {@link AuthError} yourself, such as in a test or a
 * custom storage adapter: the standard `cause`, plus schema `issues`.
 *
 * @example
 * ```ts
 * import { AuthError } from "@monarcode/session-kit";
 *
 * declare const cause: unknown;
 *
 * // A storage adapter's read that failed.
 * export const failure = new AuthError("PERSISTENCE_FAILED", "Read failed", {
 * 	cause,
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthErrorOptions = ErrorOptions & {
	/**
	 * The schema's issues, for a `USER_VALIDATION_FAILED` error.
	 */
	issues?: readonly StandardSchemaV1.Issue[] | undefined;
};

/**
 * The error Session kit throws, rejects with, or shows in `state.error`.
 *
 * `code` says what went wrong ({@link AuthErrorCode}). `cause` holds what
 * failed underneath, such as your refresh callback's error, and `issues`
 * holds the schema's issues when the user was rejected.
 *
 * @example
 * ```ts
 * import { AuthError, type AuthClient } from "@monarcode/session-kit";
 *
 * type User = { id: string; name: string };
 * declare const auth: AuthClient<User, User>;
 * declare const accessToken: string;
 *
 * try {
 * 	await auth.signIn({ accessToken, user: { id: "1", name: "Ada" } });
 * } catch (error) {
 * 	if (error instanceof AuthError && error.code === "USER_VALIDATION_FAILED")
 * 		console.warn(error.issues ?? error.message);
 * 	else throw error;
 * }
 * ```
 *
 * @since 0.1.0
 */
export class AuthError extends Error {
	/** The schema's issues, for a `USER_VALIDATION_FAILED` error. */
	readonly issues?: readonly StandardSchemaV1.Issue[] | undefined;

	constructor(
		/** What went wrong. Match on it rather than on `message`. */
		readonly code: AuthErrorCode,
		message: string,
		options?: AuthErrorOptions,
	) {
		super(message, options);
		this.name = "AuthError";
		this.issues = options?.issues;
	}
}

/**
 * Wraps `cause` in an `AuthError` with `code`, or returns it unchanged when
 * it already is one, so the innermost code wins.
 */
export function toAuthError(
	code: AuthErrorCode,
	message: string,
	cause: unknown,
): AuthError {
	return cause instanceof AuthError
		? cause
		: new AuthError(code, message, { cause });
}

export function sessionLocked(): AuthError {
	return new AuthError("LOCKED", "The session is locked; unlock it first");
}

export function sessionChanged(): AuthError {
	return new AuthError(
		"SESSION_CHANGED",
		"The session changed during this operation",
	);
}
