import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDashboardCapability } from '@/lib/dashboardPermissions';

export class ManagementAssignmentError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryable = false) { super(message); }
}
export const managementAssignmentsEnabled = () => process.env.H2S_MANAGEMENT_ASSIGNMENTS_ENABLED === 'true';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function assignmentId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) {
    throw new ManagementAssignmentError('A valid record UUID is required.', 400, 'INVALID_INPUT');
  }
  return value.toLowerCase();
}
function databaseError(error: { code?: string }) {
  console.error('Management assignment database operation failed', { code: error.code || 'UNKNOWN' });
  if (error.code === '42501') return new ManagementAssignmentError('Management assignments are disabled or unavailable.', 503, 'ASSIGNMENTS_DISABLED');
  if (error.code === 'P0002') return new ManagementAssignmentError('Job not found.', 404, 'JOB_NOT_FOUND');
  if (error.code === '23505') return new ManagementAssignmentError('An offer already exists, or this request key was used for different input. Refresh and review.', 409, 'ASSIGNMENT_CONFLICT');
  if (error.code === '40001') return new ManagementAssignmentError('Job changed. Reload and review. If retrying an uncertain result, reuse the same request.', 409, 'STALE_REVIEW', true);
  if (error.code === '22023' || error.code === '23514') return new ManagementAssignmentError('Job or technician is ineligible. Refresh the review and reconcile existing assignments.', 409, 'INELIGIBLE_ASSIGNMENT');
  return new ManagementAssignmentError('Assignment could not be verified. Retry the identical request; do not create a new request key.', 503, 'ASSIGNMENT_UNAVAILABLE', true);
}
export async function assignmentRead(db: Pick<SupabaseClient, 'rpc'>, jobId: string) {
  if (!managementAssignmentsEnabled()) return { enabled: false };
  const { data, error } = await db.rpc('h2s_management_assignment_preview', { p_job_id: assignmentId(jobId) });
  if (error) throw databaseError(error);
  if (!data || typeof data.enabled !== 'boolean') throw databaseError({ code: 'INVALID_RESPONSE' });
  return data;
}

// Authentication and the default-off gate are part of the reusable operation,
// not a responsibility delegated to the browser or a particular route.
export async function assignManagementTechnician(request: Request, db: Pick<SupabaseClient, 'rpc'>, input: unknown) {
  const actor = await requireDashboardCapability(request, 'operations.assign');
  if (!managementAssignmentsEnabled()) throw new ManagementAssignmentError('Management assignment writes are disabled.', 503, 'ASSIGNMENTS_DISABLED');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ManagementAssignmentError('An assignment review is required.', 400, 'INVALID_INPUT');
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['jobId', 'proId', 'operationId', 'context', 'note'].includes(key))
    || typeof value.context !== 'string' || !/^[a-f0-9]{32}$/.test(value.context)
    || typeof value.note !== 'string' || !value.note.trim() || value.note.length > 2000) {
    throw new ManagementAssignmentError('Review the job and enter an assignment note (up to 2000 characters).', 400, 'INVALID_INPUT');
  }
  const args = { p_job_id: assignmentId(value.jobId), p_pro_id: assignmentId(value.proId),
    p_operation_id: assignmentId(value.operationId), p_actor_user_id: actor.userId, p_context: value.context, p_note: value.note.trim() };
  try {
    const { data, error } = await db.rpc('h2s_management_assign_technician', args);
    if (error) throw databaseError(error);
    if (!data || data.operationId !== args.p_operation_id || data.jobId !== args.p_job_id
      || data.proId !== args.p_pro_id || data.requiresAcceptance !== true || data.state !== 'pending') {
      throw databaseError({ code: 'INVALID_RESPONSE' });
    }
    return data;
  } catch (error) {
    if (error instanceof ManagementAssignmentError) throw error;
    throw databaseError({ code: 'TRANSPORT_FAILURE' });
  }
}
