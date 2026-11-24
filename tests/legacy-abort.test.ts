import assert from "node:assert/strict";
import { test } from "node:test";

import type { StandardSchemaV1 } from "@standard-schema/spec";

import { client, code, cleanups, input, useBrowserMocks } from "./helpers.ts";

/**
 * React Native before 0.87 installs `abort-controller` 3 as the global: its
 * signals have no `reason` or `throwIfAborted`, and `abort()` drops the
 * reason it's given. The client must work the same with it.
 */
class LegacySignal extends EventTarget {
	aborted = false;
	onabort: ((event: Event) => void) | null = null;
}

class LegacyController {
	readonly signal = new LegacySignal();
	abort() {
		if (this.signal.aborted) return;
		this.signal.aborted = true;
		this.signal.dispatchEvent(new Event("abort"));
	}
}

Object.assign(globalThis, {
	AbortController: LegacyController,
	AbortSignal: LegacySignal,
});

useBrowserMocks();

type User = { id: string; email: string };

/** A user schema whose check waits for `release`. */
function slowSchema(release: Promise<void>): StandardSchemaV1<User, User> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			async validate(value) {
				await release;
				return { value: value as User };
			},
		},
	};
}

const user = { id: "alice", email: "alice@example.com" };

test("signs in and refreshes with React Native's legacy AbortController", async () => {
	const auth = client({
		user: slowSchema(Promise.resolve()),
		refresh: async () => ({
			accessToken: "access-2",
			refreshToken: "refresh-2",
			expiresIn: 3600,
		}),
	});
	cleanups.push(auth.mount());
	await auth.signIn(input({ user, expiresIn: 3600 }));
	assert.equal(auth.state.get().status, "authenticated");
	await auth.refresh();
	assert.equal((await auth.credentials.get())?.accessToken, "access-2");
});

test("a superseded sign-in rejects with SESSION_CHANGED", async () => {
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => (release = resolve));
	const auth = client({ user: slowSchema(waiting) });
	cleanups.push(auth.mount());
	const first = auth.signIn(input({ user }));
	const second = auth.signIn(input({ user, accessToken: "access-2" }));
	release();
	await assert.rejects(first, code("SESSION_CHANGED"));
	await second;
	assert.equal((await auth.credentials.get())?.accessToken, "access-2");
});
