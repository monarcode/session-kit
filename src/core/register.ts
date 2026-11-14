import type { AuthClient } from "./types.js";

/**
 * Register your client's type here, once, so the hooks from
 * `@monarcode/session-kit/react` and the Effect service carry your user.
 * Without it, the user is typed `unknown`.
 *
 * Register the client you give `AuthProvider`: one from `createAuth`, or with
 * server rendering from `createMirrorAuth`. Register a mirror client by the
 * type its function returns, such as `ReturnType<typeof createAppAuth>`.
 * Anything else types the hooks and the Effect service as `never`.
 *
 * A TanStack Router app doesn't need it for its hooks: those from
 * `@monarcode/session-kit/tanstack-router` are typed by the Router.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * export const auth = createAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.string(), name: z.string() }),
 * 	storage: webStorage(),
 * });
 *
 * declare module "@monarcode/session-kit" {
 * 	interface Register {
 * 		auth: typeof auth;
 * 	}
 * }
 * ```
 *
 * @see {@link RegisteredAuth} for the type it gives
 *
 * @since 0.1.0
 */
export interface Register {}

/**
 * What a registered client has: every client from `createAuth` or
 * `createMirrorAuth` does.
 */
type RegisterableAuth = Pick<
	AuthClient<unknown, unknown>,
	"state" | "mount" | "getSession" | "signOut" | "isCurrent" | "credentials"
>;

/**
 * The client registered in {@link Register}, or a client with an `unknown`
 * user when none is. It's `never` when what's registered isn't a client.
 *
 * @example
 * ```ts
 * import type { RegisteredAuth } from "@monarcode/session-kit";
 *
 * export function status(client: RegisteredAuth) {
 * 	return client.state.get().status;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredAuth = Register extends { readonly auth: infer Client }
	? Client extends RegisterableAuth
		? Client
		: never
	: AuthClient<unknown, unknown>;
