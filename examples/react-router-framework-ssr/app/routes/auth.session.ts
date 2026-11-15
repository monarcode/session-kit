import { sessionRoute } from "@monarcode/session-kit/react-router/server";

import { serverAuth } from "../auth/session.server";

/**
 * The session route the browser's client calls: it reads the session, signs
 * out, and gets the access token. It answers this site's own pages only.
 */
const route = sessionRoute(serverAuth);

// One by one: React Router's build can't remove a destructured export.
export const loader = route.loader;
export const action = route.action;
