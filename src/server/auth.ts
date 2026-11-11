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
 * Attributes of the session cookie, the `cookie` option of
 * {@link ServerAuthOptions}. It is always `httpOnly`.
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
	 * development on `localhost`. Default: `true`.
	 */
	secure?: boolean | undefined;
	/** `"none"` needs `secure`. Default: `"lax"`. */
	sameSite?: "lax" | "strict" | "none" | undefined;
	/** Default: `"/"`. */
	path?: string | undefined;
	/** Shares the cookie with subdomains. Default: this host only. */
	domain?: string | undefined;
};

/**
 * Options for {@link createServerAuth}. `name`, `user`, `refresh`, `revoke`,
 * `maxAge` and `debug` mean what they mean for `createAuth`.
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
	 * Letters, digits, `_` or `-`, up to 64 characters. The cookie is
	 * `<name>.session`, split into `<name>.session.0…n` when large.
	 */
	name: string;
	/**
	 * Where the user comes from: a Standard Schema validating the `user` passed
	 * to `signIn`, or `fromAccessToken(…)`. The cookie is trusted once sealed,
	 * but `signIn`'s input is not checked against your backend: see
	 * {@link ServerAuth}.
	 */
	user: Src;
	/**
	 * Seals the cookie: at least 32 random characters, kept out of the code
	 * and the browser. Pass a list to rotate: the first seals, and any of them
	 * opens, so sessions survive a new secret. A cookie none opens reads as
	 * signed out. Checked when a method first runs, not at creation.
	 */
	secret: string | readonly string[];
	/** Exchanges a refresh token for new tokens. See `RefreshFn`. */
	refresh?: RefreshFn<NoInfer<UserInput<Src>>> | undefined;
	/** Revokes tokens on the backend after `signOut`. See `RevokeFn`. */
	revoke?: RevokeFn | undefined;
	/** Cookie lifetime in seconds, renewed on every save. Default: 30 days. */
	maxAge?: number | undefined;
	/** Attributes of the session cookie. See {@link SessionCookieOptions}. */
	cookie?: SessionCookieOptions | undefined;
	/**
	 * Lets `clientCredentials` hand the access token to the app's own page
	 * scripts, through a function the app exposes. The refresh token never
	 * leaves the server. Default: `false`, and `clientCredentials` rejects
	 * with `INVALID_OPTIONS`.
	 */
	clientCredentials?: boolean | undefined;
	/** Reports what auth does on the server, as `createAuth`'s `debug` does. */
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
	 * Default: `60`.
	 */
	within?: number | undefined;
};

/**
 * One request's session, from {@link ServerAuth}'s `forRequest`: the
 * `serverAuth` methods with that request's {@link CookieJar} filled in, shaped
 * like a client's read side, so code that takes a client's `getSession`,
 * `credentials`, `isCurrent` and `state`, such as `createAuthFetch` from
 * `./http`, runs on the server. It has no `signIn` or `updateUser`: call those
 * on `serverAuth`. Make one per request, never at module level.
 *
 * Refreshing, saving the cookie and the read-only rules are the `serverAuth`
 * methods'. With a read-only jar, a token the backend rejects can't be
 * renewed: `credentials.renew` rejects with `REFRESH_FAILED`, so
 * `createAuthFetch` rejects instead of returning the 401; refresh in
 * middleware or a proxy first, with `refreshIfDue`. `credentials.reject`
 * resolves there without signing out, since that jar can't clear the cookie.
 *
 * `state` and `isCurrent` follow the session this request has read: `state`
 * is `initializing` until a call reads the cookie, and `unavailable` when a
 * read-only jar holds expired access. A read-only jar paired with a writable
 * one, as Next's are, follows the writable jar's session once that has read
 * or written one.
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
 * 	const authFetch = createAuthFetch(
 * 		serverAuth.forRequest(jar),
 * 		"https://api.example.com",
 * 	);
 * 	return (await authFetch("/orders")).json();
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RequestAuth<U> = Readonly<{
	/** Like `serverAuth.getSession(jar)`. */
	getSession: () => Promise<Session<U> | null>;
	/** Like `serverAuth.signOut(jar)`. */
	signOut: () => Promise<void>;
	/** Like `serverAuth.credentials`, for this request's jar. */
	credentials: Readonly<{
		get: () => Promise<Credentials | null>;
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/** Signs out if `credentials` are still current; see above for read-only jars. */
		reject: (credentials: Credentials) => Promise<void>;
	}>;
	/** Whether `session` is the one this request has read. */
	isCurrent: (session: { sessionId: string }) => boolean;
	/** The `AuthState` of this request's session. */
	state: Readonly<AuthClient<U, never>["state"]>;
}>;

