import { createMirrorAuth, type SessionOf } from "@monarcode/session-kit";

import { signInAction } from "../../app/actions";
// Types only: erased from the browser's bundle.
import type { serverAuth } from "./server";

export type AppSession = SessionOf<typeof serverAuth>;

/**
 * The client the components use. It mirrors the session the server keeps in
 * its cookie, starting from the one the layout rendered, and calls the
 * session route in `app/api/session/route.ts`. `useMirrorAuth` creates it,
 * once per request on the server and once in the browser.
 */
export function createAppAuth(session: AppSession | null) {
	return createMirrorAuth({
		name: "session-kit-example",
		session,
		endpoint: "/api/session",
		signIn: async (input: { username: string; password: string }) => {
			const result = await signInAction(input);
			if ("error" in result) throw new Error(result.error);
			return result.session;
		},
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
