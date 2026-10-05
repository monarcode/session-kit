import { atom } from "nanostores";

import { AuthError, toAuthError, sessionChanged } from "./errors.js";
import { createId } from "./id.js";
import { createPersistence, type StoredSession } from "./persistence.js";
import { obtainTokens } from "./refresh.js";
import {
	resolveUserSource,
	type UserResolver,
	type UserSource,
} from "./sources.js";
import { runTask } from "./task.js";
import { setLongTimeout, proactiveRefreshDelay } from "./timers.js";
import { receiveTokens, tokensOf, type SessionTokens } from "./tokens.js";
import type {
	AuthClient,
	AuthOptions,
	AuthState,
	AuthStatus,
	Credentials,
	RefreshFn,
	Session,
	SignInInput,
	User,
	UserInput,
} from "./types.js";
import { sameUser } from "./user.js";

type InternalSession<U> = SessionTokens & { id: string; user: U };

/** How a refresh ended, inside the cross-tab lock. */
type RefreshOutcome<U> =
	/** Storage no longer holds this tab's session; follow what it holds. */
	| { kind: "stale" }
	/** The backend rejected the refresh token, so the session ended. */
	| { kind: "signedOut" }
	| { kind: "installed"; session: InternalSession<U> };

/**
 * Starts work nobody awaits. Its failures are already published to
 * `state.error`, or are `SESSION_CHANGED` from work a newer session superseded.
 */
function inBackground(work: Promise<unknown>) {
	work.catch(() => {});
}

/** Statuses that expose `user`. Adding a status will not compile until it is listed. */
const SIGNED_IN = {
	initializing: false,
	authenticated: true,
	refreshing: true,
	unauthenticated: false,
	unavailable: false,
} satisfies Record<AuthStatus, boolean>;

/**
 * Statuses that guards treat alike, so moving between them leaves `version`
 * unchanged. A refresh keeps the user signed in for guards.
 */
const GUARD_STATUS = {
	initializing: "initializing",
	authenticated: "authenticated",
	refreshing: "authenticated",
	unauthenticated: "unauthenticated",
	unavailable: "unavailable",
} satisfies Record<AuthStatus, AuthStatus>;

/** Whether `error` means the saved session itself is unusable, not storage. */
function rejectsSaved(error: AuthError) {
	return (
		error.code === "INVALID_SESSION" ||
		error.code === "USER_VALIDATION_FAILED"
	);
}

/** Whether two saved entries hold the same access token and user. */
function sameSaved(a: StoredSession, b: StoredSession) {
	return a.accessToken === b.accessToken && sameUser(a.user, b.user);
}

function toSession<U>(session: InternalSession<U> | null): Session<U> | null {
	return (
		session && Object.freeze({ sessionId: session.id, user: session.user })
	);
}

function toCredentials<U>(
	session: InternalSession<U> | null,
): Credentials | null {
	return (
		session &&
		Object.freeze({
			sessionId: session.id,
			accessToken: session.accessToken,
			expiresAt: session.expiresAt,
		})
	);
}

/**
 * Creates the auth client. Put one in Router context per auth `name` per tab.
 *
 * Token expiry comes from `expiresAt`, `expiresIn`, or JWT claims; see `Tokens`.
 * Prefer `expiresIn` so a wrong browser clock cannot expire tokens early.
 *
 * @example
 * const auth = createAuth({
 * 	name: "my-app",
 * 	user: z.object({ id: z.string(), email: z.string() }),
 * 	storage: webStorage(),
 * 	refresh: async ({ refreshToken, signal }) => {
 * 		const response = await fetch("/api/auth/refresh", {
 * 			method: "POST",
 * 			signal,
 * 			headers: { "Content-Type": "application/json" },
 * 			body: JSON.stringify({ refreshToken }),
 * 		});
 * 		if (response.status === 401) return null; // rejected: sign out
 * 		if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
 * 		const body = await response.json();
 * 		return { accessToken: body.access_token, expiresIn: body.expires_in };
 * 	},
 * });
 *
 * await auth.signIn({ accessToken, refreshToken, expiresIn: 900, user });
 */
