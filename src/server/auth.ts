import { createAuth, restoreSaved } from "../core/client.js";
import type { AuthDebug } from "../core/debug.js";
import { AuthError, sessionChanged, toAuthError } from "../core/errors.js";
import type { ClientCredentials } from "../core/mirror.js";
import { checkOptions } from "../core/persistence.js";
import { resolveUserSource, type UserSource } from "../core/sources.js";
import type { AuthStorage } from "../core/storage.js";
import type {
	AuthClient,
	AuthState,
	Credentials,
	RefreshFn,
	RevokeFn,
	Session,
	SignInInput,
	User,
	UserInput,
} from "../core/types.js";
import { sameUser } from "../core/user.js";
import { readRejected, toClientCredentials } from "../core/wire.js";
import {
	createShared,
	jarStorage,
	onPaired,
	writableSibling,
	type CookieJar,
	type CookieOptions,
} from "./cookies.js";
import { createSealer, readSecrets, type Sealer } from "./seal.js";

/**
 * The session cookie's attributes: the `cookie` option of
 * {@link ServerAuthOptions}. The cookie is always `httpOnly`.
 *
 * @example
 * ```ts
 * import type { SessionCookieOptions } from "@monarcode/session-kit/server";
 *
 * declare const production: boolean;
 *
 * // Plain http on localhost, during development only.
 * export const cookie: SessionCookieOptions = { secure: production };
 * ```
 *
 * @since 0.1.0
 */
export type SessionCookieOptions = {
	/**
	 * Sends the cookie over HTTPS only. Turn it off only for plain-http
	 * development on `localhost`.
	 * @default true
	 */
	secure?: boolean | undefined;
	/**
	 * Which cross-site requests send the cookie. `"none"` needs `secure`, or
	 * `createServerAuth` throws `INVALID_OPTIONS`.
	 * @default "lax"
	 */
	sameSite?: "lax" | "strict" | "none" | undefined;
	/**
	 * The paths the cookie is sent to.
	 * @default "/"
	 */
	path?: string | undefined;
	/** Shares the cookie with subdomains. Default: this host only. */
	domain?: string | undefined;
};

/**
 * Options for {@link createServerAuth}. `user`, `refresh`, `revoke`, `maxAge`
 * and `debug` work as they do for `createAuth`.
 *
 * @example
 * ```ts
 * import type { ServerAuthOptions } from "@monarcode/session-kit/server";
 * import { z } from "zod";
 *
 * declare const secret: string;
 *
 * const userSchema = z.object({ id: z.number(), firstName: z.string() });
 *
 * export const options: ServerAuthOptions<typeof userSchema> = {
 * 	name: "app",
 * 	user: userSchema,
 * 	secret,
 * 	maxAge: 7 * 24 * 60 * 60, // a week
 * };
 * ```
 *
 * @since 0.1.0
 */
