import { atom } from "nanostores";

import { createDebugger, registerDebugger, seconds } from "./debug.js";
import {
	AuthError,
	toAuthError,
	sessionChanged,
	sessionLocked,
} from "./errors.js";
import { createId } from "./id.js";
import { attempt, chain, isThenable, type MaybePromise } from "./maybe.js";
import {
	createPersistence,
	type SavedEntry,
	type StoredSession,
} from "./persistence.js";
import { obtainTokens } from "./refresh.js";
import {
	resolveUserSource,
	type UserResolver,
	type UserSource,
} from "./sources.js";
import { countMounts, inBackground, stateView } from "./store.js";
import { runTask } from "./task.js";
import { setLongTimeout, proactiveRefreshDelay } from "./timers.js";
import { receiveTokens, tokensOf, type SessionTokens } from "./tokens.js";
import type {
	AuthClient,
	AuthLocking,
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

/** A locked session: what is known without its tokens. */
type LockedSession<U> = { id: string; user: U };

/**
 * Why a refresh runs: the early-refresh timer, expired access, a 401 from the
 * backend, `refresh()`, or `retry()` after a failure.
 */
type RefreshReason = "proactive" | "expired" | "rejected" | "manual" | "retry";

/** How a refresh ended, inside the cross-tab lock. */
type RefreshOutcome<U> =
	/** Storage no longer holds this tab's session; follow what it holds. */
	| { kind: "stale" }
	/** The backend rejected the refresh token, so the session ended. */
	| { kind: "signedOut" }
	| { kind: "installed"; session: InternalSession<U> };

/** Statuses that expose `user`. Adding a status will not compile until it is listed. */
const SIGNED_IN = {
	initializing: false,
	authenticated: true,
	refreshing: true,
	locked: true,
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
	locked: "locked",
	unauthenticated: "unauthenticated",
	unavailable: "unavailable",
} satisfies Record<AuthStatus, AuthStatus>;

/** A saved session as the client restored it, tokens included. */
export type SavedSession<U> = SessionTokens & { id: string; user: U };

// The server engine reads a cookie's session without refreshing it: for a
// jar that can't save new tokens, and before ending the session.
const restorers = new WeakMap<
	object,
	(publish: boolean) => Promise<SavedSession<unknown> | null>
>();

/** Restores `client`'s saved session, as `getSession` does, without refreshing it. */
export function restoreSaved<U, I>(
	client: AuthClient<U, I>,
	options: { publish?: boolean | undefined } = {},
): Promise<SavedSession<U> | null> {
	return restorers.get(client)!(
		options.publish === true,
	) as Promise<SavedSession<U> | null>;
}

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
 * Creates the auth client ({@link AuthClient}) from {@link AuthOptions}. Put
 * one in Router context per auth `name` per tab. Throws `INVALID_OPTIONS` for
 * options it can't use.
 *
 * The saved session is restored by the first `mount()`, which `AuthProvider`
 * and the router adapters call, or the first method that needs it, such as
 * `getSession()`. Until then, `state` is `initializing`.
 *
 * Token expiry comes from `expiresAt`, `expiresIn`, or JWT claims; see
 * `Tokens`. Prefer `expiresIn` so a wrong browser clock cannot expire
 * tokens early.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * declare const accessToken: string;
 * declare const refreshToken: string;
 *
 * export const auth = createAuth({
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
 * await auth.signIn({
 * 	accessToken,
 * 	refreshToken,
 * 	expiresIn: 900,
 * 	user: { id: "1", email: "ada@example.com" },
 * });
 * ```
 *
 * @since 0.1.0
 */
export function createAuth<Src extends UserSource>(
	options: AuthOptions<Src>,
): AuthClient<User<Src>, UserInput<Src>> {
	type U = User<Src>;
	type I = UserInput<Src>;
	if (!options.storage) {
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass a storage adapter, such as webStorage(), as the storage option",
		);
	}
	const users = resolveUserSource(options.user) as UserResolver<U>;
	const locking = options.locking as true | AuthLocking | undefined;
	if (locking && !users.saved) {
		throw new AuthError(
			"INVALID_OPTIONS",
			"locking needs a user schema: a user read from the access token can't be shown while its tokens are locked",
		);
	}
	const debug = createDebugger(options.name, options.debug);
	const persistence = createPersistence(
		options.storage,
		options.name,
		options.maxAge,
		debug,
		locking === true ? undefined : locking,
	);
	const store = atom<AuthState<U>>({
		status: "initializing",
		user: null,
		sessionId: null,
		version: 0,
		error: null,
	});
	// Lifecycle. `epoch` increments whenever the session is replaced; async
	// work captures it and stops once it changes, and `controller` aborts that
	// work. Timers and the storage watch run only while `mounts.count`, the
	// number of connections, is above zero. Unmounting cancels neither: a restore or
	// refresh already started finishes, and a remount joins it.
	let epoch = 0;
	let controller = new AbortController();
	const mounts = countMounts(() => {
		debug.log("mount", "mounted: timers running");
		// Locking is for native apps, with no other tab to follow.
		const unwatch = locking
			? undefined
			: persistence.watch(() => inBackground(sync()));
		// Another tab may have changed the session while nothing watched.
		if (!locking && initialized) inBackground(sync());
		// Work in progress continues. A refresh the backend already answered
		// may have rotated the refresh token, so cancelling it would lose the
		// new one and send the spent one next time.
		return () => {
			debug.log("mount", "unmounted: timers stopped");
			unwatch?.();
			stopTimers();
		};
	});
	let cancelExpiry: (() => void) | undefined;
	let cancelProactive: (() => void) | undefined;
	// The last timer plan reported to `debug`.
	let reportedPlan: string | undefined;

	// Restoration. `session` is meaningful only once `initialized` is true;
	// `initialization` is the restore in progress, if any.
	let session: InternalSession<U> | null = null;
	let initialized = false;
	// With `locking`, the session while `locked`. `session` is then `null`,
	// except while `lock()` waits for a refresh already running.
	let locked: LockedSession<U> | null = null;
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

	// Sign-in. A pending sign-in is cancelled only by a newer `signIn` or by
	// `signOut()`, through `signInController`; `signInIntent` identifies the
	// latest call. Expiry and other tabs do not cancel it: it replaces
	// whatever session they leave.
	let signInIntent = 0;
	let signInController = new AbortController();

	const valid = () =>
		session !== null &&
		session.accessToken !== rejectedToken &&
		(session.expiresAt === undefined || session.expiresAt > Date.now());

	/**
	 * Reads what storage holds for session `id`. Every tab shares it, so another
	 * tab may have refreshed this session, signed out, or signed in again.
	 * Resolves the saved session (possibly newer than memory), `null` when this
	 * tab's session is no longer the saved one, or `undefined` when storage is
	 * unreadable and memory is the best remaining source. With `locking` there
	 * is no other context, so memory is current: storage isn't read, and
	 * sealed tokens aren't opened again.
	 */
	async function latest(
		id: string,
	): Promise<StoredSession | null | undefined> {
		if (locking) return undefined;
		try {
			const stored = await persistence.read();
			return stored?.id === id ? stored : null;
		} catch {
			return undefined;
		}
	}

	function deriveStatus(): AuthStatus {
		if (!initialized) return "initializing";
		if (locked) return "locked";
		if (!session) return "unauthenticated";
		if (valid()) return "authenticated";
		return flight ? "refreshing" : "unavailable";
	}

	/**
	 * Sets the state, reporting a change of status, session, or error. Reports
	 * first: listeners run inside `store.set`, and a change they make must
	 * appear after the one that caused it.
	 */
	function setState(next: AuthState<U>) {
		const previous = store.get();
		if (
			debug.on &&
			(previous.status !== next.status ||
				previous.sessionId !== next.sessionId ||
				previous.error !== next.error)
		)
			debug.log(
				"state",
				previous.status === next.status
					? next.status
					: `${previous.status} → ${next.status}`,
				{
					status: next.status,
					previous: previous.status,
					sessionId: next.sessionId,
					version: next.version,
					...debug.secret({ user: next.user }),
				},
				next.error ?? undefined,
			);
		store.set(next);
	}

	/**
	 * Publishes the state the session implies, with `error`. `version` moves
	 * only when guards must run again: on a change of guard status, user, or
	 * session.
	 */
	function publish(error: AuthError | null = null) {
		const status = deriveStatus();
		const current = locked ?? session;
		const user = SIGNED_IN[status] ? current!.user : null;
		const sessionId = current?.id ?? null;
		const previous = store.get();
		const changed =
			GUARD_STATUS[previous.status] !== GUARD_STATUS[status] ||
			previous.user !== user ||
			previous.sessionId !== sessionId;
		// `SIGNED_IN` keeps `user` set exactly for the statuses whose type has one.
		setState(
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

	/**
	 * Arms the expiry timer and, once per token, the early-refresh timer.
	 * Nothing is armed while unmounted or locked.
	 */
	function schedule() {
		stopTimers();
		if (
			!mounts.count ||
			locked ||
			!session ||
			session.expiresAt === undefined
		)
			return;
		const remaining = session.expiresAt - Date.now();
		if (remaining <= 0) return;
		cancelExpiry = setLongTimeout(() => {
			debug.log("timer", "expiry fired");
			// The browser clock may have moved while the timer waited.
			if (valid()) schedule();
			else inBackground(resolveSession());
		}, remaining);
		let early: number | undefined;
		if (options.refresh && session.refreshToken && !refreshAttempted) {
			early = proactiveRefreshDelay(remaining);
			cancelProactive = setLongTimeout(() => {
				debug.log("timer", "early refresh fired");
				inBackground(refreshSession(session!, "proactive"));
			}, early);
		}
		if (!debug.on) return;
		// Mounting schedules again with nothing changed; report a plan once.
		const plan = `${session.id}:${session.expiresAt}:${refreshAttempted}`;
		if (plan !== reportedPlan) {
			reportedPlan = plan;
			debug.log(
				"timer",
				early === undefined
					? `expiry in ${seconds(remaining)}`
					: `expiry in ${seconds(remaining)}, early refresh in ${seconds(early)}`,
				{ expiresInMs: remaining, earlyRefreshInMs: early },
			);
		}
	}

	function assertEpoch(expected: number) {
		if (epoch !== expected) throw sessionChanged();
	}

	/** Cancels everything in progress for the current session. */
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

	/** Ends the session in memory only, leaving storage alone. */
	function forget(error: AuthError | null = null) {
		advanceEpoch();
		session = null;
		locked = null;
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
			const clearFailure = new AuthError(
				"PERSISTENCE_FAILED",
				"Could not clear the invalid saved session",
				{ cause: new AggregateError([error, cleanup]) },
			);
			// A session started since then is not the one that failed to clear.
			if (epoch === expected) publish(clearFailure);
			throw clearFailure;
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
		locked = null;
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
			if (session) {
				debug.log("sync", "another tab signed out");
				forget();
			}
			return;
		}
		if (stored.id !== session?.id) {
			debug.log("sync", "another tab signed in", { sessionId: stored.id });
			return reload();
		}
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
				debug.log(
					"sync",
					"another tab saved a user this tab rejects; signing out",
					undefined,
					error,
				);
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
		debug.log(
			"sync",
			tokensUnchanged
				? "applied another tab's profile update"
				: "applied another tab's new tokens",
			{ sessionId: stored.id },
		);
		install({ ...tokensOf(stored), id: stored.id, user });
	}

	/**
	 * Signs out after the backend rejected `accessToken`, session `id`'s token,
	 * or it expired with no way to refresh it; `reason` says which.
	 * If another tab has already replaced that session in storage, keeps the
	 * replacement. Resolves `undefined`, ending nothing, if this tab replaced
	 * the token while storage was read.
	 */
	async function endSession(
		id: string,
		accessToken: string,
		reason: string,
	): Promise<InternalSession<U> | null | undefined> {
		const stored = await latest(id);
		if (!session) return null;
		if (session.id !== id) throw sessionChanged();
		if (session.accessToken !== accessToken) return undefined;
		if (stored === null) return followStorage(id);
		await signOut(false, reason);
		return null;
	}

	/**
	 * Restores the saved session. Finishes synchronously when storage and the
	 * user source both answer at once, as with `webStorage()` and a
	 * synchronous schema, so mounting can restore before the first render.
	 * Otherwise returns the restore in progress, which later calls join.
	 */
	function initialize(): MaybePromise<void> {
		if (initialized) return;
		if (initialization) return initialization;
		const expected = epoch;
		/** Restoring work that is asynchronous can be aborted and times out. */
		const bounded = <T>(value: MaybePromise<T>): MaybePromise<T> =>
			isThenable(value) ? runTask(() => value, controller.signal) : value;
		const started = Date.now();
		debug.log("restore", "started");
		const restored = attempt(
			() =>
				locking
					? // Without opening the tokens. Locking needs a user schema, whose
						// restore reads only `user`.
						chain(persistence.readEntry(), (entry) => {
							assertEpoch(expected);
							if (!entry) return finish(null);
							return chain(
								bounded(
									users.restore(entry as unknown as StoredSession),
								),
								(user) => finishLocked({ id: entry.id, user }),
							);
						})
					: chain(persistence.read(), (stored) => {
							assertEpoch(expected);
							if (!stored) return finish(null);
							return chain(bounded(users.restore(stored)), (user) =>
								finish({ ...tokensOf(stored), id: stored.id, user }),
							);
						}),
			(cause): MaybePromise<void> => {
				assertEpoch(expected);
				const error = toAuthError(
					"PERSISTENCE_FAILED",
					"Could not restore auth",
					cause,
				);
				if (rejectsSaved(error)) {
					debug.log(
						"restore",
						"discarded the saved session",
						undefined,
						error,
					);
					return discardSaved(error);
				}
				debug.log("restore", "failed", undefined, error);
				const previous = store.get();
				setState({
					...previous,
					status: "unavailable",
					error,
					version: previous.version + 1,
				} as AuthState<U>);
				throw error;
			},
		);
		/** Installs what storage held, once this restore is still current. */
		function finish(restoredSession: InternalSession<U> | null) {
			assertEpoch(expected);
			if (restoredSession) {
				session = restoredSession;
				revision++;
			}
			initialized = true;
			if (debug.on)
				debug.log(
					"restore",
					restoredSession ? "found a saved session" : "no saved session",
					{
						durationMs: Date.now() - started,
						sessionId: restoredSession?.id ?? null,
						...(restoredSession && {
							expired: !valid(),
							...debug.secret({
								...tokensOf(restoredSession),
								user: restoredSession.user,
							}),
						}),
					},
				);
			// An expired session publishes when its refresh starts.
			if (!session || valid()) publish();
			schedule();
		}
		/** Installs a saved session as locked, once this restore is still current. */
		function finishLocked(restoredLock: LockedSession<U>) {
			assertEpoch(expected);
			locked = restoredLock;
			revision++;
			initialized = true;
			debug.log("restore", "found a saved session: locked", {
				durationMs: Date.now() - started,
				sessionId: restoredLock.id,
				...debug.secret({ user: restoredLock.user }),
			});
			publish();
		}
		if (!isThenable(restored)) return;
		const promise = restored;
		initialization = promise;
		const clearInitialization = () => {
			if (initialization === promise) initialization = undefined;
		};
		void promise.then(clearInitialization, clearInitialization);
		return promise;
	}

	function cancelSignIn() {
		signInIntent++;
		signInController.abort(sessionChanged());
		signInController = new AbortController();
	}

	/**
	 * Validates `input`, then replaces the session with it. Validation leaves
	 * the current session alone, so a sign-in that fails cancels no restore or
	 * refresh. A newer `signIn` or `signOut()` during validation makes this
	 * one reject with `SESSION_CHANGED`.
	 */
	async function signIn(input: SignInInput<I>) {
		cancelSignIn();
		const intent = signInIntent;
		const signal = signInController.signal;
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
				signal,
			);
			if (intent !== signInIntent) throw sessionChanged();
			if (tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now()) {
				throw new AuthError(
					"INVALID_SESSION",
					"Access token expired during validation",
				);
			}
			advanceEpoch();
			locked = null;
			rejectedToken = undefined;
			refreshAttempted = false;
			profileVersion++;
			const next = { ...tokens, id: createId(), user };
			await commit(next);
			if (!debug.on) return;
			// A sign-in or sign-out during the write replaced `next`.
			if (session !== next)
				debug.log("sign-in", "superseded by a newer sign-in or sign-out", {
					sessionId: next.id,
				});
			else
				debug.log("sign-in", "signed in", {
					sessionId: next.id,
					...debug.secret({ ...tokensOf(next), user }),
				});
		} catch (cause) {
			const error = toAuthError(
				"USER_VALIDATION_FAILED",
				"Could not accept the user",
				cause,
			);
			debug.log(
				"sign-in",
				error.code === "SESSION_CHANGED"
					? "superseded by a newer sign-in or sign-out"
					: "rejected",
				undefined,
				error,
			);
			throw error;
		}
	}

	/**
	 * Ends the session here and clears storage. Then, if `revoke` is set and
	 * the user asked to sign out, revokes the ended tokens on the backend. A
	 * session the backend already rejected is not revoked.
	 */
	async function signOut(revoke: boolean, reason: string) {
		const revokeHandler = options.revoke;
		// Before restoring finishes, `session` is still unknown, and ending it
		// is a sign-out too.
		debug.log(
			"sign-out",
			initialized && !session && !locked
				? `nothing to sign out (${reason}); clearing the saved session anyway`
				: `signed out: ${reason}`,
			{ sessionId: (locked ?? session)?.id ?? null },
		);
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
			debug.log(
				"sign-out",
				"could not clear the saved session",
				undefined,
				clearFailure,
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
				debug.log("sign-out", "revoked the tokens");
			} catch (cause) {
				revokeFailure = new AuthError(
					"REVOKE_FAILED",
					"Could not revoke the session",
					{ cause },
				);
				debug.log("sign-out", "revoke failed", undefined, revokeFailure);
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
		let user: U;
		try {
			user = await runTask(async () => {
				const value =
					typeof input === "function"
						? await (input as () => Promise<I>)()
						: input;
				return users.receive(current.accessToken, value);
			}, controller.signal);
		} catch (cause) {
			throw toAuthError(
				"USER_VALIDATION_FAILED",
				"Could not accept the user",
				cause,
			);
		}
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

	/**
	 * Replaces `captured`'s access, unless the session has moved on since it
	 * was captured, and joins a refresh already running. Inside the cross-tab
	 * lock, storage is read again so tokens another tab saved meanwhile are
	 * used rather than refreshed twice.
	 */
	async function refreshSession(
		captured: { id: string; accessToken: string },
		reason: RefreshReason,
	): Promise<InternalSession<U> | null> {
		// Nothing refreshes while locked, including while `lock()` waits for a
		// refresh that started before it.
		if (locked) throw sessionLocked();
		if (!session) return null;
		if (session.id !== captured.id) throw sessionChanged();
		if (session.accessToken !== captured.accessToken) return resolveSession();
		if (reason === "rejected") rejectedToken = captured.accessToken;
		if (flight) {
			debug.log("refresh", `joined the refresh in progress (${reason})`);
			if (!valid()) publish(store.get().error);
			return flight;
		}
		if (!options.refresh || !session.refreshToken) {
			const ended = await endSession(
				session.id,
				session.accessToken,
				reason === "rejected"
					? "the backend rejected the access token, and there is no refresh token or callback"
					: "access expired, and there is no refresh token or callback",
			);
			return ended === undefined ? resolveSession() : ended;
		}
		const expected = epoch;
		const profile = profileVersion;
		const current = session;
		const refreshHandler = options.refresh as RefreshFn<unknown>;
		const lifecycle = controller.signal;
		refreshAttempted = true;
		failure = undefined;
		const started = Date.now();
		debug.log("refresh", `started (${reason})`, {
			sessionId: current.id,
			reason,
		});
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
						await signOut(
							false,
							"the backend rejected the refresh token",
						);
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
					const installed = (message: string) => {
						if (debug.on)
							debug.log("refresh", message, {
								sessionId: next.id,
								durationMs: Date.now() - started,
								expiresInMs:
									next.expiresAt === undefined
										? undefined
										: next.expiresAt - Date.now(),
								...debug.secret(tokensOf(next)),
							});
					};
					if (result.adopted && profile === profileVersion) {
						install(next);
						installed("used the tokens another tab saved");
						return { kind: "installed", session: next };
					}
					await commit(next);
					assertEpoch(expected);
					installed("saved new tokens");
					return { kind: "installed", session: next };
				};
				const outcome = await persistence.exclusive(lifecycle, run);
				switch (outcome.kind) {
					case "stale":
						debug.log(
							"refresh",
							"another tab replaced the session; following it",
						);
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
				debug.log(
					"refresh",
					"failed",
					{ sessionId: current.id, durationMs: Date.now() - started },
					error,
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
		if (locked) throw sessionLocked();
		if (!session) return null;
		if (valid()) return session;
		if (failure && !retry) throw failure;
		return refreshSession(session, retry ? "retry" : "expired");
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
		if (locked) throw sessionLocked();
		if (!session) return null;
		if (!options.refresh || !session.refreshToken) {
			throw new AuthError(
				"REFRESH_FAILED",
				"Refreshing needs a refresh callback and a refresh token",
			);
		}
		return refreshSession(session, "manual");
	}

	function requireLocking(method: string) {
		if (!locking)
			throw new AuthError(
				"INVALID_OPTIONS",
				`Pass locking to createAuth to use ${method}()`,
			);
	}

	/** Waits for a refresh already running, whatever its outcome. */
	async function settled() {
		if (flight)
			await flight.then(
				() => {},
				() => {},
			);
	}

	async function lock(): Promise<void> {
		requireLocking("lock");
		if (!session || locked) return;
		const target: LockedSession<U> = { id: session.id, user: session.user };
		locked = target;
		stopTimers();
		debug.log("lock", "locked", { sessionId: target.id });
		publish();
		// A refresh already running finishes and saves its tokens: cancelling it
		// could lose a refresh token the backend already rotated.
		await settled();
		// Unless a sign-in, sign-out, or unlock replaced the lock meanwhile.
		if (locked !== target || session?.id !== target.id) return;
		// The refresh may have brought a new user.
		if (session.user !== target.user)
			locked = { id: target.id, user: session.user };
		session = null;
		revision++;
		publish();
	}

	// The unlock in progress, which overlapping calls share.
	let unlocking: Promise<InternalSession<U> | null> | undefined;

	async function unlock(): Promise<Session<U> | null> {
		requireLocking("unlock");
		if (!unlocking) {
			const promise = unlockOnce();
			unlocking = promise;
			const clear = () => {
				if (unlocking === promise) unlocking = undefined;
			};
			void promise.then(clear, clear);
		}
		return toSession(await unlocking);
	}

	async function unlockOnce(): Promise<InternalSession<U> | null> {
		await initialize();
		const target = locked;
		if (!target) return resolveSession();
		let entry: SavedEntry | null;
		let stored: StoredSession | null;
		try {
			entry = await persistence.readEntry();
			stored = entry && (await persistence.open(entry));
		} catch (cause) {
			const error = toAuthError(
				"UNLOCK_FAILED",
				"Could not unlock the session",
				cause,
			);
			if (locked !== target) throw sessionChanged();
			debug.log("lock", "unlock failed", { sessionId: target.id }, error);
			// The saved session can't be used: sign out, as restoring would.
			if (rejectsSaved(error)) await discardSaved(error);
			throw error;
		}
		// A sign-in or sign-out during the read.
		if (locked !== target) throw sessionChanged();
		if (!stored) {
			debug.log("lock", "unlock found no saved session", {
				sessionId: target.id,
			});
			forget();
			return null;
		}
		if (stored.id !== target.id) {
			await reload();
			throw sessionChanged();
		}
		const next: InternalSession<U> = {
			...tokensOf(stored),
			id: target.id,
			user: target.user,
		};
		locked = null;
		rejectedToken = undefined;
		refreshAttempted = false;
		adopt(next);
		if (!valid()) {
			// Refreshing seals what it saves. If it fails, the session is
			// unlocked all the same, and `unavailable` until `retry()`.
			debug.log("lock", "unlocked: access expired, refreshing", {
				sessionId: next.id,
			});
			return resolveSession();
		}
		// A session saved before locking was turned on is sealed now, if it
		// can be. If not, the saved session stays as it was, which is better
		// than losing it, and the next save seals it. The write is queued
		// before publishing, so a sign-out from a listener is saved after it.
		const resealing =
			entry?.tokens && locking !== true
				? persistence.write(next)
				: undefined;
		publish();
		debug.log("lock", "unlocked", { sessionId: next.id });
		if (resealing) {
			try {
				await resealing;
			} catch (cause) {
				debug.log(
					"lock",
					"could not seal the session saved before locking; it stays as it was",
					{ sessionId: next.id },
					toAuthError(
						"PERSISTENCE_FAILED",
						"Could not seal the session",
						cause,
					),
				);
			}
		}
		return resolveSession();
	}

	function mount() {
		// Only the first mount and the last unmount start and stop the work.
		// Later mounts, such as `SessionGate`'s own or a foreground re-check,
		// only re-check the session.
		const unmount = mounts.mount();
		// Restores synchronously when it can, before returning. On every call,
		// not only the first: a re-check after timers were suspended, as in a
		// backgrounded app, relies on it.
		inBackground(resolveSession());
		schedule();
		return unmount;
	}

	const client = {
		state: stateView(store),
		signIn,
		signOut: () => {
			cancelSignIn();
			return signOut(true, "requested");
		},
		getSession: async () => toSession(await resolveSession()),
		retry: async () => toSession(await resume(true)),
		refresh: async () => toSession(await refreshNow()),
		isCurrent: (captured: { sessionId: string }) =>
			(locked ?? session)?.id === captured.sessionId,
		lock,
		unlock,
		mount,
		credentials: {
			get: async () => toCredentials(await resolveSession()),
			renew: async (captured: Credentials) =>
				toCredentials(
					await refreshSession(
						{ id: captured.sessionId, accessToken: captured.accessToken },
						"rejected",
					),
				),
			reject: async (captured: Credentials) => {
				if (
					session?.id === captured.sessionId &&
					session.accessToken === captured.accessToken
				)
					await endSession(
						captured.sessionId,
						captured.accessToken,
						"the backend rejected the access token",
					);
			},
		},
	};
	// A user read from the access token changes only with the token.
	const result = (
		users.saved ? { ...client, updateUser } : client
	) as AuthClient<U, I>;
	registerDebugger(result, debug);
	restorers.set(result, async (show) => {
		await initialize();
		// An expired session publishes when its refresh starts. A read that
		// won't refresh shows it as it stands instead.
		if (show && store.get().status === "initializing") publish();
		return (
			session && { ...tokensOf(session), id: session.id, user: session.user }
		);
	});
	return result;
}
