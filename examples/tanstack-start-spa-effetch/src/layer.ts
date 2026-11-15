import { Auth } from "@monarcode/session-kit/effect";

import { auth } from "./auth";

/**
 * The client as the `Auth` service, which the API client's `sessionBearer`
 * reads the access token from. It doesn't mount the client: `connectAuth`
 * does, in `router.tsx`.
 */
export const AuthLive = Auth.layer(auth);
