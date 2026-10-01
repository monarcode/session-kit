import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Store } from '@tanstack/store';
import type { AuthError } from './errors.js';

export type UserInput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<S>;

export type User<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  /** Unix time in milliseconds. Falls back to JWT exp when omitted. */
  expiresAt?: number;
};

export type SignInInput<I> = Tokens & { user: I };

export type RefreshResult<I = never> =
  | (Tokens & { user?: I })
  | null;

export type RefreshFn<I = never> = (context: {
  refreshToken: string;
  signal: AbortSignal;
}) => Promise<RefreshResult<I>>;

export function createRefreshFn<I = never>(
  handler: RefreshFn<I>,
): RefreshFn<I> {
  return handler;
}

export type Session<U> = Readonly<{
  id: string;
  accessToken: string;
  expiresAt?: number;
  user: U;
}>;

/** Reactive auth snapshot. Tokens are intentionally excluded. */
export type AuthState<U> = Readonly<{
  status:
    | 'initializing'
    | 'authenticated'
    | 'unauthenticated'
    | 'unavailable';
  user: U | null;
  sessionId: string | null;
  /** Changes when guards must run again. */
  version: number;
  error: AuthError | null;
}>;

export type AuthClient<I, U> = {
  state: Pick<Store<AuthState<U>>, 'get' | 'subscribe'>;
  signIn: (input: SignInInput<I>) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (input: I | (() => Promise<I>)) => Promise<void>;
  getSession: () => Promise<Session<U> | null>;
  /** Recover from rejection of this particular access token. */
  refresh: (session: Session<U>) => Promise<Session<U> | null>;
  /** End only the session that produced this rejected token. */
  rejectSession: (session: Session<U>) => Promise<void>;
  isCurrent: (session: Session<U>) => boolean;
  /** Called by the Router connector. Cleanup stops background timers. */
  mount: () => () => void;
};

export type AuthOptions<S extends StandardSchemaV1> = {
  name: string;
  userSchema: S;
  refresh?: RefreshFn<NoInfer<UserInput<S>>>;
  /** Saved-session lifetime in seconds, renewed on successful writes. Default: 30 days. */
  maxAge?: number;
};
