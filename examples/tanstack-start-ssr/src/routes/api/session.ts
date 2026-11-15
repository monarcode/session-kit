import { sessionRoute } from "@monarcode/session-kit/tanstack-start/server";
import { createFileRoute } from "@tanstack/react-router";

import { serverAuth } from "../../auth/server";

/**
 * The session route the browser's client calls to sign out and get the
 * access token. It answers this site's own pages only. Start keeps
 * `server.handlers` out of the browser bundle, `serverAuth` included.
 */
export const Route = createFileRoute("/api/session")({
	server: { handlers: sessionRoute(serverAuth) },
});
