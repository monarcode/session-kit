import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import type { Tokens } from "./types.js";

/** Session tokens with `expiresAt` measured on this browser's clock. */
export type SessionTokens = Omit<Tokens, "expiresIn">;

/** Copies only the token fields, dropping a stored session's other data. */
export function tokensOf(saved: SessionTokens): SessionTokens {
	return {
		accessToken: saved.accessToken,
		refreshToken: saved.refreshToken,
		expiresAt: saved.expiresAt,
	};
}

/**
 * A JWT's payload, decoded without verifying its signature, or `undefined`
 * when `token` is not a JWT with a JSON object payload.
 */
export function decodeJwtPayload(
	token: string,
): Record<string, unknown> | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const bytes = Uint8Array.from(
			atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
			(c) => c.charCodeAt(0),
		);
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

function jwtClaims(token: string): { exp?: number; iat?: number } {
	const payload = decodeJwtPayload(token);
	if (!payload) return {};
	const seconds = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value * 1000)
			? value
			: undefined;
	return { exp: seconds(payload.exp), iat: seconds(payload.iat) };
}

function positive(value: unknown, message: string): number | undefined {
	if (
		value !== undefined &&
		(typeof value !== "number" || !Number.isFinite(value) || value <= 0)
	) {
		throw new AuthError("INVALID_SESSION", message);
	}
	return value;
}

/** Checks token shape and an explicit `expiresAt`. Restores saved sessions as-is. */
export function validateTokens(value: unknown): SessionTokens {
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
	return {
		accessToken: value.accessToken,
		refreshToken: value.refreshToken,
		expiresAt: positive(
			value.expiresAt,
			"expiresAt must be positive Unix milliseconds",
		),
	};
}

/**
 * Accepts newly issued tokens. Lifetimes are measured from receipt so a skewed
 * browser clock cannot expire them early: `expiresIn`, then JWT `exp - iat`.
 * Only explicit `expiresAt` and JWT `exp` without `iat` use absolute time.
 */
export function receiveTokens(value: unknown): SessionTokens {
	const tokens = validateTokens(value);
	const expiresIn = positive(
		isRecord(value) ? value.expiresIn : undefined,
		"expiresIn must be positive seconds",
	);
	if (expiresIn !== undefined && tokens.expiresAt !== undefined) {
		throw new AuthError(
			"INVALID_SESSION",
			"Provide expiresAt or expiresIn, not both",
		);
	}
	if (tokens.expiresAt !== undefined) return tokens;
	if (expiresIn !== undefined)
		return { ...tokens, expiresAt: Date.now() + expiresIn * 1000 };
	const { exp, iat } = jwtClaims(tokens.accessToken);
	if (exp === undefined) return tokens;
	return {
		...tokens,
		expiresAt:
			iat !== undefined && exp > iat
				? Date.now() + (exp - iat) * 1000
				: exp * 1000,
	};
}
