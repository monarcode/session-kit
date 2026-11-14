import { createMirrorAuth, type SessionOf } from "@monarcode/session-kit";

// Types only: erased from the browser's bundle.
import type { serverAuth } from "./session.server";

export type AppSession = SessionOf<typeof serverAuth>;

/**
 * The client the components use. It mirrors the session the server keeps in
 * its cookie, starting from the one the root loader read, and calls the
 * session route in `routes/auth.session.ts`. `useMirrorAuth` creates it,
 * once per request on the server and once in the browser.
 */
export function createAppAuth(session: AppSession | null) {
	return createMirrorAuth({
		name: "session-kit-example",
		session,
		endpoint: "/auth/session",
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
