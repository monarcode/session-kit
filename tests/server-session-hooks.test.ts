import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createElement as h, useState } from "react";

import {
	createMirrorAuth,
	type MirrorAuth,
	type Session,
} from "@monarcode/session-kit";

import { act, render, settle, useDom } from "./dom.ts";
import { deferred, user } from "./helpers.ts";

type User = typeof user;

useDom();

let react: typeof import("@monarcode/session-kit/react");
let router: typeof import("react-router");

beforeEach(async () => {
	react = await import("@monarcode/session-kit/react");
	router = await import("react-router");
});

const alice: Session<User> = { sessionId: "s1", user };
const bob: Session<User> = {
	sessionId: "s2",
	user: { ...user, id: "bob", email: "bob@example.com" },
};

/** An app whose layout calls `useMirrorAuth`, rendering again as a framework does. */
type App = {
	client: () => MirrorAuth<User>;
	/** How many clients the hook created. */
	created: () => number;
	/** How often the hook asked the server to render again. */
	asked: () => number;
	/** What the server renders the next time it's asked. */
	set server(session: Session<User> | null);
	/** The server renders `session`, unasked, as after an action. */
	serverRender: (session: Session<User> | null) => Promise<void>;
};

type Mount = (
	name: string,
	initial: Session<User> | null,
	revalidate: () => Promise<Session<User> | null>,
) => Promise<App>;

const createClient =
	(
		name: string,
		count: () => void,
		revalidate: () => Promise<Session<User> | null>,
	) =>
	(first: Session<User> | null) => {
		count();
		return createMirrorAuth({
			name,
			session: first,
			revalidate,
			signOut: async () => {},
		});
	};

/** Next: a layout given the session as a prop, and a counted `router.refresh`. */
const mountNext: Mount = async (name, initial, revalidate) => {
	const counts = { created: 0, refreshes: 0 };
	let client!: MirrorAuth<User>;
	let rendered!: (session: Session<User> | null) => void;
	function Providers() {
		const [session, setSession] = useState(initial);
		rendered = setSession;
		client = react.useMirrorAuth(
			createClient(name, () => counts.created++, revalidate),
			session,
			// A new function each render, as apps write it.
			() => counts.refreshes++,
		);
		return null;
	}
	await render(h(Providers));
	return {
		client: () => client,
		created: () => counts.created,
		asked: () => counts.refreshes,
		set server(_session: Session<User> | null) {},
		async serverRender(session) {
			await act(async () => rendered(session));
			await settle();
		},
	};
};

/** React Router: a root route whose loader returns the server's session. */
const mountReactRouter: Mount = async (name, initial, revalidate) => {
	const counts = { created: 0, loads: 0, unasked: 1 };
	let server = initial;
	let client!: MirrorAuth<User>;
	function Root() {
		const { session } = router.useLoaderData() as {
			session: Session<User> | null;
		};
		const { revalidate: load } = router.useRevalidator();
		client = react.useMirrorAuth(
			createClient(name, () => counts.created++, revalidate),
			session,
			load,
		);
		return null;
	}
	const memory = router.createMemoryRouter([
		{
			path: "/",
			loader: () => {
				counts.loads++;
				return { session: server };
			},
			element: h(Root),
			HydrateFallback: () => null,
		},
	]);
	await render(h(router.RouterProvider, { router: memory }));
	await settle();
	return {
		client: () => client,
		created: () => counts.created,
		asked: () => counts.loads - counts.unasked,
		set server(session: Session<User> | null) {
			server = session;
		},
		async serverRender(session) {
			server = session;
			counts.unasked++;
			await act(() => memory.revalidate());
			await settle();
		},
	};
};

for (const [framework, mount] of [
	["Next", mountNext],
	["React Router", mountReactRouter],
] as const) {
	const name = `hook-${framework.replace(" ", "-").toLowerCase()}`;
	const start = (
		initial: Session<User> | null,
		revalidate: () => Promise<Session<User> | null> = async () => null,
	) => mount(name, initial, revalidate);

	test(`${framework}: useMirrorAuth creates the client once and follows the server's session`, async () => {
		const app = await start(alice);
		assert.equal(app.client().state.get().sessionId, "s1");
		const version = app.client().state.get().version;

		await app.serverRender(bob);
		assert.equal(app.client().state.get().sessionId, "s2");
		assert.equal(app.client().state.get().version, version + 1);
		await app.serverRender(structuredClone(bob));
		await app.serverRender(null);
		assert.equal(app.client().state.get().status, "unauthenticated");
		assert.equal(app.created(), 1);
		assert.equal(app.asked(), 0);
	});

	test(`${framework}: useMirrorAuth asks the server to render again when the browser's session changes`, async () => {
		const app = await start(alice);
		app.server = null;
		await act(async () => app.client().adopt(null));
		await settle();
		assert.equal(app.asked(), 1);
		assert.equal(app.client().state.get().status, "unauthenticated");
		// The server catches up: nothing more to do.
		await app.serverRender(null);
		assert.equal(app.asked(), 1);

		app.server = alice;
		await act(async () => app.client().adopt(alice));
		await settle();
		assert.equal(app.asked(), 2);
		await app.serverRender(alice);

		const renamed = { ...alice, user: { ...user, email: "new@example.com" } };
		app.server = renamed;
		await act(async () => app.client().adopt(renamed));
		await settle();
		assert.equal(app.asked(), 3);
	});

	test(`${framework}: useMirrorAuth keeps a revalidation when the server renders the same session`, async () => {
		const answer = deferred<Session<User> | null>();
		const app = await start(alice, () => answer.promise);
		let revalidated: Promise<unknown> | undefined;
		await act(async () => {
			revalidated = app.client().retry();
		});
		await app.serverRender(structuredClone(alice));
		app.server = bob;
		answer.resolve(bob);
		await act(async () => {
			await revalidated;
		});
		await settle();
		assert.equal(app.client().state.get().sessionId, "s2");
	});

	test(`${framework}: useMirrorAuth asks the server to render again after a sign-out in another tab`, async () => {
		let server: Session<User> | null = alice;
		const app = await start(alice, async () => server);
		const unmount = app.client().mount();
		const otherTab = createMirrorAuth({
			name,
			session: alice,
			revalidate: async () => server,
			signOut: async () => {
				server = null;
				app.server = null;
			},
		});
		try {
			await otherTab.signOut();
			for (let turn = 0; turn < 5 && app.asked() === 0; turn++)
				await settle();
			assert.equal(app.client().state.get().status, "unauthenticated");
			assert.equal(app.asked(), 1);
		} finally {
			unmount();
		}
	});
}
