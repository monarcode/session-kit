import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, createElement as h, StrictMode } from "react";
import { JSDOM } from "jsdom";
import { z } from "zod";
import { createAuth } from "@monarcode/tanstack-auth";

let dom, roots, originalGlobals;
let createRoot, RouterContextProvider, createRouter, createRootRoute;
let createMemoryHistory, useAuth, useAuthClient;

beforeEach(async () => {
	dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://auth.test/",
	});
	roots = new Set();
	const globals = {
		window: dom.window,
		self: dom.window,
		document: dom.window.document,
		location: dom.window.location,
		localStorage: dom.window.localStorage,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	originalGlobals = new Map(Object.keys(globals).map((name) => [
		name, Object.getOwnPropertyDescriptor(globalThis, name),
	]));
	for (const [name, value] of Object.entries(globals)) {
		Object.defineProperty(globalThis, name, {
			configurable: true, writable: true, value,
		});
	}
	// Load DOM-aware modules after installing the browser environment.
	({ createRoot } = await import("react-dom/client"));
	({ RouterContextProvider, createRouter, createRootRoute, createMemoryHistory } =
		await import("@tanstack/react-router"));
	({ useAuth, useAuthClient } = await import("@monarcode/tanstack-auth/react"));
});

afterEach(async () => {
	try {
		await act(async () => {
			for (const root of roots) root.unmount();
		});
	} finally {
		dom.window.close();
		for (const [name, descriptor] of originalGlobals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	}
});

const user = { id: "alice", email: "alice@example.com" };
const signIn = (auth) => auth.signIn({ accessToken: "access-1", user });

async function fixture() {
	const auth = createAuth({
		name: "react-test",
		userSchema: z.object({ id: z.string(), email: z.string() }),
	});
	await auth.getSession();
	const router = createRouter({
		routeTree: createRootRoute({}),
		context: { auth },
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return { auth, router };
}

async function mount(router, Component, { strict = false } = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.add(root);
	const tree = h(RouterContextProvider, { router }, h(Component));
	await act(async () => root.render(strict ? h(StrictMode, null, tree) : tree));
	return {
		container,
		async unmount() {
			await act(async () => root.unmount());
			roots.delete(root);
			container.remove();
		},
	};
}

test("useAuth renders sign-in, profile updates, and sign-out", async () => {
	const { auth, router } = await fixture();
	function Profile() {
		const state = useAuth();
		return h("output", null, `${state.status}:${state.user?.email ?? "none"}`);
	}
	const { container } = await mount(router, Profile);
	assert.equal(container.textContent, "unauthenticated:none");
	await act(async () => signIn(auth));
	assert.equal(container.textContent, "authenticated:alice@example.com");
	await act(async () => auth.updateUser({ ...user, email: "updated@example.com" }));
	assert.equal(container.textContent, "authenticated:updated@example.com");
	await act(async () => auth.signOut());
	assert.equal(container.textContent, "unauthenticated:none");
});

test("useAuth selector skips unrelated updates and renders changed selections", async () => {
	const { auth, router } = await fixture();
	await signIn(auth);
	let renders = 0;
	function Identity() {
		const id = useAuth((state) => state.user?.id);
		renders++;
		return h("output", null, id ?? "none");
	}
	const { container } = await mount(router, Identity);
	const before = renders;
	await act(async () => auth.updateUser({ ...user, email: "updated@example.com" }));
	assert.equal(auth.state.get().user.email, "updated@example.com");
	assert.equal(renders, before);
	assert.equal(container.textContent, "alice");
	await act(async () => auth.signIn({
		accessToken: "bob-token", user: { id: "bob", email: "bob@example.com" },
	}));
	assert.ok(renders > before);
	assert.equal(container.textContent, "bob");
	await act(async () => auth.signOut());
	assert.equal(container.textContent, "none");
});

test("useAuthClient retains the Router client across reactive renders", async () => {
	const { auth, router } = await fixture();
	const clients = [];
	function Consumer() {
		const state = useAuth();
		clients.push(useAuthClient());
		return h("output", null, state.user?.email ?? "none");
	}
	const { container } = await mount(router, Consumer);
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
	test(`useAuth cleans up subscriptions${strict ? " under StrictMode" : ""}`, async () => {
		const { auth, router } = await fixture();
		const subscribe = auth.state.subscribe;
		let subscriptions = 0, unsubscriptions = 0, notifications = 0;
		auth.state.subscribe = (listener) => {
			subscriptions++;
			const subscription = subscribe((value) => {
				notifications++;
				listener(value);
			});
			return { unsubscribe() {
				unsubscriptions++;
				subscription.unsubscribe();
			} };
		};
		function Profile() {
			const state = useAuth();
			return h("output", null, state.user?.email ?? "none");
		}
		const mounted = await mount(router, Profile, { strict });
		assert.equal(subscriptions - unsubscriptions, 1);
		if (strict) {
			// Verify StrictMode actually exercised effect cleanup and remount.
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
		const remounted = await mount(router, Profile, { strict });
		assert.equal(remounted.container.textContent, "none");
		assert.equal(subscriptions - unsubscriptions, 1);
		await act(async () => signIn(auth));
		assert.equal(remounted.container.textContent, "alice@example.com");
		await remounted.unmount();
		assert.equal(subscriptions, unsubscriptions);
	});
}
