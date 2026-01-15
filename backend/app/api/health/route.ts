/**
 * Health/proof endpoint - shows what's actually deployed.
 * NO SECRETS. Just build ID, env name, and config state.
 */

import { NextResponse } from 'next/server';
import { getConfig, isTokenSecretConfigured } from '@/lib/config';

// Prevent caching
export const dynamic = 'force-dynamic';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET() {
  try {
    const config = getConfig();
    
    return NextResponse.json({
      ok: true,
      build_id: config.buildId,
      env_name: config.nodeEnv,
      supabase_host: config.supabaseHost,
      token_secret_present: isTokenSecretConfigured(),
      timestamp: new Date().toISOString()
    }, { 
      headers: corsHeaders() 
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: 'Configuration error',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { 
      status: 500,
      headers: corsHeaders() 
    });
  }
}
