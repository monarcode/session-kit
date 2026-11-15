import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AuthDebug } from "./debug.js";
import type { AuthError } from "./errors.js";
import type { AccessTokenUser, UserSource } from "./sources.js";
import type { AuthStorage } from "./storage.js";

/**
 * The signed-in user's type, inferred from the `user` option: what
 * `state.user` and `session.user` hold.
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
 * @see {@link UserInput} for the user that `signIn` accepts
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
 * The user that `signIn` and `updateUser` accept, inferred from the `user`
 * option. It differs from {@link User} when the schema has defaults or
 * transforms.
 *
 * It's `never` with `fromAccessToken`. The user is then read from the token,
 * so `signIn` takes tokens only.
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
 * The tokens your backend issues. Pass them to `signIn`, and return them from
 * your refresh callback ({@link RefreshFn}).
 *
 * When the access token expires comes from the first of these that is set:
 * 1. `expiresIn` or `expiresAt`. Pass one, not both.
 * 2. A JWT access token's `exp - iat`, counted from when auth receives it.
 * 3. A JWT access token's `exp` alone, compared with the device's clock.
 *
 * With none of them, the token never expires on its own. It's replaced only
 * after your API rejects it.
 *
 * Prefer `expiresIn`, or a JWT with `iat`. Device clocks can be minutes off,
 * and a clock that runs fast makes a fixed deadline look already passed, so
 * `signIn` would reject the tokens.
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
	/**
	 * The token your API accepts. `createAuthFetch` sends it as
	 * `Authorization: Bearer <accessToken>`.
	 */
	accessToken: string;
	/**
	 * The token your refresh callback exchanges for new tokens. Without one,
	 * the user is signed out when the access token expires or is rejected. A
	 * refresh that returns none keeps the current one.
	 */
	refreshToken?: string | undefined;
	/**
	 * How long the access token lasts, in **seconds**, like OAuth's
	 * `expires_in` (`900` is 15 minutes). It's counted from when auth receives
	 * the token, so a wrong device clock doesn't matter.
	 */
	expiresIn?: number | undefined;
	/**
	 * When the access token expires, as Unix time in **milliseconds**, such as
	 * `Date.parse("2026-10-02T12:15:00Z")`. It's compared with the device's
	 * clock, so use it only when your backend gives no lifetime.
	 */
	expiresAt?: number | undefined;
};

/**
 * What `signIn` takes: the {@link Tokens}, plus the `user` when a schema
 * validates it. With `fromAccessToken` (`I` is `never`), it takes tokens only.
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
			/**
			 * The signed-in user, checked against the `user` schema. It must be a
			 * plain JSON object. Auth keeps a frozen copy.
			 */
			user: I;
		};

/**
 * What your refresh callback ({@link RefreshFn}) returns:
 * - {@link Tokens}: the new tokens. They must last at least five seconds.
 *   Leave out `refreshToken` or `user` to keep the current one.
 * - `null`: your backend rejected the refresh token. The user is signed out.
 *
 * For any other failure, such as a network error or a 5xx, throw. The session
 * is kept, and the failure shows as a `REFRESH_FAILED` error whose `cause` is
 * what you threw.
 *
 * With `fromAccessToken`, return tokens only. The user is read from the new
 * access token.
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
						/**
						 * The user, if your backend sends one with the tokens. If
						 * `updateUser` ran during the refresh, its user is kept
						 * instead.
						 */
						user?: I | undefined;
					}))
	| null;

/**
 * Exchanges a refresh token for new tokens. It's the `refresh` option of
 * {@link AuthOptions}.
 *
 * Auth calls it whenever it needs a new access token: shortly before the
 * current one expires (while mounted), once it has expired, when your API
 * rejects it, on `refresh()`, and on `retry()` once it has expired. It never
 * runs two at once. Callers that need a refresh while one runs share its
 * result.
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
 * @see {@link RefreshResult} for what to return or throw
 *
 * @since 0.1.0
 */
export type RefreshFn<I = never> = (context: {
	/** The current refresh token, to send to your backend. */
	refreshToken: string;
	/**
	 * Aborted when the session changes, such as on sign-out, or after 15
	 * seconds. Pass it to `fetch`.
	 */
	signal: AbortSignal;
}) => Promise<RefreshResult<I>>;

