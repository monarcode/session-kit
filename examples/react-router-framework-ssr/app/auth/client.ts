import {
	createMirrorAuth,
	type ClientCredentials,
	type Session,
} from "@monarcode/session-kit";

import type { User } from "./user";

export type AppSession = Session<User>;

/** Calls one of the resource routes in `routes/auth.*.ts`. */
async function call<T>(method: "GET" | "POST", path: string, body?: object) {
	const response = await fetch(path, {
		method,
		...(body && {
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	});
	if (!response.ok) throw new Error(`${path} failed (${response.status})`);
	return (await response.json()) as T;
}

/**
 * The client the components use. It mirrors the session the server keeps in
 * its cookie, starting from the one the root loader read. `useMirrorAuth`
 * creates it, once per request on the server and once in the browser.
 */
export function createAppAuth(session: AppSession | null) {
	return createMirrorAuth({
		name: "session-kit-example",
		session,
		revalidate: () => call<AppSession | null>("GET", "/auth/session"),
		signOut: () => call<null>("POST", "/auth/session"),
		credentials: {
			get: () => call<ClientCredentials | null>("POST", "/auth/credentials"),
			renew: (rejected) =>
				call<ClientCredentials | null>(
					"POST",
					"/auth/credentials",
					rejected,
				),
		},
	});
}

export type AppAuth = ReturnType<typeof createAppAuth>;
