import assert from "node:assert/strict";
import { test } from "node:test";

import {
	memoryStorage,
	type AuthDebugEvent,
	type AuthStorage,
} from "@monarcode/session-kit";

import {
	client,
	credentialsOf,
	flush,
	input,
	user,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

const ACCESS = "access-secret-1";
const REFRESH = "refresh-secret-1";

/** Collects every debug event, and a line per event for readable asserts. */
function recorder() {
	const events: AuthDebugEvent[] = [];
	return {
		events,
		log: (event: AuthDebugEvent) => {
			events.push(event);
		},
		lines: () => events.map((event) => `${event.type}: ${event.message}`),
	};
}

test("debug is off by default", async (t) => {
	const info = t.mock.method(console, "info", () => {});
	const auth = client({ refresh: async () => ({ accessToken: "access-2" }) });
	const unmount = auth.mount();
	await auth.signIn(input());
	await auth.refresh();
	await auth.signOut();
	unmount();
	assert.equal(info.mock.callCount(), 0);
});

test("debug: true logs one console.info line per event, named by the auth name", async (t) => {
	const info = t.mock.method(console, "info", () => {});
	const auth = client({ debug: true });
	await auth.signIn(input());
	const lines = info.mock.calls.map((call) => String(call.arguments[0]));
	assert.ok(
		lines.includes("[session-kit:test] sign-in: signed in"),
		lines.join("\n"),
	);
	assert.ok(lines.every((line) => line.startsWith("[session-kit:test] ")));
});

test("events cover restoring, storage, timers, refresh, sign-out, and mounts", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const log = recorder();
	const storage = memoryStorage();
	await client({ storage }).signIn(input({ expiresIn: 600 }));
	const auth = client({
		storage,
		debug: log.log,
		refresh: async () => ({ accessToken: "access-2", expiresIn: 600 }),
	});
	const unmount = auth.mount();
	await flush();
	t.mock.timers.tick(540_000);
	await flush();
	await auth.signOut();
	unmount();
	const lines = log.lines();
	for (const expected of [
		"mount: mounted: timers running",
		"restore: started",
		"storage: read",
		"restore: found a saved session",
		"state: initializing → authenticated",
		"timer: expiry in 600s, early refresh in 540s",
		"timer: early refresh fired",
		"refresh: started (proactive)",
		"storage: write",
		"refresh: saved new tokens",
		"sign-out: signed out: requested",
		"storage: clear",
		"state: authenticated → unauthenticated",
		"mount: unmounted: timers stopped",
	])
		assert.ok(lines.includes(expected), `${expected}\n\n${lines.join("\n")}`);
	const restored = log.events.find(
		(event) => event.message === "found a saved session",
	);
	assert.equal(typeof restored?.data?.durationMs, "number");
	assert.equal(restored?.data?.expired, false);
});

test("refreshes say why they ran, and failures carry the error", async () => {
	const log = recorder();
	let fail = false;
	let issued = 1;
	const auth = client({
		debug: log.log,
		refresh: async () => {
			if (fail) throw new Error("offline");
			return { accessToken: `access-${++issued}` };
		},
	});
	await auth.signIn(input());
	await auth.refresh();
	await auth.credentials.renew(await credentialsOf(auth));
	fail = true;
	await assert.rejects(auth.refresh());
	const refreshes = log.events.filter((event) => event.type === "refresh");
	assert.deepEqual(
		refreshes.map((event) => event.message),
		[
			"started (manual)",
			"saved new tokens",
			"started (rejected)",
			"saved new tokens",
			"started (manual)",
			"failed",
		],
	);
	assert.equal(refreshes.at(-1)?.error?.code, "REFRESH_FAILED");
});

test("sign-outs say what caused them", async () => {
	const log = recorder();
	const auth = client({ debug: log.log, refresh: async () => null });
	await auth.signIn(input());
	await auth.refresh();
	assert.ok(
		log
			.lines()
			.includes(
				"sign-out: signed out: the backend rejected the refresh token",
			),
	);
});

