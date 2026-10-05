import { webStorage, type AuthStorage } from "@monarcode/session-kit";

/**
 * Settles every operation after some microtasks, removals last by default, as
 * asynchronous storage can. Operations issued in order would then complete
 * out of order unless auth waits for each one.
 */
export const deferredStorage = (
	inner: AuthStorage,
	delays: Partial<Record<"get" | "set" | "remove", number>> = {},
): AuthStorage => {
	const ticks = { get: 1, set: 2, remove: 3, ...delays };
	const after = async <T>(
		count: number,
		operation: () => T | Promise<T>,
	): Promise<T> => {
		for (let tick = 0; tick < count; tick++) await Promise.resolve();
		return operation();
	};
	return {
		get: (key) => after(ticks.get, () => inner.get(key)),
		set: (key, value, meta) =>
			after(ticks.set, () => inner.set(key, value, meta)),
		remove: (key) => after(ticks.remove, () => inner.remove(key)),
		subscribe: inner.subscribe,
		lock: inner.lock,
	};
};

/**
 * `pnpm test` runs the suite twice: with the default synchronous storage, and
 * with `async-storage.env` setting `SESSION_KIT_TEST_STORAGE` so every client
 * defers its storage.
 */
export const testStorage = (): AuthStorage =>
	process.env.SESSION_KIT_TEST_STORAGE === "async"
		? deferredStorage(webStorage())
		: webStorage();
