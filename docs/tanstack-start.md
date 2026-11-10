# TanStack Start with server rendering

With server rendering, the session lives on the server: both tokens and the
user sit in an encrypted, `httpOnly` cookie that page scripts can't read. The
server refreshes the tokens and renders the signed-in page on the first
response, so the browser never shows a "Checking session…" state or a flash
of signed-out content. The browser holds a small client that mirrors the
session, and every hook and guard from the [README](../README.md) works with
it.

For TanStack Start in SPA mode, where the browser keeps the session, follow
the README's quick start instead. A complete app is in
[`examples/tanstack-start-ssr`](../examples/tanstack-start-ssr).

## Contents

- [Installation](#installation)
- [1. The server engine](#1-the-server-engine)
- [2. Server functions](#2-server-functions)
- [3. Refresh before rendering](#3-refresh-before-rendering)
- [4. The browser client](#4-the-browser-client)
- [5. Load the session, then guard routes](#5-load-the-session-then-guard-routes)
- [Signing in](#signing-in)
- [Calling your API](#calling-your-api)
- [Things to know](#things-to-know)

## Installation

```sh
pnpm add @monarcode/session-kit @tanstack/react-start zod
```

Start itself needs Node 22.12 or newer. You also need a secret of 32 or more
random characters to seal the cookie, such as from
`openssl rand -base64 32`, set as `SESSION_SECRET` on the server.

## 1. The server engine

`createServerAuth` from `@monarcode/session-kit/server` keeps the session in
the cookie. It takes the options `createAuth` does, except storage, plus
`secret`. Keep it in a server-only module: Start then refuses to bundle it for
the browser.

<!-- file: src/auth/server.ts -->

```ts
import "@tanstack/react-start/server-only";
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

[Server sessions](./server-sessions.md) covers the cookie, rotating the
secret, signing out, and the limits every setup shares.

## 2. Server functions

Every `serverAuth` method takes the request's cookie jar, and `startJar()`
from `@monarcode/session-kit/tanstack-start/server` gives it. Your server
functions decide what the browser may ask for:

<!-- file: src/auth/functions.ts -->

```ts
import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { logIn, serverAuth } from "./server";

export const getSessionFn = createServerFn().handler(() =>
  serverAuth.getSession(startJar()),
);

export const signInFn = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string(), password: z.string() }))
  .handler(async ({ data }) =>
    serverAuth.signIn(startJar(), await logIn(data.username, data.password)),
  );

export const signOutFn = createServerFn({ method: "POST" }).handler(() =>
  serverAuth.signOut(startJar()),
);
```

`getSession` and `signIn` resolve `{ sessionId, user }`, never tokens, so
their results are safe to send to the browser. Start's compiler replaces each
handler with a request in the browser bundle, and leaves `startJar` and
`serverAuth` out of it.

## 3. Refresh before rendering

Request middleware refreshes access that is about to expire before any route
or server function reads it, while the response can still set the cookie.
Once Start starts streaming a page, a cookie set later is lost, so a refresh
then, such as in a deferred loader's promise, would spend the refresh token
and drop the new one:

<!-- file: src/start.ts -->

```ts
import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { serverAuth } from "./auth/server";

const sessionMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    // A failed refresh shows up when a route reads the session.
    await serverAuth.refreshIfDue(startJar()).catch(() => {});
    return next();
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: ({ handlerType }) => handlerType === "serverFn",
    }),
    sessionMiddleware,
  ],
}));
```

An app that defines `createStart` has no CSRF protection for its server
functions until it adds `createCsrfMiddleware`. Its `filter` keeps the check
to server-function calls: unfiltered, it also refuses page loads from links
on other sites and from the address bar. Server routes are left out too, so
a server route that changes the session must check the request's `Origin`
header itself.

## 4. The browser client

`createMirrorAuth` makes the client that routes and components use. Create it
in `getRouter`, which Start calls once per request on the server and once in
the browser, never at module level. `sessionHydration` sends the session the
server read to the browser with the page:

<!-- file: src/auth/client.ts -->

```ts
import { createMirrorAuth } from "@monarcode/session-kit";

import { getSessionFn, signInFn, signOutFn } from "./functions";

export function createAppAuth() {
  return createMirrorAuth({
    name: "app",
    session: null, // filled by loadSession, then by hydration
    revalidate: () => getSessionFn(),
    signIn: (data: { username: string; password: string }) =>
      signInFn({ data }),
    signOut: () => signOutFn(),
  });
}

