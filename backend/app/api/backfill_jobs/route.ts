import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

function corsHeaders(request?: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function estimatePayout(order: any): number | null {
  const subtotal = Number(order?.subtotal ?? order?.order_subtotal ?? order?.total ?? 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0) return null;
  let payout = Math.floor(subtotal * 0.35);
  const svc = String(order?.service_name || order?.service_id || '').toLowerCase();
  if (payout < 45 && svc.includes('mount')) payout = 45;
  const MIN = 35;
  const MAX_PCT = 0.45;
  payout = Math.max(MIN, payout);
  payout = Math.min(payout, subtotal * MAX_PCT);
  return Math.round(payout * 100) / 100;
}

async function handle(request: Request, isDryRun: boolean = false) {
  const main = getSupabase();
  const dispatch = getSupabaseDispatch() || main;

  if (!main) {
    return NextResponse.json(
      { ok: false, error: 'Database not available' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const limit = 200;
  const { data: jobs, error: jobsError } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (jobsError) {
    return NextResponse.json(
      { ok: false, error: jobsError.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json(
      { ok: true, message: 'No jobs found', total: 0, updated: 0, skipped: 0, errors: 0 },
      { headers: corsHeaders(request) }
    );
  }

  const log: string[] = [];
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    const jobId = job.job_id;
    const orderId = job.order_id;

    const hasPayout = job.metadata?.estimated_payout && job.metadata.estimated_payout > 0;
    const hasItems = job.metadata?.items_json && Array.isArray(job.metadata.items_json) && job.metadata.items_json.length > 0;

    if (hasPayout && hasItems) {
      log.push(`✓ Skip: Job ${jobId} - already complete (payout: $${job.metadata.estimated_payout}, items: ${job.metadata.items_json.length})`);
      skipped++;
      continue;
    }

    log.push(`→ Process: Job ${jobId} (order: ${orderId})`);

    // Fetch the order
    let order: any = null;
    if (orderId) {
      try {
        const { data: orderData } = await main
          .from('h2s_orders')
          .select('*')
          .eq('order_id', orderId)
          .maybeSingle();
        
        if (orderData) {
          order = orderData;
        } else {
          const { data: orderById } = await main
            .from('h2s_orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();
          order = orderById;
        }
        
        if (!order && job.metadata?.session_id) {
          const { data: orderBySession } = await main
            .from('h2s_orders')
            .select('*')
            .eq('session_id', job.metadata.session_id)
            .maybeSingle();
          order = orderBySession;
        }
      } catch (e: any) {
        log.push(`  ⚠ Warning: Could not fetch order ${orderId}: ${e.message}`);
      }
    }

    if (!order) {
      log.push(`  ✗ Skip: No matching order found`);
      skipped++;
      continue;
    }

    log.push(`  ✓ Found order: ${order.order_id || order.id} (subtotal: $${order.subtotal || order.total || 0})`);

    const currentMeta = job.metadata || {};
    const updatedMeta = { ...currentMeta };
    let hasChanges = false;

    // Add payout if missing
    if (!hasPayout) {
      const calculatedPayout = estimatePayout(order);
      if (calculatedPayout) {
        updatedMeta.estimated_payout = calculatedPayout;
        log.push(`  + Adding payout: $${calculatedPayout}`);
        hasChanges = true;
      }
    }

    // Add items if missing
    if (!hasItems) {
      let itemsJson: any = null;
      let orderMeta: any = {};
      try {
        orderMeta = typeof order.metadata_json === 'string' 
          ? JSON.parse(order.metadata_json) 
          : order.metadata_json || {};
        
        const itemsRaw = order?.items || orderMeta?.items_json || orderMeta?.items || orderMeta?.cart_items_parsed || orderMeta?.cart_items;
        
        if (itemsRaw) {
          if (typeof itemsRaw === 'string') {
            itemsJson = JSON.parse(itemsRaw);
          } else if (Array.isArray(itemsRaw)) {
            itemsJson = itemsRaw;
          } else if (typeof itemsRaw === 'object' && (itemsRaw as any).items) {
            itemsJson = (itemsRaw as any).items;
          }
        }
      } catch (e: any) {
        log.push(`  ⚠ Warning: Could not parse items: ${e.message}`);
      }

      if (itemsJson && Array.isArray(itemsJson) && itemsJson.length > 0) {
        updatedMeta.items_json = itemsJson;
        const itemNames = itemsJson.map((i: any) => `${i.qty || 1}x ${i.service_name || i.name || 'item'}`).join(', ');
        log.push(`  + Adding ${itemsJson.length} items: ${itemNames}`);
        hasChanges = true;
      }
      
      // 🔧 ENRICHMENT: Add order context metadata if missing (use orderMeta from above)
      if (!updatedMeta.order_subtotal && order.subtotal) {
        updatedMeta.order_subtotal = order.subtotal;
        log.push(`  + Adding order subtotal: $${order.subtotal}`);
        hasChanges = true;
      }
      
      if (!updatedMeta.order_total && order.total) {
        updatedMeta.order_total = order.total;
        log.push(`  + Adding order total: $${order.total}`);
        hasChanges = true;
      }
      
      if (!updatedMeta.referral_code && orderMeta?.referral_code) {
        updatedMeta.referral_code = orderMeta.referral_code;
        if (orderMeta.referrer_email) {
          updatedMeta.referrer_email = orderMeta.referrer_email;
        }
        log.push(`  + Adding referral code: ${orderMeta.referral_code}`);
        hasChanges = true;
      }
      
      if (!updatedMeta.customer_notes) {
        const notes = orderMeta?.customer_notes || orderMeta?.notes || orderMeta?.special_instructions;
        if (notes) {
          updatedMeta.customer_notes = notes;
          log.push(`  + Adding customer notes`);
          hasChanges = true;
        }
      }
    }

    if (!hasChanges) {
      log.push(`  → No changes needed`);
      skipped++;
      continue;
    }

    // Update the job
    if (isDryRun) {
      log.push(`  [DRY RUN] Would update job ${jobId}`);
      updated++;
    } else {
      try {
        const updatePayload: any = { metadata: updatedMeta };
        // ✅ Update payout_estimated column if we computed a new payout
        if (updatedMeta.estimated_payout && updatedMeta.estimated_payout > 0) {
          updatePayload.payout_estimated = updatedMeta.estimated_payout;
        }
        
        const { error: updateError } = await dispatch
          .from('h2s_dispatch_jobs')
          .update(updatePayload)
          .eq('job_id', jobId);

        if (updateError) {
          log.push(`  ✗ ERROR: Failed to update: ${updateError.message}`);
          errors++;
        } else {
          log.push(`  ✓ Success: Job ${jobId} updated`);
          updated++;
        }
      } catch (e: any) {
        log.push(`  ✗ ERROR: Exception: ${e.message}`);
        errors++;
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      mode: isDryRun ? 'dry_run' : 'live',
      total: jobs.length,
      updated,
      skipped,
      errors,
      log,
    },
    { headers: corsHeaders(request) }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get('dry_run') === 'true';
  return await handle(request, isDryRun);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const isDryRun = body?.dry_run === true;
    return await handle(request, isDryRun);
  } catch {
    return await handle(request, false);
  }
}
