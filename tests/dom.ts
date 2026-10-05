import { afterEach, beforeEach } from "node:test";

import * as React from "react";
import { createElement, Fragment, StrictMode, type ReactNode } from "react";

import {
	createAuth,
	webStorage,
	type AuthClient,
} from "@monarcode/session-kit";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { z } from "zod";

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
		storage: webStorage(),
		...options,
	});

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

/** Lets timers and promises run, inside `act`. */
export const settle = () =>
	act(() => new Promise((resolve) => setTimeout(resolve, 0)));
