import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuth, webStorage, type AuthError } from "@monarcode/session-kit";
import { z } from "zod";

import {
	userSchema,
	user,
	SESSION,
	values,
	cookies,
	blockedWrites,
	blockedDeletes,
	storage,
	cleanups,
	deferred,
	flush,
	input,
	client,
	code,
	deferredStorage,
	recordStates,
	credentialsOf,
	sessionOf,
	saved,
	setGlobal,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

test("schema defaults and custom fields survive restoration; tokens stay out of the profile/state", async () => {
	const auth = client();
	await auth.signIn(input({ user: { id: "alice", email: user.email } }));
	assert.equal(auth.state.get().user?.role, "member");
	assert.equal(saved().refreshToken, "refresh-1");
	assert.equal(cookies.size, 0);
	assert.equal(JSON.stringify(auth.state.get()).includes("refresh-1"), false);
	const restored = client();
	assert.equal((await sessionOf(restored)).user.email, user.email);
	assert.equal((await credentialsOf(restored)).accessToken, "access-1");
});

test("user output is frozen without freezing caller input", async () => {
	const auth = client();
	const data = { ...user };
	await auth.signIn(input({ user: data }));
	assert.equal(Object.isFrozen(auth.state.get().user), true);
	assert.equal(Object.isFrozen(data), false);
});

test("invalid sign-in leaves the current session usable", async () => {
	const auth = client();
	await auth.signIn(input());
	const before = await sessionOf(auth);
	await assert.rejects(
		// @ts-expect-error -- deliberately invalid: the schema requires string fields
		auth.signIn(input({ user: { id: 4 } })),
		code("USER_VALIDATION_FAILED"),
	);
	assert.equal((await sessionOf(auth))?.sessionId, before.sessionId);
});

for (const timeout of [false, true]) {
	for (const canRefresh of [false, true]) {
		test(`expiry during ${timeout ? "timed-out" : "failed"} sign-in ${canRefresh ? "refreshes" : "clears"} the previous session`, async (t) => {
			t.mock.timers.enable({
				apis: ["Date", "setTimeout"],
				now: 1_000_000,
			});
			const validation = deferred();
			const refresh = deferred();
			let refreshCalls = 0;
			const auth = client({
				user: userSchema.refine(async (value) =>
					value.id === "bob" ? validation.promise : true,
				),
				refresh: canRefresh
					? async () => {
							refreshCalls++;
							return refresh.promise;
						}
					: undefined,
			});
			await auth.signIn(input({ expiresAt: 1_001_000 }));
			const previousId = auth.state.get().sessionId;
			cleanups.push(auth.mount());
			await flush();
			const pending = auth.signIn(
				input({
					accessToken: "bob-token",
					user: { ...user, id: "bob" },
				}),
			);
			const checked = assert.rejects(
				pending,
				code("USER_VALIDATION_FAILED"),
			);
			await flush();
			t.mock.timers.tick(1_000);
			if (timeout) t.mock.timers.tick(14_000);
			else validation.resolve(false);
			await checked;
			await flush();
			if (canRefresh) {
				assert.equal(refreshCalls, 1);
				assert.equal(auth.state.get().status, "refreshing");
				assert.equal(auth.state.get().user?.id, "alice");
				refresh.resolve({
					accessToken: "access-2",
					expiresAt: Date.now() + 60_000,
				});
				await flush();
				assert.equal(auth.state.get().status, "authenticated");
				assert.equal(auth.state.get().sessionId, previousId);
				assert.equal(auth.state.get().user?.id, "alice");
			} else {
				assert.equal(auth.state.get().status, "unauthenticated");
				assert.equal(auth.state.get().user, null);
				assert.equal(auth.state.get().sessionId, null);
				assert.equal(values.size, 0);
			}
			if (timeout) {
				validation.resolve(true);
				await flush();
				assert.notEqual(auth.state.get().user?.id, "bob");
			}
		});
	}
}

test("expiry during validation does not cancel a successful new sign-in", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	const previousId = auth.state.get().sessionId;
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(
		input({
			accessToken: "bob-token",
			user: { ...user, id: "bob" },
		}),
	);
	await flush();
	t.mock.timers.tick(1_000);
	await flush();
	validation.resolve(true);
	await pending;
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().user?.id, "bob");
	assert.notEqual(auth.state.get().sessionId, previousId);
});

