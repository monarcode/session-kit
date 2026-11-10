import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { API } from "./api";
import { login } from "./backend";
import { serverAuth } from "./server";

// Each handler runs on the server; Start's compiler replaces it with a fetch
// in the browser, and leaves `startJar` and `serverAuth` out of that bundle.

/** Who is signed in, from the cookie. Holds no tokens. */
export const getSessionFn = createServerFn().handler(() =>
	serverAuth.getSession(startJar()),
);

/** Signs in with DummyJSON on the server and sets the cookie. */
export const signInFn = createServerFn({ method: "POST" })
	.validator(z.object({ username: z.string(), password: z.string() }))
	.handler(async ({ data }) =>
		serverAuth.signIn(startJar(), await login(data.username, data.password)),
	);

/** Clears the cookie. */
export const signOutFn = createServerFn({ method: "POST" }).handler(() =>
	serverAuth.signOut(startJar()),
);

/** The access token for the browser's own requests, never the refresh token. */
export const getCredentialsFn = createServerFn({ method: "POST" }).handler(() =>
	serverAuth.clientCredentials.get(startJar()),
);

/** New access after DummyJSON rejected the browser's token. */
export const renewCredentialsFn = createServerFn({ method: "POST" })
	.validator(z.object({ sessionId: z.string(), accessToken: z.string() }))
	.handler(({ data }) => serverAuth.clientCredentials.renew(startJar(), data));

/** Calls DummyJSON's `auth/me` from the server, with the cookie's token. */
export const getProfileFn = createServerFn().handler(async () => {
	const jar = startJar();
	const credentials = await serverAuth.credentials.get(jar);
	if (!credentials) return { email: "Signed out" };
	let response = await me(credentials.accessToken);
	if (response.status === 401) {
		// Refreshes once, then tries again.
		const renewed = await serverAuth.credentials.renew(jar, credentials);
		if (!renewed) return { email: "Signed out" };
		response = await me(renewed.accessToken);
	}
	if (!response.ok) return { email: `HTTP ${response.status}` };
	const profile = z.object({ email: z.string() }).parse(await response.json());
	return { email: profile.email };
});

function me(accessToken: string) {
	return fetch(`${API}/auth/me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
}
