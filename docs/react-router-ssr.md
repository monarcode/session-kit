# React Router with server rendering

In framework mode with server rendering, the session lives on the server:
both tokens and the user sit in an encrypted, `httpOnly` cookie that page
scripts can't read. Middleware refreshes it, loaders read it, and actions
sign in and out. The first response already shows the signed-in page, so the
browser never shows a "Checking session…" state or a flash of signed-out
content. Components get a small client that mirrors the session, and the
hooks from the [README](../README.md) work with it.

This needs React Router's middleware: React Router 8, or 7.9 and later with
`future.v8_middleware`. The code below is for React Router 8; on 7, read the
URL with `new URL(request.url)` where it uses the `url` argument. For
framework mode with `ssr: false`, follow the
[React Router guide](./react-router.md#framework-mode-with-ssr-false) instead. A complete app is in
[`examples/react-router-framework-ssr`](../examples/react-router-framework-ssr).

## Contents

- [Installation](#installation)
- [1. The server engine](#1-the-server-engine)
- [2. Middleware](#2-middleware)
- [3. Sign in and out](#3-sign-in-and-out)
- [4. The browser client](#4-the-browser-client)
- [5. Protect routes](#5-protect-routes)
- [Calling your API](#calling-your-api)
- [Things to know](#things-to-know)

## Installation

```sh
pnpm add @monarcode/session-kit zod
```

You also need a secret of 32 or more random characters to seal the cookie,
such as from `openssl rand -base64 32`, set as `SESSION_SECRET` on the
server. `react-router build` doesn't need it.

## 1. The server engine

`createServerAuth` from `@monarcode/session-kit/server` keeps the session in
the cookie. It takes the options `createAuth` does, except storage, plus
`secret`. Keep it in a `.server` module: React Router then refuses to bundle
it for the browser.

<!-- file: app/auth/user.ts -->

```ts
import { z } from "zod";

export const userSchema = z.object({ id: z.number(), firstName: z.string() });

export type User = z.infer<typeof userSchema>;
```

<!-- file: app/auth/session.server.ts -->

```ts
import { createServerAuth } from "@monarcode/session-kit/server";
import { z } from "zod";

import { userSchema } from "./user";

const API = "https://api.example.com";

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

[Server sessions](./server-sessions.md) covers the cookie, rotating the
secret, signing out, and the limits every setup shares.

## 2. Middleware

Every `serverAuth` method takes a cookie jar. `cookieJarMiddleware` from
`@monarcode/session-kit/react-router/server` gives each request one and sets
the cookies written to it on the response, redirects included.
`routerJar(context)` finds the jar in middleware, loaders and actions.

After it, refresh access that is about to expire, before any loader reads
it, and keep pages that depend on the session out of shared caches:

<!-- file: app/auth/middleware.server.ts -->

```ts
import { redirect, type MiddlewareFunction } from "react-router";

import {
  cookieJarMiddleware,
  routerJar,
} from "@monarcode/session-kit/react-router/server";

import { serverAuth } from "./session.server";

const refreshSession: MiddlewareFunction<Response> = async (
  { context },
  next,
) => {
  // A failed refresh shows up when a loader reads the session.
  await serverAuth.refreshIfDue(routerJar(context)).catch(() => {});
  const response = await next();
  // A copy: some responses, such as `fetch`'s, can't change their headers.
  const page = new Response(response.body, response);
  page.headers.set("Cache-Control", "private, no-store");
  return page;
};

/** For the root route: the jar first, so it wraps the rest. */
export const sessionMiddleware = [cookieJarMiddleware, refreshSession];

/** Sends signed-out users to the sign-in page, which brings them back. */
export const requireSession: MiddlewareFunction<Response> = async ({
  context,
  url,
}) => {
  if (!(await serverAuth.getSession(routerJar(context))))
    throw redirect(
      `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`,
    );
};
```

`url` leaves out React Router's `.data` suffix, which `request.url` keeps.

## 3. Sign in and out

The sign-in route's action signs in with your backend and seals the result
into the cookie. React Router 7.12 and later refuse route actions posted from
other sites; on 7.9 to 7.11, start the action with the `Sec-Fetch-Site` check
the sign-out route below uses. The form works before the page's scripts load:

<!-- file: app/routes/login.tsx -->

```tsx
import {
  Form,
  redirect,
  useActionData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import { routerJar } from "@monarcode/session-kit/react-router/server";

import { logIn, serverAuth } from "../auth/session.server";

export async function loader({ context, url }: LoaderFunctionArgs) {
  if (await serverAuth.getSession(routerJar(context)))
    throw redirect(safeReturnTo(url.searchParams.get("redirectTo")));
  return null;
}

export async function action({ request, context, url }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    await serverAuth.signIn(
      routerJar(context),
      await logIn(String(form.get("username")), String(form.get("password"))),
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sign-in failed" };
  }
  throw redirect(safeReturnTo(url.searchParams.get("redirectTo")));
}

export default function Login() {
  const result = useActionData<typeof action>();
  return (
    <Form method="post">
      <input name="username" />
      <input name="password" type="password" />
      {result?.error && <p role="alert">{result.error}</p>}
      <button>Sign in</button>
    </Form>
  );
}
```

A resource route gives the browser's client the session and signs out. React
Router doesn't check where resource routes' requests come from, so its action
accepts your own site only:

<!-- file: app/routes/auth.session.ts -->

```ts
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { routerJar } from "@monarcode/session-kit/react-router/server";

import { serverAuth } from "../auth/session.server";

export async function loader({ context }: LoaderFunctionArgs) {
  return Response.json(await serverAuth.getSession(routerJar(context)));
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.headers.get("sec-fetch-site") !== "same-origin")
    return new Response(null, { status: 403 });
  await serverAuth.signOut(routerJar(context));
  return Response.json(null);
}
```

Add it to `app/routes.ts` as `route("auth/session", "routes/auth.session.ts")`.

## 4. The browser client

`createMirrorAuth` makes the client that components use, from the session
the root loader read and the resource route:

<!-- file: app/auth/client.ts -->

```ts
import { createMirrorAuth, type Session } from "@monarcode/session-kit";

import type { User } from "./user";

export type AppSession = Session<User>;

async function session(method: "GET" | "POST") {
  const response = await fetch("/auth/session", { method });
  if (!response.ok) throw new Error(`Session failed (${response.status})`);
  return (await response.json()) as AppSession | null;
}

export function createAppAuth(initial: AppSession | null) {
  return createMirrorAuth({
    name: "app",
    session: initial,
    revalidate: () => session("GET"),
    signOut: () => session("POST"),
  });
}

export type AppAuth = ReturnType<typeof createAppAuth>;
```

<!-- file: app/hooks.ts -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";

import type { AppAuth } from "./auth/client";

export const { AuthProvider, useAuth, useAuthClient } =
  createAuthHooks<AppAuth>();
```

The root route runs the middleware and reads the session, and its component
creates the client with `useMirrorAuth` from `@monarcode/session-kit/react`:
once per request on the server, never at module level. It keeps the client
and the server in step both ways, running loaders again with `revalidate`
from `useRevalidator()` when the session changes in the browser:

<!-- file: app/root.tsx -->

```tsx
import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";

import { useMirrorAuth } from "@monarcode/session-kit/react";
import { routerJar } from "@monarcode/session-kit/react-router/server";

import { createAppAuth } from "./auth/client";
import { sessionMiddleware } from "./auth/middleware.server";
import { serverAuth } from "./auth/session.server";
import { AuthProvider } from "./hooks";

export const middleware = sessionMiddleware;

export async function loader({ context }: LoaderFunctionArgs) {
  return { session: await serverAuth.getSession(routerJar(context)) };
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { session } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();
  const auth = useMirrorAuth(createAppAuth, session, revalidate);
  return (
    <AuthProvider client={auth}>
      <Outlet />
    </AuthProvider>
  );
}
```

`getSession` resolves `{ sessionId, user }`, never tokens, so it's safe to
return from a loader. `useMirrorAuth` replaces `useAuthRevalidation`: after
an action signs in or out, the loader reads the new session and the client
adopts it; after a sign-out in the browser, here or in another tab, loaders
run again, so the server's redirects run.

## 5. Protect routes

Guard a layout route with middleware: it runs on the server before any
loader or action below it, which loaders on their own can't promise.

<!-- file: app/routes/protected.tsx -->

```tsx
import { Outlet } from "react-router";

import { requireSession } from "../auth/middleware.server";

export const middleware = [requireSession];

export default function Protected() {
  return <Outlet />;
}
```

<!-- file: app/routes/home.tsx -->

```tsx
import { useAuth } from "../hooks";

export default function Home() {
  const user = useAuth((state) => state.user);
  return <h1>Welcome, {user?.firstName}</h1>;
}
```

In `app/routes.ts`, nest the routes it protects:
`layout("routes/protected.tsx", [index("routes/home.tsx")])`. During
navigation in the browser, server middleware runs only when a route has a
loader to fetch, so give the layout a loader if the routes below it have
none.

Above, the server signs in with your backend, so the user in the cookie comes
from the backend. If the browser signs in with the backend itself, have the
action take the tokens and the user instead. It seals what it's given, as the
[TanStack Start guide](./tanstack-start.md#signing-in) explains: check the
tokens there first, or let your backend authorize requests with the access
token.

## Calling your API

Loaders and actions get the access token with the request's jar, refreshing
it first when it has expired, and can `renew` it after a 401:

<!-- file: app/routes/orders.tsx -->

```tsx
import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { routerJar } from "@monarcode/session-kit/react-router/server";
import { z } from "zod";

import { serverAuth } from "../auth/session.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const credentials = await serverAuth.credentials.get(routerJar(context));
  const response = await fetch("https://api.example.com/orders", {
    headers: { Authorization: `Bearer ${credentials!.accessToken}` },
  });
  return z.array(z.object({ id: z.number() })).parse(await response.json());
}

export default function Orders() {
  const orders = useLoaderData<typeof loader>();
  return <p>{orders.length} orders</p>;
}
```

To call the API from the browser too, with `createAuthFetch` or effetch's
`sessionBearer`, opt in with `clientCredentials: true` in `createServerAuth`.
Expose `serverAuth.clientCredentials.get` and `.renew` through a resource
route, added as `route("auth/credentials", "routes/auth.credentials.ts")`:

<!-- file: app/routes/auth.credentials.ts -->

```ts
import type { ActionFunctionArgs } from "react-router";

import { routerJar } from "@monarcode/session-kit/react-router/server";
import { z } from "zod";

import { serverAuth } from "../auth/session.server";

const rejected = z.object({ sessionId: z.string(), accessToken: z.string() });

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.headers.get("sec-fetch-site") !== "same-origin")
    return new Response(null, { status: 403 });
  const jar = routerJar(context);
  const body = rejected.safeParse(await request.json().catch(() => null));
  return Response.json(
    body.success
      ? await serverAuth.clientCredentials.renew(jar, body.data)
      : await serverAuth.clientCredentials.get(jar),
  );
}
```

Then pass the client a `credentials` option: `get` posts to the route with
no body, and `renew` posts the rejected token. The browser keeps the access
token in memory, never the refresh token; see
[Server sessions](./server-sessions.md#the-access-token-in-the-browser). The
example app does this.

## Things to know

- **Signing out ends the session only with `revoke`.** A copy of the cookie
  works again ten seconds after sign-out: see
  [Signing out](./server-sessions.md#signing-out).
- **Refresh in middleware.** The jar sets cookies until the response leaves
  `cookieJarMiddleware`, which first waits for a refresh under way. A
  loader's deferred data that reads the session later, while the page
  streams, gets a read-only jar: an expired token then rejects with
  `REFRESH_FAILED`, since the jar can't save a new one. `refreshIfDue` in
  middleware refreshes before that.
- **One jar per request.** `routerJar` returns the same jar for every call
  with the same `context`, which React Router makes per request.
- **Tabs.** Signing in or out in one tab reaches the others, which ask the
  server again and run their loaders again. So does returning to a tab after
  a while.
- **More.** Several server instances, the cookie's size, and plain http
  during development: see [Server sessions](./server-sessions.md).
