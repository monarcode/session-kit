import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";

/**
 * Copies `value` as deeply frozen JSON, rejecting values JSON would drop or
 * change. Auth state then cannot be mutated without notifying subscribers,
 * and data the caller still holds is never frozen.
 */
function frozenJson(value: unknown, ancestors = new Set<object>()): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	)
		return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "object" || ancestors.has(value)) {
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
	let copy: unknown[] | Record<string, unknown>;
	if (Array.isArray(value)) {
		if (Object.keys(value).length !== value.length) {
			throw new AuthError(
				"USER_VALIDATION_FAILED",
				"User arrays must be dense",
			);
		}
		copy = value.map((item) => frozenJson(item, ancestors));
	} else {
		copy = {};
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
			// Defined, not assigned, so a `__proto__` key stays an ordinary key.
			Object.defineProperty(copy, key, {
				value: frozenJson(descriptor.value, ancestors),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
	}
	ancestors.delete(value);
	return Object.freeze(copy);
}

/** Accepts a plain JSON object as the user, returning a frozen copy. */
export function toUser(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new AuthError("USER_VALIDATION_FAILED", "User must be an object");
	}
	return frozenJson(value) as Record<string, unknown>;
}

export async function validateUser<S extends StandardSchemaV1>(
	schema: S,
	input: unknown,
): Promise<StandardSchemaV1.InferOutput<S>> {
	try {
		const result = await schema["~standard"].validate(input);
		if (result.issues) {
			throw new AuthError("USER_VALIDATION_FAILED", "Invalid user", {
				issues: result.issues,
			});
		}
		return toUser(result.value);
	} catch (cause) {
		if (cause instanceof AuthError) throw cause;
		throw new AuthError("USER_VALIDATION_FAILED", "User validation failed", {
			cause,
		});
	}
}

/**
 * Validates a user that is about to be saved. Restoring validates the saved
 * output again, so the schema must accept its own output and return it
 * unchanged; otherwise users would be signed out on their next reload.
 */
export async function validateNewUser<S extends StandardSchemaV1>(
	schema: S,
	input: unknown,
): Promise<StandardSchemaV1.InferOutput<S>> {
	const user = await validateUser(schema, input);
	let again: unknown;
	try {
		again = await validateUser(schema, user);
	} catch (cause) {
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"The user schema must accept its own output, because saved users are validated again when restored",
			{
				cause,
				issues: cause instanceof AuthError ? cause.issues : undefined,
			},
		);
	}
	if (!sameUser(user, again)) {
		throw new AuthError(
			"USER_VALIDATION_FAILED",
			"The user schema must return its own output unchanged, because saved users are validated again when restored",
		);
	}
	return user;
}

/**
 * Whether two validated users hold the same data. Both are JSON produced by
 * the same source, so serialization compares them reliably.
 */
export function sameUser(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
