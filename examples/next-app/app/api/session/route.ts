import { sessionRoute } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";

import { serverAuth } from "../../../lib/auth/server";

/**
 * The session route the browser's client calls: it reads the session, signs
 * out, and gets the access token. It answers this site's own pages only.
 */
export const { GET, POST } = sessionRoute(serverAuth, { cookies });
