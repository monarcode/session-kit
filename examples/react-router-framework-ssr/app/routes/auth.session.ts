import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "../auth/session.server";

/** Who is signed in, from the cookie, for the client's `revalidate`. */
export async function loader({ context }: LoaderFunctionArgs) {
	return Response.json(await auth(context).getSession());
}

/**
 * Signs out, for the client's `signOut`. React Router checks the origin of
 * route actions, but not of resource routes': accept this site only.
 */
export async function action({ request, context }: ActionFunctionArgs) {
	if (request.headers.get("sec-fetch-site") !== "same-origin")
		return new Response(null, { status: 403 });
	await auth(context).signOut();
	return Response.json(null);
}
