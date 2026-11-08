import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createAuth,
	fromAccessToken,
	type AuthDebugEvent,
	type AuthLocking,
	type AuthOptions,
	type AuthStorage,
} from "@monarcode/session-kit";
import { z } from "zod";

import {
	cleanups,
	client,
	credentialsOf,
	flush,
	input,
	SESSION,
	type TestClient,
	user,
	userSchema,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

/** Storage whose saved entry tests can read. */
function keychain() {
	const entries = new Map<string, string>();
	const storage: AuthStorage = {
		get: (key) => entries.get(key) ?? null,
		set(key, value) {
			entries.set(key, value);
		},
		remove(key) {
			entries.delete(key);
		},
	};
	return {
		storage,
		entries,
		saved: () =>
			JSON.parse(entries.get(SESSION) ?? "null") as Record<
				string,
				unknown
			> | null,
	};
}

/**
 * A stand-in for the app's cipher: opening needs the key that sealed, as
 * with AES-GCM, and both throw without a key. `async` makes both return
 * promises.
 */
function cipher({ async = false } = {}) {
	const state = { key: "key-1" as string | undefined, opened: 0 };
	const answer = (value: string) => (async ? Promise.resolve(value) : value);
	const locking = {
		seal(payload: string) {
			if (!state.key) throw new Error("no key");
			return answer(
				`${state.key}:${Buffer.from(payload).toString("base64")}`,
			);
		},
		open(sealed: string) {
			state.opened++;
			const [key, data] = sealed.split(":");
			if (!state.key || key !== state.key) throw new Error("wrong key");
			return answer(Buffer.from(data!, "base64").toString());
		},
	} satisfies AuthLocking;
	return { state, locking };
}

type Options = Partial<AuthOptions<typeof userSchema>>;

/** A session saved by an earlier launch, and a client for the next one. */
async function relaunch(options: Options, saving: Options = options) {
	const disk = keychain();
	await client({ storage: disk.storage, ...saving }).signIn(
		input({ expiresIn: 600 }),
	);
	const auth = client({ storage: disk.storage, ...options });
	return { auth, disk };
}

/** Restores `auth`, as mounting does at launch, until the test ends. */
async function restore(auth: TestClient) {
	cleanups.push(auth.mount());
	await flush();
}

test("a saved session restores as locked, without opening its tokens", async () => {
	const { state, locking } = cipher();
	const { auth, disk } = await relaunch({ locking });
	await restore(auth);
	const restored = auth.state.get();
	assert.equal(restored.status, "locked");
	assert.deepEqual(restored.user, { ...user, role: "member" });
	assert.equal(typeof restored.sessionId, "string");
	assert.equal(state.opened, 0);
	const saved = disk.saved();
	assert.equal(typeof saved?.sealed, "string");
	assert.ok(!JSON.stringify(saved).includes("access-1"));
	assert.ok(!JSON.stringify(saved).includes("refresh-1"));
});

test("unlock opens the tokens and authenticates, with sync or async sealing", async () => {
	for (const async of [false, true]) {
		const { state, locking } = cipher({ async });
		const { auth } = await relaunch({ locking });
		await restore(auth);
		const { sessionId } = auth.state.get();
		const session = await auth.unlock();
		assert.equal(session?.sessionId, sessionId);
		assert.equal(auth.state.get().status, "authenticated");
		assert.equal((await credentialsOf(auth)).accessToken, "access-1");
		assert.equal(state.opened, 1);
	}
});

test("unlock refreshes expired access at once", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const { locking } = cipher();
	const { auth, disk } = await relaunch({
		locking,
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2", expiresIn: 600 };
		},
	});
	t.mock.timers.tick(700_000);
	await restore(auth);
	assert.equal(auth.state.get().status, "locked");
	assert.equal(refreshes, 0);
	await auth.unlock();
	assert.equal(refreshes, 1);
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	// Refreshing saves sealed tokens too.
	assert.ok(!disk.entries.get(SESSION)!.includes("access-2"));
});

