// Errors whose message was written for the person using Orbis. Anything else is
// treated as an internal detail: it is logged on the server and the user sees a
// calm fallback instead.

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError && error.message) return error.message;
  console.error(error);
  return fallback;
}
