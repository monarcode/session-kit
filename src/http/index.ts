import { AuthError, sessionChanged } from "../core/errors.js";
import type { AuthClient, Credentials } from "../core/types.js";

/** The part of the auth client that `createAuthFetch` uses. */
export type AuthFetchClient = Pick<
	AuthClient<unknown>,
	"credentials" | "isCurrent"
>;

export type AuthFetchOptions = {
	/**
	 * Whether a 401 on the replayed request, after a successful refresh, ends the
	 * session. Default: `true`. Set `false` when some endpoints answer 401 for
	 * reasons other than a rejected token, so one of them cannot sign users out.
	 */
	signOutOnRepeated401?: boolean;
};

/** Releases a response the caller will never see. */
async function discard(response: Response) {
	await response.body?.cancel().catch(() => {});
}

export function createAuthFetch(
	auth: AuthFetchClient,
	baseUrl: string,
	options: AuthFetchOptions = {},
) {
	const base = new URL(baseUrl);
	const signOutOnRepeated401 = options.signOutOnRepeated401 ?? true;
	return async function authFetch(
		path: string,
		init: RequestInit = {},
	): Promise<Response> {
		const url = new URL(path, base);
		if (url.origin !== base.origin || url.username || url.password) {
			throw new Error(
				"Authenticated requests must stay on the configured API origin",
			);
		}
		const captured = await auth.credentials.get();

		if (!captured)
			throw new AuthError("UNAUTHENTICATED", "Sign in is required");
		const request = new Request(url, init);
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

		const response = await send(captured);

		if (response.status !== 401) return response;

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