export type AppAuth = ReturnType<typeof createAppAuth>;
```

<!-- file: src/router.tsx -->

```tsx
import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { sessionHydration } from "@monarcode/session-kit/tanstack-start";
import { createRouter } from "@tanstack/react-router";

import { createAppAuth } from "./auth/client";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const auth = createAppAuth();
  const router = createRouter({
    routeTree,
    context: { auth },
    ...sessionHydration(auth),
  });
  connectAuth(router);
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

Let TypeScript infer the client's types from its options: with
`createMirrorAuth<User>(…)`, `signIn` would be left out.

## 5. Load the session, then guard routes

The root route's `beforeLoad` reads the request's session into the client
with `loadSession`, before any guard runs. In the browser, the hydrated
session is already there, so it doesn't call the server:

<!-- file: src/routes/__root.tsx -->

```tsx
import { loadSession } from "@monarcode/session-kit/tanstack-start";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { AppAuth } from "../auth/client";

export const Route = createRootRouteWithContext<{ auth: AppAuth }>()({
  beforeLoad: ({ context }) => loadSession(context.auth),
  component: Outlet,
});
```

Guards are the ones from `@monarcode/session-kit/tanstack-router`. On the
server, a redirect is a real HTTP redirect:

<!-- file: src/routes/_authenticated.tsx -->

```tsx
import { requireSession } from "@monarcode/session-kit/tanstack-router";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) =>
    requireSession(context.auth, { location, loginPath: "/login" }),
  component: Outlet,
});
```

Guards decide what a page shows. Server functions that return private data
must check the session themselves, with `serverAuth.getSession(startJar())`
or `serverAuth.credentials.get(startJar())`.

## Signing in

The client's `signIn` sends what it's given to your `signInFn`, then adopts
the session it returns, re-runs guards and tells other tabs:

<!-- file: src/sign-in.ts -->

```ts
import type { AppAuth } from "./auth/client";

export async function signIn(
  auth: AppAuth,
  username: string,
  password: string,
) {
  try {
    await auth.signIn({ username, password });
  } catch (error) {
    // An AuthError; its cause is what signInFn threw.
    console.warn(error);
  }
}
```

Above, the server signs in with your backend, so the user in the cookie comes
from the backend. If the browser signs in with the backend itself, for
example through a provider's SDK, have `signInFn` take the tokens and the user
instead and pass them to `serverAuth.signIn`. It seals what it's given: until
a refresh or `updateUser` replaces it, the user in the cookie is what the
browser sent. Use it to show who is signed in, and let your backend authorize
requests with the access token, or check the tokens in `signInFn` first.

## Calling your API

On the server, get the access token in a server function. It is refreshed
first when it has expired:

<!-- file: src/orders.ts -->

```ts
import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { serverAuth } from "./auth/server";

export const getOrdersFn = createServerFn().handler(async () => {
  const credentials = await serverAuth.credentials.get(startJar());
  if (!credentials) throw new Error("Sign in first");
  const response = await fetch("https://api.example.com/orders", {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });
  return z.array(z.object({ id: z.number() })).parse(await response.json());
});
```

To call the API from the browser too, with `createAuthFetch` or effetch's
`sessionBearer`, opt in with `clientCredentials: true` in `createServerAuth`.
Expose `serverAuth.clientCredentials.get` and `.renew` through two POST server
functions, and pass them as the client's `credentials`. The browser then
keeps the access token in memory, never the refresh token. The example app
does this.

## Things to know

- **Signing out ends the session only with `revoke`.** A copy of the cookie
  works again ten seconds after sign-out: see
  [Signing out](./server-sessions.md#signing-out).
- **One jar per request.** `startJar()` returns the same jar for every call
  while Start handles a request.
- **Caching.** Pages and server functions that read the session differ per
  user, and Start sends no `Cache-Control` for them. Behind a CDN or proxy
  that caches responses, mark them private, for example with
  `setResponseHeader("Cache-Control", "private, no-store")` from
  `@tanstack/react-start/server` in request middleware, as the example app
  does.
- **Prerendering.** A prerendered page renders at build time, without a
  cookie, so it shows the signed-out state. Don't prerender pages that read
  the session.
- **Tabs.** Signing in or out in one tab reaches the others, which ask the
  server again. So does returning to a tab after a while.
- **More.** Several server instances, the cookie's size, and plain http
  during development: see [Server sessions](./server-sessions.md).