export type ServerAuthOptions<Src extends UserSource> = {
	/**
	 * Names this auth and its cookie, `<name>.session`, which is split into
	 * `<name>.session.0…n` when large. Up to 64 letters, digits, `_` or `-`.
	 */
	name: string;
	/**
	 * Where the user comes from: a schema that checks the `user` passed to
	 * `signIn`, or `fromAccessToken(…)`. The cookie is trusted once sealed,
	 * but `signIn` doesn't check its input with your backend
	 * ({@link ServerAuth} says what to do).
	 */
	user: Src;
	/**
	 * The key that seals the cookie, with AES-256-GCM: at least 32 random
	 * characters, kept out of your code and the browser. Pass a list to rotate
	 * keys. The first seals, and any of them opens, so sessions survive a new
	 * secret. A cookie none of them opens reads as signed out.
	 *
	 * It's checked when a method first runs, not at creation, so build tools
	 * that load your module without it, such as `next build`, still work.
	 * Without a valid secret, every method rejects with `INVALID_OPTIONS`, and
	 * `forRequest`'s view reports `unavailable`.
	 */
	secret: string | readonly string[];
	/**
	 * Exchanges a refresh token for new tokens, as {@link RefreshFn} says.
	 */
	refresh?: RefreshFn<NoInfer<UserInput<Src>>> | undefined;
	/**
	 * Asks your backend to revoke the tokens after `signOut`
	 * ({@link RevokeFn}).
	 */
	revoke?: RevokeFn | undefined;
	/**
	 * How long the cookie lasts, in seconds. Each save starts it again.
	 * Default: 30 days.
	 */
	maxAge?: number | undefined;
	/**
	 * The session cookie's attributes ({@link SessionCookieOptions}). Default:
	 * each attribute's own.
	 */
	cookie?: SessionCookieOptions | undefined;
	/**
	 * Lets `clientCredentials` give the access token to your own page scripts,
	 * through a function you expose. The refresh token never leaves the
	 * server. Without it, `clientCredentials` rejects with `INVALID_OPTIONS`.
	 * @default false
	 */
	clientCredentials?: boolean | undefined;
	/**
	 * Logs what auth does on the server, like `createAuth`'s `debug` option.
	 */
	debug?: AuthDebug | undefined;
};

/**
 * Options for {@link ServerAuth}'s `refreshIfDue`.
 *
 * @example
 * ```ts
 * import type { CookieJar, ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 * declare const jar: CookieJar;
 *
 * // Refresh when less than two minutes are left.
 * await serverAuth.refreshIfDue(jar, { within: 120 });
 * ```
 *
 * @since 0.1.0
 */
export type RefreshIfDueOptions = {
	/**
	 * Refreshes when the access token expires within this many seconds, so it
	 * lasts through the request. Keep it well below the token's lifetime: a
	 * token that lives less than `within` is refreshed on every request.
	 * @default 60
	 */
	within?: number | undefined;
};

declare const requestAuth: unique symbol;

/**
 * One request's session, shaped like a client. Get it from
 * `serverAuth.forRequest(jar)`, and pass it to code that expects a client,
 * such as `createAuthFetch` from `@monarcode/session-kit/http`. Make one per
 * request, never at module level.
 *
 * It reads, refreshes and saves the session as the `serverAuth` methods do.
 * It has no `signIn` or `updateUser`. Call those on `serverAuth`.
 *
 * A read-only jar can't save a new token, so `credentials.renew` rejects
 * with `REFRESH_FAILED`, and `createAuthFetch` rejects rather than return the
 * 401. The exception is a token the same request's writable jar already
 * renewed, which it resolves. Refresh first, in middleware or a proxy, with
 * `refreshIfDue`.
 *
 * @example
 * ```ts
 * import { createAuthFetch } from "@monarcode/session-kit/http";
 * import type { CookieJar, ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * // Sends the cookie's token, and renews it after a 401.
 * export async function orders(jar: CookieJar) {
 * 	const authFetch = createAuthFetch(serverAuth.forRequest(jar), {
 * 		baseUrl: "https://api.example.com",
 * 	});
 * 	return (await authFetch("/orders")).json();
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RequestAuth<U> = Readonly<{
	/**
	 * Marks a request's session, so a client isn't taken for one. Types only.
	 */
	[requestAuth]: true;
	/** Like `serverAuth.getSession(jar)`. */
	getSession: () => Promise<Session<U> | null>;
	/** Like `serverAuth.signOut(jar)`. */
	signOut: () => Promise<void>;
	/** Like `serverAuth.credentials`, for this request's jar. */
	credentials: Readonly<{
		get: () => Promise<Credentials | null>;
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/**
		 * Signs out because your API rejected `credentials` for good, unless
		 * they're no longer current. With a read-only jar, it resolves without
		 * signing out, as that jar can't clear the cookie.
		 */
		reject: (credentials: Credentials) => Promise<void>;
	}>;
	/** Whether `session` is the one this request has read. */
	isCurrent: (session: { sessionId: string }) => boolean;
	/**
	 * The state of this request's session, an `AuthState`.
	 *
	 * It's `initializing` until a call reads the cookie. With a writable jar
	 * holding an expired access token, it stays so until a call refreshes it.
	 * It's `unavailable` when a read-only jar holds an expired access token,
	 * or the secret is missing.
	 *
	 * A read-only jar paired with a writable one, as Next's are, follows the
	 * writable jar's session once that has read or written one. Listeners
	 * must not throw. Their errors are rethrown asynchronously, which is an
	 * uncaught exception on a server.
	 */
	state: Readonly<AuthClient<U, never>["state"]>;
}>;

