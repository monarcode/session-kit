import { AuthError, sessionChanged } from "../core/errors.js";
import type { AuthClient, Credentials } from "../core/types.js";
import { parseUrl } from "../core/url.js";

/**
 * The part of an auth client that {@link createAuthFetch} uses. A
 * `createAuth` or `createMirrorAuth` client fits, and so does a request's
 * session on the server (`RequestAuth`).
 *
 * @example
 * ```ts
 * import type { AuthFetchClient } from "@monarcode/session-kit/http";
 *
 * export async function accessToken(auth: AuthFetchClient) {
 * 	const credentials = await auth.credentials.get();
 * 	return credentials?.accessToken ?? null;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthFetchClient = Pick<
	AuthClient<unknown, unknown>,
	"credentials" | "isCurrent" | "state"
>;

/**
 * Options for {@link createAuthFetch}.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { createAuthFetch } from "@monarcode/session-kit/http";
 *
 * declare const auth: AuthClient<{ id: number }, { id: number }>;
 *
 * // Some endpoints answer 401 for missing permissions, not a bad token.
 * export const authFetch = createAuthFetch(auth, {
 * 	baseUrl: "https://api.example.com/",
 * 	signOutOnRepeated401: false,
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthFetchOptions = {
	/**
	 * Your API's base URL. It must be absolute, such as
	 * `https://api.example.com/`. The access token goes only to requests on
	 * its origin. A path is resolved against it as a link is against a page's
	 * address. End it with `/`, so that `"orders"` lands under it.
	 */
	baseUrl: string;
	/**
	 * Whether a request made while signed out is sent without an
	 * `Authorization` header, rather than rejecting with `UNAUTHENTICATED`.
	 * Set `true` when one `authFetch` serves public and private endpoints. A
	 * locked client still rejects with `LOCKED`. A 401 to a request sent
	 * without a token comes back as it is.
	 * @default false
	 */
	optional?: boolean | undefined;
	/**
	 * Whether a second 401, after a successful refresh, signs the user out.
	 * Set `false` when some endpoints answer 401 for reasons other than a
	 * rejected token, so a second 401 from them doesn't sign users out.
	 * Without a refresh token or a `refresh` option, the first 401 still does.
	 *
	 * @default true
	 */
	signOutOnRepeated401?: boolean | undefined;
};

/**
 * The `fetch` that {@link createAuthFetch} returns. Call it with a path
 * under your API's base URL, and `init` as you would pass to `fetch`. It
 * takes a `URL` or a `Request` too, as `fetch` does.
 *
 * A `Request` with a body can be sent once, as with `fetch`. To retry a
 * write after a 401, send a clone you kept. A call that rejects before
 * sending anything leaves the `Request` unused.
 *
 * `init` takes what `Request` takes. An option that only a runtime's own
 * `fetch` reads, such as Next.js's `next`, isn't passed on.
 *
 * Use the name to type a prop, a context or a test fake that stands in for
 * it.
 *
 * @example
 * ```ts
 * import type { AuthFetch } from "@monarcode/session-kit/http";
 *
 * // A stand-in for tests: every request gets an empty list.
 * export const fakeFetch: AuthFetch = async () =>
 * 	new Response("[]", { headers: { "Content-Type": "application/json" } });
 * ```
 *
 * @see {@link createAuthFetch} for how it sends the token and handles a 401
 *
 * @since 0.1.0
 */
export type AuthFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** Releases a response the caller will never see. */
async function discard(response: Response) {
	await response.body?.cancel().catch(() => {});
}

