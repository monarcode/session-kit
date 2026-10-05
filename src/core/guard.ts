import { AuthError } from "./errors.js";
import type { AuthClient, Session } from "./types.js";

/** What route guards need from an auth client with user `U`. */
export type GuardClient<U> = Pick<
	AuthClient<U, unknown>,
	"getSession" | "isCurrent"
>;

/** How often a guard reads the session again when it changes mid-check. */
const MAX_ATTEMPTS = 3;

/**
 * The signed-in session for a guard, or `null`. A session that changes while
 * it is read, whether `getSession` rejects with `SESSION_CHANGED` or resolves
 * a session no longer current, is read again: the change re-runs guards
 * anyway, so an error would only flash.
 */
export async function guardSession<U>(
	auth: GuardClient<U>,
): Promise<Session<U> | null> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		let session: Session<U> | null;
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
	auth: GuardClient<unknown>,
): Promise<Session<unknown> | null> {
	try {
		return await auth.getSession();
	} catch {
		return null;
	}
}
