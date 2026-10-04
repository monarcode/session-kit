/** Deadline for validation and refresh work. */
const TASK_TIMEOUT_MS = 15_000;

/**
 * Runs `work` with a signal tied to `parent` and a timeout. Rejects on abort or
 * timeout even when `work` ignores the signal, so late results never commit.
 */
export function runTask<T>(
	work: (signal: AbortSignal) => Promise<T>,
	parent: AbortSignal,
	timeoutMs = TASK_TIMEOUT_MS,
): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	parent.addEventListener("abort", abort, { once: true });
	if (parent.aborted) abort();
	const timer = setTimeout(
		() => controller.abort(new Error("Auth operation timed out")),
		timeoutMs,
	);
	return new Promise<T>((resolve, reject) => {
		const fail = () => reject(controller.signal.reason);
		controller.signal.addEventListener("abort", fail, { once: true });
		if (controller.signal.aborted) fail();
		else
			Promise.resolve()
				.then(() => {
					controller.signal.throwIfAborted();
					return work(controller.signal);
				})
				.then(resolve, reject);
	}).finally(() => {
		clearTimeout(timer);
		parent.removeEventListener("abort", abort);
	});
}
