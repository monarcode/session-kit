import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createElement as h, useEffect } from "react";

import { AuthError } from "@monarcode/session-kit";

import {
	act,
	heldRefresh,
	newClient,
	render,
	saveExpiredSession,
	settle,
	signIn,
	user,
	userSchema,
	useDom,
	type Client,
} from "./dom.ts";

type Router = typeof import("react-router");
type Binding = typeof import("@monarcode/session-kit/react-router");
type Hooks = typeof import("@monarcode/session-kit/react");

let router: Router;
let binding: Binding;
let hooks: Hooks;

useDom();
beforeEach(async () => {
	router = await import("react-router");
	binding = await import("@monarcode/session-kit/react-router");
	hooks = await import("@monarcode/session-kit/react");
});

/** Shows where the router is, so tests can assert on redirects. */
function Where() {
	const location = router.useLocation();
	return h("output", null, `login${location.search}`);
}

/** A home page that counts its mounts and shows the user's email. */
const homePage = (
	useAuth: (
		select: (state: { user: { email: string } | null }) => unknown,
	) => unknown,
) => {
	const page = {
		mounts: 0,
		Home() {
			const email = useAuth((state) => state.user?.email);
			useEffect(() => {
				page.mounts++;
			}, []);
			return h("output", null, `home:${String(email)}`);
		},
	};
	return page;
};

test("declarative mode: SessionOutlet guards, keeps, and swaps child routes", async () => {
	const auth = newClient();
	await signIn(auth);
	const { AuthProvider, useAuth } = hooks.createAuthHooks<Client>();
	const page = homePage(useAuth as never);
	const { MemoryRouter, Routes, Route } = router;
	const view = await render(
		h(
			AuthProvider,
			{ client: auth },
			h(
				MemoryRouter,
				{ initialEntries: ["/"] },
				h(
					Routes,
					null,
					h(Route, { path: "/login", element: h(Where) }),
					h(
						Route,
						{
							element: h(binding.SessionOutlet, {
								loginPath: "/login",
								pending: "checking",
							}),
						},
						h(Route, { index: true, element: h(page.Home) }),
					),
				),
			),
		),
	);
	assert.equal(view.container.textContent, "home:alice@example.com");
	await act(() => auth.updateUser({ ...user, email: "new@example.com" }));
	assert.equal(view.container.textContent, "home:new@example.com");
	assert.equal(page.mounts, 1);
	await act(() =>
		auth.signIn({
			accessToken: "bob-token",
			user: { id: "bob", email: "bob@example.com" },
		}),
	);
	assert.equal(view.container.textContent, "home:bob@example.com");
	assert.equal(page.mounts, 2);
	await act(() => auth.signOut());
	assert.equal(view.container.textContent, "login?redirectTo=%2F");
});

test("declarative mode: SessionOutlet shows pending while restoring", async () => {
	await signIn(newClient());
	let release!: () => void;
	const restored = new Promise<void>((resolve) => (release = resolve));
	// The saved user validates asynchronously, so restoring takes a while.
	const auth = newClient({
		user: userSchema.refine(async () => {
			await restored;
			return true;
		}),
	});
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { MemoryRouter, Routes, Route } = router;
	const view = await render(
		h(
			AuthProvider,
			{ client: auth },
			h(
				MemoryRouter,
				{ initialEntries: ["/private"] },
				h(
					Routes,
					null,
					h(Route, { path: "/login", element: h(Where) }),
					h(
						Route,
						{
							element: h(binding.SessionOutlet, {
								loginPath: "/login",
								pending: "checking",
							}),
						},
						h(Route, { path: "/private", element: "private" }),
					),
				),
			),
		),
	);
	assert.equal(view.container.textContent, "checking");
	release();
	await settle();
	assert.equal(view.container.textContent, "private");
});

