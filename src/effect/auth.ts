import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { AuthError } from "../core/errors.js";
import type { AuthClient, Credentials } from "../core/types.js";
import type { RequestAuth } from "../server/auth.js";
import {
	type AuthFailure,
	fromAuthError,
	fromPromise,
	unauthenticated,
} from "./failure.js";

/**
 * Register your client's type here, once, so `Auth`'s Effects carry your
 * user. Without it they're typed with an `unknown` user. The same
 * registration types `Auth` on the server, where {@link Auth.layer} takes
 * `serverAuth.forRequest(jar)`.
 *
 * @example
 * ```ts
 * import { createAuth, memoryStorage } from "@monarcode/session-kit";
 * import { Auth } from "@monarcode/session-kit/effect";
 * import { z } from "zod";
 *
 * export const auth = createAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.string(), name: z.string() }),
 * 	storage: memoryStorage(),
 * });
 *
 * declare module "@monarcode/session-kit/effect" {
 * 	interface Register {
 * 		auth: typeof auth;
 * 	}
 * }
 *
 * export const AuthLive = Auth.layer(auth);
 * ```
 *
 * @example
 * A `createMirrorAuth` client, made per request with server rendering,
 * registers its type the same way:
 * ```ts
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 * import { Auth } from "@monarcode/session-kit/effect";
 *
 * declare function getSessionFn(): Promise<Session<{ id: number }> | null>;
 *
 * export const createAppAuth = () =>
 * 	createMirrorAuth({
 * 		name: "app",
 * 		session: null,
 * 		revalidate: getSessionFn,
 * 		signOut: async () => {},
 * 	});
 *
 * declare module "@monarcode/session-kit/effect" {
 * 	interface Register {
 * 		auth: ReturnType<typeof createAppAuth>;
 * 	}
 * }
 *
 * export const layer = () => Auth.layer(createAppAuth());
 * ```
 *
 * @since 0.1.0
 */
export interface Register {}

/**
 * What `Auth` needs from a client: any client `createAuth` or
 * `createMirrorAuth` returns fits, as does a fake with these members in
 * tests. `signIn` is optional, since a mirror made without it has none.
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
// Inputs are `never` and listeners take `unknown`, so every client's methods
// match.
export type AuthServiceClient = {
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
 * The client registered in {@link Register}, or a client with an `unknown`
 * user when none is.
 *
 * @example
 * ```ts
 * import type { RegisteredAuth } from "@monarcode/session-kit/effect";
 *
 * declare const client: RegisteredAuth;
 * export const status = client.state.get().status;
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredAuth = Register extends {
	readonly auth: infer Client extends AuthServiceClient;
}
	? Client
	: AuthClient<unknown, unknown>;

/**
 * What {@link Auth.layer} takes: the client registered in {@link Register},
 * or any {@link AuthServiceClient} while none is. On the server, it also takes
 * one request's session from `serverAuth.forRequest(jar)` (`RequestAuth` from
 * `./server`) whose user is the registered one.
 *
 * @example
 * ```ts
 * import type { AuthLayerClient } from "@monarcode/session-kit/effect";
 * import { Auth } from "@monarcode/session-kit/effect";
 *
 * declare const fake: AuthLayerClient;
 * export const TestAuth = Auth.layer(fake);
 * ```
 *
 * @since 0.1.0
 */
export type AuthLayerClient = Register extends {
	readonly auth: AuthServiceClient;
}
	? RegisteredAuth | RequestAuth<RegisteredUser>
	: AuthServiceClient;

/** The registered client's user, for a request's session. */
type RegisteredUser = RegisteredSession extends { readonly user: infer U }
	? U
	: unknown;

/**
 * The session {@link Auth.session} resolves: the registered client's
 * `Session`, never `null`.
 *
 * @example
 * ```ts
 * import type { RegisteredSession } from "@monarcode/session-kit/effect";
 *
 * export const greet = (session: RegisteredSession) => session.sessionId;
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredSession = NonNullable<
	Awaited<ReturnType<RegisteredAuth["getSession"]>>
>;

/**
 * The registered client's `AuthState`, as {@link Auth.changes} emits it.
 *
 * @example
 * ```ts
 * import type { RegisteredState } from "@monarcode/session-kit/effect";
 *
 * export const signedIn = (state: RegisteredState) =>
 * 	state.status === "authenticated" || state.status === "refreshing";
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredState = ReturnType<RegisteredAuth["state"]["get"]>;

/**
 * What {@link Auth.signIn} takes: the registered client's `signIn` input, or
 * `never` for a client without `signIn`.
 *
 * @example
 * ```ts
 * import type { RegisteredSignIn } from "@monarcode/session-kit/effect";
 *
 * declare const input: RegisteredSignIn;
 * export const token = input.accessToken;
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
 * What {@link Auth.updateUser} takes: the registered client's user input, or
 * `never` for a client without `updateUser`, such as one whose user comes
 * from the access token.
 *
 * @example
 * ```ts
 * import type { RegisteredUserInput } from "@monarcode/session-kit/effect";
 *
 * declare const next: RegisteredUserInput;
 * export const user: unknown = next;
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
 * The auth client as an Effect service, with Effects for what Effect code
 * does with a session. Provide it with {@link Auth.layer}; register the
 * client's type in {@link Register} so the Effects carry your user.
 *
 * Each Effect fails with an `AuthFailure` whose `code` is the client's
 * `AuthErrorCode`, and dies on misuse (`INVALID_OPTIONS`). The layer doesn't
 * mount the client: `AuthProvider`, `SessionGate` or the router adapters do,
 * or call `auth.mount()` yourself. `lock()` and `unlock()` stay on the
 * client.
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
 * On the server, each request provides its own session, from
 * `serverAuth.forRequest(jar)`. Build what uses it per request too:
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { Auth } from "@monarcode/session-kit/effect";
 * import type { CookieJar, ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * const program = Effect.map(Auth.session, (session) => session.sessionId);
 *
 * export const sessionId = (jar: CookieJar) =>
 * 	Effect.runPromise(
 * 		Effect.provide(program, Auth.layer(serverAuth.forRequest(jar))),
 * 	);
 * ```
 *
 * @since 0.1.0
 */
