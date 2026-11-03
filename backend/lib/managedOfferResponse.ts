import type { SupabaseClient } from '@supabase/supabase-js';

type Reply = { status: number; body: Record<string, unknown> };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function respondToManagedOffer(
  db: Pick<SupabaseClient, 'from' | 'rpc'>, jobId: string, proId: string, action: 'accept' | 'decline',
): Promise<Reply | null> {
  if (!uuid.test(jobId)) return { status: 400, body: { ok: false, error: 'A dispatch job UUID is required.', error_code: 'bad_request' } };
  const assignments = await db.from('h2s_dispatch_job_assignments').select('assign_id').eq('job_id', jobId.toLowerCase()).limit(101);
  if (assignments.error || !Array.isArray(assignments.data) || assignments.data.length > 100
    || assignments.data.some(row => !row || typeof row.assign_id !== 'string')) {
    console.error('Offer history could not be verified', { code: assignments.error?.code || 'INVALID_HISTORY' });
    return { status: 503, body: { ok: false, error: 'Assignment history requires verification.', error_code: 'assignment_unavailable', retryable: true } };
  }
  const marked = assignments.data.some(row => typeof row.assign_id === 'string' && row.assign_id.startsWith('h2s-management:'));
  const enrollment = marked || process.env.H2S_MANAGEMENT_ASSIGNMENTS_ENABLED === 'true'
    ? await db.from('h2s_management_assignment_requests').select('job_id').eq('job_id', jobId).limit(1)
    : { data: [], error: null };
  if (enrollment.error) {
    console.error('Managed offer enrollment unavailable', { code: enrollment.error.code });
    return { status: 503, body: { ok: false, error: 'Assignment history could not be verified. Retry later.', error_code: 'assignment_unavailable', retryable: true } };
  }
  if (!Array.isArray(enrollment.data) || marked && !enrollment.data.length) {
    console.error('Managed offer enrollment returned an invalid contract');
    return { status: 503, body: { ok: false, error: 'Assignment history could not be verified.', error_code: 'assignment_unavailable', retryable: true } };
  }
  if (!enrollment.data.length) {
    const job = await db.from('h2s_dispatch_jobs').select('job_id,status').eq('job_id', jobId).limit(1);
    if (job.error || !Array.isArray(job.data)) {
      console.error('Legacy offer job could not be verified', { code: job.error?.code || 'INVALID_RESULT' });
      return { status: 503, body: { ok: false, error: 'Job could not be verified.', error_code: 'assignment_unavailable', retryable: true } };
    }
    if (!job.data.length) return { status: 404, body: { ok: false, error: 'Job not found.', error_code: 'not_found' } };
    if (!['queued', 'assigned'].includes(job.data[0].status)) return {
      status: 409, body: { ok: false, error: 'Job is no longer available for an offer response.', error_code: 'assignment_conflict' },
    };
    return null;
  }
  if (!uuid.test(proId)) return { status: 403, body: { ok: false, error: 'A verified technician identity is required.', error_code: 'assignment_forbidden' } };
  const result = await db.rpc('h2s_management_respond_to_offer', { p_job_id: jobId, p_pro_id: proId, p_action: action });
  if (result.error) {
    const code = result.error.code;
    console.error('Managed offer response failed', { code, action });
    const conflict = ['23505', '23514', '22023', '40001', '40P01', '55P03'].includes(code);
    return { status: code === '42501' ? 403 : code === 'P0002' ? 404 : conflict ? 409 : 503,
      body: { ok: false, error: conflict ? 'Offer changed or conflicts with another assignment. Refresh before retrying.'
        : code === '42501' ? 'This offer belongs to another technician.'
          : code === 'P0002' ? 'Offer not found.' : 'Assignment response could not be confirmed. Retry safely.',
      error_code: conflict ? 'assignment_conflict' : 'assignment_unavailable',
      retryable: ['40001', '40P01', '55P03'].includes(code) || !conflict && !['42501', 'P0002'].includes(code) } };
  }
  const value: unknown = result.data;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('assignment' in value)
    || !('replayed' in value) || typeof value.replayed !== 'boolean'
    || !('job_status' in value) || typeof value.job_status !== 'string'
    || !value.assignment || typeof value.assignment !== 'object' || Array.isArray(value.assignment)
    || !('state' in value.assignment) || value.assignment.state !== (action === 'accept' ? 'accepted' : 'declined')
    || !('job_id' in value.assignment) || typeof value.assignment.job_id !== 'string' || value.assignment.job_id.toLowerCase() !== jobId.toLowerCase()
    || !('pro_id' in value.assignment) || typeof value.assignment.pro_id !== 'string' || value.assignment.pro_id.toLowerCase() !== proId.toLowerCase()
    || !('assign_id' in value.assignment) || typeof value.assignment.assign_id !== 'string' || !value.assignment.assign_id) {
    console.error('Managed offer response returned an invalid contract');
    return { status: 503, body: { ok: false, error: 'Assignment response requires verification.', error_code: 'assignment_unavailable', retryable: true } };
  }
  return { status: 200, body: { ok: true, created: false, ...value,
    is_team_job: false, team_confirmed: false,
    meta: { assignments_table: 'h2s_dispatch_job_assignments', assignments_pro_col: 'pro_id',
      assignments_job_col: 'job_id', assignments_state_col: 'state' } } };
}
