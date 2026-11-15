import * as Fetch from "@monarcode/effetch";
import { retry } from "@monarcode/effetch/plugins";
import { sessionBearer } from "@monarcode/session-kit/effetch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

import { API_BASE_URL, ApiError } from "./backend";

const make = Fetch.make({
	baseUrl: API_BASE_URL,
	defaultError: ApiError,
	// `retry` resends a GET after a network error or a status such as 503.
	// `sessionBearer` comes after it, so each attempt reads the current token.
	// It sends the token to DummyJSON only. After a 401 it refreshes, then
	// sends a GET or HEAD again once. `optional`: a call made while signed out
	// goes without a token.
	plugins: [retry(), sessionBearer({ baseUrl: API_BASE_URL, optional: true })],
}).pipe(
	// Effect adds tracing headers to every request, which fail the preflight
	// of an API that doesn't allow them.
	Effect.provideService(HttpClient.TracerPropagationEnabled, false),
);

/** The app's API client: effetch's `get`, `post` and the rest, for DummyJSON. */
export class ApiClient extends Context.Service<
	ApiClient,
	Effect.Success<typeof make>
>()("ApiClient") {}

/** The API client, over whichever `Auth` is provided. */
export const ApiClientLive = Layer.effect(ApiClient, make);
