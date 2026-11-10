# session-kit examples

Nine small apps, one per supported setup, all signing in against
[DummyJSON's auth API](https://dummyjson.com/docs/auth). The eight web apps
share the same pages: `/login`, prefilled with DummyJSON's test user, and a
protected `/` that shows the user, calls `auth/me` with the access token, and
signs out. The Expo app has the same sign-in screen, and splits the protected
part into a home screen and a `/profile` screen that calls `auth/me`, so a
deep link has somewhere to go.

| App                                                          | Setup                                             | User comes from |
| ------------------------------------------------------------ | ------------------------------------------------- | --------------- |
| [`tanstack-router`](./tanstack-router)                       | TanStack Router, file-based routes                | Login response  |
| [`tanstack-start-spa`](./tanstack-start-spa)                 | TanStack Start in SPA mode                        | Access token    |
| [`tanstack-start-ssr`](./tanstack-start-ssr)                 | TanStack Start with server rendering              | Login response  |
| [`react-router-declarative`](./react-router-declarative)     | React Router, `<BrowserRouter>`                   | Login response  |
| [`react-router-data`](./react-router-data)                   | React Router, `createBrowserRouter`               | Access token    |
| [`react-router-framework-spa`](./react-router-framework-spa) | React Router framework mode with `ssr: false`     | Login response  |
| [`react-router-framework-ssr`](./react-router-framework-ssr) | React Router framework mode with server rendering | Login response  |
| [`next-app`](./next-app)                                     | Next.js App Router with Proxy                     | Login response  |
| [`expo-router`](./expo-router)                               | Expo Router on iOS and Android (Expo SDK 58)      | Login response  |

## Run one

From the repository root, build the package once, then start an app:

```sh
pnpm install
pnpm run build
pnpm --dir examples/tanstack-router run dev
```

The apps use the package from this repository, so rebuild it after changing
`src`. `pnpm run build:examples` builds the package and every app, which is
what CI checks.

The Expo app runs in Expo Go or a development build:

```sh
pnpm --dir examples/expo-router run start
```

Open a deep link with `sessionkit://profile` in a development build, or
`exp://<host>:8081/--/profile` in Expo Go. `pnpm --dir examples/expo-router
run ios` and `run android` build it natively. In CI it is only bundled, with
`expo export --platform ios --platform android`.

## What each app shows

- **`auth.ts`**: the DummyJSON client. Its refresh callback maps both 401 and
  403 to `null`, because DummyJSON answers 403 for an invalid refresh token.
  Tokens last one minute, so the early refresh runs after about 30 seconds.
  Requests omit `credentials: "include"`, which DummyJSON's own snippets use,
  because session-kit keeps tokens out of cookies.
- **Guards**: `requireSession` and `SessionOutlet` for TanStack Router and
  Start, `SessionOutlet` alone in React Router's declarative mode, and loader
  guards with `useAuthRevalidation` in data and framework mode.
- **TanStack Start** sets `defaultSsr: false` in `src/start.ts`. Start's own
  server still renders requests in SPA mode, and the guards need the browser's
  saved session.
- **TanStack Start with server rendering** keeps the session in an encrypted
  `httpOnly` cookie with `createServerAuth` (`src/auth/server.ts`), signs in
  with DummyJSON from a server function, and refreshes in request middleware
  (`src/start.ts`). `createMirrorAuth` gives the routes and components a
  client, filled by `loadSession` on the server and `sessionHydration` in the
  browser. `auth/me` is called both from a server function and, with
  `clientCredentials`, from the browser. Set `SESSION_SECRET` (32 or more
  random characters) to run `vite preview`; `vite dev` uses a development
  secret. The cookie is `Secure` outside `vite dev`, which Safari refuses
  over `http://localhost`: try `vite preview` in another browser. See
  [the guide](../docs/tanstack-start.md).
- **Next.js** keeps the session the same way: Proxy refreshes it
  (`proxy.ts`), Server Components read it through `lib/auth/session.ts`, and
  Server Functions in `app/actions.ts` sign in and out. `useMirrorAuth` in
  `app/providers.tsx` gives Client Components the client and renders the
  page again when the session changes in the browser, so the pages'
  redirects run. The browser gets the access token from a Route Handler.
  `SESSION_SECRET` and Safari work as for TanStack Start, with `next start`
  and `next dev`. See [the guide](../docs/next.md).
- **React Router with server rendering** keeps the session the same way.
  Root middleware (`app/auth/middleware.server.ts`) gives each request a
  cookie jar and refreshes, the root loader reads the session, and the sign-in
  route's action signs in with a plain form that works before scripts load.
  `useMirrorAuth` in `app/root.tsx` gives the components the client and runs
  the loaders again when the session changes in the browser, so the
  protected route's middleware redirects. The browser signs out, revalidates
  and gets the access token through the resource routes in
  `app/routes/auth.*.ts`. `SESSION_SECRET` and Safari work as for TanStack
  Start, with `pnpm start` (after `pnpm build`) and `react-router dev`. See
  [the guide](../docs/react-router-ssr.md).
- **Expo Router** saves the session with `secureStorage()`. `SessionGate` in
  `app/_layout.tsx` holds the splash screen, shows `src/unavailable.tsx`
  after a failed refresh, and re-checks the session when the app returns to
  the foreground. `Stack.Protected` guards the screens, and
  `app/+native-intent.tsx` keeps a deep link for after the sign-in. The
  `expo-secure-store` config plugin keeps the session out of Android backups.

Each app is self-contained, so it can be copied out on its own. That is why
the client-side web apps have the same `ui.tsx` rather than sharing one; the
server-rendered apps have their own, since they sign in on the server. The apps
differ in where the user comes from on purpose, so both user sources appear:
the login response, validated by a schema, or the access token's claims, read
with `fromAccessToken`. DummyJSON supports both.

DummyJSON has no logout endpoint, so the apps do not pass `revoke`. Its refresh
tokens stay valid after rotation, so it cannot show the cross-tab rotation race
that session-kit's tests cover. CI never calls DummyJSON: builds don't run the apps,
and the build job blocks the host to make sure.
