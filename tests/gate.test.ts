import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
	Component,
	createElement as h,
	useEffect,
	type ReactNode,
} from "react";

import {
	createAuth,
	memoryStorage,
	type AuthError,
	type AuthStorage,
} from "@monarcode/session-kit";
import { createAuthHooks } from "@monarcode/session-kit/react";

import { deferredStorage } from "./deferred-storage.ts";
import { act, render, settle, user, userSchema, useDom } from "./dom.ts";
import "./expo-modules.ts";
import { navigation } from "./mocks/expo-router.ts";
import { appState } from "./mocks/react-native.ts";

// After expo-modules.ts, so Expo Router and React Native are the mocks.
const { rememberDeepLink, SessionGate } =
	await import("@monarcode/session-kit/expo");
const { deepLinkPath }: typeof import("../dist/expo/deep-link.js") =
	await import(
		new URL(
			"./deep-link.js",
			import.meta.resolve("@monarcode/session-kit/expo"),
		).href
	);

useDom();
beforeEach(() => {
	navigation.reset();
	appState.reset();
});

const newClient = (storage: AuthStorage = memoryStorage()) =>
	createAuth({ name: "gate", user: userSchema, storage });
type Client = ReturnType<typeof newClient>;

const { AuthProvider } = createAuthHooks<Client>();

/** Counts how often it mounts, which a remount of the navigator shows. */
const mounts = { navigator: 0 };
function Navigator() {
	useEffect(() => {
		mounts.navigator++;
	}, []);
	return h("main", null, "navigator");
}

const unavailable = ({
	error,
	retry,
}: {
	error: AuthError | null;
	retry: () => void;
}) => {
	held.retry = retry;
	return h("p", { role: "alert" }, `unavailable: ${error?.code}`);
};
const held = { retry: () => {} };

function renderGate(
	auth: Client,
	props: { unavailable?: typeof unavailable } = { unavailable },
) {
	mounts.navigator = 0;
	return render(
		h(AuthProvider, { client: auth }, h(SessionGate, props, h(Navigator))),
	);
}

/** Storage whose reads fail while `locked`, as a locked iOS keychain does. */
function lockable(inner: AuthStorage = memoryStorage()) {
	const lock = {
		locked: true,
		storage: {
			...inner,
			get(key: string) {
				if (lock.locked) throw new Error("User interaction is not allowed");
				return inner.get(key);
			},
		} satisfies AuthStorage,
	};
	return lock;
}

test("renders nothing and keeps the splash screen while the session is restored", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	const inner = memoryStorage();
	const storage: AuthStorage = {
		...inner,
		async get(key) {
			await held;
			return inner.get(key);
		},
	};
	const view = await renderGate(newClient(storage));
	assert.equal(view.container.textContent, "");
	assert.equal(navigation.splashHides, 0);
	assert.equal(mounts.navigator, 0);
	release();
	await settle();
	assert.equal(view.container.textContent, "navigator");
	assert.equal(navigation.splashHides, 1);
});

test("a synchronous restore renders the navigator at once", async () => {
	const storage = memoryStorage();
	await newClient(storage).signIn({ accessToken: "access-1", user });
	const view = await renderGate(newClient(storage));
	assert.equal(view.container.textContent, "navigator");
	assert.equal(navigation.splashHides, 1);
});

test("shows unavailable instead of the navigator until retry succeeds", async () => {
	const lock = lockable();
	const auth = newClient(lock.storage);
	const view = await renderGate(auth);
	await settle();
	assert.equal(view.container.textContent, "unavailable: PERSISTENCE_FAILED");
	assert.equal(navigation.splashHides, 1);
	assert.equal(mounts.navigator, 0);
	lock.locked = false;
	await act(async () => held.retry());
	await settle();
	assert.equal(view.container.textContent, "navigator");
});

test("without unavailable, the error reaches the error boundary and the splash hides", async (t) => {
	t.mock.method(console, "error", () => {});
	class Boundary extends Component<
		{ children: ReactNode },
		{ error: unknown }
	> {
		override state = { error: null as unknown };
		static getDerivedStateFromError(error: unknown) {
			return { error };
		}
		override render() {
			const { error } = this.state;
			return error
				? h("p", null, `boundary: ${(error as AuthError).code}`)
				: this.props.children;
		}
	}
	const lock = lockable();
	const view = await render(
		h(
			AuthProvider,
			{ client: newClient(lock.storage) },
			h(Boundary, null, h(SessionGate, null, h(Navigator))),
		),
	);
	await settle();
	assert.equal(view.container.textContent, "boundary: PERSISTENCE_FAILED");
	assert.ok(navigation.splashHides >= 1);
});

