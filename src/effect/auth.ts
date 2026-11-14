import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { AuthError, toAuthError } from "../core/errors.js";
import type { SessionOf, UserOf } from "../core/infer.js";
import type { Register, RegisteredAuth } from "../core/register.js";
import { boundSession, REQUEST_SESSION } from "../core/request-session.js";
import type { Credentials } from "../core/types.js";
import type { RequestAuth } from "../server/auth.js";
import {
	type AuthFailure,
	fromAuthError,
	fromPromise,
	unauthenticated,
} from "./failure.js";

/**
 * What `Auth` needs from a client. Any `createAuth` or `createMirrorAuth`
 * client fits, and so does a fake with these members in tests. `signIn` is
 * optional, because a mirror made without it has none.
 *
 * @example
 * ```ts
 * import { createAuth, memoryStorage } from "@monarcode/session-kit";
 * import type { AuthServiceClient } from "@monarcode/session-kit/effect";
 * import { z } from "zod";
 *
 * export const client: AuthServiceClient = createAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.string() }),
 * 	storage: memoryStorage(),
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthServiceClient = {
	// Inputs are `never` and listeners take `unknown`, so every client's
	// methods match.
	state: {
		get: () => unknown;
		subscribe: (listener: (state: unknown) => void) => {
			unsubscribe: () => void;
		};
	};
	signIn?: ((input: never) => Promise<unknown>) | undefined;
	signOut: () => Promise<void>;
	getSession: () => Promise<unknown>;
	isCurrent: (session: { sessionId: string }) => boolean;
	credentials: {
		get: () => Promise<Credentials | null>;
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		reject: (credentials: Credentials) => Promise<void>;
	};
};

/**
 * What {@link Auth.layer} takes. Once you register a client in
 * {@link Register}, that's your client, or on the server a request's session
 * with the same user (`RequestAuth`). Until then, it's any
 * {@link AuthServiceClient}.
 *
 * @example
 * ```ts
 * import { Auth, type AuthLayerClient } from "@monarcode/session-kit/effect";
 *
 * // Takes the browser client, or one request's session on the server.
 * export const provideAuth = (client: AuthLayerClient) => Auth.layer(client);
 * ```
 *
 * @since 0.1.0
 */
export type AuthLayerClient = Register extends {
	readonly auth: object;
}
	?
			| RegisteredAuth
			// A request's session with the registered user, whatever its
			// `signIn` takes: `any` accepts every input, `never` the servers
			// that read the user from the access token.
			| RequestAuth<UserOf<RegisteredAuth>, any>
			| RequestAuth<UserOf<RegisteredAuth>, never>
	: AuthServiceClient;

