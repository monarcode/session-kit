import { atom } from "nanostores";

import { createDebugger, registerDebugger, type AuthDebug } from "./debug.js";
import { AuthError, sessionChanged, toAuthError } from "./errors.js";
import { isAuthName } from "./persistence.js";
import { countMounts, inBackground, stateView } from "./store.js";
import type { AuthState, Credentials, Session } from "./types.js";
import { sameSession, sameUser } from "./user.js";
import { readClientCredentials, readSession } from "./wire.js";

/**
 * The access token as your server gives it to the browser, from
 * `serverAuth.clientCredentials` in `@monarcode/session-kit/server`.
 * `expiresIn` counts from when the server answered, so the browser's clock
 * doesn't matter.
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
	/** The session the token belongs to. */
	sessionId: string;
	/** The token your API accepts. */
	accessToken: string;
	/** Seconds the token has left, if it expires. */
	expiresIn?: number | undefined;
}>;

/**
 * How a {@link MirrorAuth} gets the access token from your server. It's the
 * `credentials` option of {@link MirrorAuthOptions}.
 *
 * Both functions call your own server functions, on the same origin and
 * protected against CSRF, which call `serverAuth.clientCredentials`.
 *
 * @example
 * ```ts
 * import type {
 * 	ClientCredentials,
 * 	MirrorCredentials,
 * } from "@monarcode/session-kit";
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
	/**
	 * Gets the current access token from your server, which calls
	 * `serverAuth.clientCredentials.get`.
	 */
	get: () => Promise<ClientCredentials | null>;
	/**
	 * Sends the token your API rejected to your server, which calls
	 * `serverAuth.clientCredentials.renew`, and resolves the new one.
	 */
	renew: (rejected: {
		sessionId: string;
		accessToken: string;
	}) => Promise<ClientCredentials | null>;
};

/**
 * Options for {@link createMirrorAuth}. Each function is your own server
 * function, action, or `fetch` to a route handler, which calls `serverAuth`
 * from `@monarcode/session-kit/server`.
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
	 * Names this auth. Tabs tell each other about changes on the
	 * `BroadcastChannel` `<name>:auth`. Letters, digits, `_` or `-`, up to 64
	 * characters.
	 */
	name: string;
	/**
	 * The session the page was rendered with, from `serverAuth.getSession`, or
	 * `null`. The client starts from it, so there's no loading state.
	 */
	session: Session<U> | null;
	/** Reads the session on the server again, with `serverAuth.getSession`. */
	revalidate: () => Promise<Session<U> | null>;
	/** Signs out on the server, with `serverAuth.signOut`. */
	signOut: () => Promise<unknown>;
	/**
	 * Signs in on the server with `input`, and resolves the new session. Use
	 * `serverAuth.signIn`, or your own sign-in that ends with it. Without this
	 * option, the client has no `signIn`. Call your function, then pass its
	 * result to `adopt`.
	 */
	signIn?: ((input: In) => Promise<Session<U>>) | undefined;
	/**
	 * Gets the access token from your server ({@link MirrorCredentials}), so
	 * page scripts can call your API with `createAuthFetch` or `sessionBearer`.
	 * Leave it out if they never do. `credentials.get()` and
	 * `credentials.renew()` then reject with `INVALID_OPTIONS`.
	 */
	credentials?: MirrorCredentials | undefined;
	/** Logs what the client does, like `createAuth`'s `debug`. */
	debug?: AuthDebug | undefined;
};

