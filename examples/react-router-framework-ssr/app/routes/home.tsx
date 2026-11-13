import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { z } from "zod";

import { API } from "../auth/api";
import { auth } from "../auth/session.server";
import { Profile } from "../ui";

/** Calls DummyJSON's `auth/me` from the server, with the cookie's token. */
export async function loader({ context }: LoaderFunctionArgs) {
	const session = auth(context);
	const credentials = await session.credentials.get();
	if (!credentials) return { email: "Signed out" };
	let response = await me(credentials.accessToken);
	if (response.status === 401) {
		// Refreshes once, then tries again.
		const renewed = await session.credentials.renew(credentials);
		if (!renewed) return { email: "Signed out" };
		response = await me(renewed.accessToken);
	}
	if (!response.ok) return { email: `HTTP ${response.status}` };
	const profile = z.object({ email: z.string() }).parse(await response.json());
	return { email: profile.email };
}

function me(accessToken: string) {
	return fetch(`${API}/auth/me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
}

export default function Home() {
	const { email } = useLoaderData<typeof loader>();
	return <Profile fromServer={email} />;
}
