import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
	Component,
	createElement as h,
	StrictMode,
	useEffect,
	useState,
	type ReactNode,
} from "react";

import {
	createAuth,
	memoryStorage,
	type AuthDebugEvent,
	type AuthError,
	type AuthStorage,
	type RefreshFn,
} from "@monarcode/session-kit";
import type { UnavailableProps } from "@monarcode/session-kit/expo";
import { createAuthHooks } from "@monarcode/session-kit/react";

import { deferredStorage } from "./deferred-storage.ts";
import { act, render, settle, user, userSchema, useDom } from "./dom.ts";
import { rememberDeepLink, SessionGate } from "./expo-modules.ts";
import { lockable } from "./helpers.ts";
import { navigation } from "./mocks/expo-router.ts";
import { appState } from "./mocks/react-native.ts";

useDom();
beforeEach(() => {
	navigation.reset();
	appState.reset();
});

const newClient = (
	storage: AuthStorage = memoryStorage(),
	refresh?: RefreshFn<typeof user>,
) => createAuth({ name: "gate", user: userSchema, storage, refresh });
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

const unavailable = ({ error, retry }: UnavailableProps) => {
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

test("given a client and no AuthProvider, it restores the session itself", async () => {
	const storage = memoryStorage();
	await newClient(storage).signIn({ accessToken: "access-1", user });
	const auth = newClient(storage);
	const view = await render(
		h(SessionGate, { client: auth, unavailable }, h(Navigator)),
	);
	await settle();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(view.container.textContent, "navigator");
	assert.equal(navigation.splashHides, 1);
});

test("refreshes on a return to the foreground, until unmounted", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	let refreshes = 0;
	const auth = newClient(memoryStorage(), async () => ({
		accessToken: `access-${++refreshes + 1}`,
		expiresIn: 600,
	}));
	await auth.signIn({
		accessToken: "access-1",
		refreshToken: "refresh-1",
		expiresIn: 600,
		user,
	});
	const view = await renderGate(auth);
	// Two hours in the background, with no timer run, as iOS suspends them.
	appState.change("background");
	t.mock.timers.setTime(Date.now() + 2 * 60 * 60 * 1000);
	await act(async () => appState.change("active"));
	await settle();
	assert.equal(refreshes, 1);
	assert.equal(auth.state.get().status, "authenticated");
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
		rememberDeepLink(auth, "myapp://?utm=x");
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

test("deep links read as Expo Router reads them", async () => {
	const cases: Array<[string, string | undefined]> = [
		["myapp://orders/42?x=1#top", "/orders/42?x=1#top"],
		["myapp:///orders/42", "/orders/42"],
		["MyApp://Orders", "/Orders"],
		// Extra slashes stay inside the app.
		["myapp:////evil.com", "/evil.com"],
		["https://example.com/orders/42?x=1", "/orders/42?x=1"],
		["exp://192.168.1.2:8081/--/orders/42", "/orders/42"],
		["exps://u.expo.dev/abc/--/orders/42?x=1", "/orders/42?x=1"],
		["/orders/42", "/orders/42"],
		// Launch URLs that name no screen, so there is nothing to open.
		["exp://192.168.1.2:8081", undefined],
		["exp://192.168.1.2:8081/--/?x=1", undefined],
		["https://u.expo.dev/update/abc", undefined],
		["https://exp.host/@me/app", undefined],
		["myapp://expo-development-client/?url=http%3A%2F%2F10.0.0.5", undefined],
		["myapp://", undefined],
		["https://[bad", undefined],
	];
	for (const [url, path] of cases) {
		const auth = newClient();
		navigation.reset();
		navigation.go("/login");
		const view = await renderGate(auth);
		await act(async () => rememberDeepLink(auth, url));
		await act(() => auth.signIn({ accessToken: "access-1", user }));
		assert.deepEqual(navigation.replaced, path ? [path] : [], url);
		await view.unmount();
	}
});

/** Sets the `ready` prop of the gate `renderReady` rendered. */
const readiness: { set?: (ready: boolean) => void } = {};

function renderReady(auth: Client, initial: boolean, strict = false) {
	mounts.navigator = 0;
	function Root() {
		const [ready, setReady] = useState(initial);
		useEffect(() => {
			readiness.set = setReady;
		}, []);
		return h(
			AuthProvider,
			{ client: auth },
			h(SessionGate, { ready, unavailable }, h(Navigator)),
		);
	}
	return render(strict ? h(StrictMode, null, h(Root)) : h(Root));
}

const setReady = (ready: boolean) => act(async () => readiness.set?.(ready));

test("ready: false keeps the splash screen up after the session is restored", async () => {
	const storage = memoryStorage();
	await newClient(storage).signIn({ accessToken: "access-1", user });
	const view = await renderReady(newClient(storage), false);
	await settle();
	assert.equal(view.container.textContent, "");
	assert.equal(navigation.splashHides, 0);
	assert.equal(mounts.navigator, 0);
	await setReady(true);
	assert.equal(view.container.textContent, "navigator");
	assert.equal(navigation.splashHides, 1);
});

test("ready going false after the first screen changes nothing on screen", async () => {
	const view = await renderReady(newClient(), true);
	await setReady(false);
	assert.equal(view.container.textContent, "navigator");
	assert.equal(mounts.navigator, 1);
	await setReady(true);
	assert.equal(navigation.splashHides, 1);
});

test("unavailable access waits for ready too", async () => {
	const lock = lockable();
	const view = await renderReady(newClient(lock.storage), false);
	await settle();
	assert.equal(view.container.textContent, "");
	assert.equal(navigation.splashHides, 0);
	await setReady(true);
	assert.equal(view.container.textContent, "unavailable: PERSISTENCE_FAILED");
	assert.equal(navigation.splashHides, 1);
});

test("the deep link opened after a sign-in waits for ready", async () => {
	const auth = newClient();
	navigation.go("/login");
	await renderReady(auth, true);
	await act(async () => rememberDeepLink(auth, "myapp://profile"));
	await setReady(false);
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, []);
	await setReady(true);
	assert.deepEqual(navigation.replaced, ["/profile"]);
});

test("a link isn't judged by the launch URL while the gate is held", async () => {
	const auth = newClient();
	// At launch, the pathname is still the link's own.
	navigation.go("/profile");
	await renderReady(auth, false);
	await act(async () => rememberDeepLink(auth, "myapp://profile"));
	await settle();
	// Stack.Protected sends the signed-out user to the sign-in screen.
	await act(async () => navigation.go("/login"));
	await setReady(true);
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/profile"]);
});

/** A client whose debug events are collected as `type: message` lines. */
function debugClient(sensitive = false, storage = memoryStorage()) {
	const lines: string[] = [];
	const events: AuthDebugEvent[] = [];
	const auth = createAuth({
		name: "gate",
		user: userSchema,
		storage,
		debug: {
			sensitive,
			log: (event) => {
				events.push(event);
				lines.push(`${event.type}: ${event.message}`);
			},
		},
	});
	return { auth, lines, events };
}

test("debug reports why the splash screen is held, and when it hides", async () => {
	const { auth, lines } = debugClient();
	await renderReady(auth, false);
	await settle();
	await setReady(true);
	const gate = lines.filter((line) => line.startsWith("gate: "));
	assert.deepEqual(gate.slice(-2), [
		"gate: holding the splash screen: waiting for ready",
		"gate: hid the splash screen",
	]);
});

test("debug reports deep links without their query unless sensitive", async () => {
	for (const sensitive of [false, true]) {
		navigation.reset();
		navigation.go("/login");
		const { auth, lines, events } = debugClient(sensitive);
		const view = await renderReady(auth, true);
		await act(async () =>
			rememberDeepLink(auth, "myapp://reset?token=s3cret"),
		);
		await act(() => auth.signIn({ accessToken: "access-1", user }));
		assert.ok(
			lines.includes("deep-link: remembered /reset"),
			lines.join("\n"),
		);
		assert.ok(lines.includes("deep-link: /reset: waiting for a sign-in"));
		assert.ok(
			lines.includes("deep-link: /reset: opening it after the sign-in"),
		);
		const logged = JSON.stringify(events);
		assert.equal(logged.includes("s3cret"), sensitive);
		await view.unmount();
	}
});

test("debug reports a return to the foreground", async () => {
	const { auth, lines } = debugClient();
	await renderReady(auth, true);
	await act(async () => {
		appState.change("background");
		appState.change("active");
	});
	assert.ok(
		lines.includes(
			"foreground: back in the foreground: re-checking the session",
		),
	);
});

test("a cold-start link isn't dropped while the pathname is still the launch URL's", async () => {
	for (const ready of [true, false]) {
		navigation.reset();
		const auth = newClient();
		// Expo Router reads the launch URL before the navigator mounts.
		navigation.go("/profile");
		rememberDeepLink(auth, "myapp://profile");
		const view = await renderReady(auth, ready);
		await settle();
		// The navigator mounts while the pathname is still the launch URL's.
		await setReady(true);
		// Then Stack.Protected sends the signed-out user to the sign-in screen.
		await act(async () => navigation.go("/login"));
		await act(() => auth.signIn({ accessToken: "access-1", user }));
		assert.deepEqual(navigation.replaced, ["/profile"], `ready: ${ready}`);
		await view.unmount();
	}
});

test("a cold-start link to a screen anyone may see isn't opened after a sign-in", async () => {
	const auth = newClient();
	navigation.go("/reset");
	rememberDeepLink(auth, "myapp://reset");
	await renderGate(auth);
	await settle();
	// Nothing guards the screen, so it stays on it.
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, []);
});

