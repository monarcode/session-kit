import { rememberDeepLink } from "@monarcode/session-kit/expo";

import { auth } from "../src/auth";

/**
 * Expo Router calls this with every URL that opens the app, before routing.
 * Keeps the link, so SessionGate can open it after a sign-in if
 * Stack.Protected turns it away now. The link itself is unchanged.
 */
export function redirectSystemPath({
	path,
}: {
	path: string;
	initial: boolean;
}) {
	rememberDeepLink(auth, path);
	return path;
}
