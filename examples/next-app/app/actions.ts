"use server";

// The sign-in the browser calls: a public endpoint. Next checks that calls
// come from this site, and it checks its own input. The session route in
// `api/session/route.ts` does the rest.
import { z } from "zod";

import { login } from "../lib/auth/backend";
import { session } from "../lib/auth/session";

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
