export { createServerAuth } from "./auth.js";
export { sessionHandler } from "./handler.js";

export type { ClientCredentials } from "../core/mirror.js";
export type {
	RefreshIfDueOptions,
	RequestAuth,
	ServerAuth,
	ServerAuthOptions,
	SessionCookieOptions,
	SessionMiddlewareOptions,
} from "./auth.js";
export type { CookieJar, CookieOptions } from "./cookies.js";
export type { SessionHandler } from "./handler.js";
