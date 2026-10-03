import { AuthError } from "./errors.js";
import { isRecord, validateTokens, type SessionTokens } from "./validation.js";

export type StoredSession = SessionTokens & { id: string; user: unknown };

export function createPersistence(name: string, maxAge = 30 * 24 * 60 * 60) {
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
	const legacyKeys = [`${name}:auth:tokens`, `${name}:auth:user`];
	const lockName = `${name}:auth:refresh`;

	function storageOperation<T>(work: () => T): T {
		try {
			return work();
		} catch (cause) {
			if (cause instanceof AuthError) throw cause;
			throw new AuthError(
				"PERSISTENCE_FAILED",
				"Auth storage is unavailable",
				{
					cause,
				},
			);
		}
	}

	function clear() {
		storageOperation(() => {
			const failures: unknown[] = [];
			for (const entry of [key, ...legacyKeys]) {
				try {
					localStorage.removeItem(entry);
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length)
				throw new AggregateError(failures, "Could not clear auth storage");
		});
	}

	function read(): StoredSession | null {
		return storageOperation(() => {
			const text = localStorage.getItem(key);
			if (!text) {
				for (const entry of legacyKeys) localStorage.removeItem(entry);
				return null;
			}
			try {
				const saved: unknown = JSON.parse(text);
				if (
					!isRecord(saved) ||
					saved.v !== 3 ||
					typeof saved.id !== "string" ||
					!saved.id ||
					!("user" in saved) ||
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
		});
	}

	function write(session: StoredSession) {
		storageOperation(() => {
			localStorage.setItem(
				key,
				JSON.stringify({
					v: 3,
					...session,
					persistUntil: Date.now() + maxAge * 1000,
				}),
			);
		});
	}

	/**
	 * Runs `work` while holding this auth name's lock, shared by every tab, so
	 * only one tab at a time spends a refresh token. Without Web Locks it runs
	 * directly. Aborting `signal` stops waiting for the lock. Once granted, the
	 * lock is held until `work` settles, so `work` must bound its own duration.
	 */
	function exclusive<T>(
		signal: AbortSignal,
		work: () => Promise<T>,
	): Promise<T> {
		const locks = globalThis.navigator?.locks;
		if (!locks) return work();
		return locks.request(lockName, { signal }, work);
	}

	/**
	 * Calls `listener` when another tab saves or clears the session. Browsers
	 * fire `storage` events only in other tabs, never in the tab that wrote.
	 * Returns a function that stops listening.
	 */
	function watch(listener: () => void): () => void {
		if (typeof globalThis.addEventListener !== "function") return () => {};
		const onStorage = (event: Event) => {
			const changed = (event as StorageEvent).key;
			if (changed === key || changed === null) listener();
		};
		globalThis.addEventListener("storage", onStorage);
		return () => globalThis.removeEventListener("storage", onStorage);
	}

	return { read, write, clear, exclusive, watch };
}
