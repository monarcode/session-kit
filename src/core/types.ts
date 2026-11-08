import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AuthDebug } from "./debug.js";
import type { AuthError } from "./errors.js";
import type { AccessTokenUser, UserSource } from "./sources.js";
import type { AuthStorage } from "./storage.js";

/**
 * What the user source produces: the shape exposed in `state.user` and
 * {@link Session}`.user`. See {@link UserInput} for what it accepts.
 *
 * @example
 * ```ts
 * import type { User } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * const userSchema = z.object({ id: z.string(), email: z.string() });
 *
 * type AppUser = User<typeof userSchema>; // { id: string; email: string }
 * ```
 *
 * @since 0.1.0
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
 * take no user. See {@link User} for what the schema produces.
 *
 * @example
 * ```ts
 * import type { User, UserInput } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * const userSchema = z.object({
 * 	id: z.string(),
 * 	role: z.enum(["admin", "member"]).default("member"),
 * });
 *
 * type NewUser = UserInput<typeof userSchema>; // `role` is optional
 * type AppUser = User<typeof userSchema>; // `role` is always set
 * ```
 *
 * @since 0.1.0
 */
export type UserInput<Src extends UserSource> =
	Src extends AccessTokenUser<any, any>
		? never
		: Src extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Src>
			: never;

/**
 * Tokens from your backend, passed to `signIn` or returned by the refresh
 * callback ({@link RefreshFn}).
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
 *
 * @example
 * ```ts
 * import type { Tokens } from "@monarcode/session-kit";
 *
 * declare const body: {
 * 	access_token: string;
 * 	refresh_token: string;
 * 	expires_in: number;
 * };
 *
 * const tokens: Tokens = {
 * 	accessToken: body.access_token,
 * 	refreshToken: body.refresh_token,
 * 	expiresIn: body.expires_in,
 * };
 * ```
 *
 * @since 0.1.0
 */
export type Tokens = {
	/** Sent as `Authorization: Bearer <accessToken>` by `createAuthFetch`. */
	accessToken: string;
	/**
	 * Passed to the refresh callback. Without it, an expired or rejected access
	 * token signs the user out. When refresh omits it, the current one is kept.
	 */
	refreshToken?: string | undefined;
	/**
	 * Access token lifetime in **seconds**, as in OAuth `expires_in`, such as
	 * `900` for 15 minutes. Counted from receipt, so a wrong browser clock
	 * cannot expire the token early or late.
	 */
	expiresIn?: number | undefined;
	/**
	 * Absolute expiry as Unix time in **milliseconds**, such as
	 * `Date.parse("2026-10-02T12:15:00Z")`, compared with the browser clock.
	 * Use only when the backend gives no lifetime; prefer `expiresIn`.
	 */
	expiresAt?: number | undefined;
};

/**
 * Input to `signIn`: {@link Tokens}, plus the user when a schema validates it.
 * When the user comes from the access token (`I` is `never`), tokens only.
 *
 * @example
 * ```ts
 * import type { SignInInput } from "@monarcode/session-kit";
 *
 * type NewUser = { id: string; email: string };
 *
 * const input: SignInInput<NewUser> = {
 * 	accessToken: "eyJhbGciOi…",
 * 	expiresIn: 900,
 * 	user: { id: "1", email: "ada@example.com" },
 * };
 *
 * // With `fromAccessToken`, the user is read from the token.
 * const tokensOnly: SignInInput<never> = { accessToken: "eyJhbGciOi…" };
 * ```
 *
 * @since 0.1.0
 */
export type SignInInput<I> = [I] extends [never]
	? Tokens & { user?: undefined }
	: Tokens & {
			/** Validated, copied, and frozen. Must be a plain JSON object. */
			user: I;
		};

/**
 * What the refresh callback ({@link RefreshFn}) returns:
 * - {@link Tokens}: install them. They must last at least five seconds. An
 *   omitted `refreshToken` or `user` keeps the current value.
 * - `null`: the backend rejected the refresh token. Sign out and clear storage.
 *
 * Throw instead for operational failures (network errors, 5xx). Credentials are
 * kept and the error is exposed in `state.error`. When the user comes from the
 * access token, return tokens only; the user is read from the new token.
 *
 * @example
 * ```ts
 * import type { RefreshResult } from "@monarcode/session-kit";
 *
 * async function toRefreshResult(response: Response): Promise<RefreshResult> {
 * 	if (response.status === 401) return null; // rejected: sign out
 * 	if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
 * 	const body = (await response.json()) as {
 * 		access_token: string;
 * 		expires_in: number;
 * 	};
 * 	return { accessToken: body.access_token, expiresIn: body.expires_in };
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RefreshResult<I = never> =
	| (Tokens &
			([I] extends [never]
				? { user?: undefined }
				: {
						/** Replaces the profile unless `updateUser` ran during the refresh. */
						user?: I | undefined;
					}))
	| null;