test("re-checks the session on a return to the foreground, until unmounted", async () => {
	const auth = newClient();
	const mount = auth.mount;
	let calls = 0;
	auth.mount = () => {
		calls++;
		return mount();
	};
	const view = await renderGate(auth);
	const before = calls;
	assert.equal(appState.listeners, 1);
	await act(async () => {
		appState.change("background");
		appState.change("active");
	});
	assert.equal(calls, before + 1);
	await view.unmount();
	assert.equal(appState.listeners, 0);
});

test("remounts the navigator only when one account replaces another", async () => {
	const auth = newClient();
	await renderGate(auth);
	assert.equal(mounts.navigator, 1);
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	await act(() => auth.updateUser({ ...user, email: "alice@example.org" }));
	assert.equal(mounts.navigator, 1);
	await act(() =>
		auth.signIn({ accessToken: "access-2", user: { ...user, id: "bob" } }),
	);
	assert.equal(mounts.navigator, 2);
	// Signing out and in again: Stack.Protected removes the guarded screens.
	await act(() => auth.signOut());
	await act(() => auth.signIn({ accessToken: "access-3", user }));
	assert.equal(mounts.navigator, 2);
});

test("opens a link kept while signed out, once, after the sign-in", async () => {
	const auth = newClient();
	navigation.go("/login");
	await renderGate(auth);
	await act(async () => rememberDeepLink(auth, "myapp://profile?tab=2#top"));
	assert.deepEqual(navigation.replaced, []);
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/profile?tab=2#top"]);
	await act(() => auth.signOut());
	await act(async () => navigation.go("/login"));
	await act(() => auth.signIn({ accessToken: "access-2", user }));
	assert.equal(navigation.replaced.length, 1);
});

test("keeps a link that arrived before the session was restored", async () => {
	const auth = newClient(deferredStorage(memoryStorage()));
	rememberDeepLink(auth, "https://example.com/orders/42");
	navigation.go("/login");
	await renderGate(auth);
	await settle();
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/orders/42"]);
});

test("drops a link that opened while signed in", async () => {
	const auth = newClient();
	await auth.signIn({ accessToken: "access-1", user });
	await renderGate(auth);
	await act(async () => rememberDeepLink(auth, "myapp://profile"));
	await act(() => auth.signOut());
	await act(() => auth.signIn({ accessToken: "access-2", user }));
	assert.deepEqual(navigation.replaced, []);
});

test("drops a link to a screen anyone may see", async () => {
	const auth = newClient();
	navigation.go("/login");
	await renderGate(auth);
	await act(async () => rememberDeepLink(auth, "myapp://reset?token=1"));
	// Expo Router opened it: nothing guards that screen.
	await act(async () => navigation.go("/reset/"));
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, []);
});

test("keeps a link while unavailable, and opens it if a sign-in follows", async () => {
	const lock = lockable();
	const auth = newClient(lock.storage);
	navigation.go("/login");
	await renderGate(auth);
	await settle();
	await act(async () => rememberDeepLink(auth, "myapp://profile"));
	lock.locked = false;
	await act(async () => held.retry());
	await settle();
	assert.equal(auth.state.get().status, "unauthenticated");
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/profile"]);
});

test("a newer link replaces an older one, and unsafe links are ignored", async () => {
	const auth = newClient();
	navigation.go("/login");
	await renderGate(auth);
	await act(async () => {
		rememberDeepLink(auth, "myapp://orders/1");
		rememberDeepLink(auth, "myapp://orders/2");
		rememberDeepLink(auth, "https://example.com/.//evil.com");
		rememberDeepLink(auth, "myapp://login?redirectTo=x");
		rememberDeepLink(auth, "myapp://");
	});
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/orders/2"]);
});

test("rememberDeepLink checks loginPath like safeReturnTo", () => {
	const auth = newClient();
	assert.throws(
		() => rememberDeepLink(auth, "myapp://x", { loginPath: "login" }),
		/loginPath must start with "\/"/,
	);
});

test("deep links read as Expo Router reads them", () => {
	const cases: Array<[string, string]> = [
		["myapp://orders/42?x=1#top", "/orders/42?x=1#top"],
		["myapp:///orders/42", "/orders/42"],
		["MyApp://Orders", "/Orders"],
		// Extra slashes stay inside the app.
		["myapp:////evil.com", "/evil.com"],
		["https://example.com/orders/42?x=1", "/orders/42?x=1"],
		["exp://192.168.1.2:8081/--/orders/42", "/orders/42"],
		["exps://u.expo.dev/abc/--/orders/42?x=1", "/orders/42?x=1"],
		["/orders/42", "/orders/42"],
		// Launch URLs that name no screen.
		["exp://192.168.1.2:8081", "/"],
		["https://u.expo.dev/update/abc", "/"],
		["https://exp.host/@me/app", "/"],
		["myapp://expo-development-client/?url=http%3A%2F%2F10.0.0.5", "/"],
		["myapp://", "/"],
		["https://[bad", "/"],
	];
	for (const [url, path] of cases) assert.equal(deepLinkPath(url), path, url);
});