/**
 * The session {@link Auth.session} gives you: your registered client's
 * `Session`, never `null`.
 *
 * @example
 * ```ts
 * import type { RegisteredSession } from "@monarcode/session-kit/effect";
 *
 * export const sessionIdOf = (session: RegisteredSession) => session.sessionId;
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredSession = SessionOf<RegisteredAuth>;

/**
 * Your registered client's `AuthState`, as {@link Auth.changes} emits it.
 *
 * @example
 * ```ts
 * import { isSignedIn } from "@monarcode/session-kit";
 * import type { RegisteredState } from "@monarcode/session-kit/effect";
 *
 * export const signedInUser = (state: RegisteredState) =>
 * 	isSignedIn(state) ? state.user : null;
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredState = ReturnType<RegisteredAuth["state"]["get"]>;

/**
 * What {@link Auth.signIn} takes: your registered client's `signIn` input.
 * It's `never` for a client without `signIn`.
 *
 * @example
 * ```ts
 * import { Auth, type RegisteredSignIn } from "@monarcode/session-kit/effect";
 *
 * export const saveSession = (input: RegisteredSignIn) => Auth.signIn(input);
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredSignIn = RegisteredAuth extends {
	signIn: (input: infer Input) => Promise<unknown>;
}
	? Input
	: never;

/**
 * What {@link Auth.updateUser} takes: your registered client's user input.
 * It's `never` for a client without `updateUser`, such as one whose user
 * comes from the access token.
 *
 * @example
 * ```ts
 * import {
 * 	Auth,
 * 	type RegisteredUserInput,
 * } from "@monarcode/session-kit/effect";
 *
 * export const saveUser = (user: RegisteredUserInput) => Auth.updateUser(user);
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredUserInput = RegisteredAuth extends {
	updateUser: (input: infer Input) => Promise<void>;
}
	? Exclude<Input, () => Promise<unknown>>
	: never;

/**
 * Your auth client as an Effect service. Its Effects read the session, get
 * an access token for API calls, sign in and out, update the user, and
 * stream state changes.
 *
 * Provide it with {@link Auth.layer}. Register your client's type in the
 * main entry point's {@link Register}, so the Effects carry your user.
 *
 * Each Effect fails with an {@link AuthFailure} whose `code` is the client's
 * `AuthErrorCode`. An Effect dies on misuse (`INVALID_OPTIONS`).
 *
 * The layer doesn't mount the client. `AuthProvider`, `SessionGate` or the
 * router adapters do, or call `auth.mount()` yourself. `lock()` and
 * `unlock()` stay on the client. Wrap their errors with
 * {@link Auth.fromAuthError}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { createAuth, memoryStorage } from "@monarcode/session-kit";
 * import { Auth } from "@monarcode/session-kit/effect";
 * import { z } from "zod";
 *
 * const auth = createAuth({
 * 	name: "app",
 * 	user: z.object({ name: z.string() }),
 * 	storage: memoryStorage(),
 * });
 *
 * const program = Effect.map(Auth.session, (session) => session.sessionId);
 *
 * export const run = () =>
 * 	Effect.runPromise(Effect.provide(program, Auth.layer(auth)));
 * ```
 *
 * @example
 * On the server, each request provides its own session (`RequestAuth`),
 * such as one from `startAuth`. Build what uses it per request too:
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { Auth } from "@monarcode/session-kit/effect";
 * import type { RequestAuth } from "@monarcode/session-kit/server";
 *
 * declare const session: RequestAuth<{ id: number }, { id: number }>;
 *
 * const program = Effect.map(Auth.session, (current) => current.sessionId);
 *
 * export const sessionId = () =>
 * 	Effect.runPromise(Effect.provide(program, Auth.layer(session)));
 * ```
 *
 * @since 0.1.0
 */