/**
 * Exchanges a refresh token for new tokens: the `refresh` option of
 * {@link AuthOptions}. Concurrent refreshes share one call. See
 * {@link RefreshResult} for what to return or throw.
 *
 * @example
 * ```ts
 * import type { RefreshFn } from "@monarcode/session-kit";
 *
 * type NewUser = { id: string; email: string };
 *
 * const refresh: RefreshFn<NewUser> = async ({ refreshToken, signal }) => {
 * 	const response = await fetch("/api/auth/refresh", {
 * 		method: "POST",
 * 		signal,
 * 		headers: { "Content-Type": "application/json" },
 * 		body: JSON.stringify({ refreshToken }),
 * 	});
 * 	if (response.status === 401) return null;
 * 	if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
 * 	return (await response.json()) as {
 * 		accessToken: string;
 * 		expiresIn: number;
 * 		user: NewUser;
 * 	};
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RefreshFn<I = never> = (context: {
	refreshToken: string;
	/** Aborted when the session changes or after the 15-second deadline. */
	signal: AbortSignal;
}) => Promise<RefreshResult<I>>;

/**
 * Revokes the signed-out session's tokens on the backend: the `revoke` option
 * of {@link AuthOptions}. Called by `signOut()` after the local session is
 * gone, so the UI never waits for it to change. A failure is published as
 * `REVOKE_FAILED` without rejecting `signOut()`. Not called when the backend
 * itself ended the session, or when signing out from `locked`, since the
 * tokens are sealed.
 *
 * @example
 * ```ts
 * import type { RevokeFn } from "@monarcode/session-kit";
 *
 * const revoke: RevokeFn = async ({ refreshToken, signal }) => {
 * 	if (!refreshToken) return;
 * 	await fetch("/api/auth/revoke", {
 * 		method: "POST",
 * 		signal,
 * 		headers: { "Content-Type": "application/json" },
 * 		body: JSON.stringify({ refreshToken }),
 * 	});
 * };
 * ```
 *
 * @since 0.1.0
 */
export type RevokeFn = (context: {
	accessToken: string;
	refreshToken?: string | undefined;
	/** Aborted after the 15-second deadline. */
	signal: AbortSignal;
}) => Promise<void>;

/**
 * Who is signed in, from `getSession()`. Holds no tokens, so it is safe in
 * route context. See {@link Credentials} for the access token.
 *
 * @example
 * ```ts
 * import type { Session } from "@monarcode/session-kit";
 *
 * type AppUser = { id: string; name: string };
 *
 * function greeting(session: Session<AppUser> | null) {
 * 	return session ? `Hi, ${session.user.name}` : "Please sign in";
 * }
 * ```
 *
 * @since 0.1.0
 */
export type Session<U> = Readonly<{
	/** Stable across refreshes and profile updates; new on every sign-in. */
	sessionId: string;
	user: U;
}>;

/**
 * The current access token, from `credentials.get()`, for attaching to
 * requests. `createAuthFetch` from `@monarcode/session-kit/http` does this
 * for you.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 *
 * type AppUser = { id: string };
 * declare const auth: AuthClient<AppUser, AppUser>;
 *
 * const credentials = await auth.credentials.get();
 * if (credentials) {
 * 	const response = await fetch("/api/orders", {
 * 		headers: { Authorization: `Bearer ${credentials.accessToken}` },
 * 	});
 * 	if (response.status === 401) await auth.credentials.renew(credentials);
 * }
 * ```
 *
 * @since 0.1.0
 */
export type Credentials = Readonly<{
	sessionId: string;
	accessToken: string;
	/**
	 * Unix time in milliseconds on **this browser's clock**, normalized from
	 * `expiresIn`, `expiresAt`, or JWT claims. Safe to compare with `Date.now()`.
	 */
	expiresAt?: number | undefined;
}>;

