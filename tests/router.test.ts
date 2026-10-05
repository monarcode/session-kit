import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthError } from "@monarcode/session-kit";
import {
	connectAuth,
	redirectIfSignedIn,
	requireSession,
} from "@monarcode/session-kit/tanstack-router";

import {
	user,
	cleanups,
	deferred,
	flush,
	input,
	client,
	code,
	connectCounting,
	recordStates,
	credentialsOf,
	setGlobal,
	type TestClient,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

test("Router connection is idempotent and token-only proactive refresh does not invalidate", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => ({
			accessToken: "access-2",
			expiresAt: 1_050_000,
		}),
	});
	let invalidations = 0;
	const router = {
		options: { context: { auth } },
		clearCache() {},
		async invalidate() {
			invalidations++;
		},
	};
	const off = connectAuth(router);
	cleanups.push(off);
	assert.equal(connectAuth(router), off);
	await flush();
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	await flush();
	const before = invalidations;
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(invalidations, before);
	await auth.updateUser({ ...user, email: "updated" });
	await flush();
	assert.equal(invalidations, before + 1);
	off();
	cleanups.pop();
	t.mock.timers.reset();
});

test("a throwing subscriber is reported without interrupting auth or other subscribers", async (t) => {
	const auth = client();
	await auth.getSession();
	const reported: string[] = [];
	t.mock.method(globalThis, "queueMicrotask", (callback: () => void) => {
		try {
			callback();
		} catch (error) {
			reported.push((error as Error).message);
		}
	});
	const failing = auth.state.subscribe((state) => {
		if (state.status === "authenticated") throw new Error("consumer bug");
	});
	cleanups.push(() => failing.unsubscribe());
	const states = recordStates(auth);
	await auth.signIn(input());
	assert.equal(auth.state.get().status, "authenticated");
	assert.deepEqual(
		states.map((state) => state.status),
		["authenticated"],
	);
	assert.deepEqual(reported, ["consumer bug"]);
});

test("401-triggered token-only refresh keeps the user and does not invalidate", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = { ...auth.state.get(), invalidations: router.invalidations };
	const states = recordStates(auth);
	const pending = auth.credentials.renew(await credentialsOf(auth));
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	assert.equal(auth.state.get().user?.id, "alice");
	gate.resolve({ accessToken: "access-2" });
	assert.equal((await pending)?.accessToken, "access-2");
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().version, before.version);
	assert.equal(router.invalidations, before.invalidations);
	assert.ok(states.every((state) => state.user?.id === "alice"));
});

test("refresh failure after rejection becomes unavailable and invalidates once", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = router.invalidations;
	const states = recordStates(auth);
	const pending = auth.credentials.renew(await credentialsOf(auth));
	const checked = assert.rejects(pending, code("REFRESH_FAILED"));
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	gate.reject(new Error("offline"));
	await checked;
	await flush();
	assert.deepEqual(
		states.map((state) => state.status),
		["refreshing", "unavailable"],
	);
	assert.equal(auth.state.get().user, null);
	assert.equal(auth.state.get().error?.code, "REFRESH_FAILED");
	assert.equal(router.invalidations, before + 1);
});

test("terminal refresh rejection signs out with one invalidation", async () => {
	const auth = client({ refresh: async () => null });
	const router = connectCounting(auth);
	await flush();
	await auth.signIn(input());
	await flush();
	const before = router.invalidations;
	assert.equal(await auth.credentials.renew(await credentialsOf(auth)), null);
	await flush();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(router.invalidations, before + 1);
});

/** A real TanStack Router guarding `/private`, counting guard runs and invalidations. */
const realRouter = async (auth: TestClient) => {
	setGlobal("self", globalThis);
	setGlobal("scrollTo", () => {});
	setGlobal("window", {
		location: new URL("https://example.com/private"),
		addEventListener() {},
		removeEventListener() {},
	});
	const {
		createRouter,
		createRootRouteWithContext,
		createRoute,
		createMemoryHistory,
		redirect,
	} = await import("@tanstack/react-router");
	const counts = { guardCalls: 0, invalidations: 0 };
	const root = createRootRouteWithContext<{ auth: TestClient }>()({});
	const login = createRoute({ getParentRoute: () => root, path: "/login" });
	const privateRoute = createRoute({
		getParentRoute: () => root,
		path: "/private",
		beforeLoad: async ({ context }) => {
			counts.guardCalls++;
			if (!(await context.auth.getSession()))
				throw redirect({ to: "/login" });
		},
	});
	const router = createRouter({
		routeTree: root.addChildren([login, privateRoute]),
		context: { auth },
		history: createMemoryHistory({ initialEntries: ["/private"] }),
		isServer: false,
	});
	// Run transitions synchronously; there is no React renderer here.
	router.startTransition = (async (fn: () => void) => {
		fn();
		return true;
	}) as unknown as typeof router.startTransition;
	const invalidate = router.invalidate.bind(router);
	router.invalidate = (...args: Parameters<typeof invalidate>) => {
		counts.invalidations++;
		return invalidate(...args);
	};
	cleanups.push(connectAuth(router));
	await router.load();
	return Object.assign(router, { counts });
};

const settle = async () => {
	for (let i = 0; i < 20; i++) await new Promise(setImmediate);
};

const privateMatch = (router: Awaited<ReturnType<typeof realRouter>>) =>
	router.state.matches.find((match) => match.routeId === "/private");

