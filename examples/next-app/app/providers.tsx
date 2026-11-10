"use client";

import type { ReactNode } from "react";

import { useMirrorAuth } from "@monarcode/session-kit/next/client";

import { createAppAuth, type AppSession } from "../lib/auth/client";
import { AuthProvider } from "./hooks";

/**
 * Gives Client Components the session the layout read. `useMirrorAuth`
 * follows the server's session when the page renders again, and renders it
 * again when the session changes in the browser, as after a sign-out here
 * or in another tab, so the pages' redirects run.
 */
export function Providers({
	session,
	children,
}: {
	session: AppSession | null;
	children: ReactNode;
}) {
	const auth = useMirrorAuth(createAppAuth, session);
	return <AuthProvider client={auth}>{children}</AuthProvider>;
}