test("declarative mode: StrictMode keeps the route while an expired session refreshes once", async () => {
	await saveExpiredSession();
	const held = heldRefresh();
	const auth = newClient({ refresh: held.refresh });
	const statuses: string[] = [];
	auth.state.subscribe((state) => statuses.push(state.status));
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { MemoryRouter, Routes, Route } = router;
	const view = await render(
		h(
			AuthProvider,
			{ client: auth },
			h(
				MemoryRouter,
				{ initialEntries: ["/private"] },
				h(
					Routes,
					null,
					h(
						Route,
						{
							element: h(binding.SessionOutlet, {
								loginPath: "/login",
								pending: "checking",
							}),
						},
						h(Route, { path: "/private", element: "private" }),
					),
				),
			),
		),
		{ strict: true },
	);
	await act(async () => held.respond());
	await settle();
	assert.equal(view.container.textContent, "private");
	assert.deepEqual(held.sent, ["refresh-1"]);
	assert.equal(statuses.includes("unavailable"), false);
});

test("data mode: StrictMode lets a loader's refresh finish and sends the token once", async () => {
	await saveExpiredSession();
	const held = heldRefresh();
	const auth = newClient({ refresh: held.refresh });
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { createMemoryRouter, RouterProvider, Outlet } = router;
	function Root() {
		binding.useAuthRevalidation();
		return h(Outlet);
	}
	const memory = createMemoryRouter(
		[
			{
				element: h(Root),
				errorElement: h("output", null, "error"),
				children: [
					{
						loader: ({ request }: { request: Request }) =>
							binding.requireSession(auth, {
								request,
								loginPath: "/login",
							}),
						element: h(binding.SessionOutlet, { loginPath: "/login" }),
						children: [{ index: true, element: "home" }],
					},
				],
			},
		],
		{ initialEntries: ["/"] },
	);
	const view = await render(
		h(AuthProvider, { client: auth }, h(RouterProvider, { router: memory })),
		{ strict: true },
	);
	await act(async () => held.respond());
	await settle();
	assert.equal(view.container.textContent, "home");
	assert.deepEqual(held.sent, ["refresh-1"]);
});

test("declarative mode: SessionOutlet sends signed-out users to sign in", async () => {
	const auth = newClient();
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { MemoryRouter, Routes, Route } = router;
	const view = await render(
		h(
			AuthProvider,
			{ client: auth },
			h(
				MemoryRouter,
				{ initialEntries: ["/private?tab=2"] },
				h(
					Routes,
					null,
					h(Route, { path: "/login", element: h(Where) }),
					h(
						Route,
						{
							element: h(binding.SessionOutlet, { loginPath: "/login" }),
						},
						h(Route, { path: "/private", element: "private" }),
					),
				),
			),
		),
	);
	await settle();
	assert.equal(
		view.container.textContent,
		"login?redirectTo=%2Fprivate%3Ftab%3D2",
	);
});

test("SessionOutlet offers a retry when access is unavailable", async () => {
	let offline = true;
	const auth = newClient({
		refresh: async () => {
			if (offline) throw new Error("offline");
			return { accessToken: "access-2" };
		},
	});
	await auth.signIn({
		accessToken: "access-1",
		refreshToken: "refresh-1",
		user,
	});
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { MemoryRouter, Routes, Route } = router;
	let retry: (() => void) | undefined;
	const view = await render(
		h(
			AuthProvider,
			{ client: auth },
			h(
				MemoryRouter,
				null,
				h(
					Routes,
					null,
					h(
						Route,
						{
							element: h(binding.SessionOutlet, {
								loginPath: "/login",
								unavailable: (props: {
									error: AuthError | null;
									retry: () => void;
								}) => {
									retry = props.retry;
									return `unavailable:${props.error?.code}`;
								},
							}),
						},
						h(Route, { index: true, element: "home" }),
					),
				),
			),
		),
	);
	const credentials = await auth.credentials.get();
	await act(() => auth.credentials.renew(credentials!).catch(() => {}));
	assert.equal(view.container.textContent, "unavailable:REFRESH_FAILED");
	offline = false;
	await act(async () => retry?.());
	await settle();
	assert.equal(view.container.textContent, "home");
});

