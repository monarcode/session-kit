import { z } from "zod";

import { API } from "../lib/auth/api";
import { session } from "../lib/auth/session";
import { Profile } from "./ui";

/** Calls DummyJSON's `auth/me` while rendering, with the cookie's token. */
async function profileEmail() {
	// Read-only: Proxy refreshed the token before this render.
	const credentials = await (await session.readOnly()).credentials.get();
	if (!credentials) return "Signed out";
	const response = await fetch(`${API}/auth/me`, {
		headers: { Authorization: `Bearer ${credentials.accessToken}` },
	});
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
