import {
	createMirrorAuth,
	type ClientCredentials,
	type SessionOf,
} from "@monarcode/session-kit";

import {
	getSessionAction,
	signInAction,
	signOutAction,
} from "../../app/actions";
// Types only: erased from the browser's bundle.
import type { serverAuth } from "./server";

export type AppSession = SessionOf<typeof serverAuth>;

/** Asks the route handler for the access token, or renews `rejected`. */
async function credentials(rejected?: object) {
	const response = await fetch("/api/auth/credentials", {
		method: "POST",
		body: JSON.stringify(rejected ?? null),
	});
	if (!response.ok) throw new Error(`Credentials failed (${response.status})`);
	return (await response.json()) as ClientCredentials | null;
}

/**
 * The client the components use. It mirrors the session the server keeps in
 * its cookie, starting from the one the layout rendered. `useMirrorAuth`
 * creates it, once per request on the server and once in the browser.
 */
export function createAppAuth(session: AppSession | null) {
	return createMirrorAuth({
		name: "session-kit-example",
		session,
		revalidate: getSessionAction,
		signIn: async (input: { username: string; password: string }) => {
			const result = await signInAction(input);
			if ("error" in result) throw new Error(result.error);
			return result.session;
		},
		signOut: signOutAction,
		credentials: {
			get: () => credentials(),
			renew: (rejected) => credentials(rejected),
		},
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
