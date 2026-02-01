import { NextResponse } from 'next/server';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint is deprecated. Use /api/reviews instead.',
    },
    {
      status: 410,
      headers: {
        ...corsHeaders(),
        'Cache-Control': 'no-store',
      },
    },
  );
}