export class Auth extends Context.Service<Auth, RegisteredAuth>()(
	"@monarcode/session-kit/effect/Auth",
) {
	/**
	 * Provides `client` as the {@link Auth} service: a client, or on the server
	 * one request's session from `serverAuth.forRequest(jar)`. A request's
	 * session belongs to that request: provide it per run, with the services
	 * that use it, never in a runtime shared by every request. It has only
	 * what `Auth`'s Effects use: don't reach for the client's other methods
	 * through `Auth.use` on the server.
	 */
	static readonly layer = (client: AuthLayerClient): Layer.Layer<Auth> =>
		Layer.succeed(Auth, client as RegisteredAuth);

	/**
	 * The current session, refreshing expired access first, as
	 * `getSession()` does. Fails with `UNAUTHENTICATED` when signed out, and
	 * with `LOCKED`, `REFRESH_FAILED`, `PERSISTENCE_FAILED` or
	 * `SESSION_CHANGED` as `getSession()` rejects.
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
	 * Like {@link Auth.session}, but signed out is `Option.none()` rather than
	 * a failure, for code where that's expected.
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
	 * {@link Auth.session} does. Code that only needs the user should use
	 * {@link Auth.session}, which holds no tokens.
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
	 * New credentials after the backend rejected `credentials`, for example
	 * with a 401. Calls at the same time share one refresh. Fails with
	 * `UNAUTHENTICATED` when that ended the session, and with
	 * `SESSION_CHANGED` when the session has moved on.
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
	 * Saves a new session from `input`, as `signIn` does: for example after
	 * a login request. Fails with `USER_VALIDATION_FAILED`,
	 * `INVALID_SESSION`, `PERSISTENCE_FAILED` or `SESSION_CHANGED`. Dies for
	 * a `createMirrorAuth` client made without `signIn`, and on the server,
	 * where sign-in is `serverAuth.signIn(jar, …)`.
	 */
	static readonly signIn = (
		input: RegisteredSignIn,
	): Effect.Effect<void, AuthFailure, Auth> =>
		Auth.use((client) => {
			const signIn = (
				client as { signIn?: (input: unknown) => Promise<unknown> }
			).signIn;
			return signIn
				? Effect.asVoid(fromPromise(() => signIn.call(client, input)))
				: Effect.die(
						new AuthError(
							"INVALID_OPTIONS",
							"This client has no signIn: pass signIn to createMirrorAuth, or on the server call serverAuth.signIn(jar, input)",
						),
					);
		});

	/**
	 * Signs out, as `signOut` does. Fails with `PERSISTENCE_FAILED` when
	 * storage can't be cleared; a failed `revoke` succeeds and stays on
	 * `state.error`.
	 */
	static readonly signOut: Effect.Effect<void, AuthFailure, Auth> = Auth.use(
		(client) => fromPromise(() => client.signOut()),
	);

	/**
	 * Replaces the user, as `updateUser` does. Pass the user, or an Effect
	 * that fetches it: the session is captured before the Effect runs, so a
	 * profile fetched for one account never lands on another. The Effect's
	 * own failure is this one's, unchanged. The Effect is interrupted when
	 * the session changes, failing with `SESSION_CHANGED`, and after 15
	 * seconds, failing with `USER_VALIDATION_FAILED` whose `cause` is the
	 * timeout. Dies for a client without `updateUser`: one whose user comes
	 * from the access token, a `createMirrorAuth` client, whose user comes
	 * from the server, and on the server, where it is
	 * `serverAuth.updateUser(jar, …)`.
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
			const update = (
				client as { updateUser?: (input: unknown) => Promise<void> }
			).updateUser;
			if (!update)
				return yield* Effect.die(
					new AuthError(
						"INVALID_OPTIONS",
						"This client has no updateUser: its user comes from the access token or from the server. On the server, unless the user comes from the access token, call serverAuth.updateUser(jar, input)",
					),
				);
			if (!Effect.isEffect(input))
				return yield* fromPromise(() => update.call(client, input));
			const fetchUser = input as Effect.Effect<RegisteredUserInput, E, R>;
			const run = Effect.runPromiseExitWith(yield* Effect.context<R>());
			// The input Effect's own failure, rethrown here once `updateUser`
			// has wrapped it in `USER_VALIDATION_FAILED`.
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
	 * The client's `AuthState`, now and on every change, for as long as the
	 * stream runs.
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
	 * Fails with the `AuthFailure` for `error`, an `AuthError` from code
	 * outside `Auth`. Anything else, and `INVALID_OPTIONS`, is a defect.
	 */
	static readonly fromAuthError = fromAuthError;
}
