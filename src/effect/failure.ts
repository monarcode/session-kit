import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { AuthError, type AuthErrorCode } from "../core/errors.js";

/**
 * The codes an {@link AuthFailure} carries: every `AuthErrorCode` except
 * `INVALID_OPTIONS`, which is misuse and so a defect.
 *
 * @example
 * ```ts
 * import type { AuthFailureCode } from "@monarcode/session-kit/effect";
 *
 * const retryable: AuthFailureCode[] = ["REFRESH_FAILED", "PERSISTENCE_FAILED"];
 * ```
 *
 * @since 0.1.0
 */
export type AuthFailureCode = Exclude<AuthErrorCode, "INVALID_OPTIONS">;

/**
 * How the Effects of `Auth` fail: the `AuthError` the client rejected with,
 * as a tagged error, so `Effect.catchTag("AuthFailure", …)` handles it. Match
 * on `code`; the original error is the `cause`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { Auth } from "@monarcode/session-kit/effect";
 *
 * export const userName = Auth.session.pipe(
 * 	Effect.map((session) => String(session.user)),
 * 	Effect.catchTag("AuthFailure", (failure) =>
 * 		failure.code === "UNAUTHENTICATED"
 * 			? Effect.succeed("guest")
 * 			: Effect.fail(failure),
 * 	),
 * );
 * ```
 *
 * @since 0.1.0
 */
export class AuthFailure extends Data.TaggedError("AuthFailure")<{
	/** Why it failed: the `AuthError`'s code. */
	readonly code: AuthFailureCode;
	/** The `AuthError`'s message. */
	readonly message: string;
	/** The `AuthError` the client rejected with. */
	readonly cause: AuthError;
}> {}

/**
 * Fails with the {@link AuthFailure} for `error`. Anything that isn't an
 * `AuthError`, and `INVALID_OPTIONS`, is a defect: the Effect dies with it.
 */
export function fromAuthError(
	error: unknown,
): Effect.Effect<never, AuthFailure> {
	if (!(error instanceof AuthError) || error.code === "INVALID_OPTIONS")
		return Effect.die(error);
	return Effect.fail(
		new AuthFailure({
			code: error.code,
			message: error.message,
			cause: error,
		}),
	);
}

/** Runs the client call `run`, failing as {@link fromAuthError} does. */
export function fromPromise<A>(
	run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, AuthFailure> {
	return Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
		Effect.catch(fromAuthError),
	);
}

/** An {@link AuthFailure} for `UNAUTHENTICATED`, with `message`. */
export function unauthenticated(message: string): AuthFailure {
	const cause = new AuthError("UNAUTHENTICATED", message);
	return new AuthFailure({ code: "UNAUTHENTICATED", message, cause });
}
