import * as Schema from "effect/Schema";

/** DummyJSON's auth API: https://dummyjson.com/docs/auth */
export const API_BASE_URL = "https://dummyjson.com";

/** One-minute tokens make the early refresh visible after about 30 seconds. */
export const expiresInMins = 1;

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

export const SessionTokens = Schema.Struct({
	accessToken: Schema.String,
	refreshToken: Schema.String,
});

/** DummyJSON explains an error in its body: `{ "message": "…" }`. */
export const ApiError = Schema.Struct({ message: Schema.String });
export type ApiError = Schema.Schema.Type<typeof ApiError>;
