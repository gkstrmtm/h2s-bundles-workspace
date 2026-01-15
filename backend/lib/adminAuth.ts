// Admin auth - no need for portal token verification
export type AdminAuthResult =
  | { ok: true; adminEmail: string; mode: 'signed' | 'legacy_session' }
  | { ok: false; status: number; error: string; error_code: string };

export function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  
  // Allow all localhost/127.0.0.1 origins for development (Live Preview, local dev servers, etc.)
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('0.0.0.0');
  
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://h2s-bundles-frontend-ayoqyg92t-tabari-ropers-projects-6f2e090b.vercel.app',
    'https://h2s-bundles-frontend.vercel.app',
  ];

  const allowOrigin = allowedOrigins.includes(origin) || isLocalhost ? origin : '*';

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

  // Try legacy session token for admin auth
  const legacyEmail = await validateLegacyAdminSession(params.supabaseClient, token);
  if (!legacyEmail) {
    return { ok: false, status: 401, error: 'Admin session invalid', error_code: 'bad_session' };
  }

  return { ok: true, adminEmail: legacyEmail, mode: 'legacy_session' };
}