type ServerAuthBase<U, I> = {
	/**
	 * Who is signed in, from the cookie, or `null`. With a writable jar,
	 * expired access is refreshed first, as the client's `getSession` does, and
	 * a refresh token the backend rejects signs out. With a read-only jar, the
	 * session is returned as the cookie holds it.
	 */
	getSession: (jar: CookieJar) => Promise<Session<U> | null>;
	/**
	 * Refreshes the access token when less than `within` seconds are left,
	 * then resolves the session, for middleware or a proxy that runs before
	 * rendering. Refreshes at most once per jar, and a failed refresh is
	 * ignored while the access token still works. Rejects with
	 * `INVALID_OPTIONS` given a read-only jar. See {@link RefreshIfDueOptions}.
	 */
	refreshIfDue: (
		jar: CookieJar,
		options?: RefreshIfDueOptions,
	) => Promise<Session<U> | null>;
	/**
	 * Validates `input` as the client's `signIn` does, seals it into the
	 * cookie and resolves the new session, which holds no tokens, so it can be
	 * returned to the browser. Rejects with `INVALID_OPTIONS` given a
	 * read-only jar.
	 */
	signIn: (jar: CookieJar, input: SignInInput<I>) => Promise<Session<U>>;
	/**
	 * Clears the cookie, then calls `revoke` and waits for it. A failed
	 * revocation doesn't reject. Rejects with `INVALID_OPTIONS` given a
	 * read-only jar.
	 */
	signOut: (jar: CookieJar) => Promise<void>;
	/**
	 * The access token ({@link Credentials}) for server code that calls the
	 * backend. `get`, `renew` and `reject` behave as the client's do.
	 */
	credentials: {
		/**
		 * The current access token, refreshing expired access first, or `null`.
		 * With a read-only jar, expired access can't be refreshed and saved:
		 * rejects with `REFRESH_FAILED`. Refresh in middleware or a proxy first,
		 * with `refreshIfDue`.
		 */
		get: (jar: CookieJar) => Promise<Credentials | null>;
		/**
		 * Recovers after the backend rejected `credentials`, for example with a
		 * 401. Rejects with `REFRESH_FAILED` given a read-only jar.
		 */
		renew: (
			jar: CookieJar,
			credentials: Credentials,
		) => Promise<Credentials | null>;
		/**
		 * Signs out if `credentials` are still current. Rejects with
		 * `INVALID_OPTIONS` given a read-only jar.
		 */
		reject: (jar: CookieJar, credentials: Credentials) => Promise<void>;
	};
	/**
	 * The access token for the app's page scripts ({@link ClientCredentials}),
	 * with `clientCredentials: true`. Expose these through a same-origin,
	 * CSRF-protected server function, action or route handler, and nothing
	 * else. Both reject with `INVALID_OPTIONS` without the option.
	 */
	clientCredentials: {
		/** Like `credentials.get`, refreshing when access has expired. */
		get: (jar: CookieJar) => Promise<ClientCredentials | null>;
		/**
		 * Like `credentials.renew`, after the backend rejected the token. Takes
		 * what the browser sends, so anything but a session ID and an access
		 * token rejects with `INVALID_OPTIONS`.
		 */
		renew: (
			jar: CookieJar,
			credentials: unknown,
		) => Promise<ClientCredentials | null>;
	};
	/** This request's session, a {@link RequestAuth}; the same object for the same jar. */
	forRequest: (jar: CookieJar) => RequestAuth<U>;
};

