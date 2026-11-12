import {
	refreshesSettled,
	type CookieJar,
	type CookieOptions,
} from "./cookies.js";

/** A cookie jar over a `Request` and the `Response` that answers it. */
export type RequestJar = {
	/**
	 * Reads the request's `Cookie` header and records `Set-Cookie` lines, the
	 * last write to each name winning. Read-only once the response is out.
	 */
	readonly jar: CookieJar;
	/**
	 * Runs `respond`, waits for refreshes under way on the jar so their tokens
	 * are saved, then makes the jar read-only and returns the response with
	 * its cookies.
	 */
	respond: (respond: () => Promise<Response>) => Promise<Response>;
};

const SAME_SITE = { lax: "Lax", strict: "Strict", none: "None" } as const;

function setCookieLine(
	name: string,
	value: string,
	options: CookieOptions,
): string {
	return [
		`${name}=${value}`,
		`Path=${options.path}`,
		...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
		...(options.maxAge === undefined
			? ["Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"]
			: [`Max-Age=${options.maxAge}`]),
		`SameSite=${SAME_SITE[options.sameSite]}`,
		...(options.secure ? ["Secure"] : []),
		"HttpOnly",
	].join("; ");
}

/**
 * The `Cookie` header's values by name, the first of each as servers read them.
 */
function parseCookies(header: string | null): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const pair of header?.split(";") ?? []) {
		const equals = pair.indexOf("=");
		if (equals === -1) continue;
		const name = pair.slice(0, equals).trim();
		if (name && !cookies.has(name))
			cookies.set(name, pair.slice(equals + 1).trim());
	}
	return cookies;
}

/** `response` with `lines` as `Set-Cookie` headers. */
function withCookies(response: Response, lines: string[]): Response {
	try {
		for (const line of lines) response.headers.append("Set-Cookie", line);
		return response;
	} catch {
		// Immutable headers, as on `Response.redirect()` or a `fetch` response.
		const copy = new Response(response.body, response);
		for (const line of lines) copy.headers.append("Set-Cookie", line);
		return copy;
	}
}

/**
 * The cookie jar of `request`, whose cookies `respond` sets on its response.
 */
export function requestJar(request: Request): RequestJar {
	let sent: Map<string, string> | undefined;
	const written = new Map<string, string>();
	let committed = false;
	const jar: CookieJar = {
		get writable() {
			return !committed;
		},
		// The request's cookies only, never those written since. `jarStorage`
		// keeps its own copy of what it writes.
		get: (name) =>
			(sent ??= parseCookies(request.headers.get("cookie"))).get(name),
		set(name, value, options) {
			if (!committed) written.set(name, setCookieLine(name, value, options));
		},
		delete(name, options) {
			if (!committed)
				written.set(
					name,
					setCookieLine(name, "", { ...options, maxAge: undefined }),
				);
		},
	};
	return {
		jar,
		async respond(respond) {
			let response: Response;
			try {
				response = await respond();
			} finally {
				// Even when `respond` throws: no response will carry later writes,
				// so the jar turns read-only and calls that would write reject.
				await refreshesSettled(jar);
				committed = true;
			}
			return written.size === 0
				? response
				: withCookies(response, [...written.values()]);
		},
	};
}
