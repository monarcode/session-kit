import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Store } from "@tanstack/store";
import { AuthError, authError, sessionChanged } from "./errors.js";
import { createPersistence } from "./persistence.js";
import type {
	AuthClient,
	AuthOptions,
	AuthState,
	Session,
	Tokens,
	User,
	UserInput,
} from "./types.js";
import { isRecord, runTask, validateTokens, validateUser } from "./validation.js";

type InternalSession<U> = Tokens & { id: string; user: U };

export function createAuth<S extends StandardSchemaV1>(
	options: AuthOptions<S>,
): AuthClient<UserInput<S>, User<S>> {
	type U = User<S>;
	type I = UserInput<S>;
	const persistence = createPersistence(options.name, options.cookieMaxAge);
	const store = new Store<AuthState<U>>({
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
	let mounts = 0;
	let proactiveTimer: ReturnType<typeof setTimeout> | undefined;
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshAttempted = false;

	const valid = () =>
		session !== null &&
		session.accessToken !== rejectedToken &&
		(session.expiresAt === undefined || session.expiresAt > Date.now());

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
					: "unavailable";
		const user = status === "authenticated" ? session!.user : null;
		const sessionId = session?.id ?? null;
		const previous = store.get();
		const changed =
			previous.status !== status ||
			previous.user !== user ||
			previous.sessionId !== sessionId;
		store.setState(() =>
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

	// Long delays are rechecked instead of overflowing the browser's timer limit.
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
				publish(store.get().error);
				void getSession().catch(() => {
					/* Error is available in state. */
				});
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
					void refreshSession(snapshot(), false).catch(() => {
						/* Keep valid access until expiry. */
					});
				},
				Math.min(delay, 2_147_483_647),
			);
		}
	}

	function assertEpoch(expected: number) {
		if (epoch !== expected) throw sessionChanged();
	}

	function advanceEpoch() {
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
		session = next;
		initialized = true;
		publish();
		schedule();
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
				publish();
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
					persistence.clear();
					return;
				}
				// No authenticated snapshot is exposed when storage cannot be read.
				store.setState((previous) => ({
					...previous,
					status: "unavailable",
					error,
					version: previous.version + 1,
				}));
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

	async function signIn(input: Tokens & { user: I }) {
		// Last sign-in attempt wins. Invalid input leaves the previous session intact.
		advanceEpoch();
		const expected = epoch;
		try {
			const tokens = validateTokens(input);
			if (
				tokens.expiresAt !== undefined &&
				tokens.expiresAt <= Date.now()
			) {
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
			if (
				tokens.expiresAt !== undefined &&
				tokens.expiresAt <= Date.now()
			) {
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
				// Validation paused the previous session's timers. If it expired
				// meanwhile, hide its profile and recover once after sign-in fails.
				if (session && !valid()) {
					publish(store.get().error);
					if (mounts)
						void getSession().catch(() => {
							/* Recovery errors are exposed through state. */
						});
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
		profileVersion++;
		commit({ ...session, user });
	}

	async function refreshSession(
		captured: Session<U>,
		rejected: boolean,
	): Promise<Session<U> | null> {
		if (!session) return null;
		if (session.id !== captured.id) throw sessionChanged();
		if (session.accessToken !== captured.accessToken) return getSession();
		if (rejected) {
			rejectedToken = captured.accessToken;
			publish();
		}
		if (flight) return flight;
		if (!options.refresh || !session.refreshToken) {
			await signOut();
			return null;
		}
		const expected = epoch;
		const profile = profileVersion;
		const current = session;
		const refreshHandler = options.refresh;
		const refreshToken = current.refreshToken!;
		refreshAttempted = true;
		const promise = (async () => {
			try {
				const result = await runTask(async (signal) => {
					const value = await refreshHandler({
						refreshToken,
						signal,
					});
					if (value === null) return null;
					const tokens = validateTokens(value);
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
							: undefined;
					return { tokens, user };
				}, controller.signal);
				assertEpoch(expected);
				if (result === null) {
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
				// A newer explicit profile update takes precedence over refresh's profile.
				const user =
					profile === profileVersion
						? (result.user ?? session!.user)
						: session!.user;
				rejectedToken = undefined;
				refreshAttempted = false;
				commit({
					...result.tokens,
					id: current.id,
					user,
					refreshToken:
						result.tokens.refreshToken ?? current.refreshToken,
				});
				return snapshot();
			} catch (cause) {
				if (epoch !== expected) {
					if (
						cause instanceof AuthError &&
						cause.code === "PERSISTENCE_FAILED"
					)
						throw cause;
					throw sessionChanged();
				}
				const error = authError(
					"REFRESH_FAILED",
					"Could not refresh the session",
					cause,
				);
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
		return promise;
	}

	async function getSession(): Promise<Session<U> | null> {
		const expected = epoch;
		await initialize();
		// Invalid saved data can deliberately advance the epoch and clear the session.
		if (epoch !== expected && session) throw sessionChanged();
		if (!session) return null;
		if (valid()) return snapshot();
		publish(store.get().error);
		return refreshSession(snapshot(), false);
	}

	function mount() {
		mounts++;
		void getSession().catch(() => {
			/* Errors are exposed through state and guards. */
		});
		schedule();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (--mounts === 0) {
				stopTimers();
				// Lifecycle cleanup cancels validation/network work without deleting storage.
				advanceEpoch();
			}
		};
	}

	return {
		state: { get: store.get, subscribe: store.subscribe },
		signIn,
		signOut,
		updateUser,
		getSession,
		mount,
		refresh: (captured) => refreshSession(captured, true),
		isCurrent: (captured) => session?.id === captured.id,
		rejectSession: async (captured) => {
			if (
				session?.id === captured.id &&
				session.accessToken === captured.accessToken
			)
				await signOut();
		},
	};
}
