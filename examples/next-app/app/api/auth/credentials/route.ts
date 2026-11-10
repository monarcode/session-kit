import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { z } from "zod";

import { serverAuth } from "../../../../lib/auth/server";

const rejected = z.object({ sessionId: z.string(), accessToken: z.string() });

/**
 * The access token for the browser's own requests, never the refresh token:
 * a POST with no body gets it, and one with the token DummyJSON rejected
 * renews it. A route handler rather than a Server Function, so these calls
 * don't wait behind other Server Functions or render the page again.
 */
export async function POST(request: Request) {
	// Route handlers get no CSRF check from Next: accept this site only.
	if (request.headers.get("sec-fetch-site") !== "same-origin")
		return new Response(null, { status: 403 });
	const jar = nextJar(await cookies(), { writable: true });
	const body = rejected.safeParse(await request.json().catch(() => null));
	const credentials = body.success
		? await serverAuth.clientCredentials.renew(jar, body.data)
		: await serverAuth.clientCredentials.get(jar);
	return Response.json(credentials, {
		headers: { "Cache-Control": "no-store" },
	});
}
