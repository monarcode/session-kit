// Holds the secret and the tokens: Next refuses to bundle it for the browser.
import "server-only";
import { createServerAuth } from "@monarcode/session-kit/server";
import { z } from "zod";

import { API } from "./api";

/** One-minute tokens make refreshes on the server easy to watch. */
const expiresInMins = 1;

/**
 * The user, from DummyJSON's login response. `z.object` drops the fields it
 * doesn't list, such as the tokens.
 */
const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	lastName: z.string(),
	image: z.string(),
});

const tokens = z.object({ accessToken: z.string(), refreshToken: z.string() });

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

/**
 * Signs in with DummyJSON from the server. The tokens never reach the
 * browser's scripts, and the user comes from DummyJSON, not the browser.
 */
export async function login(username: string, password: string) {
	const response = await fetch(`${API}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password, expiresInMins }),
	});
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message = z.object({ message: z.string() }).safeParse(body);
		throw new Error(
			message.success
				? message.data.message
				: `Sign-in failed (${response.status})`,
		);
	}
	return { ...tokens.parse(body), user: userSchema.parse(body) };
}

/**
 * Exchanges the refresh token for new tokens. DummyJSON answers 403 for an
 * invalid or expired refresh token and 401 for a missing one: both mean
 * "sign in again", so return `null`. Other failures throw, and the session
 * is kept.
 */
async function refresh({
	refreshToken,
	signal,
}: {
	refreshToken: string;
	signal: AbortSignal;
}) {
	const response = await fetch(`${API}/auth/refresh`, {
		method: "POST",
		signal,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ refreshToken, expiresInMins }),
	});
	if (response.status === 401 || response.status === 403) return null;
	if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
	return tokens.parse(await response.json());
}
