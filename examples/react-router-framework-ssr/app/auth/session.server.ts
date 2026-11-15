// Holds the secret and the tokens: the `.server` name keeps it out of the
// browser's bundle, and the build fails if browser code imports it.
import {
	requireSession,
	routerAuth,
} from "@monarcode/session-kit/react-router/server";
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
 * the session route in `routes/auth.session.ts`; the refresh token stays
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

/**
 * The session of the request React Router is handling, by its `context`:
 * `auth(context).getSession()` in a loader, action or middleware.
 */
export const auth = routerAuth(serverAuth);

/**
 * Lets only signed-in users through to the routes it guards, as middleware:
 * it runs on the server before their loaders and actions, for page loads and
 * navigation alike. Signed-out users go to the sign-in page, which brings
 * them back. `signedIn.session(context)` gives those loaders the session.
 */
export const signedIn = requireSession(serverAuth);
