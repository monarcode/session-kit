/** Deadline for validation and refresh work. */
const TASK_TIMEOUT_MS = 15_000;

/**
 * Why each signal was aborted. React Native before 0.87 polyfills
 * `AbortController` without `reason` or `throwIfAborted`, so the client
 * keeps the reason itself rather than read it back from the signal.
 */
const reasons = new WeakMap<AbortSignal, unknown>();

/** Aborts `controller` with `reason`, which {@link abortReason} returns. */
export function abortWith(controller: AbortController, reason: unknown) {
	if (!controller.signal.aborted) reasons.set(controller.signal, reason);
	controller.abort(reason);
}

/** Why `signal` was aborted, on every platform. */
export function abortReason(signal: AbortSignal): unknown {
	return reasons.has(signal) ? reasons.get(signal) : signal.reason;
}

/**
 * Runs `work` with a signal tied to `parent` and a timeout. Rejects on abort or
 * timeout even when `work` ignores the signal, so late results never commit.
 */
export function runTask<T>(
	work: (signal: AbortSignal) => T | PromiseLike<T>,
	parent: AbortSignal,
	timeoutMs = TASK_TIMEOUT_MS,
): Promise<T> {
	const controller = new AbortController();
	const { signal } = controller;
	const abort = () => abortWith(controller, abortReason(parent));
	parent.addEventListener("abort", abort, { once: true });
	if (parent.aborted) abort();
	const timer = setTimeout(
		() => abortWith(controller, new Error("Auth operation timed out")),
		timeoutMs,
	);
	return new Promise<T>((resolve, reject) => {
		const fail = () => reject(abortReason(signal));
		signal.addEventListener("abort", fail, { once: true });
		if (signal.aborted) fail();
		else
			Promise.resolve()
				.then(() => {
					if (signal.aborted) throw abortReason(signal);
					return work(signal);
				})
				.then(resolve, reject);
	}).finally(() => {
		clearTimeout(timer);
		parent.removeEventListener("abort", abort);
	});
}
