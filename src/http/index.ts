import { AuthError, sessionChanged } from "../core/errors.js";
import type { AuthClient, Session } from "../core/types.js";

export function createAuthFetch<I, U>(auth: AuthClient<I, U>, baseUrl: string) {
	const base = new URL(baseUrl);
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
		const captured = await auth.getSession();

		if (!captured)
			throw new AuthError("UNAUTHENTICATED", "Sign in is required");
		const request = new Request(url, init);
		const canReplay = request.method === "GET" || request.method === "HEAD";

		const send = async (session: Session<U>) => {
			if (!auth.isCurrent(session)) throw sessionChanged();
			const headers = new Headers(request.headers);
			headers.set("Authorization", `Bearer ${session.accessToken}`);
			const response = await fetch(
				new Request(request, { headers, redirect: "error" }),
			);
			if (!auth.isCurrent(session)) throw sessionChanged();
			return response;
		};

		const response = await send(captured);

		if (response.status !== 401) return response;

		const fresh = await auth.refresh(captured);

		if (!fresh) return response;
		if (!canReplay) return response;

		await response.body?.cancel();
		const retried = await send(fresh);

		if (retried.status === 401) await auth.rejectSession(fresh);

		return retried;
	};
}
