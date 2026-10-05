import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import { isThenable, type MaybePromise } from "./maybe.js";
import type { AuthStorage } from "./storage.js";
import { validateTokens, type SessionTokens } from "./tokens.js";

/** A saved session. `user` is absent when the user comes from the access token. */
export type StoredSession = SessionTokens & { id: string; user?: unknown };

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
			await storage.remove(key);
		});
	}

	/** Parses a saved entry, rejecting other formats and expired entries. */
	function parse(text: string | null): StoredSession | null {
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
			return {
				...validateTokens(saved),
				id: saved.id,
				user: saved.user,
			};
		} catch (cause) {
			throw new AuthError(
				"INVALID_SESSION",
				"Saved session cannot be restored",
				{ cause },
			);
		}
	}

	/**
	 * Reads the saved session. With nothing queued, storage is asked at once,
	 * and a synchronous answer is returned synchronously, so a session can be
	 * restored before the first render. Otherwise the read waits its turn.
	 */
	function read(): MaybePromise<StoredSession | null> {
		if (pending) return enqueue(async () => parse(await storage.get(key)));
		let text: ReturnType<AuthStorage["get"]>;
		try {
			text = storage.get(key);
		} catch (cause) {
			throw storageError(cause);
		}
		if (!isThenable(text)) return parse(text);
		// Queued, so operations requested meanwhile wait for this read.
		return enqueue(async () => parse(await text));
	}

	function write(session: StoredSession): Promise<void> {
		return enqueue(async () => {
			const persistUntil = Date.now() + maxAge * 1000;
			await storage.set(
				key,
				JSON.stringify({ v: STORAGE_VERSION, ...session, persistUntil }),
				{ expiresAt: persistUntil },
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

	return { read, write, clear, exclusive, watch };
}
