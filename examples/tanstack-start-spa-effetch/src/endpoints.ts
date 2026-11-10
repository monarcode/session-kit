import * as Fetch from "@monarcode/effetch";
import * as Schema from "effect/Schema";

import { SessionTokens } from "./auth";
import { api } from "./query";

/** Signs in with DummyJSON. Sent without a token: nobody is signed in yet. */
export const signInMutation = api.mutation(
	Fetch.endpoint("POST /auth/login", {
		input: Schema.Struct({
			username: Schema.String,
			password: Schema.String,
			expiresInMins: Schema.Finite,
		}),
		output: SessionTokens,
	}),
);

/** The signed-in user's profile, requested with the access token. */
export const profileQuery = api.query(
	Fetch.endpoint("GET /auth/me", {
		output: Schema.Struct({ email: Schema.String }),
	}),
);
