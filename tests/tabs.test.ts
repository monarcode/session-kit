import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthOptions } from "@monarcode/session-kit";
import { z } from "zod";

import {
	userSchema,
	user,
	SESSION,
	values,
	cleanups,
	setGlobal,
	deferred,
	flush,
	input,
	client,
	code,
	broadcast,
	connectCounting,
	sessionOf,
	saved,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

/** A backend that rotates refresh tokens and rejects any token already spent. */
const rotatingServer = ({ gates = [] as Promise<unknown>[] } = {}) => {
	let issued = 1;
	const live = new Set(["refresh-1"]);
	const server = {
		calls: 0,
		async refresh({ refreshToken }: { refreshToken: string }) {
			await gates[server.calls++];
			if (!live.delete(refreshToken)) return null;
			issued++;
			live.add(`refresh-${issued}`);
			return {
				accessToken: `access-${issued}`,
				refreshToken: `refresh-${issued}`,
			};
		},
	};
	return server;
};

type Backend = { refresh: AuthOptions<typeof userSchema>["refresh"] };

const twoTabs = async (server: Backend) => {
	const a = client({ refresh: server.refresh });
	await a.signIn(input());
	const b = client({ refresh: server.refresh });
	assert.equal((await sessionOf(b)).accessToken, "access-1");
	return { a, b };
};

test("a tab refreshing after another tab rotated the token adopts the saved tokens", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	const stale = await sessionOf(b);
	assert.equal((await a.refresh(await sessionOf(a)))?.accessToken, "access-2");
	assert.equal((await b.refresh(stale))?.accessToken, "access-2");
	assert.equal(server.calls, 1);
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(saved().refreshToken, "refresh-2");
	assert.equal((await b.refresh(await sessionOf(b)))?.accessToken, "access-3");
	assert.equal(saved().refreshToken, "refresh-3");
});

test("tabs refreshing at once spend the refresh token once", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	const [fromA, fromB] = await Promise.all([
		a.refresh(await sessionOf(a)),
		b.refresh(await sessionOf(b)),
	]);
	assert.equal(server.calls, 1);
	assert.equal(fromA?.accessToken, "access-2");
	assert.equal(fromB?.accessToken, "access-2");
	assert.equal(saved().refreshToken, "refresh-2");
});

test("without Web Locks, a rejected refresh adopts newer saved tokens instead of signing out", async () => {
	setGlobal("navigator", undefined);
	const gates = [deferred(), deferred()];
	const server = rotatingServer({ gates: gates.map((gate) => gate.promise) });
	const { a, b } = await twoTabs(server);
	const fromA = a.refresh(await sessionOf(a));
	const fromB = b.refresh(await sessionOf(b));
	await flush();
	assert.equal(server.calls, 2);
	gates[0].resolve();
	assert.equal((await fromA)?.accessToken, "access-2");
	gates[1].resolve();
	assert.equal((await fromB)?.accessToken, "access-2");
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(saved().refreshToken, "refresh-2");
});

test("a stale tab's profile update keeps tokens another tab refreshed", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.refresh(await sessionOf(a));
	await b.updateUser({ ...user, email: "b@example.com" });
	assert.equal(saved().refreshToken, "refresh-2");
	assert.equal(saved().user.email, "b@example.com");
	assert.equal((await sessionOf(b)).accessToken, "access-2");
});

test("a refresh cannot overwrite an account another tab signed in", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await assert.rejects(b.refresh(await sessionOf(b)), code("SESSION_CHANGED"));
	assert.equal(server.calls, 0);
	assert.equal(saved().accessToken, "bob-token");
	assert.equal(b.state.get().user?.id, "bob");
});

