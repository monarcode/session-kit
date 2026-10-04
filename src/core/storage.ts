/** A value, or a promise of it, so storage can be synchronous or not. */
type MaybePromise<T> = T | Promise<T>;

/**
 * Where auth saves the session. Values are strings whose format auth owns.
 * Operations may return promises; auth applies them one at a time, in the
 * order it issued them, so storage that settles out of order is safe.
 */
export type AuthStorage = {
	get: (key: string) => MaybePromise<string | null>;
	/**
	 * `meta.expiresAt` is when auth stops restoring the saved session, in Unix
	 * milliseconds, for storage that can expire entries itself.
	 */
	set: (
		key: string,
		value: string,
		meta: { expiresAt: number },
	) => MaybePromise<void>;
	remove: (key: string) => MaybePromise<void>;
	/**
	 * Calls `onChange` when another context, such as another tab, changes `key`,
	 * and returns a function that stops listening. Omit it where no other
	 * context shares the storage.
	 */
	subscribe?: (key: string, onChange: () => void) => () => void;
	/**
	 * Runs `work` while holding lock `name` across every context sharing this
	 * storage, so only one spends a refresh token at a time. Aborting `signal`
	 * stops waiting for the lock. Omit it where no other context shares the
	 * storage.
	 */
	lock?: <T>(
		name: string,
		signal: AbortSignal,
		work: () => Promise<T>,
	) => Promise<T>;
};

export type WebStorageOptions = {
	/**
	 * `"local"` keeps the session across browser restarts and shares it with
	 * every tab. `"session"` gives each tab its own session, which ends with the
	 * tab. Default: `"local"`.
	 */
	area?: "local" | "session";
};

/**
 * Saves the session in `localStorage`, or in `sessionStorage` with
 * `{ area: "session" }`. Tabs follow each other's changes through `storage`
 * events, and coordinate refresh through Web Locks where the browser has them.
 * Browser storage is read only when used, so creating auth on a server is safe.
 */
export function webStorage(options: WebStorageOptions = {}): AuthStorage {
	const area = options.area ?? "local";
	if (area !== "local" && area !== "session") {
		throw new Error(`webStorage area must be "local" or "session": ${area}`);
	}
	const target = () =>
		area === "local" ? globalThis.localStorage : globalThis.sessionStorage;
	return {
		get: (key) => target().getItem(key),
		set: (key, value) => target().setItem(key, value),
		remove: (key) => target().removeItem(key),
		subscribe(key, onChange) {
			if (typeof globalThis.addEventListener !== "function") return () => {};
			const onStorage = (event: Event) => {
				// A `null` key means the whole area was cleared.
				const changed = (event as StorageEvent).key;
				if (changed === key || changed === null) onChange();
			};
			globalThis.addEventListener("storage", onStorage);
			return () => globalThis.removeEventListener("storage", onStorage);
		},
		lock(name, signal, work) {
			const locks = globalThis.navigator?.locks;
			if (!locks) return work();
			return locks.request(name, { signal }, work);
		},
	};
}

/**
 * Keeps the session in memory, so it ends when the page unloads and other tabs
 * never see it. Useful in tests, and where credentials must not be persisted.
 */
export function memoryStorage(): AuthStorage {
	const entries = new Map<string, string>();
	return {
		get: (key) => entries.get(key) ?? null,
		set(key, value) {
			entries.set(key, value);
		},
		remove(key) {
			entries.delete(key);
		},
	};
}
