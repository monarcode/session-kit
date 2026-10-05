import assert from "node:assert/strict";
import { afterEach, beforeEach } from "node:test";

import {
	createAuth,
	webStorage,
	type AuthClient,
	type AuthErrorCode,
	type AuthOptions,
	type AuthState,
	type AuthStorage,
	type Credentials,
	type Session,
	type Tokens,
	type UserSource,
} from "@monarcode/session-kit";
import { connectAuth } from "@monarcode/session-kit/react";
import { z } from "zod";

export const userSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: z.enum(["admin", "member"]).default("member"),
});
type UserInput = z.input<typeof userSchema>;
export const user: UserInput = {
	id: "alice",
	email: "alice@example.com",
	role: "member",
};
export const SESSION = "test:auth:session";

/** The mocked localStorage contents, cleared before each test. */
export const values = new Map<string, string>();
export const cookies = new Map<string, string>();
/** Storage keys whose writes or deletes throw. */
export const blockedWrites = new Set<string>();
export const blockedDeletes = new Set<string>();
/** While `blocked`, every storage call throws. */
export const storage = { blocked: false };
/** Run after each test, newest first. */
export const cleanups: Array<() => void> = [];

let locks: ReturnType<typeof createLocks>;
let storageEvents: EventTarget;
let originalGlobals: Map<string, PropertyDescriptor | undefined>;
const browserGlobals = [
	"crypto",
	"location",
	"document",
	"localStorage",
	"sessionStorage",
	"fetch",
	"self",
	"scrollTo",
	"window",
	"navigator",
	"addEventListener",
	"removeEventListener",
];

export const setGlobal = (name: string, value: unknown) =>
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});

/**
 * A promise with its settle functions exposed. The value type defaults to
 * `any` so a deferred can stand in for any callback's result.
 */
export const deferred = <T = any>() => {
	let resolve!: (value?: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a as typeof resolve;
		reject = b;
	});
	return { promise, resolve, reject };
};

export const flush = async () => {
	for (let i = 0; i < 40; i++) await Promise.resolve();
};

/** Sign-in input for `user`; override `user` when a test uses another schema. */
export const input = <I = UserInput>(
	overrides: Partial<Tokens & { user: I }> = {},
): Tokens & { user: I } => ({
	accessToken: "access-1",
	refreshToken: "refresh-1",
	user: user as I,
	...overrides,
});

/**
 * Settles every operation after some microtasks, removals last by default, as
 * asynchronous storage can. Operations issued in order would then complete
 * out of order unless auth waits for each one.
 */
export const deferredStorage = (
	inner: AuthStorage,
	delays: Partial<Record<"get" | "set" | "remove", number>> = {},
): AuthStorage => {
	const ticks = { get: 1, set: 2, remove: 3, ...delays };
	const after = async <T>(
		count: number,
		operation: () => T | Promise<T>,
	): Promise<T> => {
		for (let tick = 0; tick < count; tick++) await Promise.resolve();
		return operation();
	};
	return {
		get: (key) => after(ticks.get, () => inner.get(key)),
		set: (key, value, meta) =>
			after(ticks.set, () => inner.set(key, value, meta)),
		remove: (key) => after(ticks.remove, () => inner.remove(key)),
		subscribe: inner.subscribe,
		lock: inner.lock,
	};
};

/**
 * `pnpm test` runs the suite twice: with the default synchronous storage, and
 * with `async-storage.env` setting this so every client defers its storage.
 */
const asyncStorage = process.env.SESSION_KIT_TEST_STORAGE === "async";

export type TestClient = ReturnType<typeof createAuth<typeof userSchema>>;

/**
 * A client named `test` with web storage, using `userSchema` unless another
 * user source is given.
 */
export function client(
	options?: Partial<AuthOptions<typeof userSchema>>,
): TestClient;
export function client<S extends UserSource>(
	options: Partial<AuthOptions<S>> & { user: S },
): ReturnType<typeof createAuth<S>>;
export function client(options: object = {}) {
	return createAuth({
		name: "test",
		user: userSchema,
		storage: asyncStorage ? deferredStorage(webStorage()) : webStorage(),
		...(options as Partial<AuthOptions<typeof userSchema>>),
	});
}

/** The saved session entry, parsed. */
export const saved = () => JSON.parse(values.get(SESSION) ?? "null");

