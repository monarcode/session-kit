import * as Fetch from "@monarcode/effetch";
import {
	createAuth,
	fromAccessToken,
	webStorage,
} from "@monarcode/session-kit";
import { Auth } from "@monarcode/session-kit/effect";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { FetchLive } from "./fetch";

/** DummyJSON's auth API: https://dummyjson.com/docs/auth */
export const API_BASE_URL = "https://dummyjson.com";

/** One-minute tokens make the early refresh visible after about 30 seconds. */
export const expiresInMins = 1;

export const SessionTokens = Schema.Struct({
	accessToken: Schema.String,
	refreshToken: Schema.String,
});

/**
 * DummyJSON's access tokens are JWTs carrying the user, so this app reads the
 * user from the token instead of the login response. A struct drops the
 * claims it doesn't list, such as `exp` and `iat`, which change on every
 * refresh.
 */
export const SessionUser = Schema.Struct({
	id: Schema.Finite,
	username: Schema.String,
	email: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	image: Schema.String,
});

// Not the app's API client: its session plugin waits for this refresh.
const makeRefreshClient = Fetch.make({ baseUrl: API_BASE_URL });

/**
 * Exchanges the refresh token for new tokens. DummyJSON answers 403 for an
 * invalid or expired refresh token and 401 for a missing one: both mean
 * "sign in again", so succeed with `null`. Other failures fail: the session
 * is kept and the error shows in `state.error`.
 */
const refreshSession = (refreshToken: string) =>
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
		Effect.provide(FetchLive),
	);

export const auth = createAuth({
	name: "session-kit-example",
	user: fromAccessToken(Schema.toStandardSchemaV1(SessionUser)),
	storage: webStorage(),
	refresh: ({ refreshToken, signal }) =>
		Effect.runPromise(refreshSession(refreshToken), { signal }),
});

// Registered once, so every `Auth` Effect is typed with this client's user.
declare module "@monarcode/session-kit/effect" {
	interface Register {
		auth: typeof auth;
	}
}

/**
 * The client as the `Auth` service, which the API client's `sessionBearer`
 * reads the access token from. It doesn't mount the client: `connectAuth`
 * does, in `router.tsx`.
 */
export const AuthLive = Auth.layer(auth);
