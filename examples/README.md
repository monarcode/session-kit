# session-kit examples

Five small apps, one per supported setup, all signing in against
[DummyJSON's auth API](https://dummyjson.com/docs/auth). They share the same
pages: `/login`, prefilled with DummyJSON's test user, and a protected `/`
that shows the user, calls `auth/me` with the access token, and signs out.

| App                                                          | Setup                                         | User comes from |
| ------------------------------------------------------------ | --------------------------------------------- | --------------- |
| [`tanstack-router`](./tanstack-router)                       | TanStack Router, file-based routes            | Login response  |
| [`tanstack-start-spa`](./tanstack-start-spa)                 | TanStack Start in SPA mode                    | Access token    |
| [`react-router-declarative`](./react-router-declarative)     | React Router, `<BrowserRouter>`               | Login response  |
| [`react-router-data`](./react-router-data)                   | React Router, `createBrowserRouter`           | Access token    |
| [`react-router-framework-spa`](./react-router-framework-spa) | React Router framework mode with `ssr: false` | Login response  |

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

DummyJSON has no logout endpoint, so the apps do not pass `revoke`. Its refresh
tokens stay valid after rotation, so it cannot show the cross-tab rotation race
that session-kit's tests cover.
