/**
 * Steps that may or may not be asynchronous. Storage, schemas, and token
 * decoders may each answer at once or return a promise; chaining them with
 * these helpers keeps one implementation that finishes synchronously when
 * every step does, as restoring a session before the first render needs.
 */
export type MaybePromise<T> = T | Promise<T>;

/** Whether `value` is a promise or another thenable. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/** Runs `step` on `value`'s result: at once unless `value` is a promise. */
export function chain<T, R>(
	value: T | PromiseLike<T>,
	step: (value: T) => MaybePromise<R>,
): MaybePromise<R> {
	return isThenable(value)
		? Promise.resolve(value).then(step)
		: step(value as T);
}

/**
 * Runs `work`, sending both a synchronous throw and an asynchronous rejection
 * to `fail`, which may recover or throw.
 */
export function attempt<T>(
	work: () => MaybePromise<T>,
	fail: (cause: unknown) => MaybePromise<T>,
): MaybePromise<T> {
	let result: MaybePromise<T>;
	try {
		result = work();
	} catch (cause) {
		return fail(cause);
	}
	return isThenable(result) ? Promise.resolve(result).catch(fail) : result;
}