/**
 * Creates a `fetch` for your API ({@link AuthFetch}) that sends the current
 * access token as `Authorization: Bearer`. After a 401, it gets a new access
 * token once. `GET` and `HEAD` requests are then sent again; other requests
 * resolve the 401 for you to retry. If the request sent again gets a 401 too,
 * the user is signed out, unless `signOutOnRepeated401` is off.
 *
 * Rejects with `UNAUTHENTICATED` when signed out, unless `optional` sends the
 * request without a token, and with `LOCKED` while locked. When a refresh
 * fails, it rejects with that failure, such as `REFRESH_FAILED`.
 *
 * If the session changes during a request, it rejects with `SESSION_CHANGED`
 * rather than resolve a response meant for another account.
 *
 * The token never leaves your API. A request for another origin, with a
 * username or password in its URL, or with an invalid URL rejects with
 * `INVALID_OPTIONS`, as does a `Request` from another realm or a polyfill.
 * A redirect rejects rather than being followed. A
 * missing or invalid `baseUrl` throws `INVALID_OPTIONS`. While signed in, a
 * request's own `Authorization` header is replaced.
 *
 * `fetch`'s own failures, such as a network error, and an `init` that
 * `Request` refuses, reject as `fetch` and `Request` do.
 *
 * An HTTP client that takes a custom `fetch`, such as ky or openapi-fetch,
 * can take this one. Its requests then get the same checks, and the same
 * handling of a 401.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { createAuthFetch } from "@monarcode/session-kit/http";
 *
 * type User = { id: number; name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const authFetch = createAuthFetch(auth, {
 * 	baseUrl: "https://api.example.com/",
 * });
 *
 * export async function loadOrders(): Promise<unknown> {
 * 	const response = await authFetch("orders");
 * 	if (!response.ok) throw new Error(`Orders failed (${response.status})`);
 * 	return response.json();
 * }
 * ```
 *
 * @see {@link AuthFetchOptions} for `baseUrl`, `optional` and
 * `signOutOnRepeated401`
 *
 * @since 0.1.0
 */
export function createAuthFetch(
	auth: AuthFetchClient,
	options: AuthFetchOptions,
): AuthFetch {
	if (typeof options?.baseUrl !== "string")
		throw new AuthError(
			"INVALID_OPTIONS",
			"Pass your API's base URL as the baseUrl option",
		);
	const base = parseUrl(options.baseUrl);
	const optional = options.optional ?? false;
	const signOutOnRepeated401 = options.signOutOnRepeated401 ?? true;
	return async function authFetch(input, init) {
		if (input == null)
			throw new AuthError(
				"INVALID_OPTIONS",
				"Pass authFetch a path, a URL or a Request",
			);
		// Anything but this runtime's own `Request` becomes a string, as `fetch`
		// makes it, so the URL checked here is the URL that is sent. A
		// `Request` from another realm or a polyfill would become
		// "[object Request]", a path under `baseUrl`.
		const given = input instanceof Request ? input : null;
		if (!given && typeof input === "object" && "method" in input)
			throw new AuthError(
				"INVALID_OPTIONS",
				"Pass authFetch a Request made with this runtime's Request",
			);
		const url = parseUrl(given ? given.url : String(input), base);
		if (url.origin !== base.origin || url.username || url.password) {
			throw new AuthError(
				"INVALID_OPTIONS",
				"Authenticated requests must stay on the configured API origin",
			);
		}

		const captured = await auth.credentials.get();
		if (!captured && !optional)
			throw new AuthError("UNAUTHENTICATED", "Sign in is required");

		// Built once something will be sent: it uses up a `Request`'s body, and
		// a call that rejects first must leave the caller's `Request` usable.
		const request = new Request(given ?? url, init);
		const canReplay = request.method === "GET" || request.method === "HEAD";

		const send = async (session: Credentials) => {
			if (!auth.isCurrent(session)) throw sessionChanged();
			const headers = new Headers(request.headers);
			headers.set("Authorization", `Bearer ${session.accessToken}`);
			const response = await fetch(
				new Request(request, { headers, redirect: "error" }),
			);
			if (!auth.isCurrent(session)) {
				await discard(response);
				throw sessionChanged();
			}
			return response;
		};

		if (!captured) {
			const response = await fetch(
				new Request(request, { redirect: "error" }),
			);
			// A 401 for the signed-out request must not reach a 401 handler that
			// would then sign out the account that just signed in.
			if (auth.state.get().sessionId !== null) {
				await discard(response);
				throw sessionChanged();
			}
			return response;
		}
		const response = await send(captured);

		if (response.status !== 401) return response;

		let fresh: Credentials | null;
		try {
			fresh = await auth.credentials.renew(captured);
		} catch (error) {
			await discard(response);
			throw error;
		}

		// The session ended while renewing.
		if (!fresh) return response;
		if (!canReplay) return response;

		await discard(response);
		const retried = await send(fresh);

		if (retried.status === 401 && signOutOnRepeated401)
			await auth.credentials.reject(fresh);

		return retried;
	};
}
