import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthError, fromAccessToken } from "@monarcode/session-kit";
import { Auth, AuthFailure } from "@monarcode/session-kit/effect";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { z } from "zod";

import {
	cleanups,
	client,
	deferred,
	flush,
	input,
	jwt,
	user,
	useBrowserMocks,
	type TestClient,
} from "./helpers.ts";

useBrowserMocks();

/** Runs `effect` with `auth` as the `Auth` service. */
const run = <A, E>(
	auth: TestClient | ReturnType<typeof client>,
	effect: Effect.Effect<A, E, Auth>,
) => Effect.runPromise(Effect.provide(effect, Auth.layer(auth as never)));

/** The `AuthFailure` `effect` fails with, failing the test when it succeeds. */
const failure = async <A>(
	auth: TestClient,
	effect: Effect.Effect<A, AuthFailure, Auth>,
) => {
	const failed = await run(auth, Effect.flip(effect));
	assert.ok(failed instanceof AuthFailure);
	assert.ok(failed.cause instanceof AuthError);
	assert.equal(failed.cause.code, failed.code);
	return failed;
};

/** The defect `effect` dies with, failing the test when it doesn't die. */
const defect = async (
	auth: TestClient,
	effect: Effect.Effect<unknown, unknown, Auth>,
) => {
	const exit = await Effect.runPromiseExit(
		Effect.provide(effect, Auth.layer(auth as never)),
	);
	assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
	return Cause.squash(exit.cause);
};

class ProfileUnavailable extends Data.TaggedError("ProfileUnavailable") {}

test("session and sessionOption read the current session", async () => {
	const auth = client();
	await auth.signIn(input());
	const session = await run(auth, Auth.session);
	assert.deepEqual(session.user, user);
	const option = await run(auth, Auth.sessionOption);
	assert.equal(Option.getOrThrow(option).sessionId, session.sessionId);
});

test("signed out, session fails with UNAUTHENTICATED and sessionOption is none", async () => {
	const auth = client();
	const failed = await failure(auth, Auth.session);
	assert.equal(failed.code, "UNAUTHENTICATED");
	assert.equal(failed._tag, "AuthFailure");
	assert.ok(Option.isNone(await run(auth, Auth.sessionOption)));
	const handled = await run(
		auth,
		Auth.session.pipe(
			Effect.map(() => "signed in"),
			Effect.catchTag("AuthFailure", (failure) =>
				Effect.succeed(failure.code),
			),
		),
	);
	assert.equal(handled, "UNAUTHENTICATED");
});

test("credentials gives the access token, and fails while signed out or locked", async () => {
	const auth = client({ locking: true });
	cleanups.push(auth.mount());
	assert.equal(
		(await failure(auth, Auth.credentials)).code,
		"UNAUTHENTICATED",
	);
	await auth.signIn(input({ expiresIn: 600 }));
	const credentials = await run(auth, Auth.credentials);
	assert.equal(credentials.accessToken, "access-1");
	await auth.lock();
	assert.equal((await failure(auth, Auth.credentials)).code, "LOCKED");
	assert.equal((await failure(auth, Auth.session)).code, "LOCKED");
});

test("renew refreshes rejected credentials, and fails once the session ends", async () => {
	let next: string | null = "access-2";
	const auth = client({
		refresh: async () => (next ? { accessToken: next } : null),
	});
	await auth.signIn(input());
	const captured = await run(auth, Auth.credentials);
	const renewed = await run(auth, Auth.renew(captured));
	assert.equal(renewed.accessToken, "access-2");
	next = null;
	const ended = await failure(auth, Auth.renew(renewed));
	assert.equal(ended.code, "UNAUTHENTICATED");
	assert.equal(auth.state.get().status, "unauthenticated");
});

test("renew fails with SESSION_CHANGED for another account's credentials", async () => {
	const auth = client({ refresh: async () => ({ accessToken: "access-3" }) });
	await auth.signIn(input());
	const captured = await run(auth, Auth.credentials);
	await auth.signIn(
		input({ accessToken: "bob-1", user: { ...user, id: "bob" } }),
	);
	const changed = await failure(auth, Auth.renew(captured));
	assert.equal(changed.code, "SESSION_CHANGED");
});

test("signIn and signOut change the session", async () => {
	const auth = client();
	await run(auth, Auth.signIn(input()));
	assert.equal(auth.state.get().status, "authenticated");
	await run(auth, Auth.signOut);
	assert.equal(auth.state.get().status, "unauthenticated");
	const invalid = await failure(
		auth,
		Auth.signIn(input({ user: { id: 1 } as never })),
	);
	assert.equal(invalid.code, "USER_VALIDATION_FAILED");
});

