# TanStack Router

With TanStack Router, the auth client lives in Router context. Guards run in
`beforeLoad`, before a private route loads or renders, and the hooks read the
client from the Router, so they need no `AuthProvider`.

This guide continues from the
[README's Getting started](../README.md#getting-started): it uses the client
in `src/auth.ts` and the form in `src/sign-in.tsx` from there. A complete app
is in [`examples/tanstack-router`](../examples/tanstack-router).
[TanStack Start in SPA mode](#tanstack-start-in-spa-mode) differs in two
places. For TanStack Start with server rendering, follow
[its own guide](./tanstack-start.md).

## Contents

- [Installation](#installation)
- [1. Create the hooks](#1-create-the-hooks)
- [2. Type the root route](#2-type-the-root-route)
- [3. Add the sign-in route](#3-add-the-sign-in-route)
- [4. Guard private routes](#4-guard-private-routes)
- [5. Create and connect the Router](#5-create-and-connect-the-router)
- [6. Render the app](#6-render-the-app)
- [Layouts around guarded pages](#layouts-around-guarded-pages)
- [TanStack Start in SPA mode](#tanstack-start-in-spa-mode)
- [Things to know](#things-to-know)

## Installation

```sh
pnpm add @monarcode/session-kit @tanstack/react-router zod
pnpm add -D @tanstack/router-plugin
```

The guide uses file-based routing, so add the Router plugin before the React
plugin:

```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
});
```

The plugin generates `src/routeTree.gen.ts` from the files under `src/routes`.

## 1. Create the hooks

`src/hooks.ts`

<!-- file: src/hooks.ts -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";
import { useRouterAuth } from "@monarcode/session-kit/tanstack-router";

// Reads the client from Router context, so no provider is needed.
export const { useAuth, useAuthClient } = createAuthHooks({
  useClient: useRouterAuth,
});
```

If you followed Getting started, this replaces its `src/hooks.ts`, and routes
take the place of its `src/app.tsx`. Router registration in step 5 gives the
hooks your user type.

## 2. Type the root route

The root route declares that Router context holds the client, which is what
gives every guard below a typed `context.auth`.

`src/routes/__root.tsx`

<!-- file: src/routes/__root.tsx -->

```tsx
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { AppAuth } from "../auth.js";
import { useAuth } from "../hooks.js";

export const Route = createRootRouteWithContext<{ auth: AppAuth }>()({
  component: Root,
});

function Root() {
  // Shows failures that outlive the page that caused them, such as a sign-out
  // that could not clear storage.
  const error = useAuth((state) => state.error);
  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      <Outlet />
    </>
  );
}
```

## 3. Add the sign-in route

`src/routes/login.tsx`

<!-- file: src/routes/login.tsx -->

```tsx
import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { SignIn } from "../sign-in.js";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirectTo: safeReturnTo(search.redirectTo),
  }),
  beforeLoad: ({ context, search }) =>
    redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
  component: Login,
});

function Login() {
  const router = useRouter();
  const { redirectTo } = Route.useSearch();
  return (
    <SignIn
      onSignedIn={() => router.navigate({ href: redirectTo, replace: true })}
    />
  );
}
```

`safeReturnTo` accepts only same-origin paths and returns `/` for anything
else, including the sign-in page itself, so a stale `redirectTo` cannot loop.
Pass `{ loginPath }` if sign-in lives somewhere other than `/login`.
`redirectIfSignedIn` sends signed-in users on to `redirectTo`, checked the
same way.

## 4. Guard private routes

`src/routes/_authenticated.tsx` is a pathless layout: its child routes are
guarded without `authenticated` appearing in their URLs.

<!-- file: src/routes/_authenticated.tsx -->

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

`requireSession` redirects signed-out users to `loginPath` with `redirectTo`
set to where they were going, and puts `{ session }` in route context. A
failed refresh reaches the error component instead of a redirect, because the
user is still signed in.

`SessionOutlet` renders child routes while the session the guard accepted is
still the signed-in one. After a sign-out or an account switch it shows
`pending` until the guard runs again, and remounts child routes for the new
account, so nothing from the previous one stays on screen. Profile updates and
token refreshes keep child routes mounted.

Child routes read the session from route context, where `user` is typed and
never `null`:

`src/routes/_authenticated/index.tsx`

<!-- file: src/routes/_authenticated/index.tsx -->

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { useAuthClient } from "../../hooks.js";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

function Home() {
  const { session } = Route.useRouteContext();
  const auth = useAuthClient();
  return (
    <main>
      <h1>Welcome, {session.user.firstName}</h1>
      <button onClick={() => void auth.signOut().catch(() => {})}>
        Sign out
      </button>
    </main>
  );
}
```

## 5. Create and connect the Router

`src/router.tsx`

<!-- file: src/router.tsx -->

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

`connectAuth` does for the Router what `AuthProvider` does for a plain React
app, and one thing more: when the session changes, it runs the guards again,
so a sign-out in another tab redirects this one.

## 6. Render the app

`src/main.tsx`

<!-- file: src/main.tsx -->

```tsx
import { StrictMode } from "react";

import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import { router } from "./router.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

## Layouts around guarded pages

A guarded route often has UI of its own around its pages, such as a sidebar
and a top bar. Render it in the route's component, with `SessionOutlet` where
the pages go:

`src/dashboard.tsx`

<!-- file: src/dashboard.tsx -->

```tsx
import { useState } from "react";

import { SessionOutlet } from "@monarcode/session-kit/tanstack-router";

import { useAuth } from "./hooks.js";

/** The guarded route's component: `component: Dashboard`. */
export function Dashboard() {
  // From state, not route context: this stays mounted through a sign-out.
  const user = useAuth((state) => state.user);
  const sessionId = useAuth((state) => state.sessionId);
  return (
    <div className="dashboard">
      <header>{user ? `Signed in as ${user.firstName}` : null}</header>
      {/* Keyed by session, so one account's choices never show for the next. */}
      <Sidebar key={sessionId} />
      <main>
        <SessionOutlet pending={<p>Checking session…</p>} />
      </main>
    </div>
  );
}

function Sidebar() {
  const [pinned, setPinned] = useState(false);
  return (
    <nav>
      <button onClick={() => setPinned(!pinned)}>
        {pinned ? "Unpin" : "Pin"}
      </button>
    </nav>
  );
}
```

`SessionOutlet` finds the session its guard accepted from the nearest route,
which is still the guarded one anywhere in that route's component. Three
things follow from where it sits:

- **It protects only what it renders.** After a sign-out or an account switch,
  the pages are swapped for `pending` and remounted, but the layout around
  them stays mounted until the guard redirects.
- **Read the user from state there.** In the layout, use
  `useAuth((state) => state.user)` and handle `null`. Route context's
  `session.user` is the session the guard accepted, which for that moment is
  the previous one. Inside the pages, route context's session is always the
  signed-in one.
- **Key what belongs to an account.** Layout UI that holds state for one
  account, such as a draft or an open panel, takes the session as its `key`,
  so the next account starts fresh.

## TanStack Start in SPA mode

TanStack Start's SPA mode is TanStack Router with a build-time shell, so every
step above applies, with two changes.

Create the Router, and connect auth, inside `getRouter()`:

```tsx
export function getRouter() {
  const router = createRouter({
    routeTree,
    context: { auth },
    defaultPendingComponent: () => <p>Loading…</p>,
  });
  // Does nothing while the build prerenders the shell.
  connectAuth(router);
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

And turn server rendering off for routes, in `src/start.ts`:

<!-- file: src/start.ts -->

```ts
import { createStart } from "@tanstack/react-start";

// The session is in browser storage, so guards must run in the browser.
export const startInstance = createStart(() => ({
  defaultSsr: false,
}));
```

Start's own server still answers requests in SPA mode, and it has no saved
session to check. `connectAuth` does nothing while the Router renders on a
server, so the build-time shell shows your pending component. Complete apps
are in [`examples/tanstack-start-spa`](../examples/tanstack-start-spa) and,
written with Effect and effetch, in
[`examples/tanstack-start-spa-effetch`](../examples/tanstack-start-spa-effetch).

## Things to know

- **The first render.** With synchronous storage and a synchronous schema,
  `connectAuth` restores the saved session before the first render, so a
  signed-in user never sees the sign-in page.
- **Stopping.** Call `disconnectAuth` on app teardown or hot-module disposal.
  It stops background work without signing out.
- **A failed refresh is not a redirect.** `requireSession` rethrows it for the
  route's error component, which can offer `auth.retry()`. The user is still
  signed in.
- **Locked sessions.** [Locking](../README.md#locking) is for native apps, so
  the guards treat a locked session as signed out.
- **Cached data.** `state.sessionId` is new on every sign-in. Scope private
  cached data, such as TanStack Query results, to it.