export function createAuth<Src extends UserSource>(
	options: AuthOptions<Src>,
): AuthClient<User<Src>, UserInput<Src>> {
	type U = User<Src>;
	type I = UserInput<Src>;
	if (!options.storage) {
		throw new Error(
			"Pass a storage adapter, such as webStorage(), as the storage option",
		);
	}
	const users = resolveUserSource(options.user) as UserResolver<U>;
	const persistence = createPersistence(
		options.storage,
		options.name,
		options.maxAge,
	);
	const store = atom<AuthState<U>>({
		status: "initializing",
		user: null,
		sessionId: null,
		version: 0,
		error: null,
	});
	// Lifecycle. `epoch` increments whenever the session is replaced or pending
	// work is cancelled; async work captures it and stops once it changes, and
	// `controller` aborts that work. Timers and the storage watch run only
	// while `mounts`, the number of Router connections, is above zero.
	let epoch = 0;
	let controller = new AbortController();
	let mounts = 0;
	let unwatch: (() => void) | undefined;
	let cancelExpiry: (() => void) | undefined;
	let cancelProactive: (() => void) | undefined;

	// Restoration. `session` is meaningful only once `initialized` is true;
	// `initialization` is the restore in progress, if any.
	let session: InternalSession<U> | null = null;
	let initialized = false;
	let initialization: Promise<void> | undefined;

	// Storage operations settle after the decisions that issued them, so this
	// tab can change its session while it waits for a read. `revision`
	// increments on every such change; work that reads storage compares it
	// across the read to learn whether this tab has decided something newer.
	let revision = 0;

	// Refresh. `flight` is the single refresh in progress. `failure` is its
	// error, kept only while access is unusable, so `getSession` rethrows it
	// until `retry()`. `refreshAttempted` allows one proactive attempt per
	// installed token. `rejectedToken` is an access token the backend refused.
	let flight: Promise<InternalSession<U> | null> | undefined;
	let failure: AuthError | undefined;
	let refreshAttempted = false;
	let rejectedToken: string | undefined;

	// Profile. `profileVersion` changes whenever the user is replaced, so a
	// refresh that began earlier cannot overwrite it. `profileIntent` orders
	// overlapping `updateUser` calls; only the latest commits.
	let profileVersion = 0;
	let profileIntent = 0;

	const valid = () =>
		session !== null &&
		session.accessToken !== rejectedToken &&
		(session.expiresAt === undefined || session.expiresAt > Date.now());

	/**
	 * Reads what storage holds for session `id`. Every tab shares it, so another
	 * tab may have refreshed this session, signed out, or signed in again.
	 * Resolves the saved session (possibly newer than memory), `null` when this
	 * tab's session is no longer the saved one, or `undefined` when storage is
	 * unreadable and memory is the best remaining source.
	 */
	async function latest(
		id: string,
	): Promise<StoredSession | null | undefined> {
		try {
			const stored = await persistence.read();
			return stored?.id === id ? stored : null;
		} catch {
			return undefined;
		}
	}

	function deriveStatus(): AuthStatus {
		if (!initialized) return "initializing";
		if (!session) return "unauthenticated";
		if (valid()) return "authenticated";
		return flight ? "refreshing" : "unavailable";
	}

	function publish(error: AuthError | null = null) {
		const status = deriveStatus();
		const user = SIGNED_IN[status] ? session!.user : null;
		const sessionId = session?.id ?? null;
		const previous = store.get();
		const changed =
			GUARD_STATUS[previous.status] !== GUARD_STATUS[status] ||
			previous.user !== user ||
			previous.sessionId !== sessionId;
		// `SIGNED_IN` keeps `user` set exactly for the statuses whose type has one.
		store.set(
			Object.freeze({
				status,
				user,
				sessionId,
				error,
				version: previous.version + Number(changed),
			}) as AuthState<U>,
		);
	}

	function stopTimers() {
		cancelExpiry?.();
		cancelProactive?.();
		cancelExpiry = cancelProactive = undefined;
	}

	function schedule() {
		stopTimers();
		if (!mounts || !session || session.expiresAt === undefined) return;
		const remaining = session.expiresAt - Date.now();
		if (remaining <= 0) return;
		cancelExpiry = setLongTimeout(() => {
			// The browser clock may have moved while the timer waited.
			if (valid()) schedule();
			else inBackground(resolveSession());
		}, remaining);
		if (options.refresh && session.refreshToken && !refreshAttempted) {
			cancelProactive = setLongTimeout(
				() => inBackground(refreshSession(session!, false)),
				proactiveRefreshDelay(remaining),
			);
		}
	}

	function assertEpoch(expected: number) {
		if (epoch !== expected) throw sessionChanged();
	}

	function advanceEpoch() {
		// A cancelled refresh never finished, so it does not use up the token's attempt.
		if (flight) refreshAttempted = false;
		epoch++;
		controller.abort(sessionChanged());
		controller = new AbortController();
		flight = undefined;
		initialization = undefined;
		stopTimers();
	}

	function forget(error: AuthError | null = null) {
		advanceEpoch();
		session = null;
		revision++;
		initialized = true;
		rejectedToken = undefined;
		failure = undefined;
		publish(error);
	}

	/** Signs out every tab because the saved session cannot be used, then clears it. */
	async function discardSaved(error: AuthError) {
		forget(error);
		const expected = epoch;
		try {
			await persistence.clear();
		} catch (cleanup) {
			const failure = new AuthError(
				"PERSISTENCE_FAILED",
				"Could not clear the invalid saved session",
				{ cause: new AggregateError([error, cleanup]) },
			);
			// A session started since then is not the one that failed to clear.
			if (epoch === expected) publish(failure);
			throw failure;
		}
	}

	/**
	 * Makes `next` current in memory, without publishing it. A user equal to
	 * the current one keeps the current object, so subscribers comparing users
	 * by reference, and `version`, see no change.
	 */
	function adopt(next: InternalSession<U>) {
		if (
			session?.id === next.id &&
			next.user !== session.user &&
			sameUser(next.user, session.user)
		)
			next.user = session.user;
		session = next;
		revision++;
		initialized = true;
		failure = undefined;
		schedule();
	}

	/**
	 * Makes `next` current, saves it, then publishes it. `next` is current from
	 * the call onward, before the first `await`, so later work in this tab
	 * builds on it. State shows it only once saved. If saving fails while
	 * `next` is still current, signs out and clears storage, so memory and
	 * storage cannot disagree.
	 */
	async function commit(next: InternalSession<U>) {
		adopt(next);
		try {
			// A user read from the access token is not saved; restoring reads it again.
			await persistence.write(
				users.saved ? next : { ...next, user: undefined },
			);
		} catch (cause) {
			const error = toAuthError(
				"PERSISTENCE_FAILED",
				"Could not save the session",
				cause,
			);
			// A newer session already replaced `next`, and saves itself.
			if (session !== next) throw error;
			forget(error);
			try {
				await persistence.clear();
			} catch (cleanup) {
				throw new AuthError(
					"PERSISTENCE_FAILED",
					"Saving and clearing auth storage failed",
					{
						cause: new AggregateError([error, cleanup]),
					},
				);
			}
			throw error;
		}
		// A newer session that replaced `next` publishes itself.
		if (session === next) publish();
	}

	/** Uses `next` without saving it, because storage already holds it. */
	function install(next: InternalSession<U>) {
		adopt(next);
		publish();
	}

	/**
	 * Another tab signed out or signed in again, so this tab's session is
	 * obsolete. Restores whatever storage now holds, without writing to it.
	 * Resolves `null` when storage is empty and rejects with `SESSION_CHANGED`
	 * when it holds another session.
	 */
	async function followStorage(
		id: string,
	): Promise<InternalSession<U> | null> {
		await reload();
		const restored = session as InternalSession<U> | null;
		if (!restored) return null;
		if (restored.id !== id) throw sessionChanged();
		return resolveSession();
	}

	/** Drops this tab's session and restores what storage holds, without writing. */
	async function reload() {
		advanceEpoch();
		session = null;
		revision++;
		initialized = false;
		rejectedToken = undefined;
		failure = undefined;
		refreshAttempted = false;
		publish();
		await initialize();
	}

	/**
	 * Applies what another tab saved: a sign-out, a sign-in or account switch, a
	 * refresh, or a profile update. Reads storage rather than the event, so a
	 * late or repeated event cannot apply stale data. Unreadable or malformed
	 * storage is ignored, keeping this tab's session; a well-formed session
	 * whose user this tab rejects signs every tab out, as restoring it would.
	 */
	async function sync(): Promise<void> {
		if (!initialized) {
			if (initialization) await initialization.then(sync, () => {});
			return;
		}
		const before = revision;
		let stored: StoredSession | null;
		try {
			stored = await persistence.read();
		} catch {
			return;
		}
		// This tab changed its session during the read. That change is newer
		// than what was read, and storage receives it next.
		if (revision !== before) return;
		if (!stored) {
			if (session) forget();
			return;
		}
		if (stored.id !== session?.id) return reload();
		const userUnchanged = users.unchanged(stored, session);
		const tokensUnchanged =
			stored.accessToken === session.accessToken &&
			stored.refreshToken === session.refreshToken &&
			stored.expiresAt === session.expiresAt;
		if (userUnchanged && tokensUnchanged) return;
		const previousUser = session.user;
		let user = previousUser;
		if (!userUnchanged) {
			const expected = epoch;
			try {
				user = await runTask(
					() => users.restore(stored),
					controller.signal,
				);
			} catch (cause) {
				if (epoch !== expected) return;
				const error = toAuthError(
					"PERSISTENCE_FAILED",
					"Could not apply another tab's session",
					cause,
				);
				if (error.code === "SESSION_CHANGED") return;
				if (!rejectsSaved(error)) {
					publish(error);
					return;
				}
				// A newer save arrived during validation; its own event applies it.
				const check = revision;
				const current = await latest(stored.id);
				if (
					epoch !== expected ||
					revision !== check ||
					!current ||
					!sameSaved(current, stored)
				)
					return;
				await discardSaved(error);
				return;
			}
			// Apply the user only while storage still holds what was validated.
			const check = revision;
			const now = await latest(stored.id);
			if (
				epoch !== expected ||
				revision !== check ||
				!now ||
				!sameSaved(now, stored)
			)
				return;
		}
		if (!tokensUnchanged) refreshAttempted = false;
		if (!sameUser(user, previousUser)) profileVersion++;
		install({ ...tokensOf(stored), id: stored.id, user });
	}

	/**
	 * Signs out after the backend rejected `accessToken`, session `id`'s token.
	 * If another tab has already replaced that session in storage, keeps the
	 * replacement. Resolves `undefined`, ending nothing, if this tab replaced
	 * the token while storage was read.
	 */
	async function endSession(
		id: string,
		accessToken: string,
	): Promise<InternalSession<U> | null | undefined> {
		const stored = await latest(id);
		if (!session) return null;
		if (session.id !== id) throw sessionChanged();
		if (session.accessToken !== accessToken) return undefined;
		if (stored === null) return followStorage(id);
		await signOut(false);
		return null;
	}

	async function initialize() {
		if (initialized) return;
		if (initialization) return initialization;
		const expected = epoch;
		const promise = (async () => {
			try {
				const stored = await persistence.read();
				assertEpoch(expected);
				if (stored) {
					const user = await runTask(
						() => users.restore(stored),
						controller.signal,
					);
					assertEpoch(expected);
					session = { ...tokensOf(stored), id: stored.id, user };
					revision++;
				}
				assertEpoch(expected);
				initialized = true;
				if (!session || valid()) publish();
				schedule();
			} catch (cause) {
				assertEpoch(expected);
				const error = toAuthError(
					"PERSISTENCE_FAILED",
					"Could not restore auth",
					cause,
				);
				if (rejectsSaved(error)) {
					await discardSaved(error);
					return;
				}
				const previous = store.get();
				store.set({
					...previous,
					status: "unavailable",
					error,
					version: previous.version + 1,
				} as AuthState<U>);
				throw error;
			}
		})();
		initialization = promise;
		const clearInitialization = () => {
			if (initialization === promise) initialization = undefined;
		};
		void promise.then(clearInitialization, clearInitialization);
		return promise;
	}

	async function signIn(input: SignInInput<I>) {
		advanceEpoch();
		const expected = epoch;
		try {
			const tokens = receiveTokens(input);
			if (tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now()) {
				throw new AuthError(
					"INVALID_SESSION",
					"Cannot sign in with an expired access token",
				);
			}
			const user = await runTask(
				() =>
					users.receive(
						tokens.accessToken,
						(input as { user?: unknown }).user,
					),
				controller.signal,
			);
			assertEpoch(expected);
			if (tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now()) {
				throw new AuthError(
					"INVALID_SESSION",
					"Access token expired during validation",
				);
			}
			advanceEpoch();
			rejectedToken = undefined;
			refreshAttempted = false;
			profileVersion++;
			await commit({ ...tokens, id: createId(), user });
		} catch (cause) {
			throw toAuthError(
				"USER_VALIDATION_FAILED",
				"Could not accept the user",
				cause,
			);
		} finally {
			if (epoch === expected) {
				schedule();
				if (session && !valid()) {
					if (mounts) inBackground(resolveSession());
					else publish(store.get().error);
				}
			}
		}
	}

	/**
	 * Ends the session here and clears storage. Then, if `revoke` is set and
	 * the user asked to sign out, revokes the ended tokens on the backend. A
	 * session the backend already rejected is not revoked.
	 */
	async function signOut(revoke: boolean) {
		const revokeHandler = options.revoke;
		const ended =
			revoke && revokeHandler && session
				? {
						accessToken: session.accessToken,
						refreshToken: session.refreshToken,
					}
				: undefined;
		forget();
		const expected = epoch;
		let clearFailure: AuthError | undefined;
		try {
			await persistence.clear();
		} catch (cause) {
			clearFailure = toAuthError(
				"PERSISTENCE_FAILED",
				"Could not clear the saved session",
				cause,
			);
		}
		let revokeFailure: AuthError | undefined;
		if (ended) {
			try {
				// Revoke even if this tab signs in again meanwhile, so no parent abort.
				await runTask(
					(signal) => revokeHandler!({ ...ended, signal }),
					new AbortController().signal,
				);
			} catch (cause) {
				revokeFailure = new AuthError(
					"REVOKE_FAILED",
					"Could not revoke the session",
					{ cause },
				);
			}
		}
		// A session started since then is not the one these failures belong to.
		if (clearFailure) {
			if (epoch === expected) publish(clearFailure);
			throw clearFailure;
		}
		if (revokeFailure && epoch === expected) publish(revokeFailure);
	}

	async function updateUser(input: I | (() => Promise<I>)) {
		const expected = epoch;
		const intent = ++profileIntent;
		const current = await resolveSession();
		assertEpoch(expected);
		if (!current)
			throw new AuthError(
				"UNAUTHENTICATED",
				"Sign in before updating the user",
			);
		const user = await runTask(async () => {
			const value =
				typeof input === "function"
					? await (input as () => Promise<I>)()
					: input;
			return users.receive(current.accessToken, value);
		}, controller.signal);
		/** The session to update, unless a newer update or a session change made this one obsolete. */
		const target = () => {
			assertEpoch(expected);
			if (intent !== profileIntent) throw sessionChanged();
			if (!session || session.id !== current.id || !valid())
				throw sessionChanged();
			return session;
		};
		let active = target();
		// Read again if this tab changed its session during the read: the read
		// could hold tokens that change already replaced.
		let stored: StoredSession | null | undefined;
		let before: number;
		do {
			before = revision;
			stored = await latest(active.id);
			active = target();
		} while (revision !== before);
		if (stored === null) {
			await followStorage(active.id);
			throw sessionChanged();
		}
		if (stored && stored.accessToken !== active.accessToken)
			refreshAttempted = false;
		profileVersion++;
		await commit({ ...active, ...(stored && tokensOf(stored)), user });
	}

	async function refreshSession(
		captured: { id: string; accessToken: string },
		rejected: boolean,
	): Promise<InternalSession<U> | null> {
		if (!session) return null;
		if (session.id !== captured.id) throw sessionChanged();
		if (session.accessToken !== captured.accessToken) return resolveSession();
		if (rejected) rejectedToken = captured.accessToken;
		if (flight) {
			if (!valid()) publish(store.get().error);
			return flight;
		}
		if (!options.refresh || !session.refreshToken) {
			const ended = await endSession(session.id, session.accessToken);
			return ended === undefined ? resolveSession() : ended;
		}
		const expected = epoch;
		const profile = profileVersion;
		const current = session;
		const refreshHandler = options.refresh as RefreshFn<unknown>;
		const lifecycle = controller.signal;
		refreshAttempted = true;
		failure = undefined;
		const promise = (async () => {
			try {
				const run = async (): Promise<RefreshOutcome<U>> => {
					assertEpoch(expected);
					const stored = await latest(current.id);
					assertEpoch(expected);
					if (stored === null) return { kind: "stale" };
					const result = await runTask(
						(signal) =>
							obtainTokens({
								current,
								stored,
								refresh: refreshHandler,
								users,
								rejectedToken,
								signal,
							}),
						lifecycle,
					);
					assertEpoch(expected);
					if (result === null) {
						const after = await latest(current.id);
						assertEpoch(expected);
						if (
							after === null ||
							(after &&
								after.accessToken !== (stored ?? current).accessToken)
						)
							return { kind: "stale" };
						await signOut(false);
						return { kind: "signedOut" };
					}
					if (
						result.tokens.expiresAt !== undefined &&
						result.tokens.expiresAt <= Date.now()
					) {
						throw new AuthError(
							"INVALID_SESSION",
							"Refreshed token expired during validation",
						);
					}
					if (result.tokens.accessToken === rejectedToken) {
						throw new AuthError(
							"INVALID_SESSION",
							"Refresh returned the rejected access token",
						);
					}
					const saved = await latest(current.id);
					assertEpoch(expected);
					if (saved === null) return { kind: "stale" };
					// Decide the user only now, after the last read: a profile update
					// committed meanwhile must win over the user the refresh returned.
					// A user read from the token always follows the new token.
					const user =
						!users.saved || profile === profileVersion
							? (result.user ?? session!.user)
							: session!.user;
					rejectedToken = undefined;
					refreshAttempted = false;
					const next = { ...result.tokens, id: current.id, user };
					if (result.adopted && profile === profileVersion) {
						install(next);
						return { kind: "installed", session: next };
					}
					await commit(next);
					assertEpoch(expected);
					return { kind: "installed", session: next };
				};
				const outcome = await persistence.exclusive(lifecycle, run);
				switch (outcome.kind) {
					case "stale":
						return followStorage(current.id);
					case "signedOut":
						return null;
					case "installed":
						return outcome.session;
				}
			} catch (cause) {
				if (epoch !== expected) {
					if (
						cause instanceof AuthError &&
						cause.code === "PERSISTENCE_FAILED"
					)
						throw cause;
					throw sessionChanged();
				}
				flight = undefined;
				const error = toAuthError(
					"REFRESH_FAILED",
					"Could not refresh the session",
					cause,
				);
				if (!valid()) failure = error;
				publish(error);
				schedule();
				throw error;
			}
		})();
		flight = promise;
		const clearFlight = () => {
			if (flight === promise) flight = undefined;
		};
		void promise.then(clearFlight, clearFlight);
		if (!valid()) publish(store.get().error);
		return promise;
	}

	async function resume(retry: boolean): Promise<InternalSession<U> | null> {
		const expected = epoch;
		await initialize();
		if (epoch !== expected && session) throw sessionChanged();
		if (!session) return null;
		if (valid()) return session;
		if (failure && !retry) throw failure;
		return refreshSession(session, false);
	}

	/** The current session, restored or refreshed if needed. */
	function resolveSession() {
		return resume(false);
	}

	/** Refreshes now, even while the access token is still usable. */
	async function refreshNow(): Promise<InternalSession<U> | null> {
		const expected = epoch;
		await initialize();
		if (epoch !== expected && session) throw sessionChanged();
		if (!session) return null;
		if (!options.refresh || !session.refreshToken) {
			throw new AuthError(
				"REFRESH_FAILED",
				"Refreshing needs a refresh callback and a refresh token",
			);
		}
		return refreshSession(session, false);
	}

	/**
	 * Restores at once when storage and validation both answer synchronously,
	 * so state is ready before the first render. Anything asynchronous, or
	 * any failure, is left to `initialize()`, which also reports errors.
	 */
	function restoreNow() {
		if (initialized || initialization) return;
		const stored = persistence.readNow();
		if (stored === undefined) return;
		let user: U | undefined;
		if (stored) {
			user = users.restoreNow(stored);
			if (user === undefined) return;
		}
		session = stored
			? { ...tokensOf(stored), id: stored.id, user: user! }
			: null;
		revision++;
		initialized = true;
		// An expired session publishes when its refresh starts, as in initialize().
		if (!session || valid()) publish();
	}

	function mount() {
		if (mounts++ === 0)
			unwatch = persistence.watch(() => inBackground(sync()));
		restoreNow();
		inBackground(resolveSession());
		schedule();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (--mounts === 0) {
				unwatch?.();
				unwatch = undefined;
				stopTimers();
				advanceEpoch();
				if (session && !valid()) publish(store.get().error);
			}
		};
	}

	const client = {
		state: {
			get: store.get,
			// `listen`, not `subscribe`: nanostores' `subscribe` also calls the
			// listener immediately with the current value.
			subscribe: (listener: (state: AuthState<U>) => void) => ({
				unsubscribe: store.listen((value) => {
					try {
						listener(value);
					} catch (error) {
						// A failing listener must not interrupt the auth operation that notified it.
						queueMicrotask(() => {
							throw error;
						});
					}
				}),
			}),
		},
		signIn,
		signOut: () => signOut(true),
		getSession: async () => toSession(await resolveSession()),
		retry: async () => toSession(await resume(true)),
		refresh: async () => toSession(await refreshNow()),
		isCurrent: (captured: { sessionId: string }) =>
			session?.id === captured.sessionId,
		mount,
		credentials: {
			get: async () => toCredentials(await resolveSession()),
			renew: async (captured: Credentials) =>
				toCredentials(
					await refreshSession(
						{ id: captured.sessionId, accessToken: captured.accessToken },
						true,
					),
				),
			reject: async (captured: Credentials) => {
				if (
					session?.id === captured.sessionId &&
					session.accessToken === captured.accessToken
				)
					await endSession(captured.sessionId, captured.accessToken);
			},
		},
	};
	// A user read from the access token changes only with the token.
	return (users.saved ? { ...client, updateUser } : client) as AuthClient<
		U,
		I
	>;
}
