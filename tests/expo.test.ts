import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { AuthError, createAuth } from "@monarcode/session-kit";
import { z } from "zod";

import { secureStorage } from "./expo-modules.ts";
import { fileSystem } from "./mocks/expo-file-system.ts";
import { AFTER_FIRST_UNLOCK, secureStore } from "./mocks/expo-secure-store.ts";

const KEY = "my-app:auth:session";
const BASE = "my-app_3Aauth_3Asession";

beforeEach(() => {
	secureStore.reset();
	fileSystem.reset();
});

/** What deleting and reinstalling the app does: files go, the keychain stays. */
const reinstall = () => fileSystem.files.clear();

/** A value of `bytes` UTF-8 bytes, mixing one-, two-, and four-byte characters. */
const valueOf = (bytes: number, seed = "") => {
	const unit = `${seed}aé🙂`; // 1 + 2 + 4 bytes after the seed
	return unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit))).slice(0, -1);
};

/** Saves `value` and returns a new storage, as on the app's next launch. */
async function saved(value: string, options = {}) {
	await secureStorage(options).set(KEY, value, { expiresAt: 0 });
	return secureStorage(options);
}

test("keys are encoded for SecureStore, and different keys stay apart", async () => {
	const storage = secureStorage();
	const keys = ["my-app:auth:session", "my_app:auth", "my.app:auth", "my%app"];
	for (const key of keys) await storage.set(key, key, { expiresAt: 0 });
	assert.deepEqual(
		[...secureStore.items.keys()],
		[BASE, "my_5Fapp_3Aauth", "my_2Eapp_3Aauth", "my_25app"],
	);
	for (const key of keys) assert.equal(await storage.get(key), key);
});

test("a short value takes one key, and later reads are synchronous", async () => {
	const storage = await saved("short");
	assert.deepEqual([...secureStore.items], [[BASE, "0:short"]]);
	assert.equal(storage.get(KEY), "short");
});

test("a value over 2048 bytes is split across keys and read back whole", async () => {
	const value = valueOf(5_000);
	const storage = await saved(value);
	assert.equal(secureStore.items.get(BASE), "1:a:3");
	assert.equal(secureStore.items.size, 4);
	assert.equal(storage.get(KEY), value);
});

test("rewrites alternate between chunk slots and remove the previous chunks", async () => {
	const storage = secureStorage();
	const meta = { expiresAt: 0 };
	await storage.set(KEY, valueOf(5_000, "1"), meta);
	await storage.set(KEY, valueOf(3_000, "2"), meta);
	assert.equal(secureStore.items.get(BASE), "1:b:2");
	assert.deepEqual([...secureStore.items.keys()].sort(), [
		BASE,
		`${BASE}.b0`,
		`${BASE}.b1`,
	]);
	await storage.set(KEY, valueOf(7_000, "3"), meta);
	assert.equal(secureStore.items.get(BASE), "1:a:4");
	assert.equal(secureStore.items.size, 5);
	await storage.set(KEY, "short", meta);
	assert.deepEqual([...secureStore.items], [[BASE, "0:short"]]);
	assert.equal(await secureStorage().get(KEY), "short");
});

for (const [stage, failing] of [
	["a chunk", `${BASE}.b1`],
	["the head", BASE],
] as const) {
	test(`a write that fails at ${stage} keeps the previous value`, async () => {
		const previous = valueOf(5_000, "old");
		const storage = await saved(previous);
		secureStore.fails = (operation, key) =>
			operation === "set" && key === failing;
		await assert.rejects(async () =>
			storage.set(KEY, valueOf(5_000, "new"), { expiresAt: 0 }),
		);
		secureStore.fails = () => false;
		assert.equal(secureStorage().get(KEY), previous);
	});
}

test("a write cut short leaves no stale chunks for the next one", async () => {
	const storage = await saved(valueOf(3_000, "old"));
	// The new value reached three chunks of slot b, then the app died.
	secureStore.fails = (operation, key) => operation === "set" && key === BASE;
	await assert.rejects(async () =>
		storage.set(KEY, valueOf(5_000), { expiresAt: 0 }),
	);
	secureStore.fails = () => false;
	await storage.set(KEY, valueOf(2_500, "new"), { expiresAt: 0 });
	await storage.set(KEY, valueOf(2_500, "newer"), { expiresAt: 0 });
	assert.deepEqual([...secureStore.items.keys()].sort(), [
		BASE,
		`${BASE}.a0`,
		`${BASE}.a1`,
	]);
	assert.equal(secureStorage().get(KEY), valueOf(2_500, "newer"));
});

test("remove deletes every key of a split value", async () => {
	const storage = await saved(valueOf(5_000));
	await storage.remove(KEY);
	assert.equal(secureStore.items.size, 0);
	assert.equal(storage.get(KEY), null);
});

test("a removal cut short leaves nothing the next one misses", async () => {
	const storage = await saved(valueOf(8_000));
	assert.equal(secureStore.items.get(BASE), "1:a:4");
	// One chunk was removed, then the app died.
	secureStore.fails = (operation, key) =>
		operation === "delete" && key === `${BASE}.a2`;
	await assert.rejects(async () => storage.remove(KEY));
	secureStore.fails = () => false;
	// The head still names four chunks, so the next launch reads a gap.
	assert.equal(await secureStorage().get(KEY), null);
	assert.equal(secureStore.items.size, 0);
});

