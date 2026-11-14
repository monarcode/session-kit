"use server";

// Server Functions the browser calls. Each is a public endpoint: Next checks
// that calls come from this site, and each one checks its own input.
import { z } from "zod";

import { login } from "../lib/auth/backend";
import { session } from "../lib/auth/session";

/** Who is signed in, from the cookie. Holds no tokens. */
export async function getSessionAction() {
	return (await session.writable()).getSession();
}

const credentials = z.object({ username: z.string(), password: z.string() });

/**
 * Signs in with DummyJSON on the server and sets the cookie. A failure is
 * returned rather than thrown: Next hides a thrown error's message in
 * production.
 */
export async function signInAction(input: unknown) {
	const { username, password } = credentials.parse(input);
	try {
		return {
			session: await (
				await session.writable()
			).signIn(await login(username, password)),
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Could not sign in",
		};
	}
}

/** Clears the cookie. */
export async function signOutAction() {
	await (await session.writable()).signOut();
}