/**
 * The server engine from {@link createServerAuth}. `U` is the user; `I` is
 * what `signIn` and `updateUser` accept as the user, or `never` when the user
 * comes from the access token. Prefer `typeof serverAuth`.
 *
 * Each method takes the request's {@link CookieJar}; `forRequest(jar)` gives
 * one request's session shaped like a client ({@link RequestAuth}). Nothing is
 * kept between
 * requests except a short record of new tokens, so parallel requests to one
 * instance that carry the same cookie use one refresh. Each call to
 * `createServerAuth` is an instance, and a framework may make several on one
 * server by loading the module that calls it once per bundle. Across
 * instances, nothing is shared: with rotating refresh tokens, give the
 * backend a short reuse window.
 *
 * `signIn` seals what it's given. When the browser sends the tokens and the
 * user, after signing in with the backend itself, the user in the cookie is
 * what the browser said until a refresh or `updateUser` replaces it: show it,
 * but let the backend authorize with the access token. To trust it, check the
 * input before `signIn`, or sign in with the backend on the server.
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
				 * Replaces the user and keeps the session, as the client's
				 * `updateUser` does, then resolves the session. Rejects with
				 * `INVALID_OPTIONS` given a read-only jar.
				 */
				updateUser: (
					jar: CookieJar,
					input: I | (() => Promise<I>),
				) => Promise<Session<U>>;
			});

/** Default `refreshIfDue` window, in seconds. */
const DEFAULT_WITHIN = 60;

/**
 * Creates the server engine ({@link ServerAuth}) that keeps the session in an
 * encrypted `httpOnly` cookie: both tokens and the user, sealed with
 * AES-256-GCM. Create one per app, at module level, and pass each request's
 * {@link CookieJar} to its methods. Throws `INVALID_OPTIONS` for options it
 * can't use, such as a bad `name`. A missing or short `secret` is checked
 * when a method first runs instead, so build tools that load the module
 * without it, such as `next build`, work: every method then rejects with
 * `INVALID_OPTIONS`. See {@link ServerAuthOptions}.
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
 * 		if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
 * 		return response.json();
 * 	},
 * });
 * ```
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

	/**
	 * The client that reads `jar`. For a read-only jar, its writable sibling's
	 * once that has restored or saved a session, so a sign-in through the
	 * sibling shows here, and a sibling that hasn't read yet changes nothing.
	 */
	function readerOf(jar: CookieJar): AuthClient<U, I> {
		if (jar.writable) return clientOf(jar);
		const sibling = writableSibling(jar);
		const shared = sibling && clients.get(sibling);
		return shared && shared.state.get().status !== "initializing"
			? shared
			: clientOf(jar);
	}

	async function getCredentials(jar: CookieJar): Promise<Credentials | null> {
		if (jar.writable) return clientOf(jar).credentials.get();
		const stored = await restoreSaved(readerOf(jar));
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
		if (!jar.writable)
			throw new AuthError(
				"REFRESH_FAILED",
				"This cookie jar can't save a refreshed token; renew in a server function, action or route handler",
			);
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

	/** `read` on `jar`'s client, or `fallback` when it can't be made: no secret. */
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
		const unusable = (cause: unknown): AuthState<U> =>
			Object.freeze({
				status: "unavailable",
				user: null,
				sessionId: null,
				error: toAuthError("INVALID_OPTIONS", "Session unavailable", cause),
				version: 0,
			});
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
			state: Object.freeze({
				get: () => sync(jar, (client) => client.state.get(), unusable),
				subscribe(listener: (state: AuthState<U>) => void) {
					// Listens to every client the view can read, including a writable
					// sibling paired later, and reports what `get` returns whenever one
					// of them changes.
					let last: AuthState<U> | undefined = view!.state.get();
					const report = () => {
						const next = view!.state.get();
						// Moving to the sibling's client can repeat the same state.
						if (
							!last ||
							(next.status === last.status &&
								next.sessionId === last.sessionId &&
								sameUser(next.user, last.user) &&
								next.error === last.error)
						)
							return;
						last = next;
						listener(next);
					};
					const stops: Array<() => void> = [];
					const watch = (target: CookieJar) => {
						const { unsubscribe } =
							clientOf(target).state.subscribe(report);
						stops.push(unsubscribe);
					};
					try {
						watch(jar);
						if (!jar.writable) {
							const sibling = writableSibling(jar);
							if (sibling) watch(sibling);
							else
								stops.push(
									onPaired(jar, (writable) => {
										watch(writable);
										report();
									}),
								);
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
				},
			}),
		});
		views.set(jar, view);
		return view;
	}

	const serverAuth: ServerAuthBase<U, I> = {
		async getSession(jar) {
			if (jar.writable) return clientOf(jar).getSession();
			const stored = await restoreSaved(readerOf(jar));
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