test("failed sign-in recovery retains expired credentials without a refresh retry loop", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	let refreshCalls = 0;
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
		refresh: async () => {
			refreshCalls++;
			throw new Error("offline");
		},
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("USER_VALIDATION_FAILED"));
	await flush();
	t.mock.timers.tick(1_000);
	validation.resolve(false);
	await checked;
	await flush();
	assert.equal(refreshCalls, 1);
	assert.equal(auth.state.get().status, "unavailable");
	assert.equal(auth.state.get().error?.code, "REFRESH_FAILED");
	assert.ok(values.has(SESSION));
	t.mock.timers.tick(60_000);
	await flush();
	assert.equal(refreshCalls, 1);
});

test("a failed sign-in leaves an expired unmounted session to be refreshed on demand", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	let refreshCalls = 0;
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
		refresh: async () => {
			refreshCalls++;
			return { accessToken: "access-2", expiresAt: Date.now() + 60_000 };
		},
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	const states = recordStates(auth);
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("USER_VALIDATION_FAILED"));
	await flush();
	t.mock.timers.tick(1_000);
	validation.resolve(false);
	await checked;
	await flush();
	// Nothing watches expiry while unmounted, and the failure changes nothing.
	assert.deepEqual(states, []);
	assert.equal(refreshCalls, 0);
	assert.ok(values.has(SESSION));
	assert.equal((await credentialsOf(auth)).accessToken, "access-2");
	assert.equal(refreshCalls, 1);
});

test("a superseded sign-in cannot recover or clear the newer account", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
	const validation = deferred();
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
	});
	await auth.signIn(input({ expiresAt: 1_001_000 }));
	cleanups.push(auth.mount());
	await flush();
	const pending = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(
		input({ accessToken: "carol-token", user: { ...user, id: "carol" } }),
	);
	t.mock.timers.tick(2_000);
	validation.resolve(false);
	await checked;
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().user?.id, "carol");
	assert.equal((await credentialsOf(auth)).accessToken, "carol-token");
});

test("malformed saved session fails closed and removes saved data", async () => {
	await client().signIn(input());
	const entry = saved();
	values.set(SESSION, JSON.stringify({ ...entry, id: "" }));
	assert.equal(await client().getSession(), null);
	assert.equal(values.size, 0);
});

test("sessions saved in an earlier format are removed, not restored", async () => {
	await client().signIn(input());
	values.set(SESSION, JSON.stringify({ ...saved(), v: 3 }));
	assert.equal(await client().getSession(), null);
	assert.equal(values.size, 0);
});

test("malformed stored user fails schema validation", async () => {
	await client().signIn(input());
	const entry = saved();
	values.set(SESSION, JSON.stringify({ ...entry, user: { id: 5 } }));
	assert.equal(await client().getSession(), null);
});

for (const invalidUser of [false, true]) {
	test(`restoring ${invalidUser ? "an invalid user" : "a malformed session"} exposes blocked cleanup and permits retry`, async () => {
		await client().signIn(input());
		if (invalidUser) {
			const entry = saved();
			values.set(SESSION, JSON.stringify({ ...entry, user: { id: 5 } }));
		} else {
			values.set(SESSION, "invalid-json");
		}
		blockedDeletes.add(SESSION);
		const auth = client();
		let failure: AuthError | undefined;
		await assert.rejects(auth.getSession(), (error: AuthError) => {
			failure = error;
			return error.code === "PERSISTENCE_FAILED";
		});
		assert.equal(auth.state.get().error, failure);
		assert.equal(auth.state.get().status, "unauthenticated");
		assert.equal(auth.state.get().user, null);
		assert.equal(auth.state.get().sessionId, null);
		const cause = failure?.cause;
		assert.ok(cause instanceof AggregateError);
		const [restoration, cleanup] = cause.errors;
		assert.equal(
			restoration.code,
			invalidUser ? "USER_VALIDATION_FAILED" : "INVALID_SESSION",
		);
		if (invalidUser) assert.ok(restoration.issues.length > 0);
		else assert.ok(restoration.cause instanceof Error);
		assert.equal(cleanup.code, "PERSISTENCE_FAILED");
		assert.ok(cleanup.cause instanceof Error);
		assert.ok(values.has(SESSION));
		assert.equal(await auth.getSession(), null);
		assert.equal(auth.state.get().error, failure);
		blockedDeletes.clear();
		await auth.signOut();
		assert.equal(auth.state.get().error, null);
		assert.equal(values.size, 0);
	});
}

