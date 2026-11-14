import { AuthError } from "./errors.js";

/**
 * Which part of auth an {@link AuthDebugEvent} comes from, such as `refresh`
 * or `storage`. These names don't change between releases, so filter on them.
 *
 * `sync` events report changes from other tabs and, with server rendering,
 * from the server. `gate`, `deep-link` and `foreground` events come from
 * `@monarcode/session-kit/expo`.
 *
 * @example
 * ```ts
 * import type { AuthDebugEvent, AuthDebugType } from "@monarcode/session-kit";
 *
 * const watched = new Set<AuthDebugType>(["refresh", "timer"]);
 *
 * function log(event: AuthDebugEvent) {
 * 	if (watched.has(event.type)) console.info(event.message, event.data);
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthDebugType =
	| "state"
	| "restore"
	| "storage"
	| "refresh"
	| "timer"
	| "sync"
	| "sign-in"
	| "sign-out"
	| "mount"
	| "gate"
	| "deep-link"
	| "foreground"
	| "lock";

/**
 * One thing auth did, sent to the `debug` option ({@link AuthDebug}).
 *
 * Filter on `type`, which doesn't change between releases. `message` and
 * `data` are for reading, and may change in any release. Events are frozen,
 * so copy one before changing it.
 *
 * @example
 * ```ts
 * import type { AuthDebugEvent } from "@monarcode/session-kit";
 *
 * declare function breadcrumb(message: string, data?: object): void;
 *
 * function report(event: AuthDebugEvent) {
 * 	breadcrumb(`${event.name} ${event.type}: ${event.message}`, {
 * 		...event.data,
 * 		code: event.error?.code,
 * 	});
 * }
 * ```
 *
 * @since 0.1.0
 */
export type AuthDebugEvent = Readonly<{
	/** The `name` option of the client that reports it. */
	name: string;
	/** Which part of auth it comes from. */
	type: AuthDebugType;
	/** One readable line, such as `started (proactive)`. */
	message: string;
	/** Details, such as `status`, `sessionId`, or `durationMs`. */
	data?: Readonly<Record<string, unknown>> | undefined;
	/**
	 * The failure, when the event reports one. Without `sensitive`, it comes
	 * without its `cause` and `issues`, which can hold tokens or user fields.
	 */
	error?: AuthError | undefined;
}>;

/**
 * The object form of `createAuth`'s `debug` option ({@link AuthDebug}):
 * where events go, and whether they include secrets.
 *
 * @example
 * ```ts
 * import type { AuthDebugOptions } from "@monarcode/session-kit";
 *
 * const debug: AuthDebugOptions = {
 * 	log: (event) => console.debug(event),
 * 	sensitive: location.hostname === "localhost",
 * };
 * ```
 *
 * @since 0.1.0
 */
export type AuthDebugOptions = {
	/** Receives every event. Default: one `console.info` line per event. */
	log?: ((event: AuthDebugEvent) => void) | undefined;
	/**
	 * Also puts tokens, saved values, user fields, whole deep-link paths and
	 * error details in events. Anyone who reads such logs can act as the user,
	 * so use it only in development.
	 * @default false
	 */
	sensitive?: boolean | undefined;
};

/**
 * What `createAuth`'s `debug` option takes:
 * - `true`: log every event to the console.
 * - A function: receive every {@link AuthDebugEvent}.
 * - {@link AuthDebugOptions}: choose where events go, and whether they
 *   include secrets.
 * - `false`, or leaving it out: no logging.
 *
 * @example
 * ```ts
 * import type { AuthDebug } from "@monarcode/session-kit";
 *
 * const toConsole: AuthDebug = true;
 * const toLogger: AuthDebug = (event) =>
 * 	console.debug(event.type, event.message);
 * const withSecrets: AuthDebug = { sensitive: true };
 * ```
 *
 * @since 0.1.0
 */
export type AuthDebug =
	| boolean
	| ((event: AuthDebugEvent) => void)
	| AuthDebugOptions;

/** What auth's own code reports through. Every method is a no-op while off. */
export type Debugger = {
	readonly on: boolean;
	readonly sensitive: boolean;
	log(
		type: AuthDebugType,
		message: string,
		data?: Record<string, unknown>,
		error?: AuthError,
	): void;
	/**
	 * `fields` while `sensitive`, otherwise nothing, for spreading into `data`.
	 */
	secret(fields: Record<string, unknown>): Record<string, unknown>;
};

const off: Debugger = {
	on: false,
	sensitive: false,
	log() {},
	secret: () => ({}),
};

function consoleLog(event: AuthDebugEvent) {
	// `info`, not `debug`: browser consoles hide `debug` by default.
	console.info(
		`[session-kit:${event.name}] ${event.type}: ${event.message}`,
		...(event.data ? [event.data] : []),
		...(event.error ? [event.error] : []),
	);
}

/**
 * `error` without what may hold secrets: a cause such as an HTTP client's
 * error can carry the refresh request, and schema issues the invalid value.
 */
function redacted(error: AuthError): AuthError {
	const copy = new AuthError(error.code, error.message);
	if (error.stack !== undefined) copy.stack = error.stack;
	return copy;
}

export function createDebugger(
	name: string,
	option: AuthDebug | undefined,
): Debugger {
	if (!option) return off;
	const { log = consoleLog, sensitive = false }: AuthDebugOptions =
		option === true
			? {}
			: typeof option === "function"
				? { log: option }
				: option;
	return {
		on: true,
		sensitive,
		log(type, message, data, error) {
			const event: AuthDebugEvent = Object.freeze({
				name,
				type,
				message,
				// A copy: the caller may keep changing its own object.
				...(data &&
					Object.keys(data).length > 0 && {
						data: Object.freeze({ ...data }),
					}),
				...(error && { error: sensitive ? error : redacted(error) }),
			});
			try {
				log(event);
			} catch (failure) {
				// A failing logger must not interrupt what it reports.
				queueMicrotask(() => {
					throw failure;
				});
			}
		},
		secret: (fields) => (sensitive ? fields : {}),
	};
}

/**
 * What identifies a client to adapters: its `state`, which wrappers such as
 * `{ ...auth }` or `{ state: auth.state, mount: auth.mount }` pass along.
 */
export type ClientKey = { readonly state: object };

// Adapters such as `SessionGate` get only the client, so they find its
// debugger here.
const debuggers = new WeakMap<object, Debugger>();

export function registerDebugger(client: ClientKey, debug: Debugger): void {
	if (debug.on) debuggers.set(client.state, debug);
}

/** The debugger of a client made by `createAuth`, or one that is off. */
export function debuggerOf(client: ClientKey): Debugger {
	return debuggers.get(client.state) ?? off;
}

/** Seconds, rounded, for messages such as `expires in 58s`. */
export const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
