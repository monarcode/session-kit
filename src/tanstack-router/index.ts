import { useRouter, type Register } from "@tanstack/react-router";

import { assertAuthSource } from "../react/context.js";

export { connectAuth } from "./connect.js";
export { redirectIfSignedIn, requireSession } from "./guards.js";
export { SessionOutlet } from "./outlet.js";

export type {
	RedirectIfSignedInOptions,
	RequireSessionOptions,
} from "./guards.js";
export type { SessionOutletProps } from "./outlet.js";

/** The auth client type in your registered Router's context. */
export type RegisteredAuth = Register extends {
	router: { options: { context: { auth: infer Client } } };
}
	? Client
	: never;

/**
 * Reads the auth client from Router context. Pass it to `createAuthHooks` so
 * the hooks need no `AuthProvider`; `connectAuth` mounts the client instead.
 * Router context is per request in TanStack Start, so this stays safe when
 * rendering on a server.
 *
 * @example
 * export const { useAuth, useAuthClient } = createAuthHooks({
 * 	useClient: useRouterAuth,
 * });
 */
export function useRouterAuth(): RegisteredAuth {
	const auth: unknown = useRouter().options.context?.auth;
	assertAuthSource(
		auth,
		"Provide an auth client as `auth` in Router context before using auth hooks",
	);
	return auth as RegisteredAuth;
}