test("storage read failure is operational and can be retried", async () => {
	await client().signIn(input());
	const auth = client();
	storage.blocked = true;
	await assert.rejects(auth.getSession(), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unavailable");
	storage.blocked = false;
	assert.equal((await sessionOf(auth)).user.id, "alice");
});

test("token write failure clears runtime state and fails visibly", async () => {
	const auth = client();
	blockedWrites.add(SESSION);
	await assert.rejects(auth.signIn(input()), code("PERSISTENCE_FAILED"));
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});

test("signout stays signed out when token deletion fails", async () => {
	const auth = client();
	await auth.signIn(input());
	blockedDeletes.add(SESSION);
	await assert.rejects(auth.signOut(), code("PERSISTENCE_FAILED"));
	assert.equal(await auth.getSession(), null);
	assert.equal(auth.state.get().user, null);
});

test("async validation cannot commit after logout", async () => {
	const gate = deferred();
	const schema = z.object({ id: z.string() }).refine(async () => gate.promise);
	const auth = client({ user: schema });
	const pending = auth.signIn(input({ user: { id: "a" } }));
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signOut();
	gate.resolve(true);
	await checked;
	assert.equal(await auth.getSession(), null);
});

test("async updateUser captures the session before running the callback", async () => {
	const gate = deferred();
	const auth = client();
	await auth.signIn(input());
	const pending = auth.updateUser(() => gate.promise);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.signIn(input({ user: { ...user, id: "bob" } }));
	gate.resolve({ ...user, email: "old" });
	await checked;
	assert.equal(auth.state.get().user?.id, "bob");
});

test("schemas that return non-JSON output are rejected", async () => {
	const schema = z.object({ created: z.date() });
	const auth = client({ user: schema });
	await assert.rejects(
		auth.signIn(input({ user: { created: new Date() } })),
		code("USER_VALIDATION_FAILED"),
	);
});

test("overlapping profile updates commit only the most recent request", async () => {
	const auth = client();
	await auth.signIn(input());
	const gate = deferred();
	const pending = auth.updateUser(() => gate.promise);
	const checked = assert.rejects(pending, code("SESSION_CHANGED"));
	await flush();
	await auth.updateUser({ ...user, email: "newest" });
	gate.resolve({ ...user, email: "older" });
	await checked;
	assert.equal(auth.state.get().user?.email, "newest");
});

test("remount while initial validation is pending joins that restoration", async () => {
	await client().signIn(input());
	const gate = deferred();
	let calls = 0;
	const schema = userSchema.refine(async () => {
		calls++;
		return gate.promise;
	});
	const auth = client({ user: schema });
	const states = recordStates(auth);
	const off = auth.mount();
	await flush();
	const validations = calls;
	off();
	cleanups.push(auth.mount());
	await flush();
	gate.resolve(true);
	await flush();
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(calls, validations);
	assert.deepEqual(
		states.map((state) => state.status),
		["authenticated"],
	);
});

test("a failed sign-in during restoration lets the restoration finish", async () => {
	await client().signIn(input());
	const restoring = deferred();
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "alice" ? restoring.promise : false,
		),
	});
	const waiting = auth.getSession();
	await flush();
	await assert.rejects(
		auth.signIn(
			input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
		),
		code("USER_VALIDATION_FAILED"),
	);
	restoring.resolve(true);
	assert.equal((await waiting)?.user.id, "alice");
	assert.equal(auth.state.get().status, "authenticated");
});

test("a failed sign-in does not abort a refresh in flight", async () => {
	const response = deferred();
	let calls = 0;
	const auth = client({
		user: userSchema.refine(async (value) => value.id !== "bob"),
		refresh: async () => {
			calls++;
			return response.promise;
		},
	});
	await auth.signIn(input());
	const renewing = auth.credentials.renew(await credentialsOf(auth));
	await flush();
	await assert.rejects(
		auth.signIn(
			input({ accessToken: "bob-token", user: { ...user, id: "bob" } }),
		),
		code("USER_VALIDATION_FAILED"),
	);
	response.resolve({ accessToken: "access-2" });
	assert.equal((await renewing)?.accessToken, "access-2");
	assert.equal(calls, 1);
});

