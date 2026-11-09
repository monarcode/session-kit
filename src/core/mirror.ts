import { atom } from "nanostores";

import { createDebugger, registerDebugger, type AuthDebug } from "./debug.js";
import { AuthError, sessionChanged, toAuthError } from "./errors.js";
import { isRecord } from "./json.js";
import { isAuthName } from "./persistence.js";
import type { AuthState, Credentials, Session } from "./types.js";
import { sameUser, toUser } from "./user.js";

/**
 * The access token as the server hands it to page scripts: what
 * `serverAuth.clientCredentials` from `@monarcode/session-kit/server`
 * resolves. `expiresIn` counts seconds from when the server answered, so the
 * browser's clock doesn't matter.
 *
 * @example
 * ```ts
 * import type { ClientCredentials } from "@monarcode/session-kit";
 *
 * export function authorization(credentials: ClientCredentials) {
 * 	return `Bearer ${credentials.accessToken}`;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type ClientCredentials = Readonly<{
	sessionId: string;
	accessToken: string;
	/** Seconds the access token has left, if it expires. */
	expiresIn?: number | undefined;
}>;

/**
 * How a {@link MirrorAuth} asks the server for the access token: the
 * `credentials` option of {@link MirrorAuthOptions}. Each calls the app's own
 * same-origin, CSRF-protected function, which calls `serverAuth`'s
 * `clientCredentials`.
 *
 * @example
 * ```ts
 * import type { ClientCredentials, MirrorCredentials } from "@monarcode/session-kit";
 *
 * declare function getCredentialsFn(): Promise<ClientCredentials | null>;
 * declare function renewCredentialsFn(input: {
 * 	data: { sessionId: string; accessToken: string };
 * }): Promise<ClientCredentials | null>;
 *
 * export const credentials: MirrorCredentials = {
 * 	get: () => getCredentialsFn(),
 * 	renew: (rejected) => renewCredentialsFn({ data: rejected }),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type MirrorCredentials = {
	/** Resolves `serverAuth.clientCredentials.get`'s result. */
	get: () => Promise<ClientCredentials | null>;
	/** Sends `rejected` to `serverAuth.clientCredentials.renew` and resolves its result. */
	renew: (rejected: {
		sessionId: string;
		accessToken: string;
	}) => Promise<ClientCredentials | null>;
};

/**
 * Options for {@link createMirrorAuth}. Every function is the app's own: a
 * server function, an action or a `fetch` to a route handler that calls
 * `serverAuth` from `@monarcode/session-kit/server`.
 *
 * @example
 * ```ts
 * import type { MirrorAuthOptions, Session } from "@monarcode/session-kit";
 *
 * type User = { id: number; firstName: string };
 * declare const session: Session<User> | null;
 * declare function getSessionFn(): Promise<Session<User> | null>;
 * declare function signOutFn(): Promise<void>;
 *
 * export const options: MirrorAuthOptions<User> = {
 * 	name: "app",
 * 	session,
 * 	revalidate: () => getSessionFn(),
 * 	signOut: () => signOutFn(),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type MirrorAuthOptions<U, In = never> = {
	/**
	 * Letters, digits, `_` or `-`, up to 64 characters, as the server's. Tabs
	 * tell each other about changes on the `BroadcastChannel` `<name>:auth`.
	 */
	name: string;
	/**
	 * The session the server rendered with, from `serverAuth.getSession`, or
	 * `null`. The client starts from it, so the first render is final.
	 */
	session: Session<U> | null;
	/** Reads the session on the server again: `serverAuth.getSession`. */
	revalidate: () => Promise<Session<U> | null>;
	/** Signs out on the server: `serverAuth.signOut`. */
	signOut: () => Promise<unknown>;
	/**
	 * Signs in on the server with `input` and resolves the new session:
	 * `serverAuth.signIn`, or the app's own sign-in that ends with it. Without
	 * it, the client has no `signIn`; call your function, then `adopt` its
	 * result.
	 */
	signIn?: ((input: In) => Promise<Session<U>>) | undefined;
	/**
	 * Gives `credentials` the access token, with `clientCredentials` on the
	 * server. Without it, `credentials` rejects with `INVALID_OPTIONS`. See
	 * {@link MirrorCredentials}.
	 */
	credentials?: MirrorCredentials | undefined;
	/** Reports what the client does, as `createAuth`'s `debug` does. */
	debug?: AuthDebug | undefined;
};

