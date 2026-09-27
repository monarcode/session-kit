import { AuthError } from './errors.js';
import type { Tokens } from './types.js';
import { isRecord, validateTokens } from './validation.js';

export type StoredSession = Tokens & { id: string; user: unknown };

export function createPersistence(name: string, maxAge = 30 * 24 * 60 * 60) {
	if (
		!/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
		!Number.isSafeInteger(maxAge) ||
		maxAge <= 0
	) {
		throw new Error(
			"Use a simple auth name and a positive cookieMaxAge in seconds",
		);
	}
	const cookieName = `${name}_auth`;
	const userKey = `${name}:auth:user`;
	const attributes = () =>
		`; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
	const readCookie = () =>
		document.cookie
			.split("; ")
			.find((part) => part.startsWith(`${cookieName}=`))
			?.slice(cookieName.length + 1);

	function storageOperation<T>(work: () => T): T {
		try {
			return work();
		} catch (cause) {
			if (cause instanceof AuthError) throw cause;
			throw new AuthError(
				"PERSISTENCE_FAILED",
				"Auth storage is unavailable",
				{ cause },
			);
		}
	}

	function clear() {
		storageOperation(() => {
			// Attempt both, even if one fails. Surface failure to the caller.
			const failures: unknown[] = [];
			try {
				document.cookie = `${cookieName}=; Max-Age=0${attributes()}`;
				if (readCookie() !== undefined)
					throw new Error("Cookie deletion was blocked");
			} catch (error) {
				failures.push(error);
			}
			try {
				localStorage.removeItem(userKey);
			} catch (error) {
				failures.push(error);
			}
			if (failures.length)
				throw new AggregateError(
					failures,
					"Could not clear auth storage",
				);
		});
	}

	function read(): StoredSession | null {
		return storageOperation(() => {
			const cookie = readCookie();
			if (!cookie) {
				localStorage.removeItem(userKey);
				return null;
			}
			const userText = localStorage.getItem(userKey);
			try {
				const tokens: unknown = JSON.parse(decodeURIComponent(cookie));
				const profile: unknown = userText ? JSON.parse(userText) : null;
				if (
					!isRecord(tokens) ||
					!isRecord(profile) ||
					tokens.v !== 1 ||
					profile.v !== 1 ||
					typeof tokens.id !== "string" ||
					!tokens.id ||
					typeof tokens.writeId !== "string" ||
					tokens.id !== profile.id ||
					tokens.writeId !== profile.writeId ||
					typeof tokens.persistUntil !== "number" ||
					!Number.isFinite(tokens.persistUntil) ||
					tokens.persistUntil <= Date.now()
				) {
					throw new Error(
						"Missing, expired, or mismatched auth data",
					);
				}
				// A second read detects a cookie change during the profile read.
				if (readCookie() !== cookie)
					throw new Error("Auth storage changed while reading");
				return {
					...validateTokens(tokens),
					id: tokens.id,
					user: profile.user,
				};
			} catch (cause) {
				throw new AuthError(
					"INVALID_SESSION",
					"Saved session cannot be restored",
					{ cause },
				);
			}
		});
	}

	function write(session: StoredSession) {
		storageOperation(() => {
			const { user, ...tokens } = session;
			const writeId = crypto.randomUUID();
			const value = encodeURIComponent(
				JSON.stringify({
					v: 1,
					...tokens,
					writeId,
					persistUntil: Date.now() + maxAge * 1000,
				}),
			);
			if (cookieName.length + value.length > 3800)
				throw new Error("Auth tokens exceed the cookie size budget");
			localStorage.setItem(
				userKey,
				JSON.stringify({ v: 1, id: session.id, writeId, user }),
			);
			document.cookie = `${cookieName}=${value}; Max-Age=${maxAge}${attributes()}`;
			if (readCookie() !== value)
				throw new Error("Cookie write was blocked");
		});
	}
	return { read, write, clear };
}
