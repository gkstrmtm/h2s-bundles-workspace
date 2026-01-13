import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
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

    const { pro_id } = body;
    if (!pro_id) return NextResponse.json({ ok: false, error: 'Missing pro_id' }, { status: 400 });

    const sb: any = dispatchClient;
    
    // 1. Get Profile (Critical)
    const { data: pro, error: proError } = await sb.from('h2s_pros').select('*').eq('pro_id', pro_id).single();
    
    if (proError) {
        console.error('[admin_pro_details] Pro fetch error:', proError);
        return NextResponse.json({ ok: false, error: 'Pro not found or DB error: ' + proError.message }, { status: 404 });
    }

    // 2. Get Availability (Non-Critical)
    let availability = [];
    try {
        const mainSb = getSupabase(); // May throw if misconfigured
        if (mainSb) {
             const availRes = await mainSb
                .from('h2s_dispatch_pros_availability')
                .select('*')
                .eq('pro_id', pro_id)
                .order('date_local', { ascending: false })
                .limit(20);
             if (!availRes.error) {
                 availability = availRes.data || [];
             } else {
                 console.warn('[admin_pro_details] Availability fetch error:', availRes.error.message);
             }
        }
    } catch (e: any) {
        console.warn('[admin_pro_details] Availability skipped:', e.message);
    }

    // 3. Get Job Stats (Non-Critical)
    let jobs = [];
    try {
        const jobsRes = await sb
            .from('h2s_dispatch_jobs')
            .select('status, created_at')
            .eq('assigned_to', pro_id);
            
        if (!jobsRes.error) {
            jobs = jobsRes.data || [];
        } else {
             console.warn('[admin_pro_details] Jobs fetch error:', jobsRes.error.message);
        }
    } catch (e: any) {
        console.warn('[admin_pro_details] Jobs stats skipped:', e.message);
    }
    
    // Calculate Stats
    const totalJobs = jobs.length;
    const pendingJobs = jobs.filter((j: any) => j.status !== 'completed' && j.status !== 'cancelled').length;
    
    // Last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentJobs = jobs.filter((j: any) => new Date(j.created_at) > thirtyDaysAgo).length;

    return NextResponse.json({ 
        ok: true, 
        pro: pro,
        stats: {
            total_jobs: totalJobs,
            pending_jobs: pendingJobs,
            recent_jobs: recentJobs,
            completion_rate: totalJobs > 0 ? Math.round(((totalJobs - pendingJobs) / totalJobs) * 100) : 0
        },
        availability: availability,
        availability_source: 'main_db'
    }, { headers: corsHeaders(request) });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: corsHeaders(request) });
  }
}
