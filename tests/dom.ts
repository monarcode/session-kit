import { afterEach, beforeEach } from "node:test";

import * as React from "react";
import { createElement, Fragment, StrictMode, type ReactNode } from "react";

import { createAuth, type AuthClient } from "@monarcode/session-kit";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { z } from "zod";

import { testStorage } from "./deferred-storage.ts";

export const userSchema = z.object({ id: z.string(), email: z.string() });
type TestUser = z.infer<typeof userSchema>;
export type Client = AuthClient<TestUser, TestUser>;

export const user = { id: "alice", email: "alice@example.com" };
export const signIn = (auth: Client) =>
	auth.signIn({ accessToken: "access-1", user });
export const newClient = (
	options: Partial<Parameters<typeof createAuth<typeof userSchema>>[0]> = {},
): Client =>
	createAuth({
		name: "react-test",
		user: userSchema,
		storage: testStorage(),
		...options,
	});

/**
 * Saves a session whose access token has expired, so restoring it needs a
 * refresh.
 */
export async function saveExpiredSession() {
	await newClient().signIn({
		accessToken: "access-1",
		refreshToken: "refresh-1",
		user,
	});
	const key = "react-test:auth:session";
	const entry = JSON.parse(localStorage.getItem(key) ?? "null");
	localStorage.setItem(
		key,
		JSON.stringify({ ...entry, expiresAt: Date.now() - 1_000 }),
	);
}

/**
 * A refresh callback that records each refresh token it sends and answers
 * once `respond` is called.
 */
export function heldRefresh() {
	let respond!: () => void;
	const answered = new Promise<void>((resolve) => (respond = resolve));
	const held = {
		sent: [] as string[],
		respond,
		refresh: async ({ refreshToken }: { refreshToken: string }) => {
			held.sent.push(refreshToken);
			await answered;
			return { accessToken: "access-2", expiresIn: 3_600 };
		},
	};
	return held;
}

/** React's `act`, which React 18.0–18.2 exported only from test utilities. */
export let act: (callback: () => unknown) => Promise<void>;
export let dom: JSDOM;
let roots: Set<Root>;
let originalGlobals: Map<string, PropertyDescriptor | undefined>;
let createRoot: typeof import("react-dom/client").createRoot;

/** Installs a jsdom browser before each test and removes it after. */
export function useDom() {
	beforeEach(async () => {
		dom = new JSDOM("<!doctype html><html><body></body></html>", {
			url: "https://auth.test/",
		});
		roots = new Set();
		const globals = {
			window: dom.window,
			self: dom.window,
			document: dom.window.document,
			location: dom.window.location,
			localStorage: dom.window.localStorage,
			// Router scroll restoration calls the global; jsdom only puts it on window.
			scrollTo: () => {},
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		originalGlobals = new Map(
			Object.keys(globals).map((name) => [
				name,
				Object.getOwnPropertyDescriptor(globalThis, name),
			]),
		);
		for (const [name, value] of Object.entries(globals)) {
			Object.defineProperty(globalThis, name, {
				configurable: true,
				writable: true,
				value,
			});
		}
		const reactAct = (React as { act?: typeof act }).act;
		act =
			reactAct ??
			(
				(await import(
					// @ts-ignore -- React 19's types no longer declare this module.
					"react-dom/test-utils"
				)) as { act: typeof act }
			).act;
		({ createRoot } = await import("react-dom/client"));
	});

	afterEach(async () => {
		try {
			await act(async () => {
				for (const root of roots) root.unmount();
			});
		} finally {
			dom.window.close();
			for (const [name, descriptor] of originalGlobals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else delete (globalThis as Record<string, unknown>)[name];
			}
		}
	});
}

export async function render(element: ReactNode, { strict = false } = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.add(root);
	const tree = createElement(strict ? StrictMode : Fragment, null, element);
	// Old react-dom types can pull in their own copy of React's types.
	await act(async () => root.render(tree as Parameters<Root["render"]>[0]));
	return {
		container,
		async unmount() {
			await act(async () => root.unmount());
			roots.delete(root);
			container.remove();
		},
	};
}

/**
 * Renders `element` synchronously and returns the text React committed
 * before any promise could settle: what the browser would paint first.
 */
export async function firstPaint(element: ReactNode): Promise<string> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.add(root);
	// A synchronous `act` flushes renders and effects, but not promises.
	const done = act(() => {
		root.render(element as Parameters<Root["render"]>[0]);
	});
	const text = container.textContent ?? "";
	await done;
	return text;
}

/** Lets timers and promises run, inside `act`. */
export const settle = () =>
	act(() => new Promise((resolve) => setTimeout(resolve, 0)));