type ServerAuthBase<U, I> = {
	/**
	 * Resolves who is signed in, from the cookie, or `null`. With a writable
	 * jar, an expired access token is refreshed first, and a refresh token
	 * your backend rejects signs out. With a read-only jar, the session is
	 * returned as the cookie holds it.
	 */
	getSession: (jar: CookieJar) => Promise<Session<U> | null>;
	/**
	 * Refreshes the access token when it has less than `within` seconds left
	 * ({@link RefreshIfDueOptions}), then resolves the session. Use it in
	 * middleware or a proxy that runs before rendering, so pages get a fresh
	 * token to read.
	 *
	 * It refreshes at most once per jar. A failed refresh is ignored while the
	 * access token still works. Rejects with `INVALID_OPTIONS` given a
	 * read-only jar.
	 */
	refreshIfDue: (
		jar: CookieJar,
		options?: RefreshIfDueOptions,
	) => Promise<Session<U> | null>;
	/**
	 * Signs in with `input`, checked as the client's `signIn` does, and seals
	 * it into the cookie. Resolves the new session, which holds no tokens, so
	 * you can return it to the browser. Rejects with `INVALID_OPTIONS` given a
	 * read-only jar.
	 */
	signIn: (jar: CookieJar, input: SignInInput<I>) => Promise<Session<U>>;
	/**
	 * Signs out by clearing the cookie, then calls `revoke` and waits for it.
	 * A failed `revoke` doesn't reject. Rejects with `INVALID_OPTIONS` given a
	 * read-only jar.
	 */
	signOut: (jar: CookieJar) => Promise<void>;
	/**
	 * The access token ({@link Credentials}), for server code that calls your
	 * API. `get`, `renew` and `reject` work like the client's.
	 */
	credentials: {
		/**
		 * Resolves the current access token, or `null`, refreshing an expired
		 * one first. A read-only jar can't save a refreshed token, so an expired
		 * one rejects with `REFRESH_FAILED`. Refresh first, in middleware or a
		 * proxy, with `refreshIfDue`.
		 */
		get: (jar: CookieJar) => Promise<Credentials | null>;
		/**
		 * Gets a new access token after your API rejected `credentials`, such as
		 * with a 401. A read-only jar can't save one, so it rejects with
		 * `REFRESH_FAILED`, unless the same request's writable jar already
		 * renewed the token, which it then resolves.
		 */
		renew: (
			jar: CookieJar,
			credentials: Credentials,
		) => Promise<Credentials | null>;
		/**
		 * Signs out because your API rejected `credentials` for good, unless
		 * they're no longer current. Rejects with `INVALID_OPTIONS` given a
		 * read-only jar.
		 */
		reject: (jar: CookieJar, credentials: Credentials) => Promise<void>;
	};
	/**
	 * The access token for your own page scripts ({@link ClientCredentials}),
	 * with the `clientCredentials` option. Expose these only through a
	 * same-origin server function, action or route handler protected against
	 * CSRF. Both reject with `INVALID_OPTIONS` without the option.
	 */
	clientCredentials: {
		/** Like `credentials.get`, refreshing when access has expired. */
		get: (jar: CookieJar) => Promise<ClientCredentials | null>;
		/**
		 * Like `credentials.renew`, after your API rejected the token. It takes
		 * what the browser sent, so anything but a session ID and an access
		 * token rejects with `INVALID_OPTIONS`.
		 */
		renew: (
			jar: CookieJar,
			credentials: unknown,
		) => Promise<ClientCredentials | null>;
	};
	/**
	 * This request's session, shaped like a client ({@link RequestAuth}). The
	 * same jar always gives the same object.
	 */
	forRequest: (jar: CookieJar) => RequestAuth<U>;
};

