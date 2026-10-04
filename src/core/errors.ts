import type { StandardSchemaV1 } from "@standard-schema/spec";

export type AuthErrorCode =
	| "USER_VALIDATION_FAILED"
	| "INVALID_SESSION"
	| "PERSISTENCE_FAILED"
	| "REFRESH_FAILED"
	| "SESSION_CHANGED"
	| "UNAUTHENTICATED";

export type AuthErrorOptions = ErrorOptions & {
	/** Schema issues behind a `USER_VALIDATION_FAILED` error. */
	issues?: readonly StandardSchemaV1.Issue[];
};

export class AuthError extends Error {
	readonly issues?: readonly StandardSchemaV1.Issue[];

	constructor(
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

export function sessionChanged(): AuthError {
	return new AuthError(
		"SESSION_CHANGED",
		"The session changed during this operation",
	);
}
