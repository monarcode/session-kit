import { AuthError } from "./errors.js";

/** A value, or a promise of it, so storage can be synchronous or not. */
type MaybePromise<T> = T | Promise<T>;

/**
 * Where auth saves the session, passed as `createAuth`'s `storage` option.
 * Values are strings whose format auth owns. Operations may return promises;
 * auth applies them one at a time, in the order it issued them, so storage
 * that settles out of order is safe. Use {@link webStorage} in browsers,
 * `secureStorage()` from `@monarcode/session-kit/expo` in Expo apps, and
 * {@link memoryStorage} in tests, or implement it for another store.
 *
 * @example
 * ```ts
 * import { createAuth, type AuthStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * declare const store: {
 * 	get(key: string): Promise<string | undefined>;
 * 	put(key: string, value: string): Promise<void>;
 * 	delete(key: string): Promise<void>;
 * };
 *
 * const storage: AuthStorage = {
 * 	get: async (key) => (await store.get(key)) ?? null,
 * 	set: (key, value) => store.put(key, value),
 * 	remove: (key) => store.delete(key),
 * };
 *
 * export const auth = createAuth({
 * 	name: "my-app",
 * 	user: z.object({ id: z.string() }),
 * 	storage,
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthStorage = {
	/**
	 * The value saved under `key`, or `null` when there is none. Answering
	 * synchronously lets auth restore a saved session before the first render.
	 */
	get: (key: string) => MaybePromise<string | null>;
	/**
	 * Saves `value` under `key`. `meta.expiresAt` is when auth stops restoring
	 * the saved session, in Unix milliseconds, for storage that can expire
	 * entries itself.
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
	subscribe?: ((key: string, onChange: () => void) => () => void) | undefined;
	/**
	 * Runs `work` while holding lock `name` across every context sharing this
	 * storage, so only one spends a refresh token at a time. Aborting `signal`
	 * stops waiting for the lock. Omit it where no other context shares the
	 * storage.
	 */
	lock?:
		| (<T>(
				name: string,
				signal: AbortSignal,
				work: () => Promise<T>,
		  ) => Promise<T>)
		| undefined;
	/**
	 * Called by each `createAuth` whose `debug` option is on, with the key it
	 * saves under and a function that adds the adapter's own events about that
	 * key, such as why it discarded a saved value, to that auth's debug log.
	 * One adapter can serve several auth names, so keep a function per key.
	 * `sensitive` says whether saved values may appear in `data`.
	 */
	debug?:
		| ((
				key: string,
				report: (message: string, data?: Record<string, unknown>) => void,
				sensitive: boolean,
		  ) => void)
		| undefined;
};

/**
 * Options for {@link webStorage}.
 *
 * @example
 * ```ts
 * import type { WebStorageOptions } from "@monarcode/session-kit";
 *
 * const options: WebStorageOptions = { area: "session" };
 * ```
 *
 * @since 0.1.0
 */
export type WebStorageOptions = {
	/**
	 * `"local"` keeps the session across browser restarts and shares it with
	 * every tab. `"session"` gives each tab its own session, which ends with the
	 * tab; avoid it with rotating refresh tokens, since a duplicated tab starts
	 * with the same one. Default: `"local"`.
	 */
	area?: "local" | "session" | undefined;
};

/**
 * Saves the session in `localStorage`, or in `sessionStorage` with
 * `{ area: "session" }`; see {@link WebStorageOptions}. Tabs follow each
 * other's changes through `storage` events, and coordinate refresh through Web
 * Locks where the browser has them. Browser storage is read only when used, so
 * creating auth on a server is safe; reading the session there fails with
 * `PERSISTENCE_FAILED`.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * export const auth = createAuth({
 * 	name: "my-app",
 * 	user: z.object({ id: z.string(), email: z.string() }),
 * 	storage: webStorage(),
 * });
 * ```
 *
 * @since 0.1.0
 */
export function webStorage(options: WebStorageOptions = {}): AuthStorage {
	const area = options.area ?? "local";
	if (area !== "local" && area !== "session") {
		throw new AuthError(
			"INVALID_OPTIONS",
			`webStorage area must be "local" or "session": ${area}`,
		);
	}
	const target = () => {
		const storage =
			area === "local" ? globalThis.localStorage : globalThis.sessionStorage;
		// Missing entirely means code is running outside a browser, such as a
		// server rendering a route whose guard needs the saved session.
		if (!storage) {
			throw new AuthError(
				"PERSISTENCE_FAILED",
				`${area}Storage is not available here. Sessions live in the browser, so run auth in browser code; in TanStack Start, set defaultSsr: false.`,
			);
		}
		return storage;
	};
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
 * never see it. Each call has its own entries. Useful in tests, and where
 * credentials must not be persisted. See {@link AuthStorage}.
 *
 * @example
 * ```ts
 * import { createAuth, memoryStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * export const auth = createAuth({
 * 	name: "test",
 * 	user: z.object({ id: z.string() }),
 * 	storage: memoryStorage(),
 * });
 * ```
 *
 * @since 0.1.0
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
