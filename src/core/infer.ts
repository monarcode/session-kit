/**
 * The session type of a client: what its `getSession` resolves, without
 * `null`. It takes any client: one from `createAuth` or `createMirrorAuth`,
 * the server's from `createServerAuth`, or a request's session from it.
 *
 * The browser can take its types from the server's. An `import type` of the
 * server's module is left out of the browser bundle.
 *
 * @example
 * ```ts
 * import { createAuth, webStorage, type SessionOf } from "@monarcode/session-kit";
 * import { z } from "zod";
 *
 * export const auth = createAuth({
 * 	name: "app",
 * 	user: z.object({ id: z.string(), name: z.string() }),
 * 	storage: webStorage(),
 * });
 *
 * export type AppSession = SessionOf<typeof auth>; // { sessionId, user }
 * ```
 *
 * @see {@link UserOf} for the user alone
 *
 * @since 0.1.0
 */
export type SessionOf<
	Client extends { getSession: (...args: never[]) => Promise<unknown> },
> = NonNullable<Awaited<ReturnType<Client["getSession"]>>>;

/**
 * The user type of a client, as {@link SessionOf} finds it: the `user` of
 * its session.
 *
 * @example
 * ```ts
 * import type { UserOf } from "@monarcode/session-kit";
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 *
 * export type AppUser = UserOf<typeof serverAuth>; // { id: number }
 * ```
 *
 * @since 0.1.0
 */
export type UserOf<
	Client extends { getSession: (...args: never[]) => Promise<unknown> },
> = SessionOf<Client> extends { readonly user: infer U } ? U : never;