/**
 * The server side of Session kit, from {@link createServerAuth}. It keeps the
 * session in an encrypted cookie. Each method takes the request's
 * {@link CookieJar}, and `forRequest(jar)` gives one request's session shaped
 * like a client ({@link RequestAuth}).
 *
 * `U` is the user, and `I` is the user `signIn` accepts, or `never` with
 * `fromAccessToken`. Write `typeof serverAuth` rather than spelling them out.
 *
 * Nothing is kept between requests except a short record of new tokens, so
 * parallel requests that carry the same cookie share one refresh. That
 * record belongs to one `createServerAuth` call. A framework may load your
 * module once per bundle, making several, so with rotating refresh tokens,
 * give your backend a short reuse window.
 *
 * `signIn` seals what it's given. If the browser signs in with your backend
 * and sends the tokens and the user, the cookie's user is what the browser
 * said, until a refresh or `updateUser` replaces it. Show it, but let your
 * backend authorize with the access token. To trust it, check the input
 * before `signIn`, or sign in with your backend on the server.
 *
 * @example
 * ```ts
 * import type { CookieJar, ServerAuth } from "@monarcode/session-kit/server";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 * declare const jar: CookieJar;
 *
 * export async function greeting() {
 * 	const session = await serverAuth.getSession(jar);
 * 	return session ? `Hi, ${session.user.firstName}` : "Please sign in";
 * }
 * ```
 *
 * @since 0.1.0
 */
export type ServerAuth<U, I> = ServerAuthBase<U, I> &
	([I] extends [never]
		? unknown
		: {
				/**
				 * Replaces the signed-in user and keeps the session, as the
				 * client's `updateUser` does, then resolves the session. Rejects
				 * with `INVALID_OPTIONS` given a read-only jar.
				 */
				updateUser: (
					jar: CookieJar,
					input: I | (() => Promise<I>),
				) => Promise<Session<U>>;
			});

/** `refreshIfDue`'s default `within`, in seconds. */
const DEFAULT_WITHIN = 60;

/**
 * Creates the server side of Session kit ({@link ServerAuth}). It keeps both
 * tokens and the user in an encrypted, `httpOnly` cookie, so page scripts
 * never see the refresh token.
 *
 * Create one per app, at module level, and pass each request's
 * {@link CookieJar} to its methods. Throws `INVALID_OPTIONS` for options it
 * can't use, such as a bad `name`. A missing or short `secret` is reported
 * later, when a method first runs.
 *
 * @example
 * ```ts
 * import { createServerAuth } from "@monarcode/session-kit/server";
 * import { z } from "zod";
 *
 * declare const secret: string; // from the environment
 *
 * export const serverAuth = createServerAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.number(), firstName: z.string() }),
 * 	secret,
 * 	refresh: async ({ refreshToken, signal }) => {
 * 		const response = await fetch("https://api.example.com/auth/refresh", {
 * 			method: "POST",
 * 			signal,
 * 			headers: { "Content-Type": "application/json" },
 * 			body: JSON.stringify({ refreshToken }),
 * 		});
 * 		if (response.status === 401) return null;
 * 		if (!response.ok)
 * 			throw new Error(`Refresh failed (${response.status})`);
 * 		return response.json();
 * 	},
 * });
 * ```
 *
 * @see {@link ServerAuthOptions} for every option
 *
 * @since 0.1.0
 */
