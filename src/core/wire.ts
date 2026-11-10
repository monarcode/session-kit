import { AuthError } from "./errors.js";
import { isRecord } from "./json.js";
import type { ClientCredentials } from "./mirror.js";
import type { Credentials, Session } from "./types.js";
import { toUser } from "./user.js";

// What passes between `createServerAuth` and `createMirrorAuth` through the
// app's own functions: the session, and the access token for page scripts.

/** Checks a session from the app's function, returning a frozen copy. */
export function readSession<U>(value: unknown): Session<U> | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		!isRecord(value.user)
	)
		throw new AuthError(
			"INVALID_SESSION",
			"Expected a session, { sessionId, user }, or null from the server",
		);
	return Object.freeze({
		sessionId: value.sessionId,
		user: toUser(value.user) as U,
	});
}

/** `credentials` for page scripts: seconds left rather than a time, since clocks differ. */
export function toClientCredentials(
	credentials: Credentials | null,
): ClientCredentials | null {
	if (!credentials) return null;
	return Object.freeze({
		sessionId: credentials.sessionId,
		accessToken: credentials.accessToken,
		expiresIn:
			credentials.expiresAt === undefined
				? undefined
				: Math.max(0, (credentials.expiresAt - Date.now()) / 1000),
	});
}

/**
 * Reads what `toClientCredentials` sent, timing the expiry from now, or
 * `null` when the server had no session. Throws `INVALID_SESSION` for
 * anything else.
 */
export function readClientCredentials(value: unknown): Credentials | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		typeof value.accessToken !== "string" ||
		!value.accessToken ||
		(value.expiresIn !== undefined &&
			(typeof value.expiresIn !== "number" ||
				!Number.isFinite(value.expiresIn) ||
				value.expiresIn < 0))
	)
		throw new AuthError(
			"INVALID_SESSION",
			"Expected { sessionId, accessToken, expiresIn } or null from the server",
		);
	return Object.freeze({
		sessionId: value.sessionId,
		accessToken: value.accessToken,
		expiresAt:
			value.expiresIn === undefined
				? undefined
				: Date.now() + value.expiresIn * 1000,
	});
}

/**
 * Reads the credentials the browser says the backend rejected. Throws
 * `INVALID_OPTIONS` for anything but a session ID and an access token.
 */
export function readRejected(value: unknown): Credentials {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		typeof value.accessToken !== "string"
	)
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass the sessionId and accessToken the browser was given",
		);
	return { sessionId: value.sessionId, accessToken: value.accessToken };
}
