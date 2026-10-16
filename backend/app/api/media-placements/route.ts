import { NextResponse } from 'next/server';
import { getMediaPage, readMediaPlacements, resolvePlacementAssets, mergeMediaPlacements } from '@/lib/mediaPlacements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const surface = new URL(request.url).searchParams.get('surface') || '';
  const page = getMediaPage(surface);
  if (!page) return NextResponse.json({ ok: false, error: 'Unknown media page' }, { status: 400, headers });
  try {
    const placements = await readMediaPlacements(surface);
    const sections = Object.fromEntries(await Promise.all(page.areas.map(async (area) => {
      const assets = await resolvePlacementAssets(placements, area.key);
      return [area.key, {
        title: area.title, aspect: area.aspect,
        items: mergeMediaPlacements([], assets, placements, area.key, area.limit, area.service),
      }];
    })));
    return NextResponse.json({ ok: true, surface, sections }, { headers });
  } catch (error) {
    console.error('[media-placements/public]', error);
    return NextResponse.json({ ok: false, error: 'Could not load page media' }, { status: 503, headers });
  }
}
