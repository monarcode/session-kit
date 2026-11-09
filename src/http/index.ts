import { AuthError, sessionChanged } from "../core/errors.js";
import type { AuthClient, Credentials } from "../core/types.js";
import { parseUrl } from "../core/url.js";

/**
 * The part of the auth client that {@link createAuthFetch} uses. Any
 * `createAuth` client fits.
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
 * export const authFetch = createAuthFetch(auth, "https://api.example.com/", {
 * 	signOutOnRepeated401: false,
 * });
 * ```
 *
 * @since 0.1.0
 */
export type AuthFetchOptions = {
	/**
	 * Whether a request made while signed out is sent without an
	 * `Authorization` header, rather than rejecting with `UNAUTHENTICATED`.
	 * Default: `false`. Set `true` when one `authFetch` serves public and
	 * private endpoints. A locked client still rejects with `LOCKED`, and a
	 * 401 for a request sent without a token is resolved as it is.
	 */
	optional?: boolean | undefined;
	/**
	 * Whether a 401 on the replayed request, after a successful refresh, ends the
	 * session. Default: `true`. Set `false` when some endpoints answer 401 for
	 * reasons other than a rejected token, so one of them cannot sign users out.
	 */
	signOutOnRepeated401?: boolean | undefined;
};

/** Releases a response the caller will never see. */
async function discard(response: Response) {
	await response.body?.cancel().catch(() => {});
}

/**
 * Creates a `fetch` for your API that sends the current access token as
 * `Authorization: Bearer`. An invalid `baseUrl` throws `INVALID_OPTIONS`.
 * `path` is resolved against `baseUrl`; an invalid path, or one on another
 * origin or with credentials in it, rejects with `INVALID_OPTIONS`, so the
 * token never leaves your API. A redirect rejects rather than being followed.
 *
 * Rejects with `UNAUTHENTICATED` when signed out, unless `optional` sends the
 * request without a token, and `LOCKED` while locked.
 * A 401 response renews the access token once. `GET` and `HEAD` requests are
 * then sent again with the new token; other requests resolve the 401 for the
 * caller to retry. If the session changes during a request, it rejects with
 * `SESSION_CHANGED` rather than resolve a response for another account.
 * `fetch`'s own failures, such as a network error, and an `init` that
 * `Request` refuses reject as `fetch` and `Request` do. See
 * {@link AuthFetchOptions}.
 *
 * @example
 * ```ts
 * import type { AuthClient } from "@monarcode/session-kit";
 * import { createAuthFetch } from "@monarcode/session-kit/http";
 *
 * type User = { id: number; name: string };
 * declare const auth: AuthClient<User, User>;
 *
 * const authFetch = createAuthFetch(auth, "https://api.example.com/");
 *
 * export async function loadOrders(): Promise<unknown> {
 * 	const response = await authFetch("orders");
 * 	if (!response.ok) throw new Error(`Orders failed (${response.status})`);
 * 	return response.json();
 * }
 * ```
 *
 * @since 0.1.0
 */
export function createAuthFetch(
	auth: AuthFetchClient,
	baseUrl: string,
	options: AuthFetchOptions = {},
) {
	const base = parseUrl(baseUrl);
	const optional = options.optional ?? false;
	const signOutOnRepeated401 = options.signOutOnRepeated401 ?? true;
	return async function authFetch(
		path: string,
		init: RequestInit = {},
	): Promise<Response> {
		const url = parseUrl(path, base);
		if (url.origin !== base.origin || url.username || url.password) {
			throw new AuthError(
				"INVALID_OPTIONS",
				"Authenticated requests must stay on the configured API origin",
			);
		}
		const captured = await auth.credentials.get();

		if (!captured && !optional)
			throw new AuthError("UNAUTHENTICATED", "Sign in is required");
		const request = new Request(url, init);
		const canReplay = request.method === "GET" || request.method === "HEAD";

		/** Sends `request` with `session`'s token, or without one when signed out. */
		const send = async (session: Credentials | null) => {
			// Signed out, a sign-in during the request also counts as a change:
			// its 401 must not reach a handler that would sign the new account out.
			const current = () =>
				session
					? auth.isCurrent(session)
					: auth.state.get().sessionId === null;
			if (!current()) throw sessionChanged();
			const headers = new Headers(request.headers);
			if (session)
				headers.set("Authorization", `Bearer ${session.accessToken}`);
			const response = await fetch(
				new Request(request, { headers, redirect: "error" }),
			);
			if (!current()) {
				await discard(response);
				throw sessionChanged();
			}
			return response;
		};

		const response = await send(captured);

		if (!captured || response.status !== 401) return response;

		let fresh: Credentials | null;
		try {
			fresh = await auth.credentials.renew(captured);
		} catch (error) {
			await discard(response);
			throw error;
		}

		if (!fresh) return response;
		if (!canReplay) return response;

		await discard(response);
		const retried = await send(fresh);

		if (retried.status === 401 && signOutOnRepeated401)
			await auth.credentials.reject(fresh);

		return retried;
	};
}
