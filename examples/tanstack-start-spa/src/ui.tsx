import { useState, type FormEvent } from "react";

import { authFetch, signInWithPassword } from "./auth";
import { useAuth, useAuthClient } from "./hooks";

/** The sign-in form, prefilled with DummyJSON's documented test user. */
export function LoginForm({ onSignedIn }: { onSignedIn: () => unknown }) {
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
			await onSignedIn();
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

const me = (value: unknown) =>
	typeof value === "object" && value !== null && "email" in value
		? String(value.email)
		: "";

/** The signed-in user, a request using the access token, and sign-out. */
export function Profile() {
	const user = useAuth((state) => state.user);
	const auth = useAuthClient();
	const [fromApi, setFromApi] = useState("");

	async function loadProfile() {
		const response = await authFetch("auth/me");
		setFromApi(
			response.ok ? me(await response.json()) : `HTTP ${response.status}`,
		);
	}

	return (
		<main>
			<h1>Welcome, {user?.firstName}</h1>
			<p>Signed in as {user?.username}</p>
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
			<button onClick={() => void auth.signOut()}>Sign out</button>
		</main>
	);
}

export function Pending() {
	return <p>Checking session…</p>;
}

/** Shown after a failed refresh; retrying tries the refresh again. */
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
