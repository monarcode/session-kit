export { createAuth } from "./core/client.js";
export { AuthError } from "./core/errors.js";
export { safeReturnTo } from "./core/return-to.js";
export { fromAccessToken } from "./core/sources.js";
export { memoryStorage, webStorage } from "./core/storage.js";

export type { AuthErrorCode, AuthErrorOptions } from "./core/errors.js";
export type { SafeReturnToOptions } from "./core/return-to.js";
export type {
	AccessTokenUser,
	FromAccessTokenOptions,
	UserSource,
} from "./core/sources.js";
export type { AuthStorage, WebStorageOptions } from "./core/storage.js";

export type {
	AuthClient,
	AuthOptions,
	AuthState,
	AuthStatus,
	Credentials,
	RefreshFn,
	RefreshResult,
	RevokeFn,
	Session,
	SignInInput,
	Tokens,
	User,
	UserInput,
} from "./core/types.js";
