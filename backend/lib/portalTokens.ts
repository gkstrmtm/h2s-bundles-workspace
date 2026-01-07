import crypto from 'crypto';

type PortalRole = 'pro' | 'admin';

type PortalTokenPayload = {
  sub: string; // pro_id or admin identifier
  role: PortalRole;
  email?: string;
  iat: number;
  exp: number;
  legacy?: boolean;
};

function looksLikeUuid(input: string): boolean {
  const s = String(input || '').trim();
  // UUID v1-v5 format (case-insensitive)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const withPad = padded + '='.repeat(padLen);
  return Buffer.from(withPad, 'base64').toString('utf8');
}

function getSigningSecret(): string {
  const secret = process.env.PORTAL_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  
  console.log('[portalTokens] getSigningSecret called:', {
    hasPortalSecret: !!process.env.PORTAL_TOKEN_SECRET,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    usingSecret: secret ? secret.substring(0, 10) + '...' : 'NONE'
  });
  
  return secret;
}

export function issuePortalToken(params: { sub: string; role: PortalRole; email?: string; ttlSeconds?: number }): string {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error('Missing token signing secret (set PORTAL_TOKEN_SECRET or SUPABASE_SERVICE_KEY)');
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number.isFinite(params.ttlSeconds) ? (params.ttlSeconds as number) : 60 * 60 * 24 * 7; // 7 days

  const payload: PortalTokenPayload = {
    sub: params.sub,
    role: params.role,
    email: params.email,
    iat: now,
    exp: now + Math.max(60, ttlSeconds),
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);

  return `${payloadB64}.${sigB64}`;
}

export function verifyPortalToken(token: string): PortalTokenPayload {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error('Missing token signing secret (set PORTAL_TOKEN_SECRET or SUPABASE_SERVICE_KEY)');
  }

  const raw = String(token || '').trim();
  if (!raw) {
    throw new Error('Missing token');
  }

  // Backward compatibility: older portal deployments used an opaque UUID as the "token".
  // Treat it as the subject (pro_id) and allow the request to proceed.
  if (!raw.includes('.') && looksLikeUuid(raw)) {
    const now = Math.floor(Date.now() / 1000);
    return {
      sub: raw,
      role: 'pro',
      iat: now,
      exp: now + 60 * 60 * 24 * 7, // 7 days rolling
      legacy: true,
    };
  }

  const parts = raw.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid token format');
  }

  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const expectedSigB64 = base64UrlEncode(expectedSig);

  // Constant-time compare
  const a = Buffer.from(expectedSigB64);
  const b = Buffer.from(String(sigB64));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid token signature');
  }

  const payloadJson = base64UrlDecodeToString(payloadB64);
  const payload = JSON.parse(payloadJson) as PortalTokenPayload;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp) {
    throw new Error('Token expired');
  }

  if (!payload.sub || !payload.role) {
    throw new Error('Invalid token payload');
  }

  return payload;
}
