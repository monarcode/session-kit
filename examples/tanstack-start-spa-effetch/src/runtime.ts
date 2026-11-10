import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { ApiClientLive } from "./api-client";
import { AuthLive } from "./auth";
import { FetchLive } from "./fetch";

/**
 * The composition root: the app's services and what they depend on. A new
 * service is added here.
 */
const AppLayer = ApiClientLive.pipe(
	Layer.provideMerge(AuthLive),
	Layer.provide(FetchLive),
);

/** One runtime for the app's lifetime. */
export const appRuntime = ManagedRuntime.make(AppLayer);
export type AppRuntime = typeof appRuntime;
