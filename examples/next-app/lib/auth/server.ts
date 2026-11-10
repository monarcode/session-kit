// Holds the secret and the tokens: Next refuses to bundle it for the browser.
import "server-only";
import { createServerAuth } from "@monarcode/session-kit/server";

import { refresh, userSchema } from "./backend";

const production = process.env.NODE_ENV === "production";

/**
 * Seals the cookie: set `SESSION_SECRET` to 32 or more random characters.
 * `next dev` falls back to a development secret. In production, a missing
 * one makes every session call reject with `INVALID_OPTIONS`.
 */
function sessionSecret(): string {
	return (
		process.env.SESSION_SECRET ??
		(production ? "" : "development-only-secret-do-not-deploy")
	);
}

/**
 * Keeps both tokens and the user in an encrypted, httpOnly cookie. With
 * `clientCredentials`, the browser can ask for the access token too, through
 * the route handler in `app/api/auth/credentials`; the refresh token stays
 * here.
 */
export const serverAuth = createServerAuth({
	name: "session-kit-example",
	user: userSchema,
	secret: sessionSecret(),
	refresh,
	clientCredentials: true,
	// `next dev` serves plain http; Safari drops Secure cookies there.
	cookie: { secure: production },
});
