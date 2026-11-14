import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { API } from "./api";
import { login } from "./backend";
import { session } from "./server";

// Each handler runs on the server; Start's compiler replaces it with a fetch
// in the browser, and leaves `session` out of that bundle.

/**
 * Who is signed in, from the cookie. Holds no tokens. The client's
 * `revalidate`: `loadSession` calls it while Start renders on the server,
 * where the client can't call the session route.
 */
export const getSessionFn = createServerFn().handler(() =>
	session.getSession(),
);

/** Signs in with DummyJSON on the server and sets the cookie. */
export const signInFn = createServerFn({ method: "POST" })
	.validator(z.object({ username: z.string(), password: z.string() }))
	.handler(async ({ data }) =>
		session.signIn(await login(data.username, data.password)),
	);

/** Calls DummyJSON's `auth/me` from the server, with the cookie's token. */
export const getProfileFn = createServerFn().handler(async () => {
	const credentials = await session.credentials.get();
	if (!credentials) return { email: "Signed out" };
	let response = await me(credentials.accessToken);
	if (response.status === 401) {
		// Refreshes once, then tries again.
		const renewed = await session.credentials.renew(credentials);
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
