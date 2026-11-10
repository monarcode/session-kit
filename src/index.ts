export { createAuth } from "./core/client.js";
export { AuthError } from "./core/errors.js";
export { createMirrorAuth } from "./core/mirror.js";
export { safeReturnTo } from "./core/return-to.js";
export { fromAccessToken } from "./core/sources.js";
export { memoryStorage, webStorage } from "./core/storage.js";

export type {
	AuthDebug,
	AuthDebugEvent,
	AuthDebugOptions,
	AuthDebugType,
} from "./core/debug.js";
export type { AuthErrorCode, AuthErrorOptions } from "./core/errors.js";
export type {
	ClientCredentials,
	MirrorAuth,
	MirrorAuthOptions,
	MirrorCredentials,
} from "./core/mirror.js";
export type { SafeReturnToOptions } from "./core/return-to.js";
export type {
	AccessTokenUser,
	FromAccessTokenOptions,
	UserSource,
} from "./core/sources.js";
export type { AuthStorage, WebStorageOptions } from "./core/storage.js";

export type {
	AuthClient,
	AuthLocking,
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
