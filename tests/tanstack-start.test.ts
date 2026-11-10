import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
	createAuth,
	createMirrorAuth,
	memoryStorage,
	type Session,
} from "@monarcode/session-kit";
import { createServerAuth } from "@monarcode/session-kit/server";
import {
	loadSession,
	sessionHydration,
} from "@monarcode/session-kit/tanstack-start";
import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import {
	createServerEntry,
	getResponseHeaders,
} from "@tanstack/react-start/server";

import { code, SECRET, user, userSchema } from "./helpers.ts";

type User = typeof user;

const alice: Session<User> = { sessionId: "s1", user };

const serverAuth = createServerAuth({
	name: "app",
	user: userSchema,
	secret: SECRET,
});

/** Handles one request in Start's request scope, returning `work`'s result and the cookies it set. */
async function handle<T>(cookie: string, work: () => Promise<T>) {
	let result!: T;
	const entry = createServerEntry({
		fetch: async () => {
			result = await work();
			const headers = new Headers();
			for (const line of getResponseHeaders().getSetCookie())
				headers.append("set-cookie", line);
			return new Response(null, { headers });
		},
	});
	const response = await entry.fetch(
		new Request("https://app.test/", { headers: { cookie } }),
	);
	return { result, setCookies: response.headers.getSetCookie() };
}

/** The `name=value` pairs of `setCookies`, as a browser would send them back. */
const cookieHeader = (setCookies: string[]) =>
	setCookies.map((line) => line.split(";")[0]).join("; ");

test("startJar throws INVALID_OPTIONS outside a request", () => {
	assert.throws(() => startJar(), code("INVALID_OPTIONS"));
});

test("startJar reads and sets cookies through Start, one jar per request", async () => {
	const signedIn = await handle("", async () => {
		const jar = startJar();
		assert.equal(startJar(), jar);
		return serverAuth.signIn(jar, {
			accessToken: "access-1",
			refreshToken: "refresh-1",
			expiresIn: 900,
			user,
		});
	});
	assert.equal(signedIn.setCookies.length, 1);
	assert.match(signedIn.setCookies[0]!, /^app\.session=1\./);
	assert.match(signedIn.setCookies[0]!, /HttpOnly/);
	assert.match(signedIn.setCookies[0]!, /Secure/);
	assert.match(signedIn.setCookies[0]!, /SameSite=Lax/);

	let first: unknown;
	const next = await handle(cookieHeader(signedIn.setCookies), async () => {
		first = startJar();
		return serverAuth.getSession(startJar());
	});
	assert.deepEqual(next.result, signedIn.result);
	await handle("", async () => assert.notEqual(startJar(), first));

	const signedOut = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.signOut(startJar()),
	);
	assert.match(signedOut.setCookies[0]!, /^app\.session=; Max-Age=0/);
});

test("startJar sets and deletes every chunk of a large session", async () => {
	const signedIn = await handle("", () =>
		serverAuth.signIn(startJar(), {
			accessToken: "a".repeat(5000),
			refreshToken: "refresh-1",
			expiresIn: 900,
			user,
		}),
	);
	assert.deepEqual(
		signedIn.setCookies.map((line) => line.split("=")[0]).sort(),
		["app.session", "app.session.0", "app.session.1"],
	);
	assert.ok(
		signedIn.setCookies.some((line) => line.startsWith("app.session=c2;")),
	);

	const read = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.getSession(startJar()),
	);
	assert.deepEqual(read.result, signedIn.result);

	const signedOut = await handle(cookieHeader(signedIn.setCookies), () =>
		serverAuth.signOut(startJar()),
	);
	assert.deepEqual(
		signedOut.setCookies
			.filter((line) => /Max-Age=0/.test(line))
			.map((line) => line.split("=")[0])
			.sort(),
		["app.session", "app.session.0", "app.session.1"],
	);
});

test("sessionHydration carries the session without running guards again", async (t) => {
	const reads: string[] = [];
	const otherTab = createMirrorAuth({
		name: "hydration",
		session: null,
		revalidate: async () => {
			reads.push("other tab");
			return alice;
		},
		signOut: async () => {},
	});
	t.after(otherTab.mount());

	const server = createMirrorAuth({ ...options(), session: null });
	await loadSession(server);
	const dehydrated = sessionHydration(server).dehydrate();
	assert.deepEqual(dehydrated, { loaded: true, session: alice });

	const browser = createMirrorAuth({ ...options(), session: null });
	const before = browser.state.get().version;
	sessionHydration(browser).hydrate(structuredClone(dehydrated));
	assert.equal(browser.state.get().status, "authenticated");
	assert.deepEqual(browser.state.get().user, user);
	assert.equal(browser.state.get().version, before);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(reads, []);

	const client = createAuth({
		name: "hydration",
		user: userSchema,
		storage: memoryStorage(),
	});
	for (const loaded of [true, false])
		assert.throws(
			() =>
				// @ts-expect-error The types refuse it too, but JavaScript doesn't.
				sessionHydration(client).hydrate({ loaded, session: null }),
			code("INVALID_OPTIONS"),
		);
});

function options() {
	return {
		name: "hydration",
		revalidate: async () => alice,
		signOut: async () => {},
	};
}

/** Makes `loadSession` see a browser until the test ends. */
function inBrowser(t: TestContext) {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {},
	});
	t.after(() => {
		delete (globalThis as { document?: unknown }).document;
	});
}

test("the browser reads a session the server didn't load", async (t) => {
	let reads = 0;
	let down = true;
	const make = () =>
		createMirrorAuth({
			...options(),
			session: null,
			revalidate: async () => {
				reads++;
				if (down) throw new Error("The backend is down");
				return alice;
			},
		});
	const failed = make();
	await assert.rejects(loadSession(failed));
	const skipped = make();
	for (const server of [failed, skipped])
		assert.deepEqual(sessionHydration(server).dehydrate(), {
			loaded: false,
			session: null,
		});

	inBrowser(t);
	down = false;
	const browser = make();
	sessionHydration(browser).hydrate(
		structuredClone(sessionHydration(failed).dehydrate()),
	);
	assert.equal(browser.state.get().sessionId, null);
	await loadSession(browser);
	await loadSession(browser);
	assert.equal(reads, 2);
	assert.equal(browser.state.get().sessionId, "s1");
});

test("loadSession reads on the server every time, in the browser only without hydration", async (t) => {
	let reads = 0;
	const make = () =>
		createMirrorAuth({
			...options(),
			session: null,
			revalidate: async () => {
				reads++;
				return alice;
			},
		});
	const server = make();
	await loadSession(server);
	await loadSession(server);
	assert.equal(reads, 2);
	assert.equal(server.state.get().sessionId, "s1");

	inBrowser(t);
	const hydrated = make();
	sessionHydration(hydrated).hydrate({ loaded: true, session: alice });
	await loadSession(hydrated);
	assert.equal(reads, 2);

	const clientOnly = make();
	await loadSession(clientOnly);
	await loadSession(clientOnly);
	assert.equal(reads, 3);
});
