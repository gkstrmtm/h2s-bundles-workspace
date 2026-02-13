import { NextRequest } from 'next/server';

function normalizeToken(value: string | null) {
  return (value || '').trim();
}

export function getConfiguredAdminToken() {
  return (
    process.env.H2S_DASHBOARD_ADMIN_KEY ||
    process.env.H2S_ADMIN_TOKEN ||
    process.env.DASH_ADMIN_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  ).trim();
}

export function assertAdminIfConfigured(request: NextRequest) {
  const configured = getConfiguredAdminToken();
  if (!configured) return;

  const headerToken =
    normalizeToken(request.headers.get('x-h2s-admin-token')) ||
    normalizeToken(request.headers.get('x-h2s-admin-key'));

  if (!headerToken || headerToken !== configured) {
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }
}
