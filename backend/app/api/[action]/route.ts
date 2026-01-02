import { NextResponse } from 'next/server';
import * as customerPhotos from '../customer_photos/route';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request, context?: { params: Promise<{ action: string }> }) {
  try {
    const action = context?.params ? (await context.params).action : '';
    if (action === 'customer_photos') return customerPhotos.OPTIONS(request);
  } catch (_) {}
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function notImplemented(request: Request, action: string) {
  // IMPORTANT: return JSON even for missing endpoints so clients calling `res.json()` don't crash.
  return NextResponse.json(
    {
      ok: false,
      error: `Endpoint /api/${action} is not implemented on this deployment`,
      error_code: 'NOT_IMPLEMENTED',
      action,
      hint: 'Deployed backend uses /api/v1?action=... for implemented actions. Add a dedicated route or implement an action handler for portal_* endpoints.',
    },
    { status: 501, headers: corsHeaders(request) }
  );
}

export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;

  if (action === 'customer_photos') {
    return customerPhotos.GET(request);
  }

  // Avoid shadowing existing routed endpoints if someone hits /api/v1 via dynamic routing.
  if (action === 'v1') {
    return NextResponse.json(
      { ok: false, error: 'Use /api/v1 directly (this fallback should not be hit).' },
      { status: 404, headers: corsHeaders(request) }
    );
  }

  return notImplemented(request, action);
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;

  if (action === 'customer_photos') {
    return customerPhotos.POST(request);
  }

  if (action === 'v1') {
    return NextResponse.json(
      { ok: false, error: 'Use /api/v1 directly (this fallback should not be hit).' },
      { status: 404, headers: corsHeaders(request) }
    );
  }

  return notImplemented(request, action);
}

export async function DELETE(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;

  if (action === 'customer_photos') {
    return customerPhotos.DELETE(request);
  }

  return notImplemented(request, action);
}
