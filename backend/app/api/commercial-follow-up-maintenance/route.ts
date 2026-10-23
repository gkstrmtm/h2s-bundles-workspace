import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { readFollowUpPolicy } from '@/lib/internal_follow_up';
import { applyAutomaticFollowUp } from '@/lib/commercial_follow_up';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const secret = process.env.CRON_SECRET?.trim();
  const provided = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
  if (!secret) return reply({ ok: false, error: 'Internal maintenance authorization unavailable' }, 503);
  const left = Buffer.from(secret), right = Buffer.from(provided);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return reply({ ok: false, error: 'Unauthorized' }, 401);
  try {
    if (!readFollowUpPolicy().enabled) return reply({ ok: true, enabled: false, processed: 0 });
    const cursor = new URL(request.url).searchParams.get('after');
    if (cursor && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor)) return reply({ ok: false, error: 'Invalid follow-up cursor' }, 400);
    let query = getSupabase().from('commercial_leads').select('lead_id').order('lead_id').limit(100);
    if (cursor) query = query.gt('lead_id', cursor);
    const result = await query;
    if (result.error || !result.data) throw new Error('Internal follow-up batch unavailable');
    const counts: Record<string, number> = {};
    for (const row of result.data) {
      const outcome = await applyAutomaticFollowUp(row.lead_id);
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
    return reply({ ok: true, enabled: true, processed: result.data.length, counts,
      nextCursor: result.data.length === 100 ? result.data.at(-1)?.lead_id : null });
  } catch (error) {
    console.error('[internal follow-up] Maintenance failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return reply({ ok: false, error: 'Internal follow-up unavailable; review configuration/schema and retry safely' }, 503);
  }
}
