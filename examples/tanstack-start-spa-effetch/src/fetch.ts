import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

/**
 * `fetch`, without the tracing headers Effect adds to every request: from a
 * browser, they fail the preflight of an API that doesn't allow them.
 */
export const FetchLive = Layer.merge(
	FetchHttpClient.layer,
	Layer.succeed(HttpClient.TracerPropagationEnabled, false),
);