test("a remounted gate doesn't hold again once the first screen was shown", async () => {
	const auth = newClient();
	const first = await renderReady(auth, true);
	assert.equal(first.container.textContent, "navigator");
	await first.unmount();
	const second = await renderReady(auth, false);
	assert.equal(second.container.textContent, "navigator");
});

test("gate events don't repeat under StrictMode", async () => {
	const { auth, lines } = debugClient();
	await renderReady(auth, false, true);
	await settle();
	await setReady(true);
	const gate = lines.filter((line) => line.startsWith("gate: "));
	assert.deepEqual(gate, [...new Set(gate)], gate.join("\n"));
	assert.ok(gate.includes("gate: hid the splash screen"));
});

test("the error boundary path is reported once", async (t) => {
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
			return this.state.error
				? h("p", null, "boundary")
				: this.props.children;
		}
	}
	const { auth, lines } = debugClient(false, lockable().storage);
	const view = await render(
		h(
			Boundary,
			null,
			h(AuthProvider, { client: auth }, h(SessionGate, null, h(Navigator))),
		),
	);
	await settle();
	assert.equal(view.container.textContent, "boundary");
	assert.equal(
		lines.filter((line) => line.includes("throwing to the error boundary"))
			.length,
		1,
	);
});

test("a client passed as a wrapper still reports, and keeps its links", async () => {
	const { auth, lines } = debugClient();
	const wrapper = { state: auth.state, mount: auth.mount, retry: auth.retry };
	navigation.go("/login");
	await render(h(SessionGate, { client: wrapper }, h(Navigator)));
	await act(async () => rememberDeepLink(auth, "myapp://profile"));
	await act(() => auth.signIn({ accessToken: "access-1", user }));
	assert.deepEqual(navigation.replaced, ["/profile"]);
	assert.ok(lines.includes("gate: hid the splash screen"), lines.join("\n"));
	assert.ok(
		lines.includes("deep-link: /profile: opening it after the sign-in"),
	);
});

