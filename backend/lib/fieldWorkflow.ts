import { getSupabase } from '@/lib/supabase';
import { salesActor, salesAccess, salesChecked, BusinessError, identifier, text } from '@/lib/fieldSales';

export const workflowEnabled = () => process.env.H2S_FIELD_WORKFLOW_ENABLED === 'true';
export function requireWorkflow() {
  if (!workflowEnabled()) throw new BusinessError('Field Sales workflow is disabled. No installation or collection was activated.', 503);
  const main = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const dispatch = process.env.SUPABASE_URL_DISPATCH?.trim().replace(/\/$/, '');
  if (dispatch && main && dispatch !== main) throw new BusinessError('Enrolled installations require verified co-located order, calendar and technician authorities.', 503);
}
export async function workflowActor(request: Request) {
  const actor = await salesActor(request);
  requireWorkflow();
  await salesAccess(actor.userId);
  return actor;
}
export type WorkflowExpense = { category: 'equipment' | 'materials' | 'wages'; amountCents: number; unitCents: number;
  quantity: number; hours?: number; evidence: Record<string, unknown>; actual: true; zeroCostAttestation?: string };
export type WorkflowProof = { jobId: string; quoteId: string; leadId: string; orderId: string;
  photoCount: number; signatureCount: number; complete: boolean; missing: string[]; requirementsHash: string;
  candidates?: Array<{ artifactId: string; type: 'photo' | 'signature'; createdAt: string }>;
  requirements: Array<{ serviceId: string; id: string; label: string; type: 'photo' | 'signature' | 'checklist';
    minimumCount: number; artifactIds: string[]; affirmed: boolean; evidence?: Record<string, unknown> | null;
    complete: boolean; missingCount: number }> };
export type Workflow = { quoteId: string; leadId: string; orderId: string | null; revision: number;
  state: 'enrolled' | 'scheduled' | 'completed' | 'cancelled' | 'refund_review'; representativeId: string;
  totalCents: number; netPaidCents: number; depositCents: number; balanceCents: number; completedAt: string | null;
  processingFeeCents: number | null; expenses: WorkflowExpense[]; jobId: string | null; technicianId: string | null;
  acceptedAt: string | null; cancellationDeadline: string | null;
  proof: WorkflowProof | null; holds: string[];
  gates: { canSchedule: boolean; canAssign: boolean; canBalance: boolean; canDeposit: boolean; canComplete: boolean } };
export type WorkflowRead = { policies: Array<Record<string, unknown>>; workflows: Workflow[]; nextActions: string[] };
export class InstallationHoldError extends BusinessError {
  constructor(message: string, public readonly code: 'INSTALLATION_CANCELLATION_HOLD' | 'INSTALLATION_NOT_READY',
    public readonly earliestSchedulingAt: string | null = null) {
    super(message, 409);
  }
}
export async function workflowRead(actor: string, leadId: string | null, quoteId: string | null): Promise<WorkflowRead> {
  return salesChecked(await getSupabase().rpc('field_sales_workflow_read', { p_actor: actor, p_lead: leadId, p_quote: quoteId })) as WorkflowRead;
}
const common = ['action', 'operationId', 'leadId', 'quoteId', 'revision'];
const fields: Record<string, string[]> = {
  policy_create: ['policyId', 'kind', 'definition'], policy_update: ['policyId', 'definition', 'expectedDefinitionHash'],
  policy_approve: ['policyId', 'evidence', 'expectedDefinitionHash'], policy_retire: ['policyId'], policy_delete_draft: ['policyId'],
  enroll: ['legalPolicyId', 'commissionPolicyId', 'settlementPolicyId', 'representativeId', 'creditEvidence'],
  documents_publish: ['artifacts', 'evidence'], delivery_record: ['evidence'],
  schedule: ['reservationRevision', 'start', 'end', 'timezone', 'customerAgreed', 'reason'],
  reschedule: ['reservationRevision', 'start', 'end', 'timezone', 'customerAgreed', 'reason'],
  preparation: ['preparationRevision', 'scopeReviewed', 'materials', 'access', 'blockers', 'note'],
  assign: ['proId', 'context', 'note'], cancel: ['reason', 'evidence'], refund_review: ['reason', 'evidence'], cost_review: ['expenses','evidence'],
};
const sqlKeys: Record<string, string> = { policyId: 'policy_id', legalPolicyId: 'legal_policy_id',
  commissionPolicyId: 'commission_policy_id', settlementPolicyId: 'settlement_policy_id', representativeId: 'representative_id',
  creditEvidence: 'credit_evidence', reservationRevision: 'reservation_revision', preparationRevision: 'preparation_revision', proId: 'pro_id' };
