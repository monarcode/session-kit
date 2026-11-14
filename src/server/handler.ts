import { ENDPOINT_VERSION } from "../core/endpoint.js";
import { AuthError, type AuthErrorCode } from "../core/errors.js";
import { isRecord } from "../core/json.js";
import type { ServerAuth } from "./auth.js";
import type { CookieJar } from "./cookies.js";

/**
 * Answers the browser client's requests to your session route, for one
 * request and its cookie jar. {@link sessionHandler} makes one.
 *
 * @example
 * ```ts
 * import type { CookieJar, SessionHandler } from "@monarcode/session-kit/server";
 *
 * declare const handle: SessionHandler;
 * declare function jarOf(request: Request): CookieJar;
 *
 * export const route = (request: Request) => handle(request, jarOf(request));
 * ```
 *
 * @since 0.1.0
 */
export type SessionHandler = (
	request: Request,
	jar: CookieJar,
) => Promise<Response>;

const STATUS: Partial<Record<AuthErrorCode, number>> = {
	INVALID_OPTIONS: 400,
	UNAUTHENTICATED: 401,
	SESSION_CHANGED: 409,
};

function answer(status: number, body: object, headers: HeadersInit = {}) {
	const response = Response.json(
		{ v: ENDPOINT_VERSION, ...body },
		{ status, headers },
	);
	// What it says belongs to one user, for this moment.
	response.headers.set("Cache-Control", "no-store");
	return response;
}

function refuse(
	error: AuthError,
	status = STATUS[error.code] ?? 500,
	headers?: HeadersInit,
) {
	return answer(
		status,
		{ error: { code: error.code, message: error.message } },
		headers,
	);
}

/**
 * Whether the request comes from this site's own pages. Browsers send
 * `Sec-Fetch-Site` to https and localhost pages only, so on plain http a
 * `POST` is checked by its `Origin` instead. A `GET` without either is let
 * through: it changes nothing, and another site can't read the answer.
 */
function fromThisSite(request: Request): boolean {
	const site = request.headers.get("sec-fetch-site");
	if (site !== null) return site === "same-origin";
	if (request.method === "GET") return true;
	return request.headers.get("origin") === new URL(request.url).origin;
}

/** What a `POST` asks for, or an `AuthError` saying why it can't be read. */
async function readAction(request: Request) {
	const body: unknown = await request.json().catch(() => undefined);
	if (!isRecord(body))
		return new AuthError("INVALID_OPTIONS", "Send a JSON body");
	if (body.v !== ENDPOINT_VERSION)
		return new AuthError(
			"INVALID_OPTIONS",
			"This page came from another version of the app: reload it",
		);
	return body;
}

/**
 * Makes the handler for your session route ({@link SessionHandler}), which
 * answers `createMirrorAuth`'s `endpoint`. A `GET` reads the session. A
 * `POST` signs out, or gets or renews the access token for page scripts.
 *
 * It answers only this site's own pages, by the `Sec-Fetch-Site` header, so
 * another site can't sign the user out or ask for a token. Browsers send it
 * to https and localhost pages, since 2023 (Safari 16.4). Without it, as on
 * plain http, a `GET` is answered, and a `POST` needs an `Origin` header
 * that matches the request's URL. Anything else is refused with 403. Every
 * answer has `Cache-Control: no-store`.
 *
 * The access token is served only when `createServerAuth` has
 * `clientCredentials`. A failure answers with its `AuthErrorCode`, which the
 * browser client rejects with. Anything that isn't an `AuthError` is thrown,
 * for your framework to log.
 *
 * A failure's status is 400 for `INVALID_OPTIONS`, 401 for `UNAUTHENTICATED`,
 * 409 for `SESSION_CHANGED` and 500 for any other code. A method other than
 * `GET` or `POST` answers 405.
 *
 * Each framework's `sessionRoute` wraps it in a route. Use it directly on a
 * server without an adapter, with the request's cookie jar.
 *
 * @example
 * ```ts
 * import {
 * 	sessionHandler,
 * 	type CookieJar,
 * 	type ServerAuth,
 * } from "@monarcode/session-kit/server";
 *
 * declare const serverAuth: ServerAuth<{ id: number }, { id: number }>;
 * declare function jarOf(request: Request): CookieJar;
 *
 * const handle = sessionHandler(serverAuth);
 *
 * // A route at /api/session, for GET and POST.
 * export const route = (request: Request) => handle(request, jarOf(request));
 * ```
 *
 * @since 0.1.0
 */
export function sessionHandler<U, I>(
	serverAuth: ServerAuth<U, I>,
): SessionHandler {
	const handle = handleSession(serverAuth);
	return (request, jar) => handle(request, () => jar);
}

/**
 * {@link sessionHandler} for the adapters, which find the request's cookie
 * jar inside, so a setup error, such as a missing middleware, still answers
 * in the format the browser client reads.
 */
export function handleSession<U, I>(serverAuth: ServerAuth<U, I>) {
	return async (
		request: Request,
		jarOf: () => CookieJar | Promise<CookieJar>,
	): Promise<Response> => {
		if (!fromThisSite(request))
			return refuse(
				new AuthError(
					"INVALID_OPTIONS",
					"The session route answers this site's own pages only",
				),
				403,
			);
		if (request.method !== "GET" && request.method !== "POST")
			return refuse(
				new AuthError(
					"INVALID_OPTIONS",
					"The session route answers GET and POST",
				),
				405,
				{ Allow: "GET, POST" },
			);
		try {
			const session = serverAuth.forRequest(await jarOf());
			if (request.method === "GET")
				return answer(200, { session: await session.getSession() });
			const body = await readAction(request);
			if (body instanceof AuthError) return refuse(body);
			switch (body.action) {
				case "signOut":
					await session.signOut();
					return answer(200, { session: null });
				case "credentials":
					return answer(200, {
						credentials: await session.clientCredentials.get(),
					});
				case "renew":
					return answer(200, {
						credentials: await session.clientCredentials.renew(
							body.rejected as never,
						),
					});
				default:
					return refuse(
						new AuthError(
							"INVALID_OPTIONS",
							"Ask for signOut, credentials or renew",
						),
					);
			}
		} catch (error) {
			if (error instanceof AuthError) return refuse(error);
			throw error;
		}
	};
}
