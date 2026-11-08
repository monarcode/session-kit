import type { Debugger } from "./debug.js";
import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import { attempt, chain, isThenable, type MaybePromise } from "./maybe.js";
import type { AuthStorage } from "./storage.js";
import { tokensOf, validateTokens, type SessionTokens } from "./tokens.js";
import type { AuthLocking } from "./types.js";

/** A saved session. `user` is absent when the user comes from the access token. */
export type StoredSession = SessionTokens & { id: string; user?: unknown };

/**
 * A saved entry before its tokens are read: `sealed` when `locking.seal`
 * encrypted them, otherwise `tokens`.
 */
export type SavedEntry = { id: string; user?: unknown } & (
	| { sealed: string; tokens?: undefined }
	| { tokens: SessionTokens; sealed?: undefined }
);

/** Format of the saved entry; entries in any other format are not restored. */
const STORAGE_VERSION = 4;
/** Thirty days. */
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Reports a storage failure, keeping auth's own errors as they are. */
function storageError(cause: unknown): AuthError {
	return cause instanceof AuthError
		? cause
		: new AuthError("PERSISTENCE_FAILED", "Auth storage is unavailable", {
				cause,
			});
}

export function createPersistence(
	storage: AuthStorage,
	name: string,
	maxAge = DEFAULT_MAX_AGE_SECONDS,
	debug: Debugger,
	sealing?: AuthLocking,
) {
	if (
		!/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
		!Number.isSafeInteger(maxAge) ||
		maxAge <= 0
	) {
		throw new Error(
			"Use a simple auth name and a positive maxAge in seconds",
		);
	}
	const key = `${name}:auth:session`;
	const lockName = `${name}:auth:refresh`;
	if (debug.on)
		storage.debug?.(
			key,
			(message, data) => debug.log("storage", message, data),
			debug.sensitive,
		);

	/**
	 * Runs storage operation `kind` and reports how it went and how long it
	 * took. `describe` adds details of a successful result.
	 */
	function timed<T>(
		kind: "read" | "write" | "clear",
		operation: () => MaybePromise<T>,
		describe: (result: T) => Record<string, unknown> = () => ({}),
	): MaybePromise<T> {
		if (!debug.on) return operation();
		const started = Date.now();
		const data = () => ({ key, durationMs: Date.now() - started });
		return attempt(
			() =>
				chain(operation(), (result) => {
					debug.log("storage", kind, { ...data(), ...describe(result) });
					return result;
				}),
			(cause) => {
				debug.log("storage", `${kind} failed`, data(), storageError(cause));
				throw cause;
			},
		);
	}

	// Operations run one at a time, in the order requested. Storage that settles
	// out of order still ends up holding the latest write, and a read sees every
	// write requested before it.
	let queue: Promise<unknown> = Promise.resolve();
	let pending = 0;
	function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		pending++;
		const result = queue.then(operation).catch((cause: unknown) => {
			throw storageError(cause);
		});
		queue = result.catch(() => {}).finally(() => pending--);
		return result;
	}

	function clear(): Promise<void> {
		return enqueue(async () => {
			await timed("clear", () => storage.remove(key));
		});
	}

	function get(): ReturnType<AuthStorage["get"]> {
		return timed(
			"read",
			() => storage.get(key),
			(text) => ({ found: text !== null, ...debug.secret({ value: text }) }),
		);
	}

	const invalid = (cause: unknown) =>
		new AuthError("INVALID_SESSION", "Saved session cannot be restored", {
			cause,
		});

	/**
	 * Parses a saved entry, rejecting other formats and expired entries,
	 * without opening sealed tokens.
	 */
	function parse(text: string | null): SavedEntry | null {
		if (!text) return null;
		try {
			const saved: unknown = JSON.parse(text);
			if (
				!isRecord(saved) ||
				saved.v !== STORAGE_VERSION ||
				typeof saved.id !== "string" ||
				!saved.id ||
				typeof saved.persistUntil !== "number" ||
				!Number.isFinite(saved.persistUntil) ||
				saved.persistUntil <= Date.now()
			) {
				throw new Error("Missing, expired, or malformed auth data");
			}
			if (typeof saved.sealed === "string")
				return { id: saved.id, user: saved.user, sealed: saved.sealed };
			return {
				id: saved.id,
				user: saved.user,
				tokens: validateTokens(saved),
			};
		} catch (cause) {
			throw invalid(cause);
		}
	}

	/**
	 * The saved session in `entry`, opening sealed tokens with `sealing.open`.
	 * Rejects with `UNLOCK_FAILED` when `open` throws, and `INVALID_SESSION`
	 * when what it returns isn't this entry's tokens.
	 */
	function open(entry: SavedEntry): MaybePromise<StoredSession> {
		if (entry.tokens)
			return { ...entry.tokens, id: entry.id, user: entry.user };
		if (!sealing) {
			throw invalid(
				new Error(
					"The saved tokens are sealed, and there is no locking.open",
				),
			);
		}
		const sealed = entry.sealed;
		const opened = attempt(
			() => sealing.open(sealed),
			(cause) => {
				throw new AuthError(
					"UNLOCK_FAILED",
					"Could not open the saved session",
					{ cause },
				);
			},
		);
		return chain(opened, (payload: unknown) => {
			// A mistake in the app's `open`, not a broken session: stay locked.
			if (typeof payload !== "string") {
				throw new AuthError(
					"UNLOCK_FAILED",
					"Could not open the saved session",
					{
						cause: new TypeError("locking.open must return a string"),
					},
				);
			}
			try {
				const tokens: unknown = JSON.parse(payload);
				// The ID ties the sealed part to its entry, so one copied from
				// another entry is refused.
				if (!isRecord(tokens) || tokens.id !== entry.id)
					throw new Error("The sealed tokens belong to another session");
				return {
					...validateTokens(tokens),
					id: entry.id,
					user: entry.user,
				};
			} catch (cause) {
				throw invalid(cause);
			}
		});
	}

	/**
	 * Reads storage and passes its text to `then`. With nothing queued,
	 * storage is asked at once, and a synchronous answer is handled
	 * synchronously, so a session can be restored before the first render.
	 * Otherwise the read waits its turn.
	 */
	function readWith<T>(
		then: (text: string | null) => MaybePromise<T>,
	): MaybePromise<T> {
		if (pending) return enqueue(async () => then(await get()));
		let text: ReturnType<AuthStorage["get"]>;
		try {
			text = get();
		} catch (cause) {
			throw storageError(cause);
		}
		if (!isThenable(text)) return then(text);
		// Queued, so operations requested meanwhile wait for this read.
		return enqueue(async () => then(await text));
	}

	/** Reads the saved entry without opening its tokens, as restoring a locked session does. */
	function readEntry(): MaybePromise<SavedEntry | null> {
		return readWith(parse);
	}

	/** Reads the saved session, opening sealed tokens. */
	function read(): MaybePromise<StoredSession | null> {
		return readWith((text) => {
			const entry = parse(text);
			return entry && open(entry);
		});
	}

	/** The fields saved for `session`: its tokens sealed, with `sealing`. */
	async function fieldsOf(session: StoredSession): Promise<object> {
		if (!sealing) return session;
		const payload = JSON.stringify({ id: session.id, ...tokensOf(session) });
		let sealed: unknown;
		try {
			sealed = await sealing.seal(payload);
			if (typeof sealed !== "string")
				throw new TypeError("locking.seal must return a string");
		} catch (cause) {
			throw new AuthError(
				"PERSISTENCE_FAILED",
				"Could not seal the session",
				{
					cause,
				},
			);
		}
		return { id: session.id, user: session.user, sealed };
	}

	function write(session: StoredSession): Promise<void> {
		return enqueue(async () => {
			const fields = await fieldsOf(session);
			const persistUntil = Date.now() + maxAge * 1000;
			const value = JSON.stringify({
				v: STORAGE_VERSION,
				...fields,
				persistUntil,
			});
			await timed(
				"write",
				() => storage.set(key, value, { expiresAt: persistUntil }),
				() => debug.secret({ value }),
			);
		});
	}

	/**
	 * Runs `work` while holding this auth name's lock, shared by every context
	 * using the storage, so only one at a time spends a refresh token. Without a
	 * lock it runs directly. Aborting `signal` stops waiting for the lock. Once
	 * granted, the lock is held until `work` settles, so `work` must bound its
	 * own duration.
	 */
	function exclusive<T>(
		signal: AbortSignal,
		work: () => Promise<T>,
	): Promise<T> {
		return storage.lock ? storage.lock(lockName, signal, work) : work();
	}

	/**
	 * Calls `listener` when another context saves or clears the session, and
	 * returns a function that stops listening.
	 */
	function watch(listener: () => void): () => void {
		return storage.subscribe?.(key, listener) ?? (() => {});
	}

	return { read, readEntry, open, write, clear, exclusive, watch };
}
