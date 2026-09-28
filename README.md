# @monarcode/tanstack-auth

Schema-driven browser authentication for React and TanStack Router.

## Status

Early development. Not ready for production.

The current implementation uses JavaScript-readable cookies for tokens
and localStorage for the user profile. Cross-tab synchronization and
TanStack Start SSR support are not implemented.

## Entry points

```ts
import { createAuth, createRefreshFn } from '@monarcode/tanstack-auth';

import {
  connectAuth,
  useAuth,
  useAuthClient,
} from '@monarcode/tanstack-auth/react';

import { createAuthFetch } from '@monarcode/tanstack-auth/http';
```

## Development

Use Node.js 24 and pnpm.

```sh
pnpm install
pnpm run check
```

`check` builds the package, runs the 33 auth behavior tests, five React hook
tests, and four package smoke tests, then checks consumer declarations under
NodeNext and Bundler resolution. After building, use `pnpm test` to run the
runtime tests alone.

Behavior tests use mocked browser storage, HTTP responses, and timers, plus
a real Router with memory history. The test command uses the `development`
condition so the Router test can exercise client redirects with browser stubs.
Hook tests mount React DOM components in jsdom and cover reactive updates,
selector rerenders, client identity, and subscription cleanup with StrictMode.
These tests do not cover a live backend or a real browser.
