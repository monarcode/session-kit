# Next.js

With the App Router, the session lives on the server: both tokens and the
user sit in an encrypted, `httpOnly` cookie that page scripts can't read.
Server Components read it, Proxy refreshes it, and Server Functions sign in
and out. The first response already shows the signed-in page, so the browser
never shows a "Checking session…" state or a flash of signed-out content.
Client Components get a small client that mirrors the session, and the hooks
from the [README](../README.md) work with it.

session-kit supports Next 16 and the App Router. A complete app is in
[`examples/next-app`](../examples/next-app).

## Contents

- [Installation](#installation)
- [1. The server engine](#1-the-server-engine)
- [2. Read the session in Server Components](#2-read-the-session-in-server-components)
- [3. Refresh in Proxy](#3-refresh-in-proxy)
- [4. Server Functions](#4-server-functions)
- [5. The browser client](#5-the-browser-client)
- [6. Protect pages](#6-protect-pages)
- [Calling your API](#calling-your-api)
- [Things to know](#things-to-know)

## Installation

```sh
pnpm add @monarcode/session-kit next zod
```

You also need a secret of 32 or more random characters to seal the cookie,
such as from `openssl rand -base64 32`, set as `SESSION_SECRET` on the
server. `next build` doesn't need it.

## 1. The server engine

`createServerAuth` from `@monarcode/session-kit/server` keeps the session in
the cookie. It takes the options `createAuth` does, except storage, plus
`secret`. Keep it in a server-only module: Next then refuses to bundle it
for the browser.

<!-- file: lib/auth/server.ts -->

```ts
import "server-only";
import { createServerAuth } from "@monarcode/session-kit/server";
import { z } from "zod";

const API = "https://api.example.com";

const userSchema = z.object({ id: z.number(), firstName: z.string() });
const tokens = z.object({ accessToken: z.string(), refreshToken: z.string() });

export const serverAuth = createServerAuth({
  name: "app",
  user: userSchema,
  secret: process.env.SESSION_SECRET!,
  refresh: async ({ refreshToken, signal }) => {
    const response = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return tokens.parse(await response.json());
  },
});

/** Signs in with your backend, from the server. */
export async function logIn(username: string, password: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error("Wrong username or password");
  const body: unknown = await response.json();
  return { ...tokens.parse(body), user: userSchema.parse(body) };
}
```

Pass a list as `secret` to rotate it: the first seals, and any of them opens,
so sessions survive a new secret.

## 2. Read the session in Server Components

Every `serverAuth` method takes a cookie jar. `nextJar(await cookies())`
from `@monarcode/session-kit/next` gives one over Next's cookies, read-only
by default, as Server Components can't set cookies. A data access layer
reads the session once per render:

<!-- file: lib/auth/session.ts -->

```ts
import "server-only";
import { cache } from "react";

import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAuth } from "./server";

export const getSession = cache(async () =>
  serverAuth.getSession(nextJar(await cookies())),
);

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
```

`getSession` resolves `{ sessionId, user }`, never tokens, so it's safe to
pass to Client Components.

## 3. Refresh in Proxy

A read-only jar can't save refreshed tokens, so Proxy refreshes access that
is about to expire before any page or Server Function reads it.
`proxyJar(request, response)` sets the new cookie on the response, and Next
passes it on to the Server Components rendering the same request:

<!-- file: proxy.ts -->

```ts
import { proxyJar } from "@monarcode/session-kit/next";
import { NextResponse, type NextRequest } from "next/server";

import { serverAuth } from "./lib/auth/server";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  // A failed refresh shows up when a page reads the session.
  await serverAuth.refreshIfDue(proxyJar(request, response)).catch(() => {});
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Server Functions are POST requests to the page that calls them, so keep the
matcher wide enough to include those pages.

## 4. Server Functions

Server Functions set cookies, so they pass `{ writable: true }`. They decide
what the browser may ask for:

<!-- file: app/actions.ts -->

```ts
"use server";

import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { z } from "zod";

import { logIn, serverAuth } from "../lib/auth/server";

async function jar() {
  return nextJar(await cookies(), { writable: true });
}

export async function getSessionAction() {
  return serverAuth.getSession(await jar());
}

const credentials = z.object({ username: z.string(), password: z.string() });

export async function signInAction(input: unknown) {
  const { username, password } = credentials.parse(input);
  try {
    return {
      session: await serverAuth.signIn(
        await jar(),
        await logIn(username, password),
      ),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sign-in failed" };
  }
}

export async function signOutAction() {
  await serverAuth.signOut(await jar());
}
```

`signInAction` returns its failure rather than throwing it, as Next advises
for expected errors: in production, Next hides a thrown error's message from
the browser.

## 5. The browser client

`createMirrorAuth` makes the client that Client Components use, from the
session the layout read and your Server Functions:

<!-- file: lib/auth/client.ts -->

```ts
import { createMirrorAuth } from "@monarcode/session-kit";

import {
  getSessionAction,
  signInAction,
  signOutAction,
} from "../../app/actions";

export type AppSession = NonNullable<
  Awaited<ReturnType<typeof getSessionAction>>
>;

export function createAppAuth(session: AppSession | null) {
  return createMirrorAuth({
    name: "app",
    session,
    revalidate: getSessionAction,
    signIn: async (input: { username: string; password: string }) => {
      const result = await signInAction(input);
      if ("error" in result) throw new Error(result.error);
      return result.session;
    },
    signOut: signOutAction,
  });
}

export type AppAuth = ReturnType<typeof createAppAuth>;
```

<!-- file: app/hooks.ts -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";

import type { AppAuth } from "../lib/auth/client";

export const { AuthProvider, useAuth, useAuthClient } =
  createAuthHooks<AppAuth>();
```

`useMirrorAuth` from `@monarcode/session-kit/next/client` creates the client
in a Client Component, once per request on the server, never at module
level. It keeps the client and the server in step both ways:

<!-- file: app/providers.tsx -->

```tsx
"use client";

import type { ReactNode } from "react";

import { useMirrorAuth } from "@monarcode/session-kit/next/client";

import { createAppAuth, type AppSession } from "../lib/auth/client";
import { AuthProvider } from "./hooks";

export function Providers(props: {
  session: AppSession | null;
  children: ReactNode;
}) {
  const auth = useMirrorAuth(createAppAuth, props.session);
  return <AuthProvider client={auth}>{props.children}</AuthProvider>;
}
```

<!-- file: app/layout.tsx -->

```tsx
import type { ReactNode } from "react";

import { getSession } from "../lib/auth/session";
import { Providers } from "./providers";

export default async function RootLayout(props: { children: ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <Providers session={session}>{props.children}</Providers>
      </body>
    </html>
  );
}
```

## 6. Protect pages

Check the session in each page, or in the data access layer, rather than in
a layout: layouts don't render again on navigation.

<!-- file: app/page.tsx -->

```tsx
import { requireSession } from "../lib/auth/session";

export default async function Home() {
  const session = await requireSession();
  return <h1>Welcome, {session.user.firstName}</h1>;
}
```

The sign-in page sends a signed-in user on, and its form calls the client's
`signIn`. When the session changes in the browser, after a sign-in or
sign-out here or in another tab, `useMirrorAuth` renders the page again on
the server, so these redirects run without code in the form:

<!-- file: app/login/page.tsx -->

```tsx
import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth/session";
import { SignInForm } from "./sign-in-form";

export default async function Login() {
  if (await getSession()) redirect("/");
  return <SignInForm />;
}
```

<!-- file: app/login/sign-in-form.tsx -->

```tsx
"use client";

import { useState, type FormEvent } from "react";

import { useAuthClient } from "../hooks";

export function SignInForm() {
  const auth = useAuthClient();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await auth.signIn({
        username: String(form.get("username")),
        password: String(form.get("password")),
      });
    } catch (failure) {
      // An AuthError; its cause is what signInAction returned.
      const cause = failure instanceof Error ? failure.cause : undefined;
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    }
  }

  return (
    <form onSubmit={submit}>
      <input name="username" />
      <input name="password" type="password" />
      {error && <p role="alert">{error}</p>}
      <button>Sign in</button>
    </form>
  );
}
```

Above, the server signs in with your backend, so the user in the cookie comes
from the backend. If the browser signs in with the backend itself, have
`signInAction` take the tokens and the user instead. It seals what it's
given, as the [TanStack Start guide](./tanstack-start.md#signing-in)
explains: check the tokens there first, or let your backend authorize
requests with the access token.

## Calling your API

In Server Components, get the access token with a read-only jar. Proxy
refreshed it before the render; a token that expired anyway rejects with
`REFRESH_FAILED`, since the jar can't save a new one.

<!-- file: app/orders/page.tsx -->

```tsx
import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { z } from "zod";

import { serverAuth } from "../../lib/auth/server";
import { requireSession } from "../../lib/auth/session";

export default async function Orders() {
  await requireSession();
  const credentials = await serverAuth.credentials.get(
    nextJar(await cookies()),
  );
  const response = await fetch("https://api.example.com/orders", {
    headers: { Authorization: `Bearer ${credentials!.accessToken}` },
  });
  const orders = z
    .array(z.object({ id: z.number() }))
    .parse(await response.json());
  return <p>{orders.length} orders</p>;
}
```

In Server Functions and Route Handlers, a writable jar can also `renew`
after a 401.

To call the API from the browser too, with `createAuthFetch` or effetch's
`sessionBearer`, opt in with `clientCredentials: true` in `createServerAuth`.
Expose `serverAuth.clientCredentials.get` and `.renew` through a Route
Handler, and pass them as the client's `credentials`. A Route Handler rather
than a Server Function, because Next dispatches Server Functions one at a
time and renders the page again after one sets a cookie. Next doesn't check
where a Route Handler's requests come from, so accept your own site only:

<!-- file: app/api/auth/credentials/route.ts -->

```ts
import { nextJar } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { z } from "zod";

import { serverAuth } from "../../../../lib/auth/server";

const rejected = z.object({ sessionId: z.string(), accessToken: z.string() });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin")
    return new Response(null, { status: 403 });
  const jar = nextJar(await cookies(), { writable: true });
  const body = rejected.safeParse(await request.json().catch(() => null));
  return Response.json(
    body.success
      ? await serverAuth.clientCredentials.renew(jar, body.data)
      : await serverAuth.clientCredentials.get(jar),
  );
}
```

Browsers send `Sec-Fetch-Site` since 2023 (Safari 16.4); older ones are
refused. The browser keeps the access token in memory, never the refresh
token. The example app does this.

## Things to know

- **Writable jars only where Next allows writes.** Pass `{ writable: true }`
  in Server Functions and Route Handlers only. In a Server Component, a
  writable jar would refresh and then fail to save the new tokens, which
  spends a rotating refresh token.
- **One jar per request.** `nextJar` and `proxyJar` return the same jar for
  every call with the same store or response. If you build a `CookieJar`
  yourself, make a new one per request.
- **Several server instances.** Parallel requests on one instance share one
  refresh. Across instances, nothing is shared: with rotating refresh tokens,
  give your backend a short reuse window, so two instances refreshing the
  same session don't sign it out.
- **Rendering.** Reading cookies makes a page dynamic. Next sends such pages
  with `Cache-Control: no-store`, and plain `use cache` can't read cookies.
  Keep pages that read the session on the Node.js runtime, the default:
  Next may not pass Proxy's refreshed cookie on to Edge runtime pages.
- **Size.** The cookie can take about 11 KB across three cookies, since
  servers refuse larger request headers. A larger user rejects at sign-in
  with `PERSISTENCE_FAILED`; keep it small.
- **Plain http.** The cookie is `Secure` by default. Browsers accept that on
  `http://localhost` except Safari: pass `cookie: { secure: false }` for
  local development there, never in production.
- **Tabs.** Signing in or out in one tab reaches the others, which ask the
  server again and render their pages again. So does returning to a tab
  after a while.