test("a value longer than 64 keys can hold is rejected", async () => {
	await assert.rejects(
		async () =>
			secureStorage().set(KEY, "a".repeat(64 * 2048 + 1), { expiresAt: 0 }),
		/cannot save more than 131072 bytes/,
	);
	assert.equal(secureStore.items.size, 0);
});

test("a session left by an earlier install is removed before it is read", async () => {
	await saved(valueOf(5_000));
	reinstall();
	const storage = secureStorage();
	assert.equal(await storage.get(KEY), null);
	assert.equal(secureStore.items.size, 0);
	// The new install is marked, so its own session survives the next launch.
	await storage.set(KEY, "mine", { expiresAt: 0 });
	assert.equal(secureStorage().get(KEY), "mine");
});

test("the install check also runs before a first write or removal", async () => {
	await saved(valueOf(5_000));
	reinstall();
	await secureStorage().set(KEY, "mine", { expiresAt: 0 });
	assert.deepEqual([...secureStore.items], [[BASE, "0:mine"]]);
	await saved(valueOf(5_000));
	reinstall();
	await secureStorage().remove(KEY);
	assert.equal(secureStore.items.size, 0);
	assert.equal(fileSystem.files.size, 1);
});

test("clearOnReinstall: false restores a session an earlier install left", async () => {
	await saved("kept", { clearOnReinstall: false });
	reinstall();
	assert.equal(secureStorage({ clearOnReinstall: false }).get(KEY), "kept");
	assert.equal(fileSystem.files.size, 0);
});

test("a failed install check fails the operation and runs again next time", async () => {
	await saved("old");
	reinstall();
	fileSystem.failing = true;
	const storage = secureStorage();
	assert.throws(() => storage.get(KEY), /File system unavailable/);
	fileSystem.failing = false;
	secureStore.fails = (operation) => operation === "delete";
	await assert.rejects(Promise.resolve(storage.get(KEY)));
	assert.equal(fileSystem.files.size, 0);
	secureStore.fails = () => false;
	assert.equal(await storage.get(KEY), null);
	assert.equal(secureStore.items.size, 0);
	assert.equal(fileSystem.files.size, 1);
});

for (const part of ["head", "chunk"]) {
	test(`a ${part} Android can't decrypt reads as signed out and is removed`, async () => {
		const storage = await saved(valueOf(5_000));
		secureStore.undecryptable.add(part === "head" ? BASE : `${BASE}.a1`);
		assert.equal(await storage.get(KEY), null);
		assert.equal(secureStore.items.size, 0);
	});
}

test("keychainAccessible reaches every SecureStore call", async () => {
	const options = { keychainAccessible: AFTER_FIRST_UNLOCK };
	const storage = await saved(valueOf(5_000), options);
	storage.get(KEY);
	await storage.remove(KEY);
	assert.ok(secureStore.options.length > 10);
	assert.ok(
		secureStore.options.every(
			(passed) => passed.keychainAccessible === AFTER_FIRST_UNLOCK,
		),
	);
	secureStore.options = [];
	await saved("default");
	assert.ok(
		secureStore.options.every((passed) => !("keychainAccessible" in passed)),
	);
});

const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	firstName: z.string(),
	image: z.string(),
});
const user = {
	id: 1,
	username: "emilys",
	email: "emily.johnson@x.dummyjson.com",
	firstName: "Emily",
	image: "https://dummyjson.com/icon/emilys/128",
};
/** About the size of DummyJSON's tokens: together over SecureStore's limit. */
const token = (name: string) => `${name}.${"x".repeat(900)}.signature`;
const newClient = () =>
	createAuth({ name: "my-app", user: userSchema, storage: secureStorage() });

test("a session larger than SecureStore's limit restores before the first render", async () => {
	await newClient().signIn({
		accessToken: token("access"),
		refreshToken: token("refresh"),
		expiresIn: 3_600,
		user,
	});
	assert.ok(secureStore.items.size > 1);
	const auth = newClient();
	const unmount = auth.mount();
	// Synchronous storage and a synchronous schema restore during mount().
	assert.equal(auth.state.get().status, "authenticated");
	assert.deepEqual(auth.state.get().user, user);
	await auth.signOut();
	assert.equal(secureStore.items.size, 0);
	unmount();
});

test("an undecryptable session signs out without an error", async () => {
	await newClient().signIn({ accessToken: token("access"), user });
	secureStore.undecryptable.add(BASE);
	const auth = newClient();
	assert.equal(await auth.getSession(), null);
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(auth.state.get().error, null);
});

test("a locked keychain makes the session unavailable until retry", async () => {
	await newClient().signIn({ accessToken: token("access"), user });
	secureStore.locked = true;
	const auth = newClient();
	await assert.rejects(
		auth.getSession(),
		(error: AuthError) => error.code === "PERSISTENCE_FAILED",
	);
	assert.equal(auth.state.get().status, "unavailable");
	assert.ok(secureStore.items.size > 0);
	secureStore.locked = false;
	assert.equal((await auth.retry())?.user.firstName, "Emily");
	assert.equal(auth.state.get().status, "authenticated");
});