test("data mode: loaders guard routes and re-run when auth changes", async () => {
	const auth = newClient();
	await signIn(auth);
	const { AuthProvider, useAuth } = hooks.createAuthHooks<Client>();
	const page = homePage(useAuth as never);
	const { createMemoryRouter, RouterProvider, Outlet } = router;
	let loads = 0;
	function Root() {
		binding.useAuthRevalidation();
		return h(Outlet);
	}
	const memory = createMemoryRouter(
		[
			{
				element: h(Root),
				children: [
					{
						path: "/login",
						loader: async ({ request }: { request: Request }) => {
							const redirectTo = new URL(request.url).searchParams.get(
								"redirectTo",
							);
							await binding.redirectIfSignedIn(auth, { redirectTo });
							return null;
						},
						element: h(Where),
					},
					{
						loader: async ({ request }: { request: Request }) => {
							loads++;
							return binding.requireSession(auth, {
								request,
								loginPath: "/login",
							});
						},
						element: h(binding.SessionOutlet, { loginPath: "/login" }),
						children: [{ index: true, element: h(page.Home) }],
					},
				],
			},
		],
		{ initialEntries: ["/"] },
	);
	const view = await render(
		h(AuthProvider, { client: auth }, h(RouterProvider, { router: memory })),
	);
	await settle();
	assert.equal(view.container.textContent, "home:alice@example.com");
	// A profile update re-runs loaders without leaving the page.
	const before = loads;
	await act(() => auth.updateUser({ ...user, email: "new@example.com" }));
	await settle();
	assert.ok(loads > before);
	assert.equal(view.container.textContent, "home:new@example.com");
	assert.equal(page.mounts, 1);
	await act(() => auth.signOut());
	await settle();
	assert.equal(memory.state.location.pathname, "/login");
	assert.equal(memory.state.location.search, "?redirectTo=%2F");
	await act(() => signIn(auth));
	await act(() => memory.navigate("/login?redirectTo=%2F"));
	await settle();
	assert.equal(memory.state.location.pathname, "/");
	assert.equal(view.container.textContent, "home:alice@example.com");
});

test("loader guards redirect with the requested URL and never leave the site", async () => {
	const auth = newClient();
	await auth.getSession();
	const request = new Request("https://auth.test/private?tab=2#top");
	const redirected = await binding
		.requireSession(auth, { request, loginPath: "/login" })
		.then(
			() => assert.fail("Expected a redirect"),
			(response: Response) => response,
		);
	assert.equal(redirected.status, 302);
	assert.equal(
		redirected.headers.get("Location"),
		"/login?redirectTo=%2Fprivate%3Ftab%3D2%23top",
	);
	await signIn(auth);
	const { session } = await binding.requireSession(auth, {
		request,
		loginPath: "/login",
	});
	assert.deepEqual(session, await auth.getSession());
	for (const redirectTo of ["https://evil.example/", "/.//evil.example"]) {
		const away = await binding.redirectIfSignedIn(auth, { redirectTo }).then(
			() => assert.fail("Expected a redirect"),
			(response: Response) => response,
		);
		assert.equal(away.headers.get("Location"), "/", redirectTo);
	}
	await assert.rejects(
		binding.requireSession(auth, { request, loginPath: "login" }),
		/loginPath must start with/,
	);
});

