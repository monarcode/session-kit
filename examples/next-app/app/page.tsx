import { createAuthFetch } from "@monarcode/session-kit/http";
import { z } from "zod";

import { API } from "../lib/auth/api";
import { session } from "../lib/auth/session";
import { Profile } from "./ui";

/** Calls DummyJSON's `auth/me` while rendering, with the cookie's token. */
async function profileEmail() {
	// Read-only: Proxy refreshed the token before this render.
	const apiFetch = createAuthFetch(await session.readOnly(), {
		baseUrl: `${API}/`,
	});
	const response = await apiFetch("auth/me");
	if (!response.ok) return `HTTP ${response.status}`;
	const profile = z.object({ email: z.string() }).parse(await response.json());
	return profile.email;
}

export default async function Home() {
	await session.require("/");
	const fromServer = await profileEmail().catch(
		(error: unknown) => (error as Error).message,
	);
	return <Profile fromServer={fromServer} />;
}
