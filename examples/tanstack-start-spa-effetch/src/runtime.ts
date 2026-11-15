import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { ApiClientLive } from "./api";
import { AuthLive } from "./layer";

/**
 * The composition root: the API client, the session, and the
 * `FetchHttpClient` effetch sends with, each made once. A new service is
 * added here.
 */
const AppLayer = ApiClientLive.pipe(
	Layer.provideMerge(AuthLive),
	Layer.provide(FetchHttpClient.layer),
);

/** One runtime for the app's lifetime. */
export const appRuntime = ManagedRuntime.make(AppLayer);
export type AppRuntime = typeof appRuntime;