type MirrorAuthBase<U> = {
	/**
	 * Reactive {@link AuthState}: `authenticated` or `unauthenticated`, from
	 * the start. A failed revalidation is kept in `error` and changes nothing
	 * else. `subscribe` reports later changes, not the current value.
	 */
	state: {
		get: () => AuthState<U>;
		subscribe: (listener: (state: AuthState<U>) => void) => {
			unsubscribe: () => void;
		};
	};
	/** The session this client holds, or `null`. Doesn't ask the server. */
	getSession: () => Promise<Session<U> | null>;
	/**
	 * Reads the session on the server again with `revalidate`, and resolves
	 * it. A failure rejects with `REFRESH_FAILED` and keeps the session.
	 */
	retry: () => Promise<Session<U> | null>;
	/** Like `retry`: the server refreshes tokens itself. */
	refresh: () => Promise<Session<U> | null>;
	/** Whether this snapshot belongs to the current session (same `sessionId`). */
	isCurrent: (session: { sessionId: string }) => boolean;
	/**
	 * Signs out on the server, then here and in other tabs. Rejects with
	 * `PERSISTENCE_FAILED` when the server's sign-out fails, keeping the
	 * session.
	 */
	signOut: () => Promise<void>;
	/**
	 * Takes `session` from the server, such as what the app's sign-in or
	 * profile update returned, and tells other tabs. Guards run again when the
	 * account or the user changed. Throws `INVALID_SESSION` for anything but a
	 * session or `null`.
	 */
	adopt: (session: Session<U> | null) => void;
	/**
	 * Starts watching while rendered: other tabs' changes, and the server's
	 * session when the tab becomes visible again, unless the server answered
	 * within the last 10 seconds. Called by `AuthProvider` and
	 * the router adapters; mounts are counted, and the last cleanup stops.
	 */
	mount: () => () => void;
	/**
	 * The access token ({@link Credentials}), with the `credentials` option,
	 * so `createAuthFetch` and `sessionBearer` work. Kept in memory only, and
	 * asked for again shortly before it expires.
	 */
	credentials: {
		/**
		 * The current access token, or `null` when signed out. Concurrent calls
		 * share one request. Rejects with `REFRESH_FAILED` when the server's
		 * function fails.
		 */
		get: () => Promise<Credentials | null>;
		/**
		 * Asks the server for new access after the backend rejected
		 * `credentials`. Concurrent calls share one request; `null` means the
		 * server signed out.
		 */
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/** Signs out if `credentials` are still current. */
		reject: (credentials: Credentials) => Promise<void>;
	};
};

/**
 * The browser client from {@link createMirrorAuth}: it mirrors the session a
 * server keeps in its cookie. `U` is the user; `In` is what `signIn` takes,
 * or `never` without the `signIn` option. It fits `AuthProvider`, the hooks,
 * the router guards, `createAuthFetch` and `sessionBearer` as a
 * `createAuth` client does. It has no `lock`, `unlock` or `updateUser`.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 *
 * type User = { id: number; firstName: string };
 *
 * export function greeting(auth: MirrorAuth<User>) {
 * 	const { user } = auth.state.get();
 * 	return user ? `Hi, ${user.firstName}` : "Please sign in";
 * }
 * ```
 *
 * @since 0.1.0
 */
export type MirrorAuth<U, In = never> = MirrorAuthBase<U> &
	([In] extends [never]
		? unknown
		: {
				/**
				 * Signs in on the server with the `signIn` option, then adopts the
				 * session it resolves and tells other tabs. Rejects with what the
				 * option rejects with, as an `AuthError` (`USER_VALIDATION_FAILED`
				 * unless it already is one) whose `cause` is the original.
				 */
				signIn: (input: In) => Promise<Session<U>>;
			});

