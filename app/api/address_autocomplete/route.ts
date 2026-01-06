import { NextResponse } from 'next/server';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://portal.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = searchParams.get('input');

    if (!input || input.length < 3) {
      return NextResponse.json(
        { ok: true, predictions: [] },
        { headers: corsHeaders(request) }
      );
    }

    // TODO: Integrate with Google Places API or similar service
    // For now, return empty array to prevent errors
    return NextResponse.json(
      { 
        ok: true, 
        predictions: [],
        message: 'Address autocomplete not yet configured'
      },
      { headers: corsHeaders(request) }
    );

  } catch (err: any) {
    console.error('[address_autocomplete] Error:', err);
    return NextResponse.json(
      { 
        ok: false, 
        error: err?.message || 'Server error',
        predictions: []
      },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