/**
 * Asks your backend to revoke the tokens of a session that just signed out.
 * It's the `revoke` option of {@link AuthOptions}.
 *
 * `signOut()` calls it after the user is already signed out, so a UI that
 * follows the state never waits for it. `signOut()` itself resolves once it
 * settles. If it fails, `state.error` shows `REVOKE_FAILED`, and `signOut()`
 * still resolves.
 *
 * It isn't called when your backend ended the session itself, or when a
 * `locked` session signs out, as its tokens aren't in memory.
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
	/** Aborted after 15 seconds. Pass it to `fetch`. */
	signal: AbortSignal;
}) => Promise<void>;

/**
 * Who is signed in: the session ID and the user, from `getSession()`. It
 * holds no tokens, so it's safe to keep in route context or pass around.
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
 * @see {@link Credentials} for the access token
 *
 * @since 0.1.0
 */
export type Session<U> = Readonly<{
	/**
	 * Identifies this sign-in. It stays the same across refreshes and profile
	 * updates, and is new on every sign-in.
	 */
	sessionId: string;
	user: U;
}>;

/**
 * The current access token, from `credentials.get()`, to send with your API
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
	 * When the access token expires, as Unix time in milliseconds on **this
	 * device's clock**, so you can compare it with `Date.now()`. `undefined`
	 * when the token has no known expiry.
	 */
	expiresAt?: number | undefined;
}>;

/**
 * Where the session stands: `state.status` ({@link AuthState}).
 * - `initializing`: the saved session hasn't been read yet.
 * - `authenticated`: signed in, with an access token that hasn't expired or
 *   been rejected.
 * - `refreshing`: signed in, and replacing an access token that expired or
 *   was rejected.
 * - `locked`: signed in, but the tokens wait for `unlock()` (with `locking`).
 * - `unauthenticated`: signed out.
 * - `unavailable`: the access token expired or was rejected and couldn't be
 *   refreshed, or the saved session couldn't be read. `state.error` usually
 *   says why. On a client, `retry()` tries again.
 *
 * `user` is set while `authenticated`, `refreshing` or `locked`.
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
	/**
	 * A number that changes when route guards should check the session again:
	 * on sign-in, sign-out, a new user or a change of status. A token refresh
	 * doesn't change it.
	 */
	readonly version: number;
	/**
	 * The latest failure, such as a refresh that failed. The next successful
	 * change clears it.
	 */
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
 * The current auth state, from `state.get()` or `useAuth()`. It holds no
 * tokens.
 *
 * Check `status`, not `user`, to know whether requests can be made. `user`
 * stays set while `locked`, when they can't. `isSignedIn` is that check.
 * Checking `status` also narrows `user`, so TypeScript knows when it's set.
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
			/**
			 * The session whose access token can't be used, or `null` when the
			 * saved session couldn't be read.
			 */
			readonly sessionId: string | null;
	  });

