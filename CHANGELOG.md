# Changelog

## 0.1.0-alpha.0

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
