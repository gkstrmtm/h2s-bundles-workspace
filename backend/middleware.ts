import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function parseEnvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin: string): boolean {
  return (
    /^http:\/\/localhost(?::\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)
  );
}

function isHome2SmartOrigin(origin: string): boolean {
  if (!/^https:\/\//i.test(origin)) return false;
  try {
    const u = new URL(origin);
    const host = (u.hostname || '').toLowerCase();
    if (host === 'home2smart.com' || host === 'www.home2smart.com') return true;
    return host.endsWith('.home2smart.com');
  } catch {
    return false;
  }
}

function isGoHighLevelOrigin(origin: string): boolean {
  if (!/^https:\/\//i.test(origin)) return false;
  try {
    const u = new URL(origin);
    const host = (u.hostname || '').toLowerCase();

    // GoHighLevel commonly serves embedded/custom-code pages from these domains.
    // Keep this list tight and HTTPS-only.
    const allowedSuffixes = [
      '.gohighlevel.com',
      '.leadconnectorhq.com',
      '.gohighlevel.io',
      '.gohighlevel.app',
      '.gohighlevelclient.com',
    ];

    return allowedSuffixes.some((s) => host === s.slice(1) || host.endsWith(s));
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.trim();

  // Safe defaults: main site + any subdomain + local dev.
  if (isHome2SmartOrigin(normalized) || isGoHighLevelOrigin(normalized) || isLocalhostOrigin(normalized)) return true;

  // Optional allowlist for additional hosting domains (e.g., GoHollow), comma-separated.
  // Example: H2S_CORS_ALLOWED_ORIGINS=https://your-gohollow-domain.com,https://another-domain.com
  const extraAllowed = parseEnvList(process.env.H2S_CORS_ALLOWED_ORIGINS);
  if (extraAllowed.includes(normalized)) return true;

  // Optional suffix allowlist (supports "*.example.com" or ".example.com" style entries)
  // Example: H2S_CORS_ALLOWED_ORIGIN_SUFFIXES=.gohollow.com,.gohollow.app
  const suffixes = parseEnvList(process.env.H2S_CORS_ALLOWED_ORIGIN_SUFFIXES).map((s) =>
    s.startsWith('.') ? s.toLowerCase() : `.${s.toLowerCase()}`
  );
  if (suffixes.length) {
    try {
      const u = new URL(normalized);
      const host = (u.hostname || '').toLowerCase();
      if (suffixes.some((s) => host === s.slice(1) || host.endsWith(s))) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const o = (origin || '').trim();
  const allowed = o && isAllowedOrigin(o);

  // If there is no Origin header (server-to-server), CORS is irrelevant; keep permissive.
  // If Origin exists but isn't allowed, we still return '*' (non-credential) to avoid random UI breakage.
  const allowOrigin = allowed ? o : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    // Prevent CDN/proxy from reusing a response across origins.
    Vary: 'Origin',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function middleware(req: NextRequest) {
  const cors = buildCorsHeaders(req.headers.get('origin'));

  // Preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const res = NextResponse.next();

  for (const [k, v] of Object.entries(cors)) {
    res.headers.set(k, v);
  }

  // Prevent any caching of API responses. This avoids edge/CDN caches reusing
  // a response across different Origins (home2smart.com vs www), which can
  // surface as "same endpoint behaves differently" in browsers.
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('CDN-Cache-Control', 'no-store');
  res.headers.set('Vercel-CDN-Cache-Control', 'no-store');

  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
