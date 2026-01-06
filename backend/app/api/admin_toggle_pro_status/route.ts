import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';

async function handle(request: Request, body: any) {
  const { pro_id, is_active } = body;

  if (!pro_id || typeof is_active !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'pro_id and is_active (boolean) required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const client = getSupabaseDispatch();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Database not configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: client as any });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, error_code: auth.error_code },
      { status: auth.status, headers: corsHeaders(request) }
    );
  }

  // Update Pro activation status
  const { error } = await client
    .from('h2s_pros')
    .update({ 
      is_active,
      updated_at: new Date().toISOString()
    })
    .eq('pro_id', pro_id);

  if (error) {
    console.error('[admin_toggle_pro_status] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return NextResponse.json(
    { 
      ok: true, 
      pro_id,
      is_active,
      message: `Pro ${is_active ? 'activated' : 'deactivated'} successfully`
    },
    { headers: corsHeaders(request) }
  );
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await handle(request, body);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
