import { verifyPortalToken } from '@/lib/portalTokens';

export type AdminAuthResult =
  | { ok: true; adminEmail: string; mode: 'signed' | 'legacy_session' }
  | { ok: false; status: number; error: string; error_code: string };

export function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function pickTokenFrom(req: Request, body?: any): string {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token') || url.searchParams.get('admin_token') || '';
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const bodyToken = String(body?.token || body?.admin_token || '').trim();
  return String(queryToken || bodyToken || headerToken || '').trim();
}

async function validateLegacyAdminSession(client: any, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await client
      .from('h2s_admin_sessions')
      .select('email')
      .eq('session_id', token)
      .single();
    if (error || !data) return null;
    return data.email ? String(data.email) : null;
  } catch {
    return null;
  }
}

export async function requireAdmin(params: {
  request: Request;
  body?: any;
  supabaseClient: any;
}): Promise<AdminAuthResult> {
  const token = pickTokenFrom(params.request, params.body);

  if (!token) {
    return { ok: false, status: 401, error: 'Missing token', error_code: 'bad_session' };
  }

  // Optional fixed admin token (useful for internal dispatch dashboards).
  // If set, the request is authorized when the provided token matches exactly.
  const fixedAdminToken =
    String(process.env.DISPATCH_ADMIN_TOKEN || process.env.PORTAL_ADMIN_TOKEN || process.env.H2S_ADMIN_TOKEN || '').trim();
  if (fixedAdminToken && token === fixedAdminToken) {
    const adminEmail = String(process.env.PORTAL_ADMIN_EMAIL || 'dispatch@h2s.com').trim().toLowerCase();
    return { ok: true, adminEmail, mode: 'legacy_session' };
  }

  // Signed portal token
  try {
    const payload = verifyPortalToken(token);
    if (payload.role !== 'admin') {
      return { ok: false, status: 401, error: 'Admin access required', error_code: 'unauthorized' };
    }
    const adminEmail = String(payload.email || payload.sub || '').trim();
    if (!adminEmail) {
      return { ok: false, status: 401, error: 'Invalid admin token', error_code: 'bad_session' };
    }
    return { ok: true, adminEmail, mode: 'signed' };
  } catch {
    // Not a signed token; try legacy session token.
  }

  const legacyEmail = await validateLegacyAdminSession(params.supabaseClient, token);
  if (!legacyEmail) {
    return { ok: false, status: 401, error: 'Admin session invalid', error_code: 'bad_session' };
  }

  return { ok: true, adminEmail: legacyEmail, mode: 'legacy_session' };
}
