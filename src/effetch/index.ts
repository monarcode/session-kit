import { plugin, type Plugin } from "@monarcode/effetch";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Headers from "effect/http/Headers";
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
	unauthenticated,
} from "../effect/failure.js";

/**
 * Options for {@link sessionBearer}.
 *
 * @example
 * ```ts
 * import { sessionBearer } from "@monarcode/session-kit/effetch";
 *
 * // One client for public and private endpoints.
 * export const bearer = sessionBearer({
 * 	baseUrl: "https://api.example.com",
 * 	optional: true,
 * });
 * ```
 *
 * @since 0.1.0
 */
export interface SessionBearerOptions {
	/**
	 * Your API's URL, usually the effetch client's `baseUrl`. It must be
	 * absolute, such as `https://api.example.com`. The access token goes only
	 * to requests on its origin.
	 */
	baseUrl: string;
	/**
	 * Whether a call made while signed out is sent without an `Authorization`
	 * header, rather than failing with `UNAUTHENTICATED`. Set `true` when one
	 * client serves public and private endpoints. A locked client still fails
	 * with `LOCKED`. Calls can override it.
	 * @default false
	 */
	optional?: boolean | undefined;
	/**
	 * Whether a second 401, after a successful refresh, signs the user out.
	 * Set `false` when some endpoints answer 401 for reasons other than a
	 * rejected token. Calls can override it.
	 * @default true
	 */
	signOutOnRepeated401?: boolean | undefined;
}

/**
 * The plugin {@link sessionBearer} returns. Its calls can fail with
 * `AuthFailure`, and `Fetch.make` needs the `Auth` service.
 *
 * A call can skip it with `plugins: { sessionBearer: false }`, or override
 * `optional` and `signOutOnRepeated401`.
 *
 * @example
 * ```ts
 * import {
 * 	sessionBearer,
 * 	type SessionBearerPlugin,
 * } from "@monarcode/session-kit/effetch";
 *
 * export const bearer: SessionBearerPlugin = sessionBearer({
 * 	baseUrl: "https://api.example.com",
 * });
 * ```
 *
 * @since 0.1.0
 */
export type SessionBearerPlugin = Plugin<
	"sessionBearer",
	AuthFailure,
	Auth,
	{ readonly optional: boolean; readonly signOutOnRepeated401: boolean }
>;

/**
 * Runs `effect` with `fetch` refusing redirects, so a token never follows one.
 */
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
 * `Authorization: Bearer`. After a 401, it gets a new access token once.
 * `GET` and `HEAD` requests are then sent again; other requests return the
 * 401 for you to retry. If the request sent again gets a 401 too, the user
 * is signed out, unless `signOutOnRepeated401` is off. If the renewal ends
 * the session, the call returns the 401.
 *
 * Calls fail with `AuthFailure`, before sending anything: `UNAUTHENTICATED`
 * when signed out, unless `optional` sends them without a token, and
 * `LOCKED` while locked. When a refresh fails, the call fails with that
 * failure, such as `REFRESH_FAILED`.
 *
 * If the session changes during a call, it fails with `SESSION_CHANGED`
 * rather than return a response meant for another account.
 *
 * The token never leaves your API. A request on another origin, or with a
 * username or password in its URL, dies with `INVALID_OPTIONS`. With
 * Effect's `FetchHttpClient`, a redirect fails as a `NetworkError` rather
 * than being followed. An invalid `baseUrl` throws `INVALID_OPTIONS`.
 *
 * A request that already has an `Authorization` header is sent as it is, as
 * effetch's `bearer` does.
 *
 * Put it last in `plugins`, after `retry`, so each attempt reads the current
 * token. `Fetch.make` then needs the `Auth` service, but calls don't.
 *
 * On the server, make the effetch client per request, and provide it the
 * `Auth` layer for that request's session (`RequestAuth`). It reads the
 * token from the request's cookie and saves a renewed one.
 *
 * @example
 * ```ts
 * import type * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 * import * as Fetch from "@monarcode/effetch";
 * import { retry } from "@monarcode/effetch/plugins";
 * import { sessionBearer } from "@monarcode/session-kit/effetch";
 *
 * const baseUrl = "https://api.example.com";
 * const Profile = Schema.Struct({ email: Schema.String });
 *
 * export const makeApi = Fetch.make({
 * 	baseUrl,
 * 	plugins: [retry(), sessionBearer({ baseUrl })],
 * });
 * type Api = Effect.Success<typeof makeApi>;
 *
 * export const getProfile = (api: Api) => api.get("/me", { output: Profile });
 *
 * // Signing in needs no token: skip the plugin.
 * export const login = (api: Api, username: string, password: string) =>
 * 	api.post("/login", {
 * 		body: { username, password },
 * 		plugins: { sessionBearer: false },
 * 	});
 * ```
 *
 * @see {@link SessionBearerOptions} for `optional` and `signOutOnRepeated401`
 *
 * @since 0.1.0
 */
export function sessionBearer(
	options: SessionBearerOptions,
): SessionBearerPlugin {
	const { origin } = parseUrl(options.baseUrl);
	return plugin({
		name: "sessionBearer",
		defaults: {
			optional: options.optional ?? false,
			signOutOnRepeated401: options.signOutOnRepeated401 ?? true,
		},
		wrap: (client, callOptions) =>
			HttpClient.transform(client, (_response, request) =>
				Effect.gen(function* () {
					if (Headers.has(request.headers, "authorization"))
						return yield* client.execute(request);
					const url = parseUrl(request.url);
					if (url.origin !== origin || url.username || url.password)
						return yield* Effect.die(
							new AuthError(
								"INVALID_OPTIONS",
								"Authenticated requests must stay on the configured API origin",
							),
						);
					const auth = yield* Auth;
					const { optional, signOutOnRepeated401 } = yield* callOptions;
					// The session can change while the token is read and while the
					// request is in flight. Either way, the response isn't ours.
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

					const captured = yield* fromPromise(() =>
						auth.credentials.get(),
					);
					if (!captured) {
						if (!optional)
							return yield* Effect.fail(
								unauthenticated("Sign in is required"),
							);
						const response = yield* refuseRedirects(
							client.execute(request),
						);
						// A 401 for the signed-out request must not reach a 401
						// handler that would then sign out the account that just
						// signed in.
						if (auth.state.get().sessionId !== null)
							return yield* fromAuthError(sessionChanged());
						return response;
					}
					const response = yield* send(captured);
					if (response.status !== 401) return response;

					const fresh = yield* fromPromise(() =>
						auth.credentials.renew(captured),
					);
					if (!fresh) return response;
					if (request.method !== "GET" && request.method !== "HEAD")
						return response;

					const retried = yield* send(fresh);
					if (retried.status === 401 && signOutOnRepeated401)
						yield* fromPromise(() => auth.credentials.reject(fresh));
					return retried;
				}),
			),
	});
}
