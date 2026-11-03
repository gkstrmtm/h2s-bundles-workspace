import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { DashboardPermissionError, requireDashboardCapability } from '@/lib/dashboardPermissions';
import { ManagementReadError } from '@/lib/managementOperations';
import { planningFilters, readManagementPlanning } from '@/lib/managementPlanning';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function OPTIONS(request: Request) {
  return Response.json({}, { headers: corsHeaders(request) });
}
export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' };
  try {
    const actor = await requireDashboardCapability(request, 'operations.read');
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (!['view', 'filter', 'offset', 'limit'].includes(key) || query.getAll(key).length !== 1) {
      return Response.json({ ok: false, error: 'Unsupported or repeated planning parameter.' }, { status: 400, headers });
    }
    const view = query.get('view') || 'schedule', filter = query.get('filter') || 'all';
    const rawOffset = query.get('offset') ?? '0', rawLimit = query.get('limit') ?? '25';
    if ((view !== 'schedule' && view !== 'reconciliation') || !planningFilters[view].some(value => value === filter)
      || !/^\d+$/.test(rawOffset) || !/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawOffset))
      || Number(rawOffset) > 10000 || Number(rawLimit) < 1 || Number(rawLimit) > 25) {
      return Response.json({ ok: false, error: 'Use a supported view/filter, offset 0-10000 and limit 1-25.' }, { status: 400, headers });
    }
    const result = await readManagementPlanning(getSupabase(), { view, filter, offset: Number(rawOffset), limit: Number(rawLimit) });
    return Response.json({ ok: true, reviewOwnerId: actor.userId, ...result }, { headers });
  } catch (error) {
    if (error instanceof DashboardPermissionError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers });
    console.error('Management planning read failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return Response.json({ ok: false, error: error instanceof ManagementReadError ? error.message : 'Planning evidence could not be loaded. No records were changed.' },
      { status: 503, headers });
  }
}
