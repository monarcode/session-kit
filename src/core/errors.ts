import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * What went wrong, on every {@link AuthError}. Match on it rather than on the
 * message, which may change in any release.
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
	 * The user schema rejected the user, and `issues` holds its issues. From
	 * `signIn` and `updateUser`, also any other failure to accept the user, such
	 * as the `updateUser` input function rejecting or timing out: then there
	 * are no `issues`; see `cause`.
	 */
	| "USER_VALIDATION_FAILED"
	/** Tokens or a saved session that can't be used, such as an expired access token at sign-in. */
	| "INVALID_SESSION"
	/** Storage could not be read, written, or cleared. */
	| "PERSISTENCE_FAILED"
	/** The refresh callback threw, or a refresh had no callback or refresh token to use. */
	| "REFRESH_FAILED"
	/** The `revoke` callback failed. Published to `state.error`; `signOut()` still resolves. */
	| "REVOKE_FAILED"
	/** A newer sign-in, sign-out, or another tab replaced the session while the operation ran. */
	| "SESSION_CHANGED"
	/** The operation needs a signed-in session, and there is none. */
	| "UNAUTHENTICATED"
	/** The session is locked: `unlock()` it first. */
	| "LOCKED"
	/** `locking.open` failed, so the session stays locked. */
	| "UNLOCK_FAILED"
	/** An option or argument session-kit can't use, or a method used without the option it needs. */
	| "INVALID_OPTIONS";

/**
 * Options for the {@link AuthError} constructor: the standard `cause`, plus
 * schema `issues`.
 *
 * @example
 * ```ts
 * import { AuthError } from "@monarcode/session-kit";
 *
 * declare const response: Response;
 *
 * throw new AuthError("REFRESH_FAILED", "Refresh failed", {
 * 	cause: new Error(`HTTP ${response.status}`),
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthErrorOptions = ErrorOptions & {
	/** Schema issues behind a `USER_VALIDATION_FAILED` error. */
	issues?: readonly StandardSchemaV1.Issue[] | undefined;
};

/**
 * An error from session-kit's own logic, whether thrown, rejected with, or
 * published in `state.error`. `code` says what went wrong (see
 * {@link AuthErrorCode}), `cause` holds whatever failed underneath, which can
 * be anything, and `issues` the schema's issues when validation failed.
 * `authFetch` lets `fetch`'s and `Request`'s own failures, such as a network
 * error, through unchanged.
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
 * 		console.warn(error.issues ?? error.cause);
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
 * Returns `cause` unchanged when it is already an `AuthError`; otherwise wraps
 * it with `code`. The code is a fallback, not a guarantee.
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
