import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createElement as h, useEffect } from "react";

import { AuthError } from "@monarcode/session-kit";

import {
	act,
	newClient,
	render,
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
