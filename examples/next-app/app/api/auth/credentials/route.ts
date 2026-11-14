import { z } from "zod";

import { session } from "../../../../lib/auth/session";

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
	const auth = await session.writable();
	const body = rejected.safeParse(await request.json().catch(() => null));
	const credentials = body.success
		? await auth.clientCredentials.renew(body.data)
		: await auth.clientCredentials.get();
	return Response.json(credentials, {
		headers: { "Cache-Control": "no-store" },
	});
}
