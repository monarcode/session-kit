import { plugin, type Plugin } from "@monarcode/effetch";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";

import { AuthError, sessionChanged } from "../core/errors.js";
import type { Credentials } from "../core/types.js";
import { parseUrl } from "../core/url.js";
import { Auth } from "../effect/auth.js";
import {
	type AuthFailure,
	fromAuthError,
	fromPromise,
} from "../effect/failure.js";

/**
 * Options for {@link sessionAuth}.
 *
 * @example
 * ```ts
 * import { sessionAuth } from "@monarcode/session-kit/effetch";
 *
 * // Some endpoints answer 401 for missing permissions, not a bad token.
 * export const auth = sessionAuth({
 * 	baseUrl: "https://api.example.com",
 * 	signOutOnRepeated401: false,
 * });
 * ```
 *
 * @since 0.1.0
 */
export interface SessionAuthOptions {
	/**
	 * Your API's URL, usually the client's `baseUrl`. The access token goes
	 * only to requests on its origin.
	 */
	baseUrl: string;
	/**
	 * Whether a 401 on the replayed request, after a successful renewal, ends
	 * the session. Default: `true`. Set `false` when some endpoints answer 401
	 * for reasons other than a rejected token. Calls can override it.
	 */
	signOutOnRepeated401?: boolean | undefined;
}

/**
 * The plugin {@link sessionAuth} makes: calls can fail with `AuthFailure`,
 * and `Fetch.make` needs the `Auth` service. Calls can skip it
 * (`plugins: { sessionAuth: false }`) or override `signOutOnRepeated401`.
 *
 * @example
 * ```ts
 * import {
 * 	sessionAuth,
 * 	type SessionAuthPlugin,
 * } from "@monarcode/session-kit/effetch";
 *
 * export const auth: SessionAuthPlugin = sessionAuth({
 * 	baseUrl: "https://api.example.com",
 * });
 * ```
 *
 * @since 0.1.0
 */
export type SessionAuthPlugin = Plugin<
	"sessionAuth",
	AuthFailure,
	Auth,
	{ readonly signOutOnRepeated401: boolean }
>;

/** Runs `effect` with `fetch` refusing redirects, so a token never follows one. */
const refuseRedirects = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
		Effect.provideService(effect, FetchHttpClient.RequestInit, {
			...Option.getOrUndefined(init),
			redirect: "error",
		}),
	);

/**
 * An effetch plugin that sends the current access token as
 * `Authorization: Bearer`, with `createAuthFetch`'s behaviour. An invalid
 * `baseUrl` throws `INVALID_OPTIONS`; a request on another origin, or with
 * credentials in its URL, dies with `INVALID_OPTIONS`, so the token never
 * leaves your API. With Effect's `FetchHttpClient`, a redirect fails as a
 * `NetworkError` rather than being followed.
 *
 * Calls fail with `AuthFailure`: `UNAUTHENTICATED` when signed out and
 * `LOCKED` while locked, without sending the request. A 401 response renews
 * the access token once. `GET` and `HEAD` requests are then sent again with
 * the new token; other requests return the 401 for the caller to retry. If
 * the session changes during a call, it fails with `SESSION_CHANGED` rather
 * than return a response for another account.
 *
 * Put it last in `plugins`, after `retry`, so each attempt reads the current
 * token. `Fetch.make` then needs the `Auth` service; calls don't.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as FetchHttpClient from "effect/http/FetchHttpClient";
 * import * as Fetch from "@monarcode/effetch";
 * import { retry } from "@monarcode/effetch/plugins";
 * import { sessionAuth } from "@monarcode/session-kit/effetch";
 *
 * const baseUrl = "https://api.example.com";
 *
 * export const makeApi = Fetch.make({
 * 	baseUrl,
 * 	plugins: [retry(), sessionAuth({ baseUrl })],
 * }).pipe(Effect.provide(FetchHttpClient.layer));
 * // Per call: api.post("/auth/login", { body, plugins: { sessionAuth: false } })
 * ```
 *
 * @since 0.1.0
 */
export function sessionAuth(options: SessionAuthOptions): SessionAuthPlugin {
	const { origin } = parseUrl(options.baseUrl);
	return plugin({
		name: "sessionAuth",
		defaults: { signOutOnRepeated401: options.signOutOnRepeated401 ?? true },
		wrap: (client, callOptions) =>
			HttpClient.transform(client, (_response, request) =>
				Effect.gen(function* () {
					const url = parseUrl(request.url);
					if (url.origin !== origin || url.username || url.password)
						return yield* Effect.die(
							new AuthError(
								"INVALID_OPTIONS",
								"Authenticated requests must stay on the configured API origin",
							),
						);
					const auth = yield* Auth;
					const send = (credentials: Credentials) =>
						Effect.gen(function* () {
							if (!auth.isCurrent(credentials))
								return yield* fromAuthError(sessionChanged());
							const response = yield* refuseRedirects(
								client.execute(
									HttpClientRequest.setHeader(
										request,
										"authorization",
										`Bearer ${credentials.accessToken}`,
									),
								),
							);
							if (!auth.isCurrent(credentials))
								return yield* fromAuthError(sessionChanged());
							return response;
						});

					const captured = yield* Auth.credentials;
					const response = yield* send(captured);
					if (response.status !== 401) return response;

					const fresh = yield* fromPromise(() =>
						auth.credentials.renew(captured),
					);
					if (!fresh) return response;
					if (request.method !== "GET" && request.method !== "HEAD")
						return response;

					const retried = yield* send(fresh);
					const { signOutOnRepeated401 } = yield* callOptions;
					if (retried.status === 401 && signOutOnRepeated401)
						yield* fromPromise(() => auth.credentials.reject(fresh));
					return retried;
				}),
			),
	});
}
