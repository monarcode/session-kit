import { createAuth, webStorage } from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { z } from "zod";

/** DummyJSON's auth API: https://dummyjson.com/docs/auth */
const API = "https://dummyjson.com";

/** One-minute tokens make the early refresh visible after about 30 seconds. */
const expiresInMins = 1;

const tokens = z.object({ accessToken: z.string(), refreshToken: z.string() });

export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	lastName: z.string(),
	image: z.string(),
});

/** DummyJSON returns the user's fields beside the tokens. */
const loginResponse = tokens.extend(userSchema.shape);

export const auth = createAuth({
	name: "session-kit-example",
	user: userSchema,
	storage: webStorage(),
	refresh,
});

/** Signs in with DummyJSON, then saves the tokens and the user it returned. */
export async function signInWithPassword(username: string, password: string) {
	const response = await login(username, password);
	const { accessToken, refreshToken, ...user } = loginResponse.parse(response);
	await auth.signIn({ accessToken, refreshToken, user });
}

/**
 * Exchanges the refresh token for new tokens. DummyJSON answers 403 for an
 * invalid or expired refresh token and 401 for a missing one: both mean
 * "sign in again", so return `null`. Other failures throw: the session is
 * kept and the error shows in `state.error`. There is no
 * `credentials: "include"`: session-kit keeps tokens out of cookies.
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

async function login(username: string, password: string): Promise<unknown> {
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
	return body;
}

/**
 * Sends requests to DummyJSON with the access token. After a 401 it
 * refreshes, then replays a GET or HEAD once.
 */
export const authFetch = createAuthFetch(auth, { baseUrl: `${API}/` });
