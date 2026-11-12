import { AuthError } from "./errors.js";
import type { AuthClient, Session } from "./types.js";

/** What route guards need from an auth client with user `U`. */
export type GuardClient<U> = Pick<
	AuthClient<U, unknown>,
	"getSession" | "isCurrent"
>;

/** How many times a guard reads a changing session before giving up. */
const MAX_ATTEMPTS = 3;

/**
 * The signed-in session for a guard, or `null`. A session that changes while
 * it is read, whether `getSession` rejects with `SESSION_CHANGED` or resolves
 * a session no longer current, is read again: the change re-runs guards
 * anyway, so an error would only flash. A locked session reads as signed
 * out: locking is for native apps, and the router adapters don't unlock.
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
			if (error instanceof AuthError && error.code === "LOCKED") return null;
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
