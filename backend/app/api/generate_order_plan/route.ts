import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { addAuditEntry } from '@/lib/jobHelpers';

function determineKitType(job: any, metadata: any): string {
  const serviceName = (job.service_name || '').toLowerCase();
  
  if (serviceName.includes('tv') || serviceName.includes('mount')) {
    return metadata.wire_management_required === 'FULL_INWALL'
      ? 'PREMIUM_TV_KIT'
      : 'STANDARD_TV_KIT';
  }
  if (serviceName.includes('camera') || serviceName.includes('security')) {
    return 'STANDARD_CAMERA_KIT';
  }
  if (serviceName.includes('soundbar') || serviceName.includes('audio')) {
    return 'AUDIO_KIT';
  }
  return 'CUSTOM_KIT';
}

async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'job_id is required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';

  try {
    const { data: job, error } = await sb.from(jobsTable).select('*').eq('job_id', jobId).single();
    if (error) throw error;

    let metadata = job?.metadata || {};
    const items = metadata.items_json || [];

    // Generate order plan based on items
    const components = [];
    let total = 0;

    for (const item of items) {
      if (item.metadata?.mount_type && item.metadata?.mount_type !== 'customer_provided') {
        const mountCostMap: Record<string, number> = {
          'fixed': 3500,
          'tilt': 5000,
          'full_motion': 8500,
          'ceiling': 7500
        };
        const mountCost = mountCostMap[item.metadata.mount_type] || 3500;

        components.push({
          sku: `MOUNT-${item.metadata.mount_type.toUpperCase()}-${item.metadata.tv_size || 'STANDARD'}`,
          name: `${item.metadata.mount_type.replace('_', ' ')} mount${item.metadata.tv_size ? ` for ${item.metadata.tv_size}" TV` : ''}`,
          quantity: item.quantity || 1,
          unit_cost: mountCost,
          vendor: 'Amazon',
          reason: `Mount for ${item.service_name || 'service'}`
        });

        total += mountCost * (item.quantity || 1);
      }
    }

    // Add wire management components
    if (metadata.wire_management_required === 'CONCEAL_RACEWAY') {
      components.push({
        sku: 'RACEWAY-KIT-STD',
        name: 'Raceway concealment kit',
        quantity: 1,
        unit_cost: 2500,
        vendor: 'Internal Stock',
        reason: 'Wire concealment via raceway'
      });
      total += 2500;
    } else if (metadata.wire_management_required === 'FULL_INWALL') {
      components.push({
        sku: 'INWALL-KIT-PRO',
        name: 'In-wall wire fishing kit',
        quantity: 1,
        unit_cost: 4500,
        vendor: 'Internal Stock',
        reason: 'Full in-wall wire routing'
      });
      total += 4500;
    }

    const orderPlan = {
      kit_type: determineKitType(job, metadata),
      components,
      total_cost_estimate: total,
      vendor: components[0]?.vendor || 'TBD',
      notes: `Auto-generated for ${job.service_name || 'service'}`,
      created_at: new Date().toISOString(),
      created_by: 'system'
    };

    // Add audit entry
    metadata = addAuditEntry(metadata, {
      user_id: body.admin_user || 'system',
      user_name: body.admin_name || 'System',
      action: 'order_plan_generated',
      notes: `Generated order plan: ${orderPlan.kit_type}, ${components.length} components, $${(total / 100).toFixed(2)} estimate`
    });

    metadata.order_plan = orderPlan;
    metadata.order_stage = 'READY_TO_ORDER';

    // Update job
    await sb.from(jobsTable).update({
      metadata: metadata,
      updated_at: new Date().toISOString()
    }).eq('job_id', jobId);

    return NextResponse.json({ ok: true, order_plan: orderPlan }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await handle(request, body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
