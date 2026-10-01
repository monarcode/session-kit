import type { StandardSchemaV1 } from '@standard-schema/spec';
import { AuthError } from './errors.js';
import type { Tokens, User } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rejects values that JSON would silently drop or change, then deep-freezes the
 * value so callers cannot mutate auth state without notifying subscribers.
 */
function freezeJson(value: unknown, ancestors = new Set<object>()): void {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	)
		return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (typeof value !== "object" || value === null || ancestors.has(value)) {
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"User must contain only JSON values",
		);
	}
	const proto = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"User must contain plain objects",
		);
	}
	ancestors.add(value);
	if (Array.isArray(value)) {
		if (Object.keys(value).length !== value.length) {
			throw new AuthError(
				"USER_VALIDATION_FAILED",
				"User arrays must be dense",
			);
		}
		for (const item of value) freezeJson(item, ancestors);
	} else {
		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
			if (
				typeof key !== "string" ||
				!descriptor.enumerable ||
				!("value" in descriptor)
			) {
				throw new AuthError(
					"USER_VALIDATION_FAILED",
					"User properties must be plain JSON data",
				);
			}
			freezeJson(descriptor.value, ancestors);
		}
	}
	ancestors.delete(value);
	Object.freeze(value);
}

export async function validateUser<S extends StandardSchemaV1>(
	schema: S,
	input: unknown,
): Promise<User<S>> {
	try {
		const result = await schema["~standard"].validate(
			structuredClone(input),
		);
		if (result.issues) {
			throw new AuthError(
				"USER_VALIDATION_FAILED",
				"Invalid user",
				undefined,
				result.issues,
			);
		}
		if (!isRecord(result.value)) {
			throw new AuthError(
				"USER_VALIDATION_FAILED",
				"User must be an object",
			);
		}
		freezeJson(result.value);
		return result.value;
	} catch (cause) {
		if (cause instanceof AuthError) throw cause;
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"User validation failed",
			{ cause },
		);
	}
}

function jwtExpiry(token: string): number | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const bytes = Uint8Array.from(
			atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
			(c) => c.charCodeAt(0),
		);
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (
			isRecord(payload) &&
			typeof payload.exp === "number" &&
			Number.isFinite(payload.exp * 1000)
		) {
			return payload.exp * 1000;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function validateTokens(value: unknown): Tokens {
	if (
		!isRecord(value) ||
		typeof value.accessToken !== "string" ||
		!value.accessToken.trim()
	) {
		throw new AuthError(
			"INVALID_SESSION",
			"A nonempty access token is required",
		);
	}
	if (
		value.refreshToken !== undefined &&
		(typeof value.refreshToken !== "string" || !value.refreshToken.trim())
	) {
		throw new AuthError(
			"INVALID_SESSION",
			"Refresh token must be a nonempty string",
		);
	}
	if (
		value.expiresAt !== undefined &&
		(typeof value.expiresAt !== "number" ||
			!Number.isFinite(value.expiresAt) ||
			value.expiresAt <= 0)
	) {
		throw new AuthError(
			"INVALID_SESSION",
			"expiresAt must be positive Unix milliseconds",
		);
	}
	return {
		accessToken: value.accessToken,
		refreshToken: value.refreshToken,
		expiresAt: value.expiresAt ?? jwtExpiry(value.accessToken),
	};
}

/**
 * Runs `work` with a signal tied to `parent` and a timeout. Rejects on abort or
 * timeout even when `work` ignores the signal, so late results never commit.
 */
export function runTask<T>(
	work: (signal: AbortSignal) => Promise<T>,
	parent: AbortSignal,
	timeoutMs = 15_000,
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
