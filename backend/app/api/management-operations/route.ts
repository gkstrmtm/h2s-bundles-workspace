import Stripe from 'stripe';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { DashboardPermissionError, requireDashboardCapability } from '@/lib/dashboardPermissions';
import { ManagementReadError, readManagementOperations } from '@/lib/managementOperations';
import { verifyCommercialPayment } from '@/lib/commercial_payment';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function OPTIONS(request: Request) {
  return Response.json({}, { headers: corsHeaders(request) });
}
export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' };
  try {
    await requireDashboardCapability(request, 'operations.read');
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (!['offset', 'limit'].includes(key)) {
      return Response.json({ ok: false, error: 'Unsupported management read parameter.' }, { status: 400, headers });
    }
    const rawOffset = query.get('offset') ?? '0', rawLimit = query.get('limit') ?? '25';
    const offset = Number(rawOffset), limit = Number(rawLimit);
    if (!/^\d+$/.test(rawOffset) || !/^\d+$/.test(rawLimit)
      || !Number.isSafeInteger(offset) || offset > 10000 || limit < 1 || limit > 25) {
      return Response.json({ ok: false, error: 'Use offset 0-10000 and limit 1-25.' }, { status: 400, headers });
    }
    const stripe = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 4000, maxNetworkRetries: 0 }) : null;
    const result = await readManagementOperations(getSupabase(), {
      offset, limit, verifyPayment: order => verifyCommercialPayment(order, stripe),
    });
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    if (error instanceof DashboardPermissionError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status, headers });
    }
    console.error('Management operations read failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return Response.json({ ok: false, error: error instanceof ManagementReadError
      ? error.message : 'Operations could not be loaded. Retry this read; no operational records were changed.' },
    { status: 503, headers });
  }
}
