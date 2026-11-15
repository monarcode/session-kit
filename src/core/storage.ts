import { AuthError } from "./errors.js";

/** A value, or a promise of it, so storage can be synchronous or not. */
type MaybePromise<T> = T | Promise<T>;

/**
 * Where auth saves the session: `createAuth`'s `storage` option. Use
 * {@link webStorage} in browsers, `secureStorage()` from
 * `@monarcode/session-kit/expo` in Expo apps, and {@link memoryStorage} in
 * tests. Implement it yourself for another store.
 *
 * Values are strings in a format auth owns. Methods may return promises. Auth
 * runs them one at a time, in order, so a store that answers out of order is
 * still safe.
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
	 * Returns the value saved under `key`, or `null` when there's none. If it
	 * answers synchronously, a saved session shows before the first render.
	 */
	get: (key: string) => MaybePromise<string | null>;
	/**
	 * Saves `value` under `key`. `meta.expiresAt` is when the saved session
	 * stops being valid, in Unix milliseconds, for a store that can expire
	 * entries itself.
	 */
	set: (
		key: string,
		value: string,
		meta: { expiresAt: number },
	) => MaybePromise<void>;
	/** Removes the value saved under `key`. */
	remove: (key: string) => MaybePromise<void>;
	/**
	 * Calls `onChange` when another tab changes `key`, and returns a function
	 * that stops listening. Leave it out when nothing else shares the store.
	 */
	subscribe?: ((key: string, onChange: () => void) => () => void) | undefined;
	/**
	 * Runs `work` while holding the lock `name` in every tab that shares the
	 * store, so only one tab refreshes at a time. Aborting `signal` stops
	 * waiting for the lock. Leave it out when nothing else shares the store.
	 */
	lock?:
		| (<T>(
				name: string,
				signal: AbortSignal,
				work: () => Promise<T>,
		  ) => Promise<T>)
		| undefined;
	/**
	 * Lets your adapter add its own events to the debug log, such as why it
	 * discarded a saved value.
	 *
	 * Each `createAuth` with `debug` on calls it with the key it saves under
	 * and a `report` function for that key. One adapter can serve several
	 * auths, so keep a `report` per key. `sensitive` says whether saved values
	 * may appear in `data`.
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
	 * Which browser storage to use. `"local"` keeps the session across browser
	 * restarts and shares it with every tab. `"session"` gives each tab its own
	 * session, which ends with the tab.
	 *
	 * Avoid `"session"` with rotating refresh tokens. A duplicated tab starts
	 * with the same refresh token, and the first to use it signs the other
	 * out.
	 * @default "local"
	 */
	area?: "local" | "session" | undefined;
};

/**
 * Saves the session in the browser's `localStorage`, or in `sessionStorage`
 * with `{ area: "session" }`. With `localStorage`, tabs follow each other's
 * changes, such as a sign-out. Tabs take turns to refresh where the browser
 * supports Web Locks.
 *
 * It touches browser storage only when auth reads or saves, so creating auth
 * in code that also runs on a server is safe. Reading the session on a server
 * fails with `PERSISTENCE_FAILED`.
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
 * Keeps the session in memory only. It ends when the page unloads, and other
 * tabs never see it. Use it in tests, or where tokens must never be written
 * to disk. Each call has its own entries.
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
