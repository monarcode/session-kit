import { deepLinkHandler } from "@monarcode/session-kit/expo";

import { auth } from "../src/auth";

/**
 * Expo Router calls this with every URL that opens the app, before routing.
 * It remembers the link, so SessionGate can open it after a sign-in if
 * Stack.Protected turns it away now, and routes it unchanged.
 */
export const redirectSystemPath = deepLinkHandler(auth);
