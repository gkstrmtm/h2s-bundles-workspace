import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@/lib/commercial_business';
import { processResidentialNotices } from '@/lib/residential_workspace';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const secrets = [process.env.CRON_SECRET, process.env.RESIDENTIAL_MAINTENANCE_TOKEN].filter((value): value is string => !!value?.trim());
    if (!secrets.length) throw new BusinessError('Configure CRON_SECRET or RESIDENTIAL_MAINTENANCE_TOKEN outside Git before running residential reminders.', 503);
    const provided = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
    const input = Buffer.from(provided);
    if (!secrets.some(value => input.length === Buffer.byteLength(value) && timingSafeEqual(input, Buffer.from(value)))) {
      throw new BusinessError('Unauthorized.', 401);
    }
    return NextResponse.json({ ok: true, ...await processResidentialNotices() }, { headers });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Residential reminder maintenance failed', error);
    return NextResponse.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Residential reminder maintenance failed; reconcile before retrying.' },
      { status: error instanceof BusinessError ? error.status : 503, headers });
  }
}
export function GET(request: Request) { return handle(request); }
export function POST(request: Request) { return handle(request); }