test("unlock signs out when the backend rejects the refresh token", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const { locking } = cipher();
	const { auth, disk } = await relaunch({
		locking,
		refresh: async () => null,
	});
	t.mock.timers.tick(700_000);
	await restore(auth);
	assert.equal(await auth.unlock(), null);
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(disk.saved(), null);
});

test("unlock rejects with UNLOCK_FAILED and stays locked when open throws", async () => {
	const { state, locking } = cipher();
	const { auth, disk } = await relaunch({ locking });
	await restore(auth);
	state.key = "another-key";
	await assert.rejects(auth.unlock(), { code: "UNLOCK_FAILED" });
	assert.equal(auth.state.get().status, "locked");
	assert.notEqual(disk.saved(), null);
	state.key = "key-1";
	await auth.unlock();
	assert.equal(auth.state.get().status, "authenticated");
});

test("tokens sealed for another session sign out with INVALID_SESSION", async () => {
	const { locking } = cipher();
	const { auth, disk } = await relaunch({ locking });
	const other = await relaunch({ locking });
	const saved = disk.saved()!;
	disk.entries.set(
		SESSION,
		JSON.stringify({ ...saved, sealed: other.disk.saved()!.sealed }),
	);
	await restore(auth);
	await assert.rejects(auth.unlock(), { code: "INVALID_SESSION" });
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(disk.saved(), null);
});

test("while locked, token work rejects with LOCKED and nothing refreshes", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const { locking } = cipher();
	const { auth } = await relaunch({
		locking,
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2" };
		},
	});
	t.mock.timers.tick(700_000);
	await restore(auth);
	const { sessionId } = auth.state.get();
	const credentials = {
		sessionId: sessionId!,
		accessToken: "access-1",
	};
	for (const work of [
		auth.getSession(),
		auth.retry(),
		auth.refresh(),
		auth.updateUser(user),
		auth.credentials.get(),
		auth.credentials.renew(credentials),
	])
		await assert.rejects(work, { code: "LOCKED" });
	await auth.credentials.reject(credentials);
	// A foreground re-check mounts again.
	auth.mount()();
	t.mock.timers.tick(700_000);
	await flush();
	assert.equal(refreshes, 0);
	assert.equal(auth.state.get().status, "locked");
	assert.ok(auth.isCurrent({ sessionId: sessionId! }));
});

test("signing in from locked replaces the session", async () => {
	const { locking } = cipher();
	const { auth } = await relaunch({ locking });
	await restore(auth);
	const locked = auth.state.get().sessionId;
	await auth.signIn(input({ accessToken: "access-9" }));
	assert.equal(auth.state.get().status, "authenticated");
	assert.notEqual(auth.state.get().sessionId, locked);
	assert.equal((await credentialsOf(auth)).accessToken, "access-9");
});

test("signing out from locked clears the saved session without revoking", async () => {
	let revokes = 0;
	const { locking } = cipher();
	const { auth, disk } = await relaunch({
		locking,
		revoke: async () => {
			revokes++;
		},
	});
	await restore(auth);
	await auth.signOut();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(disk.saved(), null);
	assert.equal(revokes, 0);
});

test("lock() drops the tokens and stops timers, keeping the saved session", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const { locking } = cipher();
	const disk = keychain();
	const auth = client({
		storage: disk.storage,
		locking,
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2", expiresIn: 600 };
		},
	});
	const unmount = auth.mount();
	await auth.signIn(input({ expiresIn: 600 }));
	const { sessionId, user: signedIn } = auth.state.get();
	await auth.lock();
	assert.equal(auth.state.get().status, "locked");
	assert.equal(auth.state.get().sessionId, sessionId);
	assert.equal(auth.state.get().user, signedIn);
	await assert.rejects(auth.credentials.get(), { code: "LOCKED" });
	t.mock.timers.tick(600_000);
	await flush();
	assert.equal(refreshes, 0);
	assert.notEqual(disk.saved(), null);
	// Access expired while locked, so unlocking refreshes it.
	await auth.unlock();
	assert.equal(refreshes, 1);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	unmount();
});