export function createServerAuth<Src extends UserSource>(
	options: ServerAuthOptions<Src>,
): ServerAuth<User<Src>, UserInput<Src>> {
	type U = User<Src>;
	type I = UserInput<Src>;
	const users = resolveUserSource(options.user);
	checkOptions(options.name, options.maxAge);
	const cookie = `${options.name}.session`;
	const attributes: Omit<CookieOptions, "maxAge"> = Object.freeze({
		httpOnly: true,
		secure: options.cookie?.secure ?? true,
		sameSite: options.cookie?.sameSite ?? "lax",
		path: options.cookie?.path ?? "/",
		domain: options.cookie?.domain,
	});
	if (attributes.sameSite === "none" && !attributes.secure)
		throw new AuthError(
			"INVALID_OPTIONS",
			'A cookie with sameSite "none" must be secure',
		);
	// The secret is checked on first use, not here: build tools such as
	// `next build` load this module without the secret the server runs with.
	let sealer: Sealer | undefined;
	const shared = createShared();

	// One storage and one client per jar, so calls during a request share what
	// it read and wrote, and one refresh.
	const storages = new WeakMap<CookieJar, AuthStorage>();
	const clients = new WeakMap<CookieJar, AuthClient<U, I>>();
	// Jars whose request has called `refresh`, so `refreshIfDue` doesn't again.
	const refreshed = new WeakSet<CookieJar>();

	function storageOf(jar: CookieJar): AuthStorage {
		let storage = storages.get(jar);
		if (!storage) {
			storage = jarStorage({
				jar,
				cookie,
				options: attributes,
				sealer: (sealer ??= createSealer(
					readSecrets(options.secret),
					options.name,
				)),
				shared,
			});
			storages.set(jar, storage);
		}
		return storage;
	}

	function requireWritable(jar: CookieJar, method: string) {
		if (!jar.writable)
			throw new AuthError(
				"INVALID_OPTIONS",
				`${method} needs a cookie jar that can set cookies, such as one in a server function, action or route handler`,
			);
	}

	function clientOf(jar: CookieJar): AuthClient<U, I> {
		let client = clients.get(jar);
		if (!client) {
			client = createAuth({
				name: options.name,
				user: options.user,
				storage: storageOf(jar),
				refresh:
					options.refresh &&
					((context) => {
						refreshed.add(jar);
						return options.refresh!(context);
					}),
				revoke: options.revoke,
				maxAge: options.maxAge,
				debug: options.debug,
			});
			clients.set(jar, client);
		}
		return client;
	}

	// Read-only jars that read through their writable sibling's client.
	const followers = new WeakSet<CookieJar>();

	/**
	 * The client that reads `jar`. A read-only jar switches to its writable
	 * sibling's client once that client has restored or saved a session, and
	 * then stays
	 * with it, so a sign-in in an action shows in the same request's render.
	 */
	function readerOf(jar: CookieJar): AuthClient<U, I> {
		if (jar.writable) return clientOf(jar);
		const sibling = writableSibling(jar);
		const siblingClient = sibling && clients.get(sibling);
		if (!siblingClient) return clientOf(jar);
		if (
			!followers.has(jar) &&
			siblingClient.state.get().status === "initializing"
		)
			return clientOf(jar);
		followers.add(jar);
		return siblingClient;
	}

	async function getCredentials(jar: CookieJar): Promise<Credentials | null> {
		if (jar.writable) return clientOf(jar).credentials.get();
		const stored = await restoreSaved(readerOf(jar), { publish: true });
		if (!stored) return null;
		if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now())
			throw new AuthError(
				"REFRESH_FAILED",
				"The access token expired, and this cookie jar can't save a refreshed one; refresh first in middleware or a proxy, with refreshIfDue",
			);
		return Object.freeze({
			sessionId: stored.id,
			accessToken: stored.accessToken,
			expiresAt: stored.expiresAt,
		});
	}

	async function renew(
		jar: CookieJar,
		credentials: Credentials,
	): Promise<Credentials | null> {
		if (!jar.writable) {
			// The writable jar of the same request may already hold a newer token.
			const stored = await restoreSaved(readerOf(jar), { publish: true });
			if (
				stored?.id === credentials.sessionId &&
				stored.accessToken !== credentials.accessToken &&
				(stored.expiresAt === undefined || stored.expiresAt > Date.now())
			)
				return Object.freeze({
					sessionId: stored.id,
					accessToken: stored.accessToken,
					expiresAt: stored.expiresAt,
				});
			throw new AuthError(
				"REFRESH_FAILED",
				"This cookie jar can't save a refreshed token; renew in a server function, action or route handler",
			);
		}
		const client = clientOf(jar);
		// Restores the cookie's session first: renewing compares against it.
		await restoreSaved(client);
		return client.credentials.renew(credentials);
	}

	function requireClientCredentials() {
		if (!options.clientCredentials)
			throw new AuthError(
				"INVALID_OPTIONS",
				"Pass clientCredentials: true to createServerAuth to give the access token to page scripts",
			);
	}

	async function current(client: AuthClient<U, I>): Promise<Session<U>> {
		const session = await client.getSession();
		if (!session) throw sessionChanged();
		return session;
	}

	const views = new WeakMap<CookieJar, RequestAuth<U>>();

	/**
	 * Runs `read` on `jar`'s client, or `fallback` when there's no client
	 * because the secret is missing.
	 */
	function sync<T>(
		jar: CookieJar,
		read: (client: AuthClient<U, I>) => T,
		fallback: (error: unknown) => T,
	): T {
		let client: AuthClient<U, I>;
		try {
			client = readerOf(jar);
		} catch (error) {
			return fallback(error);
		}
		return read(client);
	}

	function forRequest(jar: CookieJar): RequestAuth<U> {
		let view = views.get(jar);
		if (view) return view;
		let unusable: AuthState<U> | undefined;
		// The view keeps its own `version`, since a read-only jar can move to
		// its sibling's client, which counts separately. It grows when the
		// client's does, or when the view moves to a client in another state.
		let seenClient: AuthClient<U, I> | undefined;
		let seen: AuthState<U> | undefined;
		let shown: AuthState<U> | undefined;
		let version = 0;
		const stateOf = (): AuthState<U> => {
			let client: AuthClient<U, I> | undefined;
			const next = sync(
				jar,
				(reader) => (client = reader).state.get(),
				(cause) =>
					(unusable ??= Object.freeze({
						status: "unavailable",
						user: null,
						sessionId: null,
						error: toAuthError(
							"INVALID_OPTIONS",
							"Session unavailable",
							cause,
						),
						version: 0,
					})),
			);
			if (!shown || !seen) {
				shown = Object.freeze({ ...next, version });
			} else if (next !== seen) {
				const moved = client !== seenClient;
				const same = () =>
					next.status === seen!.status &&
					next.sessionId === seen!.sessionId &&
					next.error === seen!.error &&
					(next.user === seen!.user || sameUser(next.user, seen!.user));
				// Moving to a client in the same state isn't a change for guards.
				if (!(moved && same()))
					shown = Object.freeze({
						...next,
						version:
							moved || next.version !== seen.version
								? ++version
								: version,
					});
			}
			seenClient = client;
			seen = next;
			return shown;
		};
		// Listens to every client the view can read, including a writable
		// sibling paired later, and reports each new state `stateOf` returns.
		const subscribe = (listener: (state: AuthState<U>) => void) => {
			let last: AuthState<U> | undefined = stateOf();
			const report = () => {
				const next = stateOf();
				if (!last || next === last) return;
				last = next;
				listener(next);
			};
			const stops: Array<() => void> = [];
			const watch = (target: CookieJar) => {
				const { unsubscribe } = clientOf(target).state.subscribe(report);
				stops.push(() => unsubscribe());
			};
			try {
				watch(jar);
				if (!jar.writable) {
					const sibling = writableSibling(jar);
					// Watch the sibling now. The view may switch to its client
					// once that client restores or saves a session.
					if (sibling) watch(sibling);
					else stops.push(onPaired(jar, watch));
				}
			} catch {
				// No secret: nothing will change.
			}
			return {
				unsubscribe() {
					last = undefined;
					for (const stop of stops.splice(0)) stop();
				},
			};
		};
		// The brand exists in types only.
		view = Object.freeze({
			getSession: () => serverAuth.getSession(jar),
			signOut: () => serverAuth.signOut(jar),
			credentials: Object.freeze({
				get: () => getCredentials(jar),
				renew: (credentials: Credentials) => renew(jar, credentials),
				reject: async (credentials: Credentials) => {
					if (jar.writable)
						await serverAuth.credentials.reject(jar, credentials);
				},
			}),
			isCurrent: (session: { sessionId: string }) =>
				sync(
					jar,
					(client) => client.isCurrent(session),
					() => false,
				),
			state: Object.freeze({ get: stateOf, subscribe }),
		}) as unknown as RequestAuth<U>;
		views.set(jar, view);
		return view;
	}

	const serverAuth: ServerAuthBase<U, I> = {
		async getSession(jar) {
			if (jar.writable) return clientOf(jar).getSession();
			const stored = await restoreSaved(readerOf(jar), { publish: true });
			return (
				stored && Object.freeze({ sessionId: stored.id, user: stored.user })
			);
		},
		async refreshIfDue(jar, refreshOptions = {}) {
			requireWritable(jar, "refreshIfDue");
			const within = refreshOptions.within ?? DEFAULT_WITHIN;
			if (!Number.isFinite(within) || within < 0)
				throw new AuthError(
					"INVALID_OPTIONS",
					"within must be zero or more seconds",
				);
			const client = clientOf(jar);
			const credentials = await client.credentials.get();
			if (!credentials) return null;
			if (
				options.refresh &&
				!refreshed.has(jar) &&
				credentials.expiresAt !== undefined &&
				credentials.expiresAt - Date.now() < within * 1000
			) {
				try {
					await client.refresh();
				} catch (error) {
					// An early refresh that fails is harmless while the old token
					// still works.
					if (
						!client.isCurrent(credentials) ||
						credentials.expiresAt <= Date.now()
					)
						throw error;
				}
			}
			return client.getSession();
		},
		async signIn(jar, input) {
			requireWritable(jar, "signIn");
			const client = clientOf(jar);
			await client.signIn(input);
			return current(client);
		},
		async signOut(jar) {
			requireWritable(jar, "signOut");
			const client = clientOf(jar);
			// Restores the cookie's session, so revoke receives its tokens. A
			// cookie that can't be read is cleared all the same.
			await restoreSaved(client).catch(() => {});
			await client.signOut();
		},
		credentials: {
			get: getCredentials,
			renew,
			async reject(jar, credentials) {
				requireWritable(jar, "credentials.reject");
				const client = clientOf(jar);
				// Restores the cookie's session to compare against.
				await restoreSaved(client);
				await client.credentials.reject(credentials);
			},
		},
		clientCredentials: {
			async get(jar) {
				requireClientCredentials();
				return toClientCredentials(await getCredentials(jar));
			},
			async renew(jar, credentials) {
				requireClientCredentials();
				return toClientCredentials(
					await renew(jar, readRejected(credentials)),
				);
			},
		},
		forRequest,
	};
	// A user read from the access token can't be updated on its own.
	if (!users.saved) return serverAuth as ServerAuth<U, I>;
	return {
		...serverAuth,
		async updateUser(jar: CookieJar, input: I | (() => Promise<I>)) {
			requireWritable(jar, "updateUser");
			const client = clientOf(jar);
			await (
				client as unknown as {
					updateUser: (input: unknown) => Promise<void>;
				}
			).updateUser(input);
			return current(client);
		},
	} as ServerAuth<U, I>;
}
