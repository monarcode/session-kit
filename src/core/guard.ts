import { AuthError } from "./errors.js";

/** What route guards need from an auth client. */
export type GuardClient<S extends { sessionId: string }> = {
	getSession: () => Promise<S | null>;
	isCurrent: (session: { sessionId: string }) => boolean;
};

/** How often a guard reads the session again when it changes mid-check. */
const MAX_ATTEMPTS = 3;

/**
 * The signed-in session for a guard, or `null`. A session that changes while
 * it is read, whether `getSession` rejects with `SESSION_CHANGED` or resolves
 * a session no longer current, is read again: the change re-runs guards
 * anyway, so an error would only flash.
 */
export async function guardSession<S extends { sessionId: string }>(
	auth: GuardClient<S>,
): Promise<S | null> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		let session: S | null;
		try {
			session = await auth.getSession();
		} catch (error) {
			if (error instanceof AuthError && error.code === "SESSION_CHANGED")
				continue;
			throw error;
		}
		if (!session || auth.isCurrent(session)) return session;
	}
	throw new AuthError(
		"SESSION_CHANGED",
		"The session kept changing; retry navigation",
	);
}

/** The session, or `null` when it cannot be resolved, for sign-in pages. */
export async function sessionOrNull(
	auth: GuardClient<{ sessionId: string }>,
): Promise<{ sessionId: string } | null> {
	try {
		return await auth.getSession();
	} catch {
		return null;
	}
}