test("signOut cancels a sign-in still validating; a newer sign-in supersedes it", async () => {
	const validation = deferred();
	const auth = client({
		user: userSchema.refine(async (value) =>
			value.id === "bob" ? validation.promise : true,
		),
	});
	await auth.signIn(input());
	const cancelled = auth.signIn(input({ user: { ...user, id: "bob" } }));
	const checked = assert.rejects(cancelled, code("SESSION_CHANGED"));
	await flush();
	await auth.signOut();
	validation.resolve(true);
	await checked;
	assert.equal(await auth.getSession(), null);
	const superseded = auth.signIn(input({ user: { ...user, id: "bob" } }));
	await auth.signIn(input({ user: { ...user, id: "carol" } }));
	await assert.rejects(superseded, code("SESSION_CHANGED"));
	assert.equal(auth.state.get().user?.id, "carol");
});

test("sessions name the user without tokens; credentials carry the token", async () => {
	const auth = client();
	await auth.signIn(input());
	const session = await sessionOf(auth);
	assert.deepEqual(Object.keys(session).sort(), ["sessionId", "user"]);
	assert.equal(Object.isFrozen(session), true);
	const credentials = await credentialsOf(auth);
	assert.equal(credentials.accessToken, "access-1");
	assert.equal(credentials.sessionId, session.sessionId);
	assert.equal("refreshToken" in credentials, false);
	assert.equal(auth.isCurrent(session), true);
	assert.equal(auth.isCurrent({ sessionId: "another" }), false);
});

test("sign-out revokes the ended tokens after clearing them", async () => {
	const calls: Array<{ refreshToken?: string; cleared: boolean }> = [];
	const auth = client({
		revoke: async ({ accessToken, refreshToken, signal }): Promise<void> => {
			assert.equal(accessToken, "access-1");
			assert.ok(signal instanceof AbortSignal);
			calls.push({ refreshToken, cleared: !values.has(SESSION) });
			assert.equal(auth.state.get().status, "unauthenticated");
		},
	});
	await auth.signIn(input());
	await auth.signOut();
	assert.deepEqual(calls, [{ refreshToken: "refresh-1", cleared: true }]);
	assert.equal(auth.state.get().error, null);
});

test("a failed revocation is reported without failing sign-out", async () => {
	const auth = client({
		revoke: async () => {
			throw new Error("offline");
		},
	});
	await auth.signIn(input());
	await auth.signOut();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(auth.state.get().error?.code, "REVOKE_FAILED");
	assert.equal(values.size, 0);
});

test("sessions the backend already rejected are not revoked", async () => {
	let revoked = 0;
	const revoke = async () => {
		revoked++;
	};
	const rejected = client({ refresh: async () => null, revoke });
	await rejected.signIn(input());
	assert.equal(
		await rejected.credentials.renew(await credentialsOf(rejected)),
		null,
	);
	const repeated = client({ revoke });
	await repeated.signIn(input());
	await repeated.credentials.reject(await credentialsOf(repeated));
	assert.equal(await repeated.getSession(), null);
	assert.equal(revoked, 0);
});

test("session IDs do not need crypto.randomUUID", async () => {
	setGlobal("crypto", undefined);
	const auth = client();
	await auth.signIn(input());
	assert.match((await sessionOf(auth)).sessionId, /^[0-9a-f]{32}$/);
});

test("createAuth requires storage", () => {
	assert.throws(
		// @ts-expect-error -- deliberately missing storage
		() => createAuth({ name: "test", user: userSchema }),
		/storage/,
	);
});

test("mounting restores at once when storage and the schema are synchronous", async () => {
	await client().signIn(input());
	const auth = client({ storage: webStorage() });
	const states = recordStates(auth);
	cleanups.push(auth.mount());
	assert.equal(auth.state.get().status, "authenticated");
	assert.equal(auth.state.get().user?.id, "alice");
	await flush();
	assert.deepEqual(
		states.map((state) => state.status),
		["authenticated"],
	);
});

test("restoring waits for asynchronous storage or schemas", async () => {
	await client().signIn(input());
	for (const options of [
		{ storage: deferredStorage(webStorage()) },
		{ user: userSchema.refine(async () => true) },
	]) {
		const auth = client({ storage: webStorage(), ...options });
		cleanups.push(auth.mount());
		assert.equal(auth.state.get().status, "initializing");
		await flush();
		assert.equal(auth.state.get().status, "authenticated");
	}
});

test("an invalid saved session is still discarded when mounting", async () => {
	values.set(SESSION, "invalid-json");
	const auth = client({ storage: webStorage() });
	cleanups.push(auth.mount());
	assert.equal(auth.state.get().status, "initializing");
	await flush();
	assert.equal(auth.state.get().status, "unauthenticated");
	assert.equal(values.size, 0);
});
