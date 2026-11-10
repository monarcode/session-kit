// Holds the secret and the tokens: the `.server` name keeps it out of the
// browser's bundle, and the build fails if browser code imports it.
import { createServerAuth } from "@monarcode/session-kit/server";

import { refresh, userSchema } from "./backend";

/**
 * Seals the cookie: set `SESSION_SECRET` to 32 or more random characters.
 * `react-router dev` falls back to a development secret. In production, a
 * missing one makes every session call reject with `INVALID_OPTIONS`.
 */
function sessionSecret(): string {
	return (
		process.env.SESSION_SECRET ??
		(import.meta.env.DEV ? "development-only-secret-do-not-deploy" : "")
	);
}

/**
 * Keeps both tokens and the user in an encrypted, httpOnly cookie. With
 * `clientCredentials`, the browser can ask for the access token too, through
 * the resource route in `routes/auth.credentials.ts`; the refresh token stays
 * here.
 */
export const serverAuth = createServerAuth({
	name: "session-kit-example",
	user: userSchema,
	secret: sessionSecret(),
	refresh,
	clientCredentials: true,
	// `react-router dev` serves plain http; Safari drops Secure cookies there.
	cookie: { secure: !import.meta.env.DEV },
});
