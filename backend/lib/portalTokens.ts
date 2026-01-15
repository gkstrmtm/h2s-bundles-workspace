/**
 * LEGACY WRAPPER - DO NOT USE IN NEW CODE
 * This exists only for backwards compatibility with old routes.
 * Use @/lib/auth directly in new code.
 */

import { verifyPortalToken as verifyNew, issuePortalToken as issueNew } from './auth';

export function verifyPortalToken(token: string) {
  // Old code expects synchronous, but new is async
  // This is a hack - old code needs to be updated
  throw new Error('verifyPortalToken must be called with await - use async version from @/lib/auth');
}

export async function issuePortalToken(payload: { sub: string; role: string; email: string; zip: string }): Promise<string> {
  return issueNew({
    proId: payload.sub,
    email: payload.email,
    zip: payload.zip
  });
}