/** How long after the server last answered a visible tab asks again, in milliseconds. */
const RECHECK_AFTER_MS = 10_000;
/** Access tokens this close to expiry are asked for again, in milliseconds. */
const RENEW_BEFORE_MS = 5_000;

/** Checks a session from the app's function, returning a frozen copy. */
function toSession<U>(value: unknown): Session<U> | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		!isRecord(value.user)
	)
		throw new AuthError(
			"INVALID_SESSION",
			"Expected a session, { sessionId, user }, or null from the server",
		);
	return Object.freeze({
		sessionId: value.sessionId,
		user: toUser(value.user) as U,
	});
}

/**
 * Creates a browser client ({@link MirrorAuth}) for a session the server keeps
 * in an encrypted cookie, with `createServerAuth` from
 * `@monarcode/session-kit/server`. It starts from the session the server
 * rendered with, so there is no `initializing` state, and it never holds the
 * refresh token. Create it once per page load, not per request on the server.
 * Let TypeScript infer its types from the options: with an explicit
 * `createMirrorAuth<User>(…)`, `signIn` is left out of the type.
 * Throws `INVALID_OPTIONS` for options it can't use. See
 * {@link MirrorAuthOptions}.
 *
 * @example
 * ```ts
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 *
 * type User = { id: number; firstName: string };
 * declare const session: Session<User> | null; // from the server render
 * declare function getSessionFn(): Promise<Session<User> | null>;
 * declare function signInFn(input: {
 * 	data: { username: string; password: string };
 * }): Promise<Session<User>>;
 * declare function signOutFn(): Promise<void>;
 *
 * export const auth = createMirrorAuth({
 * 	name: "app",
 * 	session,
 * 	revalidate: () => getSessionFn(),
 * 	signIn: (data: { username: string; password: string }) => signInFn({ data }),
 * 	signOut: () => signOutFn(),
 * });
 *
 * await auth.signIn({ username: "emilys", password: "emilyspass" });
 * ```
 *
 * @since 0.1.0
 */
