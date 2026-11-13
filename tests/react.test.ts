import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
	createElement as h,
	useEffect,
	type FunctionComponent,
	type ReactNode,
} from "react";

import { webStorage } from "@monarcode/session-kit";
import type { AuthHooks } from "@monarcode/session-kit/react";
import type { AnyRouter } from "@tanstack/react-router";

import { deferredStorage } from "./deferred-storage.ts";
import {
	act,
	dom,
	firstPaint,
	newClient,
	render,
	settle,
	signIn,
	user,
	useDom,
	type Client,
} from "./dom.ts";

type ReactBinding = typeof import("@monarcode/session-kit/react");
type RouterBinding = typeof import("@monarcode/session-kit/tanstack-router");
type RouterModule = typeof import("@tanstack/react-router");

let routerModule: RouterModule;
let binding: ReactBinding;
let routerBinding: RouterBinding;

useDom();
beforeEach(async () => {
	routerModule = await import("@tanstack/react-router");
	binding = await import("@monarcode/session-kit/react");
	routerBinding = await import("@monarcode/session-kit/tanstack-router");
});

/**
 * Hooks for `auth` and a way to render under them: through an `AuthProvider`
 * from `createAuthHooks`, through `./react`'s registered one, or from Router
 * context with `./tanstack-router`'s hooks.
 */
type Setup = {
	hooks: Pick<AuthHooks<Client>, "useAuth" | "useAuthClient">;
	wrap: (child: ReactNode) => ReactNode;
};

const setups: Record<string, (auth: Client) => Setup> = {
	provider(auth) {
		const hooks = binding.createAuthHooks<Client>();
		return {
			hooks,
			wrap: (child) => h(hooks.AuthProvider, { client: auth }, child),
		};
	},
	registered(auth) {
		return {
			// The tests register no client, so the types are the unregistered ones.
			hooks: {
				useAuth: binding.useAuth,
				useAuthClient: binding.useAuthClient,
			} as unknown as Setup["hooks"],
			wrap: (child) => h(binding.AuthProvider, { client: auth }, child),
		};
	},
	router(auth) {
		const router = routerModule.createRouter({
			routeTree: routerModule.createRootRoute({}),
			context: { auth },
			history: routerModule.createMemoryHistory({ initialEntries: ["/"] }),
		});
		return {
			// The tests register no Router, so the types are `never`.
			hooks: {
				useAuth: routerBinding.useAuth,
				useAuthClient: routerBinding.useAuthClient,
			} as unknown as Setup["hooks"],
			wrap: (child) =>
				h(routerModule.RouterContextProvider, {
					router: router as AnyRouter,
					children: child,
				}),
		};
	},
};

/**
 * A TanStack Router whose `/` renders `Home` behind `requireSession` and a
 * `SessionOutlet` showing `pending`, with a sign-in page that renders "login".
 */
