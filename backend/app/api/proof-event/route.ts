import { NextResponse } from 'next/server';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

// Public, funnel-safe endpoint.
// The bundles frontend uses this for lightweight impression logging.
// We intentionally no-op on the server for now (tracking is handled elsewhere).
export async function POST() {
  return NextResponse.json({ ok: true }, { headers: corsHeaders() });
}
