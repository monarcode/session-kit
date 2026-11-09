import { createMirrorAuth } from "@monarcode/session-kit";

import {
	getCredentialsFn,
	getSessionFn,
	renewCredentialsFn,
	signInFn,
	signOutFn,
} from "./functions";

/**
 * The client the routes and components use. It mirrors the session the
 * server keeps in its cookie: `loadSession` fills it on the server, and
 * `sessionHydration` carries that to the browser. Create one per router: on
 * the server, that is one per request.
 */
export function createAppAuth() {
	return createMirrorAuth({
		name: "session-kit-example",
		session: null,
		revalidate: () => getSessionFn(),
		signIn: (data: { username: string; password: string }) =>
			signInFn({ data }),
		signOut: () => signOutFn(),
		credentials: {
			get: () => getCredentialsFn(),
			renew: (rejected) => renewCredentialsFn({ data: rejected }),
		},
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