export class Auth extends Context.Service<Auth, RegisteredAuth>()(
	"@monarcode/session-kit/effect/Auth",
) {
	/**
	 * Provides `client` as the {@link Auth} service.
	 *
	 * On the server, pass the request's session, and provide it per request
	 * with the services that use it. Never put it in a runtime that every
	 * request shares. A session from `startAuth` is bound to the request that
	 * is current when you call this. Outside a request, it throws
	 * `INVALID_OPTIONS`.
	 *
	 * A request's session isn't your browser client, so use only `Auth`'s
	 * Effects there, not other client methods through `Auth.use`.
	 */
	static readonly layer = (client: AuthLayerClient): Layer.Layer<Auth> =>
		// Bound now, in the caller's request: inside a fiber, the current
		// request may not be the one the Effect runs for.
		Layer.succeed(Auth, (boundSession(client) ?? client) as RegisteredAuth);

	/**
	 * The current session, refreshed first if the access token expired, as
	 * the client's `getSession()` does.
	 *
	 * Fails with `UNAUTHENTICATED` when signed out. Otherwise it fails as
	 * `getSession()` rejects, with `LOCKED`, `REFRESH_FAILED`,
	 * `PERSISTENCE_FAILED` or `SESSION_CHANGED`.
	 */
	static readonly session: Effect.Effect<
		RegisteredSession,
		AuthFailure,
		Auth
	> = Auth.use((client) =>
		Effect.flatMap(
			fromPromise(() => client.getSession()),
			(session) =>
				session === null
					? Effect.fail(unauthenticated("Sign in is required"))
					: Effect.succeed(session as RegisteredSession),
		),
	);

	/**
	 * Like {@link Auth.session}, but signed out gives `Option.none()` instead
	 * of failing. Use it where being signed out is normal.
	 */
	static readonly sessionOption: Effect.Effect<
		Option.Option<RegisteredSession>,
		AuthFailure,
		Auth
	> = Auth.use((client) =>
		Effect.map(
			fromPromise(() => client.getSession()),
			(session) => Option.fromNullishOr(session as RegisteredSession | null),
		),
	);

	/**
	 * The current access token and session ID, for an API request. Fails as
	 * {@link Auth.session} does.
	 *
	 * When you only need the user, use {@link Auth.session}, which has no
	 * tokens in it.
	 */
	static readonly credentials: Effect.Effect<Credentials, AuthFailure, Auth> =
		Auth.use((client) =>
			Effect.flatMap(
				fromPromise(() => client.credentials.get()),
				(credentials) =>
					credentials === null
						? Effect.fail(unauthenticated("Sign in is required"))
						: Effect.succeed(credentials),
			),
		);

	/**
	 * New credentials after your backend rejected `credentials`, for example
	 * with a 401. Calls at the same time share one refresh.
	 *
	 * Fails with `UNAUTHENTICATED` when the session ended instead, and with
	 * `SESSION_CHANGED` when another session replaced it.
	 *
	 * `sessionBearer` from `@monarcode/session-kit/effetch` renews on a 401
	 * by itself.
	 */
	static readonly renew = (
		credentials: Credentials,
	): Effect.Effect<Credentials, AuthFailure, Auth> =>
		Auth.use((client) =>
			Effect.flatMap(
				fromPromise(() => client.credentials.renew(credentials)),
				(renewed) =>
					renewed === null
						? Effect.fail(unauthenticated("The session has ended"))
						: Effect.succeed(renewed),
			),
		);

	/**
	 * Saves a new session from `input`, as the client's `signIn` does, for
	 * example after a login request.
	 *
	 * Fails with `USER_VALIDATION_FAILED`, `INVALID_SESSION`,
	 * `PERSISTENCE_FAILED` or `SESSION_CHANGED`. With a `createMirrorAuth`
	 * client, an error your `signIn` option throws, such as a wrong password,
	 * fails with `USER_VALIDATION_FAILED`, and is its `AuthError`'s `cause`.
	 *
	 * Dies when the client has no `signIn`: a `createMirrorAuth` client made
	 * without one. It dies with a request's session on the server too. Call
	 * that session's own `signIn`, which takes the tokens and the user.
	 */
	static readonly signIn = (
		input: RegisteredSignIn,
	): Effect.Effect<void, AuthFailure, Auth> =>
		Auth.use((client) => {
			// A request's session has a `signIn`, but it takes the tokens and the
			// user, not what the registered client's takes.
			const signIn =
				REQUEST_SESSION in client
					? undefined
					: (client as { signIn?: (input: unknown) => Promise<unknown> })
							.signIn;
			return signIn
				? fromPromise(async () => {
						try {
							await signIn.call(client, input);
						} catch (cause) {
							// A mirror client rejects with the app's own error. An Effect
							// gets it as a typed failure rather than a defect.
							throw toAuthError(
								"USER_VALIDATION_FAILED",
								"Could not sign in",
								cause,
							);
						}
					})
				: Effect.die(
						new AuthError(
							"INVALID_OPTIONS",
							"Auth.signIn needs a client with signIn: pass signIn to createMirrorAuth. On the server, call signIn on the request's session instead, with the tokens and the user",
						),
					);
		});

	/**
	 * Signs out, as the client's `signOut` does.
	 *
	 * Fails with `PERSISTENCE_FAILED` when it can't sign out. A `createAuth`
	 * client is signed out anyway when only its storage couldn't be cleared,
	 * and a failed `revoke` doesn't fail it. A `createMirrorAuth` client
	 * stays signed in when your server's sign-out fails.
	 */
	static readonly signOut: Effect.Effect<void, AuthFailure, Auth> = Auth.use(
		(client) => fromPromise(() => client.signOut()),
	);

	/**
	 * Replaces the signed-in user, as the client's `updateUser` does. Pass
	 * the user, or an Effect that fetches it.
	 *
	 * A fetched user only lands on the account it was fetched for. If the
	 * session changes first, the fetch is interrupted and this fails with
	 * `SESSION_CHANGED`. After 15 seconds, it's interrupted and fails with
	 * `USER_VALIDATION_FAILED`, whose `cause` is the timeout. The fetch's own
	 * failure passes through as is.
	 *
	 * Dies when the client can't update the user: its user comes from the
	 * access token, or it's a `createMirrorAuth` client. It dies with a
	 * request's session on the server too. Call that session's own
	 * `updateUser`.
	 */
	static readonly updateUser = <E = never, R = never>(
		input: RegisteredUserInput | Effect.Effect<RegisteredUserInput, E, R>,
	): Effect.Effect<void, AuthFailure | E, Auth | R> =>
		Effect.gen(function* (): Effect.fn.Return<
			void,
			AuthFailure | E,
			Auth | R
		> {
			const client = yield* Auth;
			// A request's session has an `updateUser`, but its input is the
			// server's user, and it resolves the session.
			if (REQUEST_SESSION in client)
				return yield* Effect.die(
					new AuthError(
						"INVALID_OPTIONS",
						"Auth.updateUser needs a browser client: on the server, call updateUser on the request's session instead",
					),
				);
			const update = (
				client as { updateUser?: (input: unknown) => Promise<void> }
			).updateUser;
			if (!update)
				return yield* Effect.die(
					new AuthError(
						"INVALID_OPTIONS",
						"This client has no updateUser: its user comes from the access token or from the server. Unless it comes from the access token, update it on the server, with updateUser on the request's session",
					),
				);
			if (!Effect.isEffect(input))
				return yield* fromPromise(() => update.call(client, input));
			const fetchUser = input as Effect.Effect<RegisteredUserInput, E, R>;
			const run = Effect.runPromiseExitWith(yield* Effect.context<R>());
			// Keeps the fetch's own failure, so callers get it rather than the
			// `USER_VALIDATION_FAILED` that `updateUser` wraps it in.
			let failed: Cause.Cause<E> | undefined;
			return yield* fromPromise(async (signal) => {
				// Stops the fetch once `updateUser` settles, too: it can give up
				// first, at its deadline or when the session changes.
				const fetching = new AbortController();
				const stop = () => fetching.abort(signal.reason);
				signal.addEventListener("abort", stop, { once: true });
				try {
					return await update.call(client, async () => {
						const exit = await run(fetchUser, {
							signal: fetching.signal,
						});
						if (Exit.isSuccess(exit)) return exit.value;
						// After an abort, the failure is the interruption: the
						// session change or the timeout should win.
						if (!fetching.signal.aborted) failed = exit.cause;
						throw Cause.squash(exit.cause);
					});
				} finally {
					signal.removeEventListener("abort", stop);
					fetching.abort();
				}
			}).pipe(
				Effect.catch((failure): Effect.Effect<never, AuthFailure | E> =>
					failed ? Effect.failCause(failed) : Effect.fail(failure),
				),
			);
		});

	/**
	 * Emits the client's `AuthState` now and on every change, for as long as
	 * the stream runs.
	 */
	static readonly changes: Stream.Stream<RegisteredState, never, Auth> =
		Stream.unwrap(
			Auth.useSync((client) =>
				Stream.callback<RegisteredState>((queue) =>
					Effect.acquireRelease(
						Effect.sync(() => {
							Queue.offerUnsafe(
								queue,
								client.state.get() as RegisteredState,
							);
							return client.state.subscribe((state) => {
								Queue.offerUnsafe(queue, state as RegisteredState);
							});
						}),
						(subscription) =>
							Effect.sync(() => subscription.unsubscribe()),
					),
				),
			),
		);

	/**
	 * Turns an `AuthError` into a failed Effect, for client calls `Auth`
	 * doesn't wrap, such as `client.lock()`. It fails with the matching
	 * {@link AuthFailure}.
	 *
	 * Anything that isn't an `AuthError`, and `INVALID_OPTIONS`, is a defect,
	 * so the Effect dies with it.
	 */
	static readonly fromAuthError = fromAuthError;
}