test("real Router guards rerun after logout and produce a login redirect", async () => {
	const auth = client();
	await auth.signIn(input());
	const router = await realRouter(auth);
	assert.equal(router.state.location.pathname, "/private");
	await auth.signOut();
	await new Promise(setImmediate);
	assert.ok(router.counts.guardCalls >= 2);
	assert.equal(router.state.location.pathname, "/login");
});

test("a failed refresh reruns real Router guards once without retrying until retry()", async () => {
	let refreshes = 0;
	let offline = true;
	const auth = client({
		refresh: async () => {
			refreshes++;
			await new Promise(setImmediate);
			if (offline) throw new Error("offline");
			return { accessToken: "access-2" };
		},
	});
	await auth.signIn(input());
	const router = await realRouter(auth);
	const guardCalls = router.counts.guardCalls;
	await assert.rejects(
		auth.credentials.renew(await credentialsOf(auth)),
		code("REFRESH_FAILED"),
	);
	await settle();
	assert.equal(refreshes, 1);
	assert.equal(router.counts.invalidations, 1);
	assert.equal(router.counts.guardCalls, guardCalls + 1);
	assert.equal(auth.state.get().status, "unavailable");
	assert.equal(
		(privateMatch(router)?.error as AuthError | undefined)?.code,
		"REFRESH_FAILED",
	);
	await assert.rejects(auth.getSession(), code("REFRESH_FAILED"));
	assert.equal(refreshes, 1);

	offline = false;
	assert.equal((await auth.retry())?.user.id, "alice");
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	await settle();
	assert.equal(refreshes, 2);
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(privateMatch(router)?.status, "success");
});

/** A real Router whose `/private` uses `requireSession` and `/login` `redirectIfSignedIn`. */
const guardedRouter = async (auth: TestClient, path: string) => {
	setGlobal("self", globalThis);
	setGlobal("scrollTo", () => {});
	setGlobal("window", {
		location: new URL(`https://example.com${path}`),
		addEventListener() {},
		removeEventListener() {},
	});
	const {
		createRouter,
		createRootRouteWithContext,
		createRoute,
		createMemoryHistory,
	} = await import("@tanstack/react-router");
	const root = createRootRouteWithContext<{ auth: TestClient }>()({});
	const login = createRoute({
		getParentRoute: () => root,
		path: "/login",
		validateSearch: (search: Record<string, unknown>) => ({
			redirectTo: search.redirectTo,
		}),
		beforeLoad: ({ context, search }) =>
			redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
	});
	const privateRoute = createRoute({
		getParentRoute: () => root,
		path: "/private",
		beforeLoad: ({ context, location }) =>
			requireSession(context.auth, { location, loginPath: "/login" }),
	});
	const router = createRouter({
		routeTree: root.addChildren([login, privateRoute]),
		context: { auth },
		history: createMemoryHistory({ initialEntries: [path] }),
		isServer: false,
	});
	router.startTransition = (async (fn: () => void) => {
		fn();
		return true;
	}) as unknown as typeof router.startTransition;
	await router.load();
	return router;
};

test("requireSession sends signed-out users to sign in, then back", async () => {
	const auth = client();
	await auth.getSession();
	const router = await guardedRouter(auth, "/private?tab=2");
	assert.equal(router.state.location.pathname, "/login");
	const { redirectTo } = router.state.location.search as {
		redirectTo?: unknown;
	};
	assert.equal(redirectTo, "/private?tab=2");
	await auth.signIn(input());
	await router.navigate({ to: "/login", search: { redirectTo } });
	assert.equal(router.state.location.href, "/private?tab=2");
});

test("requireSession puts the session, without tokens, in route context", async () => {
	const auth = client();
	await auth.signIn(input());
	const router = await guardedRouter(auth, "/private");
	const match = router.state.matches.find(
		(candidate) => candidate.routeId === "/private",
	);
	const session = (
		match?.context as { session?: Record<string, unknown> } | undefined
	)?.session;
	assert.deepEqual(session, await auth.getSession());
	assert.equal("accessToken" in (session ?? {}), false);
});

test("redirectIfSignedIn never returns to sign-in or leaves the site", async () => {
	const auth = client();
	await auth.signIn(input());
	for (const redirectTo of [
		"https://evil.example/",
		"/.//evil.example",
		"/login",
	]) {
		const router = await guardedRouter(
			auth,
			`/login?redirectTo=${encodeURIComponent(redirectTo)}`,
		);
		assert.equal(router.state.location.pathname, "/");
	}
});

test("requireSession reads a session that changes mid-check again", async () => {
	const session = { sessionId: "a", user };
	let checks = 0;
	const settling = {
		getSession: async () => session,
		isCurrent: () => ++checks > 1,
	};
	const options = { location: { href: "/private" }, loginPath: "/login" };
	assert.deepEqual(await requireSession(settling, options), { session });
	const churning = { getSession: async () => session, isCurrent: () => false };
	await assert.rejects(
		requireSession(churning, options),
		code("SESSION_CHANGED"),
	);
	await assert.rejects(
		requireSession(churning, { ...options, loginPath: "login" }),
		/loginPath must start with/,
	);
});

test("connectAuth does nothing while a Router renders on a server", () => {
	const auth = client();
	let mounted = 0;
	auth.mount = () => {
		mounted++;
		return () => {};
	};
	const disconnect = connectAuth({
		isServer: true,
		options: { context: { auth } },
		clearCache() {},
		async invalidate() {},
	});
	disconnect();
	assert.equal(mounted, 0);
	assert.equal(auth.state.get().status, "initializing");
});