test("a refresh after another tab signed out ends this tab's session too", async () => {
	const server = rotatingServer();
	const { a, b } = await twoTabs(server);
	await a.signOut();
	assert.equal(await b.refresh(await sessionOf(b)), null);
	assert.equal(server.calls, 0);
	assert.equal(b.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});

test("a second 401 does not clear an account another tab signed in", async () => {
	const { a, b } = await twoTabs(rotatingServer());
	const stale = await sessionOf(b);
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await assert.rejects(b.rejectSession(stale), code("SESSION_CHANGED"));
	assert.equal(saved().accessToken, "bob-token");
});

const mountedTabs = async (server: Backend = rotatingServer()) => {
	const tabs = await twoTabs(server);
	cleanups.push(tabs.a.mount(), tabs.b.mount());
	await flush();
	return tabs;
};

test("signing out in one tab signs out the others", async () => {
	const { a, b } = await mountedTabs();
	const router = connectCounting(b);
	await flush();
	const before = router.invalidations;
	await a.signOut();
	await broadcast();
	assert.equal(b.state.get().status, "unauthenticated");
	assert.equal(await b.getSession(), null);
	assert.equal(router.invalidations, before + 1);
});

test("signing in in one tab signs in a signed-out tab", async () => {
	const b = client();
	cleanups.push(b.mount());
	await flush();
	assert.equal(b.state.get().status, "unauthenticated");
	await client().signIn(input());
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(b.state.get().user?.id, "alice");
});

test("switching accounts in one tab switches the others and cancels their work", async () => {
	const gate = deferred();
	const { a, b } = await mountedTabs({ refresh: async () => gate.promise });
	const aliceId = b.state.get().sessionId;
	const pending = b.refresh(await sessionOf(b));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	await broadcast();
	await checked;
	assert.equal(b.state.get().user?.id, "bob");
	assert.notEqual(b.state.get().sessionId, aliceId);
	assert.equal((await sessionOf(b)).accessToken, "bob-token");
	gate.resolve({ accessToken: "late" });
	await flush();
	assert.equal(saved().accessToken, "bob-token");
});

test("a refresh in one tab reaches the others without a version change", async () => {
	const server = rotatingServer();
	const { a, b } = await mountedTabs(server);
	const before = b.state.get();
	await a.refresh(await sessionOf(a));
	await broadcast();
	assert.equal(b.state.get().version, before.version);
	assert.equal(b.state.get().user, before.user);
	assert.equal((await sessionOf(b)).accessToken, "access-2");
	assert.equal(server.calls, 1);
});

test("a profile update in one tab reaches the others", async () => {
	const { a, b } = await mountedTabs();
	const before = b.state.get().version;
	await a.updateUser({ ...user, email: "new@example.com" });
	await broadcast();
	assert.equal(b.state.get().user?.email, "new@example.com");
	assert.equal(b.state.get().version, before + 1);
	assert.equal((await sessionOf(b)).accessToken, "access-1");
});

test("another tab's successful refresh clears this tab's refresh failure", async () => {
	const server = rotatingServer();
	const a = client({ refresh: server.refresh });
	await a.signIn(input());
	const b = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	cleanups.push(b.mount());
	await flush();
	await assert.rejects(b.refresh(await sessionOf(b)), code("REFRESH_FAILED"));
	await assert.rejects(b.getSession(), code("REFRESH_FAILED"));
	await a.refresh(await sessionOf(a));
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
	assert.equal(b.state.get().error, null);
	assert.equal((await sessionOf(b)).accessToken, "access-2");
});

test("a refresh in flight cannot overwrite an account signed in meanwhile", async () => {
	const gate = deferred();
	const { a, b } = await twoTabs({ refresh: async () => gate.promise });
	const pending = b.refresh(await sessionOf(b));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await a.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	gate.resolve({ accessToken: "alice-refreshed" });
	await checked;
	assert.equal(saved().accessToken, "bob-token");
	assert.equal(b.state.get().user?.id, "bob");
});

test("unmounted tabs and unrelated keys ignore storage events", async () => {
	const { a, b } = await twoTabs(rotatingServer());
	const off = b.mount();
	await flush();
	await a.signOut();
	await broadcast("unrelated");
	assert.equal(b.state.get().status, "authenticated");
	off();
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
});

test("invalid saved data from another tab leaves this tab's session alone", async () => {
	const { b } = await mountedTabs();
	values.set(SESSION, "invalid-json");
	await broadcast();
	assert.equal(b.state.get().status, "authenticated");
});

test("a user another tab saved that this tab's schema rejects signs every tab out", async () => {
	const a = client();
	await a.signIn(input());
	const b = client({ userSchema: userSchema.extend({ email: z.email() }) });
	cleanups.push(a.mount(), b.mount());
	await flush();
	assert.equal(b.state.get().user?.email, "alice@example.com");
	await a.updateUser({ ...user, email: "not-an-email" });
	await broadcast();
	assert.equal(b.state.get().status, "unauthenticated");
	assert.equal(b.state.get().error?.code, "USER_VALIDATION_FAILED");
	assert.equal(values.size, 0);
	await broadcast();
	assert.equal(a.state.get().status, "unauthenticated");
});