type AuthClientBase<U, I> = {
	/**
	 * The current {@link AuthState}, and a way to listen for changes. In React,
	 * read it with `useAuth`.
	 *
	 * `subscribe` calls the listener on each later change, not with the
	 * current state. A listener that throws doesn't break auth. Its error is
	 * rethrown asynchronously.
	 */
	state: {
		get: () => AuthState<U>;
		subscribe: (listener: (state: AuthState<U>) => void) => {
			unsubscribe: () => void;
		};
	};
	/**
	 * Signs in with the tokens your backend issued, and saves the session. It
	 * replaces any current session, even a locked one.
	 *
	 * Rejects with `INVALID_SESSION` for tokens it can't use, such as ones that
	 * already expired, and with `USER_VALIDATION_FAILED` for a user the schema
	 * rejects. The previous session then stays. If `signIn` or `signOut()` is
	 * called again while it's still checking the user, it rejects with
	 * `SESSION_CHANGED`, as the latest call wins.
	 *
	 * If the session can't be saved, it rejects with `PERSISTENCE_FAILED`, and
	 * no one is signed in.
	 */
	signIn: (input: SignInInput<I>) => Promise<void>;
	/**
	 * Signs out at once, clears the saved session, then calls your `revoke`
	 * option and waits for it. Other tabs that share the storage sign out too,
	 * when it reports changes (`subscribe`) and `locking` is off.
	 *
	 * If `revoke` fails, `state.error` shows `REVOKE_FAILED`, and `signOut()`
	 * still resolves. If storage can't be cleared, it rejects with
	 * `PERSISTENCE_FAILED`. The app is signed out anyway, but the next load
	 * would restore the session, so call it again later.
	 */
	signOut: () => Promise<void>;
	/**
	 * Resolves who is signed in, or `null` when signed out. It reads the saved
	 * session first if needed, and refreshes an expired access token.
	 *
	 * After a refresh fails, it rejects with that failure until `retry()`,
	 * `signIn` or `signOut()`. Rejects with `PERSISTENCE_FAILED` when the saved
	 * session can't be read, with `SESSION_CHANGED` when the session changes
	 * while it runs, and with `LOCKED` while locked.
	 */
	getSession: () => Promise<Session<U> | null>;
	/**
	 * Like `getSession()`, but tries a failed refresh again instead of
	 * rejecting with its error. Use it for a "Try again" button.
	 */
	retry: () => Promise<Session<U> | null>;
	/**
	 * Refreshes the tokens now, even if the access token is still valid, for
	 * example to pick up changes to the user. Resolves `null` when signed out.
	 *
	 * Rejects with `REFRESH_FAILED` when there's no `refresh` option or no
	 * refresh token, and with `LOCKED` while locked.
	 */
	refresh: () => Promise<Session<U> | null>;
	/**
	 * Whether `session` is still the signed-in one, by its `sessionId`. Use it
	 * to drop a response that arrives after the user signed out or switched
	 * accounts.
	 */
	isCurrent: (session: { sessionId: string }) => boolean;
	/**
	 * Locks the session (with `locking`). The tokens leave memory and timers
	 * stop, but the saved session and `state.user` stay. `state.status` turns
	 * `locked` at once.
	 *
	 * While locked, `getSession`, `retry`, `refresh`, `updateUser`,
	 * `credentials.get` and `credentials.renew` reject with `LOCKED`. Call
	 * `unlock()` to continue, or `signOut()`.
	 *
	 * A refresh already running still saves its tokens, and `lock()` resolves
	 * after that save. Keep the key `seal` needs until then. Does nothing when
	 * signed out or already locked. Rejects with `INVALID_OPTIONS` without
	 * `locking`.
	 */
	lock: () => Promise<void>;
	/**
	 * Unlocks a `locked` session and resolves it. It reads the saved tokens and
	 * opens them with `locking.open`. When not locked, it acts like
	 * `getSession()`. Overlapping calls share one unlock.
	 *
	 * If `open` throws or doesn't return a string, it rejects with
	 * `UNLOCK_FAILED`, and the session stays locked. If storage can't be read,
	 * it rejects with `PERSISTENCE_FAILED`, and the session stays locked too.
	 *
	 * If the saved session can't be used, it signs out and rejects with
	 * `INVALID_SESSION`. If it's gone, or past `maxAge`, it signs out and
	 * resolves `null`.
	 *
	 * An expired access token is refreshed at once. If your backend rejects the
	 * refresh token, it signs out and resolves `null`. If the refresh fails
	 * otherwise, it rejects with `REFRESH_FAILED`. The session is then unlocked,
	 * but `unavailable` until `retry()`.
	 *
	 * Rejects with `INVALID_OPTIONS` without `locking`.
	 */
	unlock: () => Promise<Session<U> | null>;
	/**
	 * Starts the background work: expiry timers, and following other tabs.
	 * Returns a function that stops it. `AuthProvider` and the router adapters
	 * call it for you.
	 *
	 * Calls are counted, and the work stops when the last one is stopped. Each
	 * call also checks the session again. It reads the saved session if that
	 * hasn't worked yet, and refreshes an access token that expired.
	 */
	mount: () => () => void;
	/**
	 * The access token ({@link Credentials}), for code that sends it with
	 * requests, such as `createAuthFetch`.
	 */
	credentials: {
		/** Like `getSession()`, but resolves the current access token. */
		get: () => Promise<Credentials | null>;
		/**
		 * Gets a new access token after your API rejected `credentials`, such as
		 * with a 401. Calls that overlap share one refresh. Without a `refresh`
		 * option or a refresh token, it signs out and resolves `null`.
		 *
		 * Rejects with `REFRESH_FAILED` when the refresh fails, and with
		 * `SESSION_CHANGED` when another session has replaced theirs.
		 */
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/**
		 * Signs out because your API rejected `credentials` for good. Does
		 * nothing if they're no longer current, such as after a refresh.
		 */
		reject: (credentials: Credentials) => Promise<void>;
	};
};