test("lock() during a refresh locks at once, then lets the refresh save", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	const events: AuthDebugEvent[] = [];
	const { locking } = cipher();
	const disk = keychain();
	const auth = client({
		storage: disk.storage,
		locking,
		debug: (event) => events.push(event),
		refresh: async () => {
			await held;
			// Another lifetime, so a timer plan for these tokens would be new.
			return { accessToken: "access-2", expiresIn: 900 };
		},
	});
	cleanups.push(auth.mount());
	await auth.signIn(input({ expiresIn: 600 }));
	const refreshing = auth.refresh();
	await flush();
	let settled = false;
	const locking_ = auth.lock().then(() => (settled = true));
	assert.equal(auth.state.get().status, "locked");
	await flush();
	assert.equal(settled, false);
	release();
	await refreshing;
	await locking_;
	assert.equal(auth.state.get().status, "locked");
	// The refresh's new tokens arm no timers while locked.
	const lockedAt = events.findIndex((event) => event.message === "locked");
	assert.ok(
		events.slice(lockedAt).every((event) => event.type !== "timer"),
		events.map((event) => `${event.type}: ${event.message}`).join("\n"),
	);
	await assert.rejects(auth.credentials.get(), { code: "LOCKED" });
	await auth.unlock();
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
});

test("a session saved before locking restores locked and is sealed on unlock", async () => {
	const { state, locking } = cipher();
	const { auth, disk } = await relaunch({ locking }, {});
	assert.equal(disk.saved()?.accessToken, "access-1");
	await restore(auth);
	assert.equal(auth.state.get().status, "locked");
	await auth.unlock();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(state.opened, 0);
	assert.equal(typeof disk.saved()?.sealed, "string");
	assert.equal(disk.saved()?.accessToken, undefined);
});

test("locking: true restores locked and keeps the tokens as they are", async () => {
	const { auth, disk } = await relaunch({ locking: true });
	assert.equal(disk.saved()?.accessToken, "access-1");
	await restore(auth);
	assert.equal(auth.state.get().status, "locked");
	await auth.unlock();
	assert.equal((await credentialsOf(auth)).accessToken, "access-1");
});

test("turning locking off makes a sealed session unreadable, which signs out", async () => {
	const { locking } = cipher();
	const { auth, disk } = await relaunch({}, { locking });
	await restore(auth);
	const state = auth.state.get();
	assert.equal(state.status, "unauthenticated");
	assert.equal(state.error?.code, "INVALID_SESSION");
	assert.equal(disk.saved(), null);
});

test("a seal that fails signs out, as a failed save does", async () => {
	const { state, locking } = cipher();
	const disk = keychain();
	const auth = client({ storage: disk.storage, locking });
	state.key = undefined;
	await assert.rejects(auth.signIn(input()), { code: "PERSISTENCE_FAILED" });
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(disk.saved(), null);
});

test("unlock() when not locked resolves like getSession()", async () => {
	const auth = client({ locking: true });
	assert.equal(await auth.unlock(), null);
	await auth.signIn(input());
	assert.equal((await auth.unlock())?.sessionId, auth.state.get().sessionId);
	await auth.lock();
	await auth.lock();
	assert.equal(auth.state.get().status, "locked");
});

test("lock() and unlock() need the locking option", async () => {
	const auth = client();
	await assert.rejects(auth.lock(), /Pass locking to createAuth to use lock/);
	await assert.rejects(
		auth.unlock(),
		/Pass locking to createAuth to use unlock/,
	);
});

test("locking needs a user schema", () => {
	assert.throws(
		() =>
			createAuth({
				name: "token-user",
				user: fromAccessToken(z.object({ sub: z.string() })),
				storage: keychain().storage,
				locking: true,
			} as never),
		/locking needs a user schema/,
	);
});

test("debug reports locked restores, locks, and unlocks", async () => {
	const events: AuthDebugEvent[] = [];
	const { state, locking } = cipher();
	const { auth } = await relaunch({
		locking,
		debug: (event) => events.push(event),
	});
	await restore(auth);
	state.key = "another-key";
	await assert.rejects(auth.unlock());
	state.key = "key-1";
	await auth.unlock();
	await auth.lock();
	const lines = events
		.filter((event) => event.type === "lock" || event.type === "restore")
		.map((event) => `${event.type}: ${event.message}`);
	assert.deepEqual(lines, [
		"restore: started",
		"restore: found a saved session: locked",
		"lock: unlock failed",
		"lock: unlocked",
		"lock: locked",
	]);
});

