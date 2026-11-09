import { AuthError } from "./errors.js";

/** `new URL(url, base)`, throwing `INVALID_OPTIONS` for an invalid URL. */
export function parseUrl(url: string, base?: URL): URL {
	try {
		return new URL(url, base);
	} catch (cause) {
		throw new AuthError("INVALID_OPTIONS", `Not a valid URL: ${url}`, {
			cause,
		});
	}
}
