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
 * The {@link CookieJar} for the request TanStack Start is handling, to pass
 * to `serverAuth` from `@monarcode/session-kit/server`. Use it in a server
 * function, request middleware, a server route, or `beforeLoad` and loaders
 * while they run on the server. Every call during one request returns the
 * same jar.
 *
 * Start adds its cookies to the response, a redirect's included, but not
 * once it has started streaming a page. A cookie set after that is lost, so
 * refresh before rendering, in request middleware with
 * `serverAuth.refreshIfDue`.
 *
 * Throws `INVALID_OPTIONS` outside a request, such as in the browser. Import
 * it only from server code, such as a server function's handler, so Start's
 * compiler leaves it out of the browser bundle.
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
			// Start gives no sign once a page streams, so this can't turn false.
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
