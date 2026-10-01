import { AuthError } from "./errors.js";
import type { Tokens } from "./types.js";
import { isRecord, validateTokens } from "./validation.js";

export type StoredSession = Tokens & { id: string; user: unknown };

export function createPersistence(name: string, maxAge = 30 * 24 * 60 * 60) {
	if (
		!/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
		!Number.isSafeInteger(maxAge) ||
		maxAge <= 0
	) {
		throw new Error(
			"Use a simple auth name and a positive maxAge in seconds",
		);
	}
	const tokensKey = `${name}:auth:tokens`;
	const userKey = `${name}:auth:user`;

	function storageOperation<T>(work: () => T): T {
		try {
			return work();
		} catch (cause) {
			if (cause instanceof AuthError) throw cause;
			throw new AuthError(
				"PERSISTENCE_FAILED",
				"Auth storage is unavailable",
				{
					cause,
				},
			);
		}
	}

	function clear() {
		storageOperation(() => {
			const failures: unknown[] = [];
			for (const key of [tokensKey, userKey]) {
				try {
					localStorage.removeItem(key);
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length)
				throw new AggregateError(failures, "Could not clear auth storage");
		});
	}

	function read(): StoredSession | null {
		return storageOperation(() => {
			const tokensText = localStorage.getItem(tokensKey);
			if (!tokensText) {
				localStorage.removeItem(userKey);
				return null;
			}
			const userText = localStorage.getItem(userKey);
			try {
				const tokens: unknown = JSON.parse(tokensText);
				const profile: unknown = userText ? JSON.parse(userText) : null;
				if (
					!isRecord(tokens) ||
					!isRecord(profile) ||
					tokens.v !== 2 ||
					profile.v !== 2 ||
					typeof tokens.id !== "string" ||
					!tokens.id ||
					typeof tokens.writeId !== "string" ||
					tokens.id !== profile.id ||
					tokens.writeId !== profile.writeId ||
					typeof tokens.persistUntil !== "number" ||
					!Number.isFinite(tokens.persistUntil) ||
					tokens.persistUntil <= Date.now()
				) {
					throw new Error("Missing, expired, or mismatched auth data");
				}
				if (localStorage.getItem(tokensKey) !== tokensText)
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
			localStorage.setItem(
				userKey,
				JSON.stringify({ v: 2, id: session.id, writeId, user }),
			);
			localStorage.setItem(
				tokensKey,
				JSON.stringify({
					v: 2,
					...tokens,
					writeId,
					persistUntil: Date.now() + maxAge * 1000,
				}),
			);
		});
	}
	return { read, write, clear };
}
