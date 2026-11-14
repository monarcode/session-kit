/**
 * Marks a server request's session at runtime, so code that takes a client,
 * such as Effect's `Auth`, can tell one apart. Its value returns the session
 * bound to the current request: the session itself for `forRequest`'s, the
 * current request's for one that finds its request on each call. A global
 * symbol, so two copies of the package agree.
 */
export const REQUEST_SESSION: unique symbol = Symbol.for(
	"@monarcode/session-kit/request-session",
);

/** The session bound to the current request, when `client` is a request's. */
export function boundSession(client: object): object | undefined {
	const bind = (client as { [REQUEST_SESSION]?: () => object })[
		REQUEST_SESSION
	];
	return typeof bind === "function" ? bind() : undefined;
}