export async function workflowCommand(actor: { userId: string; role: string }, body: Record<string, unknown>) {
  if (actor.role !== 'ADMIN') throw new BusinessError('Management workflow approval required.', 403);
  const action = text(body.action, 40), allowed = fields[action];
  if (!allowed || Object.keys(body).some(key => !common.includes(key) && !allowed.includes(key))) throw new BusinessError('Unsupported workflow command or field.');
  const policy = action.startsWith('policy_');
  if (policy && (body.leadId !== undefined || body.quoteId !== undefined)) throw new BusinessError('Policy commands do not accept customer record identifiers.');
  const revision = policy ? null : body.revision;
  if (!policy && (!Number.isSafeInteger(revision) || Number(revision) < 0)) throw new BusinessError('Reload the exact workflow revision.');
  const payload = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [sqlKeys[key] || key, body[key]]));
  const leadId = policy ? null : identifier(body.leadId), quoteId = policy ? null : identifier(body.quoteId);
  const result = await getSupabase().rpc('field_sales_workflow_command', {
    p_actor: actor.userId, p_operation: identifier(body.operationId), p_lead: leadId,
    p_quote: quoteId, p_revision: revision, p_action: action, p_payload: payload,
  });
  if (['schedule', 'reschedule', 'preparation', 'assign'].includes(action) && result.error?.code === '55000'
    && result.error.message === 'Accepted delivered notices and verified 25% deposit without exceptions required') {
    const current = await workflowRead(actor.userId, leadId, quoteId);
    const workflow = current.workflows.find(row => row.quoteId === quoteId && row.leadId === leadId);
    const accepted = typeof workflow?.acceptedAt === 'string' ? Date.parse(workflow.acceptedAt) : NaN;
    const deadline = typeof workflow?.cancellationDeadline === 'string' ? Date.parse(workflow.cancellationDeadline) : NaN;
    const now = Date.now();
    if (workflow && workflow.gates.canSchedule === false && Array.isArray(workflow.holds)
      && workflow.holds.includes('Configured cancellation deadline must clear before scheduling')
      && !['cancelled', 'refund_review'].includes(workflow.state) && Number.isFinite(accepted)
      && accepted <= now && Number.isFinite(deadline) && deadline > now && deadline > accepted) {
      throw new InstallationHoldError(
        "Installation cannot be scheduled during the customer's cancellation period. Scheduling is possible only after that period ends and all other requirements, including the verified deposit, are met.",
        'INSTALLATION_CANCELLATION_HOLD', new Date(deadline).toISOString());
    }
    throw new InstallationHoldError(
      'Installation requirements are not yet satisfied. Confirm the signed agreement, delivered cancellation notices and verified 25% deposit, and resolve any cancellation, refund or dispute holds before scheduling.',
      'INSTALLATION_NOT_READY');
  }
  return salesChecked(result);
}
export async function completeEnrolledJob(proId: string, jobId: string, body: Record<string, unknown>) {
  if (!workflowEnabled()) return { enrolled: false } as const;
  requireWorkflow();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(jobId)) return { enrolled: false } as const;
  const result = salesChecked(await getSupabase().rpc('field_sales_workflow_complete', {
    p_pro: uuid.test(proId) ? proId : null, p_job: jobId,
    p_operation: typeof body.operationId === 'string' && uuid.test(body.operationId) ? body.operationId : null,
    p_revision: Number.isSafeInteger(body.workflowRevision) ? body.workflowRevision : null,
    p_payload: { expenses: body.expenses, hours: body.hours, evidence: body.evidence },
  }));
  return result as { enrolled: boolean; completed?: boolean; jobId?: string; quoteId?: string; revision?: number };
}
export async function recordInstallationProof(proId: string, jobId: string, body: Record<string, unknown>) {
  requireWorkflow();
  if (!Number.isSafeInteger(body.workflowRevision)) throw new BusinessError('Reload the exact installation revision.');
  return salesChecked(await getSupabase().rpc('field_sales_workflow_record_proof', {
    p_pro: identifier(proId), p_job: identifier(jobId), p_operation: identifier(body.operationId),
    p_revision: body.workflowRevision, p_payload: { bindings: body.bindings, checklists: body.checklists },
  })) as { enrolled: boolean; proofRecorded?: boolean; revision?: number };
}
