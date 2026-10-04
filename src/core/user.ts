import type { StandardSchemaV1 } from "@standard-schema/spec";

import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import type { User } from "./types.js";

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
		const result = await schema["~standard"].validate(structuredClone(input));
		if (result.issues) {
			throw new AuthError("USER_VALIDATION_FAILED", "Invalid user", {
				issues: result.issues,
			});
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
		throw new AuthError("USER_VALIDATION_FAILED", "User validation failed", {
			cause,
		});
	}
}

/**
 * Whether two validated users hold the same data. Both are JSON produced by
 * the same schema, so serialization compares them reliably.
 */
export function sameUser(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
