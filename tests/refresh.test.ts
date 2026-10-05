import assert from "node:assert/strict";
import { test } from "node:test";

import {
	userSchema,
	user,
	SESSION,
	values,
	cleanups,
	deferred,
	flush,
	input,
	client,
	code,
	credentialsOf,
	sessionOf,
	saved,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

test("concurrent refresh requests share one backend operation", async () => {
	const gate = deferred();
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return gate.promise;
		},
	});
	await auth.signIn(input());
	const session = await credentialsOf(auth);
	const a = auth.credentials.renew(session),
		b = auth.credentials.renew(session);
	await flush();
	assert.equal(calls, 1);
	gate.resolve({ accessToken: "access-2" });
	assert.equal((await a)?.accessToken, "access-2");
	assert.equal((await b)?.accessToken, "access-2");
	assert.equal(saved().refreshToken, "refresh-1");
});

test("late refresh success cannot restore a signed-out session", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input());
	const pending = auth.credentials.renew(await credentialsOf(auth));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signOut();
	gate.resolve({ accessToken: "late" });
	await checked;
	await flush();
	assert.equal(await auth.getSession(), null);
	assert.equal(values.size, 0);
});

test("late refresh failure cannot clear a new account", async () => {
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input());
	const pending = auth.credentials.renew(await credentialsOf(auth));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	gate.reject(new Error("old failure"));
	await checked;
	assert.equal((await sessionOf(auth)).user.id, "bob");
});

test("a refresh begun while sign-in validates cannot overwrite the new account", async () => {
	const validation = deferred(),
		refresh = deferred();
	const schema = userSchema.refine(async (u) =>
		u.id === "bob" ? validation.promise : true,
	);
	const auth = client({
		user: schema,
		refresh: async () => refresh.promise,
	});
	await auth.signIn(input());
	const old = await credentialsOf(auth);
	const login = auth.signIn(
		input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
	);
	const pending = auth.credentials.renew(old);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	validation.resolve(true);
	await login;
	refresh.resolve({ accessToken: "old-rotated" });
	await checked;
	assert.equal((await credentialsOf(auth)).accessToken, "bob-token");
});

test("refresh null ends the session; thrown network errors retain credentials", async () => {
	const auth = client({ refresh: async () => null });
	await auth.signIn(input());
	assert.equal(await auth.credentials.renew(await credentialsOf(auth)), null);
	const retry = client({
		refresh: async () => {
			throw new Error("offline");
		},
	});
	await retry.signIn(input());
	await assert.rejects(
		retry.credentials.renew(await credentialsOf(retry)),
		code("REFRESH_FAILED"),
	);
	assert.equal(retry.state.get().status, "unavailable");
	assert.ok(values.has(SESSION));
});

test("a rejected access token cannot be returned as fresh", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-1" }) });
	await auth.signIn(input());
	await assert.rejects(
		auth.credentials.renew(await credentialsOf(auth)),
		code("INVALID_SESSION"),
	);
	assert.equal(auth.state.get().user, null);
});

test("late 401 for a rotated token reuses the newer token", async () => {
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return { accessToken: "access-2" };
		},
	});
	await auth.signIn(input());
	const old = await credentialsOf(auth);
	await auth.credentials.renew(old);
	assert.equal((await auth.credentials.renew(old))?.accessToken, "access-2");
	assert.equal(calls, 1);
});

test("an old account rejection cannot sign out the new account", async () => {
	const auth = client();
	await auth.signIn(input());
	const old = await credentialsOf(auth);
	await auth.signIn(input({ user: { ...user, id: "bob" } }));
	await assert.rejects(auth.credentials.renew(old), code("SESSION_CHANGED"));
	await auth.credentials.reject(old);
	assert.equal((await sessionOf(auth)).user.id, "bob");
});

test("explicit profile updates win over a profile returned by in-flight proactive refresh", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const gate = deferred();
	const auth = client({ refresh: async () => gate.promise });
	await auth.signIn(input({ expiresAt: 1_020_000 }));
	cleanups.push(auth.mount());
	await flush();
	t.mock.timers.tick(10_000);
	await flush();
	await auth.updateUser({ ...user, email: "new@example.com" });
	gate.resolve({ accessToken: "access-2", expiresAt: 1_040_000, user });
	await flush();
	assert.equal(auth.state.get().user?.email, "new@example.com");
	cleanups.pop()!();
	t.mock.timers.reset();
});

test("a handler that ignores abort still times out", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const auth = client({ refresh: async () => new Promise(() => {}) });
	await auth.signIn(input());
	const pending = auth.credentials.renew(await credentialsOf(auth));
	const checked = assert.rejects(pending, code("REFRESH_FAILED"));
	await flush();
	t.mock.timers.tick(15_000);
	await checked;
	t.mock.timers.reset();
});

test("invalid optional refresh user cannot partially replace tokens", async () => {
	// @ts-expect-error -- deliberately invalid: the refreshed user's id is a number
	const auth = client({
		refresh: async () => ({ accessToken: "access-2", user: { id: 3 } }),
	});
	await auth.signIn(input());
	await assert.rejects(
		auth.credentials.renew(await credentialsOf(auth)),
		code("USER_VALIDATION_FAILED"),
	);
	const entry = saved();
	assert.equal(entry.accessToken, "access-1");
});

test("sign-in clears a stored refresh failure", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	let refreshes = 0;
	const auth = client({
		refresh: async () => {
			refreshes++;
			throw new Error("offline");
		},
	});
	await auth.signIn(input());
	await assert.rejects(
		auth.credentials.renew(await credentialsOf(auth)),
		code("REFRESH_FAILED"),
	);
	await auth.signIn(input({ accessToken: "access-2", expiresAt: 1_010_000 }));
	t.mock.timers.tick(20_000);
	await assert.rejects(auth.getSession(), code("REFRESH_FAILED"));
	assert.equal(refreshes, 2);
	t.mock.timers.reset();
});

test("refresh() replaces usable tokens and needs a refresh callback", async () => {
	let calls = 0;
	const auth = client({
		refresh: async () => {
			calls++;
			return { accessToken: "access-2" };
		},
	});
	assert.equal(await auth.refresh(), null);
	await auth.signIn(input());
	const before = auth.state.get();
	assert.equal((await auth.refresh())?.sessionId, before.sessionId);
	assert.equal(calls, 1);
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	assert.equal(saved().accessToken, "access-2");
	assert.equal(auth.state.get().version, before.version);
	const without = client();
	await without.signIn(input());
	await assert.rejects(without.refresh(), code("REFRESH_FAILED"));
	assert.equal(without.state.get().status, "authenticated");
});

test("a refresh returning an unchanged user keeps the user and version", async () => {
	const auth = client({
		refresh: async () => ({ accessToken: "access-2", user }),
	});
	await auth.signIn(input());
	const before = auth.state.get();
	await auth.refresh();
	assert.equal(auth.state.get().user, before.user);
	assert.equal(auth.state.get().version, before.version);
});
