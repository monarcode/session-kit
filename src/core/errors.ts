import type { StandardSchemaV1 } from '@standard-schema/spec';

export type AuthErrorCode =
  | 'USER_VALIDATION_FAILED'
  | 'INVALID_SESSION'
  | 'PERSISTENCE_FAILED'
  | 'REFRESH_FAILED'
  | 'SESSION_CHANGED'
  | 'UNAUTHENTICATED';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    options?: ErrorOptions,
    readonly issues?: readonly StandardSchemaV1.Issue[],
  ) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export function authError(
  code: AuthErrorCode,
  message: string,
  cause: unknown,
): AuthError {
  return cause instanceof AuthError
    ? cause
    : new AuthError(code, message, { cause });
}

export function sessionChanged(): AuthError {
  return new AuthError(
    'SESSION_CHANGED',
    'The session changed during this operation',
  );
}