test("tokens, saved values, and user fields stay out of events by default", async () => {
	const log = recorder();
	const auth = client({
		debug: log.log,
		refresh: async () => ({ accessToken: ACCESS, refreshToken: REFRESH }),
	});
	await auth.signIn(input({ accessToken: ACCESS, refreshToken: REFRESH }));
	await auth.refresh();
	const logged = JSON.stringify(log.events);
	for (const secret of [ACCESS, REFRESH, user.email])
		assert.ok(!logged.includes(secret), secret);
});

test("sensitive: true adds tokens, saved values, and the user", async () => {
	const log = recorder();
	const auth = client({ debug: { log: log.log, sensitive: true } });
	await auth.signIn(input({ accessToken: ACCESS, refreshToken: REFRESH }));
	const signedIn = log.events.find((event) => event.type === "sign-in");
	assert.equal(signedIn?.data?.accessToken, ACCESS);
	assert.equal(signedIn?.data?.refreshToken, REFRESH);
	assert.deepEqual(signedIn?.data?.user, user);
	const write = log.events.find((event) => event.message === "write");
	assert.match(String(write?.data?.value), new RegExp(ACCESS));
});

test("sensitive: true without log still logs to the console", async (t) => {
	const info = t.mock.method(console, "info", () => {});
	await client({ debug: { sensitive: true } }).signIn(input());
	assert.ok(info.mock.callCount() > 0);
});

test("storage failures are reported with the error", async () => {
	const log = recorder();
	const failing: AuthStorage = {
		...memoryStorage(),
		set() {
			throw new Error("disk full");
		},
	};
	const auth = client({ storage: failing, debug: log.log });
	await assert.rejects(auth.signIn(input()));
	const failed = log.events.find((event) => event.message === "write failed");
	assert.equal(failed?.error?.code, "PERSISTENCE_FAILED");
});

test("a storage adapter's own events join the log", async () => {
	const log = recorder();
	let sensitive: boolean | undefined;
	let reportedKey: string | undefined;
	const storage: AuthStorage = {
		...memoryStorage(),
		debug(key, report, isSensitive) {
			reportedKey = key;
			sensitive = isSensitive;
			report("adapter ready", { backend: "memory" });
		},
	};
	client({ storage, debug: log.log });
	assert.equal(reportedKey, "test:auth:session");
	assert.equal(sensitive, false);
	assert.deepEqual(
		log.events.map(({ type, message, data }) => ({ type, message, data })),
		[
			{
				type: "storage",
				message: "adapter ready",
				data: { backend: "memory" },
			},
		],
	);
});

test("a storage adapter's debug hook isn't called while debug is off", () => {
	let called = false;
	client({
		storage: {
			...memoryStorage(),
			debug() {
				called = true;
			},
		},
	});
	assert.equal(called, false);
});

test("a throwing logger is reported without interrupting auth", async (t) => {
	const reported: string[] = [];
	t.mock.method(globalThis, "queueMicrotask", (callback: () => void) => {
		try {
			callback();
		} catch (error) {
			reported.push((error as Error).message);
		}
	});
	const auth = client({
		debug: () => {
			throw new Error("logger bug");
		},
	});
	await auth.signIn(input());
	assert.equal(auth.state.get().status, "authenticated");
	assert.ok(reported.length > 0);
	assert.ok(reported.every((message) => message === "logger bug"));
});

test("only the first mount and the last unmount are reported", () => {
	const log = recorder();
	const auth = client({ debug: log.log });
	const first = auth.mount();
	// Such as SessionGate's own mount, and a foreground re-check.
	const second = auth.mount();
	auth.mount()();
	second();
	first();
	assert.deepEqual(
		log.lines().filter((line) => line.startsWith("mount: ")),
		["mount: mounted: timers running", "mount: unmounted: timers stopped"],
	);
});

