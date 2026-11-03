import { getDashboardAuthUserFromSession, type DashboardAuthUser } from '@/lib/dashboardAuth';
import type { ProposedStaffRole } from '@/lib/operationsFoundation';

export type DashboardCapability = 'operations.read' | 'customers.owned.read' | 'quotes.owned.read';

// These capabilities govern new adapters only, not existing VA workflows.
export const dashboardRolePolicies: Readonly<Record<ProposedStaffRole, {
  active: boolean; capabilities: readonly DashboardCapability[];
}>> = {
  ADMIN: { active: true, capabilities: ['operations.read', 'customers.owned.read', 'quotes.owned.read'] },
  VA: { active: true, capabilities: [] },
  OPERATIONS: { active: false, capabilities: ['operations.read'] },
  SALES: { active: false, capabilities: ['customers.owned.read', 'quotes.owned.read'] },
};

export class DashboardPermissionError extends Error {
  constructor(message: string, readonly status: 401 | 403) { super(message); }
}

export function hasDashboardCapability(role: string, capability: DashboardCapability): boolean {
  if (!Object.prototype.hasOwnProperty.call(dashboardRolePolicies, role)) return false;
  const policy = dashboardRolePolicies[role as ProposedStaffRole];
  return policy.active && policy.capabilities.includes(capability);
}

export function mayReadOwnedRecord(
  actor: DashboardAuthUser, capability: 'customers.owned.read' | 'quotes.owned.read',
  ownerUserId: string | null
): boolean {
  if (!hasDashboardCapability(actor.role, capability)) return false;
  return actor.role === 'ADMIN' || (ownerUserId !== null && actor.userId === ownerUserId);
}

export async function requireDashboardCapability(request: Request, capability: DashboardCapability) {
  const actor = await getDashboardAuthUserFromSession(request, { touchSession: false });
  if (!actor) throw new DashboardPermissionError('Sign in with a dashboard account.', 401);
  if (!hasDashboardCapability(actor.role, capability)) {
    throw new DashboardPermissionError('Your dashboard account cannot access these operational records.', 403);
  }
  return actor;
}
