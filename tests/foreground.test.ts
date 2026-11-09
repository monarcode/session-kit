import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";

import {
	createAuth,
	memoryStorage,
	type AuthStorage,
	type RefreshFn,
} from "@monarcode/session-kit";
import { z } from "zod";

import "./expo-modules.ts";
import { lockable } from "./helpers.ts";
import { appState } from "./mocks/react-native.ts";

// `watchForeground` is internal, so it is loaded from the build, after
// expo-modules.ts so that `react-native` resolves to the mock. gate.test.ts
// checks that SessionGate wires it up.
const { watchForeground }: typeof import("../dist/expo/foreground.js") =
	await import(
		new URL(
			"./foreground.js",
			import.meta.resolve("@monarcode/session-kit/expo"),
		).href
	);

beforeEach(() => appState.reset());

const userSchema = z.object({ id: z.string() });
const user = { id: "alice" };

/** Lets promises settle. Not a timer, so mocked timers don't hold it up. */
const flush = async () => {
	for (let turn = 0; turn < 5; turn++)
		await new Promise((resolve) => setImmediate(resolve));
};

/** A client whose refreshes are counted, and how many mounts it holds. */
function setup(
	t: TestContext,
	options: { refresh?: RefreshFn<{ id: string }>; storage?: AuthStorage } = {},
) {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const counts = { refreshes: 0, mounts: 0, held: 0 };
	const auth = createAuth({
		name: "foreground",
		user: userSchema,
		storage: options.storage ?? memoryStorage(),
		refresh:
			options.refresh ??
			(async () => ({
				accessToken: `access-${++counts.refreshes + 1}`,
				expiresIn: 600,
			})),
	});
	const mount = auth.mount;
	auth.mount = () => {
		counts.mounts++;
		counts.held++;
		const release = mount();
		return () => {
			counts.held--;
			release();
		};
	};
	return { auth, counts };
}

/** Leaves the app in the background for `ms`, with its timers suspended. */
function background(t: TestContext, ms: number) {
	appState.change("inactive");
	appState.change("background");
	// Moves the clock without running timers, as iOS suspends them.
	t.mock.timers.setTime(Date.now() + ms);
}

test("returning to the foreground refreshes a token that expired in the background", async (t) => {
	const { auth, counts } = setup(t);
	const unmount = auth.mount(); // AuthProvider
	await auth.signIn({
		accessToken: "access-1",
		refreshToken: "refresh-1",
		expiresIn: 600,
		user,
	});
	const stop = watchForeground(auth);
	background(t, 2 * 60 * 60 * 1000);
	assert.equal(counts.refreshes, 0);
	appState.change("active");
	await flush();
	// No timer ran: the return itself refreshed.
	assert.equal(counts.refreshes, 1);
	assert.equal((await auth.credentials.get())?.accessToken, "access-2");
	assert.equal(auth.state.get().status, "authenticated");
	// The re-check released its mount; AuthProvider's keeps the timers going.
	assert.equal(counts.held, 1);
	t.mock.timers.tick(600_000);
	await flush();
	assert.equal(counts.refreshes, 2);
	stop();
	unmount();
});

test("only a return to active re-checks the session", async (t) => {
	const { auth, counts } = setup(t);
	appState.reset("unknown");
	const stop = watchForeground(auth);
	appState.change("active"); // the first known state counts as a return
	appState.change("inactive"); // Control Center or a system alert
	appState.change("active");
	appState.change("active"); // repeated events change nothing
	appState.change("background");
	assert.equal(counts.mounts, 2);
	assert.equal(counts.held, 0);
	stop();
});

test("stopping removes the AppState listener", (t) => {
	const { auth, counts } = setup(t);
	const stop = watchForeground(auth);
	assert.equal(appState.listeners, 1);
	stop();
	assert.equal(appState.listeners, 0);
	appState.change("background");
	appState.change("active");
	assert.equal(counts.mounts, 0);
});

test("a failed refresh is not retried on return, and retry() still works", async (t) => {
	let refreshes = 0;
	let online = false;
	const { auth } = setup(t, {
		refresh: async () => {
			refreshes++;
			if (!online) throw new Error("offline");
			return { accessToken: "access-2", expiresIn: 600 };
		},
	});
	const unmount = auth.mount();
	await auth.signIn({
		accessToken: "access-1",
		refreshToken: "refresh-1",
		expiresIn: 600,
		user,
	});
	const stop = watchForeground(auth);
	background(t, 2 * 60 * 60 * 1000);
	appState.change("active");
	await flush();
	assert.equal(refreshes, 1);
	assert.equal(auth.state.get().status, "unavailable");
	// Network status stays with the app: returning again doesn't retry.
	background(t, 1_000);
	appState.change("active");
	await flush();
	assert.equal(refreshes, 1);
	online = true;
	await auth.retry();
	assert.equal(auth.state.get().status, "authenticated");
	stop();
	unmount();
});

test("a restore that failed while the keychain was locked runs again on return", async (t) => {
	const lock = lockable();
	const { storage } = lock;
	lock.locked = false;
	await createAuth({ name: "foreground", user: userSchema, storage }).signIn({
		accessToken: "access-1",
		user,
	});
	// Launched in the background before the first unlock.
	lock.locked = true;
	appState.reset("background");
	const { auth } = setup(t, { storage });
	const unmount = auth.mount();
	const stop = watchForeground(auth);
	await flush();
	assert.equal(auth.state.get().status, "unavailable");
	lock.locked = false;
	appState.change("active");
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	stop();
	unmount();
});
