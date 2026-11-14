# Changelog

## Unreleased

### Added

- `authFetch` takes a `URL` or a `Request` as well as a path, as `fetch`
  does. An HTTP client with a `fetch` option can now send its requests
  through it, and they keep its safeguards: the token stays on one origin, a
  401 refreshes once, and only a GET or HEAD is sent again. The
  [Other HTTP clients](https://session-kit.pages.dev/docs/client/other-http-clients)
  page shows ky, axios with its `fetch` adapter, and openapi-fetch. It
  replaces the ky recipe built on hooks, and keeps the axios interceptors for
  an instance on axios's default adapter.
- `UseMirrorAuthOptions`, the type of `useMirrorAuth`'s options.
- Hooks without a hooks file. `@monarcode/session-kit/react` exports
  `AuthProvider`, `useAuth` and `useAuthClient`, typed by the client you
  register once in `Register`, from `@monarcode/session-kit`. Until you
  register one, `AuthProvider` takes any client, and the user is `unknown`.
  `ProvidedAuth` names the client they use.
  `createAuthHooks` stays, for an app with several clients.

  ```ts
  declare module "@monarcode/session-kit" {
    interface Register {
      auth: typeof auth;
    }
  }
  ```

- `@monarcode/session-kit/tanstack-router` exports `useAuth` and
  `useAuthClient`, which read the client from Router context and are typed
  by the Router you register. They need no `AuthProvider` and no
  registration of their own.
- One request's session on the server, without passing its cookie jar.
  `startAuth(serverAuth)` in `@monarcode/session-kit/tanstack-start/server`
  finds the request on each call, so it's made once, at module level, and
  one `createAuthFetch` over it serves every request.
  `routerAuth(serverAuth)` in `@monarcode/session-kit/react-router/server`
  takes the route's `context`. The guides use these. The jar-first methods
  stay, for servers without an adapter.

  ```ts
  // Before
  await serverAuth.signIn(startJar(), tokens);
  // After
  export const session = startAuth(serverAuth);
  await session.signIn(tokens);
  ```

- `serverAuth.forRequest(jar)` has every method now: `signIn`,
  `updateUser`, `refreshIfDue` and `clientCredentials` join the rest.
- `SessionOf<T>` and `UserOf<T>` in `@monarcode/session-kit` give the
  session and user types of any client: one from `createAuth`,
  `createMirrorAuth` or `createServerAuth`, or a request's session.

  ```ts
  type AppSession = SessionOf<typeof serverAuth>; // { sessionId, user }
  ```

- Middleware and server guards for the server-rendered setups, in place of
  the code the guides had you copy. Each refreshes before rendering, while a
  cookie can still be set, and ignores a failed refresh. The TanStack Start
  and React Router middleware also mark each response that doesn't set its
  own `Cache-Control` as `private, no-store` (`cacheControl` changes or
  skips it). Next.js marks pages that read cookies `no-store` itself.
  - TanStack Start: `refreshSession(serverAuth, options?)` in
    `@monarcode/session-kit/tanstack-start/server`, a handler for Start's
    `createMiddleware({ type: "request" }).server()`. Start strips what's in
    `.server()` from the browser bundle, `serverAuth` included.
  - React Router: `sessionMiddleware(serverAuth, options?)` for the root
    route, `requireSession(serverAuth, { loginPath, basename })` for guarded
    routes, whose `session(context)` gives their loaders a session that's
    never `null`, and `redirectIfSignedIn(serverAuth, options?)` as the
    sign-in page's loader, in `@monarcode/session-kit/react-router/server`.
  - Next.js: `nextSession(serverAuth, { cookies, redirect })` in
    `@monarcode/session-kit/next`, with `get()`, `require(path)` and
    `redirectIfSignedIn(redirectTo)` for Server Components, `readOnly()` and
    `writable()` for the request's session, and `refresh(request, response)`
    for `proxy.ts`. You pass Next's own `cookies` and `redirect`.

  ```ts
  // app/root.tsx
  export const middleware = sessionMiddleware(serverAuth);
  // app/routes/protected.tsx
  export const middleware = [signedIn]; // signedIn = requireSession(serverAuth)
  ```

- `loginHref(loginPath, returnTo)` in `@monarcode/session-kit` builds the
  sign-in page's URL with `?redirectTo=`, for a guard of your own.
- `SessionMiddlewareOptions` in `@monarcode/session-kit/server`: `within`
  and `cacheControl`, for `refreshSession` and `sessionMiddleware`.
- A session route, in place of the server functions, Server Functions and
  resource routes the guides had you write for the browser's client. It
  reads the session, signs out, and gets or renews the access token when
  `createServerAuth` has `clientCredentials`. It answers your own site's
  pages only (by `Sec-Fetch-Site`, or a `POST`'s `Origin` on plain http),
  with `Cache-Control: no-store`. Signing in stays your own code.
  - `createMirrorAuth({ endpoint })` calls it. `revalidate`, `signOut` and
    `credentials` are optional now, and win over `endpoint` when given. The
    options' type needs `endpoint`, or `revalidate` and `signOut`. A failure
    the server reports rejects with its `AuthErrorCode`.
  - `sessionHandler(serverAuth)` in `@monarcode/session-kit/server` answers
    it, for a request and its cookie jar (`SessionHandler`).
  - `sessionRoute(serverAuth)` wraps it for each framework: a server route's
    `handlers` in `@monarcode/session-kit/tanstack-start/server`
    (`StartSessionRoute`), a resource route's `loader` and `action` in
    `@monarcode/session-kit/react-router/server` (`RouterSessionRoute`), and
    a Route Handler's `GET` and `POST` in `@monarcode/session-kit/next`, with
    Next's `cookies` in `NextSessionRouteOptions` (`NextSessionRoute`).

  ```ts
  // app/api/session/route.ts
  export const { GET, POST } = sessionRoute(serverAuth, { cookies });
  // lib/auth/client.ts
  createMirrorAuth({ name: "app", session, endpoint: "/api/session", signIn });
  ```

- `isSignedIn(state)` in `@monarcode/session-kit`: `true` while
  `authenticated` or `refreshing`, and `false` while `locked`. It narrows
  `user`, and works as a selector: `useAuth(isSignedIn)`.
- `requireSessionLoader(auth, options?)` and
  `redirectIfSignedInLoader(auth, options?)` in
  `@monarcode/session-kit/react-router` make the guards' loaders, for
  `loader` or `clientLoader`. The second reads `?redirectTo=` from the URL.
  Their options are `RequireSessionLoaderOptions` and
  `RedirectIfSignedInLoaderOptions`, and they return `RequireSessionLoader`
  and `RedirectIfSignedInLoader`. `requireSession` and `redirectIfSignedIn`
  stay, for a loader that does more.

  ```ts
  export const clientLoader = requireSessionLoader(auth);
  ```

- `loginPath` defaults to `"/login"` in `requireSession` for TanStack Router
  and React Router, and in React Router's `SessionOutlet`.
- `deepLinkHandler(auth, options?)` in `@monarcode/session-kit/expo` makes
  `redirectSystemPath` for `app/+native-intent.tsx` (`DeepLinkHandler`).
  `rememberDeepLink` stays, for a `redirectSystemPath` that does more.

### Changed

- **Breaking:** `createAuthFetch` takes the base URL as an option, as
  `sessionBearer` does. A missing `baseUrl` throws `INVALID_OPTIONS`.

  ```ts
  // Before
  createAuthFetch(auth, "https://api.example.com/", { optional: true });
  // After
  createAuthFetch(auth, {
    baseUrl: "https://api.example.com/",
    optional: true,
  });
  ```

- **Breaking:** `AuthFetch`'s first parameter is `string | URL | Request`,
  not `string`. Only code that implements the type is affected, such as a
  test fake that declares `(path: string) => …`: widen its parameter.
- `authFetch` rejects with `INVALID_OPTIONS` when called with no path. It
  used to request `undefined` under the base URL.
- `authFetch` asks for the credentials before it builds the request. Signed
  out or locked, a call with an `init` that `Request` refuses now rejects
  with `UNAUTHENTICATED` or `LOCKED`, not with `Request`'s `TypeError`.
- **Breaking:** the `signIn` of a `createMirrorAuth` client rejects with what
  your `signIn` option threw, unchanged, as a sign-in in a single-page app
  does. It used to wrap it in a `USER_VALIDATION_FAILED` `AuthError`, so a
  sign-in form had to read the message from `cause`. A result that isn't a
  session still rejects with `INVALID_SESSION`.

  ```ts
  // Before
  const reason = error instanceof Error ? error.cause : undefined;
  setError(reason instanceof Error ? reason.message : "Could not sign in");
  // After
  setError(error instanceof Error ? error.message : "Could not sign in");
  ```

- **Breaking:** `useMirrorAuth` takes one options object, and throws
  `INVALID_OPTIONS` without `create` or `onChange`.

  ```ts
  // Before
  useMirrorAuth(createAppAuth, session, () => router.refresh());
  // After
  useMirrorAuth({
    create: createAppAuth,
    session,
    onChange: () => router.refresh(),
  });
  ```

- **Breaking:** TanStack Start's `connectSession(router)` replaces
  `sessionHydration(auth)` and the `connectAuth(router)` beside it. It keeps
  the router's own `dehydrate` and `hydrate`, which `...sessionHydration(auth)`
  replaced, or was replaced by, depending on the order of the spread.
  `sessionHydration`, `SessionHydration` and `DehydratedSession` are removed.

  ```ts
  // Before
  const router = createRouter({
    routeTree,
    context: { auth },
    ...sessionHydration(auth),
  });
  connectAuth(router);
  // After
  const router = createRouter({ routeTree, context: { auth } });
  connectSession(router);
  ```

- **Breaking:** `Register` and `RegisteredAuth` moved from
  `@monarcode/session-kit/effect` to `@monarcode/session-kit`, so one
  registration types the hooks and the Effect service. Change the module you
  augment. The other `Registered…` types stay in `./effect`. Register a
  client from `createAuth` or `createMirrorAuth`: anything else now types the
  hooks and the Effect service as `never`, where the Effect service used to
  fall back to an `unknown` user.

  ```ts
  // Before
  declare module "@monarcode/session-kit/effect" {
    interface Register {
      auth: typeof auth;
    }
  }
  // After
  declare module "@monarcode/session-kit" {
    interface Register {
      auth: typeof auth;
    }
  }
  ```

- **Breaking:** in `@monarcode/session-kit/tanstack-router`, `useRouterAuth`
  is now `useAuthClient`, and `RegisteredAuth` is now `RouterAuth`, so it
  isn't confused with the main entry point's. When `auth` is optional in
  Router context, `useAuthClient` returns the client without `undefined`, as
  it throws when there's none. A hooks file made with
  `createAuthHooks({ useClient: useRouterAuth })` can go: import `useAuth`
  and `useAuthClient` from `@monarcode/session-kit/tanstack-router` instead.
- **Breaking:** `RequestAuth` takes the user `signIn` accepts as a second
  type parameter, as `ServerAuth` does: `RequestAuth<User, User>`, or
  `RequestAuth<User, never>` when the user comes from the access token. Most
  apps write `SessionOf` or `UserOf` instead.
- Effect's `Auth.layer` binds a session from `startAuth` to the request
  that's current when it's called, and throws `INVALID_OPTIONS` outside
  one. `Auth.signIn` and `Auth.updateUser` still die on a request's session,
  and now point at its own `signIn` and `updateUser`.

- The guides moved to the documentation site,
  [session-kit.pages.dev](https://session-kit.pages.dev), with an API
  reference for every entry point and every error code. The README is now a
  short introduction and quick start, and each `docs/*.md` file points to its
  page on the site.
- Option defaults in the JSDoc are `@default` tags, which editors show in
  hovers, instead of a "Default: x." sentence. Defaults that take words, such
  as "the nearest `AuthProvider`'s", are still written out.
- The Effect guide calls the API with effetch alone. The app's API client
  is one `Fetch.make`, shared as a service in the app's runtime, and Effect
  code yields it and calls `get` or `post`. The refresh has a `Fetch.make`
  of its own. `Fetch.endpoint` appears only with effetch-query, and Effect's
  `FetchHttpClient`, which effetch sends with, is provided where the runtime
  is made. The guide
  and the `tanstack-start-spa-effetch` example now pass the client's
  `defaultError` to effetch-query's `endpoints`. `sessionBearer`'s example
  calls the client's methods too.
- `AuthErrorCode`'s docs say which codes the browser client of a
  server-rendered app rejects with: `PERSISTENCE_FAILED` when signing out on
  the server fails, and `REFRESH_FAILED` when reading the session or the
  access token from the server fails.
- The setup guides are corrected against the code and the example apps. The
  TanStack Start guard renders `SessionOutlet`, the Next.js guard sends users
  back to the page they asked for after sign-in, and the React Router layout
  with server rendering has a loader, so its middleware runs on navigation. React
  Router's `SessionOutlet` is described as it behaves, and smaller facts are
  corrected: `keychainAccessible`'s default, the ten-second reuse window,
  which requests are sent again after a refresh, and when a sign-out reaches
  other tabs.
- The compatibility page lists `effect` as a peer of `./effetch` as well as
  `./effect`, and the entry points page orders the entry points as the
  reference does.
- The router guides' sign-in pages no longer navigate after a sign-in. The
  sign-in page's guard runs again and sends the user on, so a form only signs
  in. The server-rendering guides call the API with `createAuthFetch` over the
  request's session, and the Expo guide adds the profile screen its deep-link
  steps open.
- The reference lists the members of `AuthStorage`, `Tokens` and
  `CookieJar`, the types an app builds itself. The server-rendering guides'
  sign-in shows the backend's own message for a failed sign-in, as the
  example apps do, and the secret-rotation example works once the old secret
  is removed.

## 0.1.0-alpha.8

### Added

- `AuthFetch` in `@monarcode/session-kit/http`: the type of the function
  `createAuthFetch` returns, to type a prop, a context or a test fake.
  `createAuthFetch` now declares it as its return type: the signature is the
  same, and hovers show `AuthFetch`.
- `serverAuth.forRequest(jar)` in `@monarcode/session-kit/server`: one
  request's session shaped like a client's read side (`RequestAuth`), with
  `getSession`, `signOut`, `credentials`, `isCurrent` and `state`. With it,
  `createAuthFetch` runs on the server: it sends the cookie's token and saves
  a renewed one after a 401. A read-only jar can't renew, so there a 401
  rejects with `REFRESH_FAILED`, unless the writable jar of the same request
  already renewed it, and `credentials.reject` resolves without signing out.
- `Auth.layer` in `@monarcode/session-kit/effect` also takes a request's
  session, `serverAuth.forRequest(jar)`, whose user is the registered one.
  `Auth.session`, `Auth.credentials`, `Auth.renew`, `Auth.signOut` and
  effetch's `sessionBearer` then work in server functions, actions and route
  handlers, refreshing and saving the cookie. Provide it per request, with
  the services that use it. `Auth.signIn` and `Auth.updateUser` die there:
  call `serverAuth.signIn(jar, …)` and `serverAuth.updateUser(jar, …)`.
- The Effect guide's "On the server" section replaces "With server
  rendering": a runtime for what belongs to no user, the API client and the
  session built per request, signing in through `serverAuth`, and what to
  know about typing, memo maps and read-only jars. The server sessions guide
  and the README point to `forRequest`.

### Fixed

- A server session read with a read-only jar whose access token had expired
  left the client's `state` at `initializing`. It is now `unavailable`, with
  the session ID.

### Changed

- The JSDoc across every entry point is rewritten for app developers: each
  hover says what the export does first, then its errors and platform
  differences, with shorter examples. Several statements that no longer
  matched the code are corrected, in the JSDoc, the README and the guides:
  when the early refresh runs, which jar `nextJar` returns, and what
  `createServerAuth` accepts.
- The README's Effect example and `examples/tanstack-start-spa-effetch`
  refresh the session with a client method (`client.post`) instead of binding
  an endpoint on every call, as effetch's README recommends.

## 0.1.0-alpha.7

### Added

- Server rendering, with the session kept on the server: TanStack Start,
  Next.js 16 and React Router framework mode render the signed-in page on the
  first response, and the refresh token never reaches the browser. The
  README's "Server rendering" section gives the overview; each framework has a
  guide and an example app.
- `@monarcode/session-kit/server`: `createServerAuth` keeps both tokens and
  the user in an encrypted `httpOnly` cookie (AES-256-GCM through Web Crypto,
  with rotatable secrets), refreshes on the server, and shares one refresh
  between parallel requests. Each method takes the request's `CookieJar`.
  With `clientCredentials: true`, the app can hand the access token, never the
  refresh token, to its own page scripts. The secret is checked on first use,
  so a build that loads the module without it, such as `next build`, still
  works.
- `createMirrorAuth`, the browser client for that session: it starts from the
  session the server rendered, so there is no `initializing` state, and works
  with `AuthProvider`, the hooks and the router guards, and, given
  `credentials`, with `createAuthFetch` and `sessionBearer`. Given a `signIn`
  option, its `signIn` forwards the input to the app's own server function,
  action or route handler, including tokens the browser got from the backend
  itself.
- TanStack Start, guided by `docs/tanstack-start.md` and shown in
  `examples/tanstack-start-ssr`. `@monarcode/session-kit/tanstack-start` has
  `sessionHydration`, router options (`SessionHydration`) that carry the session from the server
  render to the browser, and `loadSession`, which reads it into the client in
  the root route's `beforeLoad`. `@monarcode/session-kit/tanstack-start/server`
  has `startJar()`, the request's cookie jar for server functions and
  middleware. `@tanstack/react-start` 1.169 or newer is a new optional peer
  dependency.
- Next.js 16 with the App Router, guided by `docs/next.md` and shown in
  `examples/next-app`. `@monarcode/session-kit/next` has `nextJar`, the cookie
  jar of `cookies()`, read-only unless `writable` is passed in a Server
  Function or Route Handler, and `proxyJar`, which refreshes in Proxy so
  Server Components read current tokens. `next` 16 is a new optional peer
  dependency.
- React Router framework mode, guided by `docs/react-router-ssr.md` and shown
  in `examples/react-router-framework-ssr`.
  `@monarcode/session-kit/react-router/server` has `cookieJarMiddleware`, root
  middleware that gives each request a cookie jar and sets its cookies on the
  response, and `routerJar(context)`, which finds that jar in middleware,
  loaders and actions. It needs React Router's middleware: React Router 8, or
  7.9 and later with `future.v8_middleware`.
- `useMirrorAuth` in `@monarcode/session-kit/react`, for Next.js, React
  Router and other server-rendering frameworks: it creates the browser client
  from the session the server rendered and keeps the two in step, calling the
  framework's own way to render again, such as Next's `router.refresh()` or
  React Router's `revalidate`, when the session changes in the browser.
- `createAuthFetch` takes `optional`, with the same meaning as
  `sessionBearer`'s: signed out, a request is sent without `Authorization`
  instead of rejecting with `UNAUTHENTICATED`. Locked still rejects with
  `LOCKED`, and a sign-in during the request rejects it with
  `SESSION_CHANGED`.
- The Effect guide covers caching with effetch-query: a `QueryProvider` that
  owns its client and resets it by `sessionId`, so no account sees another's
  cache.
- Guides for TanStack Router (`docs/tanstack-router.md`), which also covers
  layouts around guarded pages and TanStack Start in SPA mode, and for React
  Router's declarative, data and framework `ssr: false` modes
  (`docs/react-router.md`).
- The README is rewritten to read from the start: why the package exists, a
  one-file example, how it works, a step-by-step "Getting started" that needs
  no router, a summary of each guide, and an "Effect and effetch" section.
  Its reference half lists every client method, option and error code in
  tables, with a compiled example for each topic, and ends with "Common
  questions".
- The README shows how to attach the access token with another HTTP client:
  "Other HTTP clients" has interceptors for axios and hooks for ky, built on
  `auth.credentials.get`, `renew` and `reject`.
- `examples/tanstack-start-spa-effetch`: the TanStack Start SPA app with its
  user described by an Effect Schema, an effetch client with `sessionBearer`,
  one runtime, and effetch-query for its sign-in and its requests.

### Changed

- The `@monarcode/effetch` peer range is `^0.1.0-rc.2`, up from `rc.1`:
  effetch-query, which the README's Effect examples use, needs it.
- `AuthFetchClient` now includes `state`, which `optional` reads. Any
  `createAuth` client still fits; a hand-written object needs `state` too.
- `Auth.layer` takes a `createMirrorAuth` client: `AuthServiceClient`'s
  `signIn` is optional and may resolve a value. `Auth.signIn` dies with
  `INVALID_OPTIONS` for a client without `signIn`.

### Fixed

- `Auth.updateUser` calls the client's `updateUser` as a method, so a
  class-based `AuthServiceClient`, such as a fake in tests, keeps its `this`.

## 0.1.0-alpha.6

### Added

- `@monarcode/session-kit/effect` provides the client as an Effect
  service, `Auth`, for apps built on `effect` 4.1 or newer, an optional peer
  dependency. Register the client's type once through `Register`, provide
  it with `Auth.layer(auth)`, and use `Auth.session`, `Auth.sessionOption`,
  `Auth.credentials`, `Auth.renew`, `Auth.signIn`, `Auth.signOut`,
  `Auth.updateUser` (which also takes an Effect that fetches the user) and
  `Auth.changes`, a `Stream` of the state. They fail with `AuthFailure`, a
  tagged error carrying the `AuthErrorCode` as `code`; `INVALID_OPTIONS` is
  a defect. The [Effect guide](./docs/effect.md) walks through it.
- `@monarcode/session-kit/effetch` adds `sessionBearer({ baseUrl })`, a
  plugin for `@monarcode/effetch` (an optional peer dependency) with
  `createAuthFetch`'s behaviour: it sends the access token only to
  `baseUrl`'s origin, refuses redirects with Effect's `FetchHttpClient`,
  renews once after a 401 and replays `GET` and `HEAD`, signs out after a
  second 401 unless `signOutOnRepeated401` is `false` (calls can override
  it), and fails with `AuthFailure` (`UNAUTHENTICATED`, `LOCKED`,
  `SESSION_CHANGED`, …) instead of sending a request without a token or
  returning another account's response. With `optional: true`, a call made
  while signed out is sent without a token instead, for one client that
  serves public and private endpoints; calls can override it. A request
  that already has an `Authorization` header is sent as it is, like
  effetch's `bearer`. `Fetch.make` needs the `Auth` service.
- A `debug` option on `createAuth` reports what auth does: restores,
  refreshes and why they ran, timers, storage operations, other tabs'
  changes, state changes, and what ended a session. `true` logs to
  `console.info`; a function, or `{ log }`, receives each `AuthDebugEvent`
  instead. Tokens, saved values, user fields, and errors' causes are left
  out unless `{ sensitive: true }`. `SessionGate`, deep links, and
  foreground handling report through the same option, and storage adapters
  can add their own events, per key, through the new optional `AuthStorage`
  member `debug`, as `secureStorage()` does.
- `SessionGate` takes `ready`, `true` by default. Until it is `true`, as well
  as while the session is restored, the gate renders nothing and keeps the
  splash screen up; that applies only until the splash screen is first
  hidden, even if the gate remounts. The deep link opened after a sign-in
  waits for `ready` too.

- `locking` on `createAuth` restores a saved session as the new `locked`
  status, with `user` and `sessionId` set and its tokens waiting for
  `auth.unlock()`, for native apps that ask a returning user to unlock, for
  example with biometrics. `{ seal, open }` encrypts the saved tokens with a
  key the app holds; `locking: true` stores them as they are. `auth.lock()`
  locks again, keeping the saved session. While locked, `getSession`,
  `retry`, `refresh`, `updateUser`, `credentials.get`, and
  `credentials.renew` reject with `LOCKED`, and nothing refreshes.
  `unlock()` refreshes expired access at once; if that refresh fails, it
  rejects with `REFRESH_FAILED`, and the session is unlocked but
  `unavailable`. `open` runs only when unlocking. `SessionGate` renders the navigator for a locked session, and a remembered
  deep link opens after the unlock. The router adapters treat a locked
  session as signed out.

### Changed

- `AuthStatus` adds `"locked"`, and `AuthErrorCode` adds `"LOCKED"` and
  `"UNLOCK_FAILED"`, so a `switch` that covers every value needs the new
  cases. `AuthClient` adds `lock` and `unlock`, which reject without
  `locking`. Without `locking`, no state is ever `locked`.
- TanStack Router's `SessionOutlet` reads `status` rather than `user`, so a
  locked session shows `pending`.
- Errors from session-kit's own logic are `AuthError`s, under the new code
  `"INVALID_OPTIONS"` for misuse, so a `switch` that covers every
  `AuthErrorCode` needs that case too. Misuse that threw a plain `Error` now
  throws or rejects with `INVALID_OPTIONS`, with the same message: an invalid
  `createAuth` option, a `loginPath` or `basename` without a leading `/`, an
  unknown `webStorage` area, hooks with no client, and `lock()` or `unlock()`
  without `locking`. `createAuthFetch` throws it for an invalid `baseUrl`,
  and `authFetch` rejects with it for an invalid path or one off the API
  origin; `fetch`'s own failures still pass through.
- `webStorage()` outside a browser and a value too large for
  `secureStorage()` fail with `PERSISTENCE_FAILED` carrying their own
  message, rather than a generic one whose `cause` held it.
- `updateUser` rejects with `USER_VALIDATION_FAILED` when its input function
  rejects or times out, with the failure as `cause`, as `signIn` already
  did. It used to reject with that failure itself.
- Optional properties of the public types accept `undefined` explicitly
  (`foo?: T | undefined`), so apps using `exactOptionalPropertyTypes` can
  pass `undefined` to them.
- Every public export has JSDoc with an example, which the published `.d.ts`
  files carry to editors.

### Fixed

- A cold-start deep link to a guarded screen is no longer dropped as
  "already showing" while Expo Router's pathname still reads the launch URL,
  as it can while the gate holds the splash screen and as the navigator
  first mounts. A cold-start link to a screen anyone may see is dropped at
  the sign-in instead of once shown.
- `SessionGate` and `rememberDeepLink` recognise a client passed as a copy,
  such as `client={{ ...auth }}`, so a remembered link still opens.

## 0.1.0-alpha.5

### Added

- `secureStorage()` from the new `@monarcode/session-kit/expo` entry point
  saves the session with `expo-secure-store`. It encodes keys for
  SecureStore, splits values over its 2048-byte limit across keys without
  ever leaving a half-written value, and reads synchronously. By default it
  removes a session that iOS kept in the keychain from an earlier install;
  `clearOnReinstall: false` keeps it. Data Android can't decrypt, as after a
  backup restored onto another device, reads as signed out.
  `keychainAccessible` is passed to SecureStore.
- `SessionGate` from `@monarcode/session-kit/expo` wraps the root navigator
  of an Expo Router app and adds what `Stack.Protected` lacks. It keeps the
  splash screen up while the session is restored, renders an
  `unavailable({ error, retry })` fallback, re-checks the session when the
  app returns to the foreground, and remounts screens when one account
  replaces another.
- `rememberDeepLink(auth, url)`, called from `redirectSystemPath` in
  `+native-intent.tsx`, keeps a deep link that `Stack.Protected` would drop
  while the user is signed out. `SessionGate` opens it after the sign-in.
- `UnavailableProps`, the type of `SessionOutlet`'s and `SessionGate`'s
  `unavailable` render prop, is exported from `/react-router` and `/expo`.
- Optional peer dependencies for Expo SDK 53 and later: `expo-router`,
  `expo-secure-store`, `expo-file-system`, and `react-native`.
- An [Expo Router guide](./docs/expo.md) and an
  [`expo-router` example app](./examples/expo-router) for iOS and Android.

### Fixed

- JWT access tokens decode where the runtime has no `TextDecoder`, as in
  older Hermes builds of React Native, or one that rejects the `fatal`
  option, as some polyfills do. Before, decoding failed silently there:
  expiry from `exp` and `iat` was ignored, and `fromAccessToken` rejected
  every token.
- React Router's `SessionOutlet` given a `client` and rendered without
  `AuthProvider` now mounts that client. Before, nothing restored the saved
  session in declarative mode, so the outlet showed `pending` for good.
- `AuthProvider` mounts its client in a layout effect on React Native, as in
  browsers, so a synchronous restore happens before the first frame. It used a
  passive effect wherever `document` was missing.

### Changed

- A JWT payload that is not valid UTF-8 is no longer read. Malformed bytes
  used to become replacement characters; now `fromAccessToken` rejects the
  token with `USER_VALIDATION_FAILED`, and expiry is not taken from it. JWTs
  must be UTF-8, so tokens from a working backend are unaffected.

## 0.1.0-alpha.4

### Security

- `safeReturnTo` no longer returns paths whose dot segments resolve to
  another origin. Earlier versions turned inputs such as `/.//evil.com` and
  `/%2e//evil.com` into `//evil.com`, which browsers and routers follow to
  `evil.com`. Apps that pass `safeReturnTo`'s result to a redirect on alpha.3
  or earlier should upgrade. The new `redirectIfSignedIn` guards use the fixed
  check.

### Added

#### Storage

- `createAuth` takes a `storage` adapter. `webStorage()` saves the session in
  `localStorage`; `webStorage({ area: "session" })` uses `sessionStorage`, so
  each tab has its own session that ends with the tab. `memoryStorage()` keeps
  the session in memory only. Custom storage implements the new `AuthStorage`
  type, and its operations may return promises.
- Auth applies storage operations one at a time, in the order it issued them,
  and re-checks its own session after every read. Storage that settles late or
  out of order cannot erase a newer sign-in, and a profile update cannot
  restore tokens this tab refreshed meanwhile.
- `webStorage()` explains when browser storage does not exist at all, as on a
  server, instead of reporting a bare `TypeError`.

#### Users and sessions

- `fromAccessToken(claims, map?)` reads the user from a JWT access token. Its
  claims are validated by a Standard Schema and `map` turns them into the user.
  `signIn` and the refresh callback then take tokens only, the user is not
  saved, and it changes whenever the token does. A `decode` option replaces the
  default, which decodes the JWT without verifying its signature.
- `auth.refresh()` refreshes immediately, even while the access token is still
  usable, for example to pick up a changed user.
- An optional `revoke` callback receives the ended tokens after `signOut()`
  clears the session. A failed revocation does not undo the sign-out; it is
  published as the new `REVOKE_FAILED` error code.
- Checking `state.status` narrows `state.user`: `AuthState` is now a
  discriminated union in which `user` is set exactly while `authenticated` or
  `refreshing`.
- Mounting restores the saved session at once when storage and the user
  source both answer synchronously, as with `webStorage()` and a synchronous
  schema. `AuthProvider` mounts in a layout effect, so the browser's first
  paint shows the restored session rather than `initializing`, although
  components may render once with `initializing` before that paint. A saved
  session that cannot be restored signs out at once. Asynchronous storage,
  schemas, or token decoding restore as before, and validate the saved user
  once.
- Session IDs no longer require `crypto.randomUUID`, and user validation no
  longer requires `structuredClone`, for environments such as React Native.

#### React and routers

- A new `/tanstack-router` entry point holds the Router integration:
  `connectAuth`, plus guards that replace the protected-layout code apps used
  to copy. `requireSession` redirects signed-out users with a `redirectTo`
  search param and puts `{ session }` in route context; `SessionOutlet` renders
  child routes only while that session is current, remounting them for a new
  account; `redirectIfSignedIn` sends signed-in users away from the sign-in
  page; `useRouterAuth` reads the client from Router context. Guards read the
  session again when it changes while they check it.
- A new `/react-router` entry point supports React Router 7 and 8 in
  declarative mode, data mode, and framework mode with `ssr: false`. React
  Router is an optional peer dependency.
  - In declarative mode, `SessionOutlet` is the guard: it shows `pending`
    while restoring, sends signed-out users to `loginPath` with `redirectTo`,
    and offers a retry through `unavailable` after a failed refresh.
  - In data and framework mode, `requireSession` and `redirectIfSignedIn`
    guard loaders, and `useAuthRevalidation` re-runs loaders when auth
    changes. `SessionOutlet`, rendered by the guarded route, shows child
    routes only while the session its loader accepted is still the signed-in
    one, so they never see the previous account's loader data. Pass the
    router's `basename` to `requireSession`, which leaves it out of
    `redirectTo`.
- TanStack Start in SPA mode is supported. `connectAuth` does nothing while
  the Router renders on a server, so Start's build-time shell shows the pending
  UI instead of a storage error. Apps served by Start's own server should set
  `defaultSsr: false`, so guards run in the browser.
- React 18 is supported (`^18.0.0 || ^19.0.0`). CI tests React 18.0.0 as the
  oldest version.

#### Documentation

- The README's quick start signs in against DummyJSON with TanStack Router,
  and links to an example app for every other supported setup.
- `examples/` holds one app per supported setup, built in CI, all signing in
  against DummyJSON's auth API.

### Changed

- **Breaking:** `createAuth` takes the user schema as `user` instead of
  `userSchema`, and `storage` is required. Pass `storage: webStorage()` to keep
  the previous behavior.
- **Breaking:** `getSession()` and `retry()` resolve `{ sessionId, user }`
  without tokens, so a session is safe in route context. Access tokens come
  from `auth.credentials.get()`, which resolves
  `{ sessionId, accessToken, expiresAt }`. `auth.refresh(session)` is now
  `auth.credentials.renew(credentials)`, `auth.rejectSession(session)` is now
  `auth.credentials.reject(credentials)`, and `isCurrent` takes any object
  with a `sessionId`. `auth.refresh()` still exists but now takes no argument
  and forces a refresh; TypeScript flags calls that still pass a session.
- **Breaking:** `createRefreshFn` is removed. Pass the refresh callback inline,
  or type a standalone one with `RefreshFn<UserInput<typeof schema>>`.
- **Breaking:** `AuthClient` takes the user type first and requires both type
  arguments: `AuthClient<User, Input>`, with `never` as the input when the user
  comes from the access token. Leaving out the input used to drop
  `updateUser` silently. Prefer `typeof auth`.
- **Breaking:** `/react` no longer depends on TanStack Router and exports only
  `createAuthHooks`, which returns `useAuth`, `useAuthClient`, and an
  `AuthProvider` typed for one client. With TanStack Router, keep the
  provider-free setup with
  `createAuthHooks({ useClient: useRouterAuth })`; elsewhere, render
  `AuthProvider`, which also mounts the client. `connectAuth` moved to
  `/tanstack-router`, and `safeReturnTo` to the package root.
- **Breaking:** TanStack React Router `^1.132.0` is required (was
  `^1.127.0`). Earlier versions include the router's `basepath` in
  `location.href`, so `requireSession` would put it in `redirectTo` and users
  came back to a path with the `basepath` twice. CI tests 1.132.0 as the
  oldest version.
- **Breaking:** both peer dependencies are optional, and React DOM is no longer
  one. Install TanStack Router only for `/tanstack-router`, and React only for
  the React entry points.
- **Breaking:** sign-in, `updateUser`, and a refresh that returns a user reject
  with `USER_VALIDATION_FAILED` when the user schema does not accept its own
  output unchanged. Such a schema used to pass sign-in, then fail restoration
  and sign users out on their next reload.
- **Breaking:** sessions are saved in a new format. Sessions saved by earlier
  alphas, including the two-key format of 0.1.0-alpha.1, are not restored, so
  users sign in once after upgrading.
- A refresh that returns a user equal to the current one keeps the same user
  object and does not change `version`, so guards do not run again.

### Fixed

- Unmounting, as React's StrictMode does after the first mount, no longer
  cancels a restore or refresh in progress; mounting again joins it. It used
  to show an expired session as `unavailable`, reject callers waiting on
  `getSession()` with `SESSION_CHANGED`, and send the same refresh token
  twice, which signed the user out when the backend rotates refresh tokens.
- A `signIn` whose validation fails no longer disturbs the current session.
  It used to cancel a restore in progress, leaving `status` at
  `initializing`, and abort a refresh in flight. While a sign-in validates,
  only a newer `signIn` or `signOut()` cancels it; expiry and other tabs do
  not.
- Mounting again after an unmount applies what another tab saved meanwhile,
  such as a sign-out. Changes made while nothing was mounted used to go
  unnoticed until the next one.

## 0.1.0-alpha.3

### Added

- `AuthStatus` names the union of `AuthState.status` values, for helpers and
  exhaustive `switch` statements.

### Changed

- Reactive state uses Nano Stores instead of TanStack Store. Apps on Router
  versions that depend on an older TanStack Store no longer bundle two copies.
- **Breaking:** `AuthClient.state` is typed by this package rather than
  `@tanstack/store`. `state.subscribe` takes a listener function; observer
  objects (`{ next, error, complete }`) are no longer accepted.
- **Breaking:** the `AuthError` constructor takes schema `issues` in its options
  object, `new AuthError(code, message, { cause, issues })`, instead of as a
  fourth argument. The new `AuthErrorOptions` type describes those options.

### Fixed

- A `state.subscribe` listener that throws no longer makes `signIn` (or another
  operation) reject after it succeeded, or stops later listeners, including
  `useAuth` and `connectAuth`, from seeing the change. The error is rethrown
  asynchronously instead.
- When another tab saves a user that this tab's schema rejects, for example
  while two deploys are open, this tab no longer keeps the old profile with no
  error. It signs every tab out with `USER_VALIDATION_FAILED`, as restoring
  that session would.

## 0.1.0-alpha.2

### Changed

- **Breaking:** `AuthState.status` adds `"refreshing"`. Exhaustive `switch`
  statements over `status` need a case for it.
- While a refresh replaces expired or rejected access (after a 401, at expiry,
  or when restoring an expired saved session), `status` is `"refreshing"` and
  `user` stays visible. Previously the state passed through `"unavailable"` with
  `user: null`, so the UI briefly looked signed out.
- A refresh that only replaces the token no longer changes `version`, so
  `connectAuth` no longer invalidates the router twice per 401. A failed refresh,
  a terminal rejection, or a changed user still changes `version` once.
- **Breaking:** after a failed refresh, `getSession()` rethrows that
  `REFRESH_FAILED` error instead of starting another refresh. It keeps doing so
  until `auth.retry()`, a sign-in, or a sign-out. This prevents a loop where each
  failure re-ran Router guards and each guard started a new refresh.

- **Breaking:** a JWT with both `iat` and `exp`, and no explicit expiry, now
  expires `exp - iat` seconds after auth receives it, instead of at absolute
  `exp`. A browser clock that runs ahead of the server no longer makes fresh
  tokens look expired and block sign-in. A JWT without `iat` still uses `exp`.

- **Breaking:** tokens and profile are saved together in one
  `<name>:auth:session` localStorage entry, so another tab can never read half a
  save. Entries written by 0.1.0-alpha.1 are removed, not restored,
  so users sign in once after upgrading.
- Tabs no longer sign each other out when the backend rotates refresh tokens.
  Refresh runs under a `<name>:auth:refresh` Web Lock, so one tab at a time
  spends the refresh token, and a tab first uses tokens another tab already
  saved. Previously a tab refreshing with a token another tab had already spent
  got `null`, signed out, and cleared storage for every tab.
- A profile update keeps tokens another tab refreshed instead of overwriting
  them with this tab's older ones.
- A refresh, a terminal rejection, or a second 401 never overwrites or clears an
  account another tab signed in, or signs it out. This tab switches to what
  storage holds; the pending call rejects with `SESSION_CHANGED`.
- While connected, tabs follow each other live through `storage` events. Signing
  out in one tab signs out every tab, so guards redirect to sign-in. Signing in
  or switching accounts in one tab switches the others, with a new `sessionId`.
  Profile updates appear in every tab. Each of these changes `version` once. A
  refresh elsewhere quietly replaces tokens and clears this tab's
  `REFRESH_FAILED` state, without changing `version`. Previously other tabs kept
  working with the old session until reload.

- Peer ranges are wider: React and React DOM `^19.0.0` (was `^19.3.0`), and
  TanStack React Router `^1.127.0` (was `^1.170.38`). CI tests the oldest
  versions in each range.
- The published package no longer declares `engines.node`. Installing it with
  `engine-strict` on Node.js 22 or older no longer fails. Node.js 24 is still
  required to develop the package, through `devEngines`.

### Added

- Tokens accept `expiresIn` (seconds, as in OAuth `expires_in`), counted from
  receipt. Passing both `expiresIn` and `expiresAt` is rejected.
- `auth.retry()` tries a failed refresh again. The README's protected layout
  example uses it in a Retry button.
- The README shows how to treat every refresh failure as a sign-out by returning
  `null` from the refresh callback.
- `createAuthFetch` accepts `{ signOutOnRepeated401: false }`, so an endpoint
  that answers 401 for reasons other than a rejected token cannot sign users out.
- `safeReturnTo` accepts `{ loginPath }`, one path or several, for apps whose
  sign-in page is not `/login`.

### Fixed

- `safeReturnTo` treats `/login/`, `/LOGIN`, and percent-encoded spellings of
  the login path as redirect loops. Previously only the exact `/login` was
  caught.
- `createAuthFetch` releases the first 401 response body when the refresh
  throws, and releases a response that arrives after the session changed.
- A proactive refresh cancelled by unmounting, or by a new sign-in, no longer
  counts as that token's one proactive attempt. Previously, after a remount, the
  token waited until expiry to refresh.

## 0.1.0-alpha.1

### Changed

- Tokens now persist in a `<name>:auth:tokens` localStorage entry instead of a
  cookie, so browsers no longer attach access and refresh tokens to every
  same-origin request. The profile remains in `<name>:auth:user`.
- **Breaking:** the `cookieMaxAge` option is renamed `maxAge`.
- The 3,800-character token budget is removed.

## 0.1.0-alpha.0

This continues `@monarcode/tanstack-auth@0.1.0-alpha.0` with the same APIs and
entry points. Additional router adapters are planned for later development.

Initial alpha for React browser apps using TanStack Router. The intended npm
distribution tag is `next`. The API may change during alpha development.

### Included

- `createAuth` validates users with Standard Schema V1 and infers their input
  and output types. Tokens persist in cookies; validated profiles persist in
  localStorage.
- Session restoration, sign-in, sign-out, account switching, and profile updates
  expose reactive state through TanStack Store.
- Optional refresh supports explicit expiry or JWT expiry hints, proactive
  scheduling, shared in-flight refresh work within one client, and recovery after
  operational failures. Session changes prevent stale async results from
  restoring old credentials.
- `connectAuth` connects a stable auth client in Router context to initialization
  and route revalidation. `useAuth` and `useAuthClient` retain consumer Router and
  schema inference; `safeReturnTo` validates local redirect destinations.
- `createAuthFetch` sends Bearer tokens to the configured origin and attempts
  refresh after a 401. GET and HEAD can be replayed once; mutations are not
  automatically replayed.
- ESM JavaScript, declarations, and source maps are exported through the package
  root, `/react`, and `/http`. The README includes a file-based Router example.

### Validation

- 45 automated auth behavior tests, five React hook tests, and four package smoke
  tests.
- Consumer declarations and eight README examples checked under TypeScript
  NodeNext and Bundler resolution.
- Local tarball installation, type inference, production build, and manual
  browser checks in a consuming app using mock refresh callbacks and dummy tokens.

### Limits

- Early development; not ready for production. Declared peer ranges are React and
  React DOM `^19.3.0`, and TanStack React Router `^1.170.38`. Node.js `>=24` is
  required; TypeScript 6.0.3 is the verified compiler version.
- Credentials are readable by same-origin JavaScript. Applications supply their
  authentication backend, server authorization, and token revocation.
- No cross-tab synchronization, automatic Query cache management, SSR adapter,
  or TanStack Start integration.
- Automated browser tests and validation against a real authentication backend
  are still pending.