function sessionOutletRouter(
	auth: Client,
	{ Home, pending }: { Home: FunctionComponent; pending: string },
) {
	const {
		createRouter,
		createRootRouteWithContext,
		createRoute,
		createMemoryHistory,
	} = routerModule;
	const { requireSession, SessionOutlet } = routerBinding;
	const root = createRootRouteWithContext<{ auth: Client }>()({});
	const login = createRoute({
		getParentRoute: () => root,
		path: "/login",
		component: () => h("output", null, "login"),
	});
	const guarded = createRoute({
		getParentRoute: () => root,
		id: "guarded",
		beforeLoad: ({ context, location }) =>
			requireSession(context.auth, { location, loginPath: "/login" }),
		component: () => h(SessionOutlet, { pending }),
	});
	const home = createRoute({
		getParentRoute: () => guarded,
		path: "/",
		component: Home,
	});
	return createRouter({
		routeTree: root.addChildren([login, guarded.addChildren([home])]),
		context: { auth },
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
}

async function fixture(kind: string) {
	const auth = newClient();
	await auth.getSession();
	const setup = setups[kind](auth);
	const mount = (Component: FunctionComponent, options = {}) =>
		render(setup.wrap(h(Component)), options);
	return { auth, ...setup.hooks, mount };
}

for (const kind of Object.keys(setups)) {
	test(`useAuth renders sign-in, profile updates, and sign-out (${kind})`, async () => {
		const { auth, useAuth, mount } = await fixture(kind);
		function Profile() {
			const state = useAuth();
			return h(
				"output",
				null,
				`${state.status}:${state.user?.email ?? "none"}`,
			);
		}
		const { container } = await mount(Profile);
		assert.equal(container.textContent, "unauthenticated:none");
		await act(async () => signIn(auth));
		assert.equal(container.textContent, "authenticated:alice@example.com");
		await act(async () =>
			auth.updateUser({ ...user, email: "updated@example.com" }),
		);
		assert.equal(container.textContent, "authenticated:updated@example.com");
		await act(async () => auth.signOut());
		assert.equal(container.textContent, "unauthenticated:none");
	});

	test(`useAuth selector skips unrelated updates and renders changed selections (${kind})`, async () => {
		const { auth, useAuth, mount } = await fixture(kind);
		await signIn(auth);
		let renders = 0;
		function Identity() {
			const id = useAuth((state) => state.user?.id);
			renders++;
			return h("output", null, id ?? "none");
		}
		const { container } = await mount(Identity);
		const before = renders;
		await act(async () =>
			auth.updateUser({ ...user, email: "updated@example.com" }),
		);
		assert.equal(auth.state.get().user?.email, "updated@example.com");
		assert.equal(renders, before);
		assert.equal(container.textContent, "alice");
		await act(async () =>
			auth.signIn({
				accessToken: "bob-token",
				user: { id: "bob", email: "bob@example.com" },
			}),
		);
		assert.ok(renders > before);
		assert.equal(container.textContent, "bob");
		await act(async () => auth.signOut());
		assert.equal(container.textContent, "none");
	});

	test(`useAuth accepts inline selectors that return new objects (${kind})`, async () => {
		const { auth, useAuth, mount } = await fixture(kind);
		function Status() {
			const { status } = useAuth((state) => ({ status: state.status }));
			return h("output", null, status);
		}
		const { container } = await mount(Status, { strict: true });
		assert.equal(container.textContent, "unauthenticated");
		await act(async () => signIn(auth));
		assert.equal(container.textContent, "authenticated");
		await act(async () => auth.signOut());
		assert.equal(container.textContent, "unauthenticated");
	});

	test(`useAuthClient retains the client across reactive renders (${kind})`, async () => {
		const { auth, useAuth, useAuthClient, mount } = await fixture(kind);
		const clients: Client[] = [];
		function Consumer() {
			const state = useAuth();
			clients.push(useAuthClient());
			return h("output", null, state.user?.email ?? "none");
		}
		const { container } = await mount(Consumer);
		for (const action of [
			() => signIn(auth),
			() => auth.updateUser({ ...user, email: "updated@example.com" }),
			() => auth.signOut(),
		]) {
			const before = clients.length;
			await act(action);
			assert.ok(clients.length > before);
		}
		assert.equal(container.textContent, "none");
		assert.ok(clients.every((client) => client === auth));
	});

	for (const strict of [false, true]) {
		test(`useAuth cleans up subscriptions${strict ? " under StrictMode" : ""} (${kind})`, async () => {
			const { auth, useAuth, mount } = await fixture(kind);
			const subscribe = auth.state.subscribe;
			let subscriptions = 0,
				unsubscriptions = 0,
				notifications = 0;
			auth.state.subscribe = (listener) => {
				subscriptions++;
				const subscription = subscribe((value) => {
					notifications++;
					listener(value);
				});
				return {
					unsubscribe() {
						unsubscriptions++;
						subscription.unsubscribe();
					},
				};
			};
			function Profile() {
				const state = useAuth();
				return h("output", null, state.user?.email ?? "none");
			}
			const mounted = await mount(Profile, { strict });
			assert.equal(subscriptions - unsubscriptions, 1);
			if (strict) {
				assert.ok(subscriptions >= 2);
				assert.ok(unsubscriptions >= 1);
			}
			await act(async () => signIn(auth));
			assert.equal(mounted.container.textContent, "alice@example.com");
			assert.ok(notifications > 0);
			await mounted.unmount();
			assert.equal(subscriptions, unsubscriptions);
			const before = notifications;
			await act(async () => auth.signOut());
			assert.equal(notifications, before);
			const remounted = await mount(Profile, { strict });
			assert.equal(remounted.container.textContent, "none");
			assert.equal(subscriptions - unsubscriptions, 1);
			await act(async () => signIn(auth));
			assert.equal(remounted.container.textContent, "alice@example.com");
			await remounted.unmount();
			assert.equal(subscriptions, unsubscriptions);
		});
	}
}

for (const synchronous of [true, false]) {
	test(`AuthProvider's first paint ${synchronous ? "shows the restored session from synchronous storage" : "is pending with asynchronous storage"}`, async () => {
		await signIn(newClient());
		const storage = synchronous
			? webStorage()
			: deferredStorage(webStorage());
		const auth = newClient({ storage });
		const { AuthProvider, useAuth } = binding.createAuthHooks<Client>();
		function Status() {
			return h(
				"output",
				null,
				useAuth((state) => state.status),
			);
		}
		const painted = await firstPaint(
			h(AuthProvider, { client: auth }, h(Status)),
		);
		assert.equal(painted, synchronous ? "authenticated" : "initializing");
		await settle();
		assert.equal(auth.state.get().status, "authenticated");
	});
}

test("without a document, as on React Native, AuthProvider restores in a layout effect", async () => {
	await signIn(newClient());
	const auth = newClient({ storage: webStorage() });
	const { AuthProvider } = binding.createAuthHooks<Client>();
	// Every layout effect runs before any passive effect, and a child's
	// passive effect runs before its parent's. So this child sees the
	// restored session only if AuthProvider mounted in a layout effect.
	let seen: string | undefined;
	function Probe() {
		useEffect(function recordStatus() {
			seen = auth.state.get().status;
		}, []);
		return null;
	}
	// The root is made first: without a document, `render` couldn't make one.
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.createElement("div"));
	const document = Object.getOwnPropertyDescriptor(globalThis, "document")!;
	delete (globalThis as { document?: unknown }).document;
	try {
		await act(async () =>
			root.render(h(AuthProvider, { client: auth }, h(Probe))),
		);
	} finally {
		Object.defineProperty(globalThis, "document", document);
	}
	await act(async () => root.unmount());
	assert.equal(seen, "authenticated");
});

test("AuthProvider mounts its client while rendered", async () => {
	const auth = newClient();
	const mount = auth.mount;
	let mounted = 0;
	auth.mount = () => {
		mounted++;
		const unmount = mount();
		return () => {
			mounted--;
			unmount();
		};
	};
	const { AuthProvider, useAuth } = binding.createAuthHooks<Client>();
	function Status() {
		return h(
			"output",
			null,
			useAuth((state) => state.status),
		);
	}
	const view = await render(h(AuthProvider, { client: auth }, h(Status)), {
		strict: true,
	});
	assert.equal(mounted, 1);
	// Mounting restores the saved session without a separate getSession().
	assert.equal(view.container.textContent, "unauthenticated");
	await view.unmount();
	assert.equal(mounted, 0);
});

for (const [kind, useAuth, message] of [
	[
		"createAuthHooks",
		() => binding.createAuthHooks<Client>().useAuth,
		/Render AuthProvider/,
	],
	["registered", () => binding.useAuth, /Render AuthProvider/],
	[
		"useClient",
		() =>
			binding.createAuthHooks<Client>({
				useClient: () => null as unknown as Client,
			}).useAuth,
		/useClient did not return an auth client/,
	],
] as const)
	test(`hooks without a client explain what is missing (${kind})`, async () => {
		const useStatus = useAuth() as AuthHooks<Client>["useAuth"];
		function Status() {
			return h(
				"output",
				null,
				useStatus((state) => state.status),
			);
		}
		const errors: unknown[] = [];
		const onError = (event: ErrorEvent) => {
			errors.push(event.error);
			event.preventDefault();
		};
		dom.window.addEventListener("error", onError);
		const consoleError = console.error;
		console.error = () => {};
		try {
			await render(h(Status)).catch((error) => errors.push(error));
		} finally {
			console.error = consoleError;
			dom.window.removeEventListener("error", onError);
		}
		assert.ok(
			errors.some((error) => message.test((error as Error)?.message ?? "")),
		);
	});

test("SessionOutlet keeps child routes through profile updates and swaps them on account changes", async () => {
	const auth = newClient();
	await signIn(auth);
	const useAuth =
		routerBinding.useAuth as unknown as AuthHooks<Client>["useAuth"];
	let homeMounts = 0;
	function Home() {
		const email = useAuth((state) => state.user?.email);
		useEffect(function countMount() {
			homeMounts++;
		}, []);
		return h("output", null, `home:${email}`);
	}
	const router = sessionOutletRouter(auth, { Home, pending: "checking" });
	const disconnect = routerBinding.connectAuth(router);
	try {
		await act(() => router.load());
		const view = await render(
			h(routerModule.RouterProvider, { router: router as AnyRouter }),
		);
		await settle();
		assert.equal(view.container.textContent, "home:alice@example.com");
		assert.equal(homeMounts, 1);

		await act(() => auth.updateUser({ ...user, email: "new@example.com" }));
		await settle();
		assert.equal(view.container.textContent, "home:new@example.com");
		assert.equal(homeMounts, 1);

		await act(() =>
			auth.signIn({
				accessToken: "bob-token",
				user: { id: "bob", email: "bob@example.com" },
			}),
		);
		await settle();
		assert.equal(view.container.textContent, "home:bob@example.com");
		assert.equal(homeMounts, 2);

		await act(() => auth.signOut());
		await settle();
		assert.equal(view.container.textContent, "login");
		assert.equal(
			(router.state.location.search as { redirectTo?: unknown }).redirectTo,
			"/",
		);
	} finally {
		disconnect();
	}
});

test("SessionOutlet shows pending for a locked session, and the guard sends it to sign in", async () => {
	const auth = newClient({ locking: true });
	await signIn(auth);
	const router = sessionOutletRouter(auth, {
		Home: () => h("output", null, "home"),
		pending: "checking",
	});
	await act(() => router.load());
	const view = await render(
		h(routerModule.RouterProvider, { router: router as AnyRouter }),
	);
	await settle();
	assert.equal(view.container.textContent, "home");
	// Not connected, so only the outlet sees the lock.
	await act(() => auth.lock());
	assert.equal(view.container.textContent, "checking");
	await act(() => router.invalidate());
	await settle();
	assert.equal(view.container.textContent, "login");
});
