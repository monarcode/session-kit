import type { ActionFunctionArgs } from "react-router";

import { routerJar } from "@monarcode/session-kit/react-router/server";
import { z } from "zod";

import { serverAuth } from "../auth/session.server";

const rejected = z.object({ sessionId: z.string(), accessToken: z.string() });

/**
 * The access token for the browser's own requests, never the refresh token:
 * a POST with no body gets it, and one with the token DummyJSON rejected
 * renews it. React Router checks no origin for resource routes: accept this
 * site only.
 */
export async function action({ request, context }: ActionFunctionArgs) {
	if (request.headers.get("sec-fetch-site") !== "same-origin")
		return new Response(null, { status: 403 });
	const jar = routerJar(context);
	const body = rejected.safeParse(await request.json().catch(() => null));
	return Response.json(
		body.success
			? await serverAuth.clientCredentials.renew(jar, body.data)
			: await serverAuth.clientCredentials.get(jar),
	);
}
