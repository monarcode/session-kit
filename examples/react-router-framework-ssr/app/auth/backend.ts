import { z } from "zod";

import { API } from "./api";

// DummyJSON's sign-in and refresh, called only from the server's auth code.

/** One-minute tokens make refreshes on the server easy to watch. */
const expiresInMins = 1;

/**
 * The user, from DummyJSON's login response. `z.object` drops the fields it
 * doesn't list, such as the tokens.
 */
export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	lastName: z.string(),
	image: z.string(),
});

export type User = z.infer<typeof userSchema>;

const tokens = z.object({ accessToken: z.string(), refreshToken: z.string() });

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
export async function refresh({
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
