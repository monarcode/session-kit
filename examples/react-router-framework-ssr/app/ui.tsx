import { useMemo, useState } from "react";
import { Form } from "react-router";

import { createAuthFetch } from "@monarcode/session-kit/http";

import { API } from "./auth/api";
import { useAuth, useAuthClient } from "./hooks";

/**
 * The sign-in form, prefilled with DummyJSON's documented test user. It
 * posts to the route's action, so it works before the page's scripts load.
 */
export function LoginForm({
	error,
	pending,
}: {
	error: string;
	pending: boolean;
}) {
	return (
		<Form method="post">
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
		</Form>
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
			<button onClick={() => void auth.signOut()}>Sign out</button>
		</main>
	);
}
