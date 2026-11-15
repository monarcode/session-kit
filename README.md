![Session kit: schema-driven, type-safe sessions for React apps](https://raw.githubusercontent.com/monarcode/session-kit/main/assets/sk-banner.png)

[![npm](https://img.shields.io/npm/v/@monarcode/session-kit)](https://www.npmjs.com/package/@monarcode/session-kit)
[![CI](https://github.com/monarcode/session-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/monarcode/session-kit/actions/workflows/ci.yml)
[![bundle size](https://deno.bundlejs.com/badge?q=@monarcode/session-kit)](https://bundlejs.com/?q=@monarcode/session-kit)
[![tree-shakeable](https://img.shields.io/badge/tree--shakeable-yes-brightgreen)](https://bundlejs.com/?q=@monarcode/session-kit&treeshake=%5B%7BcreateAuth%2CwebStorage%7D%5D)
[![provenance](https://img.shields.io/badge/provenance-verified-brightgreen?logo=npm)](https://www.npmjs.com/package/@monarcode/session-kit#provenance)
[![license](https://img.shields.io/npm/l/@monarcode/session-kit)](./LICENSE)

[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](https://session-kit.pages.dev/docs/getting-started)
[![TanStack Router](https://img.shields.io/badge/TanStack%20Router-20232a?logo=tanstack&logoColor=white)](https://session-kit.pages.dev/docs/setups/tanstack-router)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-20232a?logo=tanstack&logoColor=white)](https://session-kit.pages.dev/docs/setups/tanstack-start)
[![React Router](https://img.shields.io/badge/React%20Router-20232a?logo=reactrouter&logoColor=ca4245)](https://session-kit.pages.dev/docs/setups/react-router)
[![Next.js](https://img.shields.io/badge/Next.js-20232a?logo=nextdotjs&logoColor=white)](https://session-kit.pages.dev/docs/setups/next)
[![Expo](https://img.shields.io/badge/Expo-20232a?logo=expo&logoColor=white)](https://session-kit.pages.dev/docs/setups/expo)
[![Effect](https://img.shields.io/badge/Effect-20232a?logo=effect&logoColor=white)](https://session-kit.pages.dev/docs/effect)

**Every sign-in ends in a session. Make yours type-safe and predictable.**

Session kit is the session layer for React apps that have their own backend.
Give it the tokens your sign-in endpoint returns, and it saves the session,
restores it on reload, refreshes tokens before they expire, keeps every tab in
sync, and guards your routes. It never signs users in: your backend does, and
Session kit takes over from its response.

It works with TanStack Router, React Router, and Expo Router, renders on the
server with TanStack Start, Next.js, and React Router, and comes with an
[Effect](https://effect.website) service and an
[effetch](https://github.com/monarcode/effetch) plugin.

> **Release candidate.** The API is frozen for 0.1, and later 0.1 releases
> only add to it. See the [release notes](./CHANGELOG.md).

**Documentation: [session-kit.pages.dev](https://session-kit.pages.dev)**

## Installation

```sh
npm install @monarcode/session-kit zod
```

Any [Standard Schema](https://standardschema.dev) library describes users.
The examples use Zod. Peer dependencies such as React and your router are
optional: install the ones your setup uses.
[Compatibility](https://session-kit.pages.dev/docs/reference/compatibility)
lists the supported versions.

Release candidates are published to the `latest` tag, so pin an exact version
and read the [release notes](./CHANGELOG.md) before upgrading.

## Quick start

Your backend keeps its sign-in and refresh endpoints. Session kit takes the
tokens they return and manages the session from there. A React app needs
three files.

**1. Create the client.** It checks every user against your schema, saves the
session, and calls your `refresh` before the access token expires:

<!-- file: src/auth.ts -->

```ts
import { createAuth, webStorage } from "@monarcode/session-kit";
import { z } from "zod";

export const auth = createAuth({
  // Keeps this app's saved session apart from others on the same origin.
  name: "my-app",
  // Every user is checked against this schema, and typed by it.
  user: z.object({ id: z.string(), name: z.string() }),
  // Saves the session in localStorage, so it survives reloads.
  storage: webStorage(),
  refresh: async ({ refreshToken, signal }) => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal,
    });
    if (response.status === 401) return null; // rejected: sign out
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return response.json();
  },
});

// Types the React hooks with this client's user.
declare module "@monarcode/session-kit" {
  interface Register {
    auth: typeof auth;
  }
}
```

**2. Sign in.** Pass `signIn` what your backend's sign-in returned, the tokens
and the user:

<!-- file: src/sign-in.ts -->

```ts
import { auth } from "./auth.js";

export async function signIn(email: string, password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  // { accessToken, refreshToken, expiresIn, user }
  const tokens = await response.json();
  await auth.signIn(tokens);
}
```

**3. Render by the session's status.** `useAuth` re-renders when it changes,
in this tab or another:

<!-- file: src/app.tsx -->

```tsx
import {
  AuthProvider,
  useAuth,
  useAuthClient,
} from "@monarcode/session-kit/react";

import { auth } from "./auth.js";
import { SignInForm } from "./sign-in-form.js"; // your form, calling signIn

export function App() {
  return (
    <AuthProvider client={auth}>
      <Home />
    </AuthProvider>
  );
}

function Home() {
  const session = useAuth();
  const client = useAuthClient();

  if (session.status === "initializing") return <p>Restoring your session…</p>;
  if (session.status === "unauthenticated") return <SignInForm />;
  if (session.status === "unavailable") {
    // The session couldn't be restored or refreshed, say while offline.
    return (
      <button onClick={() => client.retry().catch(console.error)}>
        Try again
      </button>
    );
  }
  return (
    <main>
      <h1>Welcome, {session.user.name}</h1>
      <button onClick={() => client.signOut().catch(console.error)}>
        Sign out
      </button>
    </main>
  );
}
```

To call your API, `createAuthFetch` from `@monarcode/session-kit/http` adds
the access token to each request and refreshes it after a 401.
[Getting started](https://session-kit.pages.dev/docs/getting-started) builds
this app step by step against a real test backend, and the guides below add
your router's guards or server rendering.

## Pick your setup

Each setup has a guide:

| Setup                                                          | Guide                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| React without a router                                         | [Getting started](https://session-kit.pages.dev/docs/getting-started)               |
| TanStack Router, and TanStack Start as a single-page app (SPA) | [TanStack Router](https://session-kit.pages.dev/docs/setups/tanstack-router)        |
| TanStack Start with server rendering                           | [TanStack Start](https://session-kit.pages.dev/docs/setups/tanstack-start)          |
| React Router: declarative, data, framework SPA                 | [React Router](https://session-kit.pages.dev/docs/setups/react-router)              |
| React Router, framework mode with server rendering             | [React Router with SSR](https://session-kit.pages.dev/docs/setups/react-router-ssr) |
| Next.js 16, App Router                                         | [Next.js](https://session-kit.pages.dev/docs/setups/next)                           |
| Expo Router on iOS and Android, SDK 53+                        | [Expo Router](https://session-kit.pages.dev/docs/setups/expo)                       |
| Effect and effetch, with any setup                             | [Effect and effetch](https://session-kit.pages.dev/docs/effect)                     |

All but the first have a runnable app in [`examples/`](./examples).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