test("errors carry only their code and message unless sensitive", async () => {
	for (const sensitive of [false, true]) {
		const log = recorder();
		const auth = client({
			debug: { log: log.log, sensitive },
			refresh: async () => {
				throw new Error(`refresh_token=${REFRESH} rejected`);
			},
		});
		await auth.signIn(input({ refreshToken: REFRESH }));
		await assert.rejects(auth.refresh());
		const failed = log.events.find(
			(event) => event.type === "refresh" && event.message === "failed",
		);
		assert.equal(failed?.error?.code, "REFRESH_FAILED");
		assert.equal(failed?.error?.message, "Could not refresh the session");
		assert.equal(
			(failed?.error?.cause as Error | undefined)?.message.includes(
				REFRESH,
			) ?? false,
			sensitive,
		);
		// The client's own state keeps the whole error.
		assert.ok(auth.state.get().error?.cause);
	}
	const log = recorder();
	const auth = client({ debug: log.log });
	await assert.rejects(
		auth.signIn(input({ user: { ...user, role: "owner" as "admin" } })),
	);
	const rejected = log.events.find((event) => event.type === "sign-in");
	assert.equal(rejected?.error?.code, "USER_VALIDATION_FAILED");
	assert.equal(rejected?.error?.issues, undefined);
	assert.equal(rejected?.error?.cause, undefined);
});

test("a change a listener makes is reported after the one that caused it", async () => {
	const log = recorder();
	const auth = client({ debug: log.log });
	const { unsubscribe } = auth.state.subscribe((state) => {
		if (state.status === "authenticated") void auth.signOut();
	});
	await auth.signIn(input());
	await flush();
	unsubscribe();
	const states = log.lines().filter((line) => line.startsWith("state: "));
	assert.deepEqual(states.slice(-2), [
		"state: initializing → authenticated",
		"state: authenticated → unauthenticated",
	]);
});

/** Memory storage whose `write`th write waits for `release`. */
function slowWrite(write: number) {
	const inner = memoryStorage();
	let writes = 0;
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const storage: AuthStorage = {
		...inner,
		async set(key, value, options) {
			if (++writes === write) await released;
			return inner.set(key, value, options);
		},
	};
	return { storage, release, writes: () => writes };
}

test("a sign-in replaced during its write is reported as superseded", async () => {
	const log = recorder();
	const slow = slowWrite(1);
	const auth = client({ storage: slow.storage, debug: log.log });
	const first = auth.signIn(input({ accessToken: "access-1" }));
	await flush();
	assert.equal(slow.writes(), 1);
	const second = auth.signIn(input({ accessToken: "access-2" }));
	await flush();
	slow.release();
	await Promise.all([first, second]);
	assert.deepEqual(
		log.events
			.filter((event) => event.type === "sign-in")
			.map((event) => event.message),
		["superseded by a newer sign-in or sign-out", "signed in"],
	);
});

test("a refresh replaced during its write doesn't report saved tokens", async () => {
	const log = recorder();
	const slow = slowWrite(2);
	const auth = client({
		storage: slow.storage,
		debug: log.log,
		refresh: async () => ({ accessToken: "access-2" }),
	});
	await auth.signIn(input());
	const refreshing = auth.refresh();
	await flush();
	assert.equal(slow.writes(), 2);
	const signingOut = auth.signOut();
	slow.release();
	await assert.rejects(refreshing, { code: "SESSION_CHANGED" });
	await signingOut;
	assert.ok(!log.lines().includes("refresh: saved new tokens"));
});

test("signing out with no session says so", async () => {
	const log = recorder();
	const auth = client({ debug: log.log });
	await auth.getSession();
	await auth.signOut();
	assert.ok(
		log
			.lines()
			.includes(
				"sign-out: nothing to sign out (requested); clearing the saved session anyway",
			),
		log.lines().join("\n"),
	);
});

test("events copy data, and leave out empty data", async () => {
	const events: AuthDebugEvent[] = [];
	const details = { count: 1 };
	const storage: AuthStorage = {
		...memoryStorage(),
		debug(_key, report) {
			report("first", details);
			// The adapter keeps using its own object.
			details.count++;
			report("second", details);
			report("empty", {});
		},
	};
	client({ storage, debug: (event) => events.push(event) });
	assert.deepEqual(
		events.map((event) => event.data),
		[{ count: 1 }, { count: 2 }, undefined],
	);
	assert.ok(!Object.isFrozen(details));
});
