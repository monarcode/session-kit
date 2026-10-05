import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AuthError } from "./errors.js";
import type { AccessTokenUser, UserSource } from "./sources.js";
import type { AuthStorage } from "./storage.js";

/**
 * What the user source produces: the shape exposed in `state.user` and
 * `Session.user`.
 */
export type User<Src extends UserSource> =
	Src extends AccessTokenUser<any, infer U>
		? U
		: Src extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Src>
			: never;

/**
 * What the user schema accepts: the `user` passed to `signIn` and
 * `updateUser`. `never` when the user comes from the access token, so those
 * take no user.
 */
export type UserInput<Src extends UserSource> =
	Src extends AccessTokenUser<any, any>
		? never
		: Src extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Src>
			: never;

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

/**
 * Input to `signIn`: tokens, plus the user when a schema validates it. When the
 * user comes from the access token (`I` is `never`), tokens only.
 */
export type SignInInput<I> = [I] extends [never]
	? Tokens & { user?: never }
	: Tokens & {
			/** Validated, copied, and frozen. Must be a plain JSON object. */
			user: I;
		};

/**
 * What the refresh callback returns:
 * - Tokens: install them. They must last at least five seconds. An omitted
 *   `refreshToken` or `user` keeps the current value.
 * - `null`: the backend rejected the refresh token. Sign out and clear storage.
 *
 * Throw instead for operational failures (network errors, 5xx). Credentials are
 * kept and the error is exposed in `state.error`. When the user comes from the
 * access token, return tokens only; the user is read from the new token.
 */
export type RefreshResult<I = never> =
	| (Tokens &
			([I] extends [never]
				? { user?: never }
				: {
						/** Replaces the profile unless `updateUser` ran during the refresh. */
						user?: I;
					}))
	| null;

/** Exchanges a refresh token for new tokens. See `RefreshResult`. */
export type RefreshFn<I = never> = (context: {
	/** The current session's refresh token. */
	refreshToken: string;
	/** Aborted when the session changes or after the 15-second deadline. */
	signal: AbortSignal;
}) => Promise<RefreshResult<I>>;

/**
 * Revokes the signed-out session's tokens on the backend. Called by `signOut()`
 * after the local session is gone, so the UI never waits for it to change.
 */
export type RevokeFn = (context: {
	accessToken: string;
	refreshToken?: string;
	/** Aborted after the 15-second deadline. */
	signal: AbortSignal;
}) => Promise<void>;

/** Who is signed in, from `getSession()`. Holds no tokens, so it is safe in route context. */
export type Session<U> = Readonly<{
	/** Stable across refreshes and profile updates; new on every sign-in. */
	sessionId: string;
	/** The validated user. */
	user: U;
}>;

/** The current access token, from `credentials.get()`, for attaching to requests. */
export type Credentials = Readonly<{
	/** The session these credentials belong to. */
	sessionId: string;
	accessToken: string;
	/**
	 * Unix time in milliseconds on **this browser's clock**, normalized from
	 * `expiresIn`, `expiresAt`, or JWT claims. Safe to compare with `Date.now()`.
	 */
	expiresAt?: number;
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

type StateFields = {
	/** Changes when guards must run again. */
	readonly version: number;
	/** The latest failure, cleared by the next successful change. */
	readonly error: AuthError | null;
};

type SignedInState<U, Status extends AuthStatus> = StateFields & {
	readonly status: Status;
	readonly user: U;
	readonly sessionId: string;
};

type SignedOutState<Status extends AuthStatus> = StateFields & {
	readonly status: Status;
	readonly user: null;
	readonly sessionId: null;
};

/**
 * Reactive auth snapshot. Tokens are intentionally excluded. Checking `status`
 * narrows `user`: it is set exactly while `authenticated` or `refreshing`.
 */
export type AuthState<U> =
	| SignedInState<U, "authenticated">
	| SignedInState<U, "refreshing">
	| SignedOutState<"initializing">
	| SignedOutState<"unauthenticated">
	| (StateFields & {
			readonly status: "unavailable";
			readonly user: null;
			/** The session whose access is unusable, if any. */
			readonly sessionId: string | null;
	  });

type AuthClientBase<U, I> = {
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
	 * Ends the session in this tab and clears storage, then calls `revoke`. A
	 * failed revocation is published as `REVOKE_FAILED` without rejecting.
	 * Rejects with `PERSISTENCE_FAILED` if storage cannot be cleared; call it
	 * again later.
	 */
	signOut: () => Promise<void>;
	/**
	 * Resolves who is signed in, restoring or refreshing the session if needed,
	 * or `null` when signed out. After a failed refresh, rethrows that failure
	 * until `retry()`, sign-in, or sign-out.
	 */
	getSession: () => Promise<Session<U> | null>;
	/** Like `getSession()`, but tries a failed refresh again. */
	retry: () => Promise<Session<U> | null>;
	/**
	 * Refreshes now, even if the access token is still usable, for example to
	 * pick up a changed user. Concurrent refreshes share one request. Rejects
	 * with `REFRESH_FAILED` without a refresh callback or refresh token.
	 */
	refresh: () => Promise<Session<U> | null>;
	/** Whether this snapshot belongs to the current session (same `sessionId`). */
	isCurrent: (session: { sessionId: string }) => boolean;
	/** Called by the Router connector. Cleanup stops background timers. */
	mount: () => () => void;
	/** Access tokens, for code that attaches them to requests, such as `createAuthFetch`. */
	credentials: {
		/** Like `getSession()`, but resolves the current access token. */
		get: () => Promise<Credentials | null>;
		/**
		 * Recovers after the server rejected these credentials, e.g. with a 401.
		 * Concurrent calls share one refresh. Without a refresh callback or
		 * refresh token, signs out and resolves `null`.
		 */
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/** Signs out only if these credentials are still current. */
		reject: (credentials: Credentials) => Promise<void>;
	};
};

/**
 * The auth client from `createAuth`. `U` is the user; `I` is what `signIn` and
 * `updateUser` accept as the user, or `never` when the user comes from the
 * access token, in which case there is no `updateUser`.
 */
export type AuthClient<U, I = never> = AuthClientBase<U, I> &
	([I] extends [never]
		? unknown
		: {
				/**
				 * Replaces the user and keeps the session ID. Accepts the user or an
				 * async function returning it. If calls overlap, only the latest commits.
				 */
				updateUser: (input: I | (() => Promise<I>)) => Promise<void>;
			});

export type AuthOptions<Src extends UserSource> = {
	/**
	 * Storage namespace: letters, digits, `_` or `-`, up to 64 characters. Uses
	 * the storage key `<name>:auth:session` and the lock `<name>:auth:refresh`.
	 */
	name: string;
	/**
	 * Where the user comes from. A Standard Schema V1 schema validates the
	 * `user` passed to `signIn`; its output must be a plain JSON object that
	 * the schema accepts again unchanged, because restoring validates it again.
	 * `fromAccessToken(…)` reads the user from the access token instead.
	 */
	user: Src;
	/** Where the session is saved, such as `webStorage()`. See `AuthStorage`. */
	storage: AuthStorage;
	/**
	 * Exchanges a refresh token for new tokens, at expiry or after a 401. Without
	 * it, expired or rejected access signs the user out. See `RefreshFn`.
	 */
	refresh?: RefreshFn<NoInfer<UserInput<Src>>>;
	/** Revokes tokens on the backend after `signOut()`. See `RevokeFn`. */
	revoke?: RevokeFn;
	/** Saved-session lifetime in seconds, renewed on successful writes. Default: 30 days. */
	maxAge?: number;
};
