import * as Fetch from "@monarcode/effetch";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";

import { API_BASE_URL, expiresInMins, SessionTokens } from "./backend";

// Not the app's API client: its session plugin waits for this refresh.
const makeRefreshClient = Fetch.make({ baseUrl: API_BASE_URL }).pipe(
	// No tracing headers, as for the API client.
	Effect.provideService(HttpClient.TracerPropagationEnabled, false),
);

/**
 * Exchanges the refresh token for new tokens. DummyJSON answers 403 for an
 * invalid or expired refresh token and 401 for a missing one: both mean
 * "sign in again", so it resolves `null`. Other failures reject, so the
 * session is kept and the error shows in `state.error`.
 */
export const refreshSession = (refreshToken: string, signal: AbortSignal) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const client = yield* makeRefreshClient;
			return yield* client.post("/auth/refresh", {
				body: { refreshToken, expiresInMins },
				output: SessionTokens,
			});
		}).pipe(
			Effect.catchTag("HttpError", (error) =>
				error.status === 401 || error.status === 403
					? Effect.succeed(null)
					: Effect.fail(error),
			),
			Effect.provide(FetchHttpClient.layer),
		),
		{ signal },
	);
