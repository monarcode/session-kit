"use client";

import type { ReactNode } from "react";

import { AuthProvider, useMirrorAuth } from "@monarcode/session-kit/react";
import { useRouter } from "next/navigation";

import {
	createAppAuth,
	type AppAuth,
	type AppSession,
} from "../lib/auth/client";

// Types `AuthProvider` and the hooks from `@monarcode/session-kit/react`
// with this client.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: AppAuth;
	}
}

/**
 * Gives Client Components the session the layout read. `useMirrorAuth`
 * follows the server's session when the page renders again, and renders it
 * again with `router.refresh()` when the session changes in the browser, as
 * after a sign-out here or in another tab, so the pages' redirects run.
 */
export function Providers({
	session,
	children,
}: {
	session: AppSession | null;
	children: ReactNode;
}) {
	const router = useRouter();
	const auth = useMirrorAuth({
		create: createAppAuth,
		session,
		onChange: () => router.refresh(),
	});
	return <AuthProvider client={auth}>{children}</AuthProvider>;
}
