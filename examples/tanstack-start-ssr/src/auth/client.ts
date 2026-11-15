import { createMirrorAuth } from "@monarcode/session-kit";

import { getSessionFn, signInFn } from "./functions";

/**
 * The client the routes and components use. It mirrors the session the
 * server keeps in its cookie: `loadSession` fills it on the server, and
 * `connectSession` carries that to the browser. It signs out and gets the
 * access token through the session route in `routes/api/session.ts`. Create
 * one per router: on the server, that is one per request.
 */
export function createAppAuth() {
	return createMirrorAuth({
		name: "session-kit-example",
		session: null,
		endpoint: "/api/session",
		revalidate: () => getSessionFn(),
		signIn: (data: { username: string; password: string }) =>
			signInFn({ data }),
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
