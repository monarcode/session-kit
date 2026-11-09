import { createAuth } from "@monarcode/session-kit";
import { secureStorage } from "@monarcode/session-kit/expo";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { createAuthHooks } from "@monarcode/session-kit/react";
import { z } from "zod";

/** DummyJSON's auth API: https://dummyjson.com/docs/auth */
const API = "https://dummyjson.com";

/** One-minute tokens make the early refresh visible after about 30 seconds. */
const expiresInMins = 1;

export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	image: z.string(),
});

const tokensSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
});
/** DummyJSON returns the user's fields beside the tokens. */
const loginResponseSchema = tokensSchema.extend(userSchema.shape);

export const auth = createAuth({
	name: "expo-example",
	user: userSchema,
	// The iOS keychain, or Keystore-encrypted storage on Android. Two JWTs and
	// a user exceed SecureStore's 2048-byte value limit, so the value is split
	// across keys. The defaults are `clearOnReinstall: true` and SecureStore's
	// own `keychainAccessible` (`WHEN_UNLOCKED`).
	storage: secureStorage(),
	// Logs restores, refreshes, timers, and the gate's decisions to Metro in
	// development. Tokens and user fields stay out of the log.
	debug: __DEV__,
	/**
	 * DummyJSON answers 403 for an invalid or expired refresh token and 401
	 * for a missing one: both mean "sign in again", so return `null`. Other
	 * failures throw: the session is kept and the error shows in
	 * `state.error`.
	 */
	refresh: async ({ refreshToken, signal }) => {
		const response = await fetch(`${API}/auth/refresh`, {
			method: "POST",
			signal,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken, expiresInMins }),
		});
		if (response.status === 401 || response.status === 403) return null;
		if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
		return tokensSchema.parse(await response.json());
	},
});

export const { AuthProvider, useAuth, useAuthClient } =
	createAuthHooks<typeof auth>();

/**
 * Sends requests to DummyJSON with the access token. After a 401 it
 * refreshes, then replays a GET or HEAD once.
 */
export const authFetch = createAuthFetch(auth, `${API}/`);

/** Signs in with DummyJSON, then saves the tokens and the user it returned. */
export async function signInWithPassword(username: string, password: string) {
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
	const { accessToken, refreshToken, ...user } =
		loginResponseSchema.parse(body);
	await auth.signIn({ accessToken, refreshToken, user });
}
