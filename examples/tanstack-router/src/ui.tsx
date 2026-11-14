import { useState, type FormEvent } from "react";

import { useAuthClient } from "@monarcode/session-kit/tanstack-router";
import { getRouteApi } from "@tanstack/react-router";

import { authFetch, signInWithPassword } from "./auth";

/**
 * The sign-in form, prefilled with DummyJSON's documented test user. It
 * doesn't navigate: a sign-in runs the guards again, and the sign-in page's
 * guard sends the user on.
 */
export function LoginForm() {
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setPending(true);
		setError("");
		try {
			await signInWithPassword(
				String(form.get("username")),
				String(form.get("password")),
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not sign in");
		} finally {
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

const authenticated = getRouteApi("/_authenticated");

/**
 * The signed-in user, a request using the access token, and sign-out. It
 * renders under the guarded layout, whose route context holds the session.
 */
export function Profile() {
	const { user } = authenticated.useRouteContext().session;
	const auth = useAuthClient();
	const [fromApi, setFromApi] = useState("");

	async function loadProfile() {
		const response = await authFetch("auth/me");
		setFromApi(
			response.ok
				? emailOf(await response.json())
				: `HTTP ${response.status}`,
		);
	}

	return (
		<main>
			<h1>Welcome, {user.firstName}</h1>
			<p>Signed in as {user.username}</p>
			<button
				onClick={() =>
					void loadProfile().catch((error: Error) =>
						setFromApi(error.message),
					)
				}
			>
				Load profile
			</button>
			{fromApi && <p>auth/me: {fromApi}</p>}
			<button onClick={() => void auth.signOut().catch(() => {})}>
				Sign out
			</button>
		</main>
	);
}

export function Pending() {
	return <p>Checking session…</p>;
}

/**
 * Shown after a failed refresh. `retry()` tries the refresh again; if that
 * fails too, the new error shows here, so the rejection can be ignored.
 */
export function Unavailable({ error }: { error: unknown }) {
	const auth = useAuthClient();
	return (
		<div role="alert">
			<p>
				{error instanceof Error ? error.message : "Something went wrong"}
			</p>
			<button onClick={() => void auth.retry().catch(() => {})}>
				Retry
			</button>
		</div>
	);
}
