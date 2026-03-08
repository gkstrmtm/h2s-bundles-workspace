import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'h2s_hub_session';

function safeTrim(value: any): string {
  return String(value || '').trim();
}

function getJwtSecret(): Uint8Array | null {
  const raw = safeTrim(process.env.HUB_GATE_JWT_SECRET);
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function getExpectedPin(): string {
  return safeTrim(process.env.HUB_GATE_PIN || process.env.HUB_GATE_KEY || '');
}

function isGateEnabled(): boolean {
  return !!getExpectedPin();
}

export async function assertHubAuthIfEnabled(request: NextRequest) {
  // If the gate isn't configured, treat as open.
  if (!isGateEnabled()) return;

  const secret = getJwtSecret();
  if (!secret) {
    const err = new Error('Hub gate not configured');
    (err as any).statusCode = 503;
    throw err;
  }

  const token = safeTrim(request.cookies.get(COOKIE_NAME)?.value);
  if (!token) {
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }

  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
  } catch {
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }
}
