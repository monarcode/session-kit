import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { routerJar } from "@monarcode/session-kit/react-router/server";

import { serverAuth } from "../auth/session.server";

/** Who is signed in, from the cookie, for the client's `revalidate`. */
export async function loader({ context }: LoaderFunctionArgs) {
	return Response.json(await serverAuth.getSession(routerJar(context)));
}

/**
 * Signs out, for the client's `signOut`. React Router checks the origin of
 * route actions, but not of resource routes': accept this site only.
 */
export async function action({ request, context }: ActionFunctionArgs) {
	if (request.headers.get("sec-fetch-site") !== "same-origin")
		return new Response(null, { status: 403 });
	await serverAuth.signOut(routerJar(context));
	return Response.json(null);
}
