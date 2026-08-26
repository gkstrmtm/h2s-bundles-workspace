import crypto from 'crypto';

export const PARTNER_STATUSES = ['pending', 'approved', 'suspended', 'rejected'] as const;
export type PartnerStatus = typeof PARTNER_STATUSES[number];

export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeSlug(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function createReferralToken(): string {
  return `H2S-${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

export function publicPartner(row: any) {
  return {
    id: row.id,
    status: row.status,
    first_name: row.first_name,
    last_name: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    brokerage: row.brokerage,
    market: row.market,
    email: row.email,
    phone: row.phone,
    instagram: row.instagram || null,
    headshot_url: row.headshot_url || null,
    public_slug: row.public_slug || null,
    referral_token: row.referral_token || null,
    brokerage_approval_confirmed: Boolean(row.brokerage_approval_confirmed),
    created_at: row.created_at,
    approved_at: row.approved_at || null,
  };
}