test("data mode: SessionOutlet waits for the loader to accept a new account", async () => {
	const auth = newClient();
	await signIn(auth);
	const { AuthProvider, useAuth } = hooks.createAuthHooks<Client>();
	const { createMemoryRouter, RouterProvider, Outlet, useRouteLoaderData } =
		router;
	let hold: Promise<void> | undefined;
	const mismatches: string[] = [];
	function Root() {
		binding.useAuthRevalidation();
		return h(Outlet);
	}
	function Home() {
		const id = useAuth((state) => state.user?.id);
		const data = useRouteLoaderData("guarded") as {
			session: { user: { id: string } };
		};
		if (data.session.user.id !== id)
			mismatches.push(`${String(id)} saw ${data.session.user.id}'s data`);
		return h("output", null, `home:${data.session.user.id}`);
	}
	const memory = createMemoryRouter(
		[
			{
				element: h(Root),
				children: [
					{
						id: "guarded",
						loader: async ({ request }: { request: Request }) => {
							const guarded = await binding.requireSession(auth, {
								request,
								loginPath: "/login",
							});
							await hold;
							return guarded;
						},
						element: h(binding.SessionOutlet, {
							loginPath: "/login",
							pending: "checking",
						}),
						children: [{ index: true, element: h(Home) }],
					},
				],
			},
		],
		{ initialEntries: ["/"] },
	);
	const view = await render(
		h(AuthProvider, { client: auth }, h(RouterProvider, { router: memory })),
	);
	await settle();
	assert.equal(view.container.textContent, "home:alice");
	let release!: () => void;
	hold = new Promise((resolve) => (release = resolve));
	// Another account signs in, as from another tab; the loader has yet to run again.
	await act(() =>
		auth.signIn({
			accessToken: "bob-token",
			user: { id: "bob", email: "bob@example.com" },
		}),
	);
	await settle();
	assert.equal(view.container.textContent, "checking");
	release();
	await settle();
	assert.equal(view.container.textContent, "home:bob");
	assert.deepEqual(mismatches, []);
});

test("data mode: requireSession leaves the basename out of redirectTo", async () => {
	const auth = newClient();
	const { AuthProvider } = hooks.createAuthHooks<Client>();
	const { createMemoryRouter, RouterProvider } = router;
	const memory = createMemoryRouter(
		[
			{
				path: "/login",
				loader: async ({ request }: { request: Request }) => {
					const redirectTo = new URL(request.url).searchParams.get(
						"redirectTo",
					);
					await binding.redirectIfSignedIn(auth, { redirectTo });
					return null;
				},
				element: "login",
			},
			{
				path: "/private",
				loader: ({ request }: { request: Request }) =>
					binding.requireSession(auth, {
						request,
						loginPath: "/login",
						basename: "/app",
					}),
				element: "private",
			},
		],
		{ basename: "/app", initialEntries: ["/app/private?tab=2"] },
	);
	await render(
		h(AuthProvider, { client: auth }, h(RouterProvider, { router: memory })),
	);
	await settle();
	const where = () =>
		memory.state.location.pathname + memory.state.location.search;
	assert.equal(where(), "/app/login?redirectTo=%2Fprivate%3Ftab%3D2");
	await act(() => signIn(auth));
	await act(() => memory.revalidate());
	await settle();
	assert.equal(where(), "/app/private?tab=2");
});

test("requireSession strips the basename ignoring case and trailing slashes", async () => {
	const auth = newClient();
	await auth.getSession();
	const location = async (url: string, basename?: string) => {
		const request = new Request(`https://auth.test${url}`);
		const response = await binding
			.requireSession(auth, { request, loginPath: "/login", basename })
			.then(
				() => assert.fail("Expected a redirect"),
				(thrown: Response) => thrown,
			);
		return response.headers.get("Location");
	};
	assert.equal(
		await location("/app/private", "/app/"),
		"/login?redirectTo=%2Fprivate",
	);
	assert.equal(
		await location("/APP/private", "/app"),
		"/login?redirectTo=%2Fprivate",
	);
	assert.equal(await location("/app", "/app"), "/login?redirectTo=%2F");
	assert.equal(await location("/apple", "/app"), "/login?redirectTo=%2Fapple");
	assert.equal(
		await location("/private", "/"),
		"/login?redirectTo=%2Fprivate",
	);
	await assert.rejects(
		binding.requireSession(auth, {
			request: new Request("https://auth.test/app"),
			loginPath: "/login",
			basename: "app",
		}),
		/basename must start with/,
	);
});