/** A client that restores a saved session as `locked`. */
const lockingClient = (storage: AuthStorage) =>
	createAuth({ name: "gate", user: userSchema, storage, locking: true });

/** A locked client, as at launch after an earlier sign-in. */
async function lockedClient() {
	const storage = memoryStorage();
	await lockingClient(storage).signIn({ accessToken: "access-1", user });
	return lockingClient(storage);
}

test("a locked session settles the gate, and a cold-start link opens after unlock", async () => {
	const auth = await lockedClient();
	navigation.go("/profile");
	rememberDeepLink(auth, "myapp://profile");
	const view = await renderGate(auth);
	await settle();
	assert.equal(auth.state.get().status, "locked");
	assert.equal(view.container.textContent, "navigator");
	assert.equal(navigation.splashHides, 1);
	// The app's guards send a locked session to its unlock screen.
	await act(async () => navigation.go("/welcome-back"));
	assert.deepEqual(navigation.replaced, []);
	await act(async () => {
		await auth.unlock();
	});
	assert.deepEqual(navigation.replaced, ["/profile"]);
	assert.equal(mounts.navigator, 1);
});

test("unlocking, locking, and a password sign-in from locked keep the navigator", async () => {
	const auth = await lockedClient();
	navigation.go("/welcome-back");
	await renderGate(auth);
	await settle();
	await act(async () => {
		await auth.unlock();
	});
	await act(() => auth.lock());
	assert.equal(auth.state.get().status, "locked");
	await act(() =>
		auth.signIn({ accessToken: "access-2", user: { ...user, id: "alice" } }),
	);
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(mounts.navigator, 1);
});
