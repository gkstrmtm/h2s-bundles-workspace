import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { DashboardPermissionError, requireDashboardCapability } from '@/lib/dashboardPermissions';
import { assignmentId, assignmentRead, assignManagementTechnician, managementAssignmentsEnabled,
  ManagementAssignmentError } from '@/lib/managementAssignments';

export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function database() {
  const db = getSupabaseDispatch();
  if (!db) throw new ManagementAssignmentError('Dispatch database is unavailable.', 503, 'ASSIGNMENT_UNAVAILABLE', true);
  return db;
}
function failure(request: Request, error: unknown) {
  if (error instanceof DashboardPermissionError || error instanceof ManagementAssignmentError) {
    return Response.json({ ok: false, error: error.message,
      code: error instanceof ManagementAssignmentError ? error.code : 'ACCESS_DENIED',
      retryable: error instanceof ManagementAssignmentError && error.retryable }, { status: error.status, headers: headers(request) });
  }
  console.error('Management assignment request unavailable');
  return Response.json({ ok: false, error: 'Assignment service unavailable. Retry the identical request.',
    code: 'ASSIGNMENT_UNAVAILABLE', retryable: true }, { status: 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    await requireDashboardCapability(request, 'operations.assign');
    if (!managementAssignmentsEnabled()) return Response.json({ ok: true, enabled: false }, { headers: headers(request) });
    const query = new URL(request.url).searchParams;
    if (Array.from(query.keys()).some(key => key !== 'jobId')) throw new ManagementAssignmentError('Unsupported parameter.', 400, 'INVALID_INPUT');
    return Response.json({ ok: true, ...await assignmentRead(database(), assignmentId(query.get('jobId'))) }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    await requireDashboardCapability(request, 'operations.assign');
    if (!managementAssignmentsEnabled()) throw new ManagementAssignmentError('Management assignment writes are disabled.', 503, 'ASSIGNMENTS_DISABLED');
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      throw new ManagementAssignmentError('Use a JSON assignment review.', 400, 'INVALID_INPUT');
    }
    const raw = await request.text();
    if (raw.length > 8000) throw new ManagementAssignmentError('Assignment review is too large.', 400, 'INVALID_INPUT');
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new ManagementAssignmentError('Invalid assignment JSON.', 400, 'INVALID_INPUT'); }
    return Response.json({ ok: true, assignment: await assignManagementTechnician(request, database(), input) }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
