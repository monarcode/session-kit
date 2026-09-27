export { createAuth } from './core/client.js';
export { createRefreshFn } from './core/types.js';
export { AuthError } from './core/errors.js';

export type { AuthErrorCode } from './core/errors.js';

export type {
  AuthClient,
  AuthOptions,
  AuthState,
  Tokens,
  SignInInput,
  Session,
  RefreshFn,
  RefreshResult,
  User,
  UserInput,
} from './core/types.js';