/**
 * The auth client that `createAuth` returns. It holds the session, saves it,
 * refreshes it, and tells your app when it changes.
 *
 * `U` is the user ({@link User}) and `I` is the user `signIn` accepts
 * ({@link UserInput}). With `fromAccessToken`, `I` is `never` and there's no
 * `updateUser`. Write `typeof auth` rather than spelling out both.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 *
 * type AppUser = { id: string; name: string };
 *
 * export async function rename(
 * 	auth: AuthClient<AppUser, AppUser>,
 * 	name: string,
 * ) {
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
				 * Replaces the signed-in user, such as after a profile edit. Pass
				 * the user, or an async function that fetches it. The session ID
				 * stays.
				 *
				 * Rejects with `UNAUTHENTICATED` when signed out, and with
				 * `USER_VALIDATION_FAILED` for a user the schema rejects, or when
				 * the function rejects or takes more than 15 seconds. If calls
				 * overlap, the latest wins and the others reject with
				 * `SESSION_CHANGED`.
				 */
				updateUser: (input: I | (() => Promise<I>)) => Promise<void>;
			});

/**
 * Encrypts the saved tokens with a key your app holds, such as one behind
 * Face ID. Pass it as the `locking` option of {@link AuthOptions}.
 *
 * Auth calls `seal` whenever it saves tokens, and `open` only from
 * `unlock()`. The user and session ID are saved unencrypted, so a locked
 * session can still show who is signed in.
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
	/**
	 * Encrypts the tokens, given as a JSON string. If it throws while a
	 * session is saved, the save fails with `PERSISTENCE_FAILED`, which signs
	 * the user out.
	 */
	seal: (payload: string) => string | Promise<string>;
	/** Decrypts what `seal` returned. It must throw when it can't. */
	open: (sealed: string) => string | Promise<string>;
};

/**
 * Options for `createAuth`. The client's user types ({@link User},
 * {@link UserInput}) are inferred from the `user` option.
 *
 * @example
 * ```ts
 * import {
 * 	createAuth,
 * 	webStorage,
 * 	type AuthOptions,
 * } from "@monarcode/session-kit";
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
	 * Names this auth, so several can share one storage. It's used in the
	 * storage key (`<name>:auth:session`) and in the lock that keeps tabs from
	 * refreshing at once. Letters, digits, `_` or `-`, up to 64 characters.
	 */
	name: string;
	/**
	 * Where the user comes from: a schema, or `fromAccessToken(…)`.
	 *
	 * A Standard Schema schema, such as Zod's, checks the `user` passed to
	 * `signIn`. Its output must be a plain JSON object that it accepts again
	 * unchanged, as a restored session is checked again. `fromAccessToken`
	 * reads the user from the access token instead.
	 */
	user: Src;
	/**
	 * Where the session is saved, such as `webStorage()`
	 * ({@link AuthStorage}).
	 */
	storage: AuthStorage;
	/**
	 * Exchanges a refresh token for new tokens ({@link RefreshFn}). Without it,
	 * the user is signed out when the access token expires or your API rejects
	 * it.
	 */
	refresh?: RefreshFn<NoInfer<UserInput<Src>>> | undefined;
	/**
	 * Asks your backend to revoke the tokens after `signOut()`
	 * ({@link RevokeFn}).
	 */
	revoke?: RevokeFn | undefined;
	/**
	 * How long a saved session lasts, in whole seconds. Each save, such as
	 * after a refresh, starts it again. A session saved longer ago isn't
	 * restored, and the user is signed out without an error. So is a session
	 * saved by another version of session-kit. Default: 30 days.
	 */
	maxAge?: number | undefined;
	/**
	 * Logs what auth does, for debugging: restores, refreshes, timers, storage
	 * and state changes. `true` logs to the console, and a function receives
	 * each event instead ({@link AuthDebug}).
	 *
	 * Tokens, user fields, saved values and error details are left out unless
	 * you pass `{ sensitive: true }`. Pass a development flag, such as Expo's
	 * `__DEV__`, to keep it out of production.
	 *
	 * @default false
	 */
	debug?: AuthDebug | undefined;
	/**
	 * Restores a saved session as `locked`. Its user shows, but its tokens
	 * wait for `unlock()`. `true` saves the tokens as they are, and
	 * `{ seal, open }` encrypts them with your app's key ({@link AuthLocking}).
	 *
	 * It's meant for native apps. In a browser, tabs stop following each
	 * other, so a sign-in, sign-out or lock in one tab doesn't reach the others.
	 * With rotating refresh tokens, two tabs that refresh the same session can
	 * sign one of them out.
	 *
	 * It needs a user schema, as a user read from the access token can't show
	 * while the token is locked.
	 */
	locking?:
		| (Src extends AccessTokenUser<any, any> ? never : true | AuthLocking)
		| undefined;
};
