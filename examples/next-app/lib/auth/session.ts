// The data access layer: how Server Components read the session.
import "server-only";
import { cache } from "react";

import { safeReturnTo } from "@monarcode/session-kit";
import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAuth } from "./server";

/**
 * The session from the cookie, once per render. The jar is read-only, as
 * Server Components can't set cookies: Proxy refreshed it first.
 */
export const getSession = cache(async () =>
	serverAuth.getSession(nextJar(await cookies())),
);

/** The session, or a redirect to the sign-in page that comes back to `path`. */
export async function requireSession(path: string) {
	const session = await getSession();
	if (!session)
		redirect(`/login?redirectTo=${encodeURIComponent(safeReturnTo(path))}`);
	return session;
}