test("with locking, other tabs' changes aren't followed", () => {
	let subscriptions = 0;
	const disk = keychain();
	const auth = client({
		storage: {
			...disk.storage,
			subscribe() {
				subscriptions++;
				return () => {};
			},
		},
		locking: true,
	});
	cleanups.push(auth.mount());
	assert.equal(subscriptions, 0);
});

test("overlapping unlocks share one", async () => {
	const { state, locking } = cipher({ async: true });
	const { auth } = await relaunch({ locking });
	await restore(auth);
	const [first, second] = await Promise.all([auth.unlock(), auth.unlock()]);
	assert.equal(state.opened, 1);
	assert.equal(first?.sessionId, second?.sessionId);
	assert.equal(auth.state.get().status, "authenticated");
	// Once it settles, the next unlock is a new one.
	await auth.lock();
	await auth.unlock();
	assert.equal(state.opened, 2);
	assert.equal(auth.state.get().status, "authenticated");
});

test("an open that returns no string rejects with UNLOCK_FAILED and stays locked", async () => {
	const { locking } = cipher();
	const { auth, disk } = await relaunch(
		{ locking: { ...locking, open: () => 42 as never } },
		{ locking },
	);
	await restore(auth);
	await assert.rejects(auth.unlock(), { code: "UNLOCK_FAILED" });
	assert.equal(auth.state.get().status, "locked");
	assert.notEqual(disk.saved(), null);
});

test("a session saved before locking stays as it was when sealing it fails", async () => {
	const events: AuthDebugEvent[] = [];
	const { state, locking } = cipher();
	const { auth, disk } = await relaunch(
		{ locking, debug: (event) => events.push(event) },
		{},
	);
	await restore(auth);
	state.key = undefined;
	await auth.unlock();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(disk.saved()?.accessToken, "access-1");
	assert.ok(
		events.some(
			(event) =>
				event.type === "lock" && event.message.startsWith("could not seal"),
		),
	);
});

test("a refresh that fails while unlocking leaves the session unlocked and unavailable", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let offline = true;
	const { locking } = cipher();
	const { auth } = await relaunch({
		locking,
		refresh: async () => {
			if (offline) throw new Error("offline");
			return { accessToken: "access-2", expiresIn: 600 };
		},
	});
	t.mock.timers.tick(700_000);
	await restore(auth);
	await assert.rejects(auth.unlock(), { code: "REFRESH_FAILED" });
	assert.equal(auth.state.get().status, "unavailable");
	offline = false;
	await auth.retry();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
});

test("lock() from unavailable locks, and unlocking refreshes again", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let offline = true;
	const { locking } = cipher();
	const auth = client({
		storage: keychain().storage,
		locking,
		refresh: async () => {
			if (offline) throw new Error("offline");
			return { accessToken: "access-2", expiresIn: 600 };
		},
	});
	await auth.signIn(input({ expiresIn: 600 }));
	t.mock.timers.tick(700_000);
	await assert.rejects(auth.getSession(), { code: "REFRESH_FAILED" });
	assert.equal(auth.state.get().status, "unavailable");
	await auth.lock();
	const locked = auth.state.get();
	assert.equal(locked.status, "locked");
	assert.equal(locked.error, null);
	await assert.rejects(auth.credentials.get(), { code: "LOCKED" });
	offline = false;
	await auth.unlock();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
});

test("refreshing while unlocked doesn't open the saved tokens again", async () => {
	const { state, locking } = cipher();
	const { auth, disk } = await relaunch({
		locking,
		refresh: async () => ({ accessToken: "access-2", expiresIn: 600 }),
	});
	await restore(auth);
	await auth.unlock();
	assert.equal(state.opened, 1);
	await auth.refresh();
	assert.equal(state.opened, 1);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	assert.ok(!disk.entries.get(SESSION)!.includes("access-2"));
});
