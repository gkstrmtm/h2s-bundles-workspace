// Pure identity contracts; validators never change persisted records.
export type ExistingStaffRole = 'ADMIN' | 'VA';
export type ProposedStaffRole = ExistingStaffRole | 'OPERATIONS' | 'SALES';
export type Market = 'residential' | 'commercial';

export interface EmployeeReference {
  dashboardUserId: string;
  role: ExistingStaffRole;
}

export interface CustomerContext {
  leadId: string;
  market: Market;
  crmContact: { projectRef: string; contactId: string } | null;
}

export interface OfferReference {
  serviceId: string;
  offerId: string;
  catalogVersion: string;
}

export interface QuoteReference {
  leadId: string;
  quoteOperationId: string;
  businessRevision: number;
}

export interface OrderReference {
  id: string;
  orderId: string;
}

export interface PaymentReference {
  orderUuid: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
}

export interface JobReference {
  jobId: string;
  orderReference: string;
}

export interface TechnicianAssignment {
  jobId: string;
  proId: string;
  assignmentId: string;
  rawState: string;
}

export interface TechnicianPayoutReference {
  payoutId: string;
  jobId: string;
  proId: string;
  payoutType: string;
  rawStatus: string;
  rawApprovalState: string | null;
}

export interface ProposedSalesAttribution {
  representativeUserId: string;
  quote: QuoteReference;
  commissionPolicyVersion: string | null;
}

export interface InstallationLink {
  customer: CustomerContext;
  order: OrderReference;
  job: JobReference;
  quote: QuoteReference | null;
}

export type JobLifecycle = 'pending_payment' | 'queued' | 'assigned' | 'in_progress'
  | 'completed' | 'cancelled' | 'unmapped';

export class OperationsContractError extends Error {
  constructor(readonly code: 'INVALID_IDENTITY' | 'UNRESOLVED_ORDER' | 'AMBIGUOUS_ORDER' | 'INVALID_RELATIONSHIP',
    message: string) {
    super(message);
    this.name = 'OperationsContractError';
  }
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 200
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OperationsContractError('INVALID_IDENTITY', 'A nonempty, unmodified record identifier is required.');
  }
  return value;
}

function uuid(value: unknown): string {
  const id = identifier(value);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    throw new OperationsContractError('INVALID_IDENTITY', 'A UUID record identifier is required.');
  }
  return id.toLowerCase();
}

export function isExistingStaffRole(value: unknown): value is ExistingStaffRole {
  return value === 'ADMIN' || value === 'VA';
}

export function validateQuoteReference(quote: QuoteReference): void {
  uuid(quote.leadId);
  uuid(quote.quoteOperationId);
  if (!Number.isSafeInteger(quote.businessRevision) || quote.businessRevision < 1) {
    throw new OperationsContractError('INVALID_IDENTITY', 'A persisted quote-event revision is required.');
  }
}

export function resolveOrderReference<T extends OrderReference>(reference: string, orders: readonly T[]): T {
  identifier(reference);
  const matches = orders.filter(order => {
    uuid(order.id);
    identifier(order.orderId);
    return order.orderId === reference || order.id.toLowerCase() === reference.toLowerCase();
  });
  if (!matches.length) {
    throw new OperationsContractError('UNRESOLVED_ORDER', 'The order reference has no verified match.');
  }
  if (matches.length !== 1) {
    throw new OperationsContractError('AMBIGUOUS_ORDER', 'The order reference resolves to more than one record.');
  }
  return matches[0];
}

export function validateInstallationLink(link: InstallationLink, expectedCrmProjectRef: string | null = null): void {
  const leadId = uuid(link.customer.leadId);
  if (!['residential', 'commercial'].includes(link.customer.market)) {
    throw new OperationsContractError('INVALID_IDENTITY', 'An explicit service market is required.');
  }
  uuid(link.job.jobId);
  resolveOrderReference(link.job.orderReference, [link.order]);
  if (link.customer.crmContact) {
    uuid(link.customer.crmContact.contactId);
    if (!expectedCrmProjectRef || !/^[a-z0-9]{20}$/.test(expectedCrmProjectRef)
      || link.customer.crmContact.projectRef !== expectedCrmProjectRef) {
      throw new OperationsContractError('INVALID_RELATIONSHIP', 'The CRM contact requires its configured source project.');
    }
  }
  if (link.quote) {
    validateQuoteReference(link.quote);
    if (uuid(link.quote.leadId) !== leadId) {
      throw new OperationsContractError('INVALID_RELATIONSHIP', 'The quote belongs to a different inquiry.');
    }
  }
}

export function classifyJobStatus(raw: string): { raw: string; lifecycle: JobLifecycle } {
  identifier(raw);
  const normalized = raw.toLowerCase();
  const lifecycle: JobLifecycle = normalized === 'done' ? 'completed'
    : normalized === 'canceled' ? 'cancelled'
      : normalized === 'pending_payment' || normalized === 'queued' || normalized === 'assigned'
        || normalized === 'in_progress' || normalized === 'completed' || normalized === 'cancelled'
        ? normalized : 'unmapped';
  return { raw, lifecycle };
}
