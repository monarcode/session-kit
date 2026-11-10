"use server";

// Server Functions the browser calls. Each is a public endpoint: Next checks
// that calls come from this site, and each one checks its own input.
import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { z } from "zod";

import { login, serverAuth } from "../lib/auth/server";

async function jar() {
	return nextJar(await cookies(), { writable: true });
}

/** Who is signed in, from the cookie. Holds no tokens. */
export async function getSessionAction() {
	return serverAuth.getSession(await jar());
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
			session: await serverAuth.signIn(
				await jar(),
				await login(username, password),
			),
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Could not sign in",
		};
	}
}

/** Clears the cookie. */
export async function signOutAction() {
	await serverAuth.signOut(await jar());
}