test("updateUser takes the user, or an Effect that fetches it", async () => {
	const auth = client();
	await auth.signIn(input());
	await run(auth, Auth.updateUser({ ...user, email: "a@example.com" }));
	assert.equal(auth.state.get().user?.email, "a@example.com");
	await run(
		auth,
		Auth.updateUser(Effect.succeed({ ...user, email: "b@example.com" })),
	);
	assert.equal(auth.state.get().user?.email, "b@example.com");
	const invalid = await failure(
		auth,
		Auth.updateUser(Effect.succeed({ id: 1 } as never)),
	);
	assert.equal(invalid.code, "USER_VALIDATION_FAILED");
});

test("updateUser fails with the fetching Effect's own error, unchanged", async () => {
	const auth = client();
	await auth.signIn(input());
	const failed = await run(
		auth,
		Effect.flip(Auth.updateUser(Effect.fail(new ProfileUnavailable()))),
	);
	assert.ok(failed instanceof ProfileUnavailable);
	assert.deepEqual(auth.state.get().user, user);
});

test("a user fetched for one account never lands on another", async () => {
	const auth = client();
	await auth.signIn(input());
	const fetched = deferred<void>();
	const update = run(
		auth,
		Effect.flip(
			Auth.updateUser(
				Effect.promise(() => fetched.promise).pipe(
					Effect.as({ ...user, email: "alice@new.example.com" }),
				),
			),
		),
	);
	await flush();
	const bob = { ...user, id: "bob", email: "bob@example.com" };
	await auth.signIn(input({ accessToken: "bob-1", user: bob }));
	fetched.resolve();
	assert.equal((await update).code, "SESSION_CHANGED");
	assert.deepEqual(auth.state.get().user, bob);
});

test("interrupting updateUser interrupts the fetching Effect", async () => {
	const auth = client();
	await auth.signIn(input());
	let interrupted = false;
	const fiber = Effect.runFork(
		Effect.provide(
			Auth.updateUser(
				Effect.never.pipe(
					Effect.onInterrupt(() =>
						Effect.sync(() => {
							interrupted = true;
						}),
					),
				),
			),
			Auth.layer(auth as never),
		),
	);
	await flush();
	await Effect.runPromise(Fiber.interrupt(fiber));
	await flush();
	assert.ok(interrupted);
	assert.deepEqual(auth.state.get().user, user);
});

test("updateUser dies for a client whose user comes from the access token", async () => {
	const auth = client({
		user: fromAccessToken(z.object({ sub: z.string() })),
	});
	await auth.signIn({ accessToken: jwt({ sub: "alice" }) });
	const died = await defect(
		auth as never,
		Auth.updateUser(undefined as never),
	);
	assert.ok(died instanceof AuthError);
	assert.equal(died.code, "INVALID_OPTIONS");
});

test("changes emits the current state, then each change, and unsubscribes", async (t) => {
	const auth = client();
	cleanups.push(auth.mount());
	await flush();
	let unsubscribed = 0;
	const subscribe = auth.state.subscribe;
	t.mock.method(auth.state, "subscribe", (listener: never) => {
		const subscription = subscribe(listener);
		return {
			unsubscribe() {
				unsubscribed++;
				subscription.unsubscribe();
			},
		};
	});
	const statuses = run(
		auth,
		Auth.changes.pipe(
			Stream.map((state) => state.status),
			Stream.take(3),
			Stream.runCollect,
		),
	);
	await flush();
	await auth.signIn(input());
	await auth.signOut();
	assert.deepEqual(await statuses, [
		"unauthenticated",
		"authenticated",
		"unauthenticated",
	]);
	assert.equal(unsubscribed, 1);
});

test("fromAuthError fails with an AuthFailure, and dies on anything else", async () => {
	const auth = client();
	const failed = await failure(
		auth,
		Auth.fromAuthError(new AuthError("REFRESH_FAILED", "Offline")),
	);
	assert.equal(failed.code, "REFRESH_FAILED");
	assert.equal(failed.message, "Offline");
	const misuse = await defect(
		auth,
		Auth.fromAuthError(new AuthError("INVALID_OPTIONS", "Bad option")),
	);
	assert.equal((misuse as AuthError).code, "INVALID_OPTIONS");
	const plain = new TypeError("not an AuthError");
	assert.equal(await defect(auth, Auth.fromAuthError(plain)), plain);
});
