import * as Fetch from "@monarcode/effetch";
import { sessionBearer } from "@monarcode/session-kit/effetch";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { API_BASE_URL } from "./auth";

/** DummyJSON explains an error in its body: `{ "message": "…" }`. */
export const ApiErrorBody = Schema.Struct({ message: Schema.String });
export type ApiErrorBody = Schema.Schema.Type<typeof ApiErrorBody>;

const make = Fetch.make({
	baseUrl: API_BASE_URL,
	defaultError: ApiErrorBody,
	// Sends the access token to DummyJSON only. After a 401 it refreshes, then
	// replays a GET or HEAD once. `optional`: a call made while signed out,
	// such as the sign-in itself, goes without a token.
	plugins: [sessionBearer({ baseUrl: API_BASE_URL, optional: true })],
});

/** The app's API client: effetch's `get`, `post` and the rest, for DummyJSON. */
export class ApiClient extends Context.Service<
	ApiClient,
	Effect.Success<typeof make>
>()("ApiClient") {}

export const ApiClientLive = Layer.effect(ApiClient, make);
