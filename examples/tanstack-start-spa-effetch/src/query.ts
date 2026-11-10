import { QueryClient } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";
import type * as ManagedRuntime from "effect/ManagedRuntime";

import { ApiClient } from "./api-client";
import { appRuntime, type AppRuntime } from "./runtime";

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: ManagedRuntime.ManagedRuntime.Services<AppRuntime>;
	}
}

/** Turns endpoints of the API client into queries and mutations. */
export const api = endpoints(ApiClient);

/**
 * Makes the query cache, which runs queries and mutations with `appRuntime`'s
 * services. `QueryProvider` makes a new one for each session, so no account
 * sees another's cached data.
 */
export const makeQueryClient = () => QueryClient.make({ runtime: appRuntime });
