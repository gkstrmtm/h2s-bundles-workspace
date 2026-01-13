import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const dispatchClient = getSupabaseDispatch();
    
    if (!dispatchClient) {
      throw new Error('Dispatch DB not configured');
    }

    const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
    if (!auth.ok) {
        return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
    }

    const { pro_id, confirm } = body;
    if (!pro_id) return NextResponse.json({ ok: false, error: 'Missing pro_id' }, { status: 400 });

    const sb: any = dispatchClient;

    // Soft delete (deactivate)
    const { error } = await sb
        .from('h2s_pros')
        .update({ 
            is_active: false, 
            status: 'archived',
            updated_at: new Date().toISOString()
        })
        .eq('pro_id', pro_id);

    if (error) throw error;

    return NextResponse.json({ 
        ok: true, 
        message: 'Pro deactivated/archived successfully' 
    }, { headers: corsHeaders(request) });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: corsHeaders(request) });
  }
}