type MirrorAuthBase<U> = {
	/**
	 * The current {@link AuthState}, and a way to listen for changes. It's only
	 * ever `authenticated` or `unauthenticated`. A failed revalidation shows in
	 * `error` and changes nothing else.
	 *
	 * `subscribe` calls the listener on each later change, not with the
	 * current state.
	 */
	state: {
		get: () => AuthState<U>;
		subscribe: (listener: (state: AuthState<U>) => void) => {
			unsubscribe: () => void;
		};
	};
	/**
	 * Resolves the session this client holds, or `null`. It doesn't ask the
	 * server.
	 */
	getSession: () => Promise<Session<U> | null>;
	/**
	 * Asks your server for the session again, with `revalidate`, and resolves
	 * it. If that fails, it rejects with `REFRESH_FAILED` and keeps the
	 * current session.
	 */
	retry: () => Promise<Session<U> | null>;
	/**
	 * Same as `retry()`. The server refreshes tokens itself, so this only asks
	 * for the session again.
	 */
	refresh: () => Promise<Session<U> | null>;
	/**
	 * Whether `session` is still the signed-in one, by its `sessionId`. Use it
	 * to drop a response that arrives after the user signed out or switched
	 * accounts.
	 */
	isCurrent: (session: { sessionId: string }) => boolean;
	/**
	 * Signs out on your server, then in this tab and the others. If the
	 * server's sign-out fails, it rejects with `PERSISTENCE_FAILED` and keeps
	 * the session.
	 */
	signOut: () => Promise<void>;
	/**
	 * Takes a session your server returned, such as from your own sign-in or a
	 * profile update, and tells other tabs. Route guards run again when the
	 * account or the user changed. Throws `INVALID_SESSION` for anything but a
	 * session or `null`.
	 */
	adopt: (session: Session<U> | null) => void;
	/**
	 * Starts watching for other tabs' changes, and asks the server for the
	 * session when the tab becomes visible again (unless it answered in the
	 * last 10 seconds). Returns a function that stops. Calls are counted, and
	 * watching stops when the last one is stopped. `AuthProvider` and the
	 * router adapters call it for you.
	 */
	mount: () => () => void;
	/**
	 * The access token ({@link Credentials}), for `createAuthFetch` and
	 * `sessionBearer`. Needs the `credentials` option. The token is kept in
	 * memory only, and fetched again shortly before it expires.
	 */
	credentials: {
		/**
		 * Resolves the current access token, or `null` when signed out. Calls
		 * that overlap share one request. Rejects with `REFRESH_FAILED` when
		 * your server's function fails.
		 */
		get: () => Promise<Credentials | null>;
		/**
		 * Asks your server for a new access token after your API rejected
		 * `credentials`. Calls that overlap share one request. Resolves `null`
		 * when the server has signed out.
		 */
		renew: (credentials: Credentials) => Promise<Credentials | null>;
		/**
		 * Signs out because your API rejected `credentials` for good. Does
		 * nothing if a newer token has replaced them.
		 */
		reject: (credentials: Credentials) => Promise<void>;
	};
};

/**
 * The browser client that {@link createMirrorAuth} returns. It mirrors a
 * session your server keeps in a cookie.
 *
 * It works with `AuthProvider`, the hooks, the router guards,
 * `createAuthFetch` and `sessionBearer`, as a `createAuth` client does. It
 * has no `lock`, `unlock` or `updateUser`. `U` is the user, and `In` is what
 * `signIn` takes (`never` without the `signIn` option).
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
				 * Signs in on your server with the `signIn` option, then takes the
				 * session it resolves and tells other tabs.
				 *
				 * If the option throws, it rejects with that error, unchanged, as a
				 * sign-in in a single-page app does. If it resolves anything but a
				 * session, it rejects with `INVALID_SESSION`.
				 */
				signIn: (input: In) => Promise<Session<U>>;
			});

/** How long after the server last answered a visible tab asks again. */
const RECHECK_AFTER_MS = 10_000;
/** Access tokens this close to expiry are fetched again. */
const RENEW_BEFORE_MS = 5_000;

/** Whether `credentials` belong to `sessionId` and aren't about to expire. */
function usable(
	credentials: Credentials | undefined,
	sessionId: string,
): credentials is Credentials {
	return (
		credentials?.sessionId === sessionId &&
		(credentials.expiresAt === undefined ||
			credentials.expiresAt - Date.now() > RENEW_BEFORE_MS)
	);
}

