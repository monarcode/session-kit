"use client";

import { useMemo, useState, type FormEvent } from "react";

import { createAuthFetch } from "@monarcode/session-kit/http";
import { useAuth, useAuthClient } from "@monarcode/session-kit/react";

import { API } from "../lib/auth/api";

/**
 * The sign-in form, prefilled with DummyJSON's documented test user. Once
 * signed in, the login page renders again on the server and redirects.
 */
export function LoginForm() {
	const auth = useAuthClient();
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setPending(true);
		setError("");
		try {
			// The server signs in with DummyJSON and sets the cookie.
			await auth.signIn({
				username: String(form.get("username")),
				password: String(form.get("password")),
			});
		} catch (cause) {
			// The Server Function's own message, such as a wrong password.
			setError(cause instanceof Error ? cause.message : "Could not sign in");
			setPending(false);
		}
	}

	return (
		<form onSubmit={submit}>
			<h1>Sign in</h1>
			<label>
				Username{" "}
				<input
					name="username"
					defaultValue="emilys"
					autoComplete="username"
					required
				/>
			</label>
			<label>
				Password{" "}
				<input
					name="password"
					type="password"
					defaultValue="emilyspass"
					autoComplete="current-password"
					required
				/>
			</label>
			{error && <p role="alert">{error}</p>}
			<button disabled={pending}>
				{pending ? "Signing in…" : "Sign in"}
			</button>
		</form>
	);
}

const emailOf = (value: unknown) =>
	typeof value === "object" && value !== null && "email" in value
		? String(value.email)
		: "";

/**
 * The signed-in user, `auth/me` called on the server and from the browser,
 * and sign-out.
 */
export function Profile({ fromServer }: { fromServer: string }) {
	const user = useAuth((state) => state.user);
	const auth = useAuthClient();
	// The browser's requests get the access token from the server, in memory.
	const authFetch = useMemo(
		() => createAuthFetch(auth, { baseUrl: `${API}/` }),
		[auth],
	);
	const [fromBrowser, setFromBrowser] = useState("");

	async function loadProfile() {
		const response = await authFetch("auth/me");
		setFromBrowser(
			response.ok
				? emailOf(await response.json())
				: `HTTP ${response.status}`,
		);
	}

	return (
		<main>
			<h1>Welcome, {user?.firstName}</h1>
			<p>Signed in as {user?.username}</p>
			<p>auth/me on the server: {fromServer}</p>
			<button
				onClick={() =>
					void loadProfile().catch((error: Error) =>
						setFromBrowser(error.message),
					)
				}
			>
				Load profile in the browser
			</button>
			{fromBrowser && <p>auth/me in the browser: {fromBrowser}</p>}
			<button onClick={() => void auth.signOut().catch(() => {})}>
				Sign out
			</button>
		</main>
	);
}
