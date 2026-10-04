export { createAuth } from "./core/client.js";
export { createRefreshFn } from "./core/refresh.js";
export { AuthError } from "./core/errors.js";
export { memoryStorage, webStorage } from "./core/storage.js";

export type { AuthErrorCode, AuthErrorOptions } from "./core/errors.js";
export type { AuthStorage, WebStorageOptions } from "./core/storage.js";

export type {
	AuthClient,
	AuthOptions,
	AuthState,
	AuthStatus,
	Tokens,
	SignInInput,
	Session,
	RefreshFn,
	RefreshResult,
	User,
	UserInput,
} from "./core/types.js";
