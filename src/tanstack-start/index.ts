import { AuthError } from "../core/errors.js";
import { mirrorOf, type MirrorAuth } from "../core/mirror.js";
import type { Session } from "../core/types.js";
import { connectAuth, type AuthRouter } from "../tanstack-router/connect.js";

/** What the server render sends to the browser for the session. */
type DehydratedSession = {
	/** Whether `loadSession` read the session on the server for this page. */
	loaded: boolean;
	session: Session<unknown> | null;
};

/**
 * The router's own `dehydrate` result is kept beside the session, so the
 * app's `hydrate` gets exactly what its `dehydrate` returned.
 */
type Dehydrated = { sessionKit: DehydratedSession; app: unknown };

type SessionRouter<U> = AuthRouter & {
	options: {
		context: { auth: MirrorAuth<U> };
		dehydrate?: (() => unknown) | undefined;
		hydrate?: ((dehydrated: never) => unknown) | undefined;
	};
};

const hydrated = new WeakSet<object>();

/**
 * Connects a TanStack Start router to the browser client in its context, as
 * `auth`. Call it once in `getRouter`, after `createRouter`.
 *
 * It carries the session from the server render to the browser. On the
 * server, the page is sent with the session {@link loadSession} read. In the
 * browser, the client starts from it before the first render, without
 * running guards again or telling other tabs. When the server didn't read
 * the session, the browser reads it itself.
 *
 * In the browser, it then does what `connectAuth` does for a TanStack Router
 * app: guards run again when the session changes. It returns a function
 * that stops.
 *
 * Throws `INVALID_OPTIONS` when the router's context has no client from
 * `createMirrorAuth` as `auth`.
 *
 * A `dehydrate` and a `hydrate` of your own keep working: yours gets back
 * what yours sent. Pass them to `createRouter`. One set later, such as with
 * `router.update`, replaces the session's.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import { connectSession } from "@monarcode/session-kit/tanstack-start";
 * import {
 * 	createRootRouteWithContext,
 * 	createRouter,
 * } from "@tanstack/react-router";
 *
 * declare function createAppAuth(): MirrorAuth<{ id: number }>;
 *
 * // Start calls it for each request on the server, and once in the browser.
 * export function getRouter() {
 * 	const auth = createAppAuth();
 * 	const routeTree = createRootRouteWithContext<{ auth: typeof auth }>()();
 * 	const router = createRouter({ routeTree, context: { auth } });
 * 	connectSession(router);
 * 	return router;
 * }
 * ```
 *
 * @see {@link loadSession} to read the session before the guards run
 *
 * @since 0.1.0
 */
export function connectSession<U>(router: SessionRouter<U>): () => void {
	// Read with care: JavaScript, or a router made without a context, can
	// get here with no client at all.
	const auth: MirrorAuth<U> | undefined = router.options?.context?.auth;
	const mirror = auth && mirrorOf(auth);
	if (!mirror)
		throw new AuthError(
			"INVALID_OPTIONS",
			"connectSession needs a createMirrorAuth client as context.auth",
		);
	if (!hydrated.has(router)) {
		hydrated.add(router);
		const { options } = router;
		const ownDehydrate = options.dehydrate;
		const ownHydrate = options.hydrate;
		// The router reads both options when it calls them, so they can change
		// after `createRouter`. It calls them with the options as `this`.
		options.dehydrate = async function dehydrate(
			this: unknown,
		): Promise<Dehydrated> {
			const app = await ownDehydrate?.call(this);
			const { sessionId, user } = auth.state.get();
			return {
				sessionKit: {
					loaded: mirror.answered,
					session:
						sessionId !== null && user !== null
							? { sessionId, user }
							: null,
				},
				app,
			};
		};
		options.hydrate = function hydrate(
			this: unknown,
			dehydrated: Dehydrated | undefined,
		) {
			// `undefined` when the server sent no data, as from a router that
			// wasn't connected there.
			const sent = dehydrated?.sessionKit;
			if (sent?.loaded) mirror.hydrate(sent.session as Session<U> | null);
			return ownHydrate?.call(this, dehydrated?.app as never);
		} as (dehydrated: never) => unknown;
	}
	return connectAuth(router);
}

/**
 * Reads this request's session into the client. Call it in the root route's
 * `beforeLoad`.
 *
 * On the server, it calls the client's `revalidate`, so guards and the page
 * see the session from the cookie. In the browser, it does nothing when
 * {@link connectSession} already brought the server's session. Otherwise,
 * such as for a root route that didn't render on the server, it asks the
 * server on each navigation until a read succeeds.
 *
 * Rejects as the client's `retry()` does when the read fails.
 *
 * @example
 * ```ts
 * import type { MirrorAuth } from "@monarcode/session-kit";
 * import { loadSession } from "@monarcode/session-kit/tanstack-start";
 * import { createRootRouteWithContext } from "@tanstack/react-router";
 *
 * type User = { id: number; firstName: string };
 * declare const auth: MirrorAuth<User>;
 *
 * type Context = { auth: typeof auth };
 *
 * export const rootRoute = createRootRouteWithContext<Context>()({
 * 	beforeLoad: ({ context }) => loadSession(context.auth),
 * });
 * ```
 *
 * @since 0.1.0
 */
export async function loadSession<U>(auth: MirrorAuth<U>): Promise<void> {
	// On the server, always read: each request has its own cookie.
	if (typeof document !== "undefined" && mirrorOf(auth)?.answered) return;
	await auth.retry();
}