/** The current session, failing the test when there is none. */
export const sessionOf = async <U>(auth: {
	getSession: () => Promise<Session<U> | null>;
}) => {
	const session = await auth.getSession();
	assert.ok(session, "Expected a current session");
	return session;
};

/** The current credentials, failing the test when there are none. */
export const credentialsOf = async (
	auth: Pick<AuthClient<unknown>, "credentials">,
) => {
	const credentials: Credentials | null = await auth.credentials.get();
	assert.ok(credentials, "Expected current credentials");
	return credentials;
};

/** An unsigned JWT carrying `claims`, as auth only decodes access tokens. */
export const jwt = (claims: object) =>
	`e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.x`;

/** Matches an `AuthError` with `expected` for `assert.rejects`. */
export const code = (expected: AuthErrorCode) => (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === expected;

const createLocks = () => {
	const queues = new Map<string, Promise<unknown>>();
	const aborted = (signal?: AbortSignal) =>
		new Promise((_, reject) => {
			if (signal?.aborted) reject(signal.reason);
			signal?.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});
	return {
		request<T>(
			name: string,
			{ signal }: { signal?: AbortSignal } = {},
			callback: (lock: { name: string }) => Promise<T>,
		) {
			const previous = queues.get(name) ?? Promise.resolve();
			const run = (async () => {
				await Promise.race([previous, aborted(signal)]);
				return callback({ name });
			})();
			queues.set(name, Promise.allSettled([previous, run]));
			return run;
		},
	};
};

/** Installs mocked browser globals before each test and restores them after. */
export function useBrowserMocks() {
	beforeEach(() => {
		values.clear();
		cookies.clear();
		blockedWrites.clear();
		blockedDeletes.clear();
		storage.blocked = false;
		cleanups.length = 0;
		locks = createLocks();
		storageEvents = new EventTarget();
		originalGlobals = new Map(
			browserGlobals.map((name) => [
				name,
				Object.getOwnPropertyDescriptor(globalThis, name),
			]),
		);
		setGlobal("location", { protocol: "https:" });
		setGlobal("navigator", { locks });
		setGlobal(
			"addEventListener",
			(...args: Parameters<EventTarget["addEventListener"]>) =>
				storageEvents.addEventListener(...args),
		);
		setGlobal(
			"removeEventListener",
			(...args: Parameters<EventTarget["removeEventListener"]>) =>
				storageEvents.removeEventListener(...args),
		);
		setGlobal("document", {
			get cookie() {
				return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
			},
			set cookie(text: string) {
				const pair = text.split(";")[0];
				const index = pair.indexOf("=");
				const key = pair.slice(0, index),
					value = pair.slice(index + 1);
				if (text.includes("Max-Age=0")) cookies.delete(key);
				else cookies.set(key, value);
			},
		});
		setGlobal("localStorage", {
			getItem(key: string) {
				if (storage.blocked) throw new Error("Blocked");
				return values.get(key) ?? null;
			},
			setItem(key: string, value: string) {
				if (storage.blocked || blockedWrites.has(key))
					throw new Error("Quota");
				values.set(key, value);
			},
			removeItem(key: string) {
				if (storage.blocked || blockedDeletes.has(key))
					throw new Error("Blocked");
				values.delete(key);
			},
		});
	});
	afterEach(() => {
		try {
			for (const cleanup of cleanups.toReversed()) cleanup();
		} finally {
			for (const [name, descriptor] of originalGlobals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else delete (globalThis as Record<string, unknown>)[name];
			}
		}
	});
}

/** Sends a `storage` event, as another tab's write would, then settles. */
export const broadcast = async (key = SESSION) => {
	const event = Object.assign(new Event("storage"), { key });
	storageEvents.dispatchEvent(event);
	await flush();
};

/** A Router stand-in that counts invalidations. */
export const connectCounting = (
	auth: Pick<AuthClient<unknown>, "state" | "mount">,
) => {
	const router = {
		invalidations: 0,
		options: { context: { auth } },
		clearCache() {},
		async invalidate() {
			router.invalidations++;
		},
	};
	cleanups.push(connectAuth(router));
	return router;
};

/** Records every state the client publishes from now on. */
export const recordStates = <U>(auth: Pick<AuthClient<U>, "state">) => {
	const states: AuthState<U>[] = [];
	const subscription = auth.state.subscribe((state) => states.push(state));
	cleanups.push(() => subscription.unsubscribe());
	return states;
};
