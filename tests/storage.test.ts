import assert from "node:assert/strict";
import { test } from "node:test";

import {
	memoryStorage,
	webStorage,
	type AuthStorage,
} from "@monarcode/session-kit";

import {
	user,
	SESSION,
	values,
	cleanups,
	setGlobal,
	flush,
	input,
	client,
	broadcast,
	deferredStorage,
	credentialsOf,
	sessionOf,
	saved,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

/** Storage whose reads, while `holding`, wait until released one at a time. */
const gatedStorage = (inner: AuthStorage) => {
	const waiting: Array<() => void> = [];
	const gate = {
		holding: false,
		get pending() {
			return waiting.length;
		},
		/** Lets the oldest held read finish, then settles. */
		async release() {
			const next = waiting.shift();
			assert.ok(next, "Expected a held storage read");
			next();
			await flush();
		},
		storage: {
			...inner,
			async get(key: string) {
				if (gate.holding)
					await new Promise<void>((resolve) => waiting.push(resolve));
				return inner.get(key);
			},
		} satisfies AuthStorage,
	};
	return gate;
};

test("memory storage keeps the session out of browser storage", async () => {
	const storage = memoryStorage();
	await client({ storage }).signIn(input());
	assert.equal(values.size, 0);
	assert.equal((await sessionOf(client({ storage }))).user.id, "alice");
	assert.equal(await client().getSession(), null);
});

test("web storage can keep each tab's session in sessionStorage", async () => {
	const entries = new Map<string, string>();
	setGlobal("sessionStorage", {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
		removeItem: (key: string) => void entries.delete(key),
	});
	await client({ storage: webStorage({ area: "session" }) }).signIn(input());
	assert.equal(values.size, 0);
	assert.ok(entries.has(SESSION));
	const restored = client({ storage: webStorage({ area: "session" }) });
	assert.equal((await sessionOf(restored)).user.id, "alice");
	assert.throws(
		// @ts-expect-error -- deliberately invalid area
		() => webStorage({ area: "cookie" }),
		/area must be "local" or "session"/,
	);
});

test("a sign-out followed at once by a sign-in leaves the new session saved", async () => {
	// Removals settle long after writes issued later, unless auth waits.
	const auth = client({
		storage: deferredStorage(webStorage(), { remove: 50 }),
	});
	await auth.signIn(input());
	await Promise.all([
		auth.signOut(),
		auth.signIn(
			input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
		),
	]);
	assert.equal(saved().accessToken, "bob-token");
	assert.equal((await sessionOf(client())).user.id, "bob");
});

test("a sign-in in this tab wins over another tab's sign-out still being read", async () => {
	const a = client();
	await a.signIn(input());
	const gate = gatedStorage(webStorage());
	const b = client({ storage: gate.storage });
	cleanups.push(b.mount());
	await flush();
	gate.holding = true;
	await a.signOut();
	await broadcast();
	// Tab b is reading storage to apply the sign-out when it signs in itself.
	assert.equal(gate.pending, 1);
	const signingIn = b.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await flush();
	await gate.release();
	await signingIn;
	assert.equal(b.state.get().user?.id, "bob");
	assert.equal(saved().accessToken, "bob-token");
});

test("a profile update keeps tokens this tab refreshed while it read storage", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const gate = gatedStorage(webStorage());
	const auth = client({
		storage: gate.storage,
		refresh: async () => ({ accessToken: "access-2", expiresAt: 1_100_000 }),
	});
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	cleanups.push(auth.mount());
	await flush();
	gate.holding = true;
	// The proactive refresh reads storage before calling the backend.
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(gate.pending, 1);
	// It gets access-2, then reads storage again before saving it.
	await gate.release();
	assert.equal(gate.pending, 1);
	// The update's read queues behind that one.
	const updating = auth.updateUser({ ...user, email: "new@example.com" });
	await flush();
	await gate.release();
	// The refresh installed access-2, but its save queued behind the update's
	// read, which now runs and will return access-1.
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	assert.equal(saved().accessToken, "access-1");
	assert.equal(gate.pending, 1);
	await gate.release();
	// So the update reads again, after the save.
	assert.equal(gate.pending, 1);
	await gate.release();
	await updating;
	assert.equal(gate.pending, 0);
	assert.equal(saved().accessToken, "access-2");
	assert.equal(saved().user.email, "new@example.com");
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("web storage outside a browser says why it cannot restore", async () => {
	setGlobal("localStorage", undefined);
	const auth = client({ storage: webStorage() });
	await assert.rejects(auth.getSession(), (error: Error) => {
		const cause = (error as Error & { cause?: Error }).cause;
		return /localStorage is not available here/.test(cause?.message ?? "");
	});
});
