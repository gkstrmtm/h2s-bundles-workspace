import type { SupabaseClient } from '@supabase/supabase-js';

export function bearerToken(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
}

export async function requirePartner(request: Request, client: SupabaseClient) {
  const token = bearerToken(request);
  if (!token) return { ok: false as const, status: 401, error: 'Partner sign-in required' };
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) return { ok: false as const, status: 401, error: 'Partner session expired' };
  const { data: partner, error: partnerError } = await client
    .from('h2s_realtor_partners')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (partnerError) throw partnerError;
  if (!partner) return { ok: false as const, status: 403, error: 'Partner profile not found' };
  return { ok: true as const, user: authData.user, partner, token };
}
