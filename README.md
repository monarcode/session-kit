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