/**
 * Where the session stands, as `state.status` ({@link AuthState}):
 * - `initializing`: restoring the saved session has not finished.
 * - `authenticated`: access is locally usable; `user` is set.
 * - `refreshing`: a refresh is replacing expired or rejected access; `user` stays visible.
 * - `locked`: with `locking`, a session is saved and `user` is set, but its
 *   tokens wait for `unlock()`.
 * - `unauthenticated`: no session; sign-in is needed.
 * - `unavailable`: restoration failed, or the credentials cannot supply usable access.
 *
 * @example
 * ```ts
 * import type { AuthStatus } from "@monarcode/session-kit";
 *
 * const labels: Record<AuthStatus, string> = {
 * 	initializing: "Loading…",
 * 	authenticated: "Signed in",
 * 	refreshing: "Signed in",
 * 	locked: "Locked",
 * 	unauthenticated: "Signed out",
 * 	unavailable: "Can't reach the server",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type AuthStatus =
	| "initializing"
	| "authenticated"
	| "refreshing"
	| "locked"
	| "unauthenticated"
	| "unavailable";

type StateFields = {
	/** Changes when guards must run again. */
	readonly version: number;
	/** The latest failure, cleared by the next successful change. */
	readonly error: AuthError | null;
};

type SignedInState<U, Status extends AuthStatus> = StateFields & {
	/** Where the session stands. See {@link AuthStatus}. */
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
 * Reactive auth snapshot, from `state.get()` or `useAuth()`. Tokens are
 * intentionally excluded. Checking `status` narrows `user`: it is set exactly
 * while `authenticated`, `refreshing`, or `locked`, so check `status`, not
 * `user`, to know whether access is usable.
 *
 * @example
 * ```ts
 * import type { AuthState } from "@monarcode/session-kit";
 *
 * type AppUser = { id: string; name: string };
 *
 * function describe(state: AuthState<AppUser>): string {
 * 	switch (state.status) {
 * 		case "authenticated":
 * 		case "refreshing":
 * 			return `Signed in as ${state.user.name}`;
 * 		case "locked":
 * 			return `Locked: ${state.user.name}`;
 * 		case "unavailable":
 * 			return state.error?.message ?? "Unavailable";
 * 		default:
 * 			return "Signed out";
 * 	}
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthState<U> =
	| SignedInState<U, "authenticated">
	| SignedInState<U, "refreshing">
	| SignedInState<U, "locked">
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
	 * Reactive {@link AuthState}. Read it in React with `useAuth`. `subscribe`
	 * reports later changes, not the current value. A listener that throws does
	 * not interrupt auth; its error is rethrown asynchronously.
	 */
	state: {
		get: () => AuthState<U>;
		subscribe: (listener: (state: AuthState<U>) => void) => {
			unsubscribe: () => void;
		};
	};
	/**
	 * Validates and saves a new session, replacing any current one, locked or
	 * not. The latest call wins: an earlier one still validating rejects with
	 * `SESSION_CHANGED`, as it does after `signOut()`. Rejects expired tokens
	 * with `INVALID_SESSION` and an invalid user with `USER_VALIDATION_FAILED`,
	 * keeping the previous session.
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
	 * until `retry()`, sign-in, or sign-out. Rejects with `LOCKED` while locked,
	 * as `retry`, `refresh`, `updateUser`, `credentials.get`, and
	 * `credentials.renew` do.
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
	/**
	 * Locks the session, with `locking`: the tokens leave memory and timers
	 * stop, while the saved session stays. `state` turns `locked` at once. A
	 * refresh already running still saves its tokens, and the promise settles
	 * after that save, so keep the key `seal` needs until then. Does nothing
	 * while signed out or locked. Rejects with `INVALID_OPTIONS` without
	 * `locking`.
	 */
	lock: () => Promise<void>;
	/**
	 * Unlocks a `locked` session, with `locking`: reads the saved tokens,
	 * opening them with `locking.open`, and resolves the session. Expired
	 * access is refreshed at once; a refresh token the backend rejects signs
	 * out and resolves `null`. A refresh that fails otherwise rejects with
	 * `REFRESH_FAILED`, but the session is unlocked all the same, and
	 * `unavailable` until `retry()`. Rejects with `UNLOCK_FAILED` when `open`
	 * throws or returns something other than a string, and the session stays
	 * locked; a saved session that can't be used signs out and rejects with
	 * `INVALID_SESSION`. Overlapping calls share one unlock. When not locked,
	 * resolves like `getSession()`. Rejects with `INVALID_OPTIONS` without
	 * `locking`.
	 */
	unlock: () => Promise<Session<U> | null>;
	/**
	 * Starts background work: expiry timers and cross-tab sync. Called by
	 * `AuthProvider` and the router adapters; mounts are counted, and the last
	 * cleanup stops the work. Every call also re-checks the session against
	 * the current clock: it restores the session if that is still to do or
	 * failed, refreshes access that has expired, and re-arms the timers.
	 */
	mount: () => () => void;
	/**
	 * Access tokens ({@link Credentials}), for code that attaches them to
	 * requests, such as `createAuthFetch`.
	 */
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
 * access token, in which case there is no `updateUser`. Prefer
 * `typeof auth`, which gets both right.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 *
 * type AppUser = { id: string; name: string };
 *
 * export async function rename(auth: AuthClient<AppUser, AppUser>, name: string) {
 * 	const session = await auth.getSession();
 * 	if (session) await auth.updateUser({ ...session.user, name });
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthClient<U, I> = AuthClientBase<U, I> &
	([I] extends [never]
		? unknown
		: {
				/**
				 * Replaces the user and keeps the session ID. Accepts the user or an
				 * async function returning it. If calls overlap, only the latest
				 * commits; the others reject with `SESSION_CHANGED`. Rejects with
				 * `UNAUTHENTICATED` while signed out, and with
				 * `USER_VALIDATION_FAILED` for an invalid user or when the input
				 * function rejects or times out.
				 */
				updateUser: (input: I | (() => Promise<I>)) => Promise<void>;
			});

/**
 * Encrypts the saved tokens with a key the app holds: the `locking` option of
 * {@link AuthOptions}. session-kit stores what `seal` returns beside the user
 * and session ID, which stay readable while locked, and calls `open` only from
 * `unlock()`: after that, the tokens are in memory.
 *
 * @example
 * ```ts
 * import type { AuthLocking } from "@monarcode/session-kit";
 *
 * declare const key: CryptoKey;
 * declare function encrypt(key: CryptoKey, plain: string): Promise<string>;
 * declare function decrypt(key: CryptoKey, sealed: string): Promise<string>;
 *
 * const locking: AuthLocking = {
 * 	seal: (payload) => encrypt(key, payload),
 * 	open: (sealed) => decrypt(key, sealed),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type AuthLocking = {
	/** Encrypts the tokens, a JSON string, whenever they are saved. */
	seal: (payload: string) => string | Promise<string>;
	/** Decrypts what `seal` returned. Must throw when it can't. */
	open: (sealed: string) => string | Promise<string>;
};

/**
 * Options for `createAuth`. `Src` is the user source, from which the client's
 * user types ({@link User}, {@link UserInput}) are inferred.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage, type AuthOptions } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * const userSchema = z.object({ id: z.string(), email: z.string() });
 *
 * const options: AuthOptions<typeof userSchema> = {
 * 	name: "my-app",
 * 	user: userSchema,
 * 	storage: webStorage(),
 * 	maxAge: 7 * 24 * 60 * 60, // a week
 * };
 *
 * export const auth = createAuth(options);
 * ```
 *
 * @since 0.1.0
 */
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
	/** Where the session is saved, such as `webStorage()`. See {@link AuthStorage}. */
	storage: AuthStorage;
	/**
	 * Exchanges a refresh token for new tokens, at expiry or after a 401. Without
	 * it, expired or rejected access signs the user out. See {@link RefreshFn}.
	 */
	refresh?: RefreshFn<NoInfer<UserInput<Src>>> | undefined;
	/** Revokes tokens on the backend after `signOut()`. See {@link RevokeFn}. */
	revoke?: RevokeFn | undefined;
	/** Saved-session lifetime in seconds, renewed on successful writes. Default: 30 days. */
	maxAge?: number | undefined;
	/**
	 * Reports what auth does, for debugging: restores, refreshes, timers,
	 * storage operations, and state changes. `true` logs to the console; a
	 * function receives each `AuthDebugEvent` instead. Tokens, saved values,
	 * user fields, and errors' causes are left out unless `{ sensitive: true }`.
	 * Pass a development flag, such as Expo's `__DEV__`, to keep it out of
	 * production. See {@link AuthDebug}. Default: off.
	 */
	debug?: AuthDebug | undefined;
	/**
	 * Restores a saved session as `locked`, with its user but not its tokens,
	 * until `unlock()`. `true` stores the tokens as they are; `{ seal, open }`
	 * encrypts them with the app's key ({@link AuthLocking}). For native apps:
	 * with `locking`, other tabs' changes aren't followed. Needs a user schema,
	 * since a user read from the access token can't be shown without its
	 * token. Default: off.
	 */
	locking?:
		| (Src extends AccessTokenUser<any, any> ? never : true | AuthLocking)
		| undefined;
};
