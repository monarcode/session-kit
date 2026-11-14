import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { createAuthFetch } from "@monarcode/session-kit/http";
import { z } from "zod";

import { API } from "../auth/api";
import { auth } from "../auth/session.server";
import { Profile } from "../ui";

/** Calls DummyJSON's `auth/me` from the server, with the cookie's token. */
export async function loader({ context }: LoaderFunctionArgs) {
	// After a 401, it renews the token, saves it in the cookie, and tries again.
	const apiFetch = createAuthFetch(auth(context), { baseUrl: `${API}/` });
	const response = await apiFetch("auth/me");
	if (!response.ok) return { email: `HTTP ${response.status}` };
	const profile = z.object({ email: z.string() }).parse(await response.json());
	return { email: profile.email };
}

export default function Home() {
	const { email } = useLoaderData<typeof loader>();
	return <Profile fromServer={email} />;
}
