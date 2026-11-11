![session-kit](https://raw.githubusercontent.com/monarcode/session-kit/main/assets/sk-banner.png)

[![npm](https://img.shields.io/npm/v/@monarcode/session-kit)](https://www.npmjs.com/package/@monarcode/session-kit)
[![CI](https://github.com/monarcode/session-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/monarcode/session-kit/actions/workflows/ci.yml)
[![bundle size](https://deno.bundlejs.com/badge?q=@monarcode/session-kit)](https://bundlejs.com/?q=@monarcode/session-kit)
[![tree-shakeable](https://img.shields.io/badge/tree--shakeable-yes-brightgreen)](https://bundlejs.com/?q=@monarcode/session-kit&treeshake=%5B%7BcreateAuth%2CwebStorage%7D%5D)
[![provenance](https://img.shields.io/badge/provenance-verified-brightgreen?logo=npm)](https://www.npmjs.com/package/@monarcode/session-kit#provenance)
[![license](https://img.shields.io/npm/l/@monarcode/session-kit)](./LICENSE)

[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](#getting-started)
[![TanStack Router](https://img.shields.io/badge/TanStack%20Router-20232a?logo=tanstack&logoColor=white)](./docs/tanstack-router.md)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-20232a?logo=tanstack&logoColor=white)](./docs/tanstack-start.md)
[![React Router](https://img.shields.io/badge/React%20Router-20232a?logo=reactrouter&logoColor=ca4245)](./docs/react-router.md)
[![Next.js](https://img.shields.io/badge/Next.js-20232a?logo=nextdotjs&logoColor=white)](./docs/next.md)
[![Expo](https://img.shields.io/badge/Expo-20232a?logo=expo&logoColor=white)](./docs/expo.md)
[![Effect](https://img.shields.io/badge/Effect-20232a?logo=effect&logoColor=white)](./docs/effect.md)

**Your backend signs users in. session-kit handles everything after.**

session-kit is the session layer for React apps that have their own backend.
Hand it the tokens your sign-in endpoint returns, and it saves the session,
restores it on reload, refreshes tokens before they expire, keeps every tab in
step, and guards your routes.

It works with TanStack Router, React Router, and Expo Router, renders on the
server with TanStack Start, Next.js, and React Router, and comes with an
[Effect](https://effect.website) service and an
[effetch](https://github.com/monarcode/effetch) plugin.

> **Alpha.** Early development: the API may change between releases, and it
> isn't ready for production. See the [release notes](./CHANGELOG.md).

## Contents

- [Why session-kit](#why-session-kit)
  - [What it does](#what-it-does)
  - [What it doesn't do](#what-it-doesnt-do)
- [At a glance](#at-a-glance)
- [Features](#features)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Pick your setup](#pick-your-setup)
- [Getting started](#getting-started)
  - [1. Talk to your backend](#1-talk-to-your-backend)
  - [2. Create the client](#2-create-the-client)
  - [3. Add a sign-in form](#3-add-a-sign-in-form)
  - [4. Read the session in React](#4-read-the-session-in-react)
  - [5. Call your API](#5-call-your-api)
  - [6. Protect your routes](#6-protect-your-routes)
- [TanStack Router](#tanstack-router)
- [React Router](#react-router)
- [Expo Router](#expo-router)
- [Server rendering](#server-rendering)
- [Effect and effetch](#effect-and-effetch)
- [Using the client](#using-the-client)
  - [State](#state)
  - [Sessions and credentials](#sessions-and-credentials)
  - [Signing in and out](#signing-in-and-out)
  - [Updating the user](#updating-the-user)
  - [Authenticated requests](#authenticated-requests)
  - [Other HTTP clients](#other-http-clients)
  - [Users from the access token](#users-from-the-access-token)
  - [Locking](#locking)
- [Configuring the client](#configuring-the-client)
  - [User schemas](#user-schemas)
  - [Refresh](#refresh)
  - [Expiry](#expiry)
  - [Storage](#storage)
  - [Tabs](#tabs)
  - [Errors](#errors)
  - [Debugging](#debugging)
- [Common questions](#common-questions)
- [Security notes](#security-notes)
- [Entry points](#entry-points)
- [Compatibility](#compatibility)
- [Development](#development)
- [License](#license)

## Why session-kit

Signing in is the easy part. Your backend checks a password and answers with
an access token and a refresh token, and for a moment the app is done.

Then the user reloads the page. The access token expires halfway through a
form. They open a second tab, sign out of one, and switch accounts in the
other. The backend goes down for a minute, just as a refresh was due.

Every app with its own backend has to get these moments right. It usually
takes a few hundred lines spread across an auth context, a fetch wrapper, and
the route guards, and one or two cases stay missing until a user finds them.
session-kit is that code, written once and tested with the routers and
frameworks it supports.

### What it does

| When…                                             | session-kit…                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The page reloads                                  | Restores the saved session and checks the user against your schema again. With `localStorage`, before the first paint. |
| The access token is about to expire               | Refreshes it early, in the background, so requests don't wait.                                                         |
| A request gets a 401 anyway                       | Refreshes once, however many requests failed, then replays the safe ones.                                              |
| Two tabs need a refresh at the same moment        | Lets one tab spend the refresh token, and the other reuse what it saved.                                               |
| The user signs out or switches account in one tab | Follows in every tab, and remounts guarded pages so nothing of the previous account stays on screen.                   |
| The backend rejects the refresh token             | Signs out in every tab and clears storage.                                                                             |
| The backend is down when a refresh is due         | Keeps the session, reports the error, and waits for a retry. An outage is not a sign-out.                              |
| A signed-out user opens a private page            | Sends them to sign-in, and back to where they were going afterwards.                                                   |
| The page renders on the server                    | Reads the session from an encrypted cookie, so the first response is already signed in.                                |

### What it doesn't do

session-kit doesn't sign users in. It has no sign-in form, no OAuth flow, and
no user database: it starts where your backend's sign-in response ends. If you
need those too, use an auth service or framework such as Auth.js, Better Auth,
or Clerk, which manage their own sessions.

## At a glance

The whole idea in one file: a client, a sign-in, authenticated requests, and a
component that reads the session.

<!-- file: src/at-a-glance.tsx -->

```tsx
import { createAuth, webStorage } from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { createAuthHooks } from "@monarcode/session-kit/react";
import { z } from "zod";

const API = "https://api.example.com";
const userSchema = z.object({ id: z.string(), name: z.string() });
const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const post = (path: string, body: unknown, init?: RequestInit) =>
  fetch(API + path, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 1. The client: what a user is, where the session is saved, and how its
//    tokens are refreshed.
export const auth = createAuth({
  name: "my-app",
  user: userSchema,
  storage: webStorage(),
  refresh: async ({ refreshToken, signal }) => {
    const response = await post("/auth/refresh", { refreshToken }, { signal });
    if (response.status === 401) return null; // Rejected: sign out.
    if (!response.ok) throw new Error("Refresh failed"); // Outage: stay signed in.
    return tokensSchema.parse(await response.json());
  },
});

// 2. Signing in: your backend checks the password, and session-kit keeps
//    what it returns.
export async function signIn(email: string, password: string) {
  const response = await post("/auth/login", { email, password });
  if (!response.ok) throw new Error("Wrong email or password");
  const session = tokensSchema.extend({ user: userSchema });
  await auth.signIn(session.parse(await response.json()));
}

// 3. Requests: the access token is attached, and refreshed after a 401.
export const api = createAuthFetch(auth, `${API}/`);

// 4. React: state that survives a reload and follows the other tabs.
const { AuthProvider, useAuth } = createAuthHooks<typeof auth>();

function Greeting() {
  const user = useAuth((state) => state.user);
  return <h1>{user ? `Welcome back, ${user.name}` : "Please sign in"}</h1>;
}

export const App = () => (
  <AuthProvider client={auth}>
    <Greeting />
  </AuthProvider>
);
```

[Getting started](#getting-started) builds this up one step at a time, against
a real test backend. Writing your app with Effect? The same session is a
service, with an effetch plugin for requests: see
[Effect and effetch](#effect-and-effetch).

## Features

- **Schema-driven users.** Any [Standard Schema](https://standardschema.dev)
  library, such as Zod, Valibot, or ArkType, validates the user at sign-in, on
  refresh, on restore, and when another tab saves one, and supplies its
  TypeScript types. Or read the user from a JWT access token with
  `fromAccessToken`.
- **Tokens stay out of reach.** State and sessions hold no tokens, so they are
  safe to render and to put in route context. Tokens go only to code that
  attaches them to requests, such as `createAuthFetch`.
- **One client, every router.** TanStack Router, React Router in all three
  modes, and Expo Router each get guards that redirect with a return URL and
  run again when the session changes.
- **Server rendering.** With TanStack Start, Next.js, or React Router
  framework mode, the session lives in an encrypted `httpOnly` cookie, and the
  refresh token never reaches the browser.
- **Native apps.** In Expo, sessions are saved in the iOS keychain or with an
  Android Keystore key, the splash screen holds while restoring, deep links
  survive the sign-in, and a session can lock behind the device's biometrics.
- **Effect.** The same session is an Effect service, `Auth`, whose Effects
  fail with a tagged `AuthFailure`, and `sessionBearer` is an
  [effetch](https://github.com/monarcode/effetch) plugin that sends the access
  token.
- **Made to be debugged.** Every failure is an `AuthError` with a code to
  match on, and `debug: true` logs each restore, refresh, and state change
  without printing a token.
- **Light.** ESM-only, with three small dependencies. Every peer dependency is
  optional, so you install only the router you use.

## How it works

session-kit sits between your backend and your components. Tokens travel on
the left, and only state reaches the right:

```text
    Your backend             session-kit             Your components
 ┌───────────────┐      ┌───────────────────┐      ┌──────────────────┐
 │ POST /login   │ ───▶ │ signIn()          │ ───▶ │ useAuth()        │
 │ POST /refresh │ ◀──▶ │ refresh, on time  │      │ route guards     │
 │ GET  /orders  │ ◀─── │ authFetch()       │ ◀─── │ loaders, queries │
 └───────────────┘      └───────────────────┘      └──────────────────┘
   issues tokens          keeps the session        state, never tokens
```

Five terms come up throughout:

- **Tokens** are what your backend issues. The access token goes with each
  request and is short-lived. The refresh token, if there is one, is exchanged
  for a new access token when the old one expires.
- **The client**, from `createAuth`, holds the tokens and does the work:
  saving, restoring, refreshing, and telling other tabs. An app has one.
- **A session** is who is signed in: `{ sessionId, user }`. It never holds
  tokens, so it is safe to render and to pass around.
- **State** is what components read: `status`, `user`, `sessionId`, and
  `error`, updated as the session changes.
- **Credentials** are the access token and its expiry, given only to code that
  attaches them to requests, such as `createAuthFetch`.

`status` says where the session stands, and checking it narrows `user`:

| `status`          | Meaning                                                                   | `user` |
| ----------------- | ------------------------------------------------------------------------- | ------ |
| `initializing`    | The saved session is being restored.                                      | `null` |
| `authenticated`   | Access is usable.                                                         | Set    |
| `refreshing`      | A refresh is replacing expired or rejected access.                        | Set    |
| `locked`          | With `locking`, a session is saved, but its tokens wait for `unlock()`.   | Set    |
| `unauthenticated` | No session; sign-in is needed.                                            | `null` |
| `unavailable`     | Restoring failed, or a failed refresh left no usable access; see `error`. | `null` |

The session is kept in one of two places, depending on where your app renders:

|                   | In the browser or on the device                                            | On the server                                              |
| ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| For               | Single-page apps and Expo apps                                             | TanStack Start, Next.js, React Router with SSR             |
| Client            | `createAuth`                                                               | `createServerAuth`, with `createMirrorAuth` in the browser |
| Saved in          | `localStorage`, `sessionStorage`, or the iOS keychain and Android Keystore | An encrypted `httpOnly` cookie                             |
| The refresh token | Stays in that storage                                                      | Never reaches the browser                                  |

Hooks, guards, and tab sync work the same in both.

## Installation

```sh
pnpm add @monarcode/session-kit
```

Alpha releases are published to the `latest` distribution tag and may change
the public API, so pin an exact version and read the
[release notes](./CHANGELOG.md) before upgrading.

Any [Standard Schema](https://standardschema.dev) library describes users.
The examples use Zod:

```sh
pnpm add zod
```

Every peer dependency is optional: install React and the router your setup
uses. [Compatibility](#compatibility) lists the supported versions.

## Pick your setup

Each setup has a guide, summarized further down this page, and a runnable app
in [`examples/`](./examples) that signs in against DummyJSON's public test
API.

| Setup                                      | Import                                   | Guide                                                                   | Example app                                                                                                                  |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| React without a router                     | `@monarcode/session-kit/react`           | [Getting started](#getting-started)                                     | None                                                                                                                         |
| TanStack Router                            | `@monarcode/session-kit/tanstack-router` | [TanStack Router](./docs/tanstack-router.md)                            | [`tanstack-router`](./examples/tanstack-router)                                                                              |
| TanStack Start, SPA mode                   | `@monarcode/session-kit/tanstack-router` | [TanStack Router](./docs/tanstack-router.md#tanstack-start-in-spa-mode) | [`tanstack-start-spa`](./examples/tanstack-start-spa), [`tanstack-start-spa-effetch`](./examples/tanstack-start-spa-effetch) |
| TanStack Start with server rendering       | `@monarcode/session-kit/tanstack-start`  | [TanStack Start](./docs/tanstack-start.md)                              | [`tanstack-start-ssr`](./examples/tanstack-start-ssr)                                                                        |
| React Router, declarative mode             | `@monarcode/session-kit/react-router`    | [React Router](./docs/react-router.md#declarative-mode)                 | [`react-router-declarative`](./examples/react-router-declarative)                                                            |
| React Router, data mode                    | `@monarcode/session-kit/react-router`    | [React Router](./docs/react-router.md#data-mode)                        | [`react-router-data`](./examples/react-router-data)                                                                          |
| React Router, framework mode, `ssr: false` | `@monarcode/session-kit/react-router`    | [React Router](./docs/react-router.md#framework-mode-with-ssr-false)    | [`react-router-framework-spa`](./examples/react-router-framework-spa)                                                        |
| React Router, framework mode with SSR      | `@monarcode/session-kit/react-router`    | [React Router with SSR](./docs/react-router-ssr.md)                     | [`react-router-framework-ssr`](./examples/react-router-framework-ssr)                                                        |
| Next.js 16, App Router                     | `@monarcode/session-kit/next`            | [Next.js](./docs/next.md)                                               | [`next-app`](./examples/next-app)                                                                                            |
| Expo Router on iOS and Android, SDK 53+    | `@monarcode/session-kit/expo`            | [Expo Router](./docs/expo.md)                                           | [`expo-router`](./examples/expo-router)                                                                                      |

Two guides apply to more than one setup:
[Server sessions](./docs/server-sessions.md) covers what the three
server-rendered setups share, and [Effect and effetch](#effect-and-effetch)
work with any of them.

## Getting started

This builds a small app in six steps: sign in, stay signed in across reloads
and tabs, call an API, and sign out. The steps are the same for every setup
that keeps the session in the browser or on the device. Server-rendered apps
create their client differently, so start from
[Server rendering](#server-rendering) instead.

The code signs in against
[DummyJSON's auth API](https://dummyjson.com/docs/auth), a public test
backend, so it runs as written.

### 1. Talk to your backend

session-kit never calls your backend for you, so start with the two requests
you would write anyway: one that signs in, and one that exchanges a refresh
token for new tokens. Nothing in this file imports session-kit.

`src/backend.ts`

<!-- file: src/backend.ts -->

```ts
import { z } from "zod";

export const API = "https://dummyjson.com";

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  firstName: z.string(),
});

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const post = (path: string, body: unknown, init?: RequestInit) =>
  fetch(API + path, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Checks the password, and resolves the tokens and the user. */
export async function login(username: string, password: string) {
  const response = await post("/auth/login", { username, password });
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  // DummyJSON returns the user's fields beside the tokens.
  const body: unknown = await response.json();
  return { ...tokensSchema.parse(body), user: userSchema.parse(body) };
}

/**
 * Exchanges a refresh token for new tokens. Resolves `null` when the backend
 * rejects the token, and throws for any other failure.
 */
export async function refresh(refreshToken: string, signal: AbortSignal) {
  const response = await post("/auth/refresh", { refreshToken }, { signal });
  // DummyJSON answers 403 for an invalid token and 401 for a missing one.
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
  return tokensSchema.parse(await response.json());
}
```

The schemas do two jobs: they check what the backend sent, and they give the
rest of the app its types. Requests omit `credentials: "include"`, because
session-kit keeps tokens out of cookies and attaches them itself.

### 2. Create the client

The client is the one object that knows about the session. Tell it what a
user is, where to save the session, and how to refresh.

`src/auth.ts`

<!-- file: src/auth.ts -->

```ts
import { createAuth, webStorage } from "@monarcode/session-kit";

import { login, refresh, userSchema } from "./backend.js";

export const auth = createAuth({
  // Keeps this app's saved session apart from any other on the same origin.
  name: "my-app",
  // Every user is checked against this schema, and typed by it.
  user: userSchema,
  // Where the session is saved: `localStorage`.
  storage: webStorage(),
  // How expired access is replaced.
  refresh: ({ refreshToken, signal }) => refresh(refreshToken, signal),
});

/** Signs in with the backend, then hands the result to session-kit. */
export async function signInWithPassword(username: string, password: string) {
  await auth.signIn(await login(username, password));
}

export type AppAuth = typeof auth;
```

`refresh` tells two failures apart. `null` means the backend rejected the
refresh token, so the user is signed out. A throw means something else failed,
so the session is kept and the error reported. That split is why an outage
doesn't sign anyone out. [Refresh](#refresh) has the details, and
[Storage](#storage) lists the other places a session can be saved.

Create one client per `name` in each tab. DummyJSON's
tokens are JWTs, so their expiry comes from the `exp` and `iat` claims; see
[Expiry](#expiry) for backends that say it another way.

### 3. Add a sign-in form

`signInWithPassword` is all a form needs. It has no session-kit code of its
own.

`src/sign-in.tsx`

<!-- file: src/sign-in.tsx -->

```tsx
import { useState, type FormEvent } from "react";

import { signInWithPassword } from "./auth.js";

export function SignIn({ onSignedIn }: { onSignedIn?: () => unknown }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      await signInWithPassword(
        String(form.get("username")),
        String(form.get("password")),
      );
      await onSignedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      {/* DummyJSON's documented test user. */}
      <label>
        Username
        <input name="username" defaultValue="emilys" autoComplete="username" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          defaultValue="emilyspass"
          autoComplete="current-password"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
```

The form doesn't have to do anything when it succeeds: signing in changes the
client's state, and the next step renders from that state. `onSignedIn` is for
routers, which use it to send the user on to the page they asked for.

### 4. Read the session in React

Create the hooks once, typed by your client, and export them for every
component to share.

`src/hooks.ts`

<!-- file: src/hooks.ts -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";

import type { auth } from "./auth.js";

export const { AuthProvider, useAuth, useAuthClient } =
  createAuthHooks<typeof auth>();
```

Then render by `status`. Each case is one of the states in
[How it works](#how-it-works), and TypeScript knows `user` is set by the time
the last one is reached.

`src/app.tsx`

<!-- file: src/app.tsx -->

```tsx
import { auth } from "./auth.js";
import { AuthProvider, useAuth, useAuthClient } from "./hooks.js";
import { SignIn } from "./sign-in.js";

export function App() {
  return (
    <AuthProvider client={auth}>
      <AuthError />
      <Screen />
    </AuthProvider>
  );
}

function Screen() {
  const { status, user } = useAuth();
  const client = useAuthClient();

  switch (status) {
    case "initializing":
      return <p>Restoring your session…</p>;
    case "unauthenticated":
      return <SignIn />;
    case "unavailable":
      // Access couldn't be restored or refreshed: offer another try.
      return (
        <button onClick={() => void client.retry().catch(() => {})}>
          Try again
        </button>
      );
    default:
      // Signed in: "authenticated", or "refreshing" with the user on screen.
      return (
        <main>
          <h1>Welcome, {user.firstName}</h1>
          <button onClick={() => void client.signOut().catch(() => {})}>
            Sign out
          </button>
        </main>
      );
  }
}

/** The latest failure, such as a refresh the backend couldn't answer. */
function AuthError() {
  const error = useAuth((state) => state.error);
  return error ? <p role="alert">{error.message}</p> : null;
}
```

- `AuthProvider` mounts the client: it restores the saved session, starts the
  refresh timer, and follows other tabs.
- `useAuth()` returns the whole state. `useAuth(selector)` returns a part of
  it, and re-renders only when that part changes, as `AuthError` does.
- `useAuthClient()` returns the client, for actions.
- `retry` and `signOut` reject when they fail, and publish the same failure in
  `state.error`. `AuthError` shows it, so the handlers have nothing left to
  do.

With [`locking`](#locking), give `locked` a case of its own: it has a user
too, but no usable access.

That is a working app. Sign in and reload: you are still signed in. Open a
second tab and sign out: both tabs show the form.

### 5. Call your API

`createAuthFetch` makes a `fetch` that sends the access token to one origin,
and to no other.

`src/api.ts`

<!-- file: src/api.ts -->

```ts
import { createAuthFetch } from "@monarcode/session-kit/http";

import { auth } from "./auth.js";
import { API, userSchema } from "./backend.js";

export const authFetch = createAuthFetch(auth, `${API}/`);

/** The signed-in user, fresh from the backend. */
export async function fetchProfile() {
  const response = await authFetch("auth/me");
  if (!response.ok) throw new Error(`Profile failed (${response.status})`);
  return userSchema.parse(await response.json());
}
```

When a request gets a 401, `authFetch` refreshes, then sends a GET or HEAD
again. Other methods are never sent twice.
[Authenticated requests](#authenticated-requests) covers the rest of its
behaviour and its options.

### 6. Protect your routes

The client is the same everywhere. What changes is how each router keeps
signed-out users away from private pages, so continue with yours:

- [TanStack Router](#tanstack-router), and TanStack Start in SPA mode.
- [React Router](#react-router), in any of its three modes.
- [Expo Router](#expo-router), for iOS and Android.
- Without a router, you are done: render by `status`, as `Screen` does.

With Effect, the same client becomes a service: see
[Effect and effetch](#effect-and-effetch).

[Using the client](#using-the-client) then covers what else the client does.

## TanStack Router

With TanStack Router, the client lives in Router context. Guards run in
`beforeLoad`, before a private route loads or renders, and the hooks read the
client from the Router, so they need no `AuthProvider`.

```sh
pnpm add @tanstack/react-router
pnpm add -D @tanstack/router-plugin
```

The examples use file-based routing, which the Router plugin sets up as
[the guide](./docs/tanstack-router.md#installation) shows.

Create the hooks from the Router's client, in place of the ones from Getting
started:

<!-- from: docs/tanstack-router.md -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";
import { useRouterAuth } from "@monarcode/session-kit/tanstack-router";

// Reads the client from Router context, so no provider is needed.
export const { useAuth, useAuthClient } = createAuthHooks({
  useClient: useRouterAuth,
});
```

Guard a layout route, and every route under it is private:

<!-- from: docs/tanstack-router.md -->

```tsx
import {
  requireSession,
  SessionOutlet,
} from "@monarcode/session-kit/tanstack-router";
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { useAuthClient } from "../hooks.js";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) =>
    requireSession(context.auth, { location, loginPath: "/login" }),
  errorComponent: SessionError,
  component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
});

/** Shown after a failed refresh; a repeated failure stays in state.error. */
function SessionError({ error }: ErrorComponentProps) {
  const auth = useAuthClient();
  return (
    <div role="alert">
      <p>{error instanceof Error ? error.message : "Something went wrong"}</p>
      <button onClick={() => void auth.retry().catch(() => {})}>Retry</button>
    </div>
  );
}
```

`requireSession` redirects signed-out users to `loginPath`, with `redirectTo`
set to where they were going, and puts `{ session }` in route context, where
`session.user` is typed and never `null`. `SessionOutlet` renders the child
routes while that session is still the signed-in one, and remounts them for a
new account, so nothing from the previous one stays on screen.

Then connect auth to the Router, once:

<!-- from: docs/tanstack-router.md -->

```tsx
import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { auth } from "./auth.js";
import { routeTree } from "./routeTree.gen.js";

export const router = createRouter({
  routeTree,
  context: { auth },
  defaultPendingComponent: () => <p>Loading…</p>,
});

// Restores the session, runs expiry timers and tab sync, and re-runs guards
// when auth changes. Call it once, beside the Router.
export const disconnectAuth = connectAuth(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

The [TanStack Router guide](./docs/tanstack-router.md) walks through the whole
app, and covers:

- The sign-in route, and returning the user to the page they asked for.
- [Layouts around guarded pages](./docs/tanstack-router.md#layouts-around-guarded-pages),
  such as a dashboard with a sidebar.
- [TanStack Start in SPA mode](./docs/tanstack-router.md#tanstack-start-in-spa-mode).

Example apps: [`tanstack-router`](./examples/tanstack-router),
[`tanstack-start-spa`](./examples/tanstack-start-spa), and
[`tanstack-start-spa-effetch`](./examples/tanstack-start-spa-effetch).

## React Router

React Router has three modes, and session-kit guards each one the way that
mode works. In all three, `AuthProvider` goes around the router.

| Mode                         | The guard                          | Beside it                              |
| ---------------------------- | ---------------------------------- | -------------------------------------- |
| Declarative                  | `SessionOutlet`                    | Nothing                                |
| Data                         | `requireSession` in loaders        | `SessionOutlet`, `useAuthRevalidation` |
| Framework, with `ssr: false` | `requireSession` in `clientLoader` | `SessionOutlet`, `useAuthRevalidation` |

```sh
pnpm add react-router
```

In declarative mode there are no loaders, so `SessionOutlet` is the guard.
Render it as a layout route's element, `<Route element={<Private />}>`, and
the routes inside it are private:

<!-- from: docs/react-router.md -->

```tsx
/** The guard: its child routes render only while someone is signed in. */
function Private() {
  return (
    <SessionOutlet
      loginPath="/login"
      pending={<p>Checking session…</p>}
      unavailable={({ error, retry }) => (
        <div role="alert">
          <p>{error?.message ?? "Can't reach the server."}</p>
          <button onClick={retry}>Try again</button>
        </div>
      )}
    />
  );
}
```

In data and framework mode, the guard runs in the loader, so a private
route's data is never fetched for a signed-out user. `useAuthRevalidation`
runs the loaders again when the session changes:

<!-- from: docs/react-router.md -->

```tsx
/** Runs the loaders again when auth changes, and with them the guards. */
function Root() {
  useAuthRevalidation();
  return <Outlet />;
}
```

<!-- from: docs/react-router.md -->

```tsx
export const router = createBrowserRouter([
  {
    element: <Root />,
    HydrateFallback: () => <p>Checking session…</p>,
    children: [
      {
        path: "/login",
        loader: async ({ request }) => {
          const redirectTo = new URL(request.url).searchParams.get(
            "redirectTo",
          );
          await redirectIfSignedIn(auth, { redirectTo });
          return null;
        },
        element: <Login />,
      },
      {
        loader: ({ request }) =>
          requireSession(auth, { request, loginPath: "/login" }),
        errorElement: <SessionError />,
        element: (
          <SessionOutlet
            loginPath="/login"
            pending={<p>Checking session…</p>}
          />
        ),
        children: [{ index: true, element: <Home /> }],
      },
    ],
  },
]);
```

`Login`, `SessionError`, and `Home` are ordinary components, which the guide
shows. `SessionOutlet` is still the guarded route's element: when another account
signs in, it shows `pending` until the loader has run for the new session, so
no page sees the previous account's loader data.

The [React Router guide](./docs/react-router.md) has each mode in full,
framework mode's route modules, and
[layouts around guarded pages](./docs/react-router.md#layouts-around-guarded-pages).

Example apps: [`react-router-declarative`](./examples/react-router-declarative),
[`react-router-data`](./examples/react-router-data), and
[`react-router-framework-spa`](./examples/react-router-framework-spa).

## Expo Router

In an Expo app, the session is saved with `secureStorage()`, in the iOS
keychain or encrypted with an Android Keystore key. Expo Router's
`Stack.Protected` guards the screens, and `SessionGate` wraps the root
navigator: it holds the splash screen while the session is restored, renders
`unavailable` after a failed refresh, and checks the session again when the
app returns to the foreground.

```sh
npx expo install expo-secure-store expo-file-system
```

<!-- from: docs/expo.md -->

```tsx
export default function RootLayout() {
  return (
    <AuthProvider client={auth}>
      <SessionGate unavailable={(props) => <Unavailable {...props} />}>
        <RootStack />
      </SessionGate>
    </AuthProvider>
  );
}

function RootStack() {
  // `status`, not `user`: a locked session keeps its user. See Locking.
  const status = useAuth((state) => state.status);
  const signedIn = status === "authenticated" || status === "refreshing";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
```

The [Expo guide](./docs/expo.md) builds the whole app: the client, deep links
kept across the sign-in with `rememberDeepLink`, and
[locking](./docs/expo.md#locking) a session behind the device's biometrics.

Example app: [`expo-router`](./examples/expo-router).

## Server rendering

With server rendering, the session lives on the server: both tokens and the
user sit in one encrypted, `httpOnly` cookie that page scripts can't read. The
first response already shows the signed-in page, with no "Checking session…"
state, and the refresh token never reaches the browser.

- **On the server**, `createServerAuth` from `@monarcode/session-kit/server`
  seals the cookie with your secret and refreshes before rendering. Each of
  its methods takes the request's cookie jar, which each framework's adapter
  gives you.
- **In the browser**, `createMirrorAuth` makes a client that starts from the
  session the server rendered. `AuthProvider`, the hooks, and the router
  guards work with it, and sign-ins and sign-outs reach every tab.
- **Your server code** signs in and out with your backend and calls your API
  with the access token. `serverAuth.forRequest(jar)` gives code written for
  a client, such as `createAuthFetch` or Effect's `Auth`, one request's
  session. To call your API from the browser too, opt in with
  `clientCredentials`: page scripts then get the access token in memory,
  never the refresh token.

The engine is the same call in every framework. This one is from the TanStack
Start guide:

<!-- from: docs/tanstack-start.md -->

```ts
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
```

The browser's client mirrors what the server rendered, and asks the server to
sign in and out, here through the app's own server functions:

<!-- from: docs/tanstack-start.md -->

```ts
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
```

What differs between frameworks is how the cookie jar reaches the engine, and
how the session reaches the browser:

| Framework                             | On the server                                   | In the browser                                      | Guide                                      |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| TanStack Start                        | `startJar()`, refreshing in request middleware  | `sessionHydration`, `loadSession`                   | [TanStack Start](./docs/tanstack-start.md) |
| Next.js 16, App Router                | `nextJar(await cookies())`, `proxyJar` in Proxy | `useMirrorAuth` from `@monarcode/session-kit/react` | [Next.js](./docs/next.md)                  |
| React Router framework mode, with SSR | `cookieJarMiddleware`, `routerJar(context)`     | `useMirrorAuth` from `@monarcode/session-kit/react` | [React Router](./docs/react-router-ssr.md) |

Locking isn't available with server rendering. For another server, such as
the Next.js Pages Router, build a `CookieJar` over its cookies and use
`createServerAuth` directly. [Server sessions](./docs/server-sessions.md)
covers the secret, cookie jars, refreshing across instances, and limits.

## Effect and effetch

If your app is written with [Effect](https://effect.website), the session is a
service. `@monarcode/session-kit/effect` wraps the client you already have, so
React, your router, and your Effects share one session, and an auth error is a
typed failure like any other. With
[effetch](https://github.com/monarcode/effetch) and
[effetch-query](https://github.com/monarcode/effetch-query), an app has a
few small pieces: the transport, the session, the API client, the runtime, and
the queries.

```sh
pnpm add effect @monarcode/effetch @monarcode/effetch-query @effect/atom-react
```

**The transport.** Every request goes through Effect's `HttpClient`, so set it
up once.

`src/http/fetch.ts`

<!-- file: src/http/fetch.ts -->

```ts
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

/**
 * `fetch`, without the tracing headers Effect adds to every request: from a
 * browser, they fail the preflight of an API that doesn't allow them.
 */
export const FetchLive = Layer.merge(
  FetchHttpClient.layer,
  Layer.succeed(HttpClient.TracerPropagationEnabled, false),
);
```

**The session.** The client is the one from
[Getting started](#2-create-the-client), written with Effect: an Effect
Schema describes the user, and the refresh is an effetch call.

`src/session/auth.ts`

<!-- file: src/session/auth.ts -->

```ts
import * as Fetch from "@monarcode/effetch";
import { createAuth, webStorage } from "@monarcode/session-kit";
import { Auth } from "@monarcode/session-kit/effect";
import { createAuthHooks } from "@monarcode/session-kit/react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { FetchLive } from "../http/fetch.js";

export const API_BASE_URL = "https://dummyjson.com";

export const SessionUser = Schema.Struct({
  id: Schema.Finite,
  username: Schema.String,
  email: Schema.String,
  firstName: Schema.String,
});

export const SessionTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
});

// Not the app's API client: its session plugin waits for this refresh.
const makeRefreshClient = Fetch.make({ baseUrl: API_BASE_URL });

// `null` signs out; a failure keeps the session for a retry.
const refreshSession = (refreshToken: string) =>
  Effect.gen(function* () {
    const client = yield* makeRefreshClient;
    return yield* client.post("/auth/refresh", {
      body: { refreshToken },
      output: SessionTokens,
    });
  }).pipe(
    Effect.catchTag("HttpError", (error) =>
      error.status === 401 || error.status === 403
        ? Effect.succeed(null)
        : Effect.fail(error),
    ),
    Effect.provide(FetchLive),
  );

export const auth = createAuth({
  name: "my-app",
  user: Schema.toStandardSchemaV1(SessionUser),
  storage: webStorage(),
  refresh: ({ refreshToken, signal }) =>
    Effect.runPromise(refreshSession(refreshToken), { signal }),
});

export const { AuthProvider, useAuth, useAuthClient } =
  createAuthHooks<typeof auth>();

// Registered once, so every `Auth` Effect is typed with your user.
declare module "@monarcode/session-kit/effect" {
  interface Register {
    auth: typeof auth;
  }
}

export const AuthLive = Auth.layer(auth);
```

**The API client.** `sessionBearer` is an effetch plugin that does what
`createAuthFetch` does: it sends the access token to one origin, and refreshes
after a 401.

`src/http/api-client.ts`

<!-- file: src/http/api-client.ts -->

```ts
import * as Fetch from "@monarcode/effetch";
import { sessionBearer } from "@monarcode/session-kit/effetch";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { API_BASE_URL } from "../session/auth.js";

const make = Fetch.make({
  baseUrl: API_BASE_URL,
  // The body the API answers a failure with.
  defaultError: Schema.Struct({ message: Schema.String }),
  // `optional`: a call made while signed out, such as the sign-in itself,
  // goes without a token.
  plugins: [sessionBearer({ baseUrl: API_BASE_URL, optional: true })],
});

export class ApiClient extends Context.Service<
  ApiClient,
  Effect.Success<typeof make>
>()("ApiClient") {}

export const ApiClientLive = Layer.effect(ApiClient, make);
```

**The runtime.** One place composes the app's layers, and everything that
runs an Effect uses its runtime.

`src/runtime.ts`

<!-- file: src/runtime.ts -->

```ts
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { ApiClientLive } from "./http/api-client.js";
import { FetchLive } from "./http/fetch.js";
import { AuthLive } from "./session/auth.js";

const AppLayer = ApiClientLive.pipe(
  Layer.provideMerge(AuthLive),
  Layer.provide(FetchLive),
);

/** One runtime for the app's lifetime. */
export const appRuntime = ManagedRuntime.make(AppLayer);
export type AppRuntime = typeof appRuntime;
```

**The queries.** effetch-query turns endpoints into cached queries and
mutations that run with that runtime, so components never run an Effect by
hand.

`src/query.ts`

<!-- file: src/query.ts -->

```ts
import { QueryClient } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";
import type * as ManagedRuntime from "effect/ManagedRuntime";

import { ApiClient } from "./http/api-client.js";
import { appRuntime, type AppRuntime } from "./runtime.js";

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: ManagedRuntime.ManagedRuntime.Services<AppRuntime>;
  }
}

export const api = endpoints(ApiClient);

export const makeQueryClient = () => QueryClient.make({ runtime: appRuntime });
```

A feature then declares its endpoints, and its components use them:

`src/account.tsx`

<!-- file: src/account.tsx -->

```tsx
import type { ReactNode } from "react";

import * as Fetch from "@monarcode/effetch";
import {
  QueryProvider,
  useMutation,
  useQuery,
} from "@monarcode/effetch-query/react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import { api, makeQueryClient } from "./query.js";
import {
  SessionTokens,
  SessionUser,
  useAuth,
  useAuthClient,
} from "./session/auth.js";

const signInMutation = api.mutation(
  Fetch.endpoint("POST /auth/login", {
    input: Schema.Struct({ username: Schema.String, password: Schema.String }),
    // DummyJSON returns the user's fields beside the tokens.
    output: Schema.Struct({ ...SessionTokens.fields, ...SessionUser.fields }),
  }),
);

const profileQuery = api.query(
  Fetch.endpoint("GET /auth/me", { output: SessionUser }),
);

/** A cache for each session, so no account sees another's data. */
export function QueryProviders({ children }: { children: ReactNode }) {
  const sessionId = useAuth((state) => state.sessionId);
  return (
    <QueryProvider make={makeQueryClient} resetKey={sessionId ?? undefined}>
      {children}
    </QueryProvider>
  );
}

export function SignInButton() {
  const auth = useAuthClient();
  const { result, run } = useMutation(signInMutation);
  return (
    <button
      disabled={result.waiting}
      onClick={() =>
        run(
          // DummyJSON's documented test user.
          { body: { username: "emilys", password: "emilyspass" } },
          {
            onSuccess: ({ accessToken, refreshToken, ...user }) =>
              auth.signIn({ accessToken, refreshToken, user }),
          },
        )
      }
    >
      Sign in
    </button>
  );
}

export function Email() {
  const result = useQuery(profileQuery());
  return AsyncResult.match(result, {
    onInitial: () => <p>Loading…</p>,
    onFailure: () => <p>Couldn't load your profile.</p>,
    onSuccess: ({ value }) => <p>{value.email}</p>,
  });
}
```

Render `QueryProviders` inside `AuthProvider`. Effects of your own read the
session from the `Auth` service, as `Auth.session`, and fail with a tagged
`AuthFailure` whose `code` is the client's `AuthErrorCode`.

A complete app is in
[`examples/tanstack-start-spa-effetch`](./examples/tanstack-start-spa-effetch).
The [Effect guide](./docs/effect.md) covers the `Auth` service: reading the
session, handling its failures, signing in and out, updating the user,
watching the session as a `Stream`, and using it on the server, one request
at a time.

## Using the client

Components read the session with hooks. Everything else, such as loaders,
event handlers, and request code, talks to the client that `createAuth`
returned. This is the whole of it:

| Call                               | What it does                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `auth.state.get()`, `.subscribe()` | Reads the [state](#state), or follows its changes.                   |
| `auth.getSession()`                | Resolves who is signed in, restoring or refreshing first, or `null`. |
| `auth.signIn(tokens)`              | Saves a new session, replacing any current one.                      |
| `auth.signOut()`                   | Ends the session in every tab and clears storage.                    |
| `auth.updateUser(user)`            | Replaces the user and keeps the session.                             |
| `auth.refresh()`                   | Refreshes now, even while the access token is usable.                |
| `auth.retry()`                     | Tries again after a failed refresh.                                  |
| `auth.isCurrent(session)`          | Tells whether a session is still the signed-in one.                  |
| `auth.credentials.get()`           | Resolves the access token, for code that sends requests.             |
| `auth.lock()`, `auth.unlock()`     | Locks and unlocks a saved session, with [`locking`](#locking).       |
| `auth.mount()`                     | Starts timers and tab sync. `AuthProvider` and the routers call it.  |

Each method's JSDoc says what it resolves and which `AuthError` it rejects
with, so your editor shows the details where you use them.

### State

`auth.state` is what `useAuth` reads. Outside React, read it once with `get`,
or follow it with `subscribe`:

<!-- file: src/status-log.ts -->

```ts
import { auth } from "./auth.js";

/** Logs each change of status. Returns a function that stops it. */
export function logStatus() {
  let last = auth.state.get().status;
  const { unsubscribe } = auth.state.subscribe(({ status }) => {
    if (status === last) return;
    last = status;
    console.info(`Auth is ${status}`);
  });
  return unsubscribe;
}
```

`subscribe` reports later changes, not the current value. A listener that
throws doesn't interrupt auth: its error is rethrown asynchronously, where
error reporting can catch it.

| Field       | Holds                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| `status`    | Where the session stands; [How it works](#how-it-works) lists each one.               |
| `user`      | The signed-in user, or `null`. Checking `status` narrows it.                          |
| `sessionId` | New on every sign-in, and stable across refreshes and profile updates.                |
| `error`     | The latest failure, as an [`AuthError`](#errors), or `null`.                          |
| `version`   | Changes when guards must run again. `connectAuth` and `useAuthRevalidation` watch it. |

Two habits follow from this. Scope private cached data, such as TanStack Query
results, to `sessionId`, so one account never sees another's. And to know
whether access is usable, check `status`, not `user`: a
[locked](#locking) session keeps its user.

### Sessions and credentials

A **session** is who is signed in, `{ sessionId, user }`, and never holds
tokens. `getSession()` is how code outside React asks for it. It waits for a
restore or a refresh that is under way, so a loader never acts on a stale
answer:

<!-- file: src/cart.ts -->

```ts
import { authFetch } from "./api.js";
import { auth } from "./auth.js";

/** A loader: it runs outside React, so it asks the client. */
export async function loadCart(): Promise<unknown> {
  const session = await auth.getSession();
  if (!session) return null;
  const response = await authFetch(`auth/carts/user/${session.user.id}`);
  if (!response.ok) throw new Error(`Cart failed (${response.status})`);
  return response.json();
}
```

**Credentials** are the access token, `{ sessionId, accessToken, expiresAt }`,
kept apart so that code which only needs the user never holds one.
`createAuthFetch` uses them for you, through three calls.
[Other HTTP clients](#other-http-clients) shows them with axios and ky:

- `auth.credentials.get()` resolves the current credentials, or `null`.
- `auth.credentials.renew(credentials)` recovers after a 401. However many
  requests failed, they share one refresh.
- `auth.credentials.reject(credentials)` ends a session the server keeps
  refusing, unless a newer one has replaced it.

`auth.isCurrent({ sessionId })` tells whether a session you are holding is
still the signed-in one, for work that may finish after an account switch.

### Signing in and out

`auth.signIn({ accessToken, refreshToken?, expiresIn?, user })` validates and
saves a new session, replacing any current one. The latest call wins, and
invalid input keeps the previous session. [Expiry](#expiry) covers how the
token's lifetime is found.

`auth.signOut()` ends the session in every tab and clears storage. If your
backend can revoke tokens, give the client a `revoke` callback: it receives
the ended tokens once the user is already signed out.

<!-- file: src/revoke.ts -->

```ts
import type { RevokeFn } from "@monarcode/session-kit";

/** Pass as `createAuth`'s `revoke` option. */
export const revoke: RevokeFn = async ({ refreshToken, signal }) => {
  if (!refreshToken) return;
  const response = await fetch("https://api.example.com/auth/revoke", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) throw new Error(`Revoke failed (${response.status})`);
};
```

A failed revocation is reported in `state.error` as `REVOKE_FAILED` without
undoing the sign-out: the user asked to leave, and has. A session the backend
already rejected is not revoked.

### Updating the user

`auth.updateUser` replaces the user and keeps the session. Pass it a function
that fetches the new user, rather than the user itself, whenever a request is
involved. The session is noted before the function runs, so if it changes
meanwhile the result is discarded instead of landing on another account.
`fetchProfile` is the request from [Getting started](#5-call-your-api):

<!-- file: src/profile.ts -->

```ts
import { fetchProfile } from "./api.js";
import { auth } from "./auth.js";

export const reloadProfile = () => auth.updateUser(fetchProfile);
```

### Authenticated requests

`createAuthFetch(auth, baseUrl)` returns a `fetch` for one API. It is built so
that a token can't leak and a user can't be signed out by accident:

| When…                                   | `authFetch`…                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| The path is on another origin           | Rejects with `INVALID_OPTIONS`. The token goes only to `baseUrl`'s origin.   |
| The response is a redirect              | Rejects rather than following it.                                            |
| The response is a 401                   | Refreshes once, then sends a GET or HEAD again with the new token.           |
| A POST, PUT, PATCH or DELETE gets a 401 | Refreshes, and resolves the 401. It never sends a request twice on its own.  |
| The replayed request gets a 401 too     | Signs out, unless `signOutOnRepeated401` is `false`.                         |
| The session changes during the request  | Rejects with `SESSION_CHANGED` rather than resolve another account's answer. |
| Nobody is signed in                     | Rejects with `UNAUTHENTICATED`, unless `optional` is `true`.                 |
| The network fails                       | Rejects as `fetch` does, unchanged.                                          |

Because a write is never replayed for you, retry it yourself where sending it
twice is safe. By then the token has been refreshed:

<!-- file: src/add-to-cart.ts -->

```ts
import { authFetch } from "./api.js";

export async function addToCart(userId: number, productId: number) {
  const send = () =>
    authFetch("auth/carts/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        products: [{ id: productId, quantity: 1 }],
      }),
    });

  let response = await send();
  // The 401 refreshed the token, so one more try uses the new one.
  if (response.status === 401) response = await send();
  if (!response.ok) throw new Error(`Add to cart failed (${response.status})`);
}
```

Two options change the defaults:

<!-- file: src/public-api.ts -->

```ts
import { createAuthFetch } from "@monarcode/session-kit/http";

import { auth } from "./auth.js";
import { API } from "./backend.js";

export const publicFetch = createAuthFetch(auth, `${API}/`, {
  // One `fetch` for public and private endpoints: signed out, requests are
  // sent without a token instead of rejecting.
  optional: true,
  // For APIs that answer 401 for reasons other than a rejected token, so one
  // of those endpoints can't sign users out.
  signOutOnRepeated401: false,
});
```

### Other HTTP clients

`createAuthFetch` and the effetch plugin are built on three calls, and any
other HTTP client can use the same ones:

1. **Before a request**, `auth.credentials.get()` resolves the credentials to
   send, waiting for a restore or a refresh that is under way. It resolves
   `null` when nobody is signed in.
2. **After a 401**, `auth.credentials.renew(credentials)` takes the
   credentials that request was sent with, and resolves new ones. However many
   requests failed, they share one refresh. It resolves `null` when the user
   was signed out instead.
3. **After a second 401**, `auth.credentials.reject(credentials)` ends the
   session, unless a newer one has replaced it.

With [axios](https://axios-http.com), that is two interceptors:

<!-- file: src/axios.ts -->

```ts
import type { Credentials } from "@monarcode/session-kit";
import axios, { type InternalAxiosRequestConfig } from "axios";

import { auth } from "./auth.js";
import { API } from "./backend.js";

type Config = InternalAxiosRequestConfig & { replayed?: boolean };

// One instance for one API, so the token goes nowhere else.
export const http = axios.create({ baseURL: API });

/** The credentials each request was sent with. */
const sent = new WeakMap<Config, Credentials>();

http.interceptors.request.use(async (config) => {
  const credentials = await auth.credentials.get();
  // Signed out, the request goes without a token, as a public one would.
  if (credentials) {
    config.headers.set("Authorization", `Bearer ${credentials.accessToken}`);
    sent.set(config, credentials);
  }
  return config;
});

http.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;
  const config: Config | undefined = error.config;
  const used = config && sent.get(config);
  if (!config || !used) throw error;

  if (config.replayed) {
    // The new token was refused too: end the session.
    await auth.credentials.reject(used);
    throw error;
  }
  const fresh = await auth.credentials.renew(used);
  // Only a GET is safe to send twice. For anything else the caller decides.
  if (!fresh || config.method !== "get") throw error;
  const replay: Config = { ...config, replayed: true };
  return http.request(replay);
});
```

With [ky](https://github.com/sindresorhus/ky), two hooks do the same. The
request's `context` carries the credentials from one hook to the other:

<!-- file: src/ky.ts -->

```ts
import type { Credentials } from "@monarcode/session-kit";
import ky from "ky";

import { auth } from "./auth.js";
import { API } from "./backend.js";

export const api = ky.create({
  baseUrl: `${API}/`,
  hooks: {
    beforeRequest: [
      async ({ request, options }) => {
        const credentials = await auth.credentials.get();
        if (!credentials) return;
        options.context.credentials = credentials;
        request.headers.set(
          "Authorization",
          `Bearer ${credentials.accessToken}`,
        );
      },
    ],
    afterResponse: [
      async ({ request, options, response }) => {
        const used = options.context.credentials as Credentials | undefined;
        if (response.status !== 401 || !used) return;

        if (options.context.replayed) {
          // The new token was refused too: end the session.
          await auth.credentials.reject(used);
          return;
        }
        const fresh = await auth.credentials.renew(used);
        if (!fresh || request.method !== "GET") return;
        options.context.credentials = fresh;
        options.context.replayed = true;
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${fresh.accessToken}`);
        return ky.retry({ request: new Request(request, { headers }) });
      },
    ],
  },
});
```

Three things `createAuthFetch` does for you are yours to keep here:

- **Keep the token on one origin.** Give the client one base URL, and don't
  pass it absolute URLs to other hosts.
- **Don't read the token early.** Ask for credentials in the request hook,
  never once at startup: a token saved in a variable goes stale at the next
  refresh.
- **Check the account after slow work.** `auth.isCurrent(credentials)` tells
  whether the session that sent a request is still the signed-in one, before
  you show its answer.

### Users from the access token

If your backend puts the user in a JWT access token, read it from there with
`fromAccessToken`. `signIn` and the refresh callback then take tokens only,
and the user changes whenever the token does:

<!-- file: src/token-auth.ts -->

```ts
import {
  createAuth,
  fromAccessToken,
  webStorage,
} from "@monarcode/session-kit";
import { z } from "zod";

const claimsSchema = z.object({ sub: z.string(), email: z.string() });

export const tokenAuth = createAuth({
  name: "my-token-app",
  // The claims are validated, then mapped to the user the app sees.
  user: fromAccessToken(claimsSchema, (claims) => ({
    id: claims.sub,
    email: claims.email,
  })),
  storage: webStorage(),
});

export const signInWithTokens = (tokens: {
  accessToken: string;
  refreshToken: string;
}) => tokenAuth.signIn(tokens);
```

- **No `updateUser`.** The token is the only source of the user, so call
  `auth.refresh()` to pick up a change.
- **The signature isn't verified.** That suits a browser, which trusts a user
  object in a JSON response to the same degree. Pass `{ decode }` as the third
  argument to verify or decode the token yourself.
- **Leave out claims that change on every refresh**, such as `exp`, `iat`, or
  `jti`, so the user stays the same object across refreshes.
- **For backends you control.** OAuth providers may change their access token
  format without notice.

The [`tanstack-start-spa`](./examples/tanstack-start-spa) and
[`react-router-data`](./examples/react-router-data) examples read their user
this way.

### Locking

Locking is for native apps that ask a returning user to unlock, for example
with biometrics, before the app opens. With the `locking` option, a saved
session restores as `locked`: `user` and `sessionId` are set, so a
"Welcome back" screen can greet the user, but the tokens wait for
`auth.unlock()`.

<!-- file: src/locked-auth.ts -->

```ts
import { createAuth, type AuthStorage } from "@monarcode/session-kit";

import { userSchema } from "./backend.js";

// Your app's own: a native secure store, and encryption with a key it holds
// in memory only while unlocked.
declare const storage: AuthStorage;
declare const key: CryptoKey;
declare function encrypt(key: CryptoKey, plain: string): Promise<string>;
declare function decrypt(key: CryptoKey, sealed: string): Promise<string>;

export const lockedAuth = createAuth({
  name: "my-native-app",
  user: userSchema,
  storage,
  locking: {
    // Runs whenever the tokens are saved.
    seal: (payload) => encrypt(key, payload),
    // Runs only from `unlock()`.
    open: (sealed) => decrypt(key, sealed),
  },
});

/** Once the app has its key: resolves the session, now `authenticated`. */
export const unlockApp = () => lockedAuth.unlock();

/** `locked` again. The saved session stays, and the tokens leave memory. */
export const lockApp = () => lockedAuth.lock();
```

- **Sealing is yours.** session-kit depends on no crypto or biometrics
  library. The user and session ID are saved beside the sealed tokens,
  readable while locked. `locking: true` stores the tokens as they are, for a
  lock screen in front of an otherwise ordinary session.
- **While locked, nothing waits.** `getSession`, `retry`, `refresh`,
  `updateUser`, `credentials.get`, and `credentials.renew` reject with
  `LOCKED` instead of waiting for an unlock that may never come. Nothing refreshes, and timers are
  off. `signIn` replaces the session, which is the password path, and
  `signOut` clears it without calling `revoke`, since the tokens are sealed.
- **A failed unlock isn't always still locked.** When `open` throws,
  `unlock()` rejects with `UNLOCK_FAILED` and the session stays locked. But a
  refresh that fails after the tokens were opened rejects with
  `REFRESH_FAILED` and leaves the session unlocked and `unavailable` until
  `retry()`. Check `status` after a rejection.
- **Keep the key until `lock()` settles.** A refresh already running still
  saves its tokens, and saving seals them.
- **Native apps only.** Locking is built for one JavaScript context. In a
  browser, tabs don't follow each other with `locking`, and the router
  adapters treat a locked session as signed out. It also needs a user schema:
  a user read from the access token can't be shown without its token.
- **Turning it on and off.** A session saved before `locking` was added
  restores as `locked` too, and is sealed when unlocked. Turning
  `locking` off later makes sealed sessions unreadable, which signs those
  users out.

The [Expo guide](./docs/expo.md#locking) has a worked example: a key behind
the device's biometrics, AES-GCM sealing, and a welcome-back screen.

## Configuring the client

`createAuth` takes three required options and five optional ones:

| Option    | Required | What it sets                                                                                 |
| --------- | -------- | -------------------------------------------------------------------------------------------- |
| `name`    | Yes      | The storage namespace: letters, digits, `_` or `-`. Keeps two apps on one origin apart.      |
| `user`    | Yes      | A [user schema](#user-schemas), or [`fromAccessToken`](#users-from-the-access-token).        |
| `storage` | Yes      | [Where the session is saved](#storage).                                                      |
| `refresh` | No       | [How expired access is replaced](#refresh). Without it, an expired token signs the user out. |
| `revoke`  | No       | [Revokes the ended tokens](#signing-in-and-out) on your backend after a sign-out.            |
| `maxAge`  | No       | How long a saved session is restored, in seconds. Default: 30 days, renewed on each save.    |
| `debug`   | No       | [Reports what the client does](#debugging). Default: off.                                    |
| `locking` | No       | [Restores a saved session as `locked`](#locking), for native apps. Default: off.             |

### User schemas

The schema checks every user the client accepts: at sign-in, after a refresh
that returns one, when a saved session is restored, and when another tab saves
one. Accepted users are copied and frozen.

Two rules follow from restoring. The schema's output must be a plain JSON
object, because it is saved beside the tokens. And the schema must accept its
own output and return it unchanged, because that saved user is validated again
on the next reload. Sign-in rejects a schema that doesn't, such as one with a
one-way transform, instead of signing users out when they reload.

A saved user the schema rejects, after a deploy that changed the schema for
example, isn't restored: the user signs in again. The same goes for a user
another tab saved, which signs every tab out with `USER_VALIDATION_FAILED`.

### Refresh

The `refresh` callback has three outcomes, and the difference between the last
two is what keeps an outage from signing anyone out:

| The refresh callback… | Meaning                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| Returns tokens        | Install them. An omitted refresh token or user keeps the current one.                 |
| Returns `null`        | The backend rejected the refresh token: sign out and clear storage.                   |
| Throws                | Operational failure: keep the session, report `REFRESH_FAILED`, and wait for a retry. |

To treat every refresh failure as a sign-out, return `null` instead of
throwing.

A refresh runs at one of three moments:

- **Early.** While the client is mounted, 60 seconds before expiry, or
  halfway through for a token with under two minutes left, once per token. If
  it fails, access stays usable until expiry.
- **At expiry, or after a 401.** `status` is `refreshing` while it runs, with
  the user still on screen.
- **On request.** `auth.refresh()` runs one now.

If a refresh that was needed fails, access becomes `unavailable`, and
`getSession()` rethrows the failure until `auth.retry()`, a sign-in, or a
sign-out. Guards that run again therefore can't start a refresh loop.
Validation and refresh each have a 15-second deadline. The callback's
`signal` aborts when it passes, or when the session changes.

### Expiry

The client needs to know when the access token expires. It reads that from
`expiresIn` (seconds, as in OAuth), `expiresAt` (Unix milliseconds), or a
JWT's `exp` and `iat` claims. Prefer `expiresIn` when your backend sends it:
it is counted from receipt, so a wrong device clock can't expire the token
early or late. Pass one or the other, not both; the `Tokens` type documents
how each is read.

### Storage

The `storage` option chooses where the session is saved:

| Storage                           | Saved in                                  | Use it for                                           |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `webStorage()`                    | `localStorage`                            | Browsers. One session, shared by every tab.          |
| `webStorage({ area: "session" })` | `sessionStorage`                          | One session per tab, ending with the tab.            |
| `secureStorage()`                 | The iOS keychain, or the Android Keystore | Expo apps. From `@monarcode/session-kit/expo`.       |
| `memoryStorage()`                 | Memory                                    | Tests, and sessions that shouldn't outlive the page. |
| Your own `AuthStorage`            | Anywhere                                  | Another store. Its operations may return promises.   |

- **Prefer `localStorage` with rotating refresh tokens.** Browsers copy
  `sessionStorage` into a duplicated tab and into windows opened with
  `window.open`, so both start with the same refresh token but never see each
  other's saves. Whichever refreshes second sends a spent token and is signed
  out, or, with reuse detection, both are.
- **`secureStorage()`** splits sessions over SecureStore's 2048-byte limit
  across keys and reads synchronously; see the
  [Expo guide](./docs/expo.md#secure-storage).
- **Custom storage** is applied one operation at a time, in the order the
  client issued them.

Tokens and the user share one `<name>:auth:session` entry, so every save is a
single write that other tabs see whole. A user read from the access token is
not saved. Sessions saved by earlier alphas are not restored, so users sign in
once after upgrading.

### Tabs

While the client is mounted, tabs follow each other through `storage` events:
a sign-out signs out every tab, a sign-in or account switch switches them, and
profile updates and refreshes appear everywhere.

Refresh runs under the `<name>:auth:refresh` Web Lock, so one tab at a time
spends the refresh token and the others reuse what it saved. Rotating refresh
tokens therefore work with several tabs open. Without Web Locks, two tabs
refreshing at the same instant can both spend the token; a short reuse window
on the backend covers that.

An Expo app has one JavaScript context, so it has no tabs to follow and needs
no lock. With [`locking`](#locking), tabs don't follow each other.

### Errors

Every error from session-kit's own logic is an `AuthError`, whether thrown,
rejected with, or published in `state.error`. Match on its `code`, not its
message:

| Code                     | Meaning                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`        | The operation needs a signed-in session, and there is none.                           |
| `REFRESH_FAILED`         | The refresh callback threw, or there was no callback or refresh token to use.         |
| `SESSION_CHANGED`        | A newer sign-in, a sign-out, or another tab replaced the session while this ran.      |
| `USER_VALIDATION_FAILED` | The schema rejected the user; `issues` holds its issues.                              |
| `INVALID_SESSION`        | Tokens or a saved session that can't be used, such as an expired token at sign-in.    |
| `PERSISTENCE_FAILED`     | Storage could not be read, written, or cleared.                                       |
| `REVOKE_FAILED`          | The `revoke` callback failed. Published in `state.error`; `signOut()` still resolves. |
| `LOCKED`                 | The session is locked: `unlock()` it first.                                           |
| `UNLOCK_FAILED`          | `locking.open` failed, so the session stays locked.                                   |
| `INVALID_OPTIONS`        | Misuse: an option or argument session-kit can't use.                                  |

`cause` holds whatever failed underneath, such as the error your refresh
callback threw. A map from codes to your own wording keeps messages out of
components:

<!-- file: src/error-message.ts -->

```ts
import { AuthError, type AuthErrorCode } from "@monarcode/session-kit";

const messages: Partial<Record<AuthErrorCode, string>> = {
  REFRESH_FAILED: "We can't reach the server. Check your connection.",
  PERSISTENCE_FAILED: "Your browser wouldn't save the session.",
  USER_VALIDATION_FAILED: "Your account couldn't be loaded.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof AuthError) return messages[error.code] ?? error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}
```

Two storage failures need a decision from you:

- **Storage can't be written.** The session ends and the error is published,
  rather than leaving a session that would vanish on reload.
- **Storage can't be cleared.** Sign-out still takes effect in this tab, but
  the promise rejects and the error stays in `state.error`. Call `signOut()`
  again once storage is available, because undeleted credentials could
  survive a reload.

`authFetch` lets `fetch`'s and `Request`'s own failures, such as a network
error, through unchanged.

### Debugging

The `debug` option reports what the client does: restores, refreshes and why
they ran, timers, storage operations and how long they took, other tabs'
changes, state changes, and what ended a session. `debug: true` logs each
event as one `console.info` line:

```text
[session-kit:my-app] refresh: started (proactive) { sessionId: "…", reason: "proactive" }
```

A function receives each event instead, for example to leave breadcrumbs in
your error reporting:

<!-- file: src/debug.ts -->

```ts
import type { AuthDebug } from "@monarcode/session-kit";

declare function addBreadcrumb(crumb: {
  category: string;
  message: string;
  data: object;
}): void;

/** Pass as `createAuth`'s `debug` option. */
export const debug: AuthDebug = (event) =>
  addBreadcrumb({
    category: `auth.${event.type}`,
    message: event.message,
    data: { ...event.data, code: event.error?.code },
  });
```

- **No secrets by default.** Events leave out tokens, saved values, and user
  fields. A session appears as its `sessionId`, and an error as its code and
  message, without the cause.
- **`{ sensitive: true }` puts them in.** Anyone who reads such logs can act
  as the user, so keep it to development builds. `{ log, sensitive }` sets
  both.
- **`type` is stable, the rest isn't.** `type` is one of a fixed set, such as
  `"refresh"` or `"storage"`. The wording of `message` and the fields in
  `data` may change in any release.

A storage adapter can add its own events through the optional `debug` member
of `AuthStorage`, as `secureStorage()` does.

## Common questions

**Do I need a refresh token?** No. Without one, or without a `refresh`
callback, the session simply ends when the access token expires or is
rejected.

**My backend doesn't say when the token expires.** If the access token is a
JWT, its `exp` claim is used. Otherwise the token is used until a request
gets a 401, and `authFetch` refreshes then. See [Expiry](#expiry).

**Is it safe to keep tokens in `localStorage`?** They are readable by any
script on your origin, as with every credential a browser stores for
JavaScript. If that isn't acceptable, keep the session on the server:
[Server rendering](#server-rendering) puts it in an encrypted `httpOnly`
cookie. [Security notes](#security-notes) has the rest.

**How do I use it with TanStack Query, or another cache?** Put
`state.sessionId` in the query key, or clear the cache when it changes, so
one account never reads another's data. With effetch-query,
[`resetKey`](./docs/effect.md#caching-with-effetch-query) does it.

**Why does TanStack Start in SPA mode flash my pending component?** That is
the HTML shell the build prerenders, shown before any JavaScript runs. The
session is restored as soon as the script loads; plain TanStack Router shows
a blank page for the same moment. Give the shell a neutral pending component.

**Some of my endpoints answer 401 for other reasons.** Pass
`{ signOutOnRepeated401: false }` to `createAuthFetch`, so they can't sign
users out. See [Authenticated requests](#authenticated-requests).

**How much does it add to my bundle?** About 11 kB gzipped for a single-page
app with a router adapter and `createAuthFetch`, and about 5 kB with server
rendering, where the session work happens on the server. Each adapter is its
own entry point and the package is tree-shakeable, so the routers you don't
use add nothing.

**Can I sign users in with Google, or a magic link?** Yes, through your
backend: whatever it does to sign a user in, session-kit starts from the
tokens it answers with. See [What it doesn't do](#what-it-doesnt-do).

## Security notes

- **Your backend is the authority.** It must authenticate every request and
  authorize private operations. Route guards, screen guards, and local user
  fields decide what to show, not what is allowed.
- **In browsers, tokens are readable by same-origin JavaScript**, as with any
  browser-stored credential. They never go in cookies, so browsers don't send
  them automatically.
- **With [server rendering](#server-rendering)**, tokens sit in an encrypted
  `httpOnly` cookie that page scripts can't read. Only the access token
  reaches page scripts, and only with `clientCredentials`.
- **In Expo apps**, `secureStorage()` keeps tokens in the iOS keychain or
  encrypted with an Android Keystore key, out of Android backups with the
  `expo-secure-store` config plugin, and removes a session an earlier install
  left in the iOS keychain.
- **Sessions, route context, and loader results hold no tokens.** Never put
  tokens in loader results or hydrated page data yourself.

## Entry points

| Import                                         | Exports                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@monarcode/session-kit`                       | `createAuth`, `createMirrorAuth`, `fromAccessToken`, `webStorage`, `memoryStorage`, `safeReturnTo`, `AuthError`, types |
| `@monarcode/session-kit/react`                 | `createAuthHooks`, `useMirrorAuth`, hook types                                                                         |
| `@monarcode/session-kit/tanstack-router`       | `connectAuth`, `requireSession`, `redirectIfSignedIn`, `SessionOutlet`, `useRouterAuth`, `RegisteredAuth`              |
| `@monarcode/session-kit/react-router`          | `SessionOutlet`, `requireSession`, `redirectIfSignedIn`, `useAuthRevalidation`                                         |
| `@monarcode/session-kit/react-router/server`   | `cookieJarMiddleware`, `routerJar`, types                                                                              |
| `@monarcode/session-kit/expo`                  | `secureStorage`, `SessionGate`, `rememberDeepLink`, types                                                              |
| `@monarcode/session-kit/server`                | `createServerAuth`, types                                                                                              |
| `@monarcode/session-kit/tanstack-start`        | `sessionHydration`, `loadSession`, types                                                                               |
| `@monarcode/session-kit/tanstack-start/server` | `startJar`                                                                                                             |
| `@monarcode/session-kit/next`                  | `nextJar`, `proxyJar`, types                                                                                           |
| `@monarcode/session-kit/http`                  | `createAuthFetch`, types                                                                                               |
| `@monarcode/session-kit/effect`                | `Auth`, `AuthFailure`, `Register`, types                                                                               |
| `@monarcode/session-kit/effetch`               | `sessionBearer`, types                                                                                                 |

Each row is its own entry point, and the package is tree-shakeable, so a
bundle holds only what you import. Do not import internal `dist` paths.

## Compatibility

All peer dependencies are optional, so install only what you use:

| Peer                     | Range                   | Needed for                                             |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| `react`                  | `^18.0.0 \|\| ^19.0.0`  | `/react`, `/tanstack-router`, `/react-router`, `/expo` |
| `@tanstack/react-router` | `^1.132.0`              | `/tanstack-router`                                     |
| `@tanstack/react-start`  | `^1.169.0`              | `/tanstack-start/server`                               |
| `react-router`           | `^7.0.0 \|\| ^8.0.0`    | `/react-router`                                        |
| `next`                   | `^16.0.0`               | `/next`                                                |
| `effect`                 | `^4.1.0`                | `/effect`                                              |
| `@monarcode/effetch`     | `^0.1.0-rc.2`           | `/effetch`                                             |
| `expo-router`            | `^5.0.2` through `^58`  | `/expo`                                                |
| `expo-secure-store`      | `^14.2.0` through `^58` | `/expo`                                                |
| `expo-file-system`       | `^18.1.0` through `^58` | `/expo`                                                |
| `react-native`           | `>=0.79.0`              | `/expo`                                                |

The Expo ranges cover Expo SDK 53 and newer; install them with
`npx expo install` so they match your SDK, as the
[Expo guide](./docs/expo.md#installation) shows. CI tests the oldest and newest
versions in each range, except that `expo-file-system` is tested only at its
newest: 18.1 publishes no `exports` map, so its types don't resolve under
NodeNext. session-kit never imports React DOM.

The package is ESM-only and checked with TypeScript 6.0.3 under NodeNext and
Bundler resolution. It needs `AbortController`, and uses `crypto.randomUUID` and
Web Locks when present, falling back without them. On the server,
`@monarcode/session-kit/server` needs Web Crypto, as in Node.js 20 and newer.

## Development

Use Node.js 24 or newer and pnpm. The repository is a pnpm workspace: the
package at the root, and the example apps in `examples/`.

```sh
pnpm install
pnpm run check
```

`check` runs Oxlint and Oxfmt, builds the package, runs the tests, and
type-checks the tests, the consumer declarations, and every TypeScript example
marked with a `file:` comment, each document as one small app. This README
and the [TanStack Router](./docs/tanstack-router.md),
[React Router](./docs/react-router.md), and [Effect](./docs/effect.md) guides
compile under NodeNext and Bundler resolution, the server-rendering guides
under Bundler resolution, and the [Expo guide](./docs/expo.md) under Bundler
resolution, as Metro resolves, without DOM types. An example marked with a
`from:` comment is an excerpt of a guide, and must match it. `pnpm test` runs the runtime tests
twice: with synchronous storage, and with storage that settles every operation
late, removals last, to catch ordering bugs. `pnpm run build:examples` builds
the package and every example app.

Tests are TypeScript files that Node runs directly. Behavior tests are split by
area and share the browser mocks in `tests/helpers.ts`; React tests mount real
React DOM, TanStack Router, and React Router in jsdom, and server tests run
TanStack Start's and React Router's real request handling and use Next.js's
own request, response and cookie classes. Expo tests replace
`expo-secure-store`, `expo-file-system`, `expo-router`, and `react-native` with
the mocks in `tests/mocks/`. CI also runs the tests and type tests against the
oldest supported peers, and builds the examples. Before each commit, Husky runs
the lint and format checks. The manual alpha release workflow is documented in
[RELEASING.md](./RELEASING.md).

### Try a local build

Run `pnpm pack`, then install the tarball in your app, replacing `<version>`
with the version in `package.json`:

```sh
pnpm add /absolute/path/to/monarcode-session-kit-<version>.tgz
```

## License

[MIT](./LICENSE)
