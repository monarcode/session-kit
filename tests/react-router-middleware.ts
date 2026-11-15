// `./react-router/server` in React Router's own route and middleware types,
// which arrived in 7.9. `scripts/check-middleware-types.mjs` skips this file
// on older versions, which `./react-router` still supports.
import type {
	ActionFunction,
	LoaderFunction,
	MiddlewareFunction,
} from "react-router";

import { z } from "zod";

import {
	redirectIfSignedIn,
	requireSession,
	sessionMiddleware,
	sessionRoute,
} from "../dist/react-router/server.js";
import { createServerAuth } from "../dist/server/index.js";

const serverAuth = createServerAuth({
	name: "type-test",
	user: z.object({ id: z.string(), email: z.string() }),
	secret: "a-type-test-secret-that-is-32-chars-long",
});

const rootMiddleware: MiddlewareFunction<Response>[] =
	sessionMiddleware(serverAuth);
const signedIn = requireSession(serverAuth, {
	loginPath: "/login",
	basename: "/app",
});
const guardMiddleware: MiddlewareFunction<Response>[] = [signedIn];
const loginLoader: LoaderFunction = redirectIfSignedIn(serverAuth, {
	loginPath: ["/login", "/sign-up"],
});
const resourceRoute = sessionRoute(serverAuth);
const sessionLoader: LoaderFunction = resourceRoute.loader;
const sessionAction: ActionFunction = resourceRoute.action;
void [
	rootMiddleware,
	guardMiddleware,
	loginLoader,
	sessionLoader,
	sessionAction,
];
