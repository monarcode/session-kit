import { AuthError, type AuthErrorCode } from "./errors.js";
import { isRecord } from "./json.js";
import type { ClientCredentials, MirrorCredentials } from "./mirror.js";

// What passes between `sessionHandler` on the server and `createMirrorAuth`'s
// `endpoint` in the browser. Both ship in this package, so only a page loaded
// before a deploy can send an older version, and the server refuses it.

/** The format's version, in every request body and every response. */
export const ENDPOINT_VERSION = 1;

/** What a `POST` asks for. A `GET` reads the session. */
export type EndpointAction = "signOut" | "credentials" | "renew";

const CODES = {
	USER_VALIDATION_FAILED: true,
	INVALID_SESSION: true,
	PERSISTENCE_FAILED: true,
	REFRESH_FAILED: true,
	REVOKE_FAILED: true,
	SESSION_CHANGED: true,
	UNAUTHENTICATED: true,
	LOCKED: true,
	UNLOCK_FAILED: true,
	INVALID_OPTIONS: true,
} satisfies Record<AuthErrorCode, true>;

const isCode = (value: unknown): value is AuthErrorCode =>
	typeof value === "string" &&
	Object.prototype.hasOwnProperty.call(CODES, value);

/** Checks `createMirrorAuth`'s `endpoint`: a path on this site. */
export function isEndpoint(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("/") &&
		!value.startsWith("//") &&
		// URL parsing drops tabs and newlines and reads `\` as `/`, so
		// `/\t/evil.test` would lead to another site.
		// oxlint-disable-next-line no-control-regex
		!/[\\\u0000- \u007f]/.test(value)
	);
}

/** The endpoint's URL on the page's own site. */
function urlOf(endpoint: string): URL {
	// A relative fetch has nothing to resolve against on the server.
	if (typeof location === "undefined")
		throw new AuthError(
			"INVALID_OPTIONS",
			"endpoint is called from the browser only: pass revalidate, signOut or credentials for calls on the server",
		);
	const url = new URL(endpoint, location.href);
	if (url.origin !== location.origin)
		throw new AuthError(
			"INVALID_OPTIONS",
			`endpoint must be a path on this site: ${endpoint}`,
		);
	return url;
}

/**
 * Calls the endpoint and returns its answer. A failure the server reports
 * rejects with the server's code, and anything else with a plain error, which
 * the mirror wraps as it wraps the app's own functions' failures.
 */
async function call(
	endpoint: string,
	action?: EndpointAction,
	extra?: object,
): Promise<Record<string, unknown>> {
	const response = await fetch(urlOf(endpoint), {
		method: action ? "POST" : "GET",
		credentials: "same-origin",
		cache: "no-store",
		...(action && {
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ v: ENDPOINT_VERSION, action, ...extra }),
		}),
	});
	const body: unknown = await response.json().catch(() => undefined);
	if (!isRecord(body) || body.v !== ENDPOINT_VERSION)
		throw new Error(
			`${endpoint} answered ${response.status} without a session-kit response: is it the session route?`,
		);
	if (!response.ok) {
		const error = isRecord(body.error) ? body.error : {};
		const message =
			typeof error.message === "string"
				? error.message
				: `${endpoint} answered ${response.status}`;
		throw isCode(error.code)
			? new AuthError(error.code, message)
			: new Error(message);
	}
	return body;
}

/** The mirror's `revalidate`, `signOut` and `credentials`, over `endpoint`. */
export function endpointTransport(endpoint: string): {
	revalidate: () => Promise<unknown>;
	signOut: () => Promise<unknown>;
	credentials: MirrorCredentials;
} {
	return {
		revalidate: async () => (await call(endpoint)).session,
		signOut: () => call(endpoint, "signOut"),
		credentials: {
			get: async () =>
				(await call(endpoint, "credentials"))
					.credentials as ClientCredentials | null,
			renew: async (rejected) =>
				(
					await call(endpoint, "renew", {
						rejected: {
							sessionId: rejected.sessionId,
							accessToken: rejected.accessToken,
						},
					})
				).credentials as ClientCredentials | null,
		},
	};
}
