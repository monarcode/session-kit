import { useState, type FormEvent } from "react";

import { useMutation, useQuery } from "@monarcode/effetch-query/react";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { expiresInMins } from "./auth";
import { profileQuery, signInMutation } from "./endpoints";
import { apiErrorMessage } from "./error-message";
import { useAuth, useAuthClient } from "./hooks";

/** The sign-in form, prefilled with DummyJSON's documented test user. */
export function LoginForm({ onSignedIn }: { onSignedIn: () => unknown }) {
	const auth = useAuthClient();
	const signIn = useMutation(signInMutation);
	const [error, setError] = useState("");

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setError("");
		const exit = await signIn.run({
			body: {
				username: String(form.get("username")),
				password: String(form.get("password")),
				expiresInMins,
			},
		});
		if (Exit.isFailure(exit)) {
			setError(apiErrorMessage(exit.cause, "Could not sign in"));
			return;
		}
		try {
			// The tokens carry the user, so they are all the client needs.
			await auth.signIn(exit.value);
			await onSignedIn();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not sign in");
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
			<button disabled={signIn.result.waiting}>
				{signIn.result.waiting ? "Signing in…" : "Sign in"}
			</button>
		</form>
	);
}

/** `auth/me`, fetched with the access token once the button asks for it. */
function ProfileEmail() {
	const result = useQuery(profileQuery());
	return AsyncResult.match(result, {
		onInitial: () => <p>auth/me: loading…</p>,
		onFailure: ({ cause }) => (
			<p>auth/me: {apiErrorMessage(cause, "Could not load the profile")}</p>
		),
		onSuccess: ({ value }) => <p>auth/me: {value.email}</p>,
	});
}

/** The signed-in user, a request using the access token, and sign-out. */
export function Profile() {
	const user = useAuth((state) => state.user);
	const auth = useAuthClient();
	const [showEmail, setShowEmail] = useState(false);

	return (
		<main>
			<h1>Welcome, {user?.firstName}</h1>
			<p>Signed in as {user?.username}</p>
			<button onClick={() => setShowEmail(true)}>Load profile</button>
			{showEmail && <ProfileEmail />}
			<button onClick={() => void auth.signOut()}>Sign out</button>
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
