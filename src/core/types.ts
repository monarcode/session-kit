import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AuthError } from "./errors.js";
import type { AuthStorage } from "./storage.js";

/** What the user schema accepts: the shape passed to `signIn` and `updateUser`. */
export type UserInput<S extends StandardSchemaV1> =
	StandardSchemaV1.InferInput<S>;

/** What the user schema produces: the shape exposed in `state.user` and `Session.user`. */
export type User<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

/**
 * Tokens from your backend, passed to `signIn` or returned by the refresh callback.
 *
 * Expiry comes from the first of these that is present:
 * 1. `expiresAt`: an absolute deadline, compared with the browser clock.
 * 2. `expiresIn`: a lifetime, counted from when auth receives the tokens.
 * 3. A JWT access token's `exp - iat` lifetime, counted from receipt.
 * 4. A JWT access token's `exp` alone, compared with the browser clock.
 *
 * Prefer `expiresIn` (or a JWT with `iat`): browser clocks can be minutes off, and
 * a fast clock makes an absolute deadline look already passed, rejecting sign-in.
 * With none of these, the token never expires locally and is only replaced
 * after a 401. Passing both `expiresIn` and `expiresAt` is rejected.
 */
export type Tokens = {
	/** Sent as `Authorization: Bearer <accessToken>` by `createAuthFetch`. */
	accessToken: string;
	/**
	 * Passed to the refresh callback. Without it, an expired or rejected access
	 * token signs the user out. When refresh omits it, the current one is kept.
	 */
	refreshToken?: string;
	/**
	 * Access token lifetime in **seconds**, as in OAuth `expires_in`. Counted from
	 * receipt, so a wrong browser clock cannot expire the token early or late.
	 * @example 900 // 15 minutes
	 */
	expiresIn?: number;
	/**
	 * Absolute expiry as Unix time in **milliseconds**, compared with the browser
	 * clock. Use only when the backend gives no lifetime; prefer `expiresIn`.
	 * @example Date.parse("2026-10-02T12:15:00Z")
	 */
	expiresAt?: number;
};

/** Input to `signIn`: tokens plus the user, validated by `userSchema`. */
export type SignInInput<I> = Tokens & {
	/** Validated, cloned, and frozen. Must be a plain JSON object. */
	user: I;
};

/**
 * What the refresh callback returns:
 * - Tokens: install them. They must last at least five seconds. An omitted
 *   `refreshToken` or `user` keeps the current value.
 * - `null`: the backend rejected the refresh token. Sign out and clear storage.
 *
 * Throw instead for operational failures (network errors, 5xx). Credentials are
 * kept and the error is exposed in `state.error`.
 */
export type RefreshResult<I = never> =
	| (Tokens & {
			/** Replaces the profile unless `updateUser` ran during the refresh. */
			user?: I;
	  })
	| null;

/** Exchanges a refresh token for new tokens. See `RefreshResult`. */
export type RefreshFn<I = never> = (context: {
	/** The current session's refresh token. */
	refreshToken: string;
	/** Aborted when the session changes or after the 15-second deadline. */
	signal: AbortSignal;
}) => Promise<RefreshResult<I>>;

/** A frozen snapshot of the current credentials, from `getSession()`. */
export type Session<U> = Readonly<{
	/** Stable across refreshes and profile updates; new on every sign-in. */
	id: string;
	accessToken: string;
	/**
	 * Unix time in milliseconds on **this browser's clock**, normalized from
	 * `expiresIn`, `expiresAt`, or JWT claims. Safe to compare with `Date.now()`.
	 */
	expiresAt?: number;
	/** The validated user, as produced by `userSchema`. */
	user: U;
}>;

/**
 * - `initializing`: restoring the saved session has not finished.
 * - `authenticated`: access is locally usable; `user` is set.
 * - `refreshing`: a refresh is replacing expired or rejected access; `user` stays visible.
 * - `unauthenticated`: no session; sign-in is needed.
 * - `unavailable`: restoration failed, or the credentials cannot supply usable access.
 */
export type AuthStatus =
	| "initializing"
	| "authenticated"
	| "refreshing"
	| "unauthenticated"
	| "unavailable";

/** Reactive auth snapshot. Tokens are intentionally excluded. */
export type AuthState<U> = Readonly<{
	/** See `AuthStatus`. */
	status: AuthStatus;
	/** The validated user while `authenticated` or `refreshing`; otherwise `null`. */
	user: U | null;
	/** The current `Session.id`, or `null` when signed out. */
	sessionId: string | null;
	/** Changes when guards must run again. */
	version: number;
	/** The latest failure, cleared by the next successful change. */
	error: AuthError | null;
}>;

export type AuthClient<I, U> = {
	/**
	 * Reactive `AuthState`. Read it in React with `useAuth`. `subscribe` reports
	 * later changes, not the current value. A listener that throws does not
	 * interrupt auth; its error is rethrown asynchronously.
	 */
	state: {
		get: () => AuthState<U>;
		subscribe: (listener: (state: AuthState<U>) => void) => {
			unsubscribe: () => void;
		};
	};
	/**
	 * Validates and saves a new session, replacing any current one. The latest
	 * call wins. Rejects expired tokens; invalid input keeps the previous session.
	 */
	signIn: (input: SignInInput<I>) => Promise<void>;
	/**
	 * Ends the session in this tab and clears storage. Rejects with
	 * `PERSISTENCE_FAILED` if storage cannot be cleared; call it again later.
	 */
	signOut: () => Promise<void>;
	/**
	 * Replaces the user and keeps the session ID. Accepts the user or an async
	 * function returning it. If calls overlap, only the latest commits.
	 */
	updateUser: (input: I | (() => Promise<I>)) => Promise<void>;
	/**
	 * Resolves the current session, restoring or refreshing it if needed, or
	 * `null` when signed out. After a failed refresh, rethrows that failure until
	 * `retry()`, sign-in, or sign-out.
	 */
	getSession: () => Promise<Session<U> | null>;
	/** Like `getSession()`, but tries a failed refresh again. */
	retry: () => Promise<Session<U> | null>;
	/**
	 * Recovers after the server rejected this session's access token, e.g. a 401.
	 * Concurrent calls share one refresh. Without a refresh callback or refresh
	 * token, signs out and resolves `null`.
	 */
	refresh: (session: Session<U>) => Promise<Session<U> | null>;
	/** Signs out only if this session and access token are still current. */
	rejectSession: (session: Session<U>) => Promise<void>;
	/** Whether this snapshot belongs to the current session (same `id`). */
	isCurrent: (session: Session<U>) => boolean;
	/** Called by the Router connector. Cleanup stops background timers. */
	mount: () => () => void;
};

export type AuthOptions<S extends StandardSchemaV1> = {
	/**
	 * Storage namespace: letters, digits, `_` or `-`, up to 64 characters. Uses
	 * the storage key `<name>:auth:session` and the lock `<name>:auth:refresh`.
	 */
	name: string;
	/**
	 * Where the session is saved. Default: `webStorage()`, which uses
	 * `localStorage`. See `AuthStorage` to save it elsewhere.
	 */
	storage?: AuthStorage;
	/**
	 * Standard Schema V1 schema for the user. Its output must be a plain JSON
	 * object and must validate again when restored from storage.
	 */
	userSchema: S;
	/**
	 * Exchanges a refresh token for new tokens, at expiry or after a 401. Without
	 * it, expired or rejected access signs the user out. See `RefreshFn`.
	 */
	refresh?: RefreshFn<NoInfer<UserInput<S>>>;
	/** Saved-session lifetime in seconds, renewed on successful writes. Default: 30 days. */
	maxAge?: number;
};
