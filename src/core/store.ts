import type { ReadableAtom } from "nanostores";

/**
 * Starts work nobody awaits. Its failures are already published to
 * `state.error`, or are `SESSION_CHANGED` from work a newer session superseded.
 */
export function inBackground(work: Promise<unknown>): void {
	work.catch(() => {});
}

/**
 * A client's `state` over `store`: `get`, and `subscribe` to later changes.
 * `listen`, not nanostores' `subscribe`, which also calls the listener with
 * the current value.
 */
export function stateView<T>(store: ReadableAtom<T>) {
	return {
		get: store.get,
		subscribe: (listener: (state: T) => void) => ({
			unsubscribe: store.listen((value) => {
				try {
					listener(value as T);
				} catch (error) {
					// A failing listener must not interrupt the change.
					queueMicrotask(() => {
						throw error;
					});
				}
			}),
		}),
	};
}

/**
 * Counts a client's mounts: `start` runs on the first and the stop it returns
 * on the last unmount. Each unmount counts once, however often it's called.
 */
export function countMounts(start: () => () => void) {
	let count = 0;
	let stop: (() => void) | undefined;
	return {
		get count() {
			return count;
		},
		mount(): () => void {
			if (count++ === 0) stop = start();
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				if (--count > 0) return;
				const stopping = stop;
				stop = undefined;
				stopping?.();
			};
		},
	};
}