/** What adapters that carry a server render's session reach in a mirror. */
export type MirrorHandle = {
	/**
	 * Starts the mirror from `session` as the server rendered it: no version
	 * change, since guards already ran with it, and no message to other tabs.
	 */
	hydrate: (session: unknown) => void;
	/**
	 * Whether the server has answered: a revalidation succeeded, or `hydrate`
	 * ran.
	 */
	readonly answered: boolean;
};

// Keyed by `state`, which a copy of the client such as `{ ...auth }` keeps.
const handles = new WeakMap<object, MirrorHandle>();

/**
 * The handle of `client`, or `undefined` for a client `createMirrorAuth` didn't
 * make.
 */
export function mirrorOf(client: {
	readonly state: object;
}): MirrorHandle | undefined {
	return handles.get(client.state);
}

/** The mirror's `AuthState` while `session` is current. */
function stateOf<U>(
	session: Session<U> | null,
	error: AuthError | null,
	version: number,
): AuthState<U> {
	return Object.freeze({
		status: session ? "authenticated" : "unauthenticated",
		user: session?.user ?? null,
		sessionId: session?.sessionId ?? null,
		error,
		version,
	}) as AuthState<U>;
}

/**
 * Creates a browser client ({@link MirrorAuth}) for a session your server
 * keeps in an encrypted cookie, with `createServerAuth` from
 * `@monarcode/session-kit/server`.
 *
 * It starts from the session the page was rendered with, so there's no
 * loading state, and it never sees the refresh token. Create one per page
 * load in the browser, and one per request on the server, never at module
 * level. `useMirrorAuth` does this for you.
 *
 * Let TypeScript infer its types from the options. With an explicit
 * `createMirrorAuth<User>(…)`, `signIn` drops out of the type. Throws
 * `INVALID_OPTIONS` for options it can't use.
 *
 * @example
 * ```ts
 * import { createMirrorAuth, type Session } from "@monarcode/session-kit";
 *
 * type User = { id: number; firstName: string };
 * type LoginInput = { username: string; password: string };
 * declare function getSessionFn(): Promise<Session<User> | null>;
 * declare function signInFn(input: {
 * 	data: LoginInput;
 * }): Promise<Session<User>>;
 * declare function signOutFn(): Promise<void>;
 *
 * // Called with the session the page was rendered with.
 * export const createAppAuth = (session: Session<User> | null) =>
 * 	createMirrorAuth({
 * 		name: "app",
 * 		session,
 * 		revalidate: () => getSessionFn(),
 * 		signIn: (data: LoginInput) => signInFn({ data }),
 * 		signOut: () => signOutFn(),
 * 	});
 * ```
 *
 * @see {@link MirrorAuthOptions} for every option
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
	let session = readSession<U>(options.session);
	const store = atom<AuthState<U>>(stateOf(session, null, 0));
	// Increments on every change made here, so a revalidation that started
	// before it doesn't apply what the server said earlier.
	let generation = 0;
	let revalidating:
		| { promise: Promise<Session<U> | null>; generation: number }
		| undefined;
	// When the server last answered, so returning to the tab soon after
	// doesn't ask again, and whether it has answered since the client began.
	let checkedAt = Date.now();
	let answered = false;
	let channel: BroadcastChannel | undefined;
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
		// The same user keeps its object, so selectors comparing by reference see
		// no change.
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
		store.set(stateOf(session, error, previous.version + Number(changed)));
	}

	function broadcast() {
		if (typeof BroadcastChannel !== "function") return;
		// While unmounted, a one-off channel sends it. A channel never receives
		// its own messages, so this tab isn't told about its own change.
		const sender = channel ?? new BroadcastChannel(`${options.name}:auth`);
		sender.postMessage("changed");
		if (!channel) sender.close();
	}

	/** Makes `next` the session, dropping another session's access token. */
	function replace(next: Session<U> | null) {
		if (next?.sessionId !== session?.sessionId) {
			cached = undefined;
			pending = undefined;
		}
		session = next;
	}

	/**
	 * A change made in this tab: it wins over a revalidation under way, and
	 * other tabs ask the server for it.
	 */
	function change(next: Session<U> | null) {
		generation++;
		const changed = !sameSession(next, session);
		replace(next);
		publish();
		if (changed) broadcast();
	}

	/** Takes the session a revalidation read from the server. */
	function follow(next: Session<U> | null) {
		replace(next);
		publish();
	}

	function revalidate(reason: string): Promise<Session<U> | null> {
		// Share one only while nothing changed here since it started. After a
		// change, its answer is out of date.
		if (revalidating?.generation === generation) return revalidating.promise;
		const started = generation;
		debug.log("sync", `revalidating (${reason})`);
		const promise = (async () => {
			try {
				const next = readSession<U>(await options.revalidate());
				checkedAt = Date.now();
				answered = true;
				if (generation === started) follow(next);
				// Not `next`: a change made here since it started wins.
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
		change(null);
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
			const credentials = readClientCredentials(value);
			if (!credentials) {
				// The server has no session: it ended there.
				debug.log("sync", "the server has no session");
				change(null);
				return null;
			}
			if (credentials.sessionId !== sessionId) {
				// The server holds another session: follow it.
				inBackground(revalidate("another session on the server"));
				throw sessionChanged();
			}
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

	const mounts = countMounts(() => {
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
		return () => {
			debug.log("mount", "unmounted");
			stops.forEach((stop) => stop());
		};
	});

	const client: MirrorAuthBase<U> & {
		signIn?: (input: In) => Promise<Session<U>>;
	} = {
		state: stateView(store),
		getSession: async () => session,
		retry: () => revalidate("retry"),
		refresh: () => revalidate("refresh"),
		isCurrent: (captured) => session?.sessionId === captured.sessionId,
		signOut,
		adopt(next) {
			change(readSession<U>(next));
		},
		mount: mounts.mount,
		credentials: {
			async get() {
				const source = requireCredentials();
				if (!session) return null;
				if (usable(cached, session.sessionId)) return cached;
				if (pending?.sessionId === session.sessionId)
					return pending.promise;
				return request(session.sessionId, false, source.get);
			},
			async renew(rejected) {
				const source = requireCredentials();
				if (!session || session.sessionId !== rejected.sessionId)
					throw sessionChanged();
				// Another call already got a newer token than the rejected one.
				if (
					usable(cached, rejected.sessionId) &&
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
				next = readSession<U>(await signIn(input));
				if (!next)
					throw new AuthError(
						"INVALID_SESSION",
						"signIn must resolve the new session",
					);
			} catch (error) {
				// Not wrapped: the app's own error, such as a wrong password, is
				// what its sign-in form shows. A debug event carries only an
				// `AuthError`.
				if (error instanceof AuthError)
					debug.log("sign-in", "rejected", undefined, error);
				else
					debug.log(
						"sign-in",
						"rejected by the signIn option",
						debug.secret({
							reason:
								error instanceof Error ? error.message : String(error),
						}),
					);
				throw error;
			}
			change(next);
			debug.log("sign-in", "signed in", { sessionId: next.sessionId });
			return session!;
		};
	handles.set(client.state, {
		hydrate(value) {
			replace(readSession<U>(value));
			// A revalidation under way is older than the server render.
			generation++;
			checkedAt = Date.now();
			answered = true;
			debug.log("sync", "hydrated from the server render", {
				sessionId: session?.sessionId ?? null,
			});
			store.set(stateOf(session, null, store.get().version));
		},
		get answered() {
			return answered;
		},
	});
	registerDebugger(client, debug);
	return client as MirrorAuth<U, In>;
}
