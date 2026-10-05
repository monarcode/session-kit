import assert from "node:assert/strict";
import { test } from "node:test";

import {
	cleanups,
	deferred,
	flush,
	input,
	client,
	code,
	recordStates,
	saved,
	credentialsOf,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

test("timers longer than setTimeout's limit neither fire early nor get lost", async (t) => {
	const day = 86_400_000;
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const auth = client({
		maxAge: 90 * 86_400,
		refresh: async () => {
			refreshes++;
			return { accessToken: "access-2", expiresIn: 3_600 };
		},
	});
	await auth.signIn(input({ expiresIn: 40 * 86_400 }));
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(30 * day);
	await flush();
	assert.equal(refreshes, 0);
	assert.equal(auth.state.get().status, "authenticated");
	t.mock.timers.tick(10 * day - 60_000);
	await flush();
	assert.equal(refreshes, 1);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("proactive failure keeps unexpired access but expiry hides the user", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	t.mock.timers.tick(10_000);
	await flush();
	assert.equal(auth.state.get().status, "unavailable");
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("unmount keeps a refresh in flight, so a rotated refresh token is saved and sent once", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const sent: Array<string> = [];
	const response = deferred();
	const auth = client({
		refresh: async ({ refreshToken }) => {
			sent.push(refreshToken);
			return response.promise;
		},
	});
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	const unmount = auth.mount();
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	assert.deepEqual(sent, ["refresh-1"]);
	// The backend has rotated the refresh token by the time this tab unmounts.
	unmount();
	await flush();
	cleanups.push(auth.mount());
	await flush();
	response.resolve({
		accessToken: "access-2",
		refreshToken: "refresh-2",
		expiresAt: 1_100_000,
	});
	await flush();
	assert.deepEqual(sent, ["refresh-1"]);
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(saved().refreshToken, "refresh-2");
	t.mock.timers.tick(60_000);
	await flush();
	assert.deepEqual(sent, ["refresh-1", "refresh-2"]);
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("a remount while an expired session refreshes neither shows it unavailable nor rejects waiting guards", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	await client().signIn(input({ expiresAt: 1_001_000 }));
	t.mock.timers.tick(2_000);
	const sent: Array<string> = [];
	const response = deferred();
	const auth = client({
		refresh: async ({ refreshToken }) => {
			sent.push(refreshToken);
			return response.promise;
		},
	});
	const states = recordStates(auth);
	const waiting = auth.getSession();
	// StrictMode mounts, unmounts, and mounts again at once.
	auth.mount()();
	cleanups.push(auth.mount());
	await flush();
	response.resolve({ accessToken: "access-2", expiresAt: 1_100_000 });
	assert.equal((await waiting)?.user.id, "alice");
	assert.deepEqual(sent, ["refresh-1"]);
	assert.ok(states.every((state) => state.status !== "unavailable"));
	assert.equal(auth.state.get().status, "authenticated");
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("expiry without a refresh handler signs out", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client();
	await auth.signIn(input({ expiresAt: 1_010_000 }));
	t.mock.timers.tick(10_001);
	assert.equal(await auth.getSession(), null);
	t.mock.timers.reset();
});

test("opaque tokens work and explicit expiry wins over JWT exp", async () => {
	const auth = client();
	await auth.signIn(input());
	assert.equal((await credentialsOf(auth)).expiresAt, undefined);
	const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.x`;
	await auth.signIn(
		input({ accessToken: jwt, expiresAt: Date.now() + 60_000 }),
	);
	assert.ok(((await credentialsOf(auth)).expiresAt ?? 0) > Date.now());
});

const jwt = (claims: object) =>
	`e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;

test("JWT lifetime is measured from receipt when the browser clock runs fast", async (t) => {
	const serverNow = 1_000_000;
	t.mock.timers.enable({
		apis: ["Date", "setTimeout"],
		now: (serverNow + 600) * 1000,
	});
	const auth = client();
	await auth.signIn(
		input({ accessToken: jwt({ iat: serverNow, exp: serverNow + 300 }) }),
	);
	assert.equal((await credentialsOf(auth)).expiresAt, Date.now() + 300_000);
	t.mock.timers.reset();
});

test("JWT exp without iat stays absolute", async () => {
	const auth = client();
	const exp = Math.floor(Date.now() / 1000) + 300;
	await auth.signIn(input({ accessToken: jwt({ exp }) }));
	assert.equal((await credentialsOf(auth)).expiresAt, exp * 1000);
	await assert.rejects(
		auth.signIn(input({ accessToken: jwt({ exp: 1 }) })),
		code("INVALID_SESSION"),
	);
});

test("expiresIn seconds are measured from receipt for sign-in and refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({
		refresh: async () => ({ accessToken: "access-2", expiresIn: 120 }),
	});
	await auth.signIn(input({ expiresIn: 60 }));
	assert.equal((await credentialsOf(auth)).expiresAt, 1_060_000);
	t.mock.timers.tick(10_000);
	const refreshed = await auth.credentials.renew(await credentialsOf(auth));
	assert.equal(refreshed?.expiresAt, 1_130_000);
	t.mock.timers.reset();
});

test("expiresIn rejects invalid values and conflicts with expiresAt", async () => {
	const auth = client();
	for (const overrides of [
		{ expiresIn: 0 },
		{ expiresIn: "60" },
		{ expiresIn: 60, expiresAt: Date.now() + 60_000 },
	]) {
		await assert.rejects(
			// @ts-expect-error -- deliberately invalid lifetimes, including a string
			auth.signIn(input(overrides)),
			code("INVALID_SESSION"),
		);
	}
});

test("restoration keeps the saved expiry instead of re-deriving JWT lifetime", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000_000 });
	const iat = 1_000_000;
	await client().signIn(input({ accessToken: jwt({ iat, exp: iat + 300 }) }));
	t.mock.timers.tick(200_000);
	const restored = await credentialsOf(client());
	assert.equal(restored.expiresAt, 1_000_300_000);
	t.mock.timers.reset();
});

test("expired saved session restores through refreshing", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	await client().signIn(input({ expiresAt: 1_010_000 }));
	t.mock.timers.tick(20_000);
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	const states = recordStates(auth);
	cleanups.push(auth.mount());
	await flush();
	assert.equal(auth.state.get().status, "refreshing");
	assert.equal(auth.state.get().user?.id, "alice");
	gate.resolve({ accessToken: "access-2", expiresAt: 1_100_000 });
	await flush();
	assert.deepEqual(
		states.map((state) => state.status),
		["refreshing", "authenticated"],
	);
	cleanups.pop()!();
	t.mock.timers.reset();
});
