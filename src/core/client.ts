import type { StandardSchemaV1 } from "@standard-schema/spec";
import { atom } from "nanostores";

import { AuthError, authError, sessionChanged } from "./errors.js";
import { createPersistence, type StoredSession } from "./persistence.js";
import type {
	AuthClient,
	AuthOptions,
	AuthState,
	Session,
	SignInInput,
	User,
	UserInput,
} from "./types.js";
import {
	isRecord,
	receiveTokens,
	runTask,
	validateUser,
	type SessionTokens,
} from "./validation.js";

type InternalSession<U> = SessionTokens & { id: string; user: U };

/** Starts work nobody awaits. Failures are already published to `state.error`. */
function inBackground(work: Promise<unknown>) {
	work.catch(() => {});
}

function tokensOf(saved: SessionTokens): SessionTokens {
	return {
		accessToken: saved.accessToken,
		refreshToken: saved.refreshToken,
		expiresAt: saved.expiresAt,
	};
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
 * 	userSchema: z.object({ id: z.string(), email: z.string() }),
 * 	refresh: createRefreshFn(async ({ refreshToken, signal }) => {
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
 * 	}),
 * });
 *
 * await auth.signIn({ accessToken, refreshToken, expiresIn: 900, user });
 */
export function createAuth<S extends StandardSchemaV1>(
	options: AuthOptions<S>,
): AuthClient<UserInput<S>, User<S>> {
	type U = User<S>;
	type I = UserInput<S>;
	const persistence = createPersistence(options.name, options.maxAge);
	const store = atom<AuthState<U>>({
		status: "initializing",
		user: null,
		sessionId: null,
		version: 0,
		error: null,
	});
	let session: InternalSession<U> | null = null;
	let epoch = 0;
	let profileVersion = 0;
	let profileIntent = 0;
	let controller = new AbortController();
	let initialization: Promise<void> | undefined;
	let initialized = false;
	let rejectedToken: string | undefined;
	let flight: Promise<Session<U> | null> | undefined;
	let failure: AuthError | undefined;
	let mounts = 0;
	let proactiveTimer: ReturnType<typeof setTimeout> | undefined;
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshAttempted = false;
	let unwatch: (() => void) | undefined;

	const valid = () =>
		session !== null &&
		session.accessToken !== rejectedToken &&
		(session.expiresAt === undefined || session.expiresAt > Date.now());

	/** Whether another tab's saved tokens can be used instead of refreshing. */
	const usable = (tokens: SessionTokens) =>
		tokens.accessToken !== rejectedToken &&
		(tokens.expiresAt === undefined ||
			tokens.expiresAt >= Date.now() + 5_000);

	/**
	 * Reads what storage holds for session `id`. Every tab shares it, so another
	 * tab may have refreshed this session, signed out, or signed in again.
	 * Returns the saved session (possibly newer than memory), `null` when this
	 * tab's session is no longer the saved one, or `undefined` when storage is
	 * unreadable and memory is the best remaining source.
	 */
	function latest(id: string): StoredSession | null | undefined {
		try {
			const stored = persistence.read();
			return stored?.id === id ? stored : null;
		} catch {
			return undefined;
		}
	}

	function snapshot(): Session<U> {
		if (!session)
			throw new AuthError("UNAUTHENTICATED", "Sign in is required");
		return Object.freeze({
			id: session.id,
			accessToken: session.accessToken,
			expiresAt: session.expiresAt,
			user: session.user,
		});
	}

	function publish(error: AuthError | null = null) {
		const status = !initialized
			? "initializing"
			: !session
				? "unauthenticated"
				: valid()
					? "authenticated"
					: flight
						? "refreshing"
						: "unavailable";
		const user =
			status === "authenticated" || status === "refreshing"
				? session!.user
				: null;
		const sessionId = session?.id ?? null;
		const previous = store.get();
		const guardStatus = (value: AuthState<U>["status"]) =>
			value === "refreshing" ? "authenticated" : value;
		const changed =
			guardStatus(previous.status) !== guardStatus(status) ||
			previous.user !== user ||
			previous.sessionId !== sessionId;
		store.set(
			Object.freeze({
				status,
				user,
				sessionId,
				error,
				version: previous.version + Number(changed),
			}),
		);
	}

	function stopTimers() {
		clearTimeout(proactiveTimer);
		clearTimeout(expiryTimer);
	}

	function schedule() {
		stopTimers();
		if (!mounts || !session || session.expiresAt === undefined) return;
		const remaining = session.expiresAt - Date.now();
		if (remaining <= 0) return;
		expiryTimer = setTimeout(
			() => {
				if (valid()) {
					schedule();
					return;
				}
				inBackground(getSession());
			},
			Math.min(remaining, 2_147_483_647),
		);
		if (options.refresh && session.refreshToken && !refreshAttempted) {
			const delay = remaining - Math.min(60_000, remaining / 2);
			proactiveTimer = setTimeout(
				() => {
					if (delay > 2_147_483_647) {
						schedule();
						return;
					}
					inBackground(refreshSession(snapshot(), false));
				},
				Math.min(delay, 2_147_483_647),
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
		initialized = true;
		rejectedToken = undefined;
		failure = undefined;
		publish(error);
	}

	function commit(next: InternalSession<U>) {
		try {
			persistence.write(next);
		} catch (cause) {
			const error = authError(
				"PERSISTENCE_FAILED",
				"Could not save the session",
				cause,
			);
			forget(error);
			try {
				persistence.clear();
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
		install(next);
	}

	/** Uses `next` without saving it, because storage already holds it. */
	function install(next: InternalSession<U>) {
		session = next;
		initialized = true;
		failure = undefined;
		publish();
		schedule();
	}

	/**
	 * Another tab signed out or signed in again, so this tab's session is
	 * obsolete. Restores whatever storage now holds, without writing to it.
	 * Resolves `null` when storage is empty and rejects with `SESSION_CHANGED`
	 * when it holds another session.
	 */
	async function followStorage(id: string): Promise<Session<U> | null> {
		await reload();
		const restored = session as InternalSession<U> | null;
		if (!restored) return null;
		if (restored.id !== id) throw sessionChanged();
		return getSession();
	}

	/** Drops this tab's session and restores what storage holds, without writing. */
	async function reload() {
		advanceEpoch();
		session = null;
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
	 * late or repeated event cannot apply stale data.
	 */
	async function sync() {
		if (!initialized) {
			if (initialization) await initialization.then(sync, () => {});
			return;
		}
		let stored: StoredSession | null;
		try {
			stored = persistence.read();
		} catch {
			return;
		}
		if (!stored) {
			if (session) forget();
			return;
		}
		if (stored.id !== session?.id) return reload();
		const sameUser =
			JSON.stringify(stored.user) === JSON.stringify(session.user);
		const sameTokens =
			stored.accessToken === session.accessToken &&
			stored.refreshToken === session.refreshToken &&
			stored.expiresAt === session.expiresAt;
		if (sameUser && sameTokens) return;
		const expected = epoch;
		const user = sameUser
			? session.user
			: await runTask(
					() => validateUser(options.userSchema, stored.user),
					controller.signal,
				);
		const now = latest(stored.id);
		if (
			epoch !== expected ||
			!now ||
			now.accessToken !== stored.accessToken ||
			JSON.stringify(now.user) !== JSON.stringify(stored.user)
		)
			return;
		if (!sameTokens) refreshAttempted = false;
		if (!sameUser) profileVersion++;
		install({ ...tokensOf(stored), id: stored.id, user });
	}

	/**
	 * Signs out after the backend rejected session `id`. If another tab has
	 * already replaced that session in storage, keeps the replacement.
	 */
	async function endSession(id: string): Promise<Session<U> | null> {
		if (latest(id) === null) return followStorage(id);
		await signOut();
		return null;
	}

	async function initialize() {
		if (initialized) return;
		if (initialization) return initialization;
		const expected = epoch;
		const promise = (async () => {
			try {
				const stored = persistence.read();
				if (stored) {
					const user = await runTask(
						() => validateUser(options.userSchema, stored.user),
						controller.signal,
					);
					assertEpoch(expected);
					session = { ...stored, user };
				}
				assertEpoch(expected);
				initialized = true;
				if (!session || valid()) publish();
				schedule();
			} catch (cause) {
				assertEpoch(expected);
				const error = authError(
					"PERSISTENCE_FAILED",
					"Could not restore auth",
					cause,
				);
				if (
					error.code === "INVALID_SESSION" ||
					error.code === "USER_VALIDATION_FAILED"
				) {
					forget(error);
					try {
						persistence.clear();
					} catch (cleanup) {
						const failure = new AuthError(
							"PERSISTENCE_FAILED",
							"Could not clear the invalid saved session",
							{ cause: new AggregateError([error, cleanup]) },
						);
						publish(failure);
						throw failure;
					}
					return;
				}
				const previous = store.get();
				store.set({
					...previous,
					status: "unavailable",
					error,
					version: previous.version + 1,
				});
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
				() => validateUser(options.userSchema, input.user),
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
			commit({ ...tokens, id: crypto.randomUUID(), user });
		} catch (cause) {
			throw authError(
				"USER_VALIDATION_FAILED",
				"Could not accept the user",
				cause,
			);
		} finally {
			if (epoch === expected) {
				schedule();
				if (session && !valid()) {
					if (mounts) inBackground(getSession());
					else publish(store.get().error);
				}
			}
		}
	}

	async function signOut() {
		forget();
		try {
			persistence.clear();
		} catch (cause) {
			const error = authError(
				"PERSISTENCE_FAILED",
				"Could not clear the saved session",
				cause,
			);
			publish(error);
			throw error;
		}
	}

	async function updateUser(input: I | (() => Promise<I>)) {
		const expected = epoch;
		const intent = ++profileIntent;
		const current = await getSession();
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
			return validateUser(options.userSchema, value);
		}, controller.signal);
		assertEpoch(expected);
		if (intent !== profileIntent) throw sessionChanged();
		if (!session || session.id !== current.id || !valid())
			throw sessionChanged();
		const stored = latest(session.id);
		if (stored === null) {
			await followStorage(session.id);
			throw sessionChanged();
		}
		if (stored && stored.accessToken !== session.accessToken)
			refreshAttempted = false;
		profileVersion++;
		commit({ ...session, ...(stored && tokensOf(stored)), user });
	}

	async function refreshSession(
		captured: Session<U>,
		rejected: boolean,
	): Promise<Session<U> | null> {
		if (!session) return null;
		if (session.id !== captured.id) throw sessionChanged();
		if (session.accessToken !== captured.accessToken) return getSession();
		if (rejected) rejectedToken = captured.accessToken;
		if (flight) {
			if (!valid()) publish(store.get().error);
			return flight;
		}
		if (!options.refresh || !session.refreshToken)
			return endSession(session.id);
		const expected = epoch;
		const profile = profileVersion;
		const current = session;
		const refreshHandler = options.refresh;
		const lifecycle = controller.signal;
		refreshAttempted = true;
		failure = undefined;
		const promise = (async () => {
			try {
				const outcome = await persistence.exclusive(lifecycle, async () => {
					assertEpoch(expected);
					const stored = latest(current.id);
					if (stored === null) return "stale" as const;
					const savedUser = (saved: StoredSession) =>
						JSON.stringify(saved.user) === JSON.stringify(current.user)
							? current.user
							: validateUser(options.userSchema, saved.user);
					const result = await runTask(async (signal) => {
						if (
							stored &&
							stored.accessToken !== current.accessToken &&
							usable(stored)
						) {
							return {
								tokens: tokensOf(stored),
								user: await savedUser(stored),
								adopted: true,
							};
						}
						const refreshToken =
							stored?.refreshToken ?? current.refreshToken!;
						const value = await refreshHandler({
							refreshToken,
							signal,
						});
						if (value === null) return null;
						const tokens = receiveTokens(value);
						if (
							tokens.expiresAt !== undefined &&
							tokens.expiresAt < Date.now() + 5_000
						) {
							throw new AuthError(
								"INVALID_SESSION",
								"Refreshed access token must last at least five seconds",
							);
						}
						const user =
							isRecord(value) && value.user !== undefined
								? await validateUser(options.userSchema, value.user)
								: stored
									? await savedUser(stored)
									: undefined;
						return {
							tokens: {
								...tokens,
								refreshToken: tokens.refreshToken ?? refreshToken,
							},
							user,
							adopted: false,
						};
					}, lifecycle);
					assertEpoch(expected);
					if (result === null) {
						const after = latest(current.id);
						if (
							after === null ||
							(after &&
								after.accessToken !== (stored ?? current).accessToken)
						)
							return "stale" as const;
						await signOut();
						return null;
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
					const user =
						profile === profileVersion
							? (result.user ?? session!.user)
							: session!.user;
					rejectedToken = undefined;
					refreshAttempted = false;
					if (latest(current.id) === null) return "stale" as const;
					const next = { ...result.tokens, id: current.id, user };
					if (result.adopted && profile === profileVersion) install(next);
					else commit(next);
					return snapshot();
				});
				return outcome === "stale" ? followStorage(current.id) : outcome;
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
				const error = authError(
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

	async function resume(retry: boolean): Promise<Session<U> | null> {
		const expected = epoch;
		await initialize();
		if (epoch !== expected && session) throw sessionChanged();
		if (!session) return null;
		if (valid()) return snapshot();
		if (failure && !retry) throw failure;
		return refreshSession(snapshot(), false);
	}

	function getSession() {
		return resume(false);
	}

	function mount() {
		if (mounts++ === 0)
			unwatch = persistence.watch(() => inBackground(sync()));
		inBackground(getSession());
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

	return {
		state: {
			get: store.get,
			// `listen`, not `subscribe`: nanostores' `subscribe` also calls the
			// listener immediately with the current value.
			subscribe: (listener) => ({
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
		signOut,
		updateUser,
		getSession,
		retry: () => resume(true),
		mount,
		refresh: (captured) => refreshSession(captured, true),
		isCurrent: (captured) => session?.id === captured.id,
		rejectSession: async (captured) => {
			if (
				session?.id === captured.id &&
				session.accessToken === captured.accessToken
			)
				await endSession(captured.id);
		},
	};
}
