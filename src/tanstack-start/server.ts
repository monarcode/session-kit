import {
	deleteCookie,
	getCookie,
	getRequest,
	setCookie,
} from "@tanstack/react-start/server";

import { AuthError } from "../core/errors.js";
import type { CookieJar, CookieOptions } from "../server/cookies.js";

/** `options` without unset attributes, which Start's types don't accept. */
function attributes({ domain, maxAge, ...rest }: CookieOptions) {
	return {
		...rest,
		...(domain !== undefined && { domain }),
		...(maxAge !== undefined && { maxAge }),
	};
}

// One jar per request, so every call while Start handles it shares one.
const jars = new WeakMap<Request, CookieJar>();

/**
 * The {@link CookieJar} of the request TanStack Start is handling, for
 * `serverAuth` from `@monarcode/session-kit/server`: in a server function,
 * request middleware, a server route, or `beforeLoad` and loaders while they
 * run on the server. Every call during one request returns the same jar.
 * Start applies its cookies to the response, including a redirect's, but not
 * once it has started streaming a page: a cookie set after that is lost, so
 * refresh before rendering with `serverAuth.refreshIfDue` in request middleware.
 * Throws `INVALID_OPTIONS` outside a request, such as in the browser.
 *
 * Import it only from server code, such as a server function's handler:
 * Start's compiler then leaves it out of the browser bundle.
 *
 * @example
 * ```ts
 * import type { ServerAuth } from "@monarcode/session-kit/server";
 * import { startJar } from "@monarcode/session-kit/tanstack-start/server";
 * import { createServerFn } from "@tanstack/react-start";
 *
 * type User = { id: number; firstName: string };
 * declare const serverAuth: ServerAuth<User, User>;
 *
 * export const getSessionFn = createServerFn().handler(() =>
 * 	serverAuth.getSession(startJar()),
 * );
 * ```
 *
 * @since 0.1.0
 */
export function startJar(): CookieJar {
	let request: Request;
	try {
		request = getRequest();
	} catch (cause) {
		throw new AuthError(
			"INVALID_OPTIONS",
			"Call startJar() on the server while TanStack Start handles a request, such as in a server function or request middleware",
			{ cause },
		);
	}
	let jar = jars.get(request);
	if (!jar) {
		jar = {
			writable: true,
			get: (name) => getCookie(name),
			set: (name, value, options) =>
				setCookie(name, value, attributes(options)),
			delete: (name, options) => deleteCookie(name, attributes(options)),
		};
		jars.set(request, jar);
	}
	return jar;
}
