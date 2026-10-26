import { getSupabase } from '@/lib/supabase';
import { BusinessError, checked } from '@/lib/commercial_business';
import { getTechnicianPhones, getEscalationPhones } from '@/lib/commercial_consultation_runtime';

const utils = require('@/lib/commercial_consultation.js');
export type OwnerRouting = {
  phone: string | null; revision: number; source: 'saved' | 'environment';
  updatedAt: string | null; updatedBy: { id: string; name: string; role: string } | null;
};
export function normalizeRoutingPhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[\d ().-]+$/.test(value.trim())) {
    throw new BusinessError('Enter a US phone number or an international number with +country code.');
  }
  const raw = value.trim(), digits = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') && !(digits.length === 10 || digits.length === 11 && digits.startsWith('1'))) {
    throw new BusinessError('Use 10 US digits or include +country code.');
  }
  const phone: string = utils.normalizePhone(raw);
  if (!/^\+[1-9]\d{10,14}$/.test(phone) || raw.startsWith('+') && phone !== '+' + digits) {
    throw new BusinessError('Enter a valid phone number. Extensions are not supported.');
  }
  return phone;
}
export function ownerEnvironmentDefault(): string | null {
  const raw = String(process.env.RESIDENTIAL_REVIEWER_PHONE || '').trim();
  if (!raw) return null;
  try { return normalizeRoutingPhone(raw); }
  catch (error) {
    if (!(error instanceof BusinessError)) throw error;
    console.error('Residential notification environment default is invalid');
    throw new BusinessError('Residential owner default is invalid. An administrator must review notification routing.', 503);
  }
}
export async function readOwnerRouting(): Promise<OwnerRouting> {
  const row = checked(await getSupabase().from('notification_routing')
    .select('phone,revision,updated_at,updated_by').eq('route_key', 'residential_owner').maybeSingle());
  if (!row) return { phone: ownerEnvironmentDefault(), revision: 0, source: 'environment', updatedAt: null, updatedBy: null };
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.phone !== 'string'
    || !/^\+[1-9]\d{10,14}$/.test(row.phone)) {
    console.error('Saved residential notification routing is invalid');
    throw new BusinessError('Saved notification routing requires administrator review. No default recipient was substituted.', 503);
  }
  return { phone: row.phone, revision: row.revision, source: 'saved', updatedAt: row.updated_at, updatedBy: row.updated_by };
}
export function routingSummary(owner: OwnerRouting) {
  return { owner, commercialTechnicians: getTechnicianPhones(), managementEscalation: getEscalationPhones() };
}