export function createMirrorAuth<U, In = never>(
	options: MirrorAuthOptions<U, In>,
): MirrorAuth<U, In> {
	if (
		!isAuthName(options.name) ||
		typeof options.revalidate !== "function" ||
		typeof options.signOut !== "function"
	)
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass a simple name, and revalidate and signOut functions",
		);
	const debug = createDebugger(options.name, options.debug);
	let session = toSession<U>(options.session);
	const store = atom<AuthState<U>>(
		Object.freeze({
			status: session ? "authenticated" : "unauthenticated",
			user: session?.user ?? null,
			sessionId: session?.sessionId ?? null,
			version: 0,
			error: null,
		}) as AuthState<U>,
	);
	// Increments on every change made here, so a revalidation that started
	// before it doesn't apply what the server said earlier.
	let generation = 0;
	let revalidating:
		| { promise: Promise<Session<U> | null>; generation: number }
		| undefined;
	// When the server last answered, so returning to the tab soon after
	// doesn't ask again.
	let checkedAt = Date.now();
	let mounts = 0;
	let channel: BroadcastChannel | undefined;
	let stopWatching: (() => void) | undefined;
	// The access token for `session`, and the request getting one.
	let cached: Credentials | undefined;
	let pending:
		| {
				promise: Promise<Credentials | null>;
				sessionId: string;
				renew: boolean;
		  }
		| undefined;

	function publish(error: AuthError | null = null) {
		const previous = store.get();
		const sameAccount = previous.sessionId === (session?.sessionId ?? null);
		let user = session?.user ?? null;
		// The same user keeps its object, so selectors comparing by reference see no change.
		if (sameAccount && user && previous.user && sameUser(previous.user, user))
			user = previous.user;
		const changed = !sameAccount || previous.user !== user;
		if (debug.on && (changed || previous.error !== error))
			debug.log(
				"state",
				session ? "authenticated" : "unauthenticated",
				{
					status: session ? "authenticated" : "unauthenticated",
					sessionId: session?.sessionId ?? null,
					...debug.secret({ user }),
				},
				error ?? undefined,
			);
		if (session && user !== session.user)
			session = Object.freeze({
				sessionId: session.sessionId,
				user: user as U,
			});
		if (!changed && previous.error === error) return;
		store.set(
			Object.freeze({
				status: session ? "authenticated" : "unauthenticated",
				user,
				sessionId: session?.sessionId ?? null,
				error,
				version: previous.version + Number(changed),
			}) as AuthState<U>,
		);
	}

	function broadcast() {
		if (typeof BroadcastChannel !== "function") return;
		const sender = channel ?? new BroadcastChannel(`${options.name}:auth`);
		sender.postMessage("changed");
		if (!channel) sender.close();
	}

	/** Makes `next` current. `tell` sends other tabs to the server for it. */
	function apply(next: Session<U> | null, tell: boolean) {
		const changed =
			next?.sessionId !== session?.sessionId ||
			(next && session && !sameUser(next.user, session.user));
		if (next?.sessionId !== session?.sessionId) {
			cached = undefined;
			pending = undefined;
		}
		session = next;
		publish();
		if (tell && changed) broadcast();
	}

	function revalidate(reason: string): Promise<Session<U> | null> {
		if (revalidating?.generation === generation) return revalidating.promise;
		const started = generation;
		debug.log("sync", `revalidating (${reason})`);
		const promise = (async () => {
			try {
				const next = toSession<U>(await options.revalidate());
				checkedAt = Date.now();
				if (generation === started) apply(next, false);
				return session;
			} catch (cause) {
				const error = toAuthError(
					"REFRESH_FAILED",
					"Could not read the session on the server",
					cause,
				);
				debug.log("sync", "revalidation failed", undefined, error);
				if (generation === started) publish(error);
				throw error;
			}
		})();
		const entry = { promise, generation: started };
		revalidating = entry;
		const clear = () => {
			if (revalidating === entry) revalidating = undefined;
		};
		void promise.then(clear, clear);
		return promise;
	}

	function inBackground(work: Promise<unknown>) {
		work.catch(() => {});
	}

	async function signOut() {
		const ending = session?.sessionId ?? null;
		try {
			await options.signOut();
		} catch (cause) {
			const error = toAuthError(
				"PERSISTENCE_FAILED",
				"Could not sign out on the server",
				cause,
			);
			debug.log("sign-out", "failed", undefined, error);
			publish(error);
			throw error;
		}
		debug.log("sign-out", "signed out", { sessionId: ending });
		generation++;
		apply(null, true);
	}

	function requireCredentials(): MirrorCredentials {
		if (!options.credentials)
			throw new AuthError(
				"INVALID_OPTIONS",
				"Pass credentials to createMirrorAuth to read the access token in the browser",
			);
		return options.credentials;
	}

	/** Asks the server for credentials for session `sessionId`. */
	function request(
		sessionId: string,
		renew: boolean,
		ask: () => Promise<ClientCredentials | null>,
	): Promise<Credentials | null> {
		const promise = (async () => {
			let value: unknown;
			try {
				value = await ask();
			} catch (cause) {
				throw toAuthError(
					"REFRESH_FAILED",
					"Could not get the access token from the server",
					cause,
				);
			}
			if (session?.sessionId !== sessionId) throw sessionChanged();
			if (value === null) {
				// The server has no session: it ended there.
				debug.log("sync", "the server has no session");
				generation++;
				apply(null, true);
				return null;
			}
			if (
				!isRecord(value) ||
				typeof value.sessionId !== "string" ||
				typeof value.accessToken !== "string" ||
				!value.accessToken ||
				(value.expiresIn !== undefined &&
					(typeof value.expiresIn !== "number" ||
						!Number.isFinite(value.expiresIn) ||
						value.expiresIn < 0))
			)
				throw new AuthError(
					"INVALID_SESSION",
					"Expected { sessionId, accessToken, expiresIn } or null from the server",
				);
			if (value.sessionId !== sessionId) {
				// The server holds another session: follow it.
				inBackground(revalidate("another session on the server"));
				throw sessionChanged();
			}
			const credentials: Credentials = Object.freeze({
				sessionId,
				accessToken: value.accessToken,
				expiresAt:
					value.expiresIn === undefined
						? undefined
						: Date.now() + value.expiresIn * 1000,
			});
			cached = credentials;
			return credentials;
		})();
		const entry = { promise, sessionId, renew };
		pending = entry;
		const clear = () => {
			if (pending === entry) pending = undefined;
		};
		void promise.then(clear, clear);
		return promise;
	}

	const client: MirrorAuthBase<U> & {
		signIn?: (input: In) => Promise<Session<U>>;
	} = {
		state: {
			get: store.get,
			subscribe: (listener) => ({
				unsubscribe: store.listen((value) => {
					try {
						listener(value);
					} catch (error) {
						// A failing listener must not interrupt the change that notified it.
						queueMicrotask(() => {
							throw error;
						});
					}
				}),
			}),
		},
		getSession: async () => session,
		retry: () => revalidate("retry"),
		refresh: () => revalidate("refresh"),
		isCurrent: (captured) => session?.sessionId === captured.sessionId,
		signOut,
		adopt(next) {
			const value = toSession<U>(next);
			generation++;
			apply(value, true);
		},
		mount() {
			if (mounts++ === 0) {
				debug.log("mount", "mounted: following other tabs");
				const stops: Array<() => void> = [];
				if (typeof BroadcastChannel === "function") {
					const listening = new BroadcastChannel(`${options.name}:auth`);
					listening.onmessage = () =>
						inBackground(revalidate("another tab changed the session"));
					channel = listening;
					stops.push(() => {
						listening.close();
						if (channel === listening) channel = undefined;
					});
				}
				const page = globalThis.document;
				if (page && typeof page.addEventListener === "function") {
					const onVisible = () => {
						if (
							page.visibilityState === "visible" &&
							Date.now() - checkedAt >= RECHECK_AFTER_MS
						)
							inBackground(revalidate("the tab became visible"));
					};
					page.addEventListener("visibilitychange", onVisible);
					stops.push(() =>
						page.removeEventListener("visibilitychange", onVisible),
					);
				}
				stopWatching = () => stops.forEach((stop) => stop());
			}
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				if (--mounts === 0) {
					debug.log("mount", "unmounted");
					stopWatching?.();
					stopWatching = undefined;
				}
			};
		},
		credentials: {
			async get() {
				const source = requireCredentials();
				if (!session) return null;
				if (
					cached?.sessionId === session.sessionId &&
					(cached.expiresAt === undefined ||
						cached.expiresAt - Date.now() > RENEW_BEFORE_MS)
				)
					return cached;
				if (pending?.sessionId === session.sessionId)
					return pending.promise;
				return request(session.sessionId, false, source.get);
			},
			async renew(rejected) {
				const source = requireCredentials();
				if (!session || session.sessionId !== rejected.sessionId)
					throw sessionChanged();
				if (
					cached?.sessionId === rejected.sessionId &&
					cached.accessToken !== rejected.accessToken
				)
					return cached;
				if (pending?.sessionId === rejected.sessionId && pending.renew)
					return pending.promise;
				return request(rejected.sessionId, true, () =>
					source.renew({
						sessionId: rejected.sessionId,
						accessToken: rejected.accessToken,
					}),
				);
			},
			async reject(rejected) {
				if (
					session?.sessionId === rejected.sessionId &&
					(!cached || cached.accessToken === rejected.accessToken)
				)
					await signOut();
			},
		},
	};
	const signIn = options.signIn;
	if (signIn)
		client.signIn = async (input: In) => {
			let next: Session<U> | null;
			try {
				next = toSession<U>(await signIn(input));
				if (!next)
					throw new AuthError(
						"INVALID_SESSION",
						"signIn must resolve the new session",
					);
			} catch (cause) {
				const error = toAuthError(
					"USER_VALIDATION_FAILED",
					"Could not sign in",
					cause,
				);
				debug.log("sign-in", "rejected", undefined, error);
				throw error;
			}
			generation++;
			apply(next, true);
			debug.log("sign-in", "signed in", { sessionId: next.sessionId });
			return session!;
		};
	registerDebugger(client, debug);
	return client as MirrorAuth<U, In>;
}
