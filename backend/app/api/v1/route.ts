import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDb1, getSupabaseDispatch, getSupabaseMgmt } from '@/lib/supabase';
import twilio from 'twilio';
import OpenAI from 'openai';
import taskCreator from '@/lib/task_creator';
import { sendMail } from '@/lib/mail';
import { normalizePhone } from '../_lib/phone';
import crypto from 'node:crypto';

const {
  canGenerateTaskDetails,
  getMinWords,
  getTaskCategories,
  missingOutcomeQuestion,
  normalizeText
} = taskCreator as any;

type TrackingEventRow = {
  visitor_id?: string | null;
  session_id?: string | null;
  occurred_at?: string | null;
  event_type?: string | null;
  event_name?: string | null;
  page_path?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  revenue_amount?: string | number | null;
  metadata?: any;
};

// Initialize OpenAI only if API key exists
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function tryParseJsonObject(raw: unknown): { ok: true; value: any } | { ok: false; error: string } {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'Empty response' };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Try to salvage JSON if the model wrapped it in text/code fences.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const slice = text.slice(first, last + 1);
      try {
        return { ok: true, value: JSON.parse(slice) };
      } catch {
        return { ok: false, error: 'Failed to parse JSON (salvage attempt failed)' };
      }
    }
    return { ok: false, error: 'Failed to parse JSON (no object found)' };
  }
}

function safeTrim(raw: unknown): string {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

function normalizeHttpUrl(raw: unknown): string | null {
  try {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    const protocol = String(u.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeAssets(raw: unknown): string[] {
  try {
    const collect: string[] = [];

    const pushToken = (token: unknown) => {
      const maybe = normalizeHttpUrl(token);
      if (!maybe) return;
      collect.push(maybe);
    };

    if (Array.isArray(raw)) {
      for (const item of raw) pushToken(item);
    } else {
      const text = String(raw == null ? '' : raw);
      const tokens = text.split(/[\s\n\r\t]+/g).filter(Boolean);
      for (const t of tokens) pushToken(t);
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of collect) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeAssetsMeta(raw: unknown, assets: string[]): Record<string, any> | null {
  try {
    const allowed = new Set<string>();
    for (const u of Array.isArray(assets) ? assets : []) {
      const norm = normalizeHttpUrl(u);
      if (norm) allowed.add(norm);
    }

    const out: Record<string, any> = {};
    let count = 0;

    // Accept array form: [{ url, title, provider }]
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (count >= 50) break;
        if (!item || typeof item !== 'object') continue;

        const url = normalizeHttpUrl((item as any).url ?? (item as any).URL ?? '');
        if (!url) continue;
        if (allowed.size && !allowed.has(url)) continue;

        const title = safeTrim((item as any).title ?? (item as any).Title ?? '');
        const provider = safeTrim((item as any).provider ?? (item as any).provider_name ?? (item as any).Provider ?? '');

        const thumb = safeTrim(
          (item as any).thumbnailUrl ?? (item as any).thumbnail_url ?? (item as any).thumbnail ?? (item as any).thumb ?? ''
        );
        const durRaw = (item as any).durationSeconds ?? (item as any).duration_seconds ?? (item as any).duration;
        const dur = Number.isFinite(Number(durRaw)) ? Math.max(0, Math.floor(Number(durRaw))) : null;

        const row: any = {};
        if (title) row.title = title.slice(0, 200);
        if (provider) row.provider = provider.slice(0, 80);
        if (thumb) row.thumbnailUrl = thumb.slice(0, 500);
        if (dur !== null) row.durationSeconds = dur;
        if (Object.keys(row).length === 0) continue;

        out[url] = row;
        count++;
      }

      return Object.keys(out).length ? out : null;
    }

    // Map form: { [url]: { title, provider } }
    const meta = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as any) : null;
    if (!meta) return null;

    for (const [k, v] of Object.entries(meta)) {
      if (count >= 50) break;
      const key = normalizeHttpUrl(k);
      if (!key) continue;
      if (allowed.size && !allowed.has(key)) continue;
      if (!v || typeof v !== 'object') continue;

      const title = safeTrim((v as any).title ?? (v as any).Title ?? '');
      const provider = safeTrim((v as any).provider ?? (v as any).provider_name ?? (v as any).Provider ?? '');

      const thumb = safeTrim(
        (v as any).thumbnailUrl ?? (v as any).thumbnail_url ?? (v as any).thumbnail ?? (v as any).thumb ?? ''
      );
      const durRaw = (v as any).durationSeconds ?? (v as any).duration_seconds ?? (v as any).duration;
      const dur = Number.isFinite(Number(durRaw)) ? Math.max(0, Math.floor(Number(durRaw))) : null;

      const row: any = {};
      if (title) row.title = title.slice(0, 200);
      if (provider) row.provider = provider.slice(0, 80);
      if (thumb) row.thumbnailUrl = thumb.slice(0, 500);
      if (dur !== null) row.durationSeconds = dur;

      if (Object.keys(row).length === 0) continue;
      out[key] = row;
      count++;
    }

    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs | 0));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json,text/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function inferLinkProvider(assetUrl: string): 'youtube' | 'loom' | 'unknown' {
  try {
    const u = new URL(assetUrl);
    const host = String(u.hostname || '').toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('loom.com')) return 'loom';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getLinkTitleFromOEmbed(
  assetUrl: string
): Promise<{ title?: string; provider?: string; thumbnailUrl?: string; durationSeconds?: number } | null> {
  const provider = inferLinkProvider(assetUrl);
  const encoded = encodeURIComponent(assetUrl);

  try {
    if (provider === 'youtube') {
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encoded}`;
      const data = await fetchJsonWithTimeout(oembedUrl, 6500);
      const title = safeTrim(data?.title);
      const providerName = safeTrim(data?.provider_name || 'YouTube');
      const thumbnailUrl = safeTrim(data?.thumbnail_url);
      if (!title) return null;
      return {
        title,
        provider: providerName,
        thumbnailUrl: thumbnailUrl || undefined
      };
    }

    if (provider === 'loom') {
      const oembedUrl = `https://www.loom.com/v1/oembed?format=json&url=${encoded}`;
      const data = await fetchJsonWithTimeout(oembedUrl, 6500);
      const title = safeTrim(data?.title);
      const providerName = safeTrim(data?.provider_name || 'Loom');
      const thumbnailUrl = safeTrim(data?.thumbnail_url);
      const durationSeconds = Number.isFinite(Number(data?.duration)) ? Math.max(0, Math.floor(Number(data?.duration))) : undefined;
      if (!title) return null;
      return {
        title,
        provider: providerName,
        thumbnailUrl: thumbnailUrl || undefined,
        durationSeconds
      };
    }
  } catch {
    // best-effort
  }

  return null;
}

function missingActionResponse(request: Request, method: 'GET' | 'POST') {
  return NextResponse.json(
    {
      ok: false,
      error: 'action is required',
      received: { method }
    },
    { status: 400, headers: corsHeaders(request) }
  );
}

function extractYoutubeId(assetUrl: string): string {
  try {
    const u = new URL(assetUrl);
    const host = String(u.hostname || '').toLowerCase();
    if (host.includes('youtu.be')) {
      const id = String(u.pathname || '').replace(/^\//, '').trim();
      return id || '';
    }
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = String(u.pathname || '').split('/').filter(Boolean);
      const embedIdx = parts.indexOf('embed');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
      const shortsIdx = parts.indexOf('shorts');
      if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];
    }
    return '';
  } catch {
    return '';
  }
}

function extractLoomId(assetUrl: string): string {
  try {
    const u = new URL(assetUrl);
    const host = String(u.hostname || '').toLowerCase();
    if (!host.includes('loom.com')) return '';
    const parts = String(u.pathname || '').split('/').filter(Boolean);
    const shareIdx = parts.indexOf('share');
    if (shareIdx >= 0 && parts[shareIdx + 1]) return parts[shareIdx + 1];
    const embedIdx = parts.indexOf('embed');
    if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    return '';
  } catch {
    return '';
  }
}

function isPlaceholderTrainingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = String(u.hostname || '').toLowerCase();
    const path = String(u.pathname || '');
    const search = String(u.search || '');

    // Explicit junk patterns observed in prod.
    if ((host === 'in' || host === 'this') && path === '/' && !search) return true;
    return false;
  } catch {
    return false;
  }
}

function canonicalTrainingVideoUrl(raw: unknown): { url: string; provider: 'youtube' | 'loom' } | null {
  try {
    const norm = normalizeHttpUrl(raw);
    if (!norm) return null;
    if (isPlaceholderTrainingUrl(norm)) return null;

    const yt = extractYoutubeId(norm);
    if (yt) {
      return { url: `https://www.youtube.com/watch?v=${yt}`, provider: 'youtube' };
    }

    const loom = extractLoomId(norm);
    if (loom) {
      return { url: `https://www.loom.com/share/${loom}`, provider: 'loom' };
    }

    // Unsupported provider (we drop these to keep videos[] embeddable/trustworthy).
    return null;
  } catch {
    return null;
  }
}

function sanitizeTrainingAssets(raw: unknown): string[] {
  try {
    const tokens: unknown[] = [];
    if (Array.isArray(raw)) {
      tokens.push(...raw);
    } else {
      const s = safeTrim(raw);
      if (s) {
        // legacy: allow whitespace/newline separated URLs (but will only keep supported providers)
        for (const t of s.split(/[\s\n\r\t]+/g).filter(Boolean)) tokens.push(t);
      }
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const tok of tokens) {
      const canon = canonicalTrainingVideoUrl(tok);
      if (!canon) continue;
      if (seen.has(canon.url)) continue;
      seen.add(canon.url);
      out.push(canon.url);
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

type TrainingAssetMeta = {
  title?: string;
  provider?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  titleCleared?: boolean;
};

function normalizeTrainingAssetsMeta(raw: unknown, assets: string[]): Record<string, TrainingAssetMeta> | null {
  try {
    const allowed = new Set<string>();
    for (const u of Array.isArray(assets) ? assets : []) {
      const canon = canonicalTrainingVideoUrl(u);
      if (canon) allowed.add(canon.url);
    }
    if (!allowed.size) return null;

    const out: Record<string, TrainingAssetMeta> = {};
    let count = 0;

    const push = (maybeUrl: unknown, v: any) => {
      if (count >= 50) return;
      const canon = canonicalTrainingVideoUrl(maybeUrl);
      if (!canon) return;
      const key = canon.url;
      if (!allowed.has(key)) return;

      const title = safeTrim(v?.title ?? v?.Title ?? '');
      const provider = safeTrim(v?.provider ?? v?.provider_name ?? v?.Provider ?? canon.provider);
      const thumb = safeTrim(v?.thumbnailUrl ?? v?.thumbnail_url ?? v?.thumbnail ?? v?.thumb ?? '');
      const durRaw = v?.durationSeconds ?? v?.duration_seconds ?? v?.duration;
      const dur = Number.isFinite(Number(durRaw)) ? Math.max(0, Math.floor(Number(durRaw))) : null;
      const titleCleared = v?.titleCleared === true || v?.title_cleared === true;

      const row: TrainingAssetMeta = {};
      if (title) row.title = title.slice(0, 200);
      if (provider) row.provider = provider.slice(0, 80);
      if (thumb) row.thumbnailUrl = thumb.slice(0, 500);
      if (dur !== null) row.durationSeconds = dur;
      if (titleCleared) row.titleCleared = true;

      if (Object.keys(row).length === 0) return;

      // Merge: prefer non-empty title, otherwise keep existing.
      const existing = out[key] || {};
      out[key] = {
        ...existing,
        ...row,
        title: row.title ? row.title : existing.title,
        titleCleared: row.titleCleared ? true : existing.titleCleared
      };
      count++;
    };

    // Accept array form: [{ url, title, provider, ... }]
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        push((item as any).url ?? (item as any).URL, item);
      }
      return Object.keys(out).length ? out : null;
    }

    // Map form: { [url]: { title, provider, ... } }
    const meta = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as any) : null;
    if (!meta) return null;
    for (const [k, v] of Object.entries(meta)) {
      if (!v || typeof v !== 'object') continue;
      push(k, v);
    }

    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function mergeTrainingAssetsMeta(opts: {
  existing: Record<string, TrainingAssetMeta> | null;
  incoming: Record<string, TrainingAssetMeta> | null;
  assets: string[];
}): Record<string, TrainingAssetMeta> | null {
  try {
    const assets = Array.isArray(opts.assets) ? opts.assets : [];
    if (!assets.length) return null;

    const existing = (opts.existing && typeof opts.existing === 'object') ? opts.existing : null;
    const incoming = (opts.incoming && typeof opts.incoming === 'object') ? opts.incoming : null;

    const out: Record<string, TrainingAssetMeta> = {};
    for (const url of assets) {
      const key = String(url || '').trim();
      if (!key) continue;

      const prev = existing && existing[key] ? existing[key] : {};
      const next = incoming && incoming[key] ? incoming[key] : {};

      const cleared = next.titleCleared === true;
      const nextTitleRaw = safeTrim(next.title ?? '');
      const prevTitleRaw = safeTrim(prev.title ?? '');

      const title = cleared
        ? ''
        : (nextTitleRaw ? nextTitleRaw : prevTitleRaw);

      const merged: TrainingAssetMeta = {
        ...prev,
        ...next,
      };

      // Enforce title-clearing semantics.
      if (cleared) {
        delete merged.title;
      } else if (title) {
        merged.title = title.slice(0, 200);
      } else {
        // no title
        delete merged.title;
      }

      delete merged.titleCleared;

      if (Object.keys(merged).length) out[key] = merged;
    }

    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function stableVideoIdFromUrl(assetUrl: string): string {
  try {
    // Keep this aligned with DB migration 022_training_asset_progress_add_video_id.sql
    // which backfills Video_ID using md5(Asset_URL).
    return crypto.createHash('md5').update(String(assetUrl || '')).digest('hex');
  } catch {
    return String(assetUrl || '').slice(0, 64);
  }
}

function buildTrainingVideos(resource: any): Array<{
  id: string;
  title: string | null;
  url: string;
  durationSeconds: number | null;
  source: string;
  thumbnail: string | null;
}> {
  try {
    // Source of truth: persisted Assets (+ legacy URL for single-video modules).
    // Never tokenize Description into URLs.
    const rawAssets = resource && (resource.Assets !== undefined ? resource.Assets : resource.assets);
    const assets = sanitizeTrainingAssets(Array.isArray(rawAssets) ? rawAssets : (rawAssets != null ? rawAssets : []));
    const urlFallback = (!assets.length) ? sanitizeTrainingAssets(resource && (resource.URL || resource.url)) : [];
    const finalAssets = assets.length ? assets : urlFallback;

    const meta = normalizeTrainingAssetsMeta(
      resource && (resource.Assets_Meta ?? resource.assets_meta ?? resource.AssetsMeta ?? resource.assetsMeta),
      finalAssets
    );

    return (finalAssets || []).map((u) => {
      const norm = String(u || '').trim();
      const m = meta && norm ? (meta as any)[norm] : null;
      const title = safeTrim(m && (m.title || m.Title) || '') || null;
      const thumb = safeTrim(m && (m.thumbnailUrl || m.thumbnail_url || m.thumbnail) || '') || null;
      const durRaw = m && (m.durationSeconds ?? m.duration_seconds ?? m.duration);
      const dur = Number.isFinite(Number(durRaw)) ? Math.max(0, Math.floor(Number(durRaw))) : null;
      const source = inferLinkProvider(norm);
      return {
        id: stableVideoIdFromUrl(norm),
        title,
        url: norm,
        durationSeconds: dur,
        source,
        thumbnail: thumb
      };
    });
  } catch {
    return [];
  }
}

function invalidActionResponse(request: Request, method: 'GET' | 'POST', action: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: 'Invalid action',
      received: {
        method,
        action: action == null ? null : String(action)
      },
      hint: 'Backend may be out of date. Deploy backend and retry.'
    },
    { status: 400, headers: corsHeaders(request) }
  );
}

function isWeakOfferTitle(title: string): boolean {
  const s = safeTrim(title);
  if (!s) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s)) return true;
  const lower = s.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (s.length < 10) return true;
  if (words.length <= 1 && s.length <= 14) return true;
  const bad = new Set(['offer', 'special offer', 'special', 'test', 'tmp', 'temp', 'new', 'dates', 'date', 'twit', 'tbd', 'asdf']);
  if (bad.has(lower)) return true;
  if (lower.replace(/[^a-z]/g, '').length < 6) return true;
  return false;
}

function isLikelyTexasSeedOffer(row: any): boolean {
  try {
    const name = safeTrim(row?.Offer_Name || row?.offerName || row?.name || '');
    const who = safeTrim(row?.Created_By || row?.created_by || '');
    const status = safeTrim(row?.Status || row?.status || '');
    const id = safeTrim(row?.Offer_ID || row?.offer_id || row?.id || '');

    const ctxRaw = row?.Message_Context ?? row?.message_context ?? row?.messageContext ?? '';
    const aiRaw = row?.AI_Analysis ?? row?.ai_analysis ?? '';
    const hay = `${name} ${who} ${status} ${id} ${String(ctxRaw || '')} ${String(aiRaw || '')}`.toLowerCase();

    // Strong signals of seeded/test content.
    if (/(\bseed\b|seeded|seed pack|\btest\b|demo|sample|lorem|ipsum|asdf|tmp|temp)/i.test(hay)) return true;

    // Texas market strings (known seeded dataset pattern in this workspace).
    if (/(\baustin\b|\bhouston\b|\bdallas\b|san\s+antonio|\btexas\b|\btx\b)/i.test(hay)) return true;

    return false;
  } catch {
    return false;
  }
}

function normalizeOfferTitleCandidate(title: string): string {
  const s = safeTrim(title);
  if (!s) return '';
  // Strip quotes / trailing punctuation, keep it readable.
  const cleaned = s
    .replace(/^['"“”]+/, '')
    .replace(/['"“”]+$/, '')
    .replace(/[\s\-–—:]+$/g, '')
    .trim();
  if (!cleaned) return '';
  // Keep titles short and scannable.
  return cleaned.length > 72 ? cleaned.slice(0, 71).trim() : cleaned;
}

function uniqTitles(titles: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const norm = normalizeOfferTitleCandidate(t);
    const key = norm.toLowerCase();
    if (!norm) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

function guessOccasionLabel(offerData: any): string {
  const startRaw = safeTrim(offerData?.offerStartDate || offerData?.startDate || offerData?.start || '');
  const endRaw = safeTrim(offerData?.offerEndDate || offerData?.endDate || offerData?.end || '');
  const tryDate = (x: string) => {
    try {
      const d = x ? new Date(x) : null;
      return d && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  };
  const d = tryDate(startRaw) || tryDate(endRaw) || new Date();
  const m = d.getMonth(); // 0..11

  const map: Record<number, string[]> = {
    0: ['New Year', 'Winter'],
    1: ['Valentine\'s', 'Winter'],
    2: ['Spring Kickoff', 'March'],
    3: ['Spring Refresh', 'April'],
    4: ['Memorial Day', 'Early Summer'],
    5: ['Summer', 'June'],
    6: ['Summer', 'July'],
    7: ['Back-to-School', 'Late Summer'],
    8: ['Fall', 'September'],
    9: ['Fall', 'October'],
    10: ['Holiday', 'Thanksgiving'],
    11: ['Holiday', 'Year-End']
  };

  const picked = map[m] || ['Seasonal'];
  return picked[0];
}

function guessServiceLabel(offerData: any): string {
  const headline = safeTrim(offerData?.headline || offerData?.oneSentencePromise || offerData?.intendedGoal || '');
  const items = Array.isArray(offerData?.lineItems) ? offerData.lineItems : [];
  const names = [headline, ...items.map((x: any) => safeTrim(x?.name || x?.serviceName || x?.service || ''))]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (names.includes('tv')) return 'TV Mount';
  if (names.includes('doorbell')) return 'Doorbell';
  if (names.includes('camera')) return 'Camera';
  if (names.includes('wifi') || names.includes('mesh')) return 'Wi‑Fi Upgrade';
  if (names.includes('smart home') || names.includes('smart')) return 'Smart Home';
  return 'Home Upgrade';
}

function fallbackOfferTitleSuggestions(offerData: any): string[] {
  const occasion = guessOccasionLabel(offerData);
  const service = guessServiceLabel(offerData);
  const market = safeTrim(offerData?.market || '').toUpperCase();
  const dealWords = ['Grand Slam', 'Boost', 'Bundle', 'Special', 'Upgrade', 'Fast-Track'];
  const vibes = ['VIP', 'Pro', 'Clean Install', 'No-Surprises', 'Same-Day'];

  const base: string[] = [];
  base.push(`${occasion} ${service} ${dealWords[0]} Offer`);
  base.push(`${occasion} ${service} ${dealWords[2]}`);
  base.push(`${vibes[0]} ${service} ${dealWords[4]}`);
  base.push(`${vibes[4]} ${service} ${dealWords[5]}`);
  base.push(`${service} ${dealWords[1]} (${occasion})`);
  if (market) base.push(`${market} ${occasion} ${service} Bundle`);
  return uniqTitles(base);
}

function clipString(value: any, max = 600): string {
  const s = safeTrim(value == null ? '' : value);
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function slimOfferDataForTitle(offerData: any): any {
  const o: any = (offerData && typeof offerData === 'object') ? offerData : {};

  const out: any = {
    name: clipString(o.name || o.offerName || o.offer_name, 120),
    category: clipString(o.category, 80),
    market: clipString(o.market, 80),
    primaryAvatar: clipString(o.primaryAvatar, 120),
    intendedGoal: clipString(o.intendedGoal, 240),
    headline: clipString(o.headline, 240),
    oneSentencePromise: clipString(o.oneSentencePromise, 240),
    offerStartDate: clipString(o.offerStartDate, 40),
    offerEndDate: clipString(o.offerEndDate, 40),
    scarcityMechanism: clipString(o.scarcityMechanism, 160),
    riskReversal: clipString(o.riskReversal, 200),
    whatsIncluded: clipString(o.whatsIncluded, 500),
    eligibilityRules: clipString(o.eligibilityRules, 300),
    redemptionRules: clipString(o.redemptionRules, 300)
  };

  // Common arrays (keep short)
  if (Array.isArray(o.lineItems)) {
    out.lineItems = o.lineItems.slice(0, 12).map((li: any) => ({
      name: clipString(li?.name || li?.serviceName || li?.service, 120),
      qty: Number(li?.qty || 1) || 1,
      notes: clipString(li?.notes, 160)
    })).filter((x: any) => x.name);
  }
  if (Array.isArray(o.hooks)) out.hooks = o.hooks.slice(0, 12).map((x: any) => clipString(x, 120)).filter(Boolean);
  if (Array.isArray(o.proofIdeas)) out.proofIdeas = o.proofIdeas.slice(0, 8).map((x: any) => clipString(x, 140)).filter(Boolean);
  if (Array.isArray(o.objectionsRebuttals)) out.objectionsRebuttals = o.objectionsRebuttals.slice(0, 8).map((x: any) => clipString(x, 160)).filter(Boolean);

  // Final cleanup: drop empty keys.
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v == null) delete out[k];
    else if (typeof v === 'string' && !v.trim()) delete out[k];
    else if (Array.isArray(v) && v.length === 0) delete out[k];
  }

  return out;
}

async function aiOfferTitleSuggestions(openaiClient: OpenAI | null, offerData: any, currentTitle: string): Promise<string[]> {
  const fallback = fallbackOfferTitleSuggestions(offerData);
  if (!openaiClient) return fallback;

  const service = guessServiceLabel(offerData);
  const occasion = guessOccasionLabel(offerData);

  const prompt = `You are a senior direct-response marketer for Home2Smart (TV mounts, doorbells, cameras, smart home installs).

Goal: Generate 6 unique, memorable, "worldly" offer titles that a real operator would recognize in a library.

Constraints:
- 3 to 8 words per title
- Must include at least one of: season/occasion (e.g., "Valentine's", "Holiday", "Spring") OR a strong descriptor (e.g., "VIP", "Same-Day", "Pro")
- Must clearly hint the service (ex: TV Mount, Doorbell, Camera, Wi‑Fi Upgrade)
- Avoid boring/generic titles like "Special Offer" or "Offer Brief".
- No emojis, no profanity, no ALL CAPS.
- Keep under 72 characters.

If current title is provided, do NOT return it.

Return VALID JSON ONLY in this exact shape:
{ "titles": ["string"] }

Helpful seed:
- Occasion: ${occasion}
- Service: ${service}
- Current title: ${safeTrim(currentTitle) || '(none)'}

OFFER_DATA_JSON:
${JSON.stringify(slimOfferDataForTitle(offerData))}`;

  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Return JSON only. No markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    const parsed = tryParseJsonObject(completion.choices?.[0]?.message?.content || '');
    if (!parsed.ok) return fallback;
    const raw = parsed.value;
    const titles = Array.isArray(raw?.titles) ? raw.titles : [];
    const cleaned = uniqTitles(titles);
    const filtered = cleaned.filter(t => safeTrim(t).toLowerCase() !== safeTrim(currentTitle).toLowerCase());
    return filtered.length ? filtered : fallback;
  } catch {
    // Any OpenAI failure (bad key, rate limit, too-large payload, network) should never crash the API.
    return fallback;
  }
}

function slimOfferDataForDescription(offerData: any): any {
  const o: any = (offerData && typeof offerData === 'object') ? offerData : {};

  const out: any = {
    name: clipString(o.name || o.offerName || o.offer_name, 140),
    category: clipString(o.category, 80),
    market: clipString(o.market, 80),
    primaryAvatar: clipString(o.primaryAvatar, 140),
    intendedGoal: clipString(o.intendedGoal, 260),
    headline: clipString(o.headline, 260),
    oneSentencePromise: clipString(o.oneSentencePromise, 260),
    priceText: clipString(o.priceText || o.price_text, 60),
    bundlePrice: Number.isFinite(Number(o.bundlePrice)) ? Number(o.bundlePrice) : undefined,
    percentOff: Number.isFinite(Number(o.percentOff)) ? Number(o.percentOff) : undefined,
    dollarOff: Number.isFinite(Number(o.dollarOff)) ? Number(o.dollarOff) : undefined,
    scarcityMechanism: clipString(o.scarcityMechanism, 160),
    riskReversal: clipString(o.riskReversal, 220),
    whatsIncluded: clipString(o.whatsIncluded, 700),
    eligibilityRules: clipString(o.eligibilityRules, 420),
  };

  if (Array.isArray(o.lineItems)) {
    out.lineItems = o.lineItems.slice(0, 14).map((li: any) => ({
      name: clipString(li?.name || li?.serviceName || li?.service, 120),
      qty: Number(li?.qty || 1) || 1,
      unitPrice: Number.isFinite(Number(li?.baseUnitPrice)) ? Number(li?.baseUnitPrice)
        : (Number.isFinite(Number(li?.unitPrice)) ? Number(li?.unitPrice) : undefined),
      notes: clipString(li?.notes, 180)
    })).filter((x: any) => x.name);
  }

  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v == null) delete out[k];
    else if (typeof v === 'string' && !v.trim()) delete out[k];
    else if (Array.isArray(v) && v.length === 0) delete out[k];
    else if (typeof v === 'number' && !Number.isFinite(v)) delete out[k];
  }

  return out;
}

async function aiOfferDescription(openaiClient: OpenAI | null, offerData: any): Promise<string | null> {
  if (!openaiClient) return null;

  const service = guessServiceLabel(offerData);
  const occasion = guessOccasionLabel(offerData);

  const prompt = `You are a senior direct-response marketer for Home2Smart (TV mounts, doorbells, cameras, smart home installs).

Goal: Write a clear offer description for an internal Offer Library record.

Constraints:
- 1 to 3 short paragraphs total (no markdown)
- 80 to 320 words
- Plain language, specific, not hypey
- Mention what the customer gets (services) and any key constraints (eligibility/scarcity) if available
- No emojis, no profanity, no ALL CAPS

Return VALID JSON ONLY in this exact shape:
{ "description": "string" }

Helpful seed:
- Occasion: ${occasion}
- Service: ${service}

OFFER_DATA_JSON:
${JSON.stringify(slimOfferDataForDescription(offerData))}`;

  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Return JSON only. No markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 420,
      response_format: { type: 'json_object' }
    });

    const parsed = tryParseJsonObject(completion.choices?.[0]?.message?.content || '');
    if (!parsed.ok) return null;
    const raw = parsed.value;
    const desc = safeTrim(raw?.description);
    if (!desc) return null;
    // Keep storage sane.
    return desc.length > 1600 ? (desc.slice(0, 1599) + '…') : desc;
  } catch {
    return null;
  }
}

// Helper to handle CORS
function corsHeaders(request?: Request): Record<string, string> {
  // Allow specific origins or use wildcard for non-credential requests
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://portal.home2smart.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080'
  ];
  
  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  // Build an allow-headers list that is resilient to casing and future custom headers.
  // Browsers send requested headers in Access-Control-Request-Headers during preflight.
  const requestedHeadersRaw = request?.headers.get('access-control-request-headers') || '';
  const requestedHeaders = requestedHeadersRaw
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);

  const baseAllowed = [
    'Content-Type',
    'Authorization',
    'X-H2S-Admin-Key',
    'x-h2s-admin-key',
    'X-H2S-Bootstrap-Secret',
    'x-h2s-bootstrap-secret'
  ];

  const allowHeaders = Array.from(new Set([...baseAllowed, ...requestedHeaders])).join(', ');
  
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': allowHeaders,
  };
  
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  
  return headers;
}

type DashboardAuthUser = {
  userId: string;
  username: string;
  displayName: string;
  role: 'VA' | 'ADMIN';
};

const DASHBOARD_SESSION_TOKEN_HEADER = 'authorization';
const DASHBOARD_SESSION_TTL_DAYS = 14;

function normalizeDashboardUsername(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 _\-@\.]/gi, '')
    .trim()
    .toUpperCase();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const s = String(b64url || '').trim();
  if (!s) return new Uint8Array();
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const buf = Buffer.from(b64 + pad, 'base64');
  return new Uint8Array(buf);
}

function constantTimeEquals(a: string, b: string): boolean {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

function getBearerToken(request: Request): string {
  const raw = String(request.headers.get(DASHBOARD_SESSION_TOKEN_HEADER) || '').trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

async function sha256Base64Url(text: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

async function pbkdf2Sha256Base64Url(pin: string, saltBytes: Uint8Array, iterations = 120000): Promise<string> {
  const enc = new TextEncoder();
  // Normalize to avoid TS BufferSource typing edge-cases (SharedArrayBuffer vs ArrayBuffer).
  const salt = Uint8Array.from(saltBytes || []);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(pin || '')), { name: 'PBKDF2' }, false, [
    'deriveBits'
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    keyMaterial,
    256
  );

  return bytesToBase64Url(new Uint8Array(bits));
}

function randomTokenBase64Url(bytesLen = 32): string {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function getDashboardAuthUserFromSession(request: Request): Promise<DashboardAuthUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  let db;
  try {
    db = getDeliverablesDb();
  } catch {
    return null;
  }

  try {
    const tokenHash = await sha256Base64Url(token);

    const { data: session, error: sessionError } = await db
      .from('Dashboard_Sessions')
      .select('Session_ID, User_ID, Expires_At')
      .eq('Token_Hash', tokenHash)
      .maybeSingle();

    if (sessionError || !session) return null;

    const expiresAt = session.Expires_At ? new Date(session.Expires_At) : null;
    if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;

    const { data: user, error: userError } = await db
      .from('Dashboard_Users')
      .select('User_ID, Username, Display_Name, Role, Is_Disabled')
      .eq('User_ID', session.User_ID)
      .maybeSingle();

    if (userError || !user) return null;
    if (user.Is_Disabled) return null;

    // Best-effort: update last seen
    try {
      await db
        .from('Dashboard_Sessions')
        .update({ Last_Seen_At: new Date().toISOString() })
        .eq('Session_ID', session.Session_ID);
    } catch {
      // ignore
    }

    const role = String(user.Role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA';

    return {
      userId: String(user.User_ID),
      username: String(user.Username || '').trim().toUpperCase(),
      displayName: String(user.Display_Name || user.Username || '').trim(),
      role
    };
  } catch {
    return null;
  }
}

function getConfiguredAdminToken(): string | null {
  const token = String(process.env.H2S_ADMIN_TOKEN || '').trim();
  return token ? token : null;
}

function getConfiguredDashboardAdminKey(): string | null {
  // A single shared admin key is the simplest operational model:
  // - used for emergency admin operations (create/reset accounts)
  // - not tied to any username
  // - never embedded in the frontend
  const key = String(process.env.H2S_DASHBOARD_ADMIN_KEY || '').trim();
  return key ? key : null;
}

function getConfiguredAnyAdminKey(): string | null {
  return getConfiguredDashboardAdminKey() || getConfiguredAdminToken() || getDashboardBootstrapSecret();
}

function getDashboardBootstrapSecret(): string | null {
  const token = String(process.env.H2S_DASHBOARD_BOOTSTRAP_SECRET || '').trim();
  return token ? token : null;
}

function generateNumericPin(length = 8): string {
  const n = Math.max(6, Math.min(16, Math.floor(length || 8)));
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += String(bytes[i] % 10);
  return out;
}

async function requireAdminToken(request: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const configured = getConfiguredAnyAdminKey();

  // Prefer session-admin auth when possible (lets Admin umbrella view work without shared secrets).
  const sessionUser = await getDashboardAuthUserFromSession(request);
  const sessionIsAdmin = !!sessionUser && sessionUser.role === 'ADMIN';

  // If a token is configured, require it.
  if (configured) {
    const provided = String(
      request.headers.get('x-h2s-admin-key') ||
        request.headers.get('x-h2s-bootstrap-secret') ||
        ''
    ).trim();
    if (provided && provided === configured) return { ok: true };
    if (sessionIsAdmin) return { ok: true };
    if (!provided) return { ok: false, status: 401, error: 'Missing admin token' };
    return { ok: false, status: 403, error: 'Invalid admin token' };
  }

  // If no shared token configured, allow admin via session.
  if (sessionIsAdmin) return { ok: true };

  return {
    ok: false,
    status: 403,
    error: 'Admin only: sign in with an ADMIN dashboard account (or set H2S_DASHBOARD_ADMIN_KEY / H2S_ADMIN_TOKEN)'
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function coercePositiveNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return isFinite(raw) && raw > 0 ? raw : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/-?\d[\d,]*(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(String(m[0]).replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function firstPositiveNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = coercePositiveNumber(v);
    if (n != null) return n;
  }
  return null;
}

function extractCustomerPriceFromOfferBriefText(raw: unknown): number | null {
  const text = String(raw || '');
  if (!text) return null;
  const m = text.match(/customer\s*price\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  return coercePositiveNumber(m[1]);
}

function extractServicesFromOfferBriefText(raw: unknown): string[] {
  const text = String(raw || '');
  if (!text) return [];
  const m = text.match(/services\s*:\s*([\s\S]*?)(?:\n|\r\n|customer\s*price\s*:|$)/i);
  const chunk = safeTrim(m ? m[1] : '');
  if (!chunk) return [];
  const parts = chunk
    .split(/\s*,\s*/)
    .map((x) => safeTrim(x))
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function normalizeOfferBuilderSnapshotForTotals(
  rawOfferBuilder: any,
  hints?: { packagePrice?: number | null; serviceNames?: string[] }
): any {
  const base = rawOfferBuilder && typeof rawOfferBuilder === 'object' && !Array.isArray(rawOfferBuilder) ? rawOfferBuilder : {};
  const existingItems = Array.isArray((base as any).lineItems) ? (base as any).lineItems : [];

  const normalizedExisting = existingItems
    .filter((x: any) => x && typeof x === 'object')
    .map((x: any) => {
      const baseUnitPrice = coercePositiveNumber((x as any).baseUnitPrice) ?? coercePositiveNumber((x as any).unitPrice) ?? 0;
      const qtyRaw = Number((x as any).qty);
      const qty = isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      return {
        ...x,
        qty,
        baseUnitPrice
      };
    });

  const hasPricedLineItem = normalizedExisting.some((x: any) => (coercePositiveNumber(x?.baseUnitPrice) ?? 0) > 0);
  if (hasPricedLineItem) {
    return {
      ...base,
      lineItems: normalizedExisting
    };
  }

  const priceHint = firstPositiveNumber(
    hints?.packagePrice,
    (base as any)?.totals?.customerPrice,
    (base as any)?.totals?.finalCustomerPrice,
    (base as any)?.finalCustomerPrice,
    (base as any)?.customerPrice,
    (base as any)?.bundlePrice
  );

  if (!priceHint) {
    return {
      ...base,
      lineItems: normalizedExisting
    };
  }

  const namesFromExisting = normalizedExisting
    .map((x: any) => safeTrim(x?.name || x?.serviceName || x?.service || ''))
    .filter(Boolean);
  const serviceNames = Array.isArray(hints?.serviceNames) && hints?.serviceNames.length
    ? hints!.serviceNames
    : namesFromExisting;

  const zeroItems = (serviceNames || []).map((name: string) => ({
    name,
    qty: 1,
    baseUnitPrice: 0
  }));

  return {
    ...base,
    pricingStrategy: 'sum',
    percentOff: 0,
    dollarOff: 0,
    bundlePrice: 0,
    lineItems: [
      ...zeroItems,
      {
        name: 'Package Price',
        qty: 1,
        baseUnitPrice: priceHint
      }
    ]
  };
}

function normalizePathPattern(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;

  let path = s;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname || '';
    } catch {
      return null;
    }
  }

  path = path.split('?')[0].split('#')[0].trim();
  if (!path) return null;
  if (!path.startsWith('/')) path = `/${path}`;
  return path.toLowerCase();
}

function normalizeMatchType(raw: unknown): 'exact' | 'prefix' {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'prefix' ? 'prefix' : 'exact';
}

type PathRuleRow = {
  id: string;
  pattern: string;
  match_type: 'exact' | 'prefix' | string;
  is_blocked: boolean;
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

// Cache for path rules to avoid DB query on every event check
let cachedPathRules: PathRuleRow[] | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

async function getCachedPathRules(): Promise<PathRuleRow[]> {
  const now = Date.now();
  if (cachedPathRules && now < cacheExpiry) {
    return cachedPathRules;
  }
  
  try {
    const db = getTrackingDb();
    const { data: rows } = await db
      .from('h2s_tracking_path_rules')
      .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
      .eq('is_blocked', true)
      .limit(1000);
    
    cachedPathRules = (rows || []) as PathRuleRow[];
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedPathRules;
  } catch (error) {
    console.error('Failed to load path rules:', error);
    return [];
  }
}

function pathMatchesRule(path: string, rule: PathRuleRow): boolean {
  const pattern = String(rule.pattern || '').trim().toLowerCase();
  if (!pattern) return false;
  if (rule.match_type === 'exact') return path === pattern;
  if (rule.match_type === 'prefix') {
    return path === pattern || path.startsWith(`${pattern}/`) || path.startsWith(pattern);
  }
  return false;
}

function getTrackingDb() {
  return getSupabaseDb1() || getSupabase();
}

function getDeliverablesDb() {
  // Deliverables are part of the internal/management workflow (tasks, hours, training).
  // In production, these live in the MGMT Supabase project.
  // Fall back to the main DB if MGMT credentials are not configured.
  try {
    return getSupabaseMgmt();
  } catch {
    return getSupabase();
  }
}

function isMissingTableError(error: any, tableName: string): boolean {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  const t = String(tableName || '').trim().toLowerCase();
  if (!t) return false;
  // Typical PostgREST message: "Could not find the table 'public.Offers' in the schema cache"
  if (msg.includes('could not find the table') && msg.includes(`public.${t}`)) return true;
  if (msg.includes('schema cache') && msg.includes(t)) return true;
  return false;
}

function isMissingColumnError(error: any, columnName: string): boolean {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  const col = String(columnName || '').trim().toLowerCase();
  if (!col) return false;
  // Postgres undefined_column
  if (String(error?.code || '') === '42703') return true;
  // Typical PostgREST message: "column Offers.Offer_ID does not exist"
  if (msg.includes('column') && msg.includes(col) && (msg.includes('does not exist') || msg.includes('not found'))) return true;
  return false;
}

function isOffersSchemaMismatchError(error: any): boolean {
  // Offers can exist in multiple DBs; in some environments, the MAIN DB also has an unrelated
  // "Offers" table (e.g., job offers/dispatch concepts). We fall back when either:
  // - the table is missing, OR
  // - the Offer Builder schema is missing required columns (Offer_ID).
  return isMissingTableError(error, 'Offers') || isMissingColumnError(error, 'offer_id') || isMissingColumnError(error, 'Offer_ID');
}

function isInvalidApiKeyError(error: any): boolean {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return msg.includes('invalid api key') || msg.includes('invalid apikey');
}

function getOffersDbFallback(): { primary: any; fallback: any } {
  // Offers sometimes live in MGMT (same place as Deliverables) depending on environment.
  // Prefer Deliverables/MGMT (where the dashboard workflow writes offers), then fall back to main.
  const primary = getDeliverablesDb();
  const fallback = getSupabase();
  return { primary, fallback };
}

function isMissingDeliverablesColumnError(error: any, columnName: string): boolean {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  const col = String(columnName || '').toLowerCase();
  return error?.code === '42703' || (msg.includes('column') && msg.includes(col) && (msg.includes('does not exist') || msg.includes('not found')));
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function smsPhoneQueryVariants(rawPhone: string): string[] {
  try {
    const out = new Set<string>();
    const raw = String(rawPhone || '').trim();
    if (raw) out.add(raw);
    const norm = normalizePhone(raw);
    if (norm) out.add(norm);

    const digits = raw.replace(/\D+/g, '');
    if (digits) out.add(digits);

    let ten = '';
    if (digits.length === 10) ten = digits;
    if (digits.length === 11 && digits.startsWith('1')) ten = digits.slice(1);

    if (ten) {
      out.add(ten);
      out.add(`1${ten}`);
      out.add(`+1${ten}`);
    }

    return Array.from(out).filter(Boolean).slice(0, 6);
  } catch {
    return [String(rawPhone || '').trim()].filter(Boolean);
  }
}

function toEventType(event: TrackingEventRow): string {
  return String(event.event_type || event.event_name || '').trim() || 'unknown';
}

function safeFloat(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeRevenueAmount(value: unknown): number {
  // Production data can contain either dollars (e.g. 249.00) or cents (e.g. 24900).
  // Heuristic: treat large integer-ish values as cents and convert to dollars.
  const rawString = typeof value === 'string' ? value.trim() : '';
  const n = safeFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;

  const looksIntegerString = rawString ? /^\d+$/.test(rawString) : false;
  const looksIntegerNumber = typeof n === 'number' && Number.isInteger(n);
  const looksLikeCents = (looksIntegerString || looksIntegerNumber) && n >= 10000;

  return looksLikeCents ? n / 100 : n;
}

function normalizeTrackingEventType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 'unknown';

  const normalized = s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  // Meta Pixel canonical names + common variants
  const metaPixelMap: Record<string, string> = {
    pageview: 'page_view',
    page_view: 'page_view',
    viewcontent: 'view_content',
    view_content: 'view_content',
    addtocart: 'add_to_cart',
    initiatecheckout: 'initiate_checkout',
    completeregistration: 'complete_registration',
    lead: 'lead',
    purch: 'purchase',
    purchase: 'purchase'
  };
  if (metaPixelMap[normalized]) return metaPixelMap[normalized];

  if (normalized === 'complete_registration') return 'complete_registration';
  if (normalized === 'add_to_cart') return 'add_to_cart';
  if (normalized === 'initiate_checkout') return 'initiate_checkout';
  if (normalized === 'click') return 'click';
  if (normalized.endsWith('_click') || normalized.includes('click')) return 'click';

  if (normalized === 'form_submit') return 'form_submit';
  if (normalized.includes('form') && normalized.includes('submit')) return 'form_submit';

  if (normalized === 'outbound_click') return 'outbound_click';

  return normalized;
}

function isAllowedTrackingEventType(eventType: string): boolean {
  // Keep explicit: only accept events we intentionally track.
  const allowed = new Set([
    'page_view',
    'view_content',
    'lead',
    'complete_registration',
    'add_to_cart',
    'initiate_checkout',
    'purchase',
    'click',
    'form_submit',
    'outbound_click'
  ]);
  return allowed.has(eventType);
}

function numOrZero(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : 0;
}

function extractOrderMeta(order: any): any {
  return parseMaybeJson(order?.metadata_json) || parseMaybeJson(order?.metadata) || {};
}

function computeRevenueFromItems(items: any[]): number {
  let subtotal = 0;
  for (const it of items || []) {
    if (!it || it.type === 'product') continue;
    const line = numOrZero(it.line_total ?? it.lineTotal ?? it.line_customer_total ?? it.lineCustomerTotal);
    if (line > 0) {
      subtotal += normalizeRevenueAmount(line);
      continue;
    }
    const qty = numOrZero(it.qty ?? it.quantity) || 1;
    const unit = numOrZero(it.unit_price ?? it.unitPrice ?? it.price);
    if (unit > 0) subtotal += qty * normalizeRevenueAmount(unit);
  }
  return subtotal;
}

function computeOrderRevenueAmount(order: any): number {
  const meta = extractOrderMeta(order);

  const direct =
    numOrZero(order?.total) ||
    numOrZero(order?.order_total) ||
    numOrZero(order?.total_amount) ||
    numOrZero(order?.amount_paid) ||
    numOrZero(order?.subtotal) ||
    numOrZero(order?.order_subtotal) ||
    numOrZero(meta?.total) ||
    numOrZero(meta?.order_total) ||
    numOrZero(meta?.total_amount) ||
    numOrZero(meta?.subtotal) ||
    numOrZero(meta?.order_subtotal);

  if (direct > 0) return normalizeRevenueAmount(direct);

  const items =
    Array.isArray(meta?.items_json) ? meta.items_json : Array.isArray(parseMaybeJson(meta?.items_json)) ? parseMaybeJson(meta?.items_json) : null;
  if (Array.isArray(items)) {
    const fromItems = computeRevenueFromItems(items);
    if (fromItems > 0) return fromItems;
  }

  return 0;
}

function isTestOrderRow(order: any): boolean {
  const meta = extractOrderMeta(order);
  const email = normalizeMaybeString(order?.customer_email || meta?.customer_email || meta?.email);
  const phone = normalizeMaybeString(order?.customer_phone || meta?.customer_phone || meta?.phone);
  const orderId = normalizeMaybeString(order?.order_id || meta?.order_id || order?.id);

  if (email && TEST_KEYWORDS.some((k) => email.includes(k))) return true;
  if (orderId && TEST_KEYWORDS.some((k) => orderId.includes(k))) return true;
  if (phone && (TEST_KEYWORDS.some((k) => phone.includes(k)) || looksLikeTestPhone(phone))) return true;
  return false;
}

async function fetchAllRows<T>(
  // Supabase's Postgrest builders are thenables but not typed as Promise in TS.
  // Accept any and await it.
  queryPage: (rangeFrom: number, rangeTo: number) => any,
  pageSize = 1000,
  maxRows = 100000
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const res = await queryPage(offset, offset + pageSize - 1);
    const data = res?.data;
    const error = res?.error;
    if (error) throw error;
    const rows: T[] = Array.isArray(data) ? data : [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

const TEST_KEYWORDS = ['test', 'demo', 'sample', 'fake', 'example', 'asdf', 'qwer', 'zzz', 'xxx'];
const MAX_JSON_PARSE_CHARS = 250000;

function normalizeMaybeString(value: unknown): string {
  if (value == null) return '';
  return String(value).toLowerCase().trim();
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  if (value.length > MAX_JSON_PARSE_CHARS) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeTestPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return false;
  if (digits.includes('555')) return true;
  if (/^(0{7,}|1{7,}|2{7,}|3{7,}|4{7,}|5{7,}|6{7,}|7{7,}|8{7,}|9{7,})$/.test(digits)) return true;
  if (digits.includes('0000') || digits.includes('1234')) return true;
  return false;
}

function isTestTrackingEvent(event: any): boolean {
  const email = normalizeMaybeString(event?.customer_email);
  const phone = normalizeMaybeString(event?.customer_phone);
  const orderId = normalizeMaybeString(event?.order_id);

  if (email && TEST_KEYWORDS.some((k) => email.includes(k))) return true;
  if (orderId && TEST_KEYWORDS.some((k) => orderId.includes(k))) return true;
  if (phone && (TEST_KEYWORDS.some((k) => phone.includes(k)) || looksLikeTestPhone(phone))) return true;

  const metadata = parseMaybeJson(event?.metadata);
  if (metadata && typeof metadata === 'object') {
    const metaText = normalizeMaybeString(
      [
        metadata.name,
        metadata.full_name,
        metadata.customer_name,
        metadata.email,
        metadata.customer_email,
        metadata.phone,
        metadata.customer_phone
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (metaText && TEST_KEYWORDS.some((k) => metaText.includes(k))) return true;
    if (metaText && looksLikeTestPhone(metaText)) return true;
  }

  return false;
}

function toPathFromEvent(event: any): string {
  const raw = typeof event?.page_path === 'string' ? event.page_path : '';
  if (raw && raw.trim()) return raw.trim();
  const url = typeof event?.page_url === 'string' ? event.page_url : '';
  if (!url) return '';
  try {
    return new URL(url).pathname || '';
  } catch {
    return '';
  }
}

function normalizePathForInternalCheck(path: string): string {
  const p = String(path || '').trim();
  if (!p) return '';
  const normalized = p.startsWith('/') ? p : `/${p}`;
  return normalized.toLowerCase();
}

function isInternalTrackingPathFromEvent(event: any, customRules?: PathRuleRow[]): boolean {
  const p = normalizePathForInternalCheck(toPathFromEvent(event));
  if (!p) return false;
  
  // Check hardcoded internal paths
  const blockedRoots = ['/funnels', '/dashboard', '/portal', '/dispatch', '/funnel-track'];
  const isHardcodedInternal = blockedRoots.some((root) => p === root || p.startsWith(`${root}/`));
  if (isHardcodedInternal) return true;
  
  // Check custom database rules if provided
  if (customRules && customRules.length > 0) {
    return customRules.some(rule => rule.is_blocked && pathMatchesRule(p, rule));
  }
  
  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAiInsightsToHtml(payload: any): string {
  const title = escapeHtml(payload?.executive_summary?.headline || 'AI Funnel Insights');
  const summaryBullets: string[] = Array.isArray(payload?.executive_summary?.top_priorities)
    ? payload.executive_summary.top_priorities
    : [];

  const windowLabel = (() => {
    const start = payload?.meta?.start;
    const end = payload?.meta?.end;
    if (start && end) {
      // Keep this simple and deterministic: show ISO timestamps as returned.
      return `${start} to ${end}`;
    }
    const days = payload?.meta?.days;
    return `Last ${escapeHtml(String(days || 30))} days`;
  })();

  const kpis = payload?.kpis || {};
  const recs: any[] = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
  const experiments: any[] = Array.isArray(payload?.experiments) ? payload.experiments : [];
  const risks: string[] = Array.isArray(payload?.diagnostics?.data_quality_issues)
    ? payload.diagnostics.data_quality_issues
    : [];

  const kpiTable = [
    ['Events', kpis.total_events],
    ['Unique visitors', kpis.unique_visitors],
    ['Unique sessions', kpis.unique_sessions],
    ['Leads', kpis.leads],
    ['Purchases', kpis.purchases],
    ['Revenue', kpis.total_revenue != null ? `$${Number(kpis.total_revenue).toFixed(2)}` : null],
    ['AOV', kpis.avg_order_value != null ? `$${Number(kpis.avg_order_value).toFixed(2)}` : null],
    ['Visitor→Lead', kpis.visitor_to_lead_rate != null ? `${Number(kpis.visitor_to_lead_rate).toFixed(2)}%` : null],
    ['Lead→Purchase', kpis.lead_to_purchase_rate != null ? `${Number(kpis.lead_to_purchase_rate).toFixed(2)}%` : null],
    ['Visitor→Purchase', kpis.visitor_to_purchase_rate != null ? `${Number(kpis.visitor_to_purchase_rate).toFixed(2)}%` : null]
  ]
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e7eaf0;"><strong>${escapeHtml(String(k))}</strong></td><td style="padding:6px 10px;border-bottom:1px solid #e7eaf0;">${escapeHtml(String(v))}</td></tr>`)
    .join('');

  const bulletsHtml = summaryBullets.length
    ? `<ul>${summaryBullets.map((b) => `<li>${escapeHtml(String(b))}</li>`).join('')}</ul>`
    : '<p>No priorities returned.</p>';

  const recsHtml = recs.length
    ? `<ol>${recs
        .slice(0, 12)
        .map((r) => {
          const t = escapeHtml(String(r?.title || 'Recommendation'));
          const impact = escapeHtml(String(r?.impact || ''));
          const effort = escapeHtml(String(r?.effort || ''));
          const metric = escapeHtml(String(r?.metric_to_move || ''));
          const why = escapeHtml(String(r?.why || ''));
          const how = escapeHtml(String(r?.how || ''));
          const expected = escapeHtml(String(r?.expected_lift || ''));
          const metaBits = [
            impact ? `Impact: ${impact}` : '',
            effort ? `Effort: ${effort}` : '',
            metric ? `Metric: ${metric}` : '',
            expected ? `Expected lift: ${expected}` : ''
          ].filter(Boolean);
          const meta = metaBits.length ? `<div style="margin:6px 0;color:#5f6368;">${metaBits.join(' • ')}</div>` : '';
          return `<li style="margin:10px 0;"><strong>${t}</strong>${meta}${why ? `<div><em>Why:</em> ${why}</div>` : ''}${how ? `<div><em>How:</em> ${how}</div>` : ''}</li>`;
        })
        .join('')}</ol>`
    : '<p>No recommendations returned.</p>';

  const experimentsHtml = experiments.length
    ? `<ul>${experiments
        .slice(0, 10)
        .map((e) => `<li><strong>${escapeHtml(String(e?.title || 'Experiment'))}</strong>${e?.hypothesis ? ` — ${escapeHtml(String(e.hypothesis))}` : ''}</li>`)
        .join('')}</ul>`
    : '';

  const risksHtml = risks.length
    ? `<ul>${risks.slice(0, 10).map((r) => `<li>${escapeHtml(String(r))}</li>`).join('')}</ul>`
    : '';

  return `
    <div style="color:#0a2a5a;line-height:1.7;">
      <h2 style="margin:0 0 10px 0;">${title}</h2>
      <p style="margin:0 0 16px 0;color:#5f6368;">Generated ${escapeHtml(String(payload?.generated_at || ''))}</p>

      <h3 style="margin:18px 0 8px 0;">Key Priorities</h3>
      ${bulletsHtml}

      <h3 style="margin:18px 0 8px 0;">KPIs (${escapeHtml(windowLabel)})</h3>
      <table style="border-collapse:collapse;width:100%;max-width:720px;background:#fff;border:1px solid #e7eaf0;border-radius:12px;overflow:hidden;">
        <tbody>${kpiTable}</tbody>
      </table>

      <h3 style="margin:18px 0 8px 0;">Recommendations</h3>
      ${recsHtml}

      ${experimentsHtml ? `<h3 style="margin:18px 0 8px 0;">Suggested Experiments</h3>${experimentsHtml}` : ''}
      ${risksHtml ? `<h3 style="margin:18px 0 8px 0;">Data Quality / Tracking Notes</h3>${risksHtml}` : ''}
    </div>
  `;
}

async function buildAiReport(params: {
  request: Request;
  days: number;
  limit: number;
  startDate?: string;
  endDate?: string;
  minDate?: string;
}): Promise<{ status: 'success' | 'error'; report?: string; insights?: any; message?: string; timestamp: string }> {
  if (!openai) {
    return { status: 'error', message: 'OpenAI not configured', timestamp: new Date().toISOString() };
  }

  const { searchParams } = new URL(params.request.url);
  const excludeTest = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('exclude_test') || searchParams.get('excludeTest') || '').toLowerCase()
  );
  const includeInternal = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('include_internal') || searchParams.get('includeInternal') || '').toLowerCase()
  );
  const excludeInternal = !includeInternal;
  const customPathRules = excludeInternal ? await getCachedPathRules() : [];

  const days = Math.min(Math.max(params.days, 1), 365);
  const limit = Math.min(Math.max(params.limit, 200), 10000);

  // Use explicit date range if provided, otherwise calculate from days.
  // If only one side is provided, infer the other side.
  const inferredEnd = params.endDate || new Date().toISOString();
  const inferredStart = (() => {
    if (params.startDate) return params.startDate;
    const end = new Date(inferredEnd);
    if (isNaN(end.getTime())) {
      const start = new Date();
      start.setDate(start.getDate() - days);
      return start.toISOString();
    }
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - days);
    return start.toISOString();
  })();

  const queryStart = inferredStart;
  const queryEnd = inferredEnd;

  const trackingDb = getTrackingDb();
  let query = trackingDb
    .from('h2s_tracking_events')
    // Memory guardrail: avoid selecting wide rows (metadata blobs, raw payloads, etc).
    // Keep only fields used by reporting + test/internal filters.
    .select(
      'visitor_id,session_id,occurred_at,event_type,event_name,page_path,page_url,utm_source,utm_medium,utm_campaign,revenue_amount,customer_email,customer_phone,order_id'
    )
    .order('occurred_at', { ascending: false });
  
  // Apply date filters
  if (params.minDate) {
    query = query.gte('occurred_at', params.minDate);
  }
  query = query.gte('occurred_at', queryStart).lte('occurred_at', queryEnd);
  
  // Prefetch more rows so in-memory filters (test/internal) don't starve the AI input,
  // but cap the fetch size to prevent OOM in constrained runtimes (e.g. Vercel lambdas).
  const prefilterLimit = Math.min(Math.max(limit * 3, limit), 10000);
  const { data: reportEvents, error } = await query.limit(prefilterLimit);

  if (error) {
    return { status: 'error', message: `Database error: ${error.message}`, timestamp: new Date().toISOString() };
  }

  let events: TrackingEventRow[] = (reportEvents || []) as any;
  if (excludeTest) {
    events = events.filter((e: any) => !isTestTrackingEvent(e));
  }
  if (excludeInternal) {
    events = events.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
  }
  if (events.length > limit) {
    events = events.slice(0, limit);
  }
  const uniqueVisitors = new Set(events.map((e) => e.visitor_id).filter(Boolean)).size;
  const uniqueSessions = new Set(events.map((e) => e.session_id).filter(Boolean)).size;

  const purchases = events.filter((e) => toEventType(e).toLowerCase() === 'purchase');
  const totalRevenue = purchases.reduce((sum, e) => sum + safeFloat(e.revenue_amount), 0);

  const leads = events.filter((e) => {
    const t = toEventType(e).toLowerCase();
    return t === 'lead' || t === 'complete_registration';
  });

  // Funnel counts (best-effort)
  const pageViews = events.filter((e) => {
    const t = toEventType(e).toLowerCase();
    return t === 'page_view' || t === 'pageview' || t === 'view_content' || t === 'viewcontent';
  }).length;

  const visitorToLeadRate = uniqueVisitors > 0 ? (leads.length / uniqueVisitors) * 100 : 0;
  const leadToPurchaseRate = leads.length > 0 ? (purchases.length / leads.length) * 100 : 0;
  const visitorToPurchaseRate = uniqueVisitors > 0 ? (purchases.length / uniqueVisitors) * 100 : 0;
  const avgOrderValue = purchases.length > 0 ? totalRevenue / purchases.length : 0;

  // UTM + page performance summaries
  const sourceBreakdown: Record<string, number> = {};
  const sourceMetrics: Record<string, { events: number; leads: number; purchases: number; revenue: number }> = {};
  const pageMetrics: Record<string, { views: number; engagement: number; leads: number; purchases: number; revenue: number }> = {};

  for (const e of events) {
    const source = (e.utm_source || 'direct') as string;
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
    sourceMetrics[source] ||= { events: 0, leads: 0, purchases: 0, revenue: 0 };
    sourceMetrics[source].events += 1;

    const t = toEventType(e).toLowerCase();
    if (t === 'lead' || t === 'complete_registration') sourceMetrics[source].leads += 1;
    if (t === 'purchase') {
      sourceMetrics[source].purchases += 1;
      sourceMetrics[source].revenue += safeFloat(e.revenue_amount);
    }

    const path = (e.page_path || '').trim();
    if (!path) continue;
    pageMetrics[path] ||= { views: 0, engagement: 0, leads: 0, purchases: 0, revenue: 0 };
    if (t === 'page_view' || t === 'pageview') pageMetrics[path].views += 1;
    if (t === 'view_content' || t === 'viewcontent') pageMetrics[path].engagement += 1;
    if (t === 'lead' || t === 'complete_registration') pageMetrics[path].leads += 1;
    if (t === 'purchase') {
      pageMetrics[path].purchases += 1;
      pageMetrics[path].revenue += safeFloat(e.revenue_amount);
    }
  }

  const scoredPages = Object.entries(pageMetrics)
    .map(([path, m]) => {
      const score = m.views * 1 + m.engagement * 2 + m.leads * 5 + m.purchases * 10 + m.revenue / 10;
      const conversionRate = m.views > 0 ? ((m.leads + m.purchases) / m.views) * 100 : 0;
      return {
        path,
        score: Math.round(score),
        views: m.views,
        engagement: m.engagement,
        leads: m.leads,
        purchases: m.purchases,
        revenue: m.revenue,
        conversion_rate: Number(conversionRate.toFixed(2))
      };
    })
    .sort((a, b) => b.score - a.score);

  const topPages = scoredPages.slice(0, 8);
  const underperformingPages = scoredPages
    .filter((p) => p.views >= 50 && p.conversion_rate < 1 && p.purchases === 0)
    .slice(0, 8);

  const dataQualityIssues: string[] = [];
  const missingVisitorPct = events.length ? (events.filter((e) => !e.visitor_id).length / events.length) * 100 : 0;
  const missingPathPct = events.length ? (events.filter((e) => !e.page_path).length / events.length) * 100 : 0;
  if (missingVisitorPct > 2) dataQualityIssues.push(`High missing visitor_id rate: ${missingVisitorPct.toFixed(1)}%`);
  if (missingPathPct > 10) dataQualityIssues.push(`High missing page_path rate: ${missingPathPct.toFixed(1)}%`);

  const aiInput = {
    window: { days, start: queryStart, end: queryEnd },
    filters: {
      exclude_test: excludeTest,
      exclude_internal: excludeInternal,
      min_date: params.minDate || null
    },
    kpis: {
      total_events: events.length,
      unique_visitors: uniqueVisitors,
      unique_sessions: uniqueSessions,
      page_views: pageViews,
      leads: leads.length,
      purchases: purchases.length,
      total_revenue: Number(totalRevenue.toFixed(2)),
      avg_order_value: Number(avgOrderValue.toFixed(2)),
      visitor_to_lead_rate: Number(visitorToLeadRate.toFixed(2)),
      lead_to_purchase_rate: Number(leadToPurchaseRate.toFixed(2)),
      visitor_to_purchase_rate: Number(visitorToPurchaseRate.toFixed(2))
    },
    sources: Object.entries(sourceMetrics)
      .map(([source, m]) => ({
        source,
        events: m.events,
        leads: m.leads,
        purchases: m.purchases,
        revenue: Number(m.revenue.toFixed(2))
      }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 12),
    top_pages: topPages,
    underperforming_pages: underperformingPages,
    data_quality_issues: dataQualityIssues,
    notes: {
      source_breakdown: sourceBreakdown
    }
  };

  const prompt = `You are a senior growth analyst for Home2Smart.\n\nYou will receive funnel analytics (already aggregated). Your job is to: (1) diagnose the funnel, (2) find leverage points, (3) propose specific experiments and fixes, and (4) call out tracking/data-quality issues.\n\nReturn valid JSON ONLY (no markdown) in this exact shape:\n\n{\n  \"executive_summary\": {\n    \"headline\": \"string\",\n    \"what_changed\": [\"string\"],\n    \"top_priorities\": [\"string\"]\n  },\n  \"kpis\": {\n    \"total_events\": number,\n    \"unique_visitors\": number,\n    \"unique_sessions\": number,\n    \"page_views\": number,\n    \"leads\": number,\n    \"purchases\": number,\n    \"total_revenue\": number,\n    \"avg_order_value\": number,\n    \"visitor_to_lead_rate\": number,\n    \"lead_to_purchase_rate\": number,\n    \"visitor_to_purchase_rate\": number\n  },\n  \"insights\": {\n    \"what_worked\": [\"string\"],\n    \"what_didnt\": [\"string\"],\n    \"source_insights\": [\"string\"],\n    \"page_insights\": [\"string\"]\n  },\n  \"diagnostics\": {\n    \"data_quality_issues\": [\"string\"],\n    \"tracking_gaps\": [\"string\"],\n    \"notes\": [\"string\"]\n  },\n  \"recommendations\": [\n    {\n      \"title\": \"string\",\n      \"impact\": \"high|medium|low\",\n      \"effort\": \"low|medium|high\",\n      \"metric_to_move\": \"string\",\n      \"expected_lift\": \"string\",\n      \"why\": \"string\",\n      \"how\": \"string\",\n      \"owner\": \"marketing|product|engineering|ops\",\n      \"timeframe\": \"this week|this month\"\n    }\n  ],\n  \"experiments\": [\n    {\n      \"title\": \"string\",\n      \"hypothesis\": \"string\",\n      \"setup\": \"string\",\n      \"success_metric\": \"string\",\n      \"duration\": \"string\"\n    }\n  ],\n  \"questions\": [\"string\"],\n  \"confidence\": {\n    \"rating\": \"high|medium|low\",\n    \"reasons\": [\"string\"]\n  },\n  \"assumptions\": [\"string\"]\n}\n\nBe extremely concrete. Reference the provided top_pages and underperforming_pages in at least 3 recommendations. If purchases are low, focus on lead quality + checkout friction + retargeting.\n\nINPUT_JSON:\n${JSON.stringify(aiInput)}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a rigorous growth analyst. Always return valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1800,
    response_format: { type: 'json_object' }
  });

  let insights: any;
  try {
    insights = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
  } catch {
    return { status: 'error', message: 'Failed to parse AI response', timestamp: new Date().toISOString() };
  }

  // Ensure the KPIs in the response match the computed truth (avoid hallucinated numbers)
  insights.kpis = aiInput.kpis;
  insights.meta = {
    days,
    limit,
    start: aiInput.window.start,
    end: aiInput.window.end,
    filters: aiInput.filters
  };
  insights.generated_at = new Date().toISOString();
  if (!insights.diagnostics) insights.diagnostics = {};
  if (!Array.isArray(insights.diagnostics.data_quality_issues)) insights.diagnostics.data_quality_issues = [];
  insights.diagnostics.data_quality_issues = Array.from(new Set([...(insights.diagnostics.data_quality_issues || []), ...dataQualityIssues]));

  const html = renderAiInsightsToHtml(insights);
  return { status: 'success', report: html, insights, timestamp: insights.generated_at };
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (!action) {
    return missingActionResponse(request, 'GET');
  }

  const excludeTest = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('exclude_test') || searchParams.get('excludeTest') || '').toLowerCase()
  );

  // Default: exclude internal/admin pages from analytics unless explicitly included.
  const includeInternal = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('include_internal') || searchParams.get('includeInternal') || '').toLowerCase()
  );
  const excludeInternal = !includeInternal;

  const debug = ['1', 'true', 'yes', 'on'].includes(String(searchParams.get('debug') || '').toLowerCase());
  
  // Parse date range filters
  const startDate = searchParams.get('start_date') || searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('end_date') || searchParams.get('endDate') || undefined;
  const minDate = searchParams.get('min_date') || searchParams.get('minDate') || undefined;
  
  // Preload custom path exclusion rules (cached for 1 minute)
  const customPathRules = excludeInternal ? await getCachedPathRules() : [];
  
  // Force fresh build - v2
  try {
    let result;

    // Some features (training, candidates, tasks, hours, etc.) live in the Mgmt DB.
    // Prefer Mgmt creds when present, but don't hard-fail if they're not configured.
    const supabaseMain = getSupabase();
    const supabaseMgmtClient = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return null;
      }
    })();
    const supabaseMgmt = supabaseMgmtClient || supabaseMain;

    switch (action) {
      case 'taskCreatorConfig':
        {
          result = {
            minWords: getMinWords(),
            categories: getTaskCategories()
          };
        }
        break;
      case 'dashboardMe':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          // Keep the response lean; UI primarily needs username + role.
          result = {
            userId: me.userId,
            username: me.username,
            displayName: me.displayName,
            role: me.role
          };
        }
        break;
      case 'dashboardUsers':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const db = getDeliverablesDb();
          const { data: users, error } = await db
            .from('Dashboard_Users')
            .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled, Created_At, Updated_At, Last_Login_At')
            .order('Created_At', { ascending: false })
            .limit(500);

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to load users: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = users || [];
        }
        break;
      case 'smsThreads':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 500), 1), 500);
          const db = getDeliverablesDb();
          const { data, error } = await db
            .from('sms_threads')
            .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(limit);

          if (error) {
            const msg = isMissingTableError(error, 'sms_threads')
              ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
              : `Failed to load threads: ${error.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          // Filter out hidden conversations for this user (soft delete / archive)
          let hiddenThreadIds = new Set<string>();
          try {
            const { data: hidden, error: hErr } = await db
              .from('sms_hidden_conversations')
              .select('conversation_id')
              .eq('owner_user_id', me.userId)
              .eq('conversation_type', 'thread')
              .limit(5000);

            if (!hErr && Array.isArray(hidden)) {
              hiddenThreadIds = new Set(hidden.map((r: any) => String(r.conversation_id || '').trim()).filter(Boolean));
            }
          } catch {
            // ignore
          }

          const hiddenThreads = Array.from(hiddenThreadIds.values()).filter(Boolean);

          const withHiddenFlag = (data || []).map((t: any) => {
            const tid = String(t?.thread_id || '').trim();
            return { ...(t || {}), hidden: !!(tid && hiddenThreadIds.has(tid)) };
          });

          // Portal bundle expects: { ok, threads, hidden_threads }
          // Legacy dashboards expect: { ok, smsThreads }
          const visible = withHiddenFlag.filter((t: any) => !t?.hidden);
          return NextResponse.json(
            {
              ok: true,
              threads: visible,
              smsThreads: visible,
              hidden_threads: hiddenThreads
            },
            { headers: corsHeaders(request) }
          );
        }
        // break; (unreachable)
      case 'smsContacts':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 2000), 1), 5000);
          const db = getDeliverablesDb();

          const { data: rows, error } = await db
            .from('sms_threads')
            .select('thread_id, contact_phone, contact_name, last_message_at')
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(limit);

          if (error) {
            const msg = isMissingTableError(error, 'sms_threads')
              ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
              : `Failed to load contacts: ${error.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          const contacts = (rows || [])
            .map((r: any) => {
              const phone = normalizePhone(String(r?.contact_phone || '').trim()) || String(r?.contact_phone || '').trim();
              return {
                phone,
                contact_phone: phone,
                contact_name: r?.contact_name != null ? String(r.contact_name) : null,
                thread_id: r?.thread_id != null ? String(r.thread_id) : null
              };
            })
            .filter((c: any) => c && c.phone);

          return NextResponse.json({ ok: true, contacts }, { headers: corsHeaders(request) });
        }
        // break; (unreachable)
      case 'smsGroups':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 120), 1), 250);
          const db = getDeliverablesDb();

          // Best-effort: some upstream systems (or legacy dashboard flows) perform a "group send"
          // as multiple 1:1 OUTBOUND SMS messages (fan-out), without calling smsGroupUpsert/smsGroupSend.
          // If we don't persist an sms_groups row, the inbox cannot "detect" that a group exists.
          //
          // Heuristic: within a short time bucket, if the same sender sends the same body to 2+
          // different recipients, auto-create (or reuse) a group by member_key and tag those
          // messages with sms_messages.group_id.
          try {
            // Throttle: this endpoint is polled by the dashboard; keep the heuristic work bounded.
            // (Best-effort only; safe to skip occasionally.)
            const nowMs = Date.now();
            const lastRunMs = (globalThis as any).__smsFanoutAutoTagLastRunMs || 0;
            const tooSoon = lastRunMs && (nowMs - Number(lastRunMs || 0)) < 60_000;
            if (tooSoon) {
              throw new Error('skip: fanout auto-tag throttled');
            }
            (globalThis as any).__smsFanoutAutoTagLastRunMs = nowMs;

            // Run for all roles. This endpoint is polled by the dashboard, and admins
            // also need group auto-detection for legacy fan-out sends.
            {
              // Skip if schema is missing group_id.
              const { error: probeErr } = await db.from('sms_messages').select('group_id').limit(1);
              const supportsGroupId = !(probeErr && isMissingColumnError(probeErr, 'group_id'));

              if (supportsGroupId) {
                const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // last 7 days
                const { data: recentOut, error: outErr } = await db
                  .from('sms_messages')
                  .select(
                    'message_id, thread_id, direction, body, to_phone, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id'
                  )
                  .eq('direction', 'OUTBOUND')
                  .gte('created_at', sinceIso)
                  .order('created_at', { ascending: false })
                  .limit(800);

                if (!outErr && Array.isArray(recentOut) && recentOut.length) {
                  const normKey = (x: any) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                  const normalizeLegacyBody = (rawBody: any, senderHint: any) => {
                    const s = safeTrim(rawBody);
                    if (!s) return '';
                    const hint = safeTrim(senderHint);
                    if (hint && s.startsWith('[')) {
                      const end = s.indexOf(']');
                      if (end > 1 && end < 80) {
                        const tag = s.slice(1, end).trim();
                        if (normKey(tag) === normKey(hint)) {
                          const after = s.slice(end + 1).trimStart();
                          if (after) return after;
                        }
                      }
                    }
                    return s;
                  };

                  const sigFor = (m: any) => {
                    try {
                      const senderId = safeTrim(m?.sent_by_user_id || m?.sent_by_username || m?.sent_by_display_name || '');
                      if (!senderId) return '';
                      const hint = safeTrim(m?.sent_by_display_name || m?.sent_by_username || '');
                      const bodyKey = normalizeLegacyBody(m?.body, hint).toLowerCase();
                      if (!bodyKey) return '';
                      const at = safeTrim(m?.created_at || '');
                      const t = at ? new Date(at).getTime() : 0;
                      if (!t || isNaN(t)) return '';
                      const slot = Math.floor(t / 120000); // 2m slots
                      return `${senderId}::${slot}::${bodyKey}`;
                    } catch {
                      return '';
                    }
                  };

                  const clusters = new Map<
                    string,
                    { messageIds: string[]; phones: Set<string>; threadIds: Set<string> }
                  >();

                  for (const m of recentOut) {
                    const gid = safeTrim((m as any)?.group_id || '');
                    if (gid) continue;
                    const sig = sigFor(m);
                    if (!sig) continue;
                    const mid = safeTrim((m as any)?.message_id || '');
                    const tid = safeTrim((m as any)?.thread_id || '');
                    const toRaw = safeTrim((m as any)?.to_phone || '');
                    const toPhone = normalizePhone(toRaw) || toRaw;
                    if (!mid || !tid || !toPhone) continue;

                    if (!clusters.has(sig)) clusters.set(sig, { messageIds: [], phones: new Set(), threadIds: new Set() });
                    const c = clusters.get(sig)!;
                    c.messageIds.push(mid);
                    c.phones.add(toPhone);
                    c.threadIds.add(tid);
                  }

                  // Persist at most a few per request to keep this endpoint fast.
                  let createdOrTagged = 0;
                  for (const c of Array.from(clusters.values())) {
                    if (createdOrTagged >= 8) break;
                    if (!c || c.phones.size < 2 || c.threadIds.size < 2) continue;
                    const uniquePhones = Array.from(c.phones).filter(Boolean);
                    uniquePhones.sort();
                    const memberKey = uniquePhones.join('|');
                    if (!memberKey) continue;

                    // Reuse existing group across owners when possible (shared inbox behavior).
                    const { data: existingByKey } = await db
                      .from('sms_groups')
                      .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
                      .eq('member_key', memberKey)
                      .order('updated_at', { ascending: false })
                      .limit(1)
                      .maybeSingle();

                    let groupId = safeTrim((existingByKey as any)?.group_id || '');
                    if (!groupId) {
                      const { data: created, error: createErr } = await db
                        .from('sms_groups')
                        .upsert(
                          {
                            owner_user_id: me.userId,
                            member_key: memberKey,
                            group_name: null
                          },
                          { onConflict: 'owner_user_id,member_key' }
                        )
                        .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
                        .single();

                      if (createErr || !created) continue;
                      groupId = safeTrim((created as any)?.group_id || '');
                    }

                    if (!groupId) continue;

                    try {
                      const memberRows = uniquePhones.map((p) => ({ group_id: groupId, contact_phone: p }));
                      await db.from('sms_group_members').upsert(memberRows, { onConflict: 'group_id,contact_phone' });
                    } catch {
                      // ignore
                    }

                    // Tag the fan-out messages so the group timeline + group activity detection works.
                    try {
                      await db
                        .from('sms_messages')
                        .update({ group_id: groupId })
                        .in('message_id', c.messageIds.slice(0, 250))
                        .is('group_id', null);
                    } catch {
                      // ignore
                    }

                    // Touch group updated_at so it sorts near the top.
                    try {
                      await db.from('sms_groups').update({ updated_at: new Date().toISOString() }).eq('group_id', groupId);
                    } catch {
                      // ignore
                    }

                    createdOrTagged++;
                  }
                }
              }
            }
          } catch {
            // ignore (diagnostic/backfill only)
          }

          let groupQuery = db
            .from('sms_groups')
            .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
            .order('updated_at', { ascending: false })
            .limit(limit);

          // Groups behave like a shared inbox concept: any non-admin dashboard user may
          // view groups created by another employee (e.g. Roselle-created dual-recipient groups).

          const { data: groups, error: gErr } = await groupQuery;

          if (gErr) {
            const msg = isMissingTableError(gErr, 'sms_groups')
              ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
              : `Failed to load groups: ${gErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          // Filter out hidden conversations for this user (soft delete / archive)
          let hiddenGroupIds = new Set<string>();
          try {
            const { data: hidden, error: hErr } = await db
              .from('sms_hidden_conversations')
              .select('conversation_id')
              .eq('owner_user_id', me.userId)
              .eq('conversation_type', 'group')
              .limit(5000);

            if (!hErr && Array.isArray(hidden)) {
              hiddenGroupIds = new Set(hidden.map((r: any) => String(r.conversation_id || '').trim()).filter(Boolean));
            }
          } catch {
            // ignore
          }

          const rows = (groups || []).map((g: any) => {
            const gid = String(g?.group_id || '').trim();
            return { ...(g || {}), hidden: !!(gid && hiddenGroupIds.has(gid)) };
          });

          const groupIds = rows.map((r: any) => String(r.group_id || '').trim()).filter(Boolean);
          if (!groupIds.length) {
            result = [];
            break;
          }

          const { data: members, error: mErr } = await db
            .from('sms_group_members')
            .select('group_id, contact_phone')
            .in('group_id', groupIds)
            .limit(5000);

          if (mErr) {
            const msg = isMissingTableError(mErr, 'sms_group_members')
              ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
              : `Failed to load group members: ${mErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          const membersByGroup: Record<string, string[]> = {};
          const allPhones: string[] = [];
          for (const r of (members || [])) {
            const gid = String((r as any).group_id || '').trim();
            const phone = normalizePhone(String((r as any).contact_phone || '').trim());
            if (!gid || !phone) continue;
            if (!membersByGroup[gid]) membersByGroup[gid] = [];
            membersByGroup[gid].push(phone);
            allPhones.push(phone);
          }

          // Load threads for member phones (for names + unread counts).
          const uniqPhones = Array.from(new Set(allPhones)).filter(Boolean);
          const phoneToThread: Record<string, any> = {};
          if (uniqPhones.length) {
            const variants = Array.from(new Set(uniqPhones.flatMap(p => smsPhoneQueryVariants(p)))).filter(Boolean);
            const { data: threads, error: tErr } = await db
              .from('sms_threads')
              .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
              .in('contact_phone', variants.length ? variants : uniqPhones)
              .limit(5000);

            if (tErr) {
              const msg = isMissingTableError(tErr, 'sms_threads')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load threads for groups: ${tErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }

            for (const t of (threads || [])) {
              const phone = normalizePhone(String((t as any).contact_phone || '').trim());
              if (!phone) continue;
              phoneToThread[phone] = t;
            }
          }

          // Compute group "latest activity" intelligently:
          // - INBOUND from any member thread is always relevant to the group.
          // - OUTBOUND is relevant only when it was a group send (sms_messages.group_id == group_id).
          //   Direct 1:1 outbound sends should NOT make the group look like it has new activity.
          const groupIdSet = new Set(groupIds);
          const groupToThreadIds: Record<string, string[]> = {};
          const allThreadIds: string[] = [];
          for (const gid of groupIds) {
            const phones = (membersByGroup[gid] || []).slice(0);
            const tids: string[] = [];
            for (const p of phones) {
              const tid = String(phoneToThread[p]?.thread_id || '').trim();
              if (!tid) continue;
              tids.push(tid);
              allThreadIds.push(tid);
            }
            groupToThreadIds[gid] = Array.from(new Set(tids));
          }

          const uniqThreadIds = Array.from(new Set(allThreadIds)).filter(Boolean);
          // Safety cap: avoid giant IN() lists and huge message scans.
          const cappedThreadIds = uniqThreadIds.slice(0, 900);
          const threadToGroups = new Map<string, string[]>();
          for (const gid of groupIds) {
            for (const tid of (groupToThreadIds[gid] || [])) {
              if (!threadToGroups.has(tid)) threadToGroups.set(tid, []);
              threadToGroups.get(tid)!.push(gid);
            }
          }

          const lastByGroup: Record<string, { at: string; preview: string | null }> = {};
          if (cappedThreadIds.length) {
            // Try to use group_id when available; if not, fall back to INBOUND-only.
            let msgs: any[] = [];
            let supportsGroupId = true;

            {
              const { data: probe, error: probeErr } = await db
                .from('sms_messages')
                .select('group_id')
                .limit(1);
              if (probeErr && isMissingColumnError(probeErr, 'group_id')) {
                supportsGroupId = false;
              }
              void probe;
            }

            if (supportsGroupId) {
              const { data: rows, error: msgErr } = await db
                .from('sms_messages')
                .select('thread_id, direction, body, created_at, group_id, sent_by_user_id, sent_by_username, sent_by_display_name')
                .in('thread_id', cappedThreadIds)
                .order('created_at', { ascending: false })
                .limit(2000);
              if (msgErr) {
                if (isMissingColumnError(msgErr, 'group_id')) supportsGroupId = false;
                else {
                  const msg = isMissingTableError(msgErr, 'sms_messages')
                    ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                    : `Failed to load messages for groups: ${msgErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }
              } else {
                msgs = Array.isArray(rows) ? rows : [];
              }
            }

            if (!supportsGroupId) {
              const { data: rows, error: msgErr } = await db
                .from('sms_messages')
                .select('thread_id, direction, body, created_at')
                .in('thread_id', cappedThreadIds)
                .eq('direction', 'INBOUND')
                .order('created_at', { ascending: false })
                .limit(2000);

              if (msgErr) {
                const msg = isMissingTableError(msgErr, 'sms_messages')
                  ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                  : `Failed to load messages for groups: ${msgErr.message}`;
                return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
              }
              msgs = Array.isArray(rows) ? rows : [];
            }

            const totalGroups = groupIds.length;
            let filled = 0;

            const normKey = (x: any) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            const normalizeLegacyBody = (raw: any, senderHint: any) => {
              const s = safeTrim(raw);
              if (!s) return '';
              const hint = safeTrim(senderHint);
              if (hint && s.startsWith('[')) {
                const end = s.indexOf(']');
                if (end > 1 && end < 80) {
                  const tag = s.slice(1, end).trim();
                  if (normKey(tag) === normKey(hint)) {
                    const after = s.slice(end + 1).trimStart();
                    if (after) return after;
                  }
                }
              }
              return s;
            };
            const signatureFor = (m: any) => {
              try {
                const dir = String(m?.direction || '').toUpperCase();
                if (dir !== 'OUTBOUND') return '';
                const sender = safeTrim(m?.sent_by_user_id || m?.sent_by_username || m?.sent_by_display_name || '');
                const hint = safeTrim(m?.sent_by_display_name || m?.sent_by_username || '');
                const bodyKey = normalizeLegacyBody(m?.body, hint).toLowerCase();
                const at = safeTrim(m?.created_at || '');
                const t = at ? new Date(at).getTime() : 0;
                if (!t || isNaN(t)) return '';
                // Bucket outbound fan-out sends into a wider window so slow sequential sends
                // (Twilio throttling / retries / queueing) still get treated as one group event.
                const slot = Math.floor(t / 120000); // 2m slots
                return `${sender || 'unknown'}::${slot}::${bodyKey}`;
              } catch {
                return '';
              }
            };

            // Legacy: if older group sends were written as multiple OUTBOUND 1:1 rows (no group_id),
            // treat them as a group-send only when we see the same signature in 2+ member threads.
            const legacySeenByGroup: Record<string, Map<string, Set<string>>> = {};
            for (const m of msgs) {
              if (filled >= totalGroups) break;
              const tid = String((m as any).thread_id || '').trim();
              if (!tid) continue;
              const dir = String((m as any).direction || '').trim().toUpperCase();
              const at = String((m as any).created_at || '').trim();
              const body = (m as any).body != null ? String((m as any).body) : null;

              if (dir === 'INBOUND') {
                const gids = threadToGroups.get(tid) || [];
                for (const gid of gids) {
                  if (!groupIdSet.has(gid)) continue;
                  if (lastByGroup[gid]) continue;
                  lastByGroup[gid] = { at, preview: body };
                  filled++;
                }
                continue;
              }

              if (dir === 'OUTBOUND') {
                const gid = String((m as any).group_id || '').trim();
                // Modern path: group sends are persisted with sms_messages.group_id.
                if (gid) {
                  if (!groupIdSet.has(gid)) continue;
                  if (lastByGroup[gid]) continue;
                  lastByGroup[gid] = { at, preview: body };
                  filled++;
                  continue;
                }
                // Legacy path (no group_id): fall through so we can detect fan-out signatures.
              }

              if (dir === 'OUTBOUND' && supportsGroupId) {
                // Legacy fan-out (no group_id): only count as group activity if it appears in >=2 member threads.
                const sig = signatureFor(m);
                if (!sig) continue;
                const gids = threadToGroups.get(tid) || [];
                for (const gid of gids) {
                  if (!groupIdSet.has(gid)) continue;
                  if (lastByGroup[gid]) continue;
                  if (!legacySeenByGroup[gid]) legacySeenByGroup[gid] = new Map();
                  const map = legacySeenByGroup[gid];
                  if (!map.has(sig)) map.set(sig, new Set());
                  map.get(sig)!.add(tid);
                  if (map.get(sig)!.size >= 2) {
                    lastByGroup[gid] = { at, preview: body };
                    filled++;
                  }
                }
              }
            }
          }

          const out = rows.map((g: any) => {
            const gid = String(g.group_id || '').trim();
            const phones = (membersByGroup[gid] || []).slice(0);
            phones.sort();

            const lastMeta = lastByGroup[gid] || null;
            let lastAt: string | null = lastMeta ? String(lastMeta.at || '') : null;
            let lastPreview: string | null = lastMeta ? (lastMeta.preview != null ? String(lastMeta.preview) : null) : null;
            let unreadSum = 0;
            for (const p of phones) {
              const t = phoneToThread[p];
              if (t && t.unread_count) unreadSum += Number(t.unread_count || 0) || 0;
            }

            const memberInfos = phones.map(p => {
              const t = phoneToThread[p];
              return {
                contact_phone: p,
                contact_name: t && t.contact_name ? String(t.contact_name) : null
              };
            });

            return {
              group_id: gid,
              group_name: g.group_name || null,
              hidden: !!(g as any).hidden,
              member_key: g.member_key,
              member_count: phones.length,
              members: memberInfos,
              last_message_at: lastAt,
              last_message_preview: lastPreview,
              unread_count: unreadSum,
              created_at: g.created_at,
              updated_at: g.updated_at
            };
          });

          out.sort((a: any, b: any) => {
            const ta = a && a.last_message_at ? new Date(String(a.last_message_at)).getTime() : 0;
            const tb = b && b.last_message_at ? new Date(String(b.last_message_at)).getTime() : 0;
            if (tb !== ta) return tb - ta;
            const ua = a && a.updated_at ? new Date(String(a.updated_at)).getTime() : 0;
            const ub = b && b.updated_at ? new Date(String(b.updated_at)).getTime() : 0;
            return ub - ua;
          });

          // Portal bundle expects: { ok, groups, group_members }
          // Current backend expects: { ok, smsGroups }
          const portalGroups = out.map((g: any) => {
            const phones = Array.isArray(g?.members)
              ? g.members
                  .map((m: any) => {
                    if (typeof m === 'string') return normalizePhone(String(m).trim()) || String(m).trim();
                    const p = String(m?.contact_phone || '').trim();
                    return normalizePhone(p) || p;
                  })
                  .filter(Boolean)
              : [];

            return {
              group_id: String(g?.group_id || '').trim(),
              title: String(g?.group_name || '').trim() || 'Group',
              group_name: g?.group_name != null ? String(g.group_name) : null,
              hidden: !!g?.hidden,
              member_key: g?.member_key != null ? String(g.member_key) : null,
              member_count: Number(g?.member_count || phones.length) || phones.length,
              members: phones,
              last_message_at: g?.last_message_at != null ? String(g.last_message_at) : null,
              last_message_preview: g?.last_message_preview != null ? String(g.last_message_preview) : null,
              unread_count: Number(g?.unread_count || 0) || 0,
              created_at: g?.created_at || null,
              updated_at: g?.updated_at || null
            };
          });

          const groupMembers = portalGroups.flatMap((g: any) =>
            (Array.isArray(g?.members) ? g.members : []).map((p: any) => ({
              group_id: g.group_id,
              contact_phone: String(p || '').trim()
            }))
          );

          return NextResponse.json(
            {
              ok: true,
              groups: portalGroups,
              group_members: groupMembers,
              smsGroups: out
            },
            { headers: corsHeaders(request) }
          );
        }
        // break; (unreachable)
      case 'smsGroupMessages':
      case 'smsGroup':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const sessionIsAdmin = String((me as any)?.role || '').trim().toUpperCase() === 'ADMIN';

          const groupId = String(searchParams.get('group_id') || searchParams.get('groupId') || '').trim();
          if (!groupId) {
            return NextResponse.json({ ok: false, error: 'group_id is required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getDeliverablesDb();

          const { data: group, error: gErr } = await db
            .from('sms_groups')
            .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
            .eq('group_id', groupId)
            .maybeSingle();

          if (gErr) {
            const msg = isMissingTableError(gErr, 'sms_groups')
              ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
              : `Failed to load group: ${gErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          // Treat group conversations as shared across dashboard users.
          if (!group) {
            return NextResponse.json({ ok: false, error: 'Group not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const { data: members, error: mErr } = await db
            .from('sms_group_members')
            .select('contact_phone')
            .eq('group_id', groupId)
            .limit(5000);

          if (mErr) {
            const msg = isMissingTableError(mErr, 'sms_group_members')
              ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
              : `Failed to load group members: ${mErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          const phones = (members || [])
            .map((r: any) => normalizePhone(String(r.contact_phone || '').trim()))
            .filter(Boolean);
          phones.sort();

          const phoneVariants = Array.from(new Set(phones.flatMap(p => smsPhoneQueryVariants(p)))).filter(Boolean);

          const { data: threads, error: tErr } = await db
            .from('sms_threads')
            .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
            .in('contact_phone', phoneVariants.length ? phoneVariants : phones)
            .limit(5000);

          if (tErr) {
            const msg = isMissingTableError(tErr, 'sms_threads')
              ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
              : `Failed to load threads: ${tErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          const threadIds = (threads || []).map((t: any) => String(t.thread_id || '').trim()).filter(Boolean);
          let messages: any[] = [];
          let page = { limit: 120, has_more: false, before: null as string | null, next_before: null as string | null };
          if (threadIds.length) {
            const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 120), 20), 1000);
            const before = safeTrim(searchParams.get('before') || '');
            const pageSize = Math.min(limit + 1, 1001);

            // For group view: show all INBOUND from members + OUTBOUND group-sends only.
            // Exclude direct 1:1 outbound sends so they don't appear in the group timeline.
            // Back-compat: if older group sends were stored as multiple 1:1 OUTBOUND rows (no group_id),
            // include them ONLY when they appear in >=2 member threads within a ~20s signature window.
            let msgs: any[] = [];
            let msgErr: any = null;
            {
              const { data: probe, error: probeErr } = await db
                .from('sms_messages')
                .select('group_id')
                .limit(1);

              const supportsGroupId = !(probeErr && isMissingColumnError(probeErr, 'group_id'));
              void probe;

              if (supportsGroupId) {
                // Fetch a larger window, then filter server-side.
                const fetchSize = Math.min(1500, Math.max(pageSize * 6, 250));
                const resp = await db
                  .from('sms_messages')
                  .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id')
                  .in('thread_id', threadIds)
                  .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                  .order('created_at', { ascending: false })
                  .limit(fetchSize);
                msgs = Array.isArray(resp.data) ? resp.data : [];
                msgErr = resp.error;
              } else {
                // Back-compat: if the DB hasn't been migrated, fall back to the legacy behavior
                // (group shows all messages across member threads).
                const resp = await db
                  .from('sms_messages')
                  .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name')
                  .in('thread_id', threadIds)
                  .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                  .order('created_at', { ascending: false })
                  .limit(pageSize);
                msgs = Array.isArray(resp.data) ? resp.data : [];
                msgErr = resp.error;
              }
            }

            if (msgErr) {
              const msg = isMissingTableError(msgErr, 'sms_messages')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load messages: ${msgErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }
            const raw = msgs || [];
            let filteredDesc: any[] = raw;

            // Server-side filter when group_id exists.
            try {
              const supportsGroupId = raw.some((m: any) => Object.prototype.hasOwnProperty.call(m || {}, 'group_id'));
              if (supportsGroupId) {
                const normKey = (x: any) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                const normalizeLegacyBody = (rawBody: any, senderHint: any) => {
                  const s = safeTrim(rawBody);
                  if (!s) return '';
                  const hint = safeTrim(senderHint);
                  if (hint && s.startsWith('[')) {
                    const end = s.indexOf(']');
                    if (end > 1 && end < 80) {
                      const tag = s.slice(1, end).trim();
                      if (normKey(tag) === normKey(hint)) {
                        const after = s.slice(end + 1).trimStart();
                        if (after) return after;
                      }
                    }
                  }
                  return s;
                };
                const sigFor = (m: any) => {
                  try {
                    const dir = String(m?.direction || '').toUpperCase();
                    if (dir !== 'OUTBOUND') return '';
                    const sender = safeTrim(m?.sent_by_user_id || m?.sent_by_username || m?.sent_by_display_name || '');
                    const hint = safeTrim(m?.sent_by_display_name || m?.sent_by_username || '');
                    const bodyKey = normalizeLegacyBody(m?.body, hint).toLowerCase();
                    const at = safeTrim(m?.created_at || '');
                    const t = at ? new Date(at).getTime() : 0;
                    if (!t || isNaN(t)) return '';
                    // Wider time bucket to avoid missing slow fan-out sends.
                    const slot = Math.floor(t / 120000);
                    return `${sender || 'unknown'}::${slot}::${bodyKey}`;
                  } catch {
                    return '';
                  }
                };

                const clusters = new Map<string, Set<string>>();
                for (const m of raw) {
                  const dir = String(m?.direction || '').toUpperCase();
                  if (dir !== 'OUTBOUND') continue;
                  const gid = safeTrim(m?.group_id || '');
                  if (gid) continue;
                  const sig = sigFor(m);
                  if (!sig) continue;
                  const tid = safeTrim(m?.thread_id || '');
                  if (!tid) continue;
                  if (!clusters.has(sig)) clusters.set(sig, new Set());
                  clusters.get(sig)!.add(tid);
                }

                const eligible = new Set<string>();
                for (const [sig, tids] of Array.from(clusters.entries())) {
                  if (tids && tids.size >= 2) eligible.add(sig);
                }

                filteredDesc = raw.filter((m: any) => {
                  const dir = String(m?.direction || '').toUpperCase();
                  if (dir === 'INBOUND') return true;
                  if (dir !== 'OUTBOUND') return false;
                  const gid = safeTrim(m?.group_id || '');
                  if (gid && gid === groupId) return true;
                  if (gid) return false;
                  const sig = sigFor(m);
                  if (!sig || !eligible.has(sig)) return false;
                  // Mark for UI labeling.
                  try { (m as any).group_id = groupId; } catch {}
                  return true;
                });
              }
            } catch {
              filteredDesc = raw;
            }

            const hasMore = filteredDesc.length > limit;
            const slicedDesc = hasMore ? filteredDesc.slice(0, limit) : filteredDesc;
            const sliced = slicedDesc.slice(0).reverse();
            messages = sliced;

            page = {
              limit,
              has_more: hasMore,
              before: before || null,
              next_before: sliced.length ? String((sliced as any)[0].created_at || '') : null
            };
          }

          // Mark member threads read (best-effort)
          try {
            // Keep admin sessions view-only: don't mutate unread counters.
            if (!sessionIsAdmin && phones.length) {
              const variants = Array.from(new Set(phones.flatMap(p => smsPhoneQueryVariants(p)))).filter(Boolean);
              await db.from('sms_threads').update({ unread_count: 0 }).in('contact_phone', variants.length ? variants : phones);
            }
          } catch {
            // ignore
          }

          const membersOut = phones.map(p => {
            const t = (threads || []).find((x: any) => normalizePhone(String(x.contact_phone || '').trim()) === p);
            return { contact_phone: p, contact_name: t && t.contact_name ? String(t.contact_name) : null, thread_id: t && t.thread_id ? String(t.thread_id) : null };
          });

          const payload = {
            group: {
              group_id: groupId,
              group_name: (group as any).group_name || null,
              member_key: (group as any).member_key,
              member_count: phones.length,
              created_at: (group as any).created_at,
              updated_at: (group as any).updated_at
            },
            members: membersOut,
            messages,
            page
          };

          if (action === 'smsGroupMessages') {
            return NextResponse.json(
              { ok: true, group: payload.group, members: payload.members, messages: payload.messages, page: payload.page },
              { headers: corsHeaders(request) }
            );
          }

          result = payload;
        }
        break;
      case 'smsMessages':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const threadId = String(searchParams.get('thread_id') || searchParams.get('threadId') || '').trim();
          const contactPhone = normalizePhone(String(searchParams.get('contact_phone') || searchParams.get('contactPhone') || '').trim());

          if (!threadId && !contactPhone) {
            return NextResponse.json({ ok: false, error: 'thread_id or contact_phone is required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getDeliverablesDb();

          let thread: any = null;
          if (threadId) {
            const { data: t, error: tErr } = await db
              .from('sms_threads')
              .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
              .eq('thread_id', threadId)
              .maybeSingle();
            if (tErr) {
              const msg = isMissingTableError(tErr, 'sms_threads')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load thread: ${tErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }
            thread = t || null;
          } else if (contactPhone) {
            const { data: t, error: tErr } = await db
              .from('sms_threads')
              .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
              .eq('contact_phone', contactPhone)
              .maybeSingle();
            if (tErr) {
              const msg = isMissingTableError(tErr, 'sms_threads')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load thread: ${tErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }
            thread = t || null;
          }

          if (!thread) {
            return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 120), 20), 500);
          const before = safeTrim(searchParams.get('before') || '');
          const pageSize = Math.min(limit + 1, 501);

          let messages: any[] = [];
          let msgErr: any = null;
          let supportsGroupId = false;
          {
            const { data: probe, error: probeErr } = await db
              .from('sms_messages')
              .select('group_id')
              .limit(1);

            supportsGroupId = !(probeErr && isMissingColumnError(probeErr, 'group_id'));
            void probe;

            if (supportsGroupId) {
              const resp = await db
                .from('sms_messages')
                .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id')
                .eq('thread_id', thread.thread_id)
                .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                .order('created_at', { ascending: false })
                .limit(pageSize);
              messages = Array.isArray(resp.data) ? resp.data : [];
              msgErr = resp.error;
            } else {
              const resp = await db
                .from('sms_messages')
                .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name')
                .eq('thread_id', thread.thread_id)
                .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                .order('created_at', { ascending: false })
                .limit(pageSize);
              messages = Array.isArray(resp.data) ? resp.data : [];
              msgErr = resp.error;
            }
          }

          // Same phone-variant fallback as smsThread (read-only here; no mark-read).
          try {
            if (!msgErr && (!messages || messages.length === 0)) {
              const basePhone = normalizePhone(String(thread?.contact_phone || '').trim());
              if (basePhone) {
                const variants = Array.from(new Set(smsPhoneQueryVariants(basePhone))).filter(Boolean);
                if (variants.length) {
                  const { data: dupThreads, error: dupErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone')
                    .in('contact_phone', variants)
                    .limit(25);

                  if (!dupErr && Array.isArray(dupThreads) && dupThreads.length) {
                    const threadIds = Array.from(
                      new Set(
                        dupThreads
                          .map((t: any) => String(t?.thread_id || '').trim())
                          .filter(Boolean)
                      )
                    ).slice(0, 25);

                    if (threadIds.length >= 2) {
                      const resp = supportsGroupId
                        ? await db
                            .from('sms_messages')
                            .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id')
                            .in('thread_id', threadIds)
                            .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                            .order('created_at', { ascending: false })
                            .limit(pageSize)
                        : await db
                            .from('sms_messages')
                            .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name')
                            .in('thread_id', threadIds)
                            .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                            .order('created_at', { ascending: false })
                            .limit(pageSize);

                      if (!resp.error && Array.isArray(resp.data) && resp.data.length) {
                        messages = resp.data;
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          if (msgErr) {
            const msg = isMissingTableError(msgErr, 'sms_messages')
              ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
              : `Failed to load messages: ${msgErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          const raw = messages || [];
          const hasMore = raw.length > limit;
          const sliced = hasMore ? raw.slice(0, limit) : raw;
          sliced.reverse();

          return NextResponse.json(
            {
              ok: true,
              thread,
              messages: sliced,
              page: {
                limit,
                has_more: hasMore,
                before: before || null,
                next_before: sliced.length ? String((sliced as any)[0].created_at || '') : null
              }
            },
            { headers: corsHeaders(request) }
          );
        }
        // break; (unreachable)
      case 'smsThread':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const sessionIsAdmin = String(me.role || '').trim().toUpperCase() === 'ADMIN';

          const threadId = String(searchParams.get('thread_id') || searchParams.get('threadId') || '').trim();
          const contactPhone = normalizePhone(String(searchParams.get('contact_phone') || searchParams.get('contactPhone') || '').trim());

          if (!threadId && !contactPhone) {
            return NextResponse.json({ ok: false, error: 'thread_id or contact_phone is required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getDeliverablesDb();

          let thread: any = null;
          if (threadId) {
            const { data: t, error: tErr } = await db
              .from('sms_threads')
              .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
              .eq('thread_id', threadId)
              .maybeSingle();
            if (tErr) {
              const msg = isMissingTableError(tErr, 'sms_threads')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load thread: ${tErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }
            thread = t || null;
          } else if (contactPhone) {
            const { data: t, error: tErr } = await db
              .from('sms_threads')
              .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
              .eq('contact_phone', contactPhone)
              .maybeSingle();
            if (tErr) {
              const msg = isMissingTableError(tErr, 'sms_threads')
                ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                : `Failed to load thread: ${tErr.message}`;
              return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
            }
            thread = t || null;
          }

          if (!thread) {
            return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 120), 20), 500);
          const before = safeTrim(searchParams.get('before') || '');
          const pageSize = Math.min(limit + 1, 501);

          let messages: any[] = [];
          let msgErr: any = null;
          let supportsGroupId = false;
          {
            const { data: probe, error: probeErr } = await db
              .from('sms_messages')
              .select('group_id')
              .limit(1);

            supportsGroupId = !(probeErr && isMissingColumnError(probeErr, 'group_id'));
            void probe;

            if (supportsGroupId) {
              const resp = await db
                .from('sms_messages')
                .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id')
                .eq('thread_id', thread.thread_id)
                .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                .order('created_at', { ascending: false })
                .limit(pageSize);
              messages = Array.isArray(resp.data) ? resp.data : [];
              msgErr = resp.error;
            } else {
              const resp = await db
                .from('sms_messages')
                .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name')
                .eq('thread_id', thread.thread_id)
                .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                .order('created_at', { ascending: false })
                .limit(pageSize);
              messages = Array.isArray(resp.data) ? resp.data : [];
              msgErr = resp.error;
            }
          }

          // If the thread exists but has no messages, try a phone-variant fallback.
          // This protects against duplicate threads created by inconsistent phone formatting.
          // (The UI dedupes threads by normalized phone; if it opens the "wrong" thread_id,
          // the user sees a blank conversation.)
          let threadIdsForRead: string[] = [String(thread.thread_id || '').trim()].filter(Boolean);
          try {
            if (!msgErr && (!messages || messages.length === 0)) {
              const basePhone = normalizePhone(String(thread?.contact_phone || '').trim());
              if (basePhone) {
                const variants = Array.from(new Set(smsPhoneQueryVariants(basePhone))).filter(Boolean);
                if (variants.length) {
                  const { data: dupThreads, error: dupErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone')
                    .in('contact_phone', variants)
                    .limit(25);

                  if (!dupErr && Array.isArray(dupThreads) && dupThreads.length) {
                    const threadIds = Array.from(
                      new Set(
                        dupThreads
                          .map((t: any) => String(t?.thread_id || '').trim())
                          .filter(Boolean)
                      )
                    ).slice(0, 25);

                    // Only do extra work when there is at least one alternative thread.
                    if (threadIds.length >= 2) {
                      threadIdsForRead = threadIds;

                      const resp = supportsGroupId
                        ? await db
                            .from('sms_messages')
                            .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name, group_id')
                            .in('thread_id', threadIds)
                            .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                            .order('created_at', { ascending: false })
                            .limit(pageSize)
                        : await db
                            .from('sms_messages')
                            .select('message_id, thread_id, direction, body, from_phone, to_phone, twilio_sid, status, created_at, sent_by_user_id, sent_by_username, sent_by_display_name')
                            .in('thread_id', threadIds)
                            .lt('created_at', before || '9999-12-31T23:59:59.999Z')
                            .order('created_at', { ascending: false })
                            .limit(pageSize);

                      // Only override when the fallback actually found messages.
                      if (!resp.error && Array.isArray(resp.data) && resp.data.length) {
                        messages = resp.data;
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          if (msgErr) {
            const msg = isMissingTableError(msgErr, 'sms_messages')
              ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
              : `Failed to load messages: ${msgErr.message}`;
            return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
          }

          // Mark read (best-effort)
          try {
            // Keep admin sessions view-only: don't mutate unread counters.
            if (!sessionIsAdmin) {
              if (threadIdsForRead.length > 1) {
                await db.from('sms_threads').update({ unread_count: 0 }).in('thread_id', threadIdsForRead);
              } else {
                await db.from('sms_threads').update({ unread_count: 0 }).eq('thread_id', thread.thread_id);
              }
              thread.unread_count = 0;
            }
          } catch {
            // ignore
          }

          const raw = messages || [];
          const hasMore = raw.length > limit;
          const sliced = hasMore ? raw.slice(0, limit) : raw;
          sliced.reverse();

          result = {
            thread,
            messages: sliced,
            page: {
              limit,
              has_more: hasMore,
              before: before || null,
              next_before: sliced.length ? String((sliced as any)[0].created_at || '') : null
            }
          };
        }
        break;
      case 'ping':
        {
          return NextResponse.json(
            {
              ok: true,
              service: 'h2s-backend',
              endpoint: 'api/v1',
              ts: new Date().toISOString()
            },
            { status: 200, headers: corsHeaders(request) }
          );
        }
      case 'smsDebugInbound':
        {
          const me = await getDashboardAuthUserFromSession(request);
          const sessionIsAdmin = !!me && me.role === 'ADMIN';
          if (!sessionIsAdmin) {
            const auth = await requireAdminToken(request);
            if (!auth.ok) {
              return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
            }
          }

          const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 10), 1), 20);

          const maskPhone = (raw: any) => {
            const s = safeTrim(raw);
            if (!s) return null;
            const digits = s.replace(/\D/g, '');
            if (digits.length <= 4) return `***${digits}`;
            return `***${digits.slice(-4)}`;
          };

          const tryDb = async (label: string, client: any) => {
            const out: any = { label };
            try {
              const { data: inbound, error: inErr } = await client
                .from('sms_messages')
                .select('message_id, thread_id, direction, from_phone, to_phone, twilio_sid, status, created_at')
                .eq('direction', 'INBOUND')
                .order('created_at', { ascending: false })
                .limit(limit);
              out.inbound_error = inErr ? String(inErr.message || inErr) : null;
              out.inbound = (inbound || []).map((m: any) => ({
                message_id: m.message_id,
                thread_id: m.thread_id,
                direction: m.direction,
                from_phone: maskPhone(m.from_phone),
                to_phone: maskPhone(m.to_phone),
                twilio_sid: m.twilio_sid,
                status: m.status,
                created_at: m.created_at
              }));
            } catch (e: any) {
              out.inbound_error = e?.message || String(e);
              out.inbound = [];
            }
            try {
              const { data: threads, error: tErr } = await client
                .from('sms_threads')
                .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
                .order('last_message_at', { ascending: false, nullsFirst: false })
                .limit(limit);
              out.threads_error = tErr ? String(tErr.message || tErr) : null;
              out.threads = (threads || []).map((t: any) => ({
                thread_id: t.thread_id,
                contact_phone: maskPhone(t.contact_phone),
                contact_name: t.contact_name,
                last_message_preview: t.last_message_preview ? '[redacted]' : null,
                last_message_at: t.last_message_at,
                unread_count: t.unread_count
              }));
            } catch (e: any) {
              out.threads_error = e?.message || String(e);
              out.threads = [];
            }
            return out;
          };

          const mainDb = getSupabase();
          const mgmtDb = (() => {
            try {
              return getSupabaseMgmt();
            } catch {
              return null;
            }
          })();

          const deliverablesUsesMgmt = (() => {
            try {
              void getSupabaseMgmt();
              return true;
            } catch {
              return false;
            }
          })();

          const env = {
            TWILIO_DISABLE_SIGNATURE_VALIDATION: String(process.env.TWILIO_DISABLE_SIGNATURE_VALIDATION || '').trim() || null,
            TWILIO_INBOUND_SMS_WEBHOOK_URL: String(process.env.TWILIO_INBOUND_SMS_WEBHOOK_URL || '').trim() || null
          };

          return NextResponse.json(
            {
              ok: true,
              auth: sessionIsAdmin ? 'session-admin' : 'admin-key',
              me: me ? { user_id: me.userId, username: me.username, role: me.role } : null,
              env,
              deliverables_db: { uses_mgmt: deliverablesUsesMgmt },
              main: await tryDb('main', mainDb),
              mgmt: mgmtDb ? await tryDb('mgmt', mgmtDb) : { label: 'mgmt', error: 'MGMT client not configured in this deployment' }
            },
            { headers: corsHeaders(request) }
          );
        }
      case 'observed_paths':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = toInt(searchParams.get('limit'), 2000);
          const includeRules = ['1', 'true', 'yes', 'on'].includes(String(searchParams.get('include_rules') || '').toLowerCase());

          const windowHours = Math.min(Math.max(toInt(searchParams.get('window_hours'), 24), 1), 168);
          const maxEvents = Math.min(Math.max(toInt(searchParams.get('max_events'), 50000), 1000), 200000);

          const windowEnd = endDate ? new Date(endDate) : new Date();
          const windowStart = startDate ? new Date(startDate) : new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);
          const windowStartIso = isNaN(windowStart.getTime()) ? new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString() : windowStart.toISOString();
          const windowEndIso = isNaN(windowEnd.getTime()) ? new Date().toISOString() : windowEnd.toISOString();

          const db = getTrackingDb();

          const { data: observed, error: observedError } = await db
            .from('h2s_tracking_observed_paths')
            .select('path,first_seen_at,last_seen_at')
            .order('last_seen_at', { ascending: false })
            .limit(Math.min(Math.max(limit, 1), 5000));

          if (observedError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load observed paths: ${observedError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let rules: PathRuleRow[] = [];
          if (includeRules) {
            const { data: ruleRows, error: rulesError } = await db
              .from('h2s_tracking_path_rules')
              .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
              .order('updated_at', { ascending: false })
              .limit(5000);
            if (rulesError) {
              return NextResponse.json(
                { ok: false, error: `Failed to load path rules: ${rulesError.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }
            rules = (ruleRows || []) as PathRuleRow[];
          }

          const activeBlocked = rules.filter((r) => r.is_blocked);

          // Compute recent event counts for observed paths.
          // Note: counts are limited by maxEvents to keep query bounded.
          const pathsForCount = (observed || [])
            .map((p: any) => String(p.path || '').trim().toLowerCase())
            .filter(Boolean);

          const countMap: Record<string, number> = {};
          let countsTruncated = false;
          if (pathsForCount.length > 0) {
            const { data: recentRows, error: recentError } = await db
              .from('h2s_tracking_events')
              .select('page_path,occurred_at')
              .in('page_path', pathsForCount)
              .gte('occurred_at', windowStartIso)
              .lte('occurred_at', windowEndIso)
              .order('occurred_at', { ascending: false })
              .limit(maxEvents);

            if (recentError) {
              return NextResponse.json(
                { ok: false, error: `Failed to load recent events for path counts: ${recentError.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }

            const rows = (recentRows || []) as any[];
            if (rows.length >= maxEvents) countsTruncated = true;

            for (const row of rows) {
              const key = String(row.page_path || '').trim().toLowerCase();
              if (!key) continue;
              countMap[key] = (countMap[key] || 0) + 1;
            }
          }

          const paths = (observed || []).map((p: any) => {
            const path = String(p.path || '').toLowerCase();
            const matched = activeBlocked
              .filter((r) => pathMatchesRule(path, r))
              .sort((a, b) => String(b.pattern || '').length - String(a.pattern || '').length)[0];

            return {
              path: p.path,
              first_seen_at: p.first_seen_at,
              last_seen_at: p.last_seen_at,
              recent_event_count: countMap[path] || 0,
              is_blocked: !!matched,
              matched_rule: matched
                ? {
                    id: matched.id,
                    match_type: matched.match_type,
                    pattern: matched.pattern,
                    reason: matched.reason || null
                  }
                : null
            };
          });

          const meta = {
            window_start: windowStartIso,
            window_end: windowEndIso,
            window_hours: windowHours,
            max_events: maxEvents,
            counts_truncated: countsTruncated
          };

          result = includeRules ? { paths, rules, meta } : { paths, meta };
        }
        break;

      case 'path_rules':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = toInt(searchParams.get('limit'), 2000);
          const db = getTrackingDb();
          const { data: rules, error } = await db
            .from('h2s_tracking_path_rules')
            .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(Math.min(Math.max(limit, 1), 5000));

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to load path rules: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = rules || [];
        }
        break;

      case 'candidates':
        {
          const runQuery = async (client: ReturnType<typeof getSupabase>) =>
            client
              .from('Candidate_Master')
              .select('*, AI_Candidate_Profiles(*)')
              .order('Updated_At', { ascending: false });

          const { data: candidates, error: candidatesError } = await runQuery(supabaseMgmt);

          if (candidatesError && supabaseMgmtClient) {
            const { data: fallback, error: fallbackError } = await runQuery(supabaseMain);
            if (!fallbackError) {
              result = fallback || [];
              break;
            }
          }

          if (candidatesError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load candidates: ${candidatesError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = candidates || [];
        }
        break;

      case 'aiProfiles':
        // Return candidates with AI profiles for the Reports tab
        {
          const runQuery = async (client: ReturnType<typeof getSupabase>) =>
            client
              .from('Candidate_Master')
              .select('*, AI_Candidate_Profiles(*)')
              .order('Updated_At', { ascending: false });

          const { data: profileCandidates, error: profileCandidatesError } = await runQuery(supabaseMgmt);
          if (profileCandidatesError && supabaseMgmtClient) {
            const { data: fallback, error: fallbackError } = await runQuery(supabaseMain);
            if (!fallbackError) {
              // Transform to match Dashboard expectations, filter out candidates without profiles
              const profiles = fallback
                ?.filter((c: any) => c.AI_Candidate_Profiles && Object.keys(c.AI_Candidate_Profiles).length > 0)
                .map((c: any) => ({
                  ...c.AI_Candidate_Profiles,
                  Candidate_ID: c.Candidate_ID,
                  First_Name: c.First_Name,
                  Last_Name: c.Last_Name,
                  Phone: c.Phone,
                  Email: c.Email,
                  Current_Stage: c.Current_Stage,
                  Interview_Date: c.Interview_Date
                })) || [];

              result = profiles;
              break;
            }
          }

          if (profileCandidatesError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load AI profiles: ${profileCandidatesError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          // Transform to match Dashboard expectations, filter out candidates without profiles
          const profiles = profileCandidates
            ?.filter((c: any) => c.AI_Candidate_Profiles && Object.keys(c.AI_Candidate_Profiles).length > 0)
            .map((c: any) => ({
              ...c.AI_Candidate_Profiles,
              Candidate_ID: c.Candidate_ID,
              First_Name: c.First_Name,
              Last_Name: c.Last_Name,
              Phone: c.Phone,
              Email: c.Email,
              Current_Stage: c.Current_Stage,
              Interview_Date: c.Interview_Date
            })) || [];

          result = profiles;
        }
        break;

      case 'tasks':
        {
          const tasksDb = getDeliverablesDb();
          const { data: tasks, error: tasksError } = await tasksDb
            .from('Tasks')
            .select('*')
            // Include NULL statuses (treat as active/pending).
            .or('Status.is.null,Status.neq.ARCHIVED')
            .order('Priority', { ascending: true });

          if (tasksError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load tasks: ${tasksError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = tasks || [];
        }
        break;

      case 'taskCounts':
        {
          const tasksDb = getDeliverablesDb();

          const countExact = async (builder: any): Promise<number> => {
            const { count, error } = await builder;
            if (error) throw new Error(error.message);
            return Number(count || 0);
          };

          // Definitions:
          // - archived: Status === 'ARCHIVED'
          // - completedActive: Status === 'COMPLETED'
          // - openActive: everything NOT archived and NOT completed (including NULL)
          // - activeTotal: everything NOT archived (including NULL)
          const [totalAll, archived, activeTotal, completedActive, openActive] = await Promise.all([
            countExact(tasksDb.from('Tasks').select('*', { count: 'exact', head: true })),
            countExact(tasksDb.from('Tasks').select('*', { count: 'exact', head: true }).eq('Status', 'ARCHIVED')),
            countExact(tasksDb.from('Tasks').select('*', { count: 'exact', head: true }).or('Status.is.null,Status.neq.ARCHIVED')),
            countExact(tasksDb.from('Tasks').select('*', { count: 'exact', head: true }).eq('Status', 'COMPLETED')),
            countExact(
              tasksDb
                .from('Tasks')
                .select('*', { count: 'exact', head: true })
                .or('Status.is.null,Status.neq.ARCHIVED')
                .or('Status.is.null,Status.neq.COMPLETED')
            )
          ]);

          result = {
            totalAll,
            archived,
            activeTotal,
            completedActive,
            openActive,
            ts: new Date().toISOString()
          };
        }
        break;

      case 'hours':
        const hoursVaName = searchParams.get('vaName');
        const requestId = `get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        let hoursQuery = supabaseMgmt
          .from('VA_Hours_Log')
          .select('*')
          .order('Date', { ascending: false });
        
        // Only filter by vaName if it's provided and not 'all' or 'DEMO'
        if (hoursVaName && hoursVaName !== 'DEMO' && hoursVaName !== 'all') {
          hoursQuery = hoursQuery.eq('Logged_By', hoursVaName);
          // Limit to 50 for individual user view (recent entries)
          hoursQuery = hoursQuery.limit(50);
        }
        // For admin view (no vaName or vaName=all), get all hours - no limit

        const { data: hours, error: hoursError } = await hoursQuery;
        
        if (hoursError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load hours: ${hoursError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = hours || [];
        break;

      case 'training':
        {
          const trainingVaName = safeTrim(searchParams.get('vaName') || '');

          // Default ordering should feel intelligent for admins uploading new training:
          // sort by upload time (Created_At) newest-first, then use the legacy manual `Order`
          // only as a tie-breaker.
          let resources: any[] | null = null;
          let resourcesError: any = null;
          {
            const q = supabaseMgmt
              .from('Training_Resources')
              .select('*')
              .order('Created_At', { ascending: false, nullsFirst: false })
              .order('Order', { ascending: true });
            const resp = await q;
            resources = (resp as any).data;
            resourcesError = (resp as any).error;
          }

          // Back-compat: older schemas may not have Created_At.
          if (resourcesError && String(resourcesError.message || '').toLowerCase().includes('created_at')) {
            const fallback = await supabaseMgmt
              .from('Training_Resources')
              .select('*')
              .order('Order', { ascending: true });
            resources = (fallback as any).data;
            resourcesError = (fallback as any).error;
          }

          if (resourcesError) {
            return NextResponse.json(
              {
                ok: false,
                error: `Failed to load training resources: ${resourcesError.message}`
              },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          const completionsByResource: Record<string, any[]> = {};
          if (trainingVaName) {
            const { data: completions, error: completionsError } = await supabaseMgmt
              .from('Training_Completions')
              .select('*')
              .eq('Completed_By', trainingVaName)
              .order('Completed_At', { ascending: false });

            if (completionsError) {
              return NextResponse.json(
                {
                  ok: false,
                  error: `Failed to load training completions: ${completionsError.message}`
                },
                { status: 500, headers: corsHeaders(request) }
              );
            }

            for (const c of completions || []) {
              const rid = safeTrim(c?.Resource_ID || c?.resource_id);
              if (!rid) continue;
              if (!completionsByResource[rid]) completionsByResource[rid] = [];
              completionsByResource[rid].push(c);
            }
          }

          // Per-asset progress is best-effort (table may not exist yet in older DBs).
          const progressByResource: Record<string, any[]> = {};
          if (trainingVaName) {
            try {
              const { data: progressRows, error: progressError } = await supabaseMgmt
                .from('Training_Asset_Progress')
                .select('*')
                .eq('Completed_By', trainingVaName);

              if (!progressError) {
                for (const row of progressRows || []) {
                  const rid = safeTrim(row?.Resource_ID || row?.resource_id);
                  if (!rid) continue;
                  if (!progressByResource[rid]) progressByResource[rid] = [];
                  progressByResource[rid].push(row);
                }
              }
            } catch {
              // ignore
            }
          }

          const enriched = (resources || []).map((r: any) => {
            const rid = safeTrim(r?.Resource_ID || r?.resource_id);
            return {
              ...r,
              videos: buildTrainingVideos(r),
              completions: rid ? (completionsByResource[rid] || []) : [],
              assetProgress: rid ? (progressByResource[rid] || []) : []
            };
          });

          result = enriched;
        }
        break;

      case 'linkPreview':
        {
          const rawUrl = searchParams.get('url') || searchParams.get('u') || '';
          const url = normalizeHttpUrl(rawUrl);
          if (!url) {
            return NextResponse.json(
              { ok: false, error: 'url is required' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const meta = await getLinkTitleFromOEmbed(url);
          result = {
            url,
            provider: meta?.provider || null,
            title: meta?.title || null,
            thumbnailUrl: meta?.thumbnailUrl || null,
            durationSeconds: meta?.durationSeconds ?? null
          };
        }
        break;
      
      case 'trainingCompletions':
        const vaName = searchParams.get('vaName') || 'ROSEL';
        const { data: completions, error: completionsError } = await supabaseMgmt
          .from('Training_Completions')
          .select('*, resource:Training_Resources(*)')
          .eq('Completed_By', vaName)
          .order('Completed_At', { ascending: false })
          .limit(50);
        
        if (completionsError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load completions: ${completionsError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        // Transform data to match frontend expectations - flatten resource relation
        const transformedCompletions = (completions || []).map(c => {
          const resource = c.resource || {};
          return {
            ...c,
            Training_Title: resource.Title || c.Title || 'Untitled Training',
            Title: resource.Title || c.Title || 'Untitled Training',
            Category: resource.Category || null,
            Skills_Taught: resource.Skills_Taught || null,
            // Keep resource for backward compatibility but also flatten main fields
            resource: resource
          };
        });
        
        result = transformedCompletions;
        break;
      
      case 'vaKnowledgeProfile':
        const profileVaName = searchParams.get('vaName') || 'ROSEL';
        const { data: profile } = await supabaseMgmt
          .from('VA_Knowledge_Profiles')
          .select('*')
          .eq('VA_Name', profileVaName)
          .single();
        
        // Create profile if doesn't exist
        if (!profile) {
          const { data: newProfile } = await supabaseMgmt
            .from('VA_Knowledge_Profiles')
            .insert({
              VA_Name: profileVaName,
              Skill_Competencies: {},
              Top_Skill_Gaps: [],
              Recommended_Trainings: []
            })
            .select()
            .single();
          result = newProfile;
        } else {
          result = profile;
        }
        break;
      
      case 'trainingAnalytics':
        const analyticsVaName = searchParams.get('vaName') || 'ROSEL';
        const category = searchParams.get('category');
        
        let analyticsQuery = supabaseMgmt
          .from('Training_Analytics')
          .select('*')
          .eq('VA_Name', analyticsVaName)
          .order('Analysis_Date', { ascending: false });
        
        if (category) {
          analyticsQuery = analyticsQuery.eq('Category', category);
        }
        
        const { data: analytics } = await analyticsQuery;
        result = analytics;
        break;
      
      case 'deliverables':
        const statusFilter = searchParams.get('status') || 'all';
        const offerIdFilter = safeTrim(searchParams.get('offer_id') || searchParams.get('offerId') || '');
        const deliverableTypeFilter = safeTrim(searchParams.get('deliverable_type') || searchParams.get('deliverableType') || searchParams.get('type') || '');

        let deliverablesQuery = getDeliverablesDb()
          .from('Deliverables')
          .select('*')
          .order('Created_At', { ascending: false });

        if (statusFilter !== 'all') {
          deliverablesQuery = deliverablesQuery.eq('Status', statusFilter.toUpperCase());
        }

        // Prefer indexed filters when possible.
        let needsOfferMetadataFallback = false;
        if (offerIdFilter) {
          if (isUuid(offerIdFilter)) {
            deliverablesQuery = deliverablesQuery.eq('Offer_ID', offerIdFilter);
          } else {
            // Back-compat: allow older string-based offer ids in Metadata without failing uuid casts.
            needsOfferMetadataFallback = true;
          }
        }
        if (deliverableTypeFilter) {
          deliverablesQuery = deliverablesQuery.eq('Deliverable_Type', deliverableTypeFilter.toLowerCase());
        }

        const { data: deliverables, error: deliverablesError } = await deliverablesQuery;

        const shouldRetryWithoutNewCols =
          !!deliverablesError &&
          (isMissingDeliverablesColumnError(deliverablesError, 'Offer_ID') ||
            isMissingDeliverablesColumnError(deliverablesError, 'Deliverable_Type'));

        if (deliverablesError) {
          if (shouldRetryWithoutNewCols && (offerIdFilter || deliverableTypeFilter)) {
            let retryQuery = getDeliverablesDb()
              .from('Deliverables')
              .select('*')
              .order('Created_At', { ascending: false });
            if (statusFilter !== 'all') {
              retryQuery = retryQuery.eq('Status', statusFilter.toUpperCase());
            }
            const { data: retryRows, error: retryErr } = await retryQuery;
            if (retryErr) {
              return NextResponse.json(
                { ok: false, error: `Failed to load deliverables: ${retryErr.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }

            let items = (retryRows || []) as any[];

            if (offerIdFilter) {
              items = items.filter((d: any) => {
                try {
                  const raw = d?.Metadata;
                  if (!raw) return false;
                  const md = typeof raw === 'object' ? raw : JSON.parse(String(raw || '').trim() || '{}');
                  if (!md || typeof md !== 'object') return false;
                  const id = safeTrim((md as any).offerId || (md as any).offer_id || (md as any).Offer_ID || (md as any).offerID || '');
                  return id && id === offerIdFilter;
                } catch {
                  return false;
                }
              });
            }

            const typeTarget = deliverableTypeFilter ? deliverableTypeFilter.toLowerCase() : '';
            if (typeTarget) {
              items = items.filter((d: any) => {
                try {
                  const raw = d?.Metadata;
                  const md = raw ? (typeof raw === 'object' ? raw : JSON.parse(String(raw || '').trim() || '{}')) : null;
                  const t = safeTrim((md as any)?.type || (md as any)?.deliverableType || (md as any)?.kind || '');
                  if (t && t.toLowerCase() === typeTarget) return true;
                  if (typeTarget === 'offer_brief') {
                    const title = String(d?.Title || '');
                    return /^\s*offer\s+brief\s*:/i.test(title);
                  }
                  return false;
                } catch {
                  if (typeTarget === 'offer_brief') {
                    const title = String(d?.Title || '');
                    return /^\s*offer\s+brief\s*:/i.test(title);
                  }
                  return false;
                }
              });
            }

            result = items;
            break;
          }

          return NextResponse.json(
            { ok: false, error: `Failed to load deliverables: ${deliverablesError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        let allDeliverables = (deliverables || []) as any[];

        // Back-compat: when offer_id isn't a uuid, do in-memory filter against Metadata.offerId.
        if (needsOfferMetadataFallback && offerIdFilter) {
          allDeliverables = allDeliverables.filter((d: any) => {
            try {
              const raw = d?.Metadata;
              if (!raw) return false;
              const md = typeof raw === 'object' ? raw : JSON.parse(String(raw || '').trim() || '{}');
              if (!md || typeof md !== 'object') return false;
              const id = safeTrim((md as any).offerId || (md as any).offer_id || (md as any).Offer_ID || (md as any).offerID || '');
              return id && id === offerIdFilter;
            } catch {
              return false;
            }
          });
        }

        result = allDeliverables;
        break;

      case 'adCreatives':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const qRaw = safeTrim(searchParams.get('q') || searchParams.get('query') || '');
          const q = qRaw.replace(/,/g, ' ').trim();
          const service = safeTrim(searchParams.get('service') || '');
          const stage = safeTrim(searchParams.get('stage') || '');
          const status = safeTrim(searchParams.get('status') || '');
          const sort = safeTrim(searchParams.get('sort') || 'recent').toLowerCase();
          const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || 200) || 200, 500));
          const offerId = safeTrim(searchParams.get('offer_id') || searchParams.get('offerId') || '');

          const db = getDeliverablesDb();

          // Optional: offer-scoped list (only creatives linked to this offer).
          if (offerId) {
            if (!isUuid(offerId)) {
              return NextResponse.json({ ok: false, error: 'offer_id must be a uuid' }, { status: 400, headers: corsHeaders(request) });
            }

            const { data: linkRows, error: linkErr } = await db
              .from('ad_creative_links')
              .select('creative_id')
              .eq('offer_id', offerId)
              .order('created_at', { ascending: false })
              .limit(500);

            if (linkErr) {
              return NextResponse.json({ ok: false, error: `Failed to load creative links: ${linkErr.message}` }, { status: 500, headers: corsHeaders(request) });
            }

            const ids = Array.from(new Set((Array.isArray(linkRows) ? linkRows : []).map((r: any) => safeTrim(r?.creative_id)).filter(Boolean)));
            if (!ids.length) {
              return NextResponse.json({ ok: true, creatives: [] }, { headers: corsHeaders(request) });
            }

            // When offer-scoped, cap to link ids first to avoid scanning.
            // (Later filters like q/service/stage/status still apply below.)
            // eslint-disable-next-line no-unused-vars
          }

          let creativesQuery: any = db
            .from('ad_creatives')
            .select('creative_id,title,service,stage,format,status,brief,created_by,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(limit);

          if (offerId) {
            const { data: linkRows } = await db
              .from('ad_creative_links')
              .select('creative_id')
              .eq('offer_id', offerId)
              .order('created_at', { ascending: false })
              .limit(500);
            const ids = Array.from(new Set((Array.isArray(linkRows) ? linkRows : []).map((r: any) => safeTrim(r?.creative_id)).filter(Boolean)));
            if (!ids.length) {
              return NextResponse.json({ ok: true, creatives: [] }, { headers: corsHeaders(request) });
            }
            creativesQuery = creativesQuery.in('creative_id', ids);
          }

          if (service) creativesQuery = creativesQuery.eq('service', service);
          if (stage) creativesQuery = creativesQuery.eq('stage', stage);
          if (status && status !== 'all') creativesQuery = creativesQuery.eq('status', status);
          if (q) {
            creativesQuery = creativesQuery.or(`title.ilike.%${q}%,brief.ilike.%${q}%`);
          }

          const { data: creativesRows, error: creativesError } = await creativesQuery;
          if (creativesError) {
            return NextResponse.json({ ok: false, error: `Failed to load creatives: ${creativesError.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const creatives = (Array.isArray(creativesRows) ? creativesRows : []) as any[];

          // Optional perf-aware ordering: aggregate perf rows for the listed creatives.
          if (sort === 'perf' && creatives.length) {
            const ids = creatives.map((c: any) => c.creative_id).filter(Boolean);
            const since = searchParams.get('since') || null;
            let perfQuery: any = db
              .from('ad_creative_performance')
              .select('creative_id, impressions, clicks, leads, spend, revenue, period_start, period_end, source')
              .in('creative_id', ids)
              .order('period_end', { ascending: false })
              .limit(2000);
            if (since) perfQuery = perfQuery.gte('period_end', since);

            const { data: perfRows } = await perfQuery;
            const agg: Record<string, any> = {};
            for (const r of (Array.isArray(perfRows) ? perfRows : [])) {
              const id = String((r as any)?.creative_id || '');
              if (!id) continue;
              if (!agg[id]) {
                agg[id] = { impressions: 0, clicks: 0, leads: 0, spend: 0, revenue: 0 };
              }
              agg[id].impressions += Number((r as any)?.impressions || 0) || 0;
              agg[id].clicks += Number((r as any)?.clicks || 0) || 0;
              agg[id].leads += Number((r as any)?.leads || 0) || 0;
              agg[id].spend += Number((r as any)?.spend || 0) || 0;
              agg[id].revenue += Number((r as any)?.revenue || 0) || 0;
            }

            for (const c of creatives) {
              const p = agg[String((c as any)?.creative_id || '')];
              if (!p) continue;
              const spend = Number(p.spend || 0) || 0;
              const leads = Number(p.leads || 0) || 0;
              (c as any).perf = {
                impressions: p.impressions,
                clicks: p.clicks,
                leads: p.leads,
                spend: p.spend,
                revenue: p.revenue,
                cpl: leads > 0 ? (spend / leads) : null
              };
              (c as any).perf_score = spend > 0 ? (leads / spend) : leads;
            }

            creatives.sort((a: any, b: any) => {
              const as = Number(a?.perf_score || 0) || 0;
              const bs = Number(b?.perf_score || 0) || 0;
              if (bs !== as) return bs - as;
              const at = Date.parse(String(a?.updated_at || '')) || 0;
              const bt = Date.parse(String(b?.updated_at || '')) || 0;
              return bt - at;
            });
          }

          return NextResponse.json({ ok: true, creatives }, { headers: corsHeaders(request) });
        }

      case 'adCreativeLinks':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const offerId = safeTrim(searchParams.get('offer_id') || searchParams.get('offerId') || '');
          if (!offerId) {
            return NextResponse.json({ ok: false, error: 'offer_id required' }, { status: 400, headers: corsHeaders(request) });
          }

          const stage = safeTrim(searchParams.get('framework_stage') || searchParams.get('frameworkStage') || searchParams.get('stage') || '');
          const adTypeKey = safeTrim(searchParams.get('framework_ad_type_key') || searchParams.get('frameworkAdTypeKey') || searchParams.get('moduleKey') || '');
          const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || 500) || 500, 1000));

          const db = getDeliverablesDb();
          let linksQ: any = db
            .from('ad_creative_links')
            .select('link_id, creative_id, offer_id, deliverable_id, framework_version, framework_stage, framework_pillar_key, framework_ad_type_key, notes, created_at')
            .eq('offer_id', offerId)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (stage) linksQ = linksQ.eq('framework_stage', stage);
          if (adTypeKey) linksQ = linksQ.eq('framework_ad_type_key', adTypeKey);

          const { data: linkRows, error: linkErr } = await linksQ;
          if (linkErr) {
            return NextResponse.json({ ok: false, error: `Failed to load creative links: ${linkErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const links = (Array.isArray(linkRows) ? linkRows : []) as any[];
          const creativeIds = Array.from(new Set(links.map((r: any) => safeTrim(r?.creative_id)).filter(Boolean)));
          let creativesById: Record<string, any> = {};
          if (creativeIds.length) {
            const { data: creativesRows } = await db
              .from('ad_creatives')
              .select('creative_id,title,service,stage,format,status,updated_at')
              .in('creative_id', creativeIds)
              .limit(1000);
            for (const c of (Array.isArray(creativesRows) ? creativesRows : [])) {
              const id = safeTrim((c as any)?.creative_id);
              if (id) creativesById[id] = c;
            }

            // Add lightweight preview info (first asset URL) for nicer UI.
            try {
              const { data: assetRows } = await db
                .from('ad_creative_assets')
                .select('creative_id, sort_order, ad_assets(url, media_kind, content_type, width_px, height_px)')
                .in('creative_id', creativeIds)
                .order('sort_order', { ascending: true })
                .limit(5000);

              const firstByCreative: Record<string, any> = {};
              for (const row of (Array.isArray(assetRows) ? assetRows : [])) {
                const cid = safeTrim((row as any)?.creative_id);
                if (!cid || firstByCreative[cid]) continue;
                const a = (row as any)?.ad_assets || null;
                const url = safeTrim(a?.url);
                if (!url) continue;
                firstByCreative[cid] = {
                  preview_url: url,
                  preview_kind: safeTrim(a?.media_kind || ''),
                  preview_content_type: safeTrim(a?.content_type || ''),
                  preview_width_px: (a?.width_px ?? null),
                  preview_height_px: (a?.height_px ?? null)
                };
              }

              for (const cid of Object.keys(firstByCreative)) {
                if (creativesById[cid]) {
                  creativesById[cid] = { ...creativesById[cid], ...firstByCreative[cid] };
                }
              }
            } catch {
              // Non-fatal: previews are optional.
            }
          }

          const enriched = links.map((l: any) => ({ ...l, creative: creativesById[safeTrim(l?.creative_id)] || null }));
          return NextResponse.json({ ok: true, offer_id: offerId, links: enriched }, { headers: corsHeaders(request) });
        }

      case 'adCreativeDetail':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const creativeId = safeTrim(searchParams.get('creative_id') || searchParams.get('creativeId') || '');
          if (!creativeId || !isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getDeliverablesDb();
          const { data: creative, error: creativeError } = await db
            .from('ad_creatives')
            .select('*')
            .eq('creative_id', creativeId)
            .maybeSingle();

          if (creativeError) {
            return NextResponse.json({ ok: false, error: `Failed to load creative: ${creativeError.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          if (!creative) {
            return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const { data: creativeAssets } = await db
            .from('ad_creative_assets')
            .select('creative_asset_id, slot_key, notes, sort_order, created_at, ad_assets(*)')
            .eq('creative_id', creativeId)
            .order('sort_order', { ascending: true });

          const { data: creativeTags } = await db
            .from('ad_creative_tags')
            .select('creative_tag_id, created_at, ad_tags(tag_id,name,kind)')
            .eq('creative_id', creativeId)
            .order('created_at', { ascending: false });

          const { data: links } = await db
            .from('ad_creative_links')
            .select('*')
            .eq('creative_id', creativeId)
            .order('created_at', { ascending: false })
            .limit(200);

          const { data: perf } = await db
            .from('ad_creative_performance')
            .select('*')
            .eq('creative_id', creativeId)
            .order('period_end', { ascending: false })
            .limit(50);

          return NextResponse.json(
            {
              ok: true,
              creative,
              assets: creativeAssets || [],
              tags: creativeTags || [],
              links: links || [],
              performance: perf || []
            },
            { headers: corsHeaders(request) }
          );
        }

      case 'jobOffers':
      case 'getOffers': {
        // Job offers (legacy meaning): derive from dispatch jobs tables.
        // This matches the older portal_jobs behavior and EmployeeDashboard's "Job Offers" page.
        const dispatchClient = getSupabaseDispatch();
        if (!dispatchClient) {
          return NextResponse.json(
            { ok: false, error: 'Dispatch database not configured' },
            { status: 503, headers: corsHeaders(request) }
          );
        }

        const status = (searchParams.get('status') || 'pending').toLowerCase();
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200) || 200, 1), 500);

        let offersQuery: any = (dispatchClient as any)
          .from('h2s_dispatch_jobs')
          .select('*')
          .limit(limit);

        // Map dashboard status values to dispatch job statuses.
        if (status === 'pending' || status === 'offers') {
          offersQuery = offersQuery.in('status', ['pending_assign', 'pending', 'open', 'queued']);
        } else if (status === 'upcoming') {
          offersQuery = offersQuery.in('status', ['accepted', 'scheduled']);
        } else if (status === 'completed') {
          offersQuery = offersQuery.in('status', ['completed', 'paid']);
        } else if (status !== 'all') {
          offersQuery = offersQuery.eq('status', status);
        }

        // Prefer stable ordering if available.
        offersQuery = offersQuery.order('created_at', { ascending: false });

        const { data: jobs, error: jobsError } = await offersQuery;
        if (jobsError) {
          return NextResponse.json(
            { ok: false, error: `Failed to load offers: ${jobsError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        // Provide EmployeeDashboard-friendly aliases while preserving raw fields for other consumers.
        const offers = (jobs || []).map((j: any) => {
          const id = String(j.job_id || j.id || '');
          const payRate =
            (j.payout_estimated != null ? j.payout_estimated : undefined) ??
            (j.metadata && j.metadata.estimated_payout != null ? j.metadata.estimated_payout : undefined);
          const date = j.window || j.start_iso || (j.metadata && (j.metadata.window || j.metadata.start_iso)) || null;
          const serviceName = j.service_name || (j.metadata && j.metadata.service_name) || j.description || null;
          const jobTitle = serviceName || j.customer_name || 'Job Offer';
          const description = j.description || serviceName || null;
          return {
            ...j,
            id,
            jobTitle,
            service_name: serviceName,
            date,
            payRate,
            description,
          };
        });

        return NextResponse.json({ ok: true, offers }, { headers: corsHeaders(request) });
      }

      case 'jobs': {
        // Minimal support for EmployeeDashboard counts/lists.
        const dispatchClient = getSupabaseDispatch();
        if (!dispatchClient) {
          return NextResponse.json(
            { ok: false, error: 'Dispatch database not configured' },
            { status: 503, headers: corsHeaders(request) }
          );
        }

        const status = (searchParams.get('status') || 'upcoming').toLowerCase();
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200) || 200, 1), 500);

        let jobsQuery: any = (dispatchClient as any)
          .from('h2s_dispatch_jobs')
          .select('*')
          .limit(limit)
          .order('created_at', { ascending: false });

        if (status === 'upcoming') {
          jobsQuery = jobsQuery.in('status', ['accepted', 'scheduled']);
        } else if (status === 'completed') {
          jobsQuery = jobsQuery.in('status', ['completed', 'paid']);
        } else if (status !== 'all') {
          jobsQuery = jobsQuery.eq('status', status);
        }

        const { data: jobs, error: jobsError } = await jobsQuery;
        if (jobsError) {
          return NextResponse.json(
            { ok: false, error: `Failed to load jobs: ${jobsError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        const normalized = (jobs || []).map((j: any) => ({
          ...j,
          id: String(j.job_id || j.id || ''),
          title: j.service_name || j.description || 'Job',
          date: j.window || j.start_iso || null,
          location: [j.address, j.city, j.state].filter(Boolean).join(', ') || null,
          customer: j.customer_name || null,
        }));

        return NextResponse.json({ ok: true, jobs: normalized }, { headers: corsHeaders(request) });
      }

      case 'offers':
      case 'offerLibrary':
      case 'offerLibraryOffers': {
        // Offer Builder / Offer Library offers (NOT dispatch "job offers").
        // Frontend calls this via GET.
        const offersVaName = searchParams.get('vaName') || searchParams.get('createdBy');

        // Important: Offers.Message_Context may contain very large blobs (e.g., base64 PDFs embedded in
        // latest_offer_brief.fileLink from historical deliverables). The Offer Library list view only
        // needs offer name + offer_builder snapshot (and AI_Analysis for frameworks), so default to a
        // slim select to avoid oversized payloads/timeouts.
        const wantFull = ['1', 'true', 'yes'].includes(String(searchParams.get('full') || searchParams.get('includeFull') || '').toLowerCase());
        const slim = !wantFull;
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200) || 200, 1), 500);

        const slimSelect = [
          'Offer_ID',
          'Created_By',
          'Created_At',
          'Updated_At',
          'SKU_ID',
          'Status',
          'Guardrail_Status',
          'Profit_Per_Job',
          'Margin_Pct',
          'Economics',
          'AI_Analysis',
          'Performance_Data',
          // minimal Message_Context fields used by the frontend list renderer
          'ctx_offerName:Message_Context->>offerName',
          'ctx_offer_name:Message_Context->>offer_name',
          'ctx_name:Message_Context->>name',
          'ctx_title:Message_Context->>title',
          'ctx_offer_builder:Message_Context->offer_builder',
          'ctx_offerBuilder:Message_Context->offerBuilder',
        ].join(',');

        const { primary, fallback } = getOffersDbFallback();
        const buildQuery = (db: any) => {
          let q = db
            .from('Offers')
            .select(slim ? slimSelect : '*')
            .order('Updated_At', { ascending: false })
            .limit(limit);
          if (offersVaName) q = q.eq('Created_By', offersVaName);
          return q;
        };

        let { data: offers, error: offersError } = await buildQuery(primary);
        if (offersError && (isOffersSchemaMismatchError(offersError) || isInvalidApiKeyError(offersError))) {
          const primaryErr = offersError;
          ({ data: offers, error: offersError } = await buildQuery(fallback));
          if (offersError && isInvalidApiKeyError(primaryErr)) {
            // Prefer an actionable error message when MGMT creds are misconfigured.
            return NextResponse.json(
              {
                ok: false,
                error:
                  'Offers DB auth failed (invalid API key). Your SUPABASE_URL_MGMT does not match SUPABASE_SERVICE_KEY_MGMT/SUPABASE_SERVICE_ROLE_KEY_MGMT. Fix MGMT env vars in Vercel (or local backend/.env.local), then retry.',
                details: {
                  primaryError: primaryErr.message || String(primaryErr),
                  fallbackError: offersError.message || String(offersError)
                }
              },
              { status: 500, headers: corsHeaders(request) }
            );
          }
        }

        if (offersError) {
          return NextResponse.json(
            { ok: false, error: `Failed to load offers: ${offersError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        const normalizedOffers = (offers || []).map((row: any) => {
          if (!slim) return row;
          const {
            ctx_offerName,
            ctx_offer_name,
            ctx_name,
            ctx_title,
            ctx_offer_builder,
            ctx_offerBuilder,
            ...rest
          } = row || {};

          const Message_Context: any = {};
          if (ctx_offerName != null) Message_Context.offerName = ctx_offerName;
          if (ctx_offer_name != null) Message_Context.offer_name = ctx_offer_name;
          if (ctx_name != null) Message_Context.name = ctx_name;
          if (ctx_title != null) Message_Context.title = ctx_title;
          if (ctx_offer_builder != null) Message_Context.offer_builder = ctx_offer_builder;
          if (ctx_offerBuilder != null) Message_Context.offerBuilder = ctx_offerBuilder;

          return { ...rest, Message_Context };
        });

        const safeTrim = (v: any) => String(v ?? '').trim();
        const parseMaybeJson = (value: any) => {
          if (!value) return null;
          if (typeof value === 'object') return value;
          if (typeof value !== 'string') return null;
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        };
        const extractCustomerPriceFromText = (text: any): number | null => {
          const s = safeTrim(text);
          if (!s) return null;
          try {
            const m = s.match(/\bCustomer\s*Price\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
            if (!m || !m[1]) return null;
            const n = Number(String(m[1]).replace(/,/g, ''));
            return Number.isFinite(n) && n > 0 ? n : null;
          } catch {
            return null;
          }
        };
        const extractServicesCountFromText = (text: any): number | null => {
          const s = safeTrim(text);
          if (!s) return null;
          try {
            const m = s.match(/\bServices\s*:\s*([\s\S]*?)(?=\n\s*(Customer\s*Price\s*:|Tech\s*Payout\s*:|Profit\s*:|Margin\s*:|Standards\s*Status\s*:|Headline\s*:|Promise\s*:|$))/i);
            const block = safeTrim(m && m[1] ? m[1] : '');
            if (!block) return null;
            const lines = block
              .split(/\r?\n/)
              .map((x) => safeTrim(x).replace(/^[-*•\d.\)\s]+/, ''))
              .filter(Boolean);
            return lines.length ? lines.length : null;
          } catch {
            return null;
          }
        };
        const computeOfferDataQuality = (row: any) => {
          let ctx: any = row ? (row.Message_Context || row.message_context || row.messageContext) : null;
          ctx = parseMaybeJson(ctx) || ctx;
          if (!ctx || typeof ctx !== 'object') ctx = {};

          const ob =
            parseMaybeJson((ctx as any).offer_builder || (ctx as any).offerBuilder) ||
            (ctx as any).offer_builder ||
            (ctx as any).offerBuilder ||
            {};
          const obObj: any = ob && typeof ob === 'object' ? ob : {};

          const name = safeTrim(
            (ctx as any).offerName ||
              (ctx as any).offer_name ||
              (ctx as any).name ||
              (ctx as any).title ||
              obObj.name ||
              (row && (row.Offer_Name || row.offerName || row.name || row.Title))
          );

          const lineItems = Array.isArray(obObj.lineItems) ? obObj.lineItems : [];
          const pricedLineItems = lineItems.filter((it: any) => {
            const qty = Number(it && it.qty);
            const unit = Number(
              it && it.baseUnitPrice != null ? it.baseUnitPrice : it && it.unitPrice != null ? it.unitPrice : 0
            );
            return Number.isFinite(qty) && Number.isFinite(unit) && qty > 0 && unit > 0;
          });

          const legacyDesc =
            (ctx as any)?.latest_offer_brief?.metadata?.description ||
            (ctx as any)?.latest_offer_brief?.Metadata?.description ||
            (ctx as any)?.latest_offer_brief?.description ||
            (ctx as any)?.latestOfferBrief?.metadata?.description ||
            null;

          const inferredCustomerPrice = extractCustomerPriceFromText(legacyDesc);
          const inferredServicesCount = extractServicesCountFromText(legacyDesc);

          const issues: string[] = [];
          if (!name) issues.push('missing_name');
          if (!lineItems.length) issues.push('missing_line_items');
          if (lineItems.length && pricedLineItems.length === 0) issues.push('missing_priced_line_item');

          const ok = issues.length === 0;
          const summaryParts: string[] = [];
          if (ok) summaryParts.push('Complete snapshot');
          else {
            summaryParts.push('Incomplete snapshot');
            if (issues.includes('missing_line_items')) summaryParts.push('missing services/line items');
            else if (issues.includes('missing_priced_line_item')) summaryParts.push('missing pricing');
            if (issues.includes('missing_name')) summaryParts.push('missing name');
          }

          const notes: string[] = [];
          if (!ok && inferredCustomerPrice) notes.push(`Offer Brief text suggests Customer Price $${inferredCustomerPrice.toFixed(0)}`);
          if (!ok && inferredServicesCount) notes.push(`Offer Brief text suggests ~${inferredServicesCount} service line(s)`);

          return {
            ok,
            issues,
            summary: summaryParts.join(' • '),
            inferred: {
              customerPrice: inferredCustomerPrice,
              servicesCount: inferredServicesCount,
            },
            notes,
          };
        };

        const offersWithQuality = (normalizedOffers || []).map((o: any) => ({
          ...o,
          dataQuality: computeOfferDataQuality(o),
        }));

        return NextResponse.json({ ok: true, offers: offersWithQuality }, { headers: corsHeaders(request) });
      }

      case 'offer': {
        // Get single offer by ID
        const offerId = searchParams.get('id');
        if (!offerId) {
          return NextResponse.json({
            ok: false,
            error: 'Offer ID required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        const { primary, fallback } = getOffersDbFallback();
        const run = async (db: any) => {
          return await db.from('Offers').select('*').eq('Offer_ID', offerId).single();
        };

        let { data: offer, error: offerError } = await run(primary);
        if (offerError && (isOffersSchemaMismatchError(offerError) || isInvalidApiKeyError(offerError))) {
          const primaryErr = offerError;
          ({ data: offer, error: offerError } = await run(fallback));
          if (offerError && isInvalidApiKeyError(primaryErr)) {
            return NextResponse.json(
              {
                ok: false,
                error:
                  'Offer DB auth failed (invalid API key). Your SUPABASE_URL_MGMT does not match SUPABASE_SERVICE_KEY_MGMT/SUPABASE_SERVICE_ROLE_KEY_MGMT. Fix MGMT env vars in Vercel (or local backend/.env.local), then retry.',
                details: {
                  primaryError: primaryErr.message || String(primaryErr),
                  fallbackError: offerError.message || String(offerError)
                }
              },
              { status: 500, headers: corsHeaders(request) }
            );
          }
        }

        if (offerError) {
          return NextResponse.json({
            ok: false,
            error: `Failed to load offer: ${offerError.message}`
          }, { status: 500, headers: corsHeaders(request) });
        }

        return NextResponse.json(
          { ok: true, offer },
          { headers: corsHeaders(request) }
        );
      }
        
      case 'updateTaskStatus':
        const taskId = searchParams.get('taskId');
        const status = searchParams.get('status');
        if (taskId && status) {
          const tasksDb = getDeliverablesDb();
          const { data: updatedTask } = await tasksDb
            .from('Tasks')
            .update({ 
              Status: status, 
              Completed_At: status === 'COMPLETED' ? new Date().toISOString() : null 
            })
            .eq('Task_ID', taskId)
            .select()
            .single();
          result = updatedTask;
        }
        break;

      case 'refineTask':
        const title = searchParams.get('title');
        const description = searchParams.get('description');
        if (title && description && openai) {
          // Call OpenAI
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert SOP writer. Convert rough notes into a clear, step-by-step Standard Operating Procedure." },
              { role: "user", content: `Task: ${title}\nNotes: ${description}` }
            ],
            model: "gpt-4o",
          });
          result = { refinedDescription: completion.choices[0].message.content };
        } else if (!openai) {
          result = { error: 'OpenAI API not configured' };
        }
        break;

      case 'refineExistingTask':
        const refineTaskId = searchParams.get('taskId');
        const feedback = searchParams.get('feedback');
        
        if (refineTaskId && feedback && openai) {
          const tasksDb = getDeliverablesDb();
          const { data: task } = await tasksDb
            .from('Tasks')
            .select('*')
            .eq('Task_ID', refineTaskId)
            .single();
          if (!task) throw new Error('Task not found');

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are a Revenue Operations Director. Clarify tasks to ensure high performance." },
              { role: "user", content: `CURRENT TASK:\nTitle: ${task.Title}\nDescription: ${task.Description}\n\nFEEDBACK: ${feedback}\n\nRewrite the description.` }
            ],
            model: "gpt-4o",
          });
          
          const newDescription = completion.choices[0].message.content;
          await tasksDb
            .from('Tasks')
            .update({ Description: newDescription })
            .eq('Task_ID', refineTaskId);
          
          result = { newDescription };
        } else if (!openai) {
          result = { error: 'OpenAI API not configured' };
        }
        break;

      case 'updateDecision':
        // Update manual decision for a candidate (PASS/FAIL) with optional notes
        const decisionCandidateId = searchParams.get('candidateId');
        const decisionValue = searchParams.get('decision'); // PASS or FAIL
        const decisionNotes = searchParams.get('notes') || '';
        
        if (!decisionCandidateId || !decisionValue) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing candidateId or decision parameter' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        if (decisionValue !== 'PASS' && decisionValue !== 'FAIL') {
          return NextResponse.json({ 
            ok: false, 
            error: 'Decision must be PASS or FAIL' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        try {
          // Update AI_Candidate_Profiles table
          const updateData: any = {
            Manual_Decision: decisionValue,
            Decision_Date: new Date().toISOString(),
            Decision_By: 'ROSEL' // TODO: Get from auth/session
          };
          
          // Add Decision_Notes if provided (feedback loop)
          if (decisionNotes) {
            updateData.Decision_Notes = decisionNotes;
          }
          
          const { data: updatedProfile, error: profileError } = await getSupabase()
            .from('AI_Candidate_Profiles')
            .update(updateData)
            .eq('Candidate_ID', decisionCandidateId)
            .select()
            .single();
          
          if (profileError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to update profile: ${profileError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          // If PASSED, update Candidate_Master to move them to HIRED stage
          if (decisionValue === 'PASS') {
            const { error: masterError } = await getSupabase()
              .from('Candidate_Master')
              .update({
                Current_Stage: 'HIRED',
                Interview_Outcome: 'PASSED - Hired',
                Updated_At: new Date().toISOString()
              })
              .eq('Candidate_ID', decisionCandidateId);
            
            if (masterError) {
              console.error('Failed to update Candidate_Master:', masterError);
              // Don't fail the request, just log the error
            }
          }
          
          result = { ok: true, profile: updatedProfile, message: 'Decision updated successfully' };
        } catch (error: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to update decision: ${error.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'generateTaskFromLearning':
        // Generate intelligent task from learning data
        if (!openai) {
          return NextResponse.json({ 
            ok: false, 
            error: 'OpenAI API not configured' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const concept = searchParams.get('concept') || '';
        const gap = searchParams.get('gap') || '';
        const resourceId = searchParams.get('resourceId') || '';
        const confidenceScore = parseInt(searchParams.get('confidenceScore') || '70', 10);
        const taskVaName = searchParams.get('vaName') || '';

        if (!concept && !gap) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Either concept or gap must be provided' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        try {
          // Get training resource if available
          let trainingContext = '';
          if (resourceId) {
            const { data: resource } = await getSupabase()
              .from('Training_Resources')
              .select('Title, Category, Skills_Taught, Description')
              .eq('Resource_ID', resourceId)
              .single();
            
            if (resource) {
              trainingContext = `\n\nTRAINING CONTEXT:\nTitle: ${resource.Title}\nCategory: ${resource.Category || 'General'}\nSkills Taught: ${resource.Skills_Taught || 'Not specified'}\nDescription: ${resource.Description || ''}`;
            }
          }

          const taskPrompt = `You are a Learning & Development specialist creating practice tasks for a Virtual Assistant.

${concept ? `CONCEPT LEARNED: ${concept}\nConfidence Level: ${confidenceScore}%` : ''}
${gap ? `KNOWLEDGE GAP IDENTIFIED: ${gap}` : ''}
${trainingContext}

Generate a professional, actionable task that:
1. Reinforces the learned concept OR addresses the identified gap
2. Has a clear, specific deliverable (what they will produce/create)
3. Includes step-by-step guidance
4. Defines success criteria
5. Is appropriate for confidence level ${confidenceScore}%

Return JSON with:
- "title": Clear, concise task title (max 60 chars)
- "description": Detailed task description with steps and context
- "deliverable": Specific output expected (e.g., "A 1-page SOP document", "A GoHighLevel workflow diagram", "3 completed customer onboarding sequences")
- "steps": Array of 3-5 specific action steps
- "successCriteria": Array of 2-3 measurable success criteria
- "estimatedTime": Estimated completion time in minutes
- "difficulty": "beginner", "intermediate", or "advanced" based on confidence

Format: JSON only, no markdown.`;

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert Learning & Development specialist. Always respond with valid JSON." },
              { role: "user", content: taskPrompt }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });

          try {
            const taskData = JSON.parse(completion.choices[0].message.content || '{}');
            result = taskData;
          } catch (e) {
            result = { error: 'Failed to parse AI response' };
          }
        } catch (aiError: any) {
          result = { error: `AI generation failed: ${aiError.message}` };
        }
        break;

      case 'archiveCandidate':
        const candidateId = searchParams.get('candidateId');
        // In a real DB, we might just set a status flag instead of moving tables
        if (candidateId) {
          const { data: updatedCandidate } = await getSupabase()
            .from('Candidate_Master')
            .update({ Current_Stage: 'ARCHIVED' })
            .eq('Candidate_ID', candidateId)
            .select()
            .single();
          result = updatedCandidate;
        }
        break;

      case 'upcomingMeetings':
        // Get meetings scheduled in the future or today
        const { data: upcomingMeetings } = await getSupabase()
          .from('Meetings')
          .select(`
            *,
            candidate:Candidate_Master(
              Candidate_ID,
              First_Name,
              Last_Name,
              Phone,
              Email
            ),
            attendees:Meeting_Attendees(*)
          `)
          .gte('Scheduled_At', new Date().toISOString())
          .in('Status', ['SCHEDULED', 'RESCHEDULED'])
          .order('Scheduled_At', { ascending: true })
          .limit(20);
        result = upcomingMeetings;
        break;

      case 'meetingHistory':
        // Get past/completed meetings
        const historyLimit = parseInt(searchParams.get('limit') || '50');
        const { data: meetingHistory } = await getSupabase()
          .from('Meetings')
          .select(`
            *,
            candidate:Candidate_Master(
              Candidate_ID,
              First_Name,
              Last_Name,
              Phone
            )
          `)
          .in('Status', ['COMPLETED', 'CANCELLED', 'NO_SHOW'])
          .order('Completed_At', { ascending: false })
          .limit(historyLimit);
        result = meetingHistory;
        break;

      case 'meeting':
        // Get single meeting by ID
        const meetingId = searchParams.get('meetingId');
        if (meetingId) {
          const { data: meeting } = await getSupabase()
            .from('Meetings')
            .select(`
              *,
              candidate:Candidate_Master(*),
              attendees:Meeting_Attendees(*)
            `)
            .eq('Meeting_ID', meetingId)
            .single();
          result = meeting;
        }
        break;

      case 'availableSlots':
        // Calculate next 5 available meeting slots
        // Simple implementation: suggest next 5 business days at 10am, 2pm, 4pm
        const availableSlots = [];
        const availableSlotsStartDate = new Date();
        availableSlotsStartDate.setDate(availableSlotsStartDate.getDate() + 1); // Tomorrow
        
        // Get existing meetings to avoid conflicts
        const { data: existingMeetings } = await getSupabase()
          .from('Meetings')
          .select('Scheduled_At, Duration_Minutes')
          .gte('Scheduled_At', availableSlotsStartDate.toISOString())
          .in('Status', ['SCHEDULED', 'RESCHEDULED']);
        
        const existingTimes = (existingMeetings || []).map(m => new Date(m.Scheduled_At).getTime());
        
        for (let day = 0; day < 7; day++) {
          const date = new Date(availableSlotsStartDate);
          date.setDate(date.getDate() + day);
          
          // Skip weekends
          if (date.getDay() === 0 || date.getDay() === 6) continue;
          
          // Morning slot (10 AM)
          const morning = new Date(date);
          morning.setHours(10, 0, 0, 0);
          if (!existingTimes.includes(morning.getTime())) {
            availableSlots.push({
              start: morning.toISOString(),
              end: new Date(morning.getTime() + 30 * 60000).toISOString()
            });
          }
          
          // Afternoon slot (2 PM)
          const afternoon = new Date(date);
          afternoon.setHours(14, 0, 0, 0);
          if (!existingTimes.includes(afternoon.getTime())) {
            availableSlots.push({
              start: afternoon.toISOString(),
              end: new Date(afternoon.getTime() + 30 * 60000).toISOString()
            });
          }
          
          // Evening slot (4 PM)
          const evening = new Date(date);
          evening.setHours(16, 0, 0, 0);
          if (!existingTimes.includes(evening.getTime())) {
            availableSlots.push({
              start: evening.toISOString(),
              end: new Date(evening.getTime() + 30 * 60000).toISOString()
            });
          }
          
          if (availableSlots.length >= 5) break;
        }
        
        result = { slots: availableSlots.slice(0, 5) };
        break;

      case 'submitTrainingCompletion':
        const s_resourceId = searchParams.get('resourceId');
        const s_vaName = searchParams.get('vaName');
        const s_notes = searchParams.get('notes');
        const s_rating = parseInt(searchParams.get('rating') || '0');
        const s_timeSpent = parseInt(searchParams.get('timeSpent') || '0');

        if (!s_resourceId || !s_vaName || !s_notes) {
          throw new Error('Missing required fields');
        }

        // 1. Fetch Resource Details
        const { data: resource } = await supabaseMgmt
          .from('Training_Resources')
          .select('*')
          .eq('Resource_ID', s_resourceId)
          .single();

        if (!resource) throw new Error('Resource not found');

        // 2. AI Analysis
        let aiAnalysis = {
          concepts: [],
          gaps: [],
          confidence: 0,
          raw: ''
        };

        if (openai) {
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert Learning & Development Analyst. Analyze the student's notes against the training material to assess comprehension." },
              { role: "user", content: `
                TRAINING TITLE: ${resource.Title}
                EXPECTED SKILLS: ${resource.Skills_Taught || 'General Knowledge'}
                
                STUDENT NOTES:
                ${s_notes}
                
                Analyze the notes and return a JSON object with:
                1. "concepts": Array of specific skills/concepts demonstrated in the notes.
                2. "gaps": Array of missing concepts or misunderstandings.
                3. "confidence": Integer 0-100 representing mastery level.
                4. "feedback": Brief constructive feedback.
              ` }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });
          
          const content = completion.choices[0].message.content;
          if (content) {
            const parsed = JSON.parse(content);
            aiAnalysis = {
              concepts: parsed.concepts || [],
              gaps: parsed.gaps || [],
              confidence: parsed.confidence || 0,
              raw: content
            };
          }
        }

        // 3. Insert Completion
        const { data: newCompletion, error: insertError } = await supabaseMgmt
          .from('Training_Completions')
          .insert({
            Resource_ID: s_resourceId,
            Completed_By: s_vaName,
            Notes_Learned: s_notes,
            Comprehension_Rating: s_rating,
            Time_Spent_Minutes: s_timeSpent,
            AI_Extracted_Concepts: JSON.stringify(aiAnalysis.concepts),
            AI_Knowledge_Gaps: JSON.stringify(aiAnalysis.gaps),
            AI_Confidence_Score: aiAnalysis.confidence,
            AI_Analysis_Raw: aiAnalysis.raw
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // 4. Update Profile (Simplified)
        // In a real app, we'd recalculate the whole profile here
        
        result = newCompletion;
        break;

      case 'addTrainingResource':
        const t_title = searchParams.get('title');
        const t_url = searchParams.get('url');
        const t_category = searchParams.get('category');
        const t_desc = searchParams.get('description');

        if (!t_title || !t_url) throw new Error('Missing title or URL');

        // AI Scan for Skills
        let t_skills = 'General';
        let t_difficulty = 'BEGINNER';
        let t_minutes = 15;

        if (openai && t_desc) {
           const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "Extract metadata from training description." },
              { role: "user", content: `Title: ${t_title}\nDescription: ${t_desc}\n\nReturn JSON: { "skills": "comma, separated, list", "difficulty": "BEGINNER/INTERMEDIATE/ADVANCED", "minutes": integer }` }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });
          const parsed = JSON.parse(completion.choices[0].message.content || '{}');
          t_skills = parsed.skills || t_skills;
          t_difficulty = parsed.difficulty || t_difficulty;
          t_minutes = parsed.minutes || t_minutes;
        }

        const { data: newResource } = await supabaseMgmt
          .from('Training_Resources')
          .insert({
            Title: t_title,
            URL: t_url,
            Category: t_category || 'General',
            Description: t_desc,
            Skills_Taught: t_skills,
            Difficulty_Level: t_difficulty,
            Estimated_Minutes: t_minutes
          })
          .select()
          .single();
        
        result = newResource;
        break;

      // Funnel Tracking Endpoints
      case 'stats':
        // Get overall stats from h2s_tracking_events
        const { data: events } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('session_id, visitor_id, occurred_at');

        let statsEvents = excludeTest ? (events || []).filter((e: any) => !isTestTrackingEvent(e)) : (events || []);
        if (excludeInternal) statsEvents = statsEvents.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        const uniqueSessions = new Set(statsEvents.map((e: any) => e.session_id).filter(Boolean) || []).size;
        const uniqueUsers = new Set(statsEvents.map((e: any) => e.visitor_id).filter(Boolean) || []).size;
        const totalEvents = statsEvents.length || 0;
        
        // Last 24 hours activity
        const twentyFourHoursAgoStats = new Date();
        twentyFourHoursAgoStats.setHours(twentyFourHoursAgoStats.getHours() - 24);
        const recentEvents = statsEvents.filter((e: any) => new Date(e.occurred_at) >= twentyFourHoursAgoStats).length || 0;
        
        result = {
          unique_sessions: uniqueSessions,
          unique_users: uniqueUsers,
          total_events: totalEvents,
          events_last_24h: recentEvents
        };
        break;

      case 'sessions':
        {
          // KPI-friendly sessions endpoint.
          // Returns unique session count (deduped by session_id) for the selected date window.
          const maxEvents = Math.min(Math.max(toInt(searchParams.get('max_events'), 200000), 1000), 200000);

          let sessionsQuery = getTrackingDb()
            .from('h2s_tracking_events')
            .select('session_id, visitor_id, occurred_at, page_path, utm_source, utm_medium, utm_campaign')
            .order('occurred_at', { ascending: false })
            .limit(maxEvents);

          if (minDate) sessionsQuery = sessionsQuery.gte('occurred_at', minDate);
          if (startDate) sessionsQuery = sessionsQuery.gte('occurred_at', startDate);
          if (endDate) sessionsQuery = sessionsQuery.lte('occurred_at', endDate);

          const { data: sessionEvents, error: sessionsError } = await sessionsQuery;
          if (sessionsError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load sessions: ${sessionsError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let filtered = excludeTest
            ? (sessionEvents || []).filter((e: any) => !isTestTrackingEvent(e))
            : (sessionEvents || []);
          if (excludeInternal) filtered = filtered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

          const uniqueSessionIds = new Set<string>();
          const uniqueVisitorIds = new Set<string>();

          type SessionRollup = {
            session_id: string;
            visitor_id: string | null;
            first_seen_at: string;
            last_seen_at: string;
            landing_page: string | null;
            utm_source: string | null;
            utm_medium: string | null;
            utm_campaign: string | null;
            _utm_seen_at_ms: number | null;
            _landing_seen_at_ms: number | null;
          };

          const sessionsById = new Map<string, SessionRollup>();

          for (const e of filtered as any[]) {
            const sessionId = e?.session_id ? String(e.session_id) : '';
            if (sessionId) uniqueSessionIds.add(sessionId);

            const visitorId = e?.visitor_id ? String(e.visitor_id) : null;
            if (visitorId) uniqueVisitorIds.add(visitorId);

            if (!sessionId) continue;
            const occurredAt = e?.occurred_at ? String(e.occurred_at) : '';
            const occurredMs = occurredAt ? new Date(occurredAt).getTime() : NaN;

            const existing = sessionsById.get(sessionId);
            if (!existing) {
              sessionsById.set(sessionId, {
                session_id: sessionId,
                visitor_id: visitorId,
                first_seen_at: occurredAt || new Date().toISOString(),
                last_seen_at: occurredAt || new Date().toISOString(),
                landing_page: typeof e?.page_path === 'string' ? e.page_path : null,
                utm_source: e?.utm_source != null ? String(e.utm_source) : null,
                utm_medium: e?.utm_medium != null ? String(e.utm_medium) : null,
                utm_campaign: e?.utm_campaign != null ? String(e.utm_campaign) : null,
                _utm_seen_at_ms: Number.isFinite(occurredMs) ? occurredMs : null,
                _landing_seen_at_ms: Number.isFinite(occurredMs) ? occurredMs : null,
              });
              continue;
            }

            if (visitorId && !existing.visitor_id) existing.visitor_id = visitorId;

            if (Number.isFinite(occurredMs)) {
              const firstMs = new Date(existing.first_seen_at).getTime();
              const lastMs = new Date(existing.last_seen_at).getTime();
              if (!Number.isFinite(firstMs) || occurredMs < firstMs) existing.first_seen_at = occurredAt;
              if (!Number.isFinite(lastMs) || occurredMs > lastMs) existing.last_seen_at = occurredAt;

              const pagePath = typeof e?.page_path === 'string' ? e.page_path : null;
              if (pagePath) {
                const landingMs = existing._landing_seen_at_ms;
                if (landingMs == null || occurredMs < landingMs) {
                  existing.landing_page = pagePath;
                  existing._landing_seen_at_ms = occurredMs;
                }
              }

              const hasAnyUtm = e?.utm_source != null || e?.utm_medium != null || e?.utm_campaign != null;
              if (hasAnyUtm) {
                const utmMs = existing._utm_seen_at_ms;
                if (utmMs == null || occurredMs < utmMs) {
                  existing.utm_source = e?.utm_source != null ? String(e.utm_source) : existing.utm_source;
                  existing.utm_medium = e?.utm_medium != null ? String(e.utm_medium) : existing.utm_medium;
                  existing.utm_campaign = e?.utm_campaign != null ? String(e.utm_campaign) : existing.utm_campaign;
                  existing._utm_seen_at_ms = occurredMs;
                }
              }
            }
          }

          const truncated = (sessionEvents || []).length >= maxEvents;

          // Compute top traffic source/medium (deduped by session).
          type SourceMediumAgg = { source: string; medium: string | null; sessions: number; last_seen_at: string | null };
          const bySourceMedium = new Map<string, SourceMediumAgg>();

          sessionsById.forEach((s) => {
            const rawSource = (s.utm_source ?? 'direct');
            const source = String(rawSource || 'direct').trim() || 'direct';
            const medium = s.utm_medium != null ? String(s.utm_medium).trim() : null;
            const key = `${source}|||${medium || ''}`;
            const existing = bySourceMedium.get(key);
            if (!existing) {
              bySourceMedium.set(key, {
                source,
                medium,
                sessions: 1,
                last_seen_at: s.last_seen_at || null,
              });
              return;
            }
            existing.sessions += 1;
            if (s.last_seen_at) {
              const prev = existing.last_seen_at ? new Date(existing.last_seen_at).getTime() : NaN;
              const cur = new Date(s.last_seen_at).getTime();
              if (!Number.isFinite(prev) || (Number.isFinite(cur) && cur > prev)) existing.last_seen_at = s.last_seen_at;
            }
          });

          const topSources = Array.from(bySourceMedium.values())
            .sort((a, b) => (b.sessions - a.sessions) || String(a.source).localeCompare(String(b.source)))
            .slice(0, 25);

          const top = topSources[0] || null;
          const topSource = top ? top.source : null;
          const topMedium = top ? top.medium : null;
          const topSourceMedium = top
            ? `${top.source}${top.medium ? ` / ${top.medium}` : ''}`
            : null;
          const topLastSeenAt = top ? (top.last_seen_at || null) : null;

          result = {
            total_sessions: uniqueSessionIds.size,
            unique_visitors: uniqueVisitorIds.size,
            total_events: filtered.length,
            last_event_at: filtered.length > 0 ? (filtered[0] as any).occurred_at : null,
            source: 'h2s_tracking_events',
            top_source: topSource,
            top_medium: topMedium,
            top_source_medium: topSourceMedium,
            top_last_seen_at: topLastSeenAt,
            top_sources: topSources,
            warning: truncated ? `Truncated at max_events=${maxEvents}` : null,
            meta: {
              max_events: maxEvents,
              returned: filtered.length,
              exclude_test: excludeTest,
              exclude_internal: excludeInternal,
              min_date: minDate || null,
              start_date: startDate || null,
              end_date: endDate || null
            }
          };
        }
        break;

      case 'revenue':
        // Revenue should come from Orders (source of truth), not inferred from tracking events.
        // This aligns with the “Orders tab” / business ledger and avoids event noise/duplication.
        const mainDb = getSupabase();
        if (!mainDb) {
          result = {
            total_revenue: 0,
            total_orders: 0,
            average_order_value: 0,
            revenue_last_30_days: 0,
            revenue_by_source: {},
            source: 'orders',
            warning: 'Main database client not configured',
          };
          break;
        }

        type OrderRow = {
          id?: any;
          order_id?: any;
          session_id?: any;
          created_at?: any;
          utm_source?: any;
          utm_campaign?: any;
          total?: any;
          subtotal?: any;
          order_total?: any;
          order_subtotal?: any;
          customer_email?: any;
          customer_phone?: any;
          metadata_json?: any;
          metadata?: any;
        };

        let orders: OrderRow[] = [];
        const maxOrdersRows = 5000;
        try {
          orders = await fetchAllRows<OrderRow>((from, to) =>
            mainDb
              .from('h2s_orders')
              .select('id,order_id,session_id,created_at,total,subtotal,order_total,order_subtotal,customer_email,customer_phone,metadata_json,metadata')
              .order('created_at', { ascending: false })
              .range(from, to)
          , 1000, maxOrdersRows);
        } catch (e: any) {
          // In case some columns don't exist in the table yet, fall back to selecting *.
          try {
            orders = await fetchAllRows<OrderRow>((from, to) =>
              mainDb.from('h2s_orders').select('*').order('created_at', { ascending: false }).range(from, to)
            , 1000, maxOrdersRows);
          } catch (e2: any) {
            result = {
              ok: false,
              error: e2?.message || e?.message || 'Failed to query h2s_orders',
              total_revenue: 0,
              total_orders: 0,
              average_order_value: 0,
              revenue_last_30_days: 0,
              revenue_by_source: {},
              source: 'orders',
            };
            break;
          }
        }

        let ordersFiltered = excludeTest ? orders.filter((o) => !isTestOrderRow(o)) : orders;

        // Only count orders that have positive revenue after normalization.
        const normalizedRows = ordersFiltered
          .map((o) => {
            const meta = extractOrderMeta(o);
            const utm_source =
              String(o?.utm_source ?? meta?.utm_source ?? meta?.utm?.source ?? meta?.source ?? 'direct') || 'direct';
            const created = o?.created_at || meta?.created_at || null;
            const amount = computeOrderRevenueAmount(o);
            return { amount, created_at: created, utm_source: utm_source || 'direct' };
          })
          .filter((r) => r.amount > 0);

        const totalRevenue = normalizedRows.reduce((sum, r) => sum + r.amount, 0);
        const transactionCount = normalizedRows.length;
        const avgTransaction = transactionCount > 0 ? totalRevenue / transactionCount : 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const revenueLast30Days = normalizedRows
          .filter((r) => {
            const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
            return Number.isFinite(t) && t >= thirtyDaysAgo.getTime();
          })
          .reduce((sum, r) => sum + r.amount, 0);

        const revenueBySource: Record<string, number> = {};
        for (const r of normalizedRows) {
          const source = String(r.utm_source || 'direct').trim() || 'direct';
          revenueBySource[source] = (revenueBySource[source] || 0) + r.amount;
        }

        result = {
          total_revenue: totalRevenue,
          total_orders: transactionCount,
          average_order_value: avgTransaction,
          revenue_last_30_days: revenueLast30Days,
          revenue_by_source: revenueBySource,
          source: 'orders',
        };
        break;

      case 'revenue_events':
        // Optional/debug: revenue inferred from tracking purchase events.
        // Prefer action=revenue (orders) for business-truth reporting.
        const { data: purchaseEventsRevenue } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('revenue_amount, occurred_at, order_id, customer_email, utm_source, utm_campaign, page_path')
          .not('revenue_amount', 'is', null)
          .eq('event_type', 'purchase');

        let revenueEvents = excludeTest
          ? (purchaseEventsRevenue || []).filter((e: any) => !isTestTrackingEvent(e))
          : (purchaseEventsRevenue || []);
        if (excludeInternal) revenueEvents = revenueEvents.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

        const totalRevenueEvents =
          revenueEvents.reduce((sum: number, e: any) => sum + normalizeRevenueAmount(e.revenue_amount), 0) || 0;
        const transactionCountEvents = revenueEvents.length || 0;
        const avgTransactionEvents = transactionCountEvents > 0 ? totalRevenueEvents / transactionCountEvents : 0;

        const thirtyDaysAgoEvents = new Date();
        thirtyDaysAgoEvents.setDate(thirtyDaysAgoEvents.getDate() - 30);
        const recentPurchases = revenueEvents.filter((e: any) => new Date(e.occurred_at) >= thirtyDaysAgoEvents) || [];
        const revenueLast30DaysEvents = recentPurchases.reduce(
          (sum: number, e: any) => sum + normalizeRevenueAmount(e.revenue_amount),
          0
        );

        const revenueBySourceEvents: Record<string, number> = {};
        revenueEvents.forEach((e: any) => {
          const source = e.utm_source || 'direct';
          revenueBySourceEvents[source] = (revenueBySourceEvents[source] || 0) + normalizeRevenueAmount(e.revenue_amount);
        });

        result = {
          total_revenue: totalRevenueEvents,
          total_orders: transactionCountEvents,
          average_order_value: avgTransactionEvents,
          revenue_last_30_days: revenueLast30DaysEvents,
          revenue_by_source: revenueBySourceEvents,
          source: 'events',
        };
        break;

      case 'cohorts':
        // Calculate user cohorts from h2s_tracking_events
        const { data: cohortEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('visitor_id, event_type, occurred_at, customer_email')
          .order('occurred_at', { ascending: false })
          .limit(10000);

        let cohortEventsFiltered = excludeTest ? (cohortEvents || []).filter((e: any) => !isTestTrackingEvent(e)) : (cohortEvents || []);
        if (excludeInternal) cohortEventsFiltered = cohortEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        // Group by visitor and determine their stage
        const visitorCohorts = new Map<string, any>();
        
        cohortEventsFiltered.forEach((event: any) => {
          // Use email as canonical identifier if available, else visitor_id
          // This ensures same user across devices is counted once
          const canonicalUserId = event.customer_email 
            ? `email:${event.customer_email.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!canonicalUserId) return;
          
          if (!visitorCohorts.has(canonicalUserId)) {
            visitorCohorts.set(canonicalUserId, {
              visitor_id: event.visitor_id,
              customer_email: event.customer_email || null,
              first_seen: event.occurred_at,
              last_seen: event.occurred_at,
              stage: 'visitor',
              event_count: 0
            });
          }
          
          const cohort = visitorCohorts.get(canonicalUserId);
          cohort.event_count += 1;
          
          // Update stage based on event type
          if (event.event_type === 'purchase') {
            cohort.stage = 'customer';
          } else if ((event.event_type === 'lead' || event.event_type === 'complete_registration') && cohort.stage !== 'customer') {
            cohort.stage = 'lead';
          } else if (event.event_type === 'view_content' && cohort.stage === 'visitor') {
            cohort.stage = 'browser';
          }
          
          const eventDate = new Date(event.occurred_at);
          if (eventDate > new Date(cohort.last_seen)) {
            cohort.last_seen = event.occurred_at;
          }
          if (eventDate < new Date(cohort.first_seen)) {
            cohort.first_seen = event.occurred_at;
          }
        });
        
        // Aggregate by stage
        const userCohorts: Record<string, number> = {
          visitor: 0,
          browser: 0,
          engaged: 0,
          lead: 0,
          customer: 0
        };
        
        visitorCohorts.forEach(cohort => {
          const stage = cohort.stage || 'visitor';
          if (userCohorts.hasOwnProperty(stage)) {
            userCohorts[stage] += 1;
          }
        });
        
        result = {
          total_users: visitorCohorts.size,
          user_cohorts: userCohorts,
          cohorts: Array.from(visitorCohorts.values()).slice(0, 100)
        };
        break;

      case 'meta_pixel_events':
        // Query Database 1 directly (h2s_tracking_events table)
        let allEvents;
        let totalEventsInDatabase = 0;
        const db1Client = getTrackingDb();
        
        if (db1Client) {
          // Build query with date filters
          let countQuery = db1Client
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true });
          
          // Apply date range filters at database level for accurate counts
          if (minDate) {
            countQuery = countQuery.gte('occurred_at', minDate);
          }
          if (startDate) {
            countQuery = countQuery.gte('occurred_at', startDate);
          }
          if (endDate) {
            countQuery = countQuery.lte('occurred_at', endDate);
          }
          
          // FIRST: Get filtered count
          const { count: dbCount, error: countError } = await countQuery;
          
          if (!countError && typeof dbCount === 'number') {
            totalEventsInDatabase = dbCount;
          }
          
          // THEN: Query events with same filters (limited for performance)
          let eventQuery = db1Client
            .from('h2s_tracking_events')
            // Memory guardrail: avoid selecting wide rows (metadata blobs / raw payloads).
            // Only select columns actually used by this analytics pipeline.
            .select(
              'event_id,occurred_at,created_at,event_type,event_name,revenue_amount,order_id,job_id,customer_email,customer_phone,session_id,visitor_id,page_path,referrer,element_id,element_text,metadata,utm_source,utm_medium,utm_campaign'
            )
            .order('occurred_at', { ascending: false });
          
          if (minDate) eventQuery = eventQuery.gte('occurred_at', minDate);
          if (startDate) eventQuery = eventQuery.gte('occurred_at', startDate);
          if (endDate) eventQuery = eventQuery.lte('occurred_at', endDate);
          
          const { data: events, error } = await eventQuery.limit(10000);
          
          if (!error && events) {
            allEvents = events;
          } else if (error) {
            console.error('Error querying Database 1:', error);
          }
        } else {
          console.warn('Database 1 client not available - cannot query h2s_tracking_events');
        }
        
        // If Database 1 query failed or unavailable, return empty result (don't fall back to Database 2)
        if (!allEvents) {
          allEvents = [];
          console.warn('No events found from Database 1 - returning empty result');
        }
        
        const eventTypes: Record<string, any> = {};
        // IMPORTANT:
        // FunnelTrack "Total Conversion Value" should be PURCHASE revenue only.
        // Keep a separate all-events tally for debugging/investigation.
        let totalValueAllEvents = 0;
        let totalValuePurchaseEvents = 0;
        let totalValuePurchaseEventsUnattributed = 0;
        const revenueEventsDebug: Array<any> = [];
        const uniqueSessionsSet = new Set<string>();
        const uniqueUsersSet = new Set<string>();
        const pagePaths: Record<string, number> = {};
        const referrers: Record<string, number> = {};
        const clickedElements: Record<string, number> = {};
        const byPageType: Record<string, number> = {};
        const byUtmSource: Record<string, number> = {};
        const byUtmMedium: Record<string, number> = {};
        const byUtmCampaign: Record<string, number> = {};
        const customerEmails = new Set<string>();
        const customerPhones = new Set<string>();
        
        if (excludeTest) {
          allEvents = (allEvents || []).filter((e: any) => !isTestTrackingEvent(e));
        }
        if (excludeInternal) {
          allEvents = (allEvents || []).filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        }

        // Filter to intentional/allowlisted event types.
        // Also normalize legacy variants (pageview/viewcontent/button_click) to canonical.
        const totalEventsBeforeAllowlist = (allEvents || []).length;
        const ignoredEventTypes: Record<string, number> = {};
        allEvents = (allEvents || []).filter((event: any) => {
          const rawEventType = event.event_type || event.event_name || '';
          const eventType = normalizeTrackingEventType(rawEventType);
          if (isAllowedTrackingEventType(eventType)) return true;
          if (debug) {
            const key = eventType || 'unknown';
            ignoredEventTypes[key] = (ignoredEventTypes[key] || 0) + 1;
          }
          return false;
        });

        // By default, only count purchase revenue when it is attributable.
        // Override for investigations with include_unattributed_purchases=1.
        const includeUnattributedPurchases = searchParams.get('include_unattributed_purchases') === '1';

        allEvents?.forEach((event: any) => {
          // Event type breakdown (support both event_type and event_name fields)
          // Normalize to lowercase for consistent matching across all event types
          const rawEventType = event.event_type || event.event_name || 'unknown';
          const eventType = normalizeTrackingEventType(rawEventType);
          if (!eventTypes[eventType]) {
            eventTypes[eventType] = { count: 0, revenue: 0 };
          }
          eventTypes[eventType].count++;

          // Only count conversion value from PURCHASE events.
          // Some rows may contain revenue_amount on non-purchase events due to historical bugs.
          const rev = normalizeRevenueAmount(event.revenue_amount);
          if (rev > 0) {
            totalValueAllEvents += rev;

            if (eventType === 'purchase') {
              const hasAttribution =
                !!(event.order_id && String(event.order_id).trim()) ||
                !!(event.job_id && String(event.job_id).trim()) ||
                !!(event.customer_email && String(event.customer_email).trim());

              if (includeUnattributedPurchases || hasAttribution) {
                eventTypes[eventType].revenue += rev;
                totalValuePurchaseEvents += rev;
              } else {
                totalValuePurchaseEventsUnattributed += rev;
              }
            }

            if (debug) {
              revenueEventsDebug.push({
                event_id: event.event_id,
                occurred_at: event.occurred_at,
                event_type: event.event_type,
                event_name: event.event_name,
                page_path: event.page_path,
                order_id: event.order_id,
                job_id: event.job_id,
                customer_email: event.customer_email,
                revenue_amount_raw: event.revenue_amount,
                revenue_amount_normalized: rev,
                counted_as_purchase: eventType === 'purchase',
                counted_in_total:
                  eventType !== 'purchase'
                    ? false
                    : includeUnattributedPurchases
                      ? true
                      : !!(
                          (event.order_id && String(event.order_id).trim()) ||
                          (event.job_id && String(event.job_id).trim()) ||
                          (event.customer_email && String(event.customer_email).trim())
                        )
              });
            }
          }
          
          // Sessions and users
          if (event.session_id) uniqueSessionsSet.add(event.session_id);
          if (event.visitor_id) uniqueUsersSet.add(event.visitor_id);
          
          // Page path analysis
          if (event.page_path) {
            pagePaths[event.page_path] = (pagePaths[event.page_path] || 0) + 1;
          }
          
          // Referrer tracking
          if (event.referrer && event.referrer !== '(direct)') {
            try {
              const referrerDomain = new URL(event.referrer).hostname;
              referrers[referrerDomain] = (referrers[referrerDomain] || 0) + 1;
            } catch {
              referrers[event.referrer] = (referrers[event.referrer] || 0) + 1;
            }
          } else if (event.referrer === '(direct)') {
            referrers['direct'] = (referrers['direct'] || 0) + 1;
          }
          
          // Click tracking (element_id/element_text)
          if (event.element_id || event.element_text) {
            const elementKey = event.element_id || event.element_text;
            clickedElements[elementKey] = (clickedElements[elementKey] || 0) + 1;
          }
          
          // Extract page_type from metadata if available
          // Handle both JSON string and object formats
          let metadata = event.metadata;
          if (metadata && typeof metadata === 'string') {
            try {
              metadata = JSON.parse(metadata);
            } catch (e) {
              // If parsing fails, skip metadata extraction
              metadata = null;
            }
          }
          if (metadata && typeof metadata === 'object') {
            const pageType = metadata.page_type || metadata.pageType;
            if (pageType) {
              byPageType[pageType] = (byPageType[pageType] || 0) + 1;
            }
          }
          
          // UTM tracking
          if (event.utm_source) {
            byUtmSource[event.utm_source] = (byUtmSource[event.utm_source] || 0) + 1;
          }
          if (event.utm_medium) {
            byUtmMedium[event.utm_medium] = (byUtmMedium[event.utm_medium] || 0) + 1;
          }
          if (event.utm_campaign) {
            byUtmCampaign[event.utm_campaign] = (byUtmCampaign[event.utm_campaign] || 0) + 1;
          }
          
          // Customer identification
          if (event.customer_email) customerEmails.add(event.customer_email);
          if (event.customer_phone) customerPhones.add(event.customer_phone);
        });
        
        // Calculate page path performance scores (views, engagement, conversions, revenue)
        const pagePathScores: Record<string, any> = {};
        
        allEvents?.forEach((event: any) => {
          if (event.page_path) {
            // Support both event_type and event_name fields
            // Normalize to lowercase for consistent matching
            const rawEventType = event.event_type || event.event_name || '';
            const eventType = normalizeTrackingEventType(rawEventType);
            
            if (!pagePathScores[event.page_path]) {
              pagePathScores[event.page_path] = {
                views: 0,
                engagement: 0,
                leads: 0,
                purchases: 0,
                revenue: 0
              };
            }
            
            if (eventType === 'page_view') {
              pagePathScores[event.page_path].views += 1;
            }
            if (eventType === 'view_content') {
              pagePathScores[event.page_path].engagement += 1;
            }
            if (eventType === 'lead' || eventType === 'complete_registration') {
              pagePathScores[event.page_path].leads += 1;
            }
            if (eventType === 'purchase') {
              pagePathScores[event.page_path].purchases += 1;
              const rev = normalizeRevenueAmount(event.revenue_amount);
              pagePathScores[event.page_path].revenue += rev;
            }
          }
        });
        
        // Score pages: weighted score = (views * 1) + (engagement * 2) + (leads * 5) + (purchases * 10) + (revenue / 10)
        const scoredPages = Object.entries(pagePathScores).map(([path, metrics]: [string, any]) => {
          const score = (metrics.views * 1) + 
                       (metrics.engagement * 2) + 
                       (metrics.leads * 5) + 
                       (metrics.purchases * 10) + 
                       (metrics.revenue / 10);
          const conversionRate = metrics.views > 0 ? ((metrics.leads + metrics.purchases) / metrics.views * 100) : 0;
          return {
            path,
            score: Math.round(score),
            views: metrics.views,
            engagement: metrics.engagement,
            leads: metrics.leads,
            purchases: metrics.purchases,
            revenue: metrics.revenue,
            conversion_rate: Number(conversionRate.toFixed(2))
          };
        }).sort((a, b) => b.score - a.score);
        
        // Get latest event timestamp (events are already sorted DESC by occurred_at)
        const latestEventTimestamp = allEvents && allEvents.length > 0 
          ? (allEvents[0].occurred_at || allEvents[0].created_at) 
          : null;
        
        // Sort top items
        const topPagePaths = Object.entries(pagePaths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [path, count]) => ({ ...acc, [path]: count }), {});
        
        const topReferrers = Object.entries(referrers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [ref, count]) => ({ ...acc, [ref]: count }), {});
        
        const topClickedElements = Object.entries(clickedElements)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [elem, count]) => ({ ...acc, [elem]: count }), {});
        
        // Generate insights
        const insights = [];
        if (scoredPages.length > 0) {
          const topPage = scoredPages[0];
          insights.push({
            type: 'top_performer',
            message: `"${topPage.path}" is your top performing page with ${topPage.views} views, ${topPage.leads} leads, and $${topPage.revenue.toFixed(2)} revenue.`,
            score: topPage.score
          });
        }
        
        const avgConversionRate = scoredPages.length > 0 
          ? scoredPages.reduce((sum, p) => sum + p.conversion_rate, 0) / scoredPages.length 
          : 0;
        if (avgConversionRate > 0) {
          insights.push({
            type: 'conversion_health',
            message: `Average conversion rate across all pages: ${avgConversionRate.toFixed(1)}%`,
            score: avgConversionRate
          });
        }
        
        const topSource = Object.entries(byUtmSource).sort((a, b) => b[1] - a[1])[0];
        if (topSource) {
          insights.push({
            type: 'traffic_source',
            message: `"${topSource[0]}" drives ${topSource[1]} events (${((topSource[1] / (allEvents?.length || 1)) * 100).toFixed(1)}% of total traffic)`,
            score: topSource[1]
          });
        }
        
        // Calculate TRUE unique users: use email as canonical identifier if available, else visitor_id
        // This prevents counting same user multiple times across devices/browsers
        const canonicalUsers = new Set<string>();
        allEvents?.forEach((event: any) => {
          if (event.customer_email) {
            // Use normalized email as canonical identifier
            canonicalUsers.add(`email:${event.customer_email.toLowerCase().trim()}`);
          } else if (event.visitor_id) {
            // Fall back to visitor_id if no email
            canonicalUsers.add(`visitor:${event.visitor_id}`);
          }
        });
        const uniqueUsersCanonical = canonicalUsers.size;
        
        // ENHANCED ANALYTICS: Time-based breakdowns and trends
        // When a custom end_date is provided, compute "recent" windows relative to that
        // so the context card stays consistent with the selected time range.
        const now = endDate ? new Date(endDate) : new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgoAnalytics = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // Track metrics by time period
        const eventsLast24h = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= oneDayAgo);
        const eventsLast7d = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= sevenDaysAgo);
        const eventsLast30d = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= thirtyDaysAgoAnalytics);
        
        // Unique users by time period
        const usersLast24h = new Set<string>();
        const usersLast7d = new Set<string>();
        const usersLast30d = new Set<string>();
        
        eventsLast24h.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast24h.add(id);
        });
        eventsLast7d.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast7d.add(id);
        });
        eventsLast30d.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast30d.add(id);
        });
        
        // Calculate daily averages and growth rates
        const oldestEventDate = allEvents && allEvents.length > 0 
          ? new Date(allEvents[allEvents.length - 1].occurred_at)
          : now;
        const daysSinceFirstEvent = Math.max(1, Math.floor((now.getTime() - oldestEventDate.getTime()) / (24 * 60 * 60 * 1000)));
        const avgEventsPerDay = (allEvents?.length || 0) / daysSinceFirstEvent;
        const avgUsersPerDay = uniqueUsersCanonical / daysSinceFirstEvent;
        
        // Session engagement metrics
        const sessionEngagement: Record<string, {events: number; duration_minutes?: number; converted: boolean}> = {};
        (allEvents || []).forEach((e: any) => {
          if (!e.session_id) return;
          if (!sessionEngagement[e.session_id]) {
            sessionEngagement[e.session_id] = { events: 0, converted: false };
          }
          sessionEngagement[e.session_id].events++;
          
          const eventType = normalizeTrackingEventType(e.event_type || e.event_name);
          if (eventType === 'purchase' || eventType === 'lead') {
            sessionEngagement[e.session_id].converted = true;
          }
        });
        
        // Calculate session stats
        const sessionEvents = Object.values(sessionEngagement).map(s => s.events);
        const avgEventsPerSession = sessionEvents.length > 0 
          ? sessionEvents.reduce((sum, n) => sum + n, 0) / sessionEvents.length 
          : 0;
        const convertedSessions = Object.values(sessionEngagement).filter(s => s.converted).length;
        const sessionConversionRate = uniqueSessionsSet.size > 0 
          ? (convertedSessions / uniqueSessionsSet.size) * 100 
          : 0;
        
        // Funnel analysis: page_view -> engagement -> lead -> purchase
        const funnelMetrics = {
          page_views: (eventTypes['page_view']?.count || 0),
          engagement_events: (eventTypes['view_content']?.count || 0) + (eventTypes['scroll_depth']?.count || 0),
          leads: (eventTypes['lead']?.count || 0) + (eventTypes['cta_click']?.count || 0),
          purchases: (eventTypes['purchase']?.count || 0)
        };
        
        // Calculate funnel drop-off rates
        const funnelDropoff = {
          view_to_engage: funnelMetrics.page_views > 0 
            ? ((funnelMetrics.page_views - funnelMetrics.engagement_events) / funnelMetrics.page_views * 100) 
            : 0,
          engage_to_lead: funnelMetrics.engagement_events > 0 
            ? ((funnelMetrics.engagement_events - funnelMetrics.leads) / funnelMetrics.engagement_events * 100) 
            : 0,
          lead_to_purchase: funnelMetrics.leads > 0 
            ? ((funnelMetrics.leads - funnelMetrics.purchases) / funnelMetrics.leads * 100) 
            : 0
        };
        
        // Top converting traffic sources
        const sourceConversions: Record<string, {events: number; conversions: number; revenue: number}> = {};
        (allEvents || []).forEach((e: any) => {
          const source = e.utm_source || 'direct';
          if (!sourceConversions[source]) {
            sourceConversions[source] = { events: 0, conversions: 0, revenue: 0 };
          }
          sourceConversions[source].events++;
          
          const eventType = normalizeTrackingEventType(e.event_type || e.event_name);
          if (eventType === 'purchase') {
            sourceConversions[source].conversions++;
            sourceConversions[source].revenue += normalizeRevenueAmount(e.revenue_amount);
          }
        });
        
        const topConvertingSources = Object.entries(sourceConversions)
          .map(([source, data]) => ({
            source,
            events: data.events,
            conversions: data.conversions,
            revenue: data.revenue,
            conversion_rate: data.events > 0 ? (data.conversions / data.events * 100) : 0,
            revenue_per_event: data.events > 0 ? data.revenue / data.events : 0
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10);
        
        const totalValue = totalValuePurchaseEvents;

        result = {
          summary: {
            // Core metrics
            total_events: allEvents?.length || 0,
            total_events_in_database: totalEventsInDatabase,
            unique_sessions: uniqueSessionsSet.size,
            unique_users: uniqueUsersCanonical,
            unique_users_by_visitor_id: uniqueUsersSet.size,
            unique_customers_with_email: customerEmails.size,
            unique_customers_with_phone: customerPhones.size,
            total_revenue: totalValue,
            
            // Time context
            tracking_period: {
              first_event_date: oldestEventDate.toISOString(),
              latest_event_date: latestEventTimestamp,
              days_tracked: daysSinceFirstEvent,
              time_range_label: daysSinceFirstEvent === 1 
                ? 'Last 24 hours' 
                : daysSinceFirstEvent <= 7 
                  ? `Last ${daysSinceFirstEvent} days` 
                  : daysSinceFirstEvent <= 30 
                    ? 'Last month' 
                    : `${daysSinceFirstEvent} days of data`
            },
            
            // Recent activity (context for "how recent")
            recent_activity: {
              events_last_24h: eventsLast24h.length,
              events_last_7d: eventsLast7d.length,
              events_last_30d: eventsLast30d.length,
              users_last_24h: usersLast24h.size,
              users_last_7d: usersLast7d.size,
              users_last_30d: usersLast30d.size
            },
            
            // Growth metrics
            growth_metrics: {
              avg_events_per_day: Number(avgEventsPerDay.toFixed(1)),
              avg_users_per_day: Number(avgUsersPerDay.toFixed(1)),
              user_acquisition_velocity: `${Number(avgUsersPerDay.toFixed(1))} users/day over ${daysSinceFirstEvent} days`
            },
            
            // Session engagement
            session_metrics: {
              total_sessions: uniqueSessionsSet.size,
              avg_events_per_session: Number(avgEventsPerSession.toFixed(1)),
              converted_sessions: convertedSessions,
              session_conversion_rate: Number(sessionConversionRate.toFixed(2)),
              engagement_quality: avgEventsPerSession >= 5 ? 'High' : avgEventsPerSession >= 3 ? 'Medium' : 'Low'
            },
            
            // Funnel performance
            funnel: {
              page_views: funnelMetrics.page_views,
              engagement_events: funnelMetrics.engagement_events,
              leads: funnelMetrics.leads,
              purchases: funnelMetrics.purchases,
              dropoff_rates: {
                view_to_engage_pct: Number(funnelDropoff.view_to_engage.toFixed(1)),
                engage_to_lead_pct: Number(funnelDropoff.engage_to_lead.toFixed(1)),
                lead_to_purchase_pct: Number(funnelDropoff.lead_to_purchase.toFixed(1))
              },
              overall_conversion_rate: funnelMetrics.page_views > 0 
                ? Number(((funnelMetrics.purchases / funnelMetrics.page_views) * 100).toFixed(2))
                : 0
            },
            
            // Traffic source performance
            top_converting_sources: topConvertingSources,
            
            by_event_type: eventTypes,
            latest_event_at: latestEventTimestamp
          },
          by_page_path: topPagePaths,
          by_referrer: topReferrers,
          by_page_type: byPageType,
          by_utm_source: byUtmSource,
          by_utm_medium: byUtmMedium,
          by_utm_campaign: byUtmCampaign,
          top_clicked_elements: topClickedElements,
          page_performance: scoredPages.slice(0, 10), // Top 10 performing pages
          insights: insights,
          events: allEvents?.slice(0, 100) || [], // Return sample for preview
          ...(debug
            ? {
                debug: {
                  total_events_before_allowlist: totalEventsBeforeAllowlist,
                  total_events_after_allowlist: allEvents?.length || 0,
                  ignored_event_types: ignoredEventTypes,
                  total_revenue_purchase_events: totalValuePurchaseEvents,
                  total_revenue_purchase_events_unattributed: totalValuePurchaseEventsUnattributed,
                  total_revenue_all_events: totalValueAllEvents,
                  include_unattributed_purchases: includeUnattributedPurchases,
                  top_revenue_events: revenueEventsDebug
                    .sort((a, b) => (b.revenue_amount_normalized || 0) - (a.revenue_amount_normalized || 0))
                    .slice(0, 100)
                }
              }
            : {})
        };
        break;

      case 'recent_purchases':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = Math.max(1, Math.min(toInt(searchParams.get('limit'), 25), 100));
          const scanLimit = Math.max(limit, 250);

          const db1Client = getTrackingDb();
          const { data: events, error } = await db1Client
            .from('h2s_tracking_events')
            .select('*')
            .order('occurred_at', { ascending: false })
            .limit(Math.min(2000, scanLimit * 10));

          if (error) {
            return NextResponse.json(
              { ok: false, error: `Failed to load recent purchases: ${error.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let rows: any[] = events || [];
          if (excludeTest) rows = rows.filter((e: any) => !isTestTrackingEvent(e));
          if (excludeInternal) rows = rows.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

          const purchases = rows
            .filter((e: any) => normalizeTrackingEventType(e.event_type || e.event_name) === 'purchase')
            .slice(0, limit)
            .map((e: any) => {
              const revenue = normalizeRevenueAmount(e.revenue_amount);
              const hasAttribution =
                !!(e.order_id && String(e.order_id).trim()) ||
                !!(e.job_id && String(e.job_id).trim()) ||
                !!(e.customer_email && String(e.customer_email).trim());

              return {
                event_id: e.event_id,
                occurred_at: e.occurred_at,
                page_path: e.page_path,
                visitor_id: e.visitor_id,
                session_id: e.session_id,
                order_id: e.order_id,
                job_id: e.job_id,
                customer_email: e.customer_email,
                revenue_amount: revenue,
                has_attribution: hasAttribution
              };
            });

          result = {
            purchases,
            meta: {
              limit,
              returned: purchases.length,
              exclude_test: excludeTest,
              exclude_internal: excludeInternal
            }
          };
        }
        break;

      case 'funnel':
        {
          // Funnel summary for the dashboard.
          // Contract: include raw event counters + unique session count + optional source breakdown.

          const maxEvents = Math.min(Math.max(toInt(searchParams.get('max_events'), 200000), 1000), 200000);

          let funnelQuery = getTrackingDb()
            .from('h2s_tracking_events')
            .select('event_type, event_name, visitor_id, session_id, occurred_at, customer_email, metadata, utm_source, utm_medium, page_path')
            .order('occurred_at', { ascending: false })
            .limit(maxEvents);

          if (minDate) funnelQuery = funnelQuery.gte('occurred_at', minDate);
          if (startDate) funnelQuery = funnelQuery.gte('occurred_at', startDate);
          if (endDate) funnelQuery = funnelQuery.lte('occurred_at', endDate);

          const { data: funnelEvents, error: funnelError } = await funnelQuery;
          if (funnelError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load funnel events: ${funnelError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let funnelEventsFiltered = excludeTest
            ? (funnelEvents || []).filter((e: any) => !isTestTrackingEvent(e))
            : (funnelEvents || []);
          if (excludeInternal) funnelEventsFiltered = funnelEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

          const uniqueVisitors = new Set<string>();
          const visitorsWithViewContent = new Set<string>();
          const engagedVisitors = new Set<string>();
          const leadVisitors = new Set<string>();
          const customerVisitors = new Set<string>();
          const uniqueSessions = new Set<string>();
          const sessionEventCounts: Record<string, number> = {};
          const sessionAttribution: Record<string, { source: string; medium: string | null }> = {};

          const counts = {
            page_view: 0,
            view_content: 0,
            add_to_cart: 0,
            initiate_checkout: 0,
            purchase: 0
          };

          const normalizeUtm = (val: any): string => {
            const s = String(val || '').trim().toLowerCase();
            if (!s || s === 'none' || s === '(none)' || s === '(not set)' || s === 'null' || s === 'undefined') return 'direct';
            return s;
          };

          funnelEventsFiltered.forEach((event: any) => {
            const sessionId = event.session_id ? String(event.session_id) : '';
            if (sessionId) uniqueSessions.add(sessionId);

            const canonicalUserId = (event as any).customer_email
              ? `email:${String((event as any).customer_email).toLowerCase().trim()}`
              : event.visitor_id
              ? `visitor:${String(event.visitor_id)}`
              : null;

            const normalizedType = normalizeTrackingEventType((event as any).event_type || (event as any).event_name || '');

            // Raw counters (event-level)
            if (normalizedType === 'page_view') counts.page_view++;
            if (normalizedType === 'view_content') counts.view_content++;
            if (normalizedType === 'add_to_cart') counts.add_to_cart++;
            if (normalizedType === 'initiate_checkout') counts.initiate_checkout++;
            if (normalizedType === 'purchase') counts.purchase++;

            // Attribution by session (first non-direct wins)
            if (sessionId) {
              const rawSource = (event as any).utm_source ?? (event as any)?.metadata?.utm_source;
              const rawMedium = (event as any).utm_medium ?? (event as any)?.metadata?.utm_medium;
              const source = normalizeUtm(rawSource);
              const medium = rawMedium ? String(rawMedium).trim().toLowerCase() : null;

              const existing = sessionAttribution[sessionId];
              if (!existing) {
                sessionAttribution[sessionId] = { source, medium };
              } else if (existing.source === 'direct' && source !== 'direct') {
                sessionAttribution[sessionId] = { source, medium };
              }
            }

            // Stage distribution (user-level)
            if (!canonicalUserId) return;

            // Visitor: anyone with page_view
            if (normalizedType === 'page_view') {
              uniqueVisitors.add(canonicalUserId);
              if (sessionId) sessionEventCounts[sessionId] = (sessionEventCounts[sessionId] || 0) + 1;
            }

            // Browser: view_content events (engaged viewing)
            if (normalizedType === 'view_content') {
              visitorsWithViewContent.add(canonicalUserId);
            }

            // Engaged: multiple page views or interaction events
            const interactionEvents = new Set(['add_to_cart', 'initiate_checkout', 'click']);
            if ((sessionId && (sessionEventCounts[sessionId] || 0) >= 2) || interactionEvents.has(normalizedType)) {
              engagedVisitors.add(canonicalUserId);
            }

            // Lead: lead or complete_registration events
            if (normalizedType === 'lead' || normalizedType === 'complete_registration') {
              leadVisitors.add(canonicalUserId);
            }

            // Customer: purchase events
            if (normalizedType === 'purchase') {
              customerVisitors.add(canonicalUserId);
            }
          });

          const visitorCount = uniqueVisitors.size;
          const browserCount = visitorsWithViewContent.size;
          const engagedCount = engagedVisitors.size;
          const leadCount = leadVisitors.size;
          const customerCount = customerVisitors.size;
          const uniqueSessionCount = uniqueSessions.size;

          const sourceCounts: Record<string, { source: string; medium: string | null; count: number }> = {};
          Object.values(sessionAttribution).forEach((a) => {
            const key = `${a.source}||${a.medium || ''}`;
            if (!sourceCounts[key]) sourceCounts[key] = { source: a.source, medium: a.medium, count: 0 };
            sourceCounts[key].count += 1;
          });
          const sources = Object.values(sourceCounts).sort((a, b) => b.count - a.count).slice(0, 50);

          result = {
            ...counts,
            total_events: funnelEventsFiltered.length,
            unique_sessions: uniqueSessionCount,
            unique_visitors: visitorCount,
            sources,
            stage_distribution: {
              visitor: visitorCount,
              browser: browserCount,
              engaged: engagedCount,
              lead: leadCount,
              customer: customerCount
            },
            totals: {
              leads: leadCount,
              customers: customerCount
            },
            conversion_rates: {
              visitor_to_browser: visitorCount > 0 ? `${((browserCount / visitorCount) * 100).toFixed(1)}%` : '0%',
              browser_to_engaged: browserCount > 0 ? `${((engagedCount / browserCount) * 100).toFixed(1)}%` : '0%',
              engaged_to_lead: engagedCount > 0 ? `${((leadCount / engagedCount) * 100).toFixed(1)}%` : '0%',
              lead_to_customer: leadCount > 0 ? `${((customerCount / leadCount) * 100).toFixed(1)}%` : '0%'
            },
            meta: {
              exclude_test: excludeTest,
              exclude_internal: excludeInternal,
              start_date: startDate || null,
              end_date: endDate || null,
              min_date: minDate || null,
              max_events: maxEvents
            }
          };
        }
        break;

      case 'users':
        // Get top users from h2s_tracking_events based on purchase events
        const limit = parseInt(searchParams.get('limit') || '10');
        const { data: userEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('visitor_id, customer_email, customer_phone, revenue_amount, occurred_at, order_id')
          .eq('event_type', 'purchase')
          .not('revenue_amount', 'is', null)
          .order('occurred_at', { ascending: false });

        let userEventsFiltered = excludeTest ? (userEvents || []).filter((e: any) => !isTestTrackingEvent(e)) : (userEvents || []);
        if (excludeInternal) userEventsFiltered = userEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        // Aggregate by customer (email or visitor_id as fallback)
        const userMap = new Map<string, any>();
        
        userEventsFiltered.forEach((event: any) => {
          // Use email as canonical identifier if available, else visitor_id
          // This prevents counting same customer multiple times across devices
          const userKey = event.customer_email 
            ? `email:${event.customer_email.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!userKey) return;
          
          if (!userMap.has(userKey)) {
            userMap.set(userKey, {
              Email: event.customer_email || null,
              Visitor_ID: event.visitor_id,
              Total_Orders: 0,
              Lifetime_Revenue: 0,
              Last_Purchase_Date: null,
              Current_Funnel_Stage: 'customer'
            });
          }
          
          const user = userMap.get(userKey);
          user.Total_Orders += 1;
          user.Lifetime_Revenue += parseFloat(event.revenue_amount) || 0;
          
          // Update email if we get it later (link visitor_id to email)
          if (event.customer_email && !user.Email) {
            user.Email = event.customer_email;
          }
          
          const eventDate = new Date(event.occurred_at);
          if (!user.Last_Purchase_Date || eventDate > new Date(user.Last_Purchase_Date)) {
            user.Last_Purchase_Date = event.occurred_at;
          }
        });
        
        // Convert to array and sort by revenue
        const topUsers = Array.from(userMap.values())
          .sort((a, b) => b.Lifetime_Revenue - a.Lifetime_Revenue)
          .slice(0, limit);
        
        result = {
          top_users: topUsers,
          total_customers: userMap.size
        };
        break;

      case 'ai_report':
        {
          const days = toInt(searchParams.get('days'), 30);
          const limit = toInt(searchParams.get('limit'), 1500);
          result = await buildAiReport({ 
            request, 
            days, 
            limit, 
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            minDate: minDate || undefined
          });
        }
        break;

      case 'ai-insights':
        // Back-compat for FunnelTrack.html (it uses action=ai-insights)
        {
          const days = toInt(searchParams.get('days'), 30);
          const limit = toInt(searchParams.get('limit'), 1500);
          result = await buildAiReport({ 
            request, 
            days, 
            limit,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            minDate: minDate || undefined
          });
        }
        break;

      case 'tracking_health':
        // Get tracking system health from h2s_tracking_events
        const { data: recentTrackingEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('occurred_at')
          .order('occurred_at', { ascending: false })
          .limit(1);
        
        const lastEventTime = recentTrackingEvents?.[0]?.occurred_at;
        const hoursSinceLastEvent = lastEventTime 
          ? (Date.now() - new Date(lastEventTime).getTime()) / (1000 * 60 * 60)
          : null;
        
        // Count events in last 24 hours
        const twentyFourHoursAgoHealth = new Date();
        twentyFourHoursAgoHealth.setHours(twentyFourHoursAgoHealth.getHours() - 24);
        const { count: events24h } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('*', { count: 'exact', head: true })
          .gte('occurred_at', twentyFourHoursAgoHealth.toISOString());
        
        const healthStatus = hoursSinceLastEvent === null 
          ? 'no_data'
          : hoursSinceLastEvent < 1 
          ? 'healthy'
          : hoursSinceLastEvent < 24 
          ? 'degraded'
          : 'down';
        
        result = {
          ok: true,
          healthy: healthStatus === 'healthy',
          last_event_time: lastEventTime,
          last_event_mins: hoursSinceLastEvent ? Math.round(hoursSinceLastEvent * 60) : null,
          hours_since_last_event: hoursSinceLastEvent,
          total_events_24h: events24h || 0,
          status: healthStatus
        };
        break;

      case 'estimateEquipmentCost':
        // AI-powered equipment cost estimation
        const equipServiceName = searchParams.get('serviceName');
        const equipServiceDescription = searchParams.get('serviceDescription') || '';
        const equipCategory = searchParams.get('category') || '';
        
        if (!equipServiceName) {
          return NextResponse.json({ ok: false, error: 'Service name is required' }, { status: 400, headers: corsHeaders(request) });
        }
        
        if (!openai) {
          return NextResponse.json({ ok: false, error: 'AI service not configured' }, { status: 503, headers: corsHeaders(request) });
        }
        
        try {
          const prompt = `You are an expert in home services and smart home installation equipment costs. Estimate the equipment cost per unit for the following service.

Service Name: ${equipServiceName}
${equipCategory ? `Category: ${equipCategory}` : ''}
${equipServiceDescription ? `Description: ${equipServiceDescription}` : ''}

Provide a realistic equipment cost estimate in USD per unit. Consider:
- Standard quality equipment (not premium, not budget)
- Typical installation equipment needs
- Hardware, materials, and any necessary accessories
- Industry average costs for similar services

Return ONLY a JSON object with this exact structure:
{
  "estimatedCost": 150.00,
  "costRange": {
    "min": 100.00,
    "max": 200.00
  },
  "confidence": "high|medium|low",
  "notes": "Brief explanation of what equipment is typically needed (1-2 sentences)",
  "equipmentItems": ["Item 1", "Item 2", "Item 3"]
}

Be realistic and conservative. If unsure, use medium confidence.`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert equipment cost estimator for home services. Always return valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 300,
            response_format: { type: 'json_object' }
          });
          
          const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');
          
          // Validate and structure response
          result = {
            serviceName: equipServiceName,
            estimatedCost: aiResponse.estimatedCost || 0,
            costRange: aiResponse.costRange || { min: 0, max: 0 },
            confidence: aiResponse.confidence || 'medium',
            notes: aiResponse.notes || '',
            equipmentItems: aiResponse.equipmentItems || [],
            timestamp: new Date().toISOString()
          };
        } catch (error: any) {
          console.error('Equipment cost estimation error:', error);
          return NextResponse.json({ ok: false, error: error.message || 'Failed to estimate equipment cost' }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'offer_performance':
        // Get offer performance data from h2s_tracking_events
        // Use the EXACT SAME query and processing as meta_pixel_events endpoint (which works in funnel-track.html)
        const offerNameFilter = searchParams.get('offerName');
        const daysBackOffer = parseInt(searchParams.get('days') || '30');
        const debugMode = searchParams.get('debug') === 'true';
        
        // Calculate date range (optional filter)
        const endDateOffer = new Date();
        const startDateOffer = new Date();
        startDateOffer.setDate(startDateOffer.getDate() - daysBackOffer);
        
        // Use the EXACT SAME query as meta_pixel_events - with date filtering
        let offerQuery = getTrackingDb()
          .from('h2s_tracking_events')
          .select('*')
          .order('occurred_at', { ascending: false });
        
        // Apply date filters
        if (minDate) offerQuery = offerQuery.gte('occurred_at', minDate);
        if (startDate) offerQuery = offerQuery.gte('occurred_at', startDate);
        if (endDate) offerQuery = offerQuery.lte('occurred_at', endDate);
        
        const { data: allEventsOffer, error: queryError } = await offerQuery.limit(10000);
        
        // Log raw query results for debugging
        console.log('🔍 offer_performance - Raw query results:', {
          eventCount: allEventsOffer?.length || 0,
          error: queryError,
          sampleEvents: allEventsOffer?.slice(0, 5).map((e: any) => ({
            event_type: e.event_type,
            event_name: e.event_name,
            occurred_at: e.occurred_at,
            page_path: e.page_path,
            visitor_id: e.visitor_id?.substring(0, 8) + '...'
          }))
        });
        
        // Filter by date range in memory (optional - only if days parameter specified)
        let dateFilteredEvents = allEventsOffer || [];
        if (daysBackOffer && daysBackOffer > 0 && daysBackOffer < 9999) {
          const beforeFilter = dateFilteredEvents.length;
          dateFilteredEvents = allEventsOffer?.filter((e: any) => {
            if (!e.occurred_at) return true; // Include events without timestamp
            try {
              const eventDate = new Date(e.occurred_at);
              const inRange = eventDate >= startDateOffer && eventDate <= endDateOffer;
              return inRange;
            } catch (err) {
              console.warn('Date parsing error for event:', e.occurred_at, err);
              return true; // Include if date parsing fails
            }
          }) || [];
          console.log('📅 Date filter applied:', {
            daysBack: daysBackOffer,
            dateRange: { start: startDateOffer.toISOString(), end: endDateOffer.toISOString() },
            beforeFilter,
            afterFilter: dateFilteredEvents.length
          });
        } else {
          console.log('📅 No date filter applied (daysBackOffer:', daysBackOffer, ')');
        }
        
        // Filter by offer name if specified (via utm_campaign or metadata)
        const filteredEvents = offerNameFilter 
          ? dateFilteredEvents.filter((e: any) => {
              const campaign = e.utm_campaign || '';
              const metadataOffer = e.metadata && typeof e.metadata === 'object' 
                ? e.metadata.offer_name 
                : (typeof e.metadata === 'string' ? JSON.parse(e.metadata || '{}').offer_name : null);
              return campaign.toLowerCase().includes(offerNameFilter.toLowerCase()) ||
                     (metadataOffer && metadataOffer.toLowerCase().includes(offerNameFilter.toLowerCase()));
            })
          : dateFilteredEvents;
        
        // Debug: Get sample of event types and structure
        const eventTypeBreakdown: Record<string, number> = {};
        const sampleEvents: any[] = [];
        const utmCampaigns = new Set<string>();
        const pagePathsDebug = new Set<string>();
        
        filteredEvents?.forEach((e: any) => {
          // Count event types (support both event_type and event_name - SAME as meta_pixel_events)
          const eventType = e.event_type || e.event_name || 'unknown';
          eventTypeBreakdown[eventType] = (eventTypeBreakdown[eventType] || 0) + 1;
          
          // Collect UTM campaigns
          if (e.utm_campaign) utmCampaigns.add(e.utm_campaign);
          
          // Collect page paths
          if (e.page_path) pagePathsDebug.add(e.page_path);
          
          // Store first 10 events as samples (increased to see more variety)
          if (sampleEvents.length < 10) {
            sampleEvents.push({
              event_type: e.event_type || e.event_name,
              occurred_at: e.occurred_at,
              visitor_id: e.visitor_id ? e.visitor_id.substring(0, 8) + '...' : null,
              utm_campaign: e.utm_campaign,
              page_path: e.page_path,
              metadata: e.metadata ? (typeof e.metadata === 'string' ? e.metadata.substring(0, 100) : JSON.stringify(e.metadata).substring(0, 100)) : null
            });
          }
        });
        
        // Calculate metrics (support both event_type and event_name fields)
        // Include both page_view and view_content as "page views" (view_content = engaged viewing)
        const pageViewsOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'page_view' || 
                 eventType === 'PageView' || 
                 eventType === 'view_content' || 
                 eventType === 'ViewContent';
        }).length || 0;
        const leadsOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'lead' || 
            eventType === 'Lead' || 
            eventType === 'complete_registration' ||
            eventType === 'CompleteRegistration';
        }).length || 0;
        const purchasesOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'purchase' || eventType === 'Purchase';
        }).length || 0;
        const uniqueVisitorsOffer = new Set(filteredEvents?.map((e: any) => e.visitor_id).filter(Boolean) || []).size;
        const totalRevenueOffer = filteredEvents?.filter((e: any) => e.revenue_amount).reduce((sum: number, e: any) => sum + (parseFloat(e.revenue_amount) || 0), 0) || 0;
        
        // Calculate conversion rates
        const visitorToLeadRateOffer = uniqueVisitorsOffer > 0 ? (leadsOffer / uniqueVisitorsOffer) * 100 : 0;
        const leadToPurchaseRateOffer = leadsOffer > 0 ? (purchasesOffer / leadsOffer) * 100 : 0;
        const visitorToPurchaseRateOffer = uniqueVisitorsOffer > 0 ? (purchasesOffer / uniqueVisitorsOffer) * 100 : 0;
        
        // Average order value
        const avgOrderValueOffer = purchasesOffer > 0 ? totalRevenueOffer / purchasesOffer : 0;
        
        // Revenue per visitor
        const revenuePerVisitorOffer = uniqueVisitorsOffer > 0 ? totalRevenueOffer / uniqueVisitorsOffer : 0;
        
        // Get event breakdown by type (support both event_type and event_name fields)
        const eventBreakdownOffer: Record<string, number> = {};
        filteredEvents?.forEach((event: any) => {
          const eventType = event.event_type || event.event_name || 'unknown';
          eventBreakdownOffer[eventType] = (eventBreakdownOffer[eventType] || 0) + 1;
        });
        
        // Get top sources (UTM)
        const sourceBreakdownOffer: Record<string, number> = {};
        filteredEvents?.forEach((event: any) => {
          const source = event.utm_source || 'direct';
          sourceBreakdownOffer[source] = (sourceBreakdownOffer[source] || 0) + 1;
        });
        
        result = {
          offer_name: offerNameFilter || 'all_offers',
          period_days: daysBackOffer,
          date_range: {
            start: startDateOffer.toISOString(),
            end: endDateOffer.toISOString()
          },
          summary: {
            total_events: filteredEvents?.length || 0,
            page_views: pageViewsOffer,
            unique_visitors: uniqueVisitorsOffer,
            leads: leadsOffer,
            purchases: purchasesOffer,
            total_revenue: totalRevenueOffer,
            avg_order_value: avgOrderValueOffer,
            revenue_per_visitor: revenuePerVisitorOffer
          },
          conversion_rates: {
            visitor_to_lead: parseFloat(visitorToLeadRateOffer.toFixed(2)),
            lead_to_purchase: parseFloat(leadToPurchaseRateOffer.toFixed(2)),
            visitor_to_purchase: parseFloat(visitorToPurchaseRateOffer.toFixed(2))
          },
          event_breakdown: eventBreakdownOffer,
          source_breakdown: sourceBreakdownOffer,
          has_data: (filteredEvents?.length || 0) > 0,
          // Debug information
          ...(debugMode ? {
            debug: {
              total_events_in_db: allEventsOffer?.length || 0,
              total_events_after_date_filter: dateFilteredEvents?.length || 0,
              total_events_found: filteredEvents?.length || 0,
              event_type_breakdown: eventTypeBreakdown,
              unique_utm_campaigns: Array.from(utmCampaigns),
              unique_page_paths: Array.from(pagePathsDebug).slice(0, 20),
              sample_events: sampleEvents,
              filter_applied: offerNameFilter || 'none',
              query_date_range: {
                start: startDateOffer.toISOString(),
                end: endDateOffer.toISOString(),
                days_back: daysBackOffer
              },
              raw_event_types_preview: allEventsOffer?.slice(0, 10).map((e: any) => ({
                event_type: e.event_type,
                event_name: e.event_name,
                occurred_at: e.occurred_at,
                page_path: e.page_path,
                visitor_id: e.visitor_id ? e.visitor_id.substring(0, 8) + '...' : null
              })) || []
            }
          } : {})
        };
        break;

      case 'database_stats':
        {
          const db = getTrackingDb();
          
          // Get total event count
          const { count: totalEvents, error: countError } = await db
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true });
          
          if (countError) {
            return NextResponse.json(
              { ok: false, error: `Failed to count events: ${countError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }
          
          // Get oldest and newest event dates
          const { data: dateRange, error: dateError } = await db
            .from('h2s_tracking_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: true })
            .limit(1);
          
          const { data: dateRangeNewest, error: dateErrorNewest } = await db
            .from('h2s_tracking_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1);
          
          if (dateError || dateErrorNewest) {
            return NextResponse.json(
              { ok: false, error: 'Failed to fetch date range' },
              { status: 500, headers: corsHeaders(request) }
            );
          }
          
          const oldestDate = dateRange && dateRange.length > 0 
            ? new Date(dateRange[0].occurred_at).toLocaleDateString() 
            : 'N/A';
          
          const newestDate = dateRangeNewest && dateRangeNewest.length > 0 
            ? new Date(dateRangeNewest[0].occurred_at).toLocaleDateString() 
            : 'N/A';
          
          result = {
            total_events: totalEvents || 0,
            oldest_event_date: oldestDate,
            newest_event_date: newestDate
          };
        }
        break;

      default:
        return invalidActionResponse(request, 'GET', action);
    }

    // Special cases for response key naming
    let responseKey: string = action;
    if (action === 'aiProfiles') responseKey = 'profiles';
    if (action === 'trainingCompletions') responseKey = 'completions';
    if (action === 'deliverables') responseKey = 'deliverables';
    if (action === 'dashboardMe') responseKey = 'me';
    if (action === 'dashboardUsers') responseKey = 'users';
    const headers = corsHeaders(request);
    if (action === 'observed_paths' || action === 'path_rules') {
      // These endpoints drive admin/debug UI and must not go stale.
      headers['Cache-Control'] = 'no-store, max-age=0';
      headers['CDN-Cache-Control'] = 'no-store';
      headers['Vercel-CDN-Cache-Control'] = 'no-store';
      headers['Pragma'] = 'no-cache';
    }

    if (action === 'ai_report') {
      // AI report returns its own structure
      return NextResponse.json(result, { headers });
    }
    if (action === 'ai-insights') {
      // Back-compat: return direct structure (same as ai_report)
      return NextResponse.json(result, { headers });
    }
    
    return NextResponse.json({ ok: true, [responseKey]: result }, { headers });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  let body: any = {};
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (!action) {
    return missingActionResponse(request, 'POST');
  }

  try {
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    let result;
    const extraPayload: any = {};

    // Some features (training, candidates, tasks, hours, etc.) live in the Mgmt DB.
    // Prefer Mgmt creds when present, but don't hard-fail if they're not configured.
    const supabaseMgmt = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    const tasksDb = getDeliverablesDb();

    switch (action) {
            case 'dashboardBootstrapAdmin':
              {
                // One-time bootstrap for the very first admin user.
                // Guarded by env secret (recommended) and only allowed when there are no users.
                const expected = getDashboardBootstrapSecret();
                const provided = String(
                  request.headers.get('x-h2s-bootstrap-secret') ||
                    request.headers.get('x-h2s-admin-key') ||
                    body?.bootstrapSecret ||
                    body?.adminKey ||
                    ''
                ).trim();

                if (!expected) {
                  return NextResponse.json(
                    { ok: false, error: 'Bootstrap disabled (set H2S_DASHBOARD_BOOTSTRAP_SECRET)' },
                    { status: 501, headers: corsHeaders(request) }
                  );
                }
                if (!provided || provided !== expected) {
                  return NextResponse.json({ ok: false, error: 'Invalid bootstrap secret' }, { status: 403, headers: corsHeaders(request) });
                }

                const db = tasksDb;
                const { count, error: countError } = await db
                  .from('Dashboard_Users')
                  .select('*', { count: 'exact', head: true });

                if (countError) {
                  return NextResponse.json({ ok: false, error: `Failed to check users: ${countError.message}` }, { status: 500, headers: corsHeaders(request) });
                }
                if ((count || 0) > 0) {
                  return NextResponse.json({ ok: false, error: 'Already initialized' }, { status: 403, headers: corsHeaders(request) });
                }

                const displayName = String(body?.displayName || body?.name || '').trim();
                const username = normalizeDashboardUsername(body?.username || displayName.split(' ')[0] || '');
                const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
                let pin = String(body?.pin || '').trim();
                const pinWasGenerated = !pin;
                if (!pin) pin = generateNumericPin(8);

                if (!displayName) {
                  return NextResponse.json({ ok: false, error: 'displayName is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!username) {
                  return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!pin || pin.length < 4) {
                  return NextResponse.json({ ok: false, error: 'pin must be at least 4 characters' }, { status: 400, headers: corsHeaders(request) });
                }

                const saltBytes = new Uint8Array(16);
                crypto.getRandomValues(saltBytes);
                const saltB64 = bytesToBase64Url(saltBytes);
                const hashB64 = await pbkdf2Sha256Base64Url(pin, saltBytes);
                const nowIso = new Date().toISOString();

                const { data: inserted, error } = await db
                  .from('Dashboard_Users')
                  .insert({
                    Username: username,
                    Display_Name: displayName,
                    Email: email,
                    Role: 'ADMIN',
                    Is_Disabled: false,
                    Pin_Salt: saltB64,
                    Pin_Hash: hashB64,
                    Created_At: nowIso,
                    Updated_At: nowIso
                  })
                  .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled, Created_At, Updated_At')
                  .single();

                if (error) {
                  return NextResponse.json({ ok: false, error: `Failed to bootstrap admin: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                result = {
                  user: inserted,
                  pin: pinWasGenerated ? pin : pin,
                  pinWasGenerated
                };
                extraPayload.dashboardBootstrapAdmin = result;
              }
              break;

            case 'dashboardLogin':
              {
                const identifierRaw = String(body?.username || body?.email || body?.identifier || '').trim();
                const pinRaw = String(body?.pin || body?.password || '').trim();
                const device = typeof body?.device === 'string' ? body.device.trim() : null;

                if (!identifierRaw || !pinRaw) {
                  return NextResponse.json({ ok: false, error: 'username and pin are required' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = tasksDb;

                const isEmail = identifierRaw.includes('@');
                const identifier = isEmail ? identifierRaw.trim().toLowerCase() : normalizeDashboardUsername(identifierRaw);

                const userQuery = db
                  .from('Dashboard_Users')
                  .select('User_ID, Username, Display_Name, Role, Is_Disabled, Pin_Salt, Pin_Hash')
                  .limit(1);

                const { data: user, error: userError } = isEmail
                  ? await userQuery.ilike('Email', identifier).maybeSingle()
                  : await userQuery.eq('Username', identifier).maybeSingle();

                if (userError || !user) {
                  return NextResponse.json({ ok: false, error: 'Invalid login' }, { status: 401, headers: corsHeaders(request) });
                }

                if (user.Is_Disabled) {
                  return NextResponse.json({ ok: false, error: 'Account disabled' }, { status: 403, headers: corsHeaders(request) });
                }

                const saltBytes = base64UrlToBytes(String(user.Pin_Salt || ''));
                if (!saltBytes || saltBytes.length < 8) {
                  return NextResponse.json({ ok: false, error: 'Account not configured' }, { status: 500, headers: corsHeaders(request) });
                }

                const computed = await pbkdf2Sha256Base64Url(pinRaw, saltBytes);
                const ok = constantTimeEquals(String(computed || ''), String(user.Pin_Hash || ''));
                if (!ok) {
                  return NextResponse.json({ ok: false, error: 'Invalid login' }, { status: 401, headers: corsHeaders(request) });
                }

                const token = randomTokenBase64Url(32);
                const tokenHash = await sha256Base64Url(token);
                const nowIso = new Date().toISOString();
                const expiresAt = new Date(Date.now() + DASHBOARD_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

                const { error: sessionError } = await db.from('Dashboard_Sessions').insert({
                  User_ID: user.User_ID,
                  Token_Hash: tokenHash,
                  Device: device,
                  Created_At: nowIso,
                  Expires_At: expiresAt,
                  Last_Seen_At: nowIso
                });

                if (sessionError) {
                  return NextResponse.json({ ok: false, error: `Failed to create session: ${sessionError.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                // Best-effort: update last login
                try {
                  await db
                    .from('Dashboard_Users')
                    .update({ Last_Login_At: nowIso, Updated_At: nowIso })
                    .eq('User_ID', user.User_ID);
                } catch {
                  // ignore
                }

                const role = String(user.Role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA';
                result = {
                  token,
                  expiresAt,
                  user: {
                    userId: String(user.User_ID),
                    username: String(user.Username || '').trim().toUpperCase(),
                    displayName: String(user.Display_Name || user.Username || '').trim(),
                    role
                  }
                };

                extraPayload.dashboardLogin = result;
              }
              break;

            case 'dashboardImpersonate':
              {
                // Admin-only: mint a session token for another dashboard user ("login as").
                // PINs are salted+hashed, so we cannot reveal an existing PIN.
                const sessionUser = await getDashboardAuthUserFromSession(request);
                if (!sessionUser || sessionUser.role !== 'ADMIN') {
                  return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403, headers: corsHeaders(request) });
                }

                // If a shared admin key is configured, require it (or allow session-admin via requireAdminToken).
                const auth = await requireAdminToken(request);
                if (!auth.ok) {
                  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
                }

                const userId = String(body?.userId || body?.user_id || '').trim();
                const username = normalizeDashboardUsername(body?.username);
                const device = typeof body?.device === 'string' ? body.device.trim() : null;

                if (!userId && !username) {
                  return NextResponse.json({ ok: false, error: 'userId or username is required' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = tasksDb;
                const userQuery = db
                  .from('Dashboard_Users')
                  .select('User_ID, Username, Display_Name, Role, Is_Disabled')
                  .limit(1);

                const { data: target, error: targetErr } = userId
                  ? await userQuery.eq('User_ID', userId).maybeSingle()
                  : await userQuery.eq('Username', username).maybeSingle();

                if (targetErr) {
                  return NextResponse.json({ ok: false, error: `Failed to load user: ${targetErr.message}` }, { status: 500, headers: corsHeaders(request) });
                }
                if (!target) {
                  return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404, headers: corsHeaders(request) });
                }
                if ((target as any).Is_Disabled) {
                  return NextResponse.json({ ok: false, error: 'Account disabled' }, { status: 403, headers: corsHeaders(request) });
                }

                const token = randomTokenBase64Url(32);
                const tokenHash = await sha256Base64Url(token);
                const nowIso = new Date().toISOString();

                // Keep impersonation sessions shorter by default.
                const ttlDays = 1;
                const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

                const { error: sessionError } = await db.from('Dashboard_Sessions').insert({
                  User_ID: (target as any).User_ID,
                  Token_Hash: tokenHash,
                  Device: device || `IMPERSONATE:${sessionUser.username}`,
                  Created_At: nowIso,
                  Expires_At: expiresAt,
                  Last_Seen_At: nowIso
                });

                if (sessionError) {
                  return NextResponse.json({ ok: false, error: `Failed to create session: ${sessionError.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                const role = String((target as any).Role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA';
                result = {
                  token,
                  expiresAt,
                  impersonatedBy: {
                    userId: sessionUser.userId,
                    username: sessionUser.username
                  },
                  user: {
                    userId: String((target as any).User_ID),
                    username: String((target as any).Username || '').trim().toUpperCase(),
                    displayName: String((target as any).Display_Name || (target as any).Username || '').trim(),
                    role
                  }
                };

                extraPayload.dashboardImpersonate = result;
              }
              break;

            case 'dashboardChangePin':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const oldPin = String(body?.oldPin || body?.old_pin || '').trim();
                const newPin = String(body?.newPin || body?.new_pin || '').trim();

                if (!oldPin || !newPin) {
                  return NextResponse.json({ ok: false, error: 'oldPin and newPin are required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (newPin.length < 4) {
                  return NextResponse.json({ ok: false, error: 'newPin must be at least 4 characters' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = tasksDb;
                const { data: user, error: userError } = await db
                  .from('Dashboard_Users')
                  .select('User_ID, Is_Disabled, Pin_Salt, Pin_Hash')
                  .eq('User_ID', authed.userId)
                  .maybeSingle();

                if (userError || !user) {
                  return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404, headers: corsHeaders(request) });
                }
                if (user.Is_Disabled) {
                  return NextResponse.json({ ok: false, error: 'Account disabled' }, { status: 403, headers: corsHeaders(request) });
                }

                const saltBytes = base64UrlToBytes(String(user.Pin_Salt || ''));
                const computed = await pbkdf2Sha256Base64Url(oldPin, saltBytes);
                const ok = constantTimeEquals(String(computed || ''), String(user.Pin_Hash || ''));
                if (!ok) {
                  return NextResponse.json({ ok: false, error: 'Invalid old PIN' }, { status: 401, headers: corsHeaders(request) });
                }

                const nextSalt = new Uint8Array(16);
                crypto.getRandomValues(nextSalt);
                const nextSaltB64 = bytesToBase64Url(nextSalt);
                const nextHashB64 = await pbkdf2Sha256Base64Url(newPin, nextSalt);
                const nowIso = new Date().toISOString();

                const { error: updateError } = await db
                  .from('Dashboard_Users')
                  .update({ Pin_Salt: nextSaltB64, Pin_Hash: nextHashB64, Updated_At: nowIso })
                  .eq('User_ID', authed.userId);

                if (updateError) {
                  return NextResponse.json({ ok: false, error: `Failed to update PIN: ${updateError.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                result = { changed: true };
                extraPayload.dashboardChangePin = result;
              }
              break;

            case 'dashboardLogout':
              {
                const token = String(body?.token || '').trim() || getBearerToken(request);
                if (!token) {
                  result = { loggedOut: true };
                  extraPayload.dashboardLogout = result;
                  break;
                }
                const db = tasksDb;
                const tokenHash = await sha256Base64Url(token);
                try {
                  await db.from('Dashboard_Sessions').delete().eq('Token_Hash', tokenHash);
                } catch {
                  // ignore
                }
                result = { loggedOut: true };
                extraPayload.dashboardLogout = result;
              }
              break;

            case 'smsMarkRead':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const threadId = String(body?.thread_id || body?.threadId || '').trim();
                const contactPhone = normalizePhone(String(body?.contact_phone || body?.contactPhone || body?.to_phone || body?.toPhone || '').trim());

                if (!threadId && !contactPhone) {
                  return NextResponse.json({ ok: false, error: 'thread_id or contact_phone is required' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = getDeliverablesDb();

                let thread: any = null;
                if (threadId) {
                  const { data: t, error: tErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone')
                    .eq('thread_id', threadId)
                    .maybeSingle();
                  if (tErr) {
                    const msg = isMissingTableError(tErr, 'sms_threads')
                      ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                      : `Failed to load thread: ${tErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }
                  thread = t || null;
                } else {
                  const { data: t, error: tErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone')
                    .eq('contact_phone', contactPhone)
                    .maybeSingle();
                  if (tErr) {
                    const msg = isMissingTableError(tErr, 'sms_threads')
                      ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                      : `Failed to load thread: ${tErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }
                  thread = t || null;
                }

                if (!thread) {
                  return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
                }

                const base = normalizePhone(String(thread?.contact_phone || '').trim()) || String(thread?.contact_phone || '').trim();
                const variants = Array.from(new Set(smsPhoneQueryVariants(base))).filter(Boolean);

                const { data: dupThreads, error: dupErr } = await db
                  .from('sms_threads')
                  .select('thread_id')
                  .in('contact_phone', variants.length ? variants : [base])
                  .limit(25);

                if (dupErr) {
                  const msg = isMissingTableError(dupErr, 'sms_threads')
                    ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                    : `Failed to enumerate threads: ${dupErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                const threadIds = Array.from(
                  new Set(
                    (dupThreads || [])
                      .map((t: any) => String(t?.thread_id || '').trim())
                      .filter(Boolean)
                      .concat([String(thread?.thread_id || '').trim()])
                  )
                ).slice(0, 25);

                const { error: updErr } = await db.from('sms_threads').update({ unread_count: 0 }).in('thread_id', threadIds);
                if (updErr) {
                  return NextResponse.json({ ok: false, error: `Failed to mark read: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                result = { thread_ids: threadIds };
                extraPayload.smsMarkRead = result;
              }
              break;

            case 'smsSend':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const rawBody = String(body?.body ?? body?.message ?? '').trim();
                const messageBody = safeTrim(rawBody);
                const threadId = String(body?.thread_id || body?.threadId || '').trim();
                const contactPhone = normalizePhone(String(body?.to_phone || body?.toPhone || body?.to || body?.contact_phone || body?.contactPhone || '').trim());

                if (!messageBody) {
                  return NextResponse.json({ ok: false, error: 'body is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!threadId && !contactPhone) {
                  return NextResponse.json({ ok: false, error: 'thread_id or to_phone is required' }, { status: 400, headers: corsHeaders(request) });
                }

                const fromPhone = normalizePhone(String(process.env.TWILIO_PHONE_NUMBER || '').trim());
                const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
                const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
                if (!fromPhone || !accountSid || !authToken) {
                  return NextResponse.json(
                    { ok: false, error: 'Twilio not configured (set TWILIO_PHONE_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)' },
                    { status: 501, headers: corsHeaders(request) }
                  );
                }

                const db = getDeliverablesDb();

                // Resolve or create thread
                let thread: any = null;
                if (threadId) {
                  const { data: t, error: tErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone, contact_name, unread_count')
                    .eq('thread_id', threadId)
                    .maybeSingle();
                  if (tErr) {
                    const msg = isMissingTableError(tErr, 'sms_threads')
                      ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                      : `Failed to load thread: ${tErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }
                  thread = t || null;
                  if (!thread) {
                    return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
                  }
                } else {
                  const { data: t, error: tErr } = await db
                    .from('sms_threads')
                    .upsert(
                      {
                        contact_phone: contactPhone,
                        last_message_preview: messageBody.slice(0, 200),
                        last_message_at: new Date().toISOString(),
                        unread_count: 0
                      },
                      { onConflict: 'contact_phone' }
                    )
                    .select('thread_id, contact_phone, contact_name, unread_count')
                    .single();

                  if (tErr) {
                    const msg = isMissingTableError(tErr, 'sms_threads')
                      ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                      : `Failed to create thread: ${tErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }
                  thread = t;
                }

                const toPhone = normalizePhone(String(thread?.contact_phone || contactPhone || '').trim());
                if (!toPhone) {
                  return NextResponse.json({ ok: false, error: 'Invalid recipient phone' }, { status: 400, headers: corsHeaders(request) });
                }

                const client = twilio(accountSid, authToken);
                const twilioMsg = await client.messages.create({ from: fromPhone, to: toPhone, body: messageBody });

                const nowIso = new Date().toISOString();
                const { error: insertErr } = await db.from('sms_messages').insert({
                  thread_id: thread.thread_id,
                  direction: 'OUTBOUND',
                  body: messageBody,
                  from_phone: fromPhone,
                  to_phone: toPhone,
                  twilio_sid: twilioMsg?.sid || null,
                  status: (twilioMsg as any)?.status || 'sent',
                  created_at: nowIso,
                  sent_by_user_id: authed.userId,
                  sent_by_username: authed.username,
                  sent_by_display_name: authed.displayName
                });

                if (insertErr) {
                  const msg = isMissingTableError(insertErr, 'sms_messages')
                    ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                    : `Failed to save message: ${insertErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                // Mark thread read (best-effort)
                try {
                  await db.from('sms_threads').update({ unread_count: 0 }).eq('thread_id', thread.thread_id);
                } catch {
                  // ignore
                }

                result = {
                  sent: true,
                  thread_id: thread.thread_id,
                  to_phone: toPhone,
                  from_phone: fromPhone,
                  tagged: false,
                  sender: { userId: authed.userId, username: authed.username, displayName: authed.displayName },
                  twilio: { sid: twilioMsg?.sid || null, status: (twilioMsg as any)?.status || null }
                };
                extraPayload.smsSend = result;
              }
              break;

            case 'smsAdminInjectInbound':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                if (String(authed.role || '').toUpperCase() !== 'ADMIN') {
                  return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: corsHeaders(request) });
                }

                const rawBody = String(body?.body ?? body?.message ?? '').trim();
                const messageBody = safeTrim(rawBody);
                const threadId = String(body?.thread_id || body?.threadId || '').trim();
                const contactPhone = normalizePhone(String(body?.contact_phone || body?.contactPhone || body?.from_phone || body?.fromPhone || '').trim());
                const groupId = String(body?.group_id || body?.groupId || '').trim();

                if (!messageBody) {
                  return NextResponse.json({ ok: false, error: 'body is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!threadId && !contactPhone && !groupId) {
                  return NextResponse.json({ ok: false, error: 'thread_id, contact_phone, or group_id is required' }, { status: 400, headers: corsHeaders(request) });
                }

                if (groupId && !isUuid(groupId)) {
                  return NextResponse.json({ ok: false, error: 'group_id must be a uuid' }, { status: 400, headers: corsHeaders(request) });
                }

                if (groupId && (threadId || contactPhone)) {
                  return NextResponse.json({ ok: false, error: 'Provide only one of group_id or (thread_id/contact_phone)' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = getDeliverablesDb();

                // Resolve contact phone + preserve unread_count.
                let resolvedContactPhone = contactPhone;
                let existingUnread: number | null = null;
                let existingThreadId: string | null = null;

                // Group mode: choose an anchor member phone.
                if (groupId) {
                  // Ensure schema supports group_id before injecting (avoid "saved but not tagged").
                  {
                    const { error: probeErr } = await db
                      .from('sms_messages')
                      .select('group_id')
                      .limit(1);
                    if (probeErr && isMissingColumnError(probeErr, 'group_id')) {
                      return NextResponse.json(
                        {
                          ok: false,
                          error: 'Backend DB schema is missing sms_messages.group_id. Apply migration 017_add_sms_messages_group_id.sql to the MGMT database.'
                        },
                        { status: 500, headers: corsHeaders(request) }
                      );
                    }
                  }

                  const { data: members, error: mErr } = await db
                    .from('sms_group_members')
                    .select('contact_phone')
                    .eq('group_id', groupId)
                    .order('contact_phone', { ascending: true })
                    .limit(5000);

                  if (mErr) {
                    const msg = isMissingTableError(mErr, 'sms_group_members')
                      ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                      : `Failed to load group members: ${mErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }

                  const phones = (members || [])
                    .map((r: any) => normalizePhone(String(r?.contact_phone || '').trim()))
                    .filter(Boolean);

                  if (phones.length < 2) {
                    return NextResponse.json({ ok: false, error: 'Group must have at least two recipients' }, { status: 400, headers: corsHeaders(request) });
                  }

                  // Use the first member as the anchor thread for this synthetic inbound.
                  resolvedContactPhone = phones[0];

                  // Touch group ordering.
                  try {
                    await db.from('sms_groups').update({ updated_at: new Date().toISOString() }).eq('group_id', groupId);
                  } catch {
                    // ignore
                  }
                }

                if (threadId) {
                  const { data: t, error: tErr } = await db
                    .from('sms_threads')
                    .select('thread_id, contact_phone, unread_count')
                    .eq('thread_id', threadId)
                    .maybeSingle();

                  if (tErr) {
                    const msg = isMissingTableError(tErr, 'sms_threads')
                      ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                      : `Failed to load thread: ${tErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }
                  if (!t) {
                    return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
                  }

                  existingThreadId = String((t as any).thread_id || '').trim() || null;
                  resolvedContactPhone = normalizePhone(String((t as any).contact_phone || '').trim()) || String((t as any).contact_phone || '').trim() || resolvedContactPhone;
                  existingUnread = typeof (t as any).unread_count === 'number' ? (Number((t as any).unread_count) || 0) : null;
                } else if (resolvedContactPhone) {
                  const { data: t } = await db
                    .from('sms_threads')
                    .select('thread_id, unread_count')
                    .eq('contact_phone', resolvedContactPhone)
                    .maybeSingle();
                  if (t) {
                    existingThreadId = String((t as any).thread_id || '').trim() || null;
                    existingUnread = typeof (t as any).unread_count === 'number' ? (Number((t as any).unread_count) || 0) : null;
                  }
                }

                if (!resolvedContactPhone) {
                  return NextResponse.json({ ok: false, error: 'Invalid contact_phone' }, { status: 400, headers: corsHeaders(request) });
                }

                // Mirror Twilio inbound: increment unread count on the thread.
                const nextUnread = typeof existingUnread === 'number' ? Math.max(0, existingUnread) + 1 : 1;
                const nowIso = new Date().toISOString();

                const { data: thread, error: upsertErr } = await db
                  .from('sms_threads')
                  .upsert(
                    {
                      contact_phone: resolvedContactPhone,
                      last_message_preview: messageBody.slice(0, 200),
                      last_message_at: nowIso,
                      unread_count: nextUnread
                    },
                    { onConflict: 'contact_phone' }
                  )
                  .select('thread_id, contact_phone, unread_count')
                  .single();

                if (upsertErr || !thread) {
                  const msg = upsertErr
                    ? (isMissingTableError(upsertErr, 'sms_threads')
                        ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                        : `Failed to upsert thread: ${upsertErr.message}`)
                    : 'Failed to upsert thread';
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                const toPhone = normalizePhone(String(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER || '').trim()) || 'unknown';

                const { error: insertErr } = await db.from('sms_messages').insert({
                  thread_id: (thread as any).thread_id,
                  direction: 'INBOUND',
                  body: messageBody,
                  from_phone: resolvedContactPhone,
                  to_phone: toPhone,
                  twilio_sid: null,
                  status: 'received',
                  created_at: nowIso,
                  group_id: groupId || null
                });

                if (insertErr) {
                  const msg = isMissingTableError(insertErr, 'sms_messages')
                    ? 'SMS inbox tables not found. Apply migration 013_create_sms_inbox.sql to the MGMT database.'
                    : `Failed to save message: ${insertErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                result = {
                  injected: true,
                  thread_id: (thread as any).thread_id,
                  contact_phone: resolvedContactPhone,
                  unread_count: nextUnread,
                  prior_thread_id: existingThreadId,
                  group_id: groupId || null
                };
                extraPayload.smsAdminInjectInbound = result;
              }
              break;

            case 'smsGroupSend':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const rawBody = String(body?.body ?? body?.message ?? '').trim();
                const messageBody = safeTrim(rawBody);
                const groupId = String(body?.group_id || body?.groupId || '').trim();
                if (!groupId || !isUuid(groupId)) {
                  return NextResponse.json({ ok: false, error: 'group_id (uuid) is required' }, { status: 400, headers: corsHeaders(request) });
                }

                if (!messageBody) {
                  return NextResponse.json({ ok: false, error: 'body is required' }, { status: 400, headers: corsHeaders(request) });
                }

                const fromPhone = normalizePhone(String(process.env.TWILIO_PHONE_NUMBER || '').trim());
                const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
                const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
                if (!fromPhone || !accountSid || !authToken) {
                  return NextResponse.json(
                    { ok: false, error: 'Twilio not configured (set TWILIO_PHONE_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)' },
                    { status: 501, headers: corsHeaders(request) }
                  );
                }

                const db = getDeliverablesDb();

                // Ensure schema supports group_id before sending (avoid "sent but not saved").
                {
                  const { error: probeErr } = await db
                    .from('sms_messages')
                    .select('group_id')
                    .limit(1);
                  if (probeErr && isMissingColumnError(probeErr, 'group_id')) {
                    return NextResponse.json(
                      {
                        ok: false,
                        error: 'Backend DB schema is missing sms_messages.group_id. Apply migration 017_add_sms_messages_group_id.sql to the MGMT database.'
                      },
                      { status: 500, headers: corsHeaders(request) }
                    );
                  }
                }

                const { data: group, error: gErr } = await db
                  .from('sms_groups')
                  .select('group_id, owner_user_id, member_key, group_name')
                  .eq('group_id', groupId)
                  .maybeSingle();

                if (gErr) {
                  const msg = isMissingTableError(gErr, 'sms_groups')
                    ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                    : `Failed to load group: ${gErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }
                if (!group) {
                  return NextResponse.json({ ok: false, error: 'Group not found' }, { status: 404, headers: corsHeaders(request) });
                }

                const { data: members, error: mErr } = await db
                  .from('sms_group_members')
                  .select('contact_phone')
                  .eq('group_id', groupId)
                  .limit(5000);

                if (mErr) {
                  const msg = isMissingTableError(mErr, 'sms_group_members')
                    ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                    : `Failed to load group members: ${mErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                const recipients = (members || [])
                  .map((r: any) => normalizePhone(String(r.contact_phone || '').trim()))
                  .filter(Boolean);

                const uniquePhones = Array.from(new Set(recipients));
                if (uniquePhones.length < 2) {
                  return NextResponse.json({ ok: false, error: 'Group must have at least two recipients' }, { status: 400, headers: corsHeaders(request) });
                }

                const client = twilio(accountSid, authToken);
                const nowIso = new Date().toISOString();

                // Touch group updated_at (keeps groups list ordering stable even if there are no inbound messages).
                try {
                  await db.from('sms_groups').update({ updated_at: nowIso }).eq('group_id', groupId);
                } catch {
                  // ignore
                }

                let okCount = 0;
                let failCount = 0;
                const failures: any[] = [];
                const threadIds: string[] = [];

                for (const toPhone of uniquePhones) {
                  try {
                    // Ensure thread exists & update preview
                    const { data: thread, error: tErr } = await db
                      .from('sms_threads')
                      .upsert(
                        {
                          contact_phone: toPhone,
                          last_message_preview: messageBody.slice(0, 200),
                          last_message_at: nowIso,
                          unread_count: 0
                        },
                        { onConflict: 'contact_phone' }
                      )
                      .select('thread_id, contact_phone')
                      .single();

                    if (tErr || !thread) {
                      failCount++;
                      failures.push({ to_phone: toPhone, error: tErr ? tErr.message : 'Failed to create thread' });
                      continue;
                    }

                    const tid = String((thread as any).thread_id || '').trim();
                    if (tid) threadIds.push(tid);

                    const twilioMsg = await client.messages.create({ from: fromPhone, to: toPhone, body: messageBody });

                    const { error: insertErr } = await db.from('sms_messages').insert({
                      thread_id: tid,
                      direction: 'OUTBOUND',
                      body: messageBody,
                      from_phone: fromPhone,
                      to_phone: toPhone,
                      twilio_sid: twilioMsg?.sid || null,
                      status: (twilioMsg as any)?.status || 'sent',
                      created_at: nowIso,
                      sent_by_user_id: authed.userId,
                      sent_by_username: authed.username,
                      sent_by_display_name: authed.displayName,
                      group_id: groupId
                    });

                    if (insertErr) {
                      failCount++;
                      failures.push({ to_phone: toPhone, error: insertErr.message });
                      continue;
                    }

                    okCount++;
                  } catch (e: any) {
                    failCount++;
                    failures.push({ to_phone: toPhone, error: e?.message || String(e || 'Send failed') });
                  }
                }

                result = {
                  sent: okCount > 0,
                  group_id: groupId,
                  from_phone: fromPhone,
                  recipients: uniquePhones,
                  ok_count: okCount,
                  fail_count: failCount,
                  thread_ids: Array.from(new Set(threadIds)),
                  failures: failures.slice(0, 25)
                };
                extraPayload.smsGroupSend = result;
              }
              break;

            case 'smsGroupUpsert':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const raw = (body as any)?.to_phones ?? (body as any)?.toPhones ?? (body as any)?.recipients ?? (body as any)?.members;
                let list: string[] = [];
                if (Array.isArray(raw)) {
                  list = raw.map((x: any) => String(x || '').trim());
                } else if (typeof raw === 'string') {
                  list = raw.split(/[\s,;\n\r\t]+/g).map(s => s.trim()).filter(Boolean);
                }

                const normalized = list.map(p => normalizePhone(String(p || '').trim())).filter(Boolean);
                const unique = Array.from(new Set(normalized));
                if (unique.length < 2) {
                  return NextResponse.json({ ok: false, error: 'At least two recipients are required to create a group' }, { status: 400, headers: corsHeaders(request) });
                }

                unique.sort();
                const memberKey = unique.join('|');
                const groupName = safeTrim((body as any)?.group_name ?? (body as any)?.groupName ?? '');
                if (groupName.length > 80) {
                  return NextResponse.json({ ok: false, error: 'group_name too long (max 80)' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = getDeliverablesDb();
                // De-dupe: reuse an existing group with the same member_key even if it was
                // created by another dashboard user (shared inbox behavior).
                const { data: existingByKey, error: existingErr } = await db
                  .from('sms_groups')
                  .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
                  .eq('member_key', memberKey)
                  .order('updated_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (existingErr) {
                  const msg = isMissingTableError(existingErr, 'sms_groups')
                    ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                    : `Failed to load groups: ${existingErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                let group: any = existingByKey || null;
                if (!group) {
                  const { data: created, error: gErr } = await db
                    .from('sms_groups')
                    .upsert(
                      {
                        owner_user_id: authed.userId,
                        member_key: memberKey,
                        group_name: groupName || null
                      },
                      { onConflict: 'owner_user_id,member_key' }
                    )
                    .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
                    .single();

                  if (gErr) {
                    const msg = isMissingTableError(gErr, 'sms_groups')
                      ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                      : `Failed to upsert group: ${gErr.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }

                  group = created;
                } else {
                  // Optional: fill in group_name if caller provided one and the existing group is unnamed.
                  const existingName = safeTrim((group as any)?.group_name || '');
                  if (groupName && !existingName) {
                    try {
                      const { data: updated } = await db
                        .from('sms_groups')
                        .update({ group_name: groupName || null })
                        .eq('group_id', String((group as any).group_id || '').trim())
                        .select('group_id, owner_user_id, member_key, group_name, created_at, updated_at')
                        .maybeSingle();
                      if (updated) group = updated;
                    } catch {
                      // ignore
                    }
                  }
                }

                const memberRows = unique.map(p => ({ group_id: (group as any).group_id, contact_phone: p }));
                const { error: mErr } = await db
                  .from('sms_group_members')
                  .upsert(memberRows, { onConflict: 'group_id,contact_phone' });

                if (mErr) {
                  const msg = isMissingTableError(mErr, 'sms_group_members')
                    ? 'SMS group tables not found. Apply migration 015_create_sms_groups.sql to the MGMT database.'
                    : `Failed to upsert group members: ${mErr.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                result = { upserted: true, group, members: unique };
                extraPayload.smsGroupUpsert = result;
              }
              break;

            case 'smsHideConversation':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                // Soft archive for the current user (owner_user_id). This should be reversible and non-destructive.

                const threadId = safeTrim((body as any)?.thread_id ?? (body as any)?.threadId ?? '');
                const groupId = safeTrim((body as any)?.group_id ?? (body as any)?.groupId ?? '');
                const hidden = !['0', 'false', 'no', 'off'].includes(String((body as any)?.hidden ?? 'true').toLowerCase());

                if (!threadId && !groupId) {
                  return NextResponse.json({ ok: false, error: 'thread_id or group_id is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (threadId && groupId) {
                  return NextResponse.json({ ok: false, error: 'Provide only one of thread_id or group_id' }, { status: 400, headers: corsHeaders(request) });
                }

                const conversationType = threadId ? 'thread' : 'group';
                const conversationId = threadId || groupId;

                const db = getDeliverablesDb();
                if (hidden) {
                  const { error } = await db
                    .from('sms_hidden_conversations')
                    .upsert(
                      {
                        owner_user_id: authed.userId,
                        conversation_type: conversationType,
                        conversation_id: conversationId
                      },
                      { onConflict: 'owner_user_id,conversation_type,conversation_id' }
                    );

                  if (error) {
                    const msg = isMissingTableError(error, 'sms_hidden_conversations')
                      ? 'SMS hidden-conversations table not found. Apply migration 016_create_sms_hidden_conversations.sql to the MGMT database.'
                      : `Failed to hide conversation: ${error.message}`;
                    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                  }

                  result = { ok: true, hidden: true, conversation_type: conversationType, conversation_id: conversationId };
                  extraPayload.smsHideConversation = result;
                  break;
                }

                const { error } = await db
                  .from('sms_hidden_conversations')
                  .delete()
                  .eq('owner_user_id', authed.userId)
                  .eq('conversation_type', conversationType)
                  .eq('conversation_id', conversationId);

                if (error) {
                  const msg = isMissingTableError(error, 'sms_hidden_conversations')
                    ? 'SMS hidden-conversations table not found. Apply migration 016_create_sms_hidden_conversations.sql to the MGMT database.'
                    : `Failed to unhide conversation: ${error.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                result = { ok: true, hidden: false, conversation_type: conversationType, conversation_id: conversationId };
                extraPayload.smsHideConversation = result;
              }
              break;

            case 'smsUpdateThread':
              {
                const authed = await getDashboardAuthUserFromSession(request);
                if (!authed) {
                  return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
                }

                const threadId = String(body?.thread_id || body?.threadId || '').trim();
                const contactPhone = normalizePhone(String(body?.contact_phone || body?.contactPhone || '').trim());
                const contactName = safeTrim(body?.contact_name ?? body?.contactName ?? '');

                if (!threadId && !contactPhone) {
                  return NextResponse.json({ ok: false, error: 'thread_id or contact_phone is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (contactName.length > 80) {
                  return NextResponse.json({ ok: false, error: 'contact_name too long (max 80)' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = getDeliverablesDb();
                let q = db.from('sms_threads').update({ contact_name: contactName || null });
                q = threadId ? q.eq('thread_id', threadId) : q.eq('contact_phone', contactPhone);

                const { data: rows, error } = await q
                  .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
                  .limit(1);

                if (error) {
                  const msg = isMissingTableError(error, 'sms_threads')
                    ? 'SMS inbox tables not found. Apply migrations 013_create_sms_inbox.sql + 014_sms_inbox_sender_and_contacts.sql to the MGMT database.'
                    : `Failed to update thread: ${error.message}`;
                  return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                }

                const updated = Array.isArray(rows) && rows.length ? rows[0] : null;
                if (!updated) {
                  // If caller provided a phone (no thread id), allow creating/upserting the contact record.
                  if (!threadId && contactPhone) {
                    const { data: row, error: upsertErr } = await db
                      .from('sms_threads')
                      .upsert(
                        {
                          contact_phone: contactPhone,
                          contact_name: contactName || null
                        },
                        { onConflict: 'contact_phone' }
                      )
                      .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
                      .single();

                    if (upsertErr) {
                      const msg = isMissingTableError(upsertErr, 'sms_threads')
                        ? 'SMS inbox tables not found. Apply migrations 013_create_sms_inbox.sql + 014_sms_inbox_sender_and_contacts.sql to the MGMT database.'
                        : `Failed to upsert contact: ${upsertErr.message}`;
                      return NextResponse.json({ ok: false, error: msg }, { status: 500, headers: corsHeaders(request) });
                    }

                    result = { updated: true, thread: row, created: true };
                    extraPayload.smsUpdateThread = result;
                    break;
                  }
                  return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404, headers: corsHeaders(request) });
                }

                result = { updated: true, thread: updated };
                extraPayload.smsUpdateThread = result;
              }
              break;

            case 'createDashboardUser':
              {
                const auth = await requireAdminToken(request);
                if (!auth.ok) {
                  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
                }

                const username = normalizeDashboardUsername(body?.username);
                const displayName = String(body?.displayName || body?.name || '').trim();
                const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
                const role = String(body?.role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA';
                let pin = String(body?.pin || '').trim();
                const pinWasGenerated = !pin;
                if (!pin) pin = generateNumericPin(8);

                if (!username) {
                  return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!displayName) {
                  return NextResponse.json({ ok: false, error: 'displayName is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!pin || pin.length < 4) {
                  return NextResponse.json({ ok: false, error: 'pin must be at least 4 characters' }, { status: 400, headers: corsHeaders(request) });
                }

                const saltBytes = new Uint8Array(16);
                crypto.getRandomValues(saltBytes);
                const saltB64 = bytesToBase64Url(saltBytes);
                const hashB64 = await pbkdf2Sha256Base64Url(pin, saltBytes);

                const nowIso = new Date().toISOString();
                const db = tasksDb;

                const { data: inserted, error } = await db
                  .from('Dashboard_Users')
                  .insert({
                    Username: username,
                    Display_Name: displayName,
                    Email: email,
                    Role: role,
                    Is_Disabled: false,
                    Pin_Salt: saltB64,
                    Pin_Hash: hashB64,
                    Created_At: nowIso,
                    Updated_At: nowIso
                  })
                  .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled, Created_At, Updated_At')
                  .single();

                if (error) {
                  return NextResponse.json({ ok: false, error: `Failed to create user: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                result = { user: inserted, pin, pinWasGenerated };
                extraPayload.createDashboardUser = result;
              }
              break;

            case 'resetDashboardUserPin':
              {
                const auth = await requireAdminToken(request);
                if (!auth.ok) {
                  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
                }

                const userId = String(body?.userId || '').trim();
                const username = normalizeDashboardUsername(body?.username);
                let pin = String(body?.pin || '').trim();
                const pinWasGenerated = !pin;
                if (!pin) pin = generateNumericPin(8);

                if (!userId && !username) {
                  return NextResponse.json({ ok: false, error: 'userId or username is required' }, { status: 400, headers: corsHeaders(request) });
                }
                if (!pin || pin.length < 4) {
                  return NextResponse.json({ ok: false, error: 'pin must be at least 4 characters' }, { status: 400, headers: corsHeaders(request) });
                }

                const saltBytes = new Uint8Array(16);
                crypto.getRandomValues(saltBytes);
                const saltB64 = bytesToBase64Url(saltBytes);
                const hashB64 = await pbkdf2Sha256Base64Url(pin, saltBytes);
                const nowIso = new Date().toISOString();

                const db = tasksDb;
                let q = db.from('Dashboard_Users').update({ Pin_Salt: saltB64, Pin_Hash: hashB64, Updated_At: nowIso });
                q = userId ? q.eq('User_ID', userId) : q.eq('Username', username);

                const { data: rows, error } = await q
                  .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled, Updated_At')
                  .limit(1);

                if (error) {
                  return NextResponse.json({ ok: false, error: `Failed to reset PIN: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                const updated = Array.isArray(rows) && rows.length ? rows[0] : null;
                if (!updated) {
                  return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404, headers: corsHeaders(request) });
                }

                result = { user: updated, pin, pinWasGenerated };
                extraPayload.resetDashboardUserPin = result;
              }
              break;

            case 'sendDashboardLoginInvite':
              {
                const auth = await requireAdminToken(request);
                if (!auth.ok) {
                  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
                }

                const inputEmail = typeof body?.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
                const inputUsername = normalizeDashboardUsername(body?.username);
                const inputDisplayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
                const inputRole = String(body?.role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA';
                const userId = String(body?.userId || '').trim();

                // Optional: allow sending invite to a disabled account if explicitly enabled.
                const forceEnable = ['1', 'true', 'yes', 'on'].includes(String(body?.forceEnable || '').toLowerCase());

                const db = tasksDb;
                const nowIso = new Date().toISOString();

                const deriveUsernameFromEmail = (email: string): string => {
                  const local = String(email.split('@')[0] || '').trim();
                  const cleaned = local.replace(/[^a-z0-9 _\-\.]/gi, ' ').replace(/\s+/g, ' ').trim();
                  return normalizeDashboardUsername(cleaned || local || 'VA');
                };

                // 1) Load or create user
                let user: any = null;
                if (userId) {
                  const { data, error } = await db
                    .from('Dashboard_Users')
                    .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled')
                    .eq('User_ID', userId)
                    .maybeSingle();
                  if (error) {
                    return NextResponse.json({ ok: false, error: `Failed to load user: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                  }
                  user = data || null;
                }

                if (!user && inputEmail) {
                  const { data, error } = await db
                    .from('Dashboard_Users')
                    .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled')
                    .ilike('Email', inputEmail)
                    .maybeSingle();
                  if (error) {
                    return NextResponse.json({ ok: false, error: `Failed to find user by email: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                  }
                  user = data || null;
                }

                if (!user && inputUsername) {
                  const { data, error } = await db
                    .from('Dashboard_Users')
                    .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled')
                    .eq('Username', inputUsername)
                    .maybeSingle();
                  if (error) {
                    return NextResponse.json({ ok: false, error: `Failed to find user by username: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                  }
                  user = data || null;
                }

                // Create if missing
                if (!user) {
                  const emailToUse = inputEmail;
                  if (!emailToUse) {
                    return NextResponse.json({ ok: false, error: 'email is required to create a new account' }, { status: 400, headers: corsHeaders(request) });
                  }

                  const usernameToUse = inputUsername || deriveUsernameFromEmail(emailToUse);
                  const displayNameToUse = inputDisplayName || usernameToUse;

                  // Generate a temp PIN
                  const pin = generateNumericPin(8);
                  const saltBytes = new Uint8Array(16);
                  crypto.getRandomValues(saltBytes);
                  const saltB64 = bytesToBase64Url(saltBytes);
                  const hashB64 = await pbkdf2Sha256Base64Url(pin, saltBytes);

                  const { data: inserted, error } = await db
                    .from('Dashboard_Users')
                    .insert({
                      Username: usernameToUse,
                      Display_Name: displayNameToUse,
                      Email: emailToUse,
                      Role: inputRole,
                      Is_Disabled: false,
                      Pin_Salt: saltB64,
                      Pin_Hash: hashB64,
                      Created_At: nowIso,
                      Updated_At: nowIso
                    })
                    .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled')
                    .single();

                  if (error) {
                    return NextResponse.json({ ok: false, error: `Failed to create user: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                  }

                  user = inserted;

                  // Send email
                  const loginUrl = String(process.env.H2S_DASHBOARD_LOGIN_URL || process.env.H2S_DASHBOARD_URL || 'https://portal.home2smart.com').trim();
                  const safeUrl = /^https?:\/\//i.test(loginUrl) ? loginUrl : 'https://portal.home2smart.com';
                  const subject = 'Your Home2Smart Portal Login';
                  const html = `
                    <div style="font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; line-height:1.45; color:#0f172a;">
                      <h2 style="margin:0 0 8px 0;">Log into your account</h2>
                      <p style="margin:0 0 14px 0;">Your Home2Smart Portal access is ready.</p>
                      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; margin: 0 0 14px 0;">
                        <div style="font-weight:800; margin-bottom:6px;">Login URL</div>
                        <div><a href="${safeUrl}" style="color:#1d4ed8;">${safeUrl}</a></div>
                        <div style="height:10px;"></div>
                        <div style="font-weight:800; margin-bottom:6px;">Credentials</div>
                        <div><b>Username:</b> ${String(usernameToUse)}</div>
                        <div><b>PIN:</b> ${String(pin)}</div>
                      </div>
                      <p style="margin:0 0 10px 0; color:#334155;">After you sign in, use the <b>Change PIN</b> button to set your own PIN.</p>
                      <p style="margin:0; color:#64748b; font-size:12px;">If you have trouble signing in, reply to this email.</p>
                    </div>
                  `;

                  const idempotencyKey = `dashboard_invite:${String(inserted?.User_ID || '')}:${await sha256Base64Url(String(pin))}`;
                  const mailRes = await sendMail({
                    to: emailToUse,
                    subject,
                    html,
                    category: 'dashboard_invite',
                    idempotencyKey,
                    meta: { userId: inserted?.User_ID, username: usernameToUse }
                  });

                  // Sign-in self-check (recompute and compare hash)
                  let signInTest: any = { ok: false };
                  try {
                    const { data: verifyRow, error: verifyErr } = await db
                      .from('Dashboard_Users')
                      .select('Pin_Salt, Pin_Hash, Is_Disabled')
                      .eq('User_ID', inserted.User_ID)
                      .maybeSingle();
                    if (verifyErr || !verifyRow) throw new Error(verifyErr?.message || 'Missing verify row');
                    if (verifyRow.Is_Disabled) throw new Error('Account disabled');
                    const saltBytes2 = base64UrlToBytes(String(verifyRow.Pin_Salt || ''));
                    const computed2 = await pbkdf2Sha256Base64Url(pin, saltBytes2);
                    const ok2 = constantTimeEquals(String(computed2 || ''), String(verifyRow.Pin_Hash || ''));
                    signInTest = ok2 ? { ok: true } : { ok: false, error: 'Hash mismatch after write' };
                  } catch (e: any) {
                    signInTest = { ok: false, error: e?.message || 'Sign-in test failed' };
                  }

                  result = { user, pin, created: true, mail: mailRes, signInTest };
                  extraPayload.sendDashboardLoginInvite = result;
                  break;
                }

                // Existing user: reset PIN + optionally patch email/display/role.
                if (user.Is_Disabled && !forceEnable) {
                  return NextResponse.json(
                    { ok: false, error: 'Account disabled (set forceEnable=true to enable + invite)', user },
                    { status: 403, headers: corsHeaders(request) }
                  );
                }

                // Determine email recipient (must exist or be provided)
                const emailToUse = (inputEmail || String(user.Email || '').trim().toLowerCase()) || null;
                if (!emailToUse) {
                  return NextResponse.json({ ok: false, error: 'Email is required to send invite (user has no email on file)' }, { status: 400, headers: corsHeaders(request) });
                }

                // Generate new temp PIN
                const pin = String(body?.pin || '').trim() || generateNumericPin(8);
                const saltBytes = new Uint8Array(16);
                crypto.getRandomValues(saltBytes);
                const saltB64 = bytesToBase64Url(saltBytes);
                const hashB64 = await pbkdf2Sha256Base64Url(pin, saltBytes);

                const patch: any = {
                  Pin_Salt: saltB64,
                  Pin_Hash: hashB64,
                  Updated_At: nowIso
                };
                if (forceEnable) patch.Is_Disabled = false;
                if (inputEmail) patch.Email = inputEmail;
                if (inputDisplayName) patch.Display_Name = inputDisplayName;
                if (inputRole) patch.Role = inputRole;

                const { data: updatedRows, error: updateError } = await db
                  .from('Dashboard_Users')
                  .update(patch)
                  .eq('User_ID', user.User_ID)
                  .select('User_ID, Username, Display_Name, Email, Role, Is_Disabled')
                  .limit(1);

                if (updateError) {
                  return NextResponse.json({ ok: false, error: `Failed to reset PIN: ${updateError.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                const updated = Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : user;
                user = updated;

                const loginUrl = String(process.env.H2S_DASHBOARD_LOGIN_URL || process.env.H2S_DASHBOARD_URL || 'https://portal.home2smart.com').trim();
                const safeUrl = /^https?:\/\//i.test(loginUrl) ? loginUrl : 'https://portal.home2smart.com';
                const subject = 'Your Home2Smart Portal Login';
                const html = `
                  <div style="font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; line-height:1.45; color:#0f172a;">
                    <h2 style="margin:0 0 8px 0;">Log into your account</h2>
                    <p style="margin:0 0 14px 0;">Here are your updated login credentials.</p>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; margin: 0 0 14px 0;">
                      <div style="font-weight:800; margin-bottom:6px;">Login URL</div>
                      <div><a href="${safeUrl}" style="color:#1d4ed8;">${safeUrl}</a></div>
                      <div style="height:10px;"></div>
                      <div style="font-weight:800; margin-bottom:6px;">Credentials</div>
                      <div><b>Username:</b> ${String(user.Username || '')}</div>
                      <div><b>PIN:</b> ${String(pin)}</div>
                    </div>
                    <p style="margin:0 0 10px 0; color:#334155;">After you sign in, use the <b>Change PIN</b> button to set your own PIN.</p>
                    <p style="margin:0; color:#64748b; font-size:12px;">If you have trouble signing in, reply to this email.</p>
                  </div>
                `;

                const idempotencyKey = `dashboard_invite:${String(user?.User_ID || '')}:${await sha256Base64Url(String(pin))}`;
                const mailRes = await sendMail({
                  to: emailToUse,
                  subject,
                  html,
                  category: 'dashboard_invite',
                  idempotencyKey,
                  meta: { userId: user?.User_ID, username: user?.Username }
                });

                // Sign-in self-check
                let signInTest: any = { ok: false };
                try {
                  const { data: verifyRow, error: verifyErr } = await db
                    .from('Dashboard_Users')
                    .select('Pin_Salt, Pin_Hash, Is_Disabled')
                    .eq('User_ID', user.User_ID)
                    .maybeSingle();
                  if (verifyErr || !verifyRow) throw new Error(verifyErr?.message || 'Missing verify row');
                  if (verifyRow.Is_Disabled) throw new Error('Account disabled');
                  const saltBytes2 = base64UrlToBytes(String(verifyRow.Pin_Salt || ''));
                  const computed2 = await pbkdf2Sha256Base64Url(pin, saltBytes2);
                  const ok2 = constantTimeEquals(String(computed2 || ''), String(verifyRow.Pin_Hash || ''));
                  signInTest = ok2 ? { ok: true } : { ok: false, error: 'Hash mismatch after write' };
                } catch (e: any) {
                  signInTest = { ok: false, error: e?.message || 'Sign-in test failed' };
                }

                result = { user, pin, created: false, mail: mailRes, signInTest };
                extraPayload.sendDashboardLoginInvite = result;
              }
              break;

            case 'disableDashboardUser':
              {
                const auth = await requireAdminToken(request);
                if (!auth.ok) {
                  return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
                }

                const userId = String(body?.userId || '').trim();
                const username = normalizeDashboardUsername(body?.username);
                const isDisabled = !['0', 'false', 'no', 'off'].includes(String(body?.isDisabled ?? true).toLowerCase());

                if (!userId && !username) {
                  return NextResponse.json({ ok: false, error: 'userId or username is required' }, { status: 400, headers: corsHeaders(request) });
                }

                const db = tasksDb;
                const nowIso = new Date().toISOString();
                let q = db.from('Dashboard_Users').update({ Is_Disabled: isDisabled, Updated_At: nowIso });
                q = userId ? q.eq('User_ID', userId) : q.eq('Username', username);

                const { data: rows, error } = await q.select('User_ID, Username, Display_Name, Email, Role, Is_Disabled, Updated_At').limit(1);
                if (error) {
                  return NextResponse.json({ ok: false, error: `Failed to update user: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
                }

                result = (rows || [])[0] || null;
                extraPayload.disableDashboardUser = result;
              }
              break;

            case 'upsertTaskDraft':
              {
                const title = normalizeText(body?.title);
                if (!title) {
                  return NextResponse.json(
                    { ok: false, error: 'Task title is required' },
                    { status: 400, headers: corsHeaders(request) }
                  );
                }

                const taskId = normalizeText(body?.taskId) || crypto.randomUUID();
                const now = new Date().toISOString();

                // Optional due date/time support (same logic as addTask)
                let dueDateValue = null;
                if (body?.dueDate) {
                  try {
                    if (String(body.dueDate).includes('T')) {
                      dueDateValue = new Date(body.dueDate).toISOString();
                    } else if (body?.dueTime) {
                      dueDateValue = new Date(`${body.dueDate}T${body.dueTime}:00`).toISOString();
                    } else {
                      dueDateValue = new Date(`${body.dueDate}T23:59:59`).toISOString();
                    }
                  } catch {
                    return NextResponse.json(
                      { ok: false, error: 'Invalid date format' },
                      { status: 400, headers: corsHeaders(request) }
                    );
                  }
                }

                const upsertPayload: any = {
                  Task_ID: taskId,
                  Title: title,
                  Assets: normalizeAssets(body?.assets),
                  Priority: body?.priority || 'MEDIUM',
                  Due_Date: dueDateValue,
                  Category: body?.category || null,
                  Assigned_To: body?.assignedTo || null,
                  Status: body?.status || 'PENDING',
                  Creator_Mode: 'BUILT',
                  Raw_Input_Text: body?.rawInputText ?? null,
                  Outcome_Text: body?.outcomeText ?? null,
                  Context_Text: body?.contextText ?? null,
                  Constraints_Text: body?.constraintsText ?? null,
                  Recurrence: body?.recurrence || null,
                  Retention_Days: body?.retentionDays ?? null,
                  Updated_At: now
                };

                // If row doesn't exist yet, set Created_At.
                const { data: existing, error: existingError } = await tasksDb
                  .from('Tasks')
                  .select('Task_ID')
                  .eq('Task_ID', taskId)
                  .maybeSingle();

                if (existingError) {
                  return NextResponse.json(
                    { ok: false, error: `Failed to check task: ${existingError.message}` },
                    { status: 500, headers: corsHeaders(request) }
                  );
                }

                if (!existing) {
                  upsertPayload.Created_At = now;
                }

                const { data: saved, error } = await tasksDb
                  .from('Tasks')
                  .upsert(upsertPayload, { onConflict: 'Task_ID' })
                  .select('*')
                  .single();

                if (error) {
                  return NextResponse.json(
                    { ok: false, error: `Failed to save task draft: ${error.message}` },
                    { status: 500, headers: corsHeaders(request) }
                  );
                }

                result = saved;
              }
              break;

            case 'generateTaskDetails':
              {
                const taskId = normalizeText(body?.taskId);
                if (!taskId) {
                  return NextResponse.json(
                    { ok: false, error: 'taskId is required' },
                    { status: 400, headers: corsHeaders(request) }
                  );
                }

                const { data: task, error: taskError } = await tasksDb
                  .from('Tasks')
                  .select('*')
                  .eq('Task_ID', taskId)
                  .single();

                if (taskError || !task) {
                  return NextResponse.json(
                    { ok: false, error: `Task not found: ${taskError?.message || taskId}` },
                    { status: 404, headers: corsHeaders(request) }
                  );
                }

                const fields = {
                  rawInputText: task.Raw_Input_Text ?? body?.rawInputText,
                  outcomeText: task.Outcome_Text ?? body?.outcomeText,
                  contextText: task.Context_Text ?? body?.contextText,
                  constraintsText: task.Constraints_Text ?? body?.constraintsText
                };

                const gate = canGenerateTaskDetails(fields);
                if (!gate.ok) {
                  return NextResponse.json(
                    { ok: false, ...gate },
                    { status: 400, headers: corsHeaders(request) }
                  );
                }

                if (!openai) {
                  return NextResponse.json(
                    { ok: false, code: 'AI_NOT_CONFIGURED', message: 'AI is not configured for this environment' },
                    { status: 200, headers: corsHeaders(request) }
                  );
                }

                const prompt = `You are helping create a task for a human operator.

      Hard rules:
      - Do NOT invent facts, tools, links, accounts, or access.
      - If something is unknown, phrase the step as an instruction to confirm it (e.g., "Confirm X") rather than guessing.
      - Keep it actionable and concrete.

      Return STRICT JSON ONLY with this schema:
      {
        "description": "string (1-3 short paragraphs)",
        "checklist": ["string", ...],
        "acceptance": ["string", ...],
        "dependencies": ["string", ...],
        "suggested": {
          "category": "string | null",
          "priority": "HIGH | MEDIUM | LOW | null",
          "due_date": "YYYY-MM-DD | null",
          "due_time": "HH:MM | null",
          "recurrence": "none | daily | weekly | null",
          "retention_days": "number | null"
        }
      }

      INPUT:
      RAW_INPUT_TEXT:\n${normalizeText(fields.rawInputText)}

      OUTCOME_TEXT (Definition of Done):\n${normalizeText(fields.outcomeText)}

      CONTEXT_TEXT:\n${normalizeText(fields.contextText)}

      CONSTRAINTS_TEXT:\n${normalizeText(fields.constraintsText)}
      `;

                const completion = await openai.chat.completions.create({
                  model: 'gpt-4o',
                  messages: [
                    { role: 'system', content: 'You write tasks with zero guessing.' },
                    { role: 'user', content: prompt }
                  ],
                  response_format: { type: 'json_object' },
                  temperature: 0.2
                });

                const raw = completion.choices?.[0]?.message?.content || '';
                const parsedAttempt = tryParseJsonObject(raw);
                if (!parsedAttempt.ok) {
                  return NextResponse.json(
                    {
                      ok: false,
                      code: 'AI_JSON_PARSE_FAILED',
                      message: 'AI returned an invalid JSON payload. Please try again.',
                      error: parsedAttempt.error
                    },
                    { status: 200, headers: corsHeaders(request) }
                  );
                }

                const parsed: any = parsedAttempt.value;

                const aiDescription = typeof parsed?.description === 'string' ? parsed.description : '';
                const aiChecklist = Array.isArray(parsed?.checklist) ? parsed.checklist : [];
                const aiAcceptance = Array.isArray(parsed?.acceptance) ? parsed.acceptance : [];
                const aiDependencies = Array.isArray(parsed?.dependencies) ? parsed.dependencies : [];

                const suggestedRaw = parsed?.suggested && typeof parsed.suggested === 'object' ? parsed.suggested : null;
                const suggested: any = {};
                if (suggestedRaw) {
                  const cat = typeof suggestedRaw.category === 'string' ? suggestedRaw.category.trim() : '';
                  const pri = typeof suggestedRaw.priority === 'string' ? suggestedRaw.priority.trim().toUpperCase() : '';
                  const dueDate = typeof suggestedRaw.due_date === 'string' ? suggestedRaw.due_date.trim() : '';
                  const dueTime = typeof suggestedRaw.due_time === 'string' ? suggestedRaw.due_time.trim() : '';
                  const rec = typeof suggestedRaw.recurrence === 'string' ? suggestedRaw.recurrence.trim().toLowerCase() : '';
                  const retention = typeof suggestedRaw.retention_days === 'number' ? suggestedRaw.retention_days : parseInt(String(suggestedRaw.retention_days || ''), 10);

                  if (cat) suggested.category = cat;
                  if (['HIGH', 'MEDIUM', 'LOW'].includes(pri)) suggested.priority = pri;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) suggested.dueDate = dueDate;
                  if (/^\d{2}:\d{2}$/.test(dueTime)) suggested.dueTime = dueTime;
                  if (['none', 'daily', 'weekly'].includes(rec)) suggested.recurrence = rec;
                  if (!Number.isNaN(retention) && retention > 0 && retention <= 365) suggested.retentionDays = retention;
                }

                // Return suggestions as a separate payload key so Dash can choose whether to apply.
                extraPayload.taskCreatorSuggestions = suggested;

                const now = new Date().toISOString();
                const { data: updated, error: updateError } = await tasksDb
                  .from('Tasks')
                  .update({
                    Creator_Mode: task.Creator_Mode || 'BUILT',
                    AI_Description: aiDescription || null,
                    AI_Checklist: aiChecklist,
                    AI_Acceptance: aiAcceptance,
                    AI_Dependencies: aiDependencies,
                    AI_Generated_At: now,
                    Updated_At: now
                  })
                  .eq('Task_ID', taskId)
                  .select('*')
                  .single();

                if (updateError) {
                  return NextResponse.json(
                    { ok: false, error: `Failed to persist AI details: ${updateError.message}` },
                    { status: 500, headers: corsHeaders(request) }
                  );
                }

                result = updated;
              }
              break;

            case 'taskCreatorIntake':
              {
                const briefText = normalizeText(body?.briefText ?? body?.brief ?? body?.rawInputText);
                const outcomeText = normalizeText(body?.outcomeText);
                const contextText = normalizeText(body?.contextText);
                const constraintsText = normalizeText(body?.constraintsText);

                if (!briefText && !outcomeText) {
                  return NextResponse.json(
                    { ok: false, error: 'briefText is required' },
                    { status: 400, headers: corsHeaders(request) }
                  );
                }

                // Guardrail: if outcome is missing, return exactly one question.
                const question = !outcomeText ? missingOutcomeQuestion() : null;

                if (!openai) {
                  return NextResponse.json(
                    {
                      ok: true,
                      result: { title: null, suggested: {} },
                      taskCreatorIntake: { title: null, suggested: {} },
                      question
                    },
                    { headers: corsHeaders(request) }
                  );
                }

                const prompt = `You are helping intake a task from a spoken/written brief.

Hard rules:
- Do NOT invent facts, tools, links, accounts, or access.
- Return suggestions only. If uncertain, return null.
- Keep the title short and specific (max ~70 chars). No fluff.

Return STRICT JSON ONLY with this schema:
{
  "title": "string | null",
  "suggested": {
    "category": "string | null",
    "priority": "HIGH | MEDIUM | LOW | null",
    "due_date": "YYYY-MM-DD | null",
    "due_time": "HH:MM | null",
    "recurrence": "none | daily | weekly | null",
    "retention_days": "number | null"
  }
}

INPUT:
BRIEF_TEXT:\n${briefText}

OUTCOME_TEXT (may be empty):\n${outcomeText}

CONTEXT_TEXT:\n${contextText}

CONSTRAINTS_TEXT:\n${constraintsText}
`;

                const completion = await openai.chat.completions.create({
                  model: 'gpt-4o',
                  messages: [
                    { role: 'system', content: 'You extract safe task suggestions with zero guessing.' },
                    { role: 'user', content: prompt }
                  ],
                  response_format: { type: 'json_object' },
                  temperature: 0.2
                });

                const raw = completion.choices?.[0]?.message?.content || '';
                const parsedAttempt = tryParseJsonObject(raw);
                if (!parsedAttempt.ok) {
                  // Don't hard-fail UX for intake; return empty suggestions + keep the one-question guardrail.
                  result = { title: null, suggested: {} };
                  extraPayload.taskCreatorIntake = result;
                  if (question) extraPayload.question = question;
                  extraPayload.taskCreatorIntakeError = {
                    code: 'AI_JSON_PARSE_FAILED',
                    message: 'AI intake failed to return valid JSON. Try again or type a short title manually.',
                    error: parsedAttempt.error
                  };
                  break;
                }

                const parsed: any = parsedAttempt.value;

                const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
                const suggestedRaw = parsed?.suggested && typeof parsed.suggested === 'object' ? parsed.suggested : null;
                const suggested: any = {};
                if (suggestedRaw) {
                  const cat = typeof suggestedRaw.category === 'string' ? suggestedRaw.category.trim() : '';
                  const pri = typeof suggestedRaw.priority === 'string' ? suggestedRaw.priority.trim().toUpperCase() : '';
                  const dueDate = typeof suggestedRaw.due_date === 'string' ? suggestedRaw.due_date.trim() : '';
                  const dueTime = typeof suggestedRaw.due_time === 'string' ? suggestedRaw.due_time.trim() : '';
                  const rec = typeof suggestedRaw.recurrence === 'string' ? suggestedRaw.recurrence.trim().toLowerCase() : '';
                  const retention = typeof suggestedRaw.retention_days === 'number' ? suggestedRaw.retention_days : parseInt(String(suggestedRaw.retention_days || ''), 10);

                  if (cat) suggested.category = cat;
                  if (['HIGH', 'MEDIUM', 'LOW'].includes(pri)) suggested.priority = pri;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) suggested.dueDate = dueDate;
                  if (/^\d{2}:\d{2}$/.test(dueTime)) suggested.dueTime = dueTime;
                  if (['none', 'daily', 'weekly'].includes(rec)) suggested.recurrence = rec;
                  if (!Number.isNaN(retention) && retention > 0 && retention <= 365) suggested.retentionDays = retention;
                }

                result = { title: title ? title.slice(0, 90) : null, suggested };
                extraPayload.taskCreatorIntake = result;
                if (question) extraPayload.question = question;
              }
              break;
      case 'set_path_rule':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const pattern = normalizePathPattern(body?.pattern ?? body?.path ?? body?.page_path);
          const matchType = normalizeMatchType(body?.match_type ?? body?.matchType);
          const isBlocked = !['0', 'false', 'no', 'off'].includes(String(body?.is_blocked ?? body?.isBlocked ?? true).toLowerCase());
          const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;

          if (!pattern) {
            return NextResponse.json({ ok: false, error: 'pattern is required (path or URL)' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getTrackingDb();
          const { data: rows, error } = await db
            .from('h2s_tracking_path_rules')
            .upsert(
              {
                pattern,
                match_type: matchType,
                is_blocked: isBlocked,
                reason
              },
              { onConflict: 'match_type,pattern' }
            )
            .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
            .limit(1);

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to upsert path rule: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = (rows || [])[0] || null;
        }
        break;

      case 'delete_path_rule':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const id = String(body?.id || '').trim();
          if (!id || !isUuid(id)) {
            return NextResponse.json({ ok: false, error: 'id (UUID) is required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getTrackingDb();
          const { error } = await db.from('h2s_tracking_path_rules').delete().eq('id', id);
          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to delete path rule: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          result = { deleted: true, id };
        }
        break;

      case 'delete_purchase':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const eventId = String(body?.event_id || body?.eventId || '').trim();
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dry_run || body?.dryRun || '').toLowerCase());

          if (!eventId) {
            return NextResponse.json({ ok: false, error: 'event_id is required' }, { status: 400, headers: corsHeaders(request) });
          }
          if (!isUuid(eventId)) {
            return NextResponse.json({ ok: false, error: 'event_id must be a UUID' }, { status: 400, headers: corsHeaders(request) });
          }

          const db1Client = getTrackingDb();
          const { data: events, error: fetchError } = await db1Client
            .from('h2s_tracking_events')
            .select('*')
            .eq('event_id', eventId)
            .limit(1);

          if (fetchError) {
            return NextResponse.json(
              { ok: false, error: `Failed to fetch event: ${fetchError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          const event = (events || [])[0];
          if (!event) {
            return NextResponse.json({ ok: false, error: 'Purchase event not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const eventType = normalizeTrackingEventType(event.event_type || event.event_name);
          if (eventType !== 'purchase') {
            return NextResponse.json(
              { ok: false, error: `Refusing to delete non-purchase event (type=${eventType})` },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const preview = {
            event_id: event.event_id,
            occurred_at: event.occurred_at,
            page_path: event.page_path,
            visitor_id: event.visitor_id,
            session_id: event.session_id,
            order_id: event.order_id,
            job_id: event.job_id,
            customer_email: event.customer_email,
            revenue_amount: normalizeRevenueAmount(event.revenue_amount)
          };

          if (dryRun) {
            result = { dry_run: true, purchase: preview };
            break;
          }

          const { data: deleted, error: deleteError } = await db1Client
            .from('h2s_tracking_events')
            .delete()
            .eq('event_id', eventId)
            .select('event_id');

          if (deleteError) {
            return NextResponse.json(
              { ok: false, error: `Failed to delete purchase: ${deleteError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = { deleted: (deleted || []).length, event_id: eventId, purchase: preview };
        }
        break;

      case 'ai-insights':
        // FunnelTrack compatibility: POST /api/v1?action=ai-insights with body.action='ai_report'
        // Returns the same contract FunnelTrack expects: { status: 'success', report: '<html>', timestamp }
        if (body?.action && body.action !== 'ai_report') {
          return NextResponse.json({ ok: false, error: `Unsupported ai-insights action: ${body.action}` }, { status: 400, headers: corsHeaders(request) });
        }

        {
          const days = toInt(body?.days ?? searchParams.get('days'), 30);
          const limit = toInt(body?.limit ?? searchParams.get('limit'), 1500);
          const startDate = body?.start_date || body?.startDate || searchParams.get('start_date') || searchParams.get('startDate') || undefined;
          const endDate = body?.end_date || body?.endDate || searchParams.get('end_date') || searchParams.get('endDate') || undefined;
          const minDate = body?.min_date || body?.minDate || searchParams.get('min_date') || searchParams.get('minDate') || undefined;
          const report = await buildAiReport({ request, days, limit, startDate, endDate, minDate });
          // Keep response shape stable for FunnelTrack
          return NextResponse.json(report, { headers: corsHeaders(request) });
        }

      case 'logHours':
        // Server-side validation
        if (!body.date || body.hours === undefined || body.hours === null || !body.tasks || !body.vaName) {
          const missing = [];
          if (!body.date) missing.push('date');
          if (body.hours === undefined || body.hours === null) missing.push('hours');
          if (!body.tasks) missing.push('tasks');
          if (!body.vaName) missing.push('vaName');
          
          return NextResponse.json({ 
            ok: false, 
            error: `Missing required fields: ${missing.join(', ')}` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate hours is a positive number
        const hoursNum = parseFloat(body.hours);
        if (isNaN(hoursNum) || hoursNum <= 0 || hoursNum > 24) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid hours value: must be between 0 and 24` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate date format
        const dateObj = new Date(body.date);
        if (isNaN(dateObj.getTime())) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid date format` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Normalize date to start of day for duplicate check
        const normalizedDate = new Date(dateObj);
        normalizedDate.setHours(0, 0, 0, 0);
        const dateISO = normalizedDate.toISOString();
        const dateOnly = dateISO.split('T')[0];
        
        // Check for existing entry (idempotency: one entry per user per day)
        const dayStart = `${dateOnly}T00:00:00.000Z`;
        const dayEnd = `${dateOnly}T23:59:59.999Z`;
        
        const { data: existingEntry } = await getSupabase()
          .from('VA_Hours_Log')
          .select('Entry_ID, Date, Hours')
          .eq('Logged_By', body.vaName)
          .gte('Date', dayStart)
          .lte('Date', dayEnd)
          .maybeSingle();
        
        if (existingEntry) {
          return NextResponse.json({ 
            ok: false, 
            error: `Hours already logged for ${body.date}. Entry ID: ${existingEntry.Entry_ID}` 
          }, { status: 409, headers: corsHeaders(request) });
        }
        
        // AI Analysis only if OpenAI is configured
        let aiSummary = 'AI analysis not configured';
        
        if (openai) {
          try {
            const analysisPrompt = `Analyze this work log entry. Provide a structured analysis with exactly 4 sections, each formatted as:

**1. Specific Outcomes Achieved**
[Analyze what concrete results were delivered. Were revenue-generating tasks prioritized? What tangible value was created?]

**2. Learning and Skill Development Demonstrated**
[Identify what skills were learned or practiced. What knowledge gaps were addressed? What competencies were demonstrated?]

**3. Process Improvements or Blockers to Address**
[Note any blockers, inefficiencies, or areas needing support. What could be improved in the workflow?]

**4. Priorities for Tomorrow**
[Based on today's work, what should be prioritized next? Balance foundational work with immediate revenue tasks.]

Be direct, constructive, and actionable. Keep each section concise (2-3 sentences). Focus on value creation and growth.`;

            const systemPrompt = body.analysisPrompt 
              ? "You are a Revenue Operations Director. " + body.analysisPrompt
              : "You are a Revenue Operations Director focused on productivity, revenue generation, and team development. Provide clear, actionable insights.";
            
            const analysis = await openai.chat.completions.create({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${analysisPrompt}\n\nWork Log:\n${body.tasks}` }
              ],
              model: "gpt-4o",
            });
            aiSummary = analysis.choices[0].message.content || '';
          } catch (aiError: any) {
            aiSummary = 'AI analysis failed: ' + (aiError.message || 'Unknown error');
          }
        }
        
        const loggedBy = body.vaName || 'ROSEL';
        
        // Insert into database
        try {
          const entryId = crypto.randomUUID();
          
          const { data: hoursLog, error: dbError } = await getSupabase()
            .from('VA_Hours_Log')
            .insert({
              Entry_ID: entryId,
              Date: dateISO,
              Hours: hoursNum,
              Tasks: body.tasks,
              Logged_By: loggedBy,
              AI_Summary: aiSummary
            })
            .select()
            .single();
          
          if (dbError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Database error: ${dbError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          result = hoursLog;
        } catch (insertError: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Insert failed: ${insertError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'parseForecast':
        // AI-powered forecast metric extraction with location context awareness
        if (!openai) {
          return NextResponse.json({ 
            ok: false, 
            error: 'OpenAI API not configured' 
          }, { status: 500, headers: corsHeaders(request) });
        }

        const forecastText = body.text || '';
        const forecastContext = body.context || { location: null, previousInputs: null };

        if (!forecastText) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing text input' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        try {
          // REBUILT: Intelligent extraction that understands context, vague statements, and implied information
          const systemPrompt = `You are an intelligent business metric extractor with deep context understanding. Your job is to:
1. Extract EXPLICIT values (numbers, locations, services mentioned)
2. UNDERSTAND IMPLIED information from vague statements
3. RECOGNIZE context clues that indicate existence vs. quantity

CRITICAL EXTRACTION RULES:

1. LOCATION EXTRACTION - MUST BE EXACT (HIGHEST PRIORITY):
   - "Greenville, South Carolina" → "Greenville, South Carolina" (EXACT match)
   - "Dallas, TX" → "Dallas, TX" (EXACT match)
   - "in Greenville" + previous context "Greenville, SC" → use context location
   - NEVER change state/province - if text says "South Carolina", return "South Carolina" (NOT "TX")
   - Scan for: "in [city]", "for [city]", "[city], [state/province]", "[city], [ST]"

2. NUMERIC EXTRACTION - BE SMART ABOUT FORMATS:
   - "$20/day", "$20 a day", "about $20", "spending $20" → 20 (extract number, ignore "about")
   - "three creatives", "3 creatives", "have 3 running" → 3 (handle word numbers)
   - "25%", "25 percent" → 25 (remove % sign)
   - Handle: "approximately", "around", "about", "roughly"

3. SERVICES - EXTRACT EXACTLY AS WRITTEN:
   - "TV mounting and camera mounting jobs" → ["TV mounting", "camera mounting"]
   - "for TV mounting" → ["TV mounting"]
   - Look for: "jobs", "services", "offering", "doing", "installing", "work"

4. VAGUE STATEMENTS - UNDERSTAND CONTEXT:
   - "we have technicians on standby" → techs: null (technicians EXIST but quantity unknown)
   - "techs available" → techs: null (team exists, no number)
   - "have technicians" → techs: null (team exists, no number)
   - "looking to acquire the first customers" → early stage (rates unknown, return null)
   - "getting started" → most operational metrics null (just starting out)
   - "ready to scale" → infrastructure exists, metrics unknown

5. CONTEXT CLUES - RECOGNIZE THESE PATTERNS:
   - Team existence: "on standby", "available", "have [type]", "we have" = exists but number unknown → null
   - Early stage: "first customers", "getting started", "looking to acquire" = operational metrics null
   - Active operations: "running", "doing", "handling" = extract numbers if stated

6. EXTRACTION LOGIC:
   - If explicit number stated → extract it
   - If vague mention ("technicians on standby") → return null (exists but quantity unknown)
   - If metric not mentioned at all → return null
   - NEVER guess numbers - if quantity unknown, return null
   - NEVER return 0, empty string, or defaults`;
          
          let userPrompt = `Analyze this business scenario and extract metrics intelligently. Understand both EXPLICIT values and IMPLIED context.

INPUT TEXT TO ANALYZE:
"${forecastText}"

${forecastContext.location ? `\n📍 LOCATION CONTEXT: Previously mentioned "${forecastContext.location}". If current text says "${forecastContext.location.split(',')[0]}" without state, use "${forecastContext.location}".` : ''}

${forecastContext.previousInputs ? `\n📋 PREVIOUS CONTEXT:\n${forecastContext.previousInputs.substring(0, 300)}` : ''}

ANALYSIS EXAMPLES - Understand the intelligence level needed:

Example 1: "spending about $20 a day on ads in Greenville, South Carolina"
→ dailyAdSpend: 20, market: "Greenville, South Carolina"
(Extracts number despite "about", location exactly as stated)

Example 2: "have three creatives running for TV mounting and camera mounting jobs"
→ creatives: 3, services: ["TV mounting", "camera mounting"]
(Extracts number and all services mentioned)

Example 3: "we have 2 techs available"
→ techs: 2
(Explicit number stated)

Example 4: "we have technicians on standby"
→ techs: null
(Understands: technicians EXIST but quantity is NOT stated. This is vague - team exists but number unknown, so return null for the number field)

Example 5: "looking to acquire the first customers"
→ leadToBookingRate: null, bookingToCompletedRate: null
(Understands: early stage business, no operational data yet)

YOUR TASK - Analyze the INPUT TEXT above:
1. ✅ Find explicit numbers ("$20", "three", "3") and extract them
2. ✅ Find location ("Greenville, South Carolina") and extract EXACTLY as written
3. ✅ Find services ("TV mounting", "camera mounting") and extract as array
4. 🧠 Understand vague statements:
   - "technicians on standby" = team exists, number unknown → techs: null
   - "looking to acquire customers" = early stage → rates: null
   - "have [type]" without number = exists but quantity unknown → return null

Return ONLY valid JSON (no markdown, no code blocks):

{
  "dailyAdSpend": number or null,
  "services": array of strings or [],
  "market": string with EXACT location ("City, State") or null,
  "techs": number or null (null if vague like "on standby" without number),
  "jobsPerTechPerDay": number or null,
  "aov": number or null,
  "cpc": number or null,
  "leadToBookingRate": number or null,
  "bookingToCompletedRate": number or null,
  "cities": number or null,
  "creatives": number or null
}

CHECKLIST:
✓ Location EXACT (including state - don't change "South Carolina" to anything else)
✓ Numbers extracted (handle "about", "around", word numbers)
✓ Services exact phrases from text
✓ Vague statements ("on standby") = null (team exists, quantity unknown)
✓ Early stage mentions = null for operational rates`;

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" },
            temperature: 0.0  // Zero temperature for maximum precision and consistency
          });

          const content = completion.choices[0].message.content;
          if (!content) {
            throw new Error('Empty response from OpenAI');
          }

          const extracted = JSON.parse(content);
          
          // REBUILT: Strict validation with location verification
          const normalizeNumber = (val: any): number | null => {
            if (val === null || val === undefined || val === '') return null;
            const num = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : parseFloat(val);
            return isNaN(num) ? null : num;
          };
          
          const normalizeInteger = (val: any): number | null => {
            if (val === null || val === undefined || val === '') return null;
            const num = typeof val === 'string' ? parseInt(val.replace(/[^0-9-]/g, ''), 10) : parseInt(val, 10);
            return isNaN(num) ? null : num;
          };
          
          // CRITICAL: Verify location matches what was mentioned in the text
          let verifiedMarket = null;
          if (extracted.market && typeof extracted.market === 'string') {
            const marketStr = extracted.market.trim();
            const lowerText = forecastText.toLowerCase();
            const lowerMarket = marketStr.toLowerCase();
            
            // Check if the extracted location actually appears in the input text
            const cityMatch = marketStr.split(',')[0].toLowerCase();
            const stateMatch = marketStr.split(',')[1]?.trim().toLowerCase();
            
            // Verify the state/province mentioned in text matches what was extracted
            if (stateMatch) {
              // Check if the state appears in the text
              const stateInText = lowerText.includes(stateMatch) || 
                                 lowerText.includes(stateMatch.substring(0, 2)); // Check abbreviation
              
              if (stateInText || forecastContext.location?.toLowerCase() === lowerMarket) {
                verifiedMarket = marketStr;
              } else {
                // State doesn't match - check if we have context
                if (forecastContext.location && cityMatch === forecastContext.location.split(',')[0].toLowerCase()) {
                  verifiedMarket = forecastContext.location; // Use context location
                  console.warn(`Location mismatch: extracted "${marketStr}" but using context "${forecastContext.location}"`);
                } else {
                  // Try to find the actual location mentioned in text
                  const locationPatterns = [
                    new RegExp(`(${cityMatch}[^,]*,\\s*[A-Z][a-zA-Z]+)`, 'i'),
                    new RegExp(`(${cityMatch}[^,]*,\\s*[A-Z]{2})`, 'i')
                  ];
                  
                  for (const pattern of locationPatterns) {
                    const match = forecastText.match(pattern);
                    if (match) {
                      verifiedMarket = match[1].trim();
                      console.warn(`Corrected location from "${marketStr}" to "${verifiedMarket}" based on text`);
                      break;
                    }
                  }
                  
                  if (!verifiedMarket) {
                    verifiedMarket = marketStr; // Fallback to extracted (but log warning)
                    console.warn(`Could not verify location "${marketStr}" in text`);
                  }
                }
              }
            } else {
              verifiedMarket = marketStr; // No state, use as-is
            }
          }
          
          const normalized = {
            dailyAdSpend: normalizeNumber(extracted.dailyAdSpend),
            services: Array.isArray(extracted.services) 
              ? extracted.services
                  .filter((s: any) => s && typeof s === 'string' && s.trim().length > 0)
                  .map((s: string) => s.trim())
              : [],
            market: verifiedMarket,
            techs: normalizeInteger(extracted.techs),
            jobsPerTechPerDay: normalizeNumber(extracted.jobsPerTechPerDay),
            aov: normalizeNumber(extracted.aov),
            cpc: normalizeNumber(extracted.cpc),
            leadToBookingRate: normalizeNumber(extracted.leadToBookingRate),
            bookingToCompletedRate: normalizeNumber(extracted.bookingToCompletedRate),
            cities: normalizeInteger(extracted.cities),
            creatives: normalizeInteger(extracted.creatives)
          };
          
          // Validate percentages are in valid range
          if (normalized.leadToBookingRate !== null && (normalized.leadToBookingRate < 0 || normalized.leadToBookingRate > 100)) {
            normalized.leadToBookingRate = Math.max(0, Math.min(100, normalized.leadToBookingRate));
          }
          if (normalized.bookingToCompletedRate !== null && (normalized.bookingToCompletedRate < 0 || normalized.bookingToCompletedRate > 100)) {
            normalized.bookingToCompletedRate = Math.max(0, Math.min(100, normalized.bookingToCompletedRate));
          }
          
          // Log extraction for debugging
          console.log('[parseForecast] Extraction result:', {
            input: forecastText.substring(0, 100),
            extractedMarket: extracted.market,
            verifiedMarket: normalized.market,
            contextLocation: forecastContext.location
          });

          result = { extracted: normalized };
        } catch (error: any) {
          console.error('parseForecast error:', error);
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to parse forecast: ${error.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'addTask':
        // Validation
        if (!body.title || !body.title.trim()) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Task title is required' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Handle due date - support both date string and ISO datetime
        let dueDateValue = null;
        if (body.dueDate) {
          try {
            // If it's already an ISO string with time, use it directly
            if (body.dueDate.includes('T')) {
              dueDateValue = new Date(body.dueDate).toISOString();
            } else {
              // If it's just a date, combine with time if provided
              if (body.dueTime) {
                dueDateValue = new Date(`${body.dueDate}T${body.dueTime}:00`).toISOString();
              } else {
                // Just date, set to end of day
                dueDateValue = new Date(`${body.dueDate}T23:59:59`).toISOString();
              }
            }
          } catch (e) {
            return NextResponse.json({ 
              ok: false, 
              error: 'Invalid date format' 
            }, { status: 400, headers: corsHeaders(request) });
          }
        }
        
        // Generate Task_ID
        const taskId = crypto.randomUUID();
        const nowUpdate = new Date().toISOString();
        
        // Insert task
        const insertPayload: any = {
          Task_ID: taskId,
          Title: body.title.trim(),
          Description: body.description || null,
          Assets: normalizeAssets(body.assets),
          Priority: body.priority || 'MEDIUM',
          Due_Date: dueDateValue,
          Status: 'PENDING',
          Category: body.category || null,
          Assigned_To: body.assignedTo || null,
          Type: body.type || null,
          URL: body.url || null,
          Content: body.content || null,
          Recurrence: body.recurrence || null,
          Retention_Days: body.retentionDays ?? null,
          Creator_Mode: body.creatorMode || 'QUICK',
          Raw_Input_Text: body.rawInputText ?? null,
          Outcome_Text: body.outcomeText ?? null,
          Context_Text: body.contextText ?? null,
          Constraints_Text: body.constraintsText ?? null,
          Created_At: nowUpdate,
          Updated_At: nowUpdate
        };

        const { data: newTask, error: taskError } = await tasksDb
          .from('Tasks')
          .insert(insertPayload)
          .select()
          .single();
        
        if (taskError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to create task: ${taskError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = newTask;
        break;

      case 'updateTask':
        {
          const taskId = normalizeText(body?.taskId);
          if (!taskId) {
            return NextResponse.json(
              { ok: false, error: 'taskId is required' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const nowUpdate = new Date().toISOString();
          const updatePayload: any = {
            Updated_At: nowUpdate
          };

          if (body?.title !== undefined) {
            const title = normalizeText(body?.title);
            if (!title) {
              return NextResponse.json(
                { ok: false, error: 'Task title is required' },
                { status: 400, headers: corsHeaders(request) }
              );
            }
            updatePayload.Title = title;
          }

          if (body?.description !== undefined) updatePayload.Description = normalizeText(body?.description) || null;
          if (body?.assets !== undefined) updatePayload.Assets = normalizeAssets(body?.assets);
          if (body?.priority !== undefined) updatePayload.Priority = normalizeText(body?.priority) || null;
          if (body?.category !== undefined) updatePayload.Category = normalizeText(body?.category) || null;
          if (body?.assignedTo !== undefined) updatePayload.Assigned_To = normalizeText(body?.assignedTo) || null;
          if (body?.type !== undefined) updatePayload.Type = normalizeText(body?.type) || null;
          if (body?.url !== undefined) updatePayload.URL = normalizeText(body?.url) || null;
          if (body?.content !== undefined) updatePayload.Content = normalizeText(body?.content) || null;
          if (body?.recurrence !== undefined) updatePayload.Recurrence = normalizeText(body?.recurrence) || null;
          if (body?.retentionDays !== undefined) {
            const rd = Number(body?.retentionDays);
            updatePayload.Retention_Days = Number.isFinite(rd) ? rd : null;
          }

          // Built-mode text fields (optional)
          if (body?.rawInputText !== undefined) updatePayload.Raw_Input_Text = normalizeText(body?.rawInputText) || null;
          if (body?.outcomeText !== undefined) updatePayload.Outcome_Text = normalizeText(body?.outcomeText) || null;
          if (body?.contextText !== undefined) updatePayload.Context_Text = normalizeText(body?.contextText) || null;
          if (body?.constraintsText !== undefined) updatePayload.Constraints_Text = normalizeText(body?.constraintsText) || null;

          // Due date/time support
          if (body?.dueDate !== undefined || body?.dueTime !== undefined) {
            let dueDateValue = null;
            const dueDate = normalizeText(body?.dueDate);
            const dueTime = normalizeText(body?.dueTime);

            if (!dueDate) {
              dueDateValue = null;
            } else {
              try {
                if (String(dueDate).includes('T')) {
                  dueDateValue = new Date(dueDate).toISOString();
                } else if (dueTime) {
                  dueDateValue = new Date(`${dueDate}T${dueTime}:00`).toISOString();
                } else {
                  dueDateValue = new Date(`${dueDate}T23:59:59`).toISOString();
                }
              } catch {
                return NextResponse.json(
                  { ok: false, error: 'Invalid date format' },
                  { status: 400, headers: corsHeaders(request) }
                );
              }
            }

            updatePayload.Due_Date = dueDateValue;
          }

          if (body?.status !== undefined) {
            const status = normalizeText(body?.status);
            updatePayload.Status = status || null;
            updatePayload.Completed_At = status === 'COMPLETED' ? nowUpdate : null;
          }

          const { data: updatedTask, error: updateError } = await tasksDb
            .from('Tasks')
            .update(updatePayload)
            .eq('Task_ID', taskId)
            .select('*')
            .single();

          if (updateError) {
            return NextResponse.json(
              { ok: false, error: `Failed to update task: ${updateError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = updatedTask;
        }
        break;

      case 'deleteTask':
        {
          const taskId = normalizeText(body?.taskId);
          if (!taskId) {
            return NextResponse.json(
              { ok: false, error: 'taskId is required' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const { data: deletedTask, error: deleteError } = await tasksDb
            .from('Tasks')
            .delete()
            .eq('Task_ID', taskId)
            .select('*')
            .single();

          if (deleteError) {
            return NextResponse.json(
              { ok: false, error: `Failed to delete task: ${deleteError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = deletedTask;
        }
        break;
      
      case 'completeTraining':
        // Validation
        if (!body.resourceId || !body.completedBy || !body.notesLearned) {
          const missing = [];
          if (!body.resourceId) missing.push('resourceId');
          if (!body.completedBy) missing.push('completedBy');
          if (!body.notesLearned) missing.push('notesLearned');
          
          return NextResponse.json({ 
            ok: false, 
            error: `Missing required fields: ${missing.join(', ')}` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate rating if provided
        if (body.comprehensionRating !== undefined && (body.comprehensionRating < 1 || body.comprehensionRating > 5)) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid comprehension rating: must be between 1 and 5` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Verify resource exists
        const { data: trainingResource, error: resourceError } = await supabaseMgmt
          .from('Training_Resources')
          .select('*')
          .eq('Resource_ID', body.resourceId)
          .single();
        
        if (resourceError || !trainingResource) {
          return NextResponse.json({ 
            ok: false, 
            error: `Training resource not found: ${body.resourceId}` 
          }, { status: 404, headers: corsHeaders(request) });
        }
        
        // AI Analysis of learnings
        let aiAnalysis = null;
        if (openai && body.notesLearned) {
          try {
            const analysisPrompt = `
You are an expert training analyst. A VA just completed a training video and wrote notes about what they learned.

TRAINING: ${trainingResource?.Title || 'Unknown'}
CATEGORY: ${trainingResource?.Category || 'General'}
SKILLS TAUGHT: ${trainingResource?.Skills_Taught || 'Not specified'}

VA'S LEARNING NOTES:
${body.notesLearned}

Provide a JSON response with:
1. "extractedConcepts": Array of key concepts the VA successfully learned (each as object: {"skill": "concept name", "pillar": "category"})
2. "knowledgeGaps": Array of topics they might still be weak on or didn't mention (each as object: {"skill": "gap name", "pillar": "category"})
3. "confidenceScore": 0-100 assessment of their mastery based on their notes
4. "recommendations": Array of suggested next steps with:
   - "type": "practice" or "learn"
   - "title": Brief recommendation title
   - "description": What they should do
   - "deliverable": Specific output expected (e.g., "Create a workflow diagram", "Draft a 1-page SOP")
   - "reason": Why this recommendation matters

Format: JSON only, no markdown.
`;

            const completion = await openai.chat.completions.create({
              messages: [
                { role: "system", content: "You are a training effectiveness analyst. Always respond with valid JSON." },
                { role: "user", content: analysisPrompt }
              ],
              model: "gpt-4o",
              response_format: { type: "json_object" }
            });
            
            try {
              aiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
            } catch (e) {
              aiAnalysis = { error: 'Failed to parse AI response' };
            }
          } catch (aiError: any) {
            // Don't block on AI failure
          }
        }
        
        // Generate Completion_ID
        const completionId = crypto.randomUUID();
        
        // Create completion record
        try {
          const { data: trainingCompletion, error: dbError } = await supabaseMgmt
            .from('Training_Completions')
            .insert({
              Completion_ID: completionId,
              Resource_ID: body.resourceId,
              Completed_By: body.completedBy,
              Notes_Learned: body.notesLearned,
              Comprehension_Rating: body.comprehensionRating || null,
              Time_Spent_Minutes: body.timeSpentMinutes || null,
              AI_Extracted_Concepts: aiAnalysis?.extractedConcepts ? JSON.stringify(aiAnalysis.extractedConcepts) : null,
              AI_Knowledge_Gaps: aiAnalysis?.knowledgeGaps ? JSON.stringify(aiAnalysis.knowledgeGaps) : null,
              AI_Confidence_Score: aiAnalysis?.confidenceScore || null,
              AI_Analysis_Raw: aiAnalysis ? JSON.stringify(aiAnalysis) : null
            })
            .select('*, resource:Training_Resources(*)')
            .single();
          
          if (dbError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Database error: ${dbError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          result = trainingCompletion;
          
          // Update VA Knowledge Profile (don't block on this)
          try {
            await updateVaKnowledgeProfile(body.completedBy, body.resourceId, aiAnalysis);
          } catch (profileError: any) {
            // Don't fail the request if profile update fails
          }
        } catch (insertError: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Insert failed: ${insertError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        break;

      case 'scheduleMeeting':
        // body: { candidateId, meetingType, scheduledAt, durationMinutes, notes, scheduledBy }
        const meetingData: any = {
          Candidate_ID: body.candidateId || null,
          Meeting_Type: body.meetingType,
          Scheduled_At: new Date(body.scheduledAt).toISOString(),
          Duration_Minutes: body.durationMinutes || 30,
          Scheduled_By: body.scheduledBy || 'ROSEL',
          Meeting_Notes: body.notes || null,
          Provider: body.provider || 'MANUAL',
          Status: 'SCHEDULED'
        };
        
        // If Calendly is configured, create event there
        if (body.provider === 'CALENDLY' && process.env.CALENDLY_API_KEY) {
          // TODO: Implement Calendly API integration
          // For now, just create a placeholder URL
          meetingData.Meeting_URL = `https://calendly.com/home2smart/interview-${Date.now()}`;
          meetingData.Join_URL = meetingData.Meeting_URL;
        }
        
        const { data: scheduledMeeting } = await getSupabase()
          .from('Meetings')
          .insert(meetingData)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = scheduledMeeting;
        
        // Update candidate's next action if meeting is for a candidate
        if (body.candidateId) {
          await getSupabase()
            .from('Candidate_Master')
            .update({
              Next_Action: `${body.meetingType} scheduled`,
              Next_Action_Date: new Date(body.scheduledAt).toISOString()
            })
            .eq('Candidate_ID', body.candidateId);
        }
        break;

      case 'completeMeeting':
        // body: { meetingId, outcome, outcomeNotes, updateCandidateStage }
        const { data: completedMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Status: 'COMPLETED',
            Outcome: body.outcome,
            Outcome_Notes: body.outcomeNotes,
            Completed_At: new Date().toISOString()
          })
          .eq('Meeting_ID', body.meetingId)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = completedMeeting;
        
        // Update candidate pipeline stage if requested
        if (body.updateCandidateStage && completedMeeting?.Candidate_ID) {
          await getSupabase()
            .from('Candidate_Master')
            .update({
              Current_Stage: body.updateCandidateStage,
              Interview_Outcome: body.outcome
            })
            .eq('Candidate_ID', completedMeeting.Candidate_ID);
        }
        break;

      case 'rescheduleMeeting':
        // body: { meetingId, newScheduledAt, reason }
        const { data: rescheduledMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Scheduled_At: new Date(body.newScheduledAt).toISOString(),
            Status: 'RESCHEDULED',
            Cancelled_Reason: body.reason
          })
          .eq('Meeting_ID', body.meetingId)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = rescheduledMeeting;
        break;

      case 'cancelMeeting':
        // body: { meetingId, reason }
        const { data: cancelledMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Status: 'CANCELLED',
            Cancelled_At: new Date().toISOString(),
            Cancelled_Reason: body.reason
          })
          .eq('Meeting_ID', body.meetingId)
          .select()
          .single();
        result = cancelledMeeting;
        break;

      case 'createTraining':
        // body: { title, type, url, description, category, skillsTaught, difficultyLevel, estimatedMinutes, createdBy }
        {
          const rawType = safeTrim(body.type || 'Video');
          const typeUpper = rawType.toUpperCase();
          const isVideo = typeUpper === 'VIDEO';

          const primaryUrl = normalizeHttpUrl(body.url) || safeTrim(body.url);
          if (!primaryUrl) {
            return NextResponse.json(
              { ok: false, error: 'url is required' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const assets = isVideo ? sanitizeTrainingAssets(body.assets ?? body.urls ?? body.url) : [];
          if (isVideo && (!assets || assets.length === 0)) {
            return NextResponse.json(
              { ok: false, error: 'VIDEO resources must be a valid YouTube or Loom link.' },
              { status: 400, headers: corsHeaders(request) }
            );
          }
          const assetsMetaIncoming = isVideo ? normalizeTrainingAssetsMeta(body.assetsMeta || body.assets_meta, assets) : null;
          const assetsMeta = isVideo
            ? (mergeTrainingAssetsMeta({ existing: null, incoming: assetsMetaIncoming, assets }) || {}) as any
            : null;

          // FETCH METADATA FOR ASSETS IF MISSING
          // ------------------------------------------------------------------
          await Promise.all((isVideo ? assets : []).map(async (assetUrl) => {
            const key = String(assetUrl || '').trim();
            // logic: if there is no entry, or the entry has no title, try to fetch it.
            if (!assetsMeta || !assetsMeta[key] || !assetsMeta[key].title) {
               try {
                 const meta = await getLinkTitleFromOEmbed(assetUrl);
                 if (meta) {
                   (assetsMeta as any)[key] = {
                     ...(((assetsMeta as any)[key]) || {}),
                     title: meta.title,
                     provider: meta.provider,
                     thumbnail: meta.thumbnailUrl, // note: standardized key 'thumbnail' typically used in frontend, or 'thumbnailUrl'
                     thumbnailUrl: meta.thumbnailUrl, // keeping both for safety
                     duration: meta.durationSeconds
                   };
                 }
               } catch (err) {
                 console.error(`Failed to fetch metadata for ${assetUrl}:`, err);
               }
            }
          }));
          // ------------------------------------------------------------------

          const generateDescription = (): string | null => {
            try {
              const list = Array.isArray(assets) ? assets.filter(Boolean) : [];
              if (!list.length) return null;

              const lines: string[] = [];
              if (list.length === 1) {
                lines.push('Video:');
              } else {
                lines.push(`Videos (${list.length}):`);
              }

              const slice = list.slice(0, 12);
              for (let i = 0; i < slice.length; i++) {
                const u = slice[i];
                const key = normalizeHttpUrl(u) || u;
                const m = assetsMeta && key ? (assetsMeta as any)[key] : null;
                const title = safeTrim(m && (m.title || m.Title) || '');
                const provider = safeTrim(m && (m.provider || m.Provider) || '');
                const label = [title, provider].filter(Boolean).join(' · ');
                lines.push(label ? `- ${label}` : `- Video ${i + 1}`);
              }

              return lines.join('\n');
            } catch {
              return null;
            }
          };

          const normalizedDescription = safeTrim(body.description || '');
          const derivedDescription = normalizedDescription
            ? normalizedDescription
            : (isVideo ? generateDescription() : null);

          const normalizedTitle = safeTrim(body.title || '');
          const derivedTitle = (() => {
            if (normalizedTitle) return normalizedTitle;

            if (!isVideo) {
              return typeUpper === 'PDF'
                ? 'Training PDF'
                : typeUpper === 'SOP'
                  ? 'Training SOP'
                  : 'Training Resource';
            }

            const primary = assets && assets.length ? String(assets[0] || '').trim() : '';
            const m = assetsMeta && primary ? (assetsMeta as any)[primary] : null;
            const t = safeTrim(m && (m.title || m.Title) || '');
            if (t) return t;
            const count = assets && assets.length ? assets.length : 1;
            return count > 1 ? `Training (${count} videos)` : 'Training Video';
          })();

          const insertPayload: any = {
            Resource_ID: crypto.randomUUID(),
            Title: derivedTitle,
            Type: typeUpper || 'VIDEO',
            URL: isVideo ? (assets.length ? assets[0] : primaryUrl) : primaryUrl,
            Description: derivedDescription || null,
            Category: body.category || 'General',
            Skills_Taught: body.skillsTaught || null,
            Difficulty_Level: body.difficultyLevel || 'BEGINNER',
            Estimated_Minutes: body.estimatedMinutes || null,
            Created_By: body.createdBy || 'ADMIN',
            Order: body.order || 0
          };

          if (isVideo && assets.length) {
            insertPayload.Assets = assets;
          }

          if (isVideo && assetsMeta && Object.keys(assetsMeta).length) insertPayload.Assets_Meta = assetsMeta;

          let newTraining: any = null;
          try {
            const { data } = await supabaseMgmt
              .from('Training_Resources')
              .insert(insertPayload)
              .select()
              .single();
            newTraining = data;
          } catch {
            // Fallback for older schemas without the Assets column.
            delete insertPayload.Assets;
            delete insertPayload.Assets_Meta;
            const { data } = await supabaseMgmt
              .from('Training_Resources')
              .insert(insertPayload)
              .select()
              .single();
            newTraining = data;
          }

          result = newTraining;
        }
        break;

      case 'updateTraining':
        // body: { resourceId, ...updates }
        {
        const updateData: any = {};
        if (body.title) updateData.Title = body.title;
        if (body.type) updateData.Type = body.type;
        if (body.url) updateData.URL = normalizeHttpUrl(body.url) || body.url;
        if (body.description !== undefined) updateData.Description = body.description;
        if (body.category) updateData.Category = body.category;
        if (body.skillsTaught !== undefined) updateData.Skills_Taught = body.skillsTaught;
        if (body.difficultyLevel) updateData.Difficulty_Level = body.difficultyLevel;
        if (body.estimatedMinutes !== undefined) updateData.Estimated_Minutes = body.estimatedMinutes;
        if (body.order !== undefined) updateData.Order = body.order;

        const rid = safeTrim(body?.resourceId);
        if (!rid) {
          return NextResponse.json(
            { ok: false, error: 'resourceId is required' },
            { status: 400, headers: corsHeaders(request) }
          );
        }

        // Fetch existing so we can merge metadata safely (never blank titles unless explicitly cleared).
        const { data: existingRow } = await supabaseMgmt
          .from('Training_Resources')
          .select('*')
          .eq('Resource_ID', rid)
          .single();

        const effectiveType = safeTrim(body?.type ?? existingRow?.Type ?? 'Video');
        const isVideo = effectiveType.toUpperCase() === 'VIDEO';

        // Non-video resources (PDF/SOP/etc) should not go through the video-only sanitizer.
        // Also clear any legacy Assets columns so we don't keep stale video parts.
        if (!isVideo) {
          updateData.Assets = null;
          updateData.Assets_Meta = null;
        }

        const existingAssets = sanitizeTrainingAssets(existingRow && (existingRow.Assets ?? existingRow.assets ?? existingRow.URL ?? existingRow.url));
        const existingMeta = normalizeTrainingAssetsMeta(
          existingRow && (existingRow.Assets_Meta ?? existingRow.assets_meta ?? existingRow.AssetsMeta ?? existingRow.assetsMeta),
          existingAssets
        );

        // If assets are being updated, sanitize to canonical supported-provider URLs.
        if (isVideo && (body.assets !== undefined || body.urls !== undefined || body.url !== undefined)) {
          const assets = sanitizeTrainingAssets(body.assets ?? body.urls ?? body.url);
          updateData.Assets = assets.length ? assets : null;
          if (assets.length) updateData.URL = assets[0];
        }

        if (isVideo && (body.assets !== undefined || body.urls !== undefined || body.url !== undefined || body.assetsMeta !== undefined || body.assets_meta !== undefined)) {
          const effectiveAssets = sanitizeTrainingAssets(
            (body.assets !== undefined || body.urls !== undefined || body.url !== undefined)
              ? (body.assets ?? body.urls ?? body.url)
              : existingAssets
          );

          const incomingMeta = normalizeTrainingAssetsMeta(body.assetsMeta || body.assets_meta, effectiveAssets);
          const mergedMeta = (mergeTrainingAssetsMeta({ existing: existingMeta, incoming: incomingMeta, assets: effectiveAssets }) || {}) as any;

          // AUTO-FILL METADATA FOR UPDATES (only fills missing titles; explicit titleCleared removes admin title and allows auto-title)
          if (effectiveAssets.length > 0) {
            await Promise.all(effectiveAssets.map(async (assetUrl) => {
              const key = String(assetUrl || '').trim();
              if (!mergedMeta || !mergedMeta[key] || !mergedMeta[key].title) {
                try {
                  const meta = await getLinkTitleFromOEmbed(assetUrl);
                  if (meta) {
                    const row: any = {
                      ...(mergedMeta && mergedMeta[key] ? mergedMeta[key] : {}),
                      title: meta.title,
                      provider: meta.provider,
                      thumbnail: meta.thumbnailUrl,
                      thumbnailUrl: meta.thumbnailUrl,
                      duration: meta.durationSeconds
                    };
                    mergedMeta[key] = row;
                  }
                } catch (err) {
                  console.error(`Failed to fetch metadata for ${assetUrl} in update:`, err);
                }
              }
            }));
          }

          updateData.Assets = effectiveAssets.length ? effectiveAssets : (updateData.Assets ?? null);
          updateData.Assets_Meta = Object.keys(mergedMeta).length ? mergedMeta : null;
        }

        let updatedTraining: any = null;
        try {
          const { data } = await supabaseMgmt
            .from('Training_Resources')
            .update(updateData)
            .eq('Resource_ID', rid)
            .select()
            .single();
          updatedTraining = data;
        } catch {
          // Fallback for older schemas without the Assets column.
          delete updateData.Assets;
          delete updateData.Assets_Meta;
          const { data } = await supabaseMgmt
            .from('Training_Resources')
            .update(updateData)
            .eq('Resource_ID', rid)
            .select()
            .single();
          updatedTraining = data;
        }

        result = updatedTraining;
        break;
        }

      case 'setTrainingAssetWatched':
        {
          const resourceId = safeTrim(body?.resourceId);
          const completedBy = safeTrim(body?.completedBy);
          const assetUrl = safeTrim(body?.assetUrl);
          const watched = body?.watched === false ? false : true;

          if (!resourceId || !completedBy || !assetUrl) {
            const missing: string[] = [];
            if (!resourceId) missing.push('resourceId');
            if (!completedBy) missing.push('completedBy');
            if (!assetUrl) missing.push('assetUrl');
            return NextResponse.json(
              { ok: false, error: `Missing required fields: ${missing.join(', ')}` },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const normalizedUrl = normalizeHttpUrl(assetUrl) || assetUrl;
          const videoId = stableVideoIdFromUrl(normalizedUrl);

          const row: any = {
            Progress_ID: crypto.randomUUID(),
            Resource_ID: resourceId,
            Completed_By: completedBy,
            Asset_URL: normalizedUrl,
            Video_ID: videoId,
            Watched: watched,
            Watched_At: new Date().toISOString()
          };

          // Prefer Video_ID-based upsert (migration 022). Fall back to legacy Asset_URL-based upsert.
          try {
            const { data: upserted, error } = await supabaseMgmt
              .from('Training_Asset_Progress')
              .upsert(row, { onConflict: 'Resource_ID,Completed_By,Video_ID' })
              .select('*')
              .single();

            if (!error) {
              result = upserted;
              break;
            }

            // If the unique constraint doesn't exist, fall back to insert.
            const msg = String(error.message || '').toLowerCase();
            const missingConstraint = msg.includes('no unique') && msg.includes('on conflict');
            if (missingConstraint) {
              try {
                const { data: inserted, error: insertError } = await supabaseMgmt
                  .from('Training_Asset_Progress')
                  .insert(row)
                  .select('*')
                  .single();
                if (!insertError) {
                  result = inserted;
                  break;
                }
              } catch {
                // fall through
              }
            }
          } catch {
            // fall through
          }

          try {
            const legacyRow: any = { ...row };
            delete legacyRow.Video_ID;
            const { data: upserted, error } = await supabaseMgmt
              .from('Training_Asset_Progress')
              .upsert(legacyRow, { onConflict: 'Resource_ID,Completed_By,Asset_URL' })
              .select('*')
              .single();

            if (error) {
              const msg = String(error.message || '').toLowerCase();
              const missingConstraint = msg.includes('no unique') && msg.includes('on conflict');
              if (missingConstraint) {
                try {
                  const { data: inserted, error: insertError } = await supabaseMgmt
                    .from('Training_Asset_Progress')
                    .insert(legacyRow)
                    .select('*')
                    .single();
                  if (!insertError) {
                    result = inserted;
                    break;
                  }
                } catch {
                  // fall through to error
                }
              }
              return NextResponse.json(
                { ok: false, error: `Failed to update progress: ${error.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }
            result = upserted;
          } catch (e: any) {
            const msg = e?.message ? String(e.message) : 'Failed to update progress';
            // Provide a helpful hint if the migration wasn't applied.
            const hint = msg.toLowerCase().includes('training_asset_progress') || msg.toLowerCase().includes('does not exist')
              ? 'DB table missing. Apply backend/migrations/019_training_asset_progress.sql to MGMT.'
              : undefined;
            return NextResponse.json(
              { ok: false, error: msg, hint },
              { status: 500, headers: corsHeaders(request) }
            );
          }
        }
        break;

      case 'setTrainingVideoProgress':
        {
          const resourceId = safeTrim(body?.resourceId);
          const completedBy = safeTrim(body?.completedBy);
          const assetUrl = safeTrim(body?.assetUrl || body?.url);

          const completionPercentRaw = body?.completionPercent ?? body?.completion_percent;
          const lastPosRaw = body?.lastPositionSeconds ?? body?.last_position_seconds;
          const markCompleted = body?.markCompleted === true;

          if (!resourceId || !completedBy || !assetUrl) {
            const missing: string[] = [];
            if (!resourceId) missing.push('resourceId');
            if (!completedBy) missing.push('completedBy');
            if (!assetUrl) missing.push('assetUrl');
            return NextResponse.json(
              { ok: false, error: `Missing required fields: ${missing.join(', ')}` },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const normalizedUrl = normalizeHttpUrl(assetUrl) || assetUrl;
          const videoId = safeTrim(body?.videoId || body?.video_id) || stableVideoIdFromUrl(normalizedUrl);
          const nowIso = new Date().toISOString();

          const clampPercent = (v: any): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            if (!Number.isFinite(n)) return null;
            return Math.max(0, Math.min(100, n));
          };

          const completionPercent = clampPercent(completionPercentRaw);
          const lastPositionSeconds = Number.isFinite(Number(lastPosRaw)) ? Math.max(0, Math.floor(Number(lastPosRaw))) : null;

          const isCompleted = markCompleted || (completionPercent !== null && completionPercent >= 95);
          const watched = isCompleted || (completionPercent !== null && completionPercent > 0);

          const baseRow: any = {
            Progress_ID: crypto.randomUUID(),
            Resource_ID: resourceId,
            Completed_By: completedBy,
            Asset_URL: normalizedUrl,
            Video_ID: videoId,
            Watched: watched,
            Watched_At: nowIso
          };

          const extendedRow: any = {
            ...baseRow,
            Completion_Percent: completionPercent,
            Last_Position_Seconds: lastPositionSeconds,
            Completed_At: isCompleted ? nowIso : null,
            Updated_At: nowIso
          };

          // Attempt full upsert (new schema). If columns/constraints are missing, retry legacy.
          try {
            const { data: upserted, error } = await supabaseMgmt
              .from('Training_Asset_Progress')
              .upsert(extendedRow, { onConflict: 'Resource_ID,Completed_By,Video_ID' })
              .select('*')
              .single();

            if (error) {
              const msg = String(error.message || 'Failed to update progress');
              const lower = msg.toLowerCase();
              const missingCols = lower.includes('completion_percent') || lower.includes('last_position_seconds') || lower.includes('updated_at') || lower.includes('completed_at') || lower.includes('video_id');

              const missingConstraint = lower.includes('no unique') && lower.includes('on conflict');
              if (missingConstraint) {
                try {
                  const { data: inserted, error: insertError } = await supabaseMgmt
                    .from('Training_Asset_Progress')
                    .insert(extendedRow)
                    .select('*')
                    .single();
                  if (!insertError) {
                    result = inserted;
                    break;
                  }
                } catch {
                  // fall through
                }
              }

              if (!missingCols) {
                return NextResponse.json(
                  { ok: false, error: `Failed to update progress: ${msg}` },
                  { status: 500, headers: corsHeaders(request) }
                );
              }
              // fall through to legacy retry
            } else {
              result = upserted;
              break;
            }
          } catch (e: any) {
            const msg = e?.message ? String(e.message) : 'Failed to update progress';
            const lower = msg.toLowerCase();
            const missingCols = lower.includes('completion_percent') || lower.includes('last_position_seconds') || lower.includes('updated_at') || lower.includes('completed_at') || lower.includes('video_id');

            const missingConstraint = lower.includes('no unique') && lower.includes('on conflict');
            if (missingConstraint) {
              try {
                const { data: inserted, error: insertError } = await supabaseMgmt
                  .from('Training_Asset_Progress')
                  .insert(extendedRow)
                  .select('*')
                  .single();
                if (!insertError) {
                  result = inserted;
                  break;
                }
              } catch {
                // fall through
              }
            }

            if (!missingCols) {
              return NextResponse.json(
                { ok: false, error: msg },
                { status: 500, headers: corsHeaders(request) }
              );
            }
            // else legacy retry
          }

          try {
            const legacyRow: any = { ...baseRow };
            delete legacyRow.Video_ID;
            const { data: upserted, error } = await supabaseMgmt
              .from('Training_Asset_Progress')
              .upsert(legacyRow, { onConflict: 'Resource_ID,Completed_By,Asset_URL' })
              .select('*')
              .single();

            if (error) {
              const msg = String(error.message || '').toLowerCase();
              const missingConstraint = msg.includes('no unique') && msg.includes('on conflict');
              if (missingConstraint) {
                try {
                  const { data: inserted, error: insertError } = await supabaseMgmt
                    .from('Training_Asset_Progress')
                    .insert(legacyRow)
                    .select('*')
                    .single();
                  if (!insertError) {
                    result = inserted;
                    break;
                  }
                } catch {
                  // fall through
                }
              }
              return NextResponse.json(
                { ok: false, error: `Failed to update progress: ${error.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }
            result = upserted;
          } catch (e: any) {
            const msg = e?.message ? String(e.message) : 'Failed to update progress';
            const hint = msg.toLowerCase().includes('training_asset_progress') || msg.toLowerCase().includes('does not exist')
              ? 'DB table missing. Apply backend/migrations/019_training_asset_progress.sql (and 021_training_asset_progress_video_fields.sql for resume/progress).' 
              : undefined;
            return NextResponse.json(
              { ok: false, error: msg, hint },
              { status: 500, headers: corsHeaders(request) }
            );
          }
        }
        break;

      case 'deleteTraining':
        // body: { resourceId }
        const { data: deletedTraining } = await supabaseMgmt
          .from('Training_Resources')
          .delete()
          .eq('Resource_ID', body.resourceId)
          .select()
          .single();
        result = deletedTraining;
        break;

      case 'getVaProfile':
        // body: { vaName }
        const { data: vaProfile } = await getSupabase()
          .from('VaKnowledgeProfile')
          .select('*')
          .eq('VA_Name', body.vaName || 'ROSEL')
          .single();
        result = vaProfile;
        break;

      case 'submitDeliverable':
        if (!body.title || !body.description || !body.submittedBy) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required fields: title, description, submittedBy' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // AI Analysis - Enhanced with document content extraction
        let deliverableAiAnalysis = null;
        if (openai && (body.description || body.fileLink)) {
          try {
            // Extract file information and prepare for analysis
            let fileContent = '';
            let fileTypes: string[] = [];
            let documentText = '';
            
            if (body.fileLink) {
              try {
                const files = JSON.parse(body.fileLink);
                if (Array.isArray(files)) {
                  fileTypes = files.map((f: any) => f.type || 'unknown');
                  // For PDFs and text files, we'll extract text using OpenAI vision API
                  // For now, note the file types for context
                  const pdfFiles = files.filter((f: any) => f.type === 'application/pdf' || f.name?.endsWith('.pdf'));
                  const textFiles = files.filter((f: any) => f.type?.startsWith('text/') || f.name?.match(/\.(txt|md|docx?)$/i));
                  
                  if (pdfFiles.length > 0 || textFiles.length > 0) {
                    documentText = `[${pdfFiles.length} PDF file(s) and ${textFiles.length} text file(s) attached. Content will be analyzed.]`;
                  }
                }
              } catch (e) {
                // Legacy format - single URL string
                if (typeof body.fileLink === 'string' && body.fileLink.includes('data:')) {
                  documentText = '[File attached - content will be analyzed]';
                }
              }
            }
            
            const analysisPrompt = `
You are an expert quality analyst and content strategist reviewing a work deliverable submission. Your job is to provide comprehensive, actionable analysis.

DELIVERABLE TITLE: ${body.title}
DESCRIPTION: ${body.description || 'No description provided'}
${documentText ? `ATTACHED FILES: ${documentText}` : ''}
${fileTypes.length > 0 ? `FILE TYPES: ${fileTypes.join(', ')}` : ''}

ANALYSIS REQUIREMENTS:
1. **Content Synopsis**: Provide a clear 3-4 sentence summary of what this deliverable contains and its purpose
2. **Key Information Extracted**: List the most important facts, data points, or insights from the content (5-7 bullet points)
3. **Quality Assessment**: Evaluate completeness, clarity, professionalism, and readiness
4. **Actionable Insights**: What can be done with this deliverable? What decisions can be made?
5. **Gaps & Missing Elements**: What's incomplete or could be strengthened?
6. **Recommendations**: Specific next steps or improvements

For Offer Briefs specifically, check for:
- All 9 sections present and complete
- Unit economics calculations
- Clear value proposition
- Competitive positioning
- Operational readiness

Respond with valid JSON in this exact format:
{
  "synopsis": "2-3 sentence overview of what this deliverable is and contains",
  "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  "qualityScore": 85,
  "strengths": ["Strength 1", "Strength 2", "Strength 3"],
  "improvements": ["Improvement 1", "Improvement 2", "Improvement 3"],
  "actionableInsights": ["Insight 1", "Insight 2"],
  "missingElements": ["Missing element 1", "Missing element 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "summary": "Brief executive summary (2-3 sentences) of overall assessment",
  "documentType": "Detected type (Offer Brief, Content Piece, SOP, etc.)",
  "readinessLevel": "ready|needs_revision|incomplete"
}

Be thorough, specific, and constructive. Focus on what makes this deliverable valuable and what needs work.
`;
            
            // Use vision API if PDFs are attached, otherwise standard chat
            const messages: any[] = [
              { 
                role: "system", 
                content: "You are a professional quality analyst and content strategist. You analyze deliverables for completeness, quality, and actionable value. Always respond with valid JSON." 
              },
              { 
                role: "user", 
                content: analysisPrompt 
              }
            ];
            
            // If PDFs are attached, try to extract text using vision API
            // Note: OpenAI vision API works with images, so we'd need to convert PDF pages to images first
            // For now, we'll enhance the prompt to work with the description and file metadata
            
            const completion = await openai.chat.completions.create({
              messages,
              model: "gpt-4o",
              response_format: { type: "json_object" },
              temperature: 0.3,
              max_tokens: 2000
            });
            
            try {
              deliverableAiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
              
              // Ensure all fields exist with defaults
              deliverableAiAnalysis = {
                synopsis: deliverableAiAnalysis.synopsis || deliverableAiAnalysis.summary || 'No synopsis available',
                keyPoints: deliverableAiAnalysis.keyPoints || [],
                qualityScore: deliverableAiAnalysis.qualityScore || deliverableAiAnalysis.quality_score || 50,
                strengths: deliverableAiAnalysis.strengths || [],
                improvements: deliverableAiAnalysis.improvements || [],
                actionableInsights: deliverableAiAnalysis.actionableInsights || deliverableAiAnalysis.actionable_insights || [],
                missingElements: deliverableAiAnalysis.missingElements || deliverableAiAnalysis.missing_elements || [],
                recommendations: deliverableAiAnalysis.recommendations || [],
                summary: deliverableAiAnalysis.summary || deliverableAiAnalysis.synopsis || 'Analysis complete',
                documentType: deliverableAiAnalysis.documentType || deliverableAiAnalysis.document_type || 'General Deliverable',
                readinessLevel: deliverableAiAnalysis.readinessLevel || deliverableAiAnalysis.readiness_level || 'needs_revision'
              };
            } catch (e) {
              deliverableAiAnalysis = { 
                error: 'Failed to parse AI response',
                summary: 'AI analysis completed but response format was invalid'
              };
            }
          } catch (aiError: any) {
            console.error('AI analysis error:', aiError);
            // Don't block on AI failure - deliverable can still be submitted
            deliverableAiAnalysis = {
              error: aiError.message || 'AI analysis failed',
              summary: 'AI analysis could not be completed, but deliverable was submitted successfully'
            };
          }
        }
        
        const deliverableId = crypto.randomUUID();

        const wantsTaskLink = Boolean(body.taskId || body.taskTitle || body.taskUrl);
        if (wantsTaskLink) {
          extraPayload.taskLinkagePersisted = true;
        }

        const insertRow: any = {
          Deliverable_ID: deliverableId,
          Title: body.title,
          Description: body.description,
          File_Link: body.fileLink || null,
          Submitted_By: body.submittedBy,
          Status: 'PENDING',
          AI_Quality_Score: deliverableAiAnalysis?.qualityScore || null,
          AI_Strengths: deliverableAiAnalysis?.strengths ? JSON.stringify(deliverableAiAnalysis.strengths) : null,
          AI_Improvements: deliverableAiAnalysis?.improvements ? JSON.stringify(deliverableAiAnalysis.improvements) : null,
          AI_Summary: deliverableAiAnalysis?.summary || deliverableAiAnalysis?.synopsis || null,
          AI_Analysis_Raw: deliverableAiAnalysis ? JSON.stringify(deliverableAiAnalysis) : null,
        };

        // Optional first-class linking (safe if columns exist).
        // - Offer_ID: indexed offer-scoped browsing
        // - Deliverable_Type: lightweight categorization
        const directOfferId = safeTrim(body.offerId || body.offer_id || body.Offer_ID || '');
        if (directOfferId && isUuid(directOfferId)) {
          insertRow.Offer_ID = directOfferId;
        }
        const directDeliverableType = safeTrim(body.deliverableType || body.deliverable_type || body.type || '');
        if (directDeliverableType) {
          insertRow.Deliverable_Type = directDeliverableType.toLowerCase();
        }

        // Optional metadata for UI/workflow filtering (safe if column exists).
        if (body.metadata !== undefined && body.metadata !== null) {
          try {
            const mdObj = typeof body.metadata === 'string' ? JSON.parse(String(body.metadata || '').trim() || '{}') : body.metadata;
            insertRow.Metadata = typeof body.metadata === 'string' ? body.metadata : JSON.stringify(body.metadata);

            // Derive first-class linkage from metadata when present.
            if (!insertRow.Offer_ID) {
              const mdOfferId = safeTrim(mdObj?.offerId || mdObj?.offer_id || mdObj?.Offer_ID || mdObj?.offerID || '');
              if (mdOfferId && isUuid(mdOfferId)) insertRow.Offer_ID = mdOfferId;
            }
            if (!insertRow.Deliverable_Type) {
              const mdType = safeTrim(mdObj?.type || mdObj?.deliverableType || mdObj?.kind || '');
              if (mdType) insertRow.Deliverable_Type = mdType.toLowerCase();
            }
          } catch {
            // Ignore serialization errors; keep submission working.
          }
        }

        if (body.taskId) insertRow.Task_ID = body.taskId;
        if (body.taskTitle) insertRow.Task_Title = body.taskTitle;
        if (body.taskUrl) insertRow.Task_URL = body.taskUrl;

        let { data: newDeliverable, error: deliverableError } = await getDeliverablesDb()
          .from('Deliverables')
          .insert(insertRow)
          .select()
          .single();

        // Safe fallback if MGMT DB hasn't had the new columns added yet.
        if (
          deliverableError &&
          (isMissingDeliverablesColumnError(deliverableError, 'Task_ID') ||
            isMissingDeliverablesColumnError(deliverableError, 'Task_Title') ||
            isMissingDeliverablesColumnError(deliverableError, 'Task_URL') ||
            isMissingDeliverablesColumnError(deliverableError, 'Metadata') ||
            isMissingDeliverablesColumnError(deliverableError, 'Offer_ID') ||
            isMissingDeliverablesColumnError(deliverableError, 'Deliverable_Type'))
        ) {
          if (wantsTaskLink) {
            extraPayload.taskLinkagePersisted = false;
            extraPayload.taskLinkageWarning = 'Deliverables DB is missing Task_* columns; apply migration 005_alter_deliverables_add_task_ref.sql to persist task linkage.';
          }
          delete insertRow.Task_ID;
          delete insertRow.Task_Title;
          delete insertRow.Task_URL;
          delete insertRow.Metadata;
          delete insertRow.Offer_ID;
          delete insertRow.Deliverable_Type;
          const retry = await getDeliverablesDb().from('Deliverables').insert(insertRow).select().single();
          newDeliverable = retry.data;
          deliverableError = retry.error;
        }
        
        if (deliverableError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${deliverableError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = newDeliverable;
        break;

      case 'deliverables':
        const statusFilter = searchParams.get('status') || 'all';
        let deliverablesQuery = getDeliverablesDb()
          .from('Deliverables')
          .select('*')
          .order('Created_At', { ascending: false });
        
        if (statusFilter !== 'all') {
          deliverablesQuery = deliverablesQuery.eq('Status', statusFilter.toUpperCase());
        }
        
        const { data: deliverables, error: deliverablesError } = await deliverablesQuery;
        
        if (deliverablesError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load deliverables: ${deliverablesError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = deliverables || [];
        break;

      case 'approveDeliverable':
      case 'rejectDeliverable':
        if (!body.deliverableId || !body.reviewedBy) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required fields: deliverableId, reviewedBy' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        const newStatus = action === 'approveDeliverable' ? 'APPROVED' : 'REJECTED';
        const deliverableUpdateData: any = {
          Status: newStatus,
          Reviewed_By: body.reviewedBy,
          Reviewed_At: new Date().toISOString()
        };
        
        if (body.reviewNotes) {
          deliverableUpdateData.Review_Notes = body.reviewNotes;
        }
        
        const { data: updatedDeliverable, error: updateError } = await getDeliverablesDb()
          .from('Deliverables')
          .update(deliverableUpdateData)
          .eq('Deliverable_ID', body.deliverableId)
          .select()
          .single();
        
        if (updateError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${updateError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = updatedDeliverable;
        break;

      case 'publishDeliverable':
        if (!body.deliverableId) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required field: deliverableId' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        const { data: publishedDeliverable, error: publishError } = await getDeliverablesDb()
          .from('Deliverables')
          .update({
            Status: 'PUBLISHED',
            Published_At: new Date().toISOString()
          })
          .eq('Deliverable_ID', body.deliverableId)
          .select()
          .single();
        
        if (publishError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${publishError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = publishedDeliverable;
        break;

      case 'saveOffer':
        // Save or update an offer
        if (!body.offerData) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Offer data required' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const offerDataRaw = body.offerData;
        const offerData = normalizeOfferBuilderSnapshotForTotals(offerDataRaw, {
          packagePrice: firstPositiveNumber(
            (offerDataRaw as any)?.totals?.customerPrice,
            (offerDataRaw as any)?.totals?.finalCustomerPrice,
            (offerDataRaw as any)?.economics?.totals?.customerPrice,
            (offerDataRaw as any)?.bundlePrice
          )
        });

        // Backend guardrail: never persist an offer snapshot with empty lineItems.
        // (Frontend should already block this, but this prevents other callers/scripts from polluting MGMT Offers.)
        const normalizedLineItems = Array.isArray((offerData as any)?.lineItems) ? (offerData as any).lineItems : [];
        if (!normalizedLineItems.length) {
          return NextResponse.json(
            { ok: false, error: 'Offer must include at least one line item (service) before saving.' },
            { status: 400, headers: corsHeaders(request) }
          );
        }

        const offerIdSave = offerData.offer_id || crypto.randomUUID();
        const nowOffer = new Date().toISOString();
        const createdBy = body.createdBy || offerData.created_by || 'UNKNOWN';

        const { primary: offersPrimaryDb, fallback: offersFallbackDb } = getOffersDbFallback();

        const checkExisting = async (db: any) => {
          return await db
            .from('Offers')
            .select('Offer_ID, Created_At, Created_By')
            .eq('Offer_ID', offerIdSave)
            .maybeSingle();
        };

        // Check if offer exists (with DB fallback)
        let { data: existingOffer, error: existingErr } = await checkExisting(offersPrimaryDb);
        if (existingErr && isOffersSchemaMismatchError(existingErr)) {
          ({ data: existingOffer, error: existingErr } = await checkExisting(offersFallbackDb));
        }
        if (existingErr) {
          return NextResponse.json({ ok: false, error: `Failed to check offer: ${existingErr.message}` }, { status: 500, headers: corsHeaders(request) });
        }

        // Guardrail: never overwrite a non-empty stored offerDescription with an empty incoming one.
        try {
          const incomingDesc = safeTrim((offerData as any)?.offerDescription ?? (offerData as any)?.offer_description ?? '');
          const needsPreserve = !!existingOffer && !incomingDesc;
          if (needsPreserve) {
            const fetchExistingDesc = async (db: any) => {
              return await db
                .from('Offers')
                .select('Offer_ID, Message_Context')
                .eq('Offer_ID', offerIdSave)
                .single();
            };

            let fullRow: any = null;
            let fullErr: any = null;
            ({ data: fullRow, error: fullErr } = await fetchExistingDesc(offersPrimaryDb));
            if (fullErr && isOffersSchemaMismatchError(fullErr)) {
              ({ data: fullRow, error: fullErr } = await fetchExistingDesc(offersFallbackDb));
            }

            if (!fullErr && fullRow) {
              let ctx: any = (fullRow as any).Message_Context;
              try {
                if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
              } catch {
                ctx = {};
              }
              if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

              let existingOb: any = ctx.offer_builder || ctx.offerBuilder || null;
              try {
                if (typeof existingOb === 'string') existingOb = JSON.parse(existingOb || '{}');
              } catch {
                // ignore
              }
              if (!existingOb || typeof existingOb !== 'object' || Array.isArray(existingOb)) existingOb = {};

              const preserved = safeTrim(existingOb.offerDescription ?? existingOb.offer_description ?? existingOb.description ?? '');
              if (preserved) {
                (offerData as any).offerDescription = preserved;
              }
            }
          }
        } catch {
          // best-effort only
        }

        // Persist a reusable offer snapshot for the Offer Builder UI.
        const baseMessageContextRaw = offerData.messageContext || offerData.message_context || {};
        const baseMessageContext =
          baseMessageContextRaw && typeof baseMessageContextRaw === 'object' && !Array.isArray(baseMessageContextRaw)
            ? baseMessageContextRaw
            : {};

        const persistedOfferName = String(body.offerName || offerData.name || '').trim();
        const nextMessageContext = {
          ...baseMessageContext,
          ...(persistedOfferName ? { offerName: persistedOfferName } : {}),
          offer_builder: offerData
        };

        const hasOwn = (obj: any, key: string) => {
          try { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); } catch { return false; }
        };

        // IMPORTANT: The Offer Builder UI keeps a local `offerFrameworks` field for rendering,
        // but that must NOT be treated as explicitly-provided AI analysis (or we'd wipe
        // server-side AI_Analysis during normal saves).
        const aiAnalysisProvided =
          hasOwn(offerData, 'ai_analysis') ||
          hasOwn(offerData, 'AI_Analysis') ||
          hasOwn(offerData, 'offer_frameworks');

        const performanceProvided =
          hasOwn(offerData, 'performance_data') ||
          hasOwn(offerData, 'Performance_Data');

        // Prepare offer record
        const offerRecord: any = {
          Offer_ID: offerIdSave,
          Created_By: createdBy,
          Created_At: offerData.created_at || nowOffer,
          Updated_At: nowOffer,
          SKU_ID: offerData.sku_id || null,
          Status: offerData.status || 'DRAFT',
          Guardrail_Status: offerData.guardrail_status || null,
          Profit_Per_Job: offerData.profit_per_job || null,
          Margin_Pct: offerData.margin_pct || null,
          Message_Context: nextMessageContext,
          Economics: offerData.economics || {},
          // IMPORTANT: do not wipe AI_Analysis / Performance_Data unless the client explicitly provides it.
          ...(aiAnalysisProvided ? { AI_Analysis: (offerData.ai_analysis ?? offerData.AI_Analysis ?? null) } : {}),
          ...(performanceProvided ? { Performance_Data: (offerData.performance_data ?? offerData.Performance_Data ?? null) } : {})
        };

        let savedOffer;
        if (existingOffer) {
          // Update existing
          // Preserve immutable fields from the existing row.
          const offerUpdatePayload: any = { ...offerRecord };
          delete offerUpdatePayload.Created_At;
          if (safeTrim((existingOffer as any)?.Created_By)) {
            delete offerUpdatePayload.Created_By;
          }

          const doUpdate = async (db: any) => {
            return await db
              .from('Offers')
              .update(offerUpdatePayload)
              .eq('Offer_ID', offerIdSave)
              .select()
              .single();
          };

          let { data: updated, error: updateError } = await doUpdate(offersPrimaryDb);
          if (updateError && isOffersSchemaMismatchError(updateError)) {
            ({ data: updated, error: updateError } = await doUpdate(offersFallbackDb));
          }

          if (updateError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to update offer: ${updateError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          savedOffer = updated;
        } else {
          // Insert new
          const doInsert = async (db: any) => {
            return await db
              .from('Offers')
              .insert(offerRecord)
              .select()
              .single();
          };

          let { data: inserted, error: insertError } = await doInsert(offersPrimaryDb);
          if (insertError && isOffersSchemaMismatchError(insertError)) {
            ({ data: inserted, error: insertError } = await doInsert(offersFallbackDb));
          }

          if (insertError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to save offer: ${insertError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          savedOffer = inserted;
        }

        result = savedOffer;
        break;

      case 'suggestOfferTitle':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const offerData = body?.offerData;
          if (!offerData || typeof offerData !== 'object') {
            return NextResponse.json({ ok: false, error: 'offerData required' }, { status: 400, headers: corsHeaders(request) });
          }

          const currentTitle = safeTrim(body?.currentTitle || offerData?.name || '');
          const titles = await aiOfferTitleSuggestions(openai, offerData, currentTitle);
          return NextResponse.json({ ok: true, titles }, { headers: corsHeaders(request) });
        }

      case 'autoTitleOffer':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const offerId = safeTrim(body?.offerId || body?.offer_id || body?.id || '');
          if (!offerId) {
            return NextResponse.json({ ok: false, error: 'Offer ID required' }, { status: 400, headers: corsHeaders(request) });
          }

          const { primary, fallback } = getOffersDbFallback();
          const loadOffer = async (db: any) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, Message_Context, AI_Analysis')
              .eq('Offer_ID', offerId)
              .maybeSingle();
          };

          let { data: offerRow, error: offerErr } = await loadOffer(primary);
          if (offerErr && isOffersSchemaMismatchError(offerErr)) {
            ({ data: offerRow, error: offerErr } = await loadOffer(fallback));
          }

          if (offerErr) {
            return NextResponse.json({ ok: false, error: `Failed to load offer: ${offerErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          if (!offerRow) {
            return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const createdBy = safeTrim((offerRow as any)?.Created_By).toUpperCase();
          const meUser = safeTrim(me.username).toUpperCase();
          if (me.role !== 'ADMIN' && createdBy && createdBy !== meUser) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403, headers: corsHeaders(request) });
          }

          let ctx: any = (offerRow as any).Message_Context;
          try {
            if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
          } catch {
            ctx = {};
          }
          if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

          let ob: any = ctx.offer_builder || ctx.offerBuilder || null;
          try {
            if (typeof ob === 'string') ob = JSON.parse(ob || '{}');
          } catch {
            // ignore
          }
          if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

          const existingTitle = safeTrim(ctx.offerName || ctx.offer_name || ob.name || ob.offerName || '');
          const force = ['1', 'true', 'yes', 'on'].includes(String(body?.force || '').toLowerCase());
          if (!force && !isWeakOfferTitle(existingTitle)) {
            return NextResponse.json({ ok: true, applied: false, title: existingTitle }, { headers: corsHeaders(request) });
          }

          const titles = await aiOfferTitleSuggestions(openai, ob, existingTitle);
          const nextTitle = normalizeOfferTitleCandidate(titles[0] || '');
          if (!nextTitle) {
            return NextResponse.json({ ok: false, error: 'Failed to generate title' }, { status: 500, headers: corsHeaders(request) });
          }

          const nextCtx = {
            ...ctx,
            offerName: nextTitle,
            offer_builder: {
              ...ob,
              name: nextTitle
            }
          };

          // Best-effort: keep framework snapshot offer_name aligned if present.
          let nextAi: any = (offerRow as any).AI_Analysis;
          try {
            if (typeof nextAi === 'string') nextAi = JSON.parse(nextAi || '{}');
          } catch {
            // ignore
          }
          if (!nextAi || typeof nextAi !== 'object' || Array.isArray(nextAi)) nextAi = null;
          if (nextAi && nextAi.offer_frameworks && nextAi.offer_frameworks.offer_snapshot) {
            try {
              nextAi.offer_frameworks.offer_snapshot.offer_name = nextTitle;
            } catch {
              // ignore
            }
          }

          const updatePayload: any = {
            Message_Context: nextCtx,
            Updated_At: new Date().toISOString()
          };
          if (nextAi) updatePayload.AI_Analysis = nextAi;

          const doUpdate = async (db: any) => {
            return await db
              .from('Offers')
              .update(updatePayload)
              .eq('Offer_ID', offerId)
              .select('*')
              .single();
          };

          let { data: updated, error: updErr } = await doUpdate(primary);
          if (updErr && isOffersSchemaMismatchError(updErr)) {
            ({ data: updated, error: updErr } = await doUpdate(fallback));
          }

          if (updErr) {
            return NextResponse.json({ ok: false, error: `Failed to update offer: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, applied: true, title: nextTitle, offer: updated }, { headers: corsHeaders(request) });
        }

      case 'autoTitleWeakOffers':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }
          if (String(me.role || '').trim().toUpperCase() !== 'ADMIN') {
            return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403, headers: corsHeaders(request) });
          }

          const scanLimitRaw = Number(body?.scanLimit ?? body?.limit ?? 250);
          const maxApplyRaw = Number(body?.maxApply ?? 50);
          const scanLimit = Math.max(1, Math.min(isFinite(scanLimitRaw) ? scanLimitRaw : 250, 500));
          const maxApply = Math.max(1, Math.min(isFinite(maxApplyRaw) ? maxApplyRaw : 50, 200));
          const order = String(body?.order || 'oldest').toLowerCase();
          const ascending = order === 'newest' ? false : true;
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dryRun || '').toLowerCase());
          const force = ['1', 'true', 'yes', 'on'].includes(String(body?.force || '').toLowerCase());

          const startedAt = Date.now();
          const timeBudgetMs = 22_000; // Vercel-safe-ish; keep under typical serverless limits.

          const { primary, fallback } = getOffersDbFallback();
          const scanOffers = async (db: any) => {
            return await db
              .from('Offers')
              .select([
                'Offer_ID',
                'Created_By',
                'Updated_At',
                'AI_Analysis',
                // Slim context fields only (avoid large embedded blobs in Message_Context)
                'ctx_offerName:Message_Context->>offerName',
                'ctx_offer_name:Message_Context->>offer_name',
                'ctx_ob:Message_Context->offer_builder',
                'ctx_ob2:Message_Context->offerBuilder',
              ].join(','))
              .order('Updated_At', { ascending })
              .limit(scanLimit);
          };

          let { data: offers, error: offersErr } = await scanOffers(primary);
          if (offersErr && isOffersSchemaMismatchError(offersErr)) {
            ({ data: offers, error: offersErr } = await scanOffers(fallback));
          }

          if (offersErr) {
            return NextResponse.json({ ok: false, error: `Failed to scan offers: ${offersErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const rows = Array.isArray(offers) ? offers : [];
          const results: any[] = [];
          let scanned = 0;
          let weakFound = 0;
          let applied = 0;
          let errors = 0;

          for (const offerRow of rows) {
            if (Date.now() - startedAt > timeBudgetMs) {
              const idForBudget = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId: idForBudget, skipped: true, reason: 'time_budget_exceeded' });
              break;
            }
            if (applied >= maxApply) break;

            try {
              scanned++;
              if (!offerRow || typeof offerRow !== 'object') {
                errors++;
                results.push({ offerId: null, applied: false, error: 'invalid_offer_row' });
                continue;
              }

              const offerId = safeTrim((offerRow as any)?.Offer_ID);
              if (!offerId) {
                errors++;
                results.push({ offerId: null, applied: false, error: 'missing_offer_id' });
                continue;
              }

              // Use slim fields for detection; fetch full Message_Context only if we plan to update.
              const ctxOfferName = safeTrim((offerRow as any)?.ctx_offerName);
              const ctxOfferNameSnake = safeTrim((offerRow as any)?.ctx_offer_name);
              let ob: any = (offerRow as any)?.ctx_ob || (offerRow as any)?.ctx_ob2 || null;
              try {
                if (typeof ob === 'string') ob = JSON.parse(ob || '{}');
              } catch {
                // ignore
              }
              if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

              const existingTitle = safeTrim(ctxOfferName || ctxOfferNameSnake || ob.name || ob.offerName || '');
              const weak = isWeakOfferTitle(existingTitle);
              if (!force && !weak) continue;
              if (weak) weakFound++;

              // Fetch full row context so we don't accidentally drop unrelated context keys on update.
              const fetchFullForUpdate = async (db: any) => {
                return await db
                  .from('Offers')
                  .select('Offer_ID, Message_Context, AI_Analysis')
                  .eq('Offer_ID', offerId)
                  .single();
              };

              let fullRow: any = null;
              let fullErr: any = null;
              ({ data: fullRow, error: fullErr } = await fetchFullForUpdate(primary));
              if (fullErr && isOffersSchemaMismatchError(fullErr)) {
                ({ data: fullRow, error: fullErr } = await fetchFullForUpdate(fallback));
              }
              if (fullErr || !fullRow) {
                errors++;
                results.push({ offerId, applied: false, error: `failed_fetch_full_context: ${fullErr?.message || 'unknown'}` });
                continue;
              }

              let ctx: any = (fullRow as any).Message_Context;
              try {
                if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
              } catch {
                ctx = {};
              }
              if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

              ob = ctx.offer_builder || ctx.offerBuilder || ob || null;
              try {
                if (typeof ob === 'string') ob = JSON.parse(ob || '{}');
              } catch {
                // ignore
              }
              if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

              let nextTitle = '';
              const titles = await aiOfferTitleSuggestions(openai, ob, existingTitle);
              for (const cand of titles) {
                const normalized = normalizeOfferTitleCandidate(cand);
                if (!normalized) continue;
                if (!isWeakOfferTitle(normalized)) {
                  nextTitle = normalized;
                  break;
                }
              }

              if (!nextTitle) {
                errors++;
                results.push({ offerId, from: existingTitle, applied: false, error: 'no_good_title_generated' });
                continue;
              }

              const nextCtx = {
                ...ctx,
                offerName: nextTitle,
                offer_builder: {
                  ...ob,
                  name: nextTitle
                }
              };

              let nextAi: any = (offerRow as any).AI_Analysis;
              try {
                if (typeof nextAi === 'string') nextAi = JSON.parse(nextAi || '{}');
              } catch {
                // ignore
              }
              if (!nextAi || typeof nextAi !== 'object' || Array.isArray(nextAi)) nextAi = null;
              if (nextAi && nextAi.offer_frameworks && nextAi.offer_frameworks.offer_snapshot) {
                try {
                  nextAi.offer_frameworks.offer_snapshot.offer_name = nextTitle;
                } catch {
                  // ignore
                }
              }

              if (dryRun) {
                applied++;
                results.push({ offerId, from: existingTitle, to: nextTitle, applied: true, dryRun: true });
                continue;
              }

              const updatePayload: any = {
                Message_Context: nextCtx,
                Updated_At: new Date().toISOString()
              };
              if (nextAi) updatePayload.AI_Analysis = nextAi;

              const doUpdate = async (db: any) => {
                return await db
                  .from('Offers')
                  .update(updatePayload)
                  .eq('Offer_ID', offerId);
              };

              let { error: updErr } = await doUpdate(primary);
              if (updErr && isOffersSchemaMismatchError(updErr)) {
                ({ error: updErr } = await doUpdate(fallback));
              }

              if (updErr) {
                errors++;
                results.push({ offerId, from: existingTitle, to: nextTitle, applied: false, error: updErr.message });
                continue;
              }

              applied++;
              results.push({ offerId, from: existingTitle, to: nextTitle, applied: true });
            } catch (e: any) {
              errors++;
              const offerId = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId, applied: false, error: e?.message || 'offer_row_failed' });
              continue;
            }
          }

          return NextResponse.json({
            ok: true,
            dryRun,
            scanLimit,
            maxApply,
            order: ascending ? 'oldest' : 'newest',
            scanned,
            weakFound,
            applied,
            errors,
            results
          }, { headers: corsHeaders(request) });
        }

      case 'autoDescribeMissingOffers':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const scanLimitRaw = Number(body?.scanLimit ?? body?.limit ?? 250);
          const maxApplyRaw = Number(body?.maxApply ?? 10);
          const scanLimit = Math.max(1, Math.min(isFinite(scanLimitRaw) ? scanLimitRaw : 250, 5000));
          const maxApply = Math.max(1, Math.min(isFinite(maxApplyRaw) ? maxApplyRaw : 10, 200));
          const order = String(body?.order || 'oldest').toLowerCase();
          const ascending = order === 'newest' ? false : true;
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dryRun || '').toLowerCase());

          const startedAt = Date.now();
          const timeBudgetMs = 22_000;

          const { primary, fallback } = getOffersDbFallback();
          const scanOffers = async (db: any) => {
            return await db
              .from('Offers')
              .select([
                'Offer_ID',
                'Created_By',
                'Updated_At',
                'ctx_ob:Message_Context->offer_builder',
                'ctx_ob2:Message_Context->offerBuilder'
              ].join(','))
              .order('Updated_At', { ascending })
              .limit(scanLimit);
          };

          let { data: offers, error: offersErr } = await scanOffers(primary);
          if (offersErr && isOffersSchemaMismatchError(offersErr)) {
            ({ data: offers, error: offersErr } = await scanOffers(fallback));
          }

          if (offersErr) {
            return NextResponse.json({ ok: false, error: `Failed to scan offers: ${offersErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const rows = Array.isArray(offers) ? offers : [];
          const results: any[] = [];
          let scanned = 0;
          let missingFound = 0;
          let applied = 0;
          let errors = 0;

          const meUser = safeTrim((me as any).username).toUpperCase();
          const isAdmin = safeTrim((me as any).role).toUpperCase() === 'ADMIN';

          const parseMaybeJson = (value: any) => {
            if (!value) return null;
            if (typeof value === 'object') return value;
            if (typeof value !== 'string') return null;
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          };

          for (const offerRow of rows) {
            if (Date.now() - startedAt > timeBudgetMs) {
              const idForBudget = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId: idForBudget, skipped: true, reason: 'time_budget_exceeded' });
              break;
            }
            if (applied >= maxApply) break;

            try {
              scanned++;
              const offerId = safeTrim((offerRow as any)?.Offer_ID);
              if (!offerId) {
                errors++;
                results.push({ offerId: null, applied: false, error: 'missing_offer_id' });
                continue;
              }

              const createdBy = safeTrim((offerRow as any)?.Created_By).toUpperCase();
              if (!isAdmin && createdBy && createdBy !== meUser) {
                continue;
              }

              let ob: any = (offerRow as any)?.ctx_ob || (offerRow as any)?.ctx_ob2 || null;
              ob = parseMaybeJson(ob) || ob;
              if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

              const existingDesc = safeTrim(ob.offerDescription ?? ob.offer_description ?? ob.description ?? '');
              if (existingDesc) continue;

              missingFound++;

              // Prefer the conceptualized offer description when available; fall back to existing text.
              let nextDesc = '';
              let source: string = '';

              const ai = await aiOfferDescription(openai, ob);
              nextDesc = safeTrim(ai ?? '');
              if (nextDesc) {
                source = 'ai';
              } else {
                nextDesc = safeTrim(ob.whatsIncluded ?? '');
                if (nextDesc) source = 'whatsIncluded';
              }

              if (!nextDesc) {
                errors++;
                results.push({ offerId, applied: false, error: openai ? 'no_description_generated' : 'openai_not_configured' });
                continue;
              }

              // Fetch full row context so we don't drop unrelated context keys on update.
              const fetchFullForUpdate = async (db: any) => {
                return await db
                  .from('Offers')
                  .select('Offer_ID, Message_Context')
                  .eq('Offer_ID', offerId)
                  .single();
              };

              let fullRow: any = null;
              let fullErr: any = null;
              ({ data: fullRow, error: fullErr } = await fetchFullForUpdate(primary));
              if (fullErr && isOffersSchemaMismatchError(fullErr)) {
                ({ data: fullRow, error: fullErr } = await fetchFullForUpdate(fallback));
              }
              if (fullErr || !fullRow) {
                errors++;
                results.push({ offerId, applied: false, error: `failed_fetch_full_context: ${fullErr?.message || 'unknown'}` });
                continue;
              }

              let ctx: any = (fullRow as any).Message_Context;
              try {
                if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
              } catch {
                ctx = {};
              }
              if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

              let fullOb: any = ctx.offer_builder || ctx.offerBuilder || ob || null;
              fullOb = parseMaybeJson(fullOb) || fullOb;
              if (!fullOb || typeof fullOb !== 'object' || Array.isArray(fullOb)) fullOb = {};

              // Never overwrite a non-empty description.
              const already = safeTrim(fullOb.offerDescription ?? fullOb.offer_description ?? fullOb.description ?? '');
              if (already) {
                results.push({ offerId, applied: false, skipped: true, reason: 'description_already_present' });
                continue;
              }

              fullOb.offerDescription = nextDesc;

              // Preserve whichever key is canonical in this record; default to offer_builder.
              const nextCtx: any = { ...ctx };
              if (nextCtx.offer_builder != null) nextCtx.offer_builder = fullOb;
              else if (nextCtx.offerBuilder != null) nextCtx.offerBuilder = fullOb;
              else nextCtx.offer_builder = fullOb;

              // Optional debug breadcrumbs (safe, small).
              try {
                nextCtx.offer_description_backfilled_at = new Date().toISOString();
                nextCtx.offer_description_backfilled_source = source || null;
              } catch {
                // ignore
              }

              if (dryRun) {
                applied++;
                results.push({ offerId, applied: true, dryRun: true, source, descriptionPreview: nextDesc.slice(0, 120) });
                continue;
              }

              const updatePayload: any = {
                Message_Context: nextCtx,
                Updated_At: new Date().toISOString()
              };

              const doUpdate = async (db: any) => {
                return await db
                  .from('Offers')
                  .update(updatePayload)
                  .eq('Offer_ID', offerId);
              };

              let { error: updErr } = await doUpdate(primary);
              if (updErr && isOffersSchemaMismatchError(updErr)) {
                ({ error: updErr } = await doUpdate(fallback));
              }

              if (updErr) {
                errors++;
                results.push({ offerId, applied: false, error: updErr.message });
                continue;
              }

              applied++;
              results.push({ offerId, applied: true, source, descriptionPreview: nextDesc.slice(0, 120) });
            } catch (e: any) {
              errors++;
              const offerId = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId, applied: false, error: e?.message || 'offer_row_failed' });
              continue;
            }
          }

          return NextResponse.json({
            ok: true,
            dryRun,
            scanLimit,
            maxApply,
            order: ascending ? 'oldest' : 'newest',
            scanned,
            missingFound,
            applied,
            errors,
            results
          }, { headers: corsHeaders(request) });
        }

      case 'autoGenerateMissingOfferModules':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const onlyOfferId = safeTrim(body?.offerId || body?.offer_id || body?.id || '');

          const scanLimitRaw = Number(body?.scanLimit ?? body?.limit ?? 250);
          const maxApplyRaw = Number(body?.maxApply ?? 10);
          const scanLimit = Math.max(1, Math.min(isFinite(scanLimitRaw) ? scanLimitRaw : 250, 5000));
          const maxApply = Math.max(1, Math.min(isFinite(maxApplyRaw) ? maxApplyRaw : 10, 100));
          const order = String(body?.order || 'oldest').toLowerCase();
          const ascending = order === 'newest' ? false : true;
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dryRun || '').toLowerCase());

          const startedAt = Date.now();
          const timeBudgetMs = 22_000;

          const { primary, fallback } = getOffersDbFallback();

          const loadOne = async (db: any) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, Updated_At, Message_Context, AI_Analysis')
              .eq('Offer_ID', onlyOfferId)
              .maybeSingle();
          };

          const scanOffers = async (db: any) => {
            return await db
              .from('Offers')
              .select([
                'Offer_ID',
                'Created_By',
                'Updated_At',
                'AI_Analysis',
                'ctx_ob:Message_Context->offer_builder',
                'ctx_ob2:Message_Context->offerBuilder'
              ].join(','))
              .order('Updated_At', { ascending })
              .limit(scanLimit);
          };

          let rows: any[] = [];
          if (onlyOfferId) {
            let { data: one, error: oneErr } = await loadOne(primary);
            if (oneErr && isOffersSchemaMismatchError(oneErr)) {
              ({ data: one, error: oneErr } = await loadOne(fallback));
            }
            if (oneErr) {
              return NextResponse.json({ ok: false, error: `Failed to load offer: ${oneErr.message}` }, { status: 500, headers: corsHeaders(request) });
            }
            if (!one) {
              return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404, headers: corsHeaders(request) });
            }
            // Normalize into the scan-shape used below.
            let ctx: any = (one as any).Message_Context;
            try {
              if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
            } catch {
              ctx = {};
            }
            if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};
            rows = [
              {
                Offer_ID: (one as any).Offer_ID,
                Created_By: (one as any).Created_By,
                Updated_At: (one as any).Updated_At,
                AI_Analysis: (one as any).AI_Analysis,
                ctx_ob: ctx.offer_builder,
                ctx_ob2: ctx.offerBuilder
              }
            ];
          } else {
            let { data: offers, error: offersErr } = await scanOffers(primary);
            if (offersErr && isOffersSchemaMismatchError(offersErr)) {
              ({ data: offers, error: offersErr } = await scanOffers(fallback));
            }
            if (offersErr) {
              return NextResponse.json({ ok: false, error: `Failed to scan offers: ${offersErr.message}` }, { status: 500, headers: corsHeaders(request) });
            }
            rows = Array.isArray(offers) ? offers : [];
          }
          const results: any[] = [];
          let scanned = 0;
          let missingFound = 0;
          let applied = 0;
          let errors = 0;

          const meUser = safeTrim((me as any).username).toUpperCase();
          const isAdmin = safeTrim((me as any).role).toUpperCase() === 'ADMIN';

          const parseMaybeJson = (value: any) => {
            if (!value) return null;
            if (typeof value === 'object') return value;
            if (typeof value !== 'string') return null;
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          };

          const safeString = (v: any) => String(v == null ? '' : v).trim();

          const hash32 = (s: string) => {
            // Simple, deterministic hash (FNV-1a-ish).
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
              h ^= s.charCodeAt(i);
              h = Math.imul(h, 16777619);
            }
            return (h >>> 0);
          };

          const pick = <T,>(arr: T[], seed: string) => {
            const a = Array.isArray(arr) ? arr : [];
            if (!a.length) return (null as any);
            const idx = hash32(seed) % a.length;
            return a[idx];
          };

          const inferDomain = (services: string[]) => {
            const s = services.map(x => x.toLowerCase()).join(' | ');
            if (/doorbell|ring|nest doorbell/.test(s)) return 'doorbell';
            if (/camera|cameras|cctv|nvr|dvr/.test(s)) return 'cameras';
            if (/tv|television|mount/.test(s)) return 'tv_mount';
            if (/thermostat|hvac/.test(s)) return 'thermostat';
            if (/wifi|network|router|mesh|ethernet/.test(s)) return 'network';
            if (/smart|alexa|google home|homekit/.test(s)) return 'smart_home';
            return 'home_services';
          };

          const domainPainPoints = (domain: string) => {
            if (domain === 'tv_mount') return ['crooked TV', 'visible wires', 'wrong height', 'missed studs', 'wall damage'];
            if (domain === 'cameras') return ['blind spots', 'weak Wi‑Fi signal', 'messy wiring', 'bad angles', 'false alerts'];
            if (domain === 'doorbell') return ['missed visitors', 'weak chime integration', 'bad positioning', 'wiring confusion'];
            if (domain === 'network') return ['dead zones', 'buffering', 'dropped calls', 'inconsistent speeds'];
            if (domain === 'thermostat') return ['wrong wiring', 'short-cycling fears', 'setup confusion'];
            if (domain === 'smart_home') return ['devices not syncing', 'app overwhelm', 'unreliable automations'];
            return ['mess', 'surprise costs', 'timing headaches', 'trust concerns'];
          };

          const computePriceHint = (ob: any) => {
            try {
              const p = Number(ob?.totals?.customerPrice);
              if (Number.isFinite(p) && p > 0) return p;
            } catch {
              // ignore
            }
            try {
              const items = Array.isArray(ob?.lineItems) ? ob.lineItems : [];
              const sum = items.reduce((acc: number, it: any) => {
                const qty = Number(it?.qty || 1) || 1;
                const unit = Number(it?.baseUnitPrice ?? it?.unitPrice ?? 0) || 0;
                return acc + (qty * unit);
              }, 0);
              return (Number.isFinite(sum) && sum > 0) ? sum : null;
            } catch {
              return null;
            }
          };

          const moduleKeys = {
            tof: ['problem_awareness', 'myth_bust', 'how_it_works', 'proof_story', 'authority'],
            bof: ['offer_stack', 'price_anchor', 'objection_killer', 'urgency_scarcity', 'cta_booking']
          };

          const hasMeaningfulModule = (m: any) => {
            if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
            const hook = safeTrim(m.hook || '');
            const primary = safeTrim(m.primary_text || m.primaryText || '');
            const dir = safeTrim(m.creative_direction || m.creativeDirection || '');
            return !!(hook || primary || dir);
          };

          const normalizeText = (v: any) => {
            try {
              return String(v == null ? '' : v)
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();
            } catch {
              return '';
            }
          };

          const buildSpecificityTokens = (input: any) => {
            const tokens: string[] = [];
            const add = (s: any) => {
              const t = normalizeText(s);
              if (!t) return;
              if (t.length < 4) return;
              tokens.push(t);
            };

            add(input?.offer_name);
            add(input?.market);
            add(input?.headline);

            try {
              const services = Array.isArray(input?.services) ? input.services : [];
              for (const s of services.slice(0, 4)) add(s);
            } catch {
              // ignore
            }

            try {
              const p = Number(input?.price_hint);
              if (Number.isFinite(p) && p > 0) {
                const rounded = Math.round(p);
                add(`$${rounded}`);
                add(String(rounded));
              }
            } catch {
              // ignore
            }

            return Array.from(new Set(tokens));
          };

          const isModuleTooGeneric = (m: any, input: any) => {
            if (!hasMeaningfulModule(m)) return true;
            const hook = safeTrim(m?.hook || '');
            const primary = safeTrim(m?.primary_text || m?.primaryText || '');
            const dir = safeTrim(m?.creative_direction || m?.creativeDirection || '');
            const all = normalizeText([hook, primary, dir].filter(Boolean).join('\n'));
            if (!all) return true;

            const tokens = buildSpecificityTokens(input);
            const mentionsSpecific = tokens.length ? tokens.some(t => all.includes(t)) : false;

            const genericPhrases = [
              'no surprises',
              'clean result',
              'fast scheduling',
              'book in minutes',
              'limited openings',
              'next slots fill fast',
              'tap to get a quick quote',
              'get a quick quote',
              'how it works (3 steps)',
              'the simple process',
              'protect the space'
            ];
            const templatey = genericPhrases.some(p => all.includes(p));
            const primaryLen = normalizeText(primary).length;

            if (tokens.length && !mentionsSpecific) return true;
            if (!tokens.length && templatey && primaryLen < 110) return true;
            if (templatey && primaryLen < 90) return true;
            return false;
          };

          const shouldGenerateModuleKey = (existing: any, input: any) => {
            if (!hasMeaningfulModule(existing)) return true;
            return isModuleTooGeneric(existing, input);
          };

          const fallbackModules = (input: any, missing: { tof: string[]; bof: string[] }) => {
            const offerId = safeString(input.offer_id || '');
            const offerName = safeString(input.offer_name || 'Offer');
            const market = safeString(input.market || '');
            const headline = safeString(input.headline || '');
            const services = Array.isArray(input.services) ? input.services.map((x: any) => safeString(x)).filter(Boolean) : [];
            const includesShort = services.slice(0, 3).join(', ');
            const servicePhrase = services[0] || offerName || 'this service';

            const price = Number(input.price_hint || 0) || 0;
            const priceStr = (Number.isFinite(price) && price > 0) ? `$${Math.round(price)}` : '';

            const domain = safeString(input.domain || 'home_services');
            const pains = Array.isArray(input.pain_points) ? input.pain_points : domainPainPoints(domain);
            const pain = safeString(pick(pains, `${offerId}::pain`) || pains[0] || 'the hassle');

            const hookVariants = {
              problem_awareness: [
                `${market ? `${market}: ` : ''}Still dealing with ${pain}?`,
                `${servicePhrase}: ${pain} is usually preventable.`,
                `${market ? `${market}: ` : ''}If ${pain} keeps happening, do this instead.`
              ],
              myth_bust: [
                `Myth: “${servicePhrase} is easy.”`,
                `DIY tip that causes expensive rework…`,
                `The "quick fix" that makes it worse…`
              ],
              how_it_works: [
                offerName ? `How ${offerName} works (3 steps)` : 'How it works (3 steps)',
                `What happens when we show up (fast + clean)`,
                `The simple process behind a clean result`
              ],
              proof_story: [
                `Clean result. No stress.`,
                `“On time, clean work, looks perfect.”`,
                `Before/after tells the story.`
              ],
              authority: [
                `Pros check this first — before they touch anything.`,
                `The pro method that prevents rework.`,
                `Tools + process = a clean finish.`
              ],
              offer_stack: [
                offerName ? `${offerName}: what’s included` : 'What’s included',
                `Everything included. No surprises.`,
                `Here’s what you actually get.`
              ],
              price_anchor: [
                priceStr ? `Upfront pricing: ${priceStr}` : 'Upfront pricing (no surprises)',
                `Bundle beats piece-by-piece.`,
                `Pay once — avoid rework later.`
              ],
              objection_killer: [
                `Worried about mess or damage?`,
                `No surprise fees. No sketchy work.`,
                `Trust + clean work, start to finish.`
              ],
              urgency_scarcity: [
                `Limited openings this week`,
                `Next slots fill fast`,
                `If you want it done soon…`
              ],
              cta_booking: [
                `Book in minutes`,
                `Get a quote, pick a time`,
                `Fast scheduling. Clean install.`
              ]
            };

            const mk = (key: string, stage: 'tof' | 'bof') => {
              const seed = `${offerId}::${stage}::${key}`;
              const hook = safeString(pick((hookVariants as any)[key] || [], seed) || '');
              const idTitle = (stage === 'tof' ? 'TOF' : 'BOF');
              const ideaTitle = `${idTitle} ${key.replace(/_/g, ' ')}: ${offerName}`.replace(/\s+/g, ' ').trim();
              const incl = includesShort ? `Included: ${includesShort}.` : '';
              const marketLine = market ? `${market}: ` : '';

              const basePrimaryBits = {
                problem_awareness: `${marketLine}If ${pain} keeps popping up, the fix is usually process — not a bigger “upgrade”.\n\n${incl}`,
                myth_bust: `Reality: the mistakes show up later (crooked, damage, rework).\n\nHere’s what pros do differently — and why it matters.\n${incl}`,
                how_it_works: `1) Quick quote\n2) Protect the space + confirm plan\n3) Install + test + walkthrough\n\n${incl}`,
                proof_story: `Show the finished result first, then one real proof beat (review line, before/after, or a quick “process” clip).\n\n${offerName ? `This is what ${offerName} should feel like.` : ''}`.trim(),
                authority: `A clean, safe result comes from process: measure, level, protect, install, then test + tidy.\n\n${incl}`,
                offer_stack: `${incl || 'Included: (add services).'}\n\nClean work. Safe install. Simple scheduling.`,
                price_anchor: `Anchor value by showing what’s included (bundle/package) vs piece-by-piece.\n\n${incl}`,
                objection_killer: `We protect the space, confirm everything upfront, and clean up when we’re done.\n\nNo surprises. Just a clean result.`,
                urgency_scarcity: `${marketLine}If you want it done soon, grab a slot while availability is open.\n\n${incl}`,
                cta_booking: `Tap to get a quick quote, pick a time, and we’ll handle the rest.\n\n${incl}`
              };

              const primary_text = safeString((basePrimaryBits as any)[key] || '');
              const creative_direction = safeString(
                stage === 'tof'
                  ? 'Open with the “before” moment, then 2 quick proof beats (process + finished result). Keep it specific; avoid generic claims.'
                  : 'Show checklist-style clarity (what’s included), add one proof beat (review/before-after), then a simple CTA to book.'
              );

              const cta = stage === 'tof'
                ? safeString(pick(['See how it works', 'Get a quick quote', 'Check availability'], `${offerId}::${key}::cta`) || 'Get a quote')
                : safeString(pick(['Book now', 'See pricing', 'Check times'], `${offerId}::${key}::cta`) || 'Book now');

              return { idea_title: ideaTitle, hook, primary_text, creative_direction, cta };
            };

            const out: any = { modules: { tof: {}, bof: {} } };
            for (const k of missing.tof) out.modules.tof[k] = mk(k, 'tof');
            for (const k of missing.bof) out.modules.bof[k] = mk(k, 'bof');
            return out;
          };

          const generateModulesWithAi = async (input: any, missing: { tof: string[]; bof: string[] }) => {
            if (!openai) return null;
            const want = { tof: missing.tof, bof: missing.bof };
            const seed = safeString(input.offer_id || '');

            const tokens = buildSpecificityTokens(input);
            const requiredTokensLine = tokens.length
              ? `- Where possible, explicitly include at least 1 of these offer-specific tokens (verbatim or close match): ${tokens.slice(0, 8).join(' | ')}\n`
              : '';

            const bannedPhrases = [
              'no surprises',
              'clean result',
              'fast scheduling',
              'book in minutes',
              'limited openings',
              'next slots fill fast',
              'tap to get a quick quote'
            ];

            const prompt = `You are a senior direct-response creative strategist for Home2Smart.\n\nTask: Write offer-specific Ad Module copy for a single offer. This must NOT be generic; it must reflect the offer's services, market, pricing/constraints (if present), and real objections.\n\nReturn VALID JSON ONLY (no markdown) in exactly this shape:\n\n{\n  \"modules\": {\n    \"tof\": {\n      \"problem_awareness\": {\"idea_title\":\"\",\"hook\":\"\",\"primary_text\":\"\",\"creative_direction\":\"\",\"cta\":\"\"},\n      ... only include keys requested ...\n    },\n    \"bof\": { ... only include keys requested ... }\n  }\n}\n\nRules (strict):\n- ONLY include module keys in REQUESTED_KEYS.\n- For every module you return: hook must be <= 95 characters; primary_text must be 2-4 short paragraphs (use newlines); creative_direction must be 2-5 bullet lines OR short sentences separated by newlines.\n- Each module MUST mention at least one of: a specific included service, a concrete outcome, or a concrete constraint that fits the offer.\n- Avoid filler lines that could apply to any home service. No emojis. No hype.\n- Use the SEED as a style-randomizer: vary phrasing and structure across offers while staying consistent for this offer.\n${requiredTokensLine}- Avoid these generic phrases unless you make them clearly offer-specific: ${bannedPhrases.join(', ')}\n\nREQUESTED_KEYS:\n${JSON.stringify(want)}\n\nSEED:\n${seed}\n\nOFFER_INPUT_JSON:\n${JSON.stringify(input)}`;

            const completion = await openai.chat.completions.create({
              model: process.env.OPENAI_OFFER_MODEL || 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Return valid JSON only.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.3,
              max_tokens: 1800,
              response_format: { type: 'json_object' }
            });

            try {
              return JSON.parse(completion.choices?.[0]?.message?.content || '{}');
            } catch {
              return null;
            }
          };

          for (const offerRow of rows) {
            if (Date.now() - startedAt > timeBudgetMs) {
              const idForBudget = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId: idForBudget, skipped: true, reason: 'time_budget_exceeded' });
              break;
            }
            if (applied >= maxApply) break;

            try {
              scanned++;
              const offerId = safeTrim((offerRow as any)?.Offer_ID);
              if (!offerId) {
                errors++;
                results.push({ offerId: null, applied: false, error: 'missing_offer_id' });
                continue;
              }

              const createdBy = safeTrim((offerRow as any)?.Created_By).toUpperCase();
              if (!isAdmin && createdBy && createdBy !== meUser) {
                continue;
              }

              let ob: any = (offerRow as any)?.ctx_ob || (offerRow as any)?.ctx_ob2 || null;
              ob = parseMaybeJson(ob) || ob;
              if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

              let ai: any = (offerRow as any)?.AI_Analysis;
              ai = parseMaybeJson(ai) || ai;
              if (!ai || typeof ai !== 'object' || Array.isArray(ai)) ai = {};

              let frameworks: any = (ai as any).offer_frameworks;
              frameworks = parseMaybeJson(frameworks) || frameworks;
              if (!frameworks || typeof frameworks !== 'object' || Array.isArray(frameworks)) frameworks = {};

              if (!frameworks.modules || typeof frameworks.modules !== 'object' || Array.isArray(frameworks.modules)) frameworks.modules = {};
              if (!frameworks.modules.tof || typeof frameworks.modules.tof !== 'object' || Array.isArray(frameworks.modules.tof)) frameworks.modules.tof = {};
              if (!frameworks.modules.bof || typeof frameworks.modules.bof !== 'object' || Array.isArray(frameworks.modules.bof)) frameworks.modules.bof = {};

              const services = Array.isArray(ob?.lineItems)
                ? (ob.lineItems
                    .map((li: any) => safeString(li?.name || li?.serviceName || li?.service || ''))
                    .filter(Boolean))
                : [];
              const domain = inferDomain(services);
              const priceHint = computePriceHint(ob);
              const offerName = safeString(ob?.name || ob?.offerName || '');
              const headline = safeString(ob?.headline || ob?.oneSentencePromise || ob?.intendedGoal || '');
              const market = safeString(ob?.market || ob?.category || '');
              const desc = safeString(ob?.offerDescription || ob?.offer_description || ob?.description || '');

              const input = {
                offer_id: offerId,
                offer_name: offerName,
                headline,
                market,
                services,
                price_hint: priceHint,
                offer_description: desc,
                domain,
                pain_points: domainPainPoints(domain),
                frameworks_guidance: {
                  tof_guidance: safeString(frameworks.tof_guidance || frameworks.tofGuidance || ''),
                  bof_guidance: safeString(frameworks.bof_guidance || frameworks.bofGuidance || ''),
                  pillars: frameworks.pillars || null,
                  tof_ad_types: frameworks.tof_ad_types || null,
                  bof_ad_types: frameworks.bof_ad_types || null
                }
              };

              const missing: { tof: string[]; bof: string[] } = { tof: [], bof: [] };
              for (const k of moduleKeys.tof) {
                if (shouldGenerateModuleKey(frameworks.modules.tof[k], input)) missing.tof.push(k);
              }
              for (const k of moduleKeys.bof) {
                if (shouldGenerateModuleKey(frameworks.modules.bof[k], input)) missing.bof.push(k);
              }
              if (!missing.tof.length && !missing.bof.length) continue;

              missingFound++;

              let gen: any = await generateModulesWithAi(input, missing);
              if (!gen || typeof gen !== 'object') {
                gen = fallbackModules(input, missing);
                (gen as any).generated_by = openai ? 'openai_parse_failed_fallback' : 'fallback';
              } else {
                (gen as any).generated_by = 'openai';
              }

              if ((gen as any).generated_by === 'openai') {
                try {
                  const gmods = (gen as any)?.modules;
                  const gtof = gmods && typeof gmods === 'object' ? (gmods as any).tof : null;
                  const gbof = gmods && typeof gmods === 'object' ? (gmods as any).bof : null;
                  const invalid: { tof: string[]; bof: string[] } = { tof: [], bof: [] };

                  for (const k of missing.tof) {
                    const m = gtof && typeof gtof === 'object' ? (gtof as any)[k] : null;
                    if (!m || isModuleTooGeneric(m, input)) invalid.tof.push(k);
                  }
                  for (const k of missing.bof) {
                    const m = gbof && typeof gbof === 'object' ? (gbof as any)[k] : null;
                    if (!m || isModuleTooGeneric(m, input)) invalid.bof.push(k);
                  }

                  if (invalid.tof.length || invalid.bof.length) {
                    const retry: any = await generateModulesWithAi(input, invalid);
                    const rmods = retry && typeof retry === 'object' ? (retry as any).modules : null;
                    if (rmods && typeof rmods === 'object') {
                      if (!(gen as any).modules || typeof (gen as any).modules !== 'object') (gen as any).modules = { tof: {}, bof: {} };
                      if (!(gen as any).modules.tof || typeof (gen as any).modules.tof !== 'object') (gen as any).modules.tof = {};
                      if (!(gen as any).modules.bof || typeof (gen as any).modules.bof !== 'object') (gen as any).modules.bof = {};

                      if ((rmods as any).tof && typeof (rmods as any).tof === 'object') {
                        for (const k of invalid.tof) {
                          const m = (rmods as any).tof[k];
                          if (m && !isModuleTooGeneric(m, input)) (gen as any).modules.tof[k] = m;
                        }
                      }
                      if ((rmods as any).bof && typeof (rmods as any).bof === 'object') {
                        for (const k of invalid.bof) {
                          const m = (rmods as any).bof[k];
                          if (m && !isModuleTooGeneric(m, input)) (gen as any).modules.bof[k] = m;
                        }
                      }
                    }
                  }
                } catch {
                  // ignore
                }
              }

              const genModules = (gen as any)?.modules;
              const tofGen = genModules && typeof genModules === 'object' ? (genModules as any).tof : null;
              const bofGen = genModules && typeof genModules === 'object' ? (genModules as any).bof : null;

              const mergeOne = (bucket: any, key: string, value: any) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) return;
                const existing = bucket[key];
                if (hasMeaningfulModule(existing) && !isModuleTooGeneric(existing, input)) return;
                if (isModuleTooGeneric(value, input)) return;
                bucket[key] = value;
              };

              if (tofGen && typeof tofGen === 'object') {
                for (const k of missing.tof) mergeOne(frameworks.modules.tof, k, (tofGen as any)[k]);
              }
              if (bofGen && typeof bofGen === 'object') {
                for (const k of missing.bof) mergeOne(frameworks.modules.bof, k, (bofGen as any)[k]);
              }

              // Breadcrumbs
              try {
                (frameworks as any).modules_backfilled_at = new Date().toISOString();
                (frameworks as any).modules_backfilled_source = (gen as any).generated_by || (openai ? 'openai' : 'fallback');
              } catch {
                // ignore
              }

              (ai as any).offer_frameworks = frameworks;

              if (dryRun) {
                applied++;
                results.push({ offerId, applied: true, dryRun: true, missing, source: (gen as any).generated_by || null });
                continue;
              }

              const updateOffer = async (db: any) => {
                return await db
                  .from('Offers')
                  .update({ AI_Analysis: ai, Updated_At: new Date().toISOString() })
                  .eq('Offer_ID', offerId);
              };

              let { error: updErr } = await updateOffer(primary);
              if (updErr && isOffersSchemaMismatchError(updErr)) {
                ({ error: updErr } = await updateOffer(fallback));
              }
              if (updErr) {
                errors++;
                results.push({ offerId, applied: false, error: updErr.message });
                continue;
              }

              applied++;
              results.push({ offerId, applied: true, missing, source: (gen as any).generated_by || null });
            } catch (e: any) {
              errors++;
              const offerId = safeTrim((offerRow as any)?.Offer_ID) || null;
              results.push({ offerId, applied: false, error: e?.message || 'offer_row_failed' });
              continue;
            }
          }

          return NextResponse.json({
            ok: true,
            dryRun,
            scanLimit,
            maxApply,
            order: ascending ? 'oldest' : 'newest',
            scanned,
            missingFound,
            applied,
            errors,
            results
          }, { headers: corsHeaders(request) });
        }

      case 'auditOfferModuleDuplicates':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const { primary, fallback } = getOffersDbFallback();

          const scanLimitRaw = Number(body?.scanLimit ?? body?.limit ?? 800);
          const scanLimit = Math.max(1, Math.min(isFinite(scanLimitRaw) ? scanLimitRaw : 800, 5000));
          const minLenRaw = Number(body?.minLen ?? 24);
          const minLen = Math.max(8, Math.min(isFinite(minLenRaw) ? minLenRaw : 24, 500));
          const stageFilter = String(body?.stage || 'all').toLowerCase();
          const includeStages = stageFilter === 'tof' ? ['tof'] : (stageFilter === 'bof' ? ['bof'] : ['tof', 'bof']);

          const order = String(body?.order || 'updated_desc').toLowerCase();
          const ascending = order === 'updated_asc';

          const parseMaybeJson = (value: any) => {
            if (!value) return null;
            if (typeof value === 'object') return value;
            if (typeof value !== 'string') return null;
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          };

          const normalizeText = (v: any) => {
            try {
              return String(v == null ? '' : v)
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[“”]/g, '"')
                .replace(/[’]/g, "'")
                .trim();
            } catch {
              return '';
            }
          };

          const short = (s: string, n: number) => {
            const t = String(s || '');
            return t.length > n ? (t.slice(0, n) + '…') : t;
          };

          const hash32 = (s: string) => {
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
              h ^= s.charCodeAt(i);
              h = Math.imul(h, 16777619);
            }
            return (h >>> 0).toString(16);
          };

          const scanOffers = async (db: any) => {
            return await db
              .from('Offers')
              .select([
                'Offer_ID',
                'Updated_At',
                'AI_Analysis',
                'ctx_ob:Message_Context->offer_builder',
                'ctx_ob2:Message_Context->offerBuilder'
              ].join(','))
              .order('Updated_At', { ascending })
              .limit(scanLimit);
          };

          let rows: any[] = [];
          {
            let { data: offers, error: offersErr } = await scanOffers(primary);
            if (offersErr && isOffersSchemaMismatchError(offersErr)) {
              ({ data: offers, error: offersErr } = await scanOffers(fallback));
            }
            if (offersErr) {
              return NextResponse.json({ ok: false, error: `Failed to scan offers: ${offersErr.message}` }, { status: 500, headers: corsHeaders(request) });
            }
            rows = Array.isArray(offers) ? offers : [];
          }

          type DupRow = {
            offerId: string;
            offerName: string;
            updatedAt: string;
          };

          type DupGroup = {
            stage: string;
            moduleKey: string;
            fingerprint: string;
            count: number;
            sample: { hook: string; primary: string };
            offers: DupRow[];
          };

          const groups = new Map<string, { stage: string; moduleKey: string; hook: string; primary: string; offers: DupRow[] }>();

          let scanned = 0;
          for (const r of rows) {
            scanned++;
            const offerId = safeTrim((r as any)?.Offer_ID);
            if (!offerId) continue;

            const updatedAt = safeTrim((r as any)?.Updated_At);

            // Try to get a useful offer name for the report.
            let offerName = '';
            try {
              const ob = parseMaybeJson((r as any)?.ctx_ob) || parseMaybeJson((r as any)?.ctx_ob2) || (r as any)?.ctx_ob || (r as any)?.ctx_ob2 || null;
              if (ob && typeof ob === 'object') {
                offerName = safeTrim((ob as any).name);
              }
            } catch {
              offerName = '';
            }
            if (!offerName) offerName = offerId;

            // Extract modules from AI_Analysis.offer_frameworks.modules.
            let ai: any = (r as any)?.AI_Analysis;
            ai = parseMaybeJson(ai) || ai;
            if (!ai || typeof ai !== 'object' || Array.isArray(ai)) continue;
            const fw = (ai as any).offer_frameworks || (ai as any).offerFrameworks || null;
            const modules = fw && typeof fw === 'object' ? ((fw as any).modules || null) : null;
            if (!modules || typeof modules !== 'object' || Array.isArray(modules)) continue;

            for (const stage of includeStages) {
              const bucket = (modules as any)[stage];
              if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
              for (const moduleKey of Object.keys(bucket)) {
                const m = (bucket as any)[moduleKey];
                if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
                const hook = safeTrim((m as any).hook);
                const primary = safeTrim((m as any).primary_text ?? (m as any).primaryText);
                if (!hook && !primary) continue;

                const nh = normalizeText(hook);
                const np = normalizeText(primary);
                const combined = `${stage}|${moduleKey}|${nh}|${np}`;
                if ((nh.length + np.length) < minLen) continue;

                const fingerprint = hash32(combined);
                const key = `${stage}|${moduleKey}|${fingerprint}`;
                const entry = groups.get(key);
                const offerRef: DupRow = { offerId, offerName, updatedAt };
                if (!entry) {
                  groups.set(key, { stage, moduleKey, hook: short(hook, 160), primary: short(primary, 220), offers: [offerRef] });
                } else {
                  // Avoid duplicates per offer within the same group.
                  if (!entry.offers.some(o => o.offerId === offerId)) entry.offers.push(offerRef);
                }
              }
            }
          }

          const duplicateGroups: DupGroup[] = Array.from(groups.entries())
            .map(([k, v]) => {
              const parts = k.split('|');
              const fingerprint = parts[2] || '';
              return {
                stage: v.stage,
                moduleKey: v.moduleKey,
                fingerprint,
                count: v.offers.length,
                sample: { hook: v.hook, primary: v.primary },
                offers: v.offers.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
              };
            })
            .filter(g => g.count >= 2)
            .sort((a, b) => b.count - a.count);

          const maxGroupsRaw = Number(body?.maxGroups ?? 50);
          const maxGroups = Math.max(1, Math.min(isFinite(maxGroupsRaw) ? maxGroupsRaw : 50, 200));

          return NextResponse.json({
            ok: true,
            scanLimit,
            scanned,
            stages: includeStages,
            minLen,
            duplicateGroups: duplicateGroups.slice(0, maxGroups)
          }, { headers: corsHeaders(request) });
        }

      case 'backfillOffersFromDeliverables':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const scanLimitRaw = Number(body?.scanLimit ?? body?.limit ?? 250);
          const scanLimit = Math.max(1, Math.min(isFinite(scanLimitRaw) ? scanLimitRaw : 250, 1000));
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dryRun || '').toLowerCase());
          const onlyIfMissing = ['1', 'true', 'yes', 'on'].includes(String(body?.onlyIfMissing || body?.only_missing || '').toLowerCase());
          const useDeliverableIdAsOfferId = ['1', 'true', 'yes', 'on'].includes(
            String(body?.useDeliverableIdAsOfferId || body?.fallbackToDeliverableId || body?.fallbackOfferIdToDeliverableId || '').toLowerCase()
          );
          const sinceIso = safeTrim(body?.sinceIso || body?.sinceISO || body?.since || '');
          const submittedByFilter = safeTrim(body?.submittedBy || body?.createdBy || '');

          const startedAt = Date.now();
          const timeBudgetMs = 22_000;

          const isUuid = (s: string) => {
            const v = safeTrim(s);
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
          };

          const parseJsonMaybe = (v: any) => {
            if (v == null) return null;
            if (typeof v === 'object') return v;
            if (typeof v !== 'string') return null;
            const s = v.trim();
            if (!s) return null;
            try {
              return JSON.parse(s);
            } catch {
              return null;
            }
          };

          const deliverablesDb = getDeliverablesDb();
          const baseSelect = 'Deliverable_ID, Title, Description, File_Link, Submitted_By, Created_At, Updated_At';
          const selectWithMetadata = `${baseSelect}, Offer_ID, Deliverable_Type, Metadata`;
          const selectWithMetadataFallback = `${baseSelect}, Metadata`;

          let q = deliverablesDb
            .from('Deliverables')
            .select(selectWithMetadata)
            .order('Created_At', { ascending: false })
            .limit(scanLimit)
            .ilike('Title', 'Offer Brief:%');

          if (sinceIso) q = q.gte('Created_At', sinceIso);
          if (submittedByFilter) q = q.eq('Submitted_By', submittedByFilter);

          // Deliverables.Metadata is required to recover offerId reliably.
          let { data: deliverablesRows, error: deliverablesErr } = await q;
          if (
            deliverablesErr &&
            (isMissingDeliverablesColumnError(deliverablesErr, 'Offer_ID') ||
              isMissingDeliverablesColumnError(deliverablesErr, 'Deliverable_Type'))
          ) {
            let q2 = deliverablesDb
              .from('Deliverables')
              .select(selectWithMetadataFallback)
              .order('Created_At', { ascending: false })
              .limit(scanLimit)
              .ilike('Title', 'Offer Brief:%');
            if (sinceIso) q2 = q2.gte('Created_At', sinceIso);
            if (submittedByFilter) q2 = q2.eq('Submitted_By', submittedByFilter);
            ({ data: deliverablesRows, error: deliverablesErr } = await q2);
          }
          if (deliverablesErr && isMissingDeliverablesColumnError(deliverablesErr, 'Metadata')) {
            return NextResponse.json(
              {
                ok: false,
                error: 'Deliverables.Metadata column missing; apply migration 009_alter_deliverables_add_metadata.sql in MGMT DB to enable backfill.'
              },
              { status: 409, headers: corsHeaders(request) }
            );
          }
          if (deliverablesErr) {
            return NextResponse.json({ ok: false, error: `Failed to scan deliverables: ${deliverablesErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const rows = Array.isArray(deliverablesRows) ? deliverablesRows : [];
          const { primary, fallback } = getOffersDbFallback();

          const loadOffer = async (db: any, offerId: string) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, Created_At, Updated_At, Status, Message_Context, Economics')
              .eq('Offer_ID', offerId)
              .maybeSingle();
          };

          const insertOffer = async (db: any, offerRecord: any) => {
            return await db.from('Offers').insert(offerRecord);
          };

          const updateOffer = async (db: any, offerId: string, payload: any) => {
            return await db.from('Offers').update(payload).eq('Offer_ID', offerId);
          };

          let scanned = 0;
          let matched = 0;
          let upserted = 0;
          let skippedMissingOfferId = 0;
          let skippedBadOfferId = 0;
          let skippedOnlyIfMissing = 0;
          let usedFallbackOfferId = 0;
          let errors = 0;
          const results: any[] = [];

          for (const d of rows) {
            if (Date.now() - startedAt > timeBudgetMs) {
              results.push({ deliverableId: safeTrim((d as any)?.Deliverable_ID), skipped: true, reason: 'time_budget_exceeded' });
              break;
            }

            scanned++;
            try {
              const deliverableId = safeTrim((d as any)?.Deliverable_ID);
              const title = safeTrim((d as any)?.Title);
              const description = safeTrim((d as any)?.Description);
              const fileLink = (d as any)?.File_Link ?? null;
              const submittedBy = safeTrim((d as any)?.Submitted_By);
              const createdAt = safeTrim((d as any)?.Created_At) || new Date().toISOString();
              const updatedAt = safeTrim((d as any)?.Updated_At) || createdAt;
              const offerIdCol = safeTrim((d as any)?.Offer_ID);
              const deliverableTypeCol = safeTrim((d as any)?.Deliverable_Type).toLowerCase();

              const mdRaw = (d as any)?.Metadata;
              const md = parseJsonMaybe(mdRaw) || {};

              const mdType = safeTrim((md as any)?.type || (md as any)?.Type || '');
              const looksLikeOfferBrief =
                deliverableTypeCol === 'offer_brief' ||
                mdType.toLowerCase() === 'offer_brief' ||
                title.toLowerCase().startsWith('offer brief:');
              if (!looksLikeOfferBrief) continue;

              matched++;

              let offerId = isUuid(offerIdCol)
                ? offerIdCol
                : safeTrim((md as any)?.offerId || (md as any)?.offer_id || (md as any)?.Offer_ID || (md as any)?.offerID || '');
              if (!offerId) {
                if (useDeliverableIdAsOfferId && isUuid(deliverableId)) {
                  offerId = deliverableId;
                  usedFallbackOfferId++;
                  try {
                    (md as any).offerId = offerId;
                    (md as any).offer_id = offerId;
                    (md as any).fallback_offer_id = 'deliverable_id';
                  } catch {
                    // ignore
                  }
                } else {
                  skippedMissingOfferId++;
                  results.push({ deliverableId, skipped: true, reason: 'missing_offer_id_in_metadata' });
                  continue;
                }
              }
              if (!isUuid(offerId)) {
                skippedBadOfferId++;
                results.push({ deliverableId, offerId, skipped: true, reason: 'offer_id_not_uuid' });
                continue;
              }

              const offerNameFromMd = safeTrim((md as any)?.offerName || (md as any)?.offer_name || (md as any)?.offerTitle || '');
              const offerNameFromTitle = title.toLowerCase().startsWith('offer brief:') ? safeTrim(title.slice('Offer Brief:'.length)) : '';
              const offerName = offerNameFromMd || offerNameFromTitle || '';

              const embeddedOfferBuilder =
                parseJsonMaybe((md as any)?.offer_builder) ||
                parseJsonMaybe((md as any)?.offerBuilder) ||
                parseJsonMaybe((md as any)?.offerData) ||
                parseJsonMaybe((md as any)?.offer) ||
                null;

              let { data: existing, error: existingErr } = await loadOffer(primary, offerId);
              if (existingErr && isOffersSchemaMismatchError(existingErr)) {
                ({ data: existing, error: existingErr } = await loadOffer(fallback, offerId));
              }
              if (existingErr) {
                errors++;
                results.push({ deliverableId, offerId, error: `load_offer_failed: ${existingErr.message}` });
                continue;
              }

              if (onlyIfMissing && existing) {
                skippedOnlyIfMissing++;
                results.push({ deliverableId, offerId, skipped: true, reason: 'only_if_missing' });
                continue;
              }

              let ctx: any = (existing as any)?.Message_Context;
              try {
                if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
              } catch {
                ctx = {};
              }
              if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

              let existingOb: any = ctx.offer_builder || ctx.offerBuilder || null;
              try {
                if (typeof existingOb === 'string') existingOb = JSON.parse(existingOb || '{}');
              } catch {
                // ignore
              }
              if (!existingOb || typeof existingOb !== 'object' || Array.isArray(existingOb)) existingOb = null;

              const nextOb = embeddedOfferBuilder && typeof embeddedOfferBuilder === 'object'
                ? embeddedOfferBuilder
                : (existingOb || {
                    offer_id: offerId,
                    name: offerName || undefined,
                    created_at: createdAt,
                    updated_at: updatedAt
                  });

              if (offerName && nextOb && typeof nextOb === 'object') {
                try { (nextOb as any).name = offerName; } catch { /* ignore */ }
              }

              const servicesFromBrief = extractServicesFromOfferBriefText(description);
              const parsedCustomerPrice = extractCustomerPriceFromOfferBriefText(description);

              const latestBrief = {
                deliverableId,
                title,
                description,
                fileLink,
                submittedBy,
                createdAt,
                updatedAt,
                metadata: md
              };

              const nextCtx: any = {
                ...ctx,
                ...(offerName ? { offerName } : {}),
                offer_builder: nextOb,
                latest_offer_brief: latestBrief
              };

              let econ: any = (existing as any)?.Economics;
              try {
                if (typeof econ === 'string') econ = JSON.parse(econ || '{}');
              } catch {
                econ = {};
              }
              if (!econ || typeof econ !== 'object' || Array.isArray(econ)) econ = {};

              const totals = (md as any)?.totals || (md as any)?.Totals || null;
              const standards = (md as any)?.standards || (md as any)?.Standards || null;
              if (totals) econ.totals = totals;
              if (standards) econ.standards = standards;

              const priceHint = firstPositiveNumber(
                (econ as any)?.totals?.customerPrice,
                parsedCustomerPrice
              );

              const nextObNormalized = normalizeOfferBuilderSnapshotForTotals(nextOb, {
                packagePrice: priceHint,
                serviceNames: servicesFromBrief
              });

              try {
                (nextCtx as any).offer_builder = nextObNormalized;
              } catch {
                // ignore
              }

              if (priceHint != null) {
                try {
                  if (!(econ as any).totals || typeof (econ as any).totals !== 'object') (econ as any).totals = {};
                  if (!coercePositiveNumber((econ as any).totals.customerPrice)) {
                    (econ as any).totals.customerPrice = priceHint;
                  }
                } catch {
                  // ignore
                }
              }

              const nowIso = new Date().toISOString();

              if (dryRun) {
                upserted++;
                results.push({ deliverableId, offerId, offerName, dryRun: true, action: existing ? 'update' : 'insert' });
                continue;
              }

              if (!existing) {
                const offerRecord: any = {
                  Offer_ID: offerId,
                  Created_By: submittedBy || 'UNKNOWN',
                  Created_At: createdAt || nowIso,
                  Updated_At: nowIso,
                  Status: 'DRAFT',
                  Message_Context: nextCtx,
                  Economics: econ
                };

                let { error: insErr } = await insertOffer(primary, offerRecord);
                if (insErr && isOffersSchemaMismatchError(insErr)) {
                  ({ error: insErr } = await insertOffer(fallback, offerRecord));
                }
                if (insErr) {
                  errors++;
                  results.push({ deliverableId, offerId, error: `insert_failed: ${insErr.message}` });
                  continue;
                }
              } else {
                const payload: any = {
                  Message_Context: nextCtx,
                  Economics: econ,
                  Updated_At: nowIso
                };
                if (!safeTrim((existing as any)?.Created_By) && submittedBy) payload.Created_By = submittedBy;

                let { error: updErr } = await updateOffer(primary, offerId, payload);
                if (updErr && isOffersSchemaMismatchError(updErr)) {
                  ({ error: updErr } = await updateOffer(fallback, offerId, payload));
                }
                if (updErr) {
                  errors++;
                  results.push({ deliverableId, offerId, error: `update_failed: ${updErr.message}` });
                  continue;
                }
              }

              upserted++;
              results.push({ deliverableId, offerId, offerName, action: existing ? 'update' : 'insert' });
            } catch (e: any) {
              errors++;
              results.push({ deliverableId: safeTrim((d as any)?.Deliverable_ID), error: e?.message || String(e) });
              continue;
            }
          }

          return NextResponse.json(
            {
              ok: true,
              dryRun,
              scanLimit,
              onlyIfMissing,
              useDeliverableIdAsOfferId,
              sinceIso: sinceIso || null,
              submittedBy: submittedByFilter || null,
              scanned,
              matchedOfferBriefs: matched,
              upserted,
              skippedMissingOfferId,
              skippedBadOfferId,
              skippedOnlyIfMissing,
              usedFallbackOfferId,
              errors,
              results
            },
            { headers: corsHeaders(request) }
          );
        }

      case 'generateOfferFrameworks':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }
          if (!openai) {
            // Continue with deterministic fallback, but still require auth.
          }

          const offerId = String(body.offerId || body.offer_id || body.id || (body.offerData && body.offerData.offer_id) || '').trim();
          if (!offerId) {
            return NextResponse.json({ ok: false, error: 'Offer ID required' }, { status: 400, headers: corsHeaders(request) });
          }

          const { primary, fallback } = getOffersDbFallback();
          const loadOffer = async (db: any) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, Created_At, Updated_At, Message_Context, Economics, AI_Analysis')
              .eq('Offer_ID', offerId)
              .maybeSingle();
          };

          let { data: offerRow, error: offerErr } = await loadOffer(primary);
          if (offerErr && isOffersSchemaMismatchError(offerErr)) {
            ({ data: offerRow, error: offerErr } = await loadOffer(fallback));
          }

          if (offerErr) {
            return NextResponse.json({ ok: false, error: `Failed to load offer: ${offerErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          if (!offerRow) {
            return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const rawOfferData = body.offerData || null;

          const safeString = (v: any) => String(v == null ? '' : v).trim();
          const safeArr = (v: any) => (Array.isArray(v) ? v : []);
          const compact = (s: string, max = 600) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

          const offerName = safeString(rawOfferData?.name || rawOfferData?.offerName || offerRow?.Message_Context?.offerName || offerRow?.Message_Context?.name || '');
          const headline = safeString(rawOfferData?.headline || rawOfferData?.oneSentencePromise || rawOfferData?.intendedGoal || '');

          const lineItems = safeArr(rawOfferData?.lineItems).map((li: any) => ({
            name: safeString(li?.name || li?.serviceName || li?.service || ''),
            qty: Number(li?.qty || 1) || 1
          })).filter((x: any) => x.name);

          const generatedAt = new Date().toISOString();

          const fallbackFrameworks = () => {
            const offerLabel = offerName || 'Offer';
            const items = lineItems.length ? lineItems.map((x: any) => `${x.qty}× ${x.name}`).join(', ') : '';
            const summary = compact([offerLabel, headline].filter(Boolean).join(' — '), 160);

            // This is the core “framework” meaning we actually use in the UI:
            // short, offer-specific guidance sentences for TOF and BOF.
            const tof_guidance = compact(
              [
                offerLabel ? `Lead with the outcome of “${offerLabel}”` : 'Lead with the outcome',
                items ? `show what’s included (${items})` : 'show what’s included',
                headline ? `in the language of “${headline}”` : ''
              ].filter(Boolean).join(', ') + '.',
              220
            );
            const bof_guidance = compact(
              [
                'Lead with clear price + what’s included (bundle/package),',
                'then conditions/timeframe,',
                'then proof and a direct CTA to book.'
              ].join(' '),
              220
            );

            const mkAdType = (key: string, title: string, premise: string, hooks: string[], cta: string) => ({
              key,
              title,
              premise,
              hook_templates: hooks,
              cta,
              asset_notes: ['1 hero visual', '1 proof visual (review/before-after)', 'simple CTA end card']
            });

            return {
              version: 'h2s_offer_frameworks_v1',
              generated_at: generatedAt,
              generated_by: openai ? 'openai' : 'fallback',
              summary,
              tof_guidance,
              bof_guidance,
              offer_snapshot: {
                offer_id: offerId,
                offer_name: offerLabel,
                headline: summary,
                includes: items
              },
              pillars: [
                {
                  key: 'offer_clarity',
                  title: 'Offer clarity',
                  goal: 'Make it obvious what they get + outcome.',
                  softly_filled: [
                    `What it is: ${offerLabel}`,
                    items ? `What’s included: ${items}` : 'What’s included: (add your services above)',
                    'Outcome: clean, safe, professional result — no surprises.'
                  ],
                  hook_lines: [
                    `“${offerLabel} — clean, safe, pro install.”`,
                    '“Quote in minutes. Schedule fast.”'
                  ]
                },
                {
                  key: 'objection_killer',
                  title: 'Objection killer',
                  goal: 'Remove fear: mess, trust, timing, surprise fees.',
                  softly_filled: [
                    'Upfront pricing (no surprises).',
                    'Respect your home (clean work).',
                    'Text updates + simple scheduling.'
                  ],
                  hook_lines: [
                    '“No hidden fees. Clean work.”',
                    '“On-time pros. Done right.”'
                  ]
                },
                {
                  key: 'price_anchor',
                  title: 'Price anchor',
                  goal: 'Make price feel fair by anchoring value + what’s included.',
                  softly_filled: [
                    'Transparent quote → clear inclusions → simple CTA.',
                    'Bundle beats à la carte.'
                  ],
                  hook_lines: [
                    '“Bundle pricing beats piece-by-piece.”',
                    '“Upfront quote. No surprises.”'
                  ]
                },
                {
                  key: 'proof',
                  title: 'Proof / Reviews',
                  goal: 'Build trust fast with social proof + before/after.',
                  softly_filled: [
                    'Lead with finished result.',
                    'Use 1 review line + stars + result photo.'
                  ],
                  hook_lines: [
                    '“Real customers. Real clean finishes.”',
                    '“Before/after tells the story.”'
                  ]
                }
              ],
              tof_ad_types: [
                mkAdType('myth_bust', 'Myth-bust / education', 'Teach the right way vs DIY mistakes.', [
                  '“3 mistakes that ruin a clean install…”',
                  '“Before you buy the cheapest option, watch this…”'
                ], 'Get a quick quote'),
                mkAdType('before_after', 'Before / after', 'Show transformation first, then explain.', [
                  '“Crooked → clean + level in 60 seconds.”',
                  '“This 1 change makes the room look finished.”'
                ], 'Book a slot'),
                mkAdType('tooling', 'Pro tools = pro result', 'Signal expertise with tools/process.', [
                  '“Here’s what pros use to get it perfect…”',
                  '“Why we measure twice (and what it prevents)”'
                ], 'Schedule in minutes'),
                mkAdType('mini_demo', 'Mini-demo', 'Show one tight process step (clean + safe).', [
                  '“Watch how we keep it clean…”',
                  '“The safe way to do this in your home…”'
                ], 'Get pricing'),
                mkAdType('problem_story', 'Problem story', 'Call out an annoying pain and fix it.', [
                  '“If your setup wobbles, do this…”',
                  '“Stop living with the mess…”'
                ], 'See availability')
              ],
              bof_ad_types: [
                mkAdType('offer_stack', 'Offer stack', 'What’s included, clearly, with CTA.', [
                  `“${offerLabel}: what you get (and what you don’t).”`,
                  '“Everything included. No surprises.”'
                ], 'Book now'),
                mkAdType('objection_answer', 'Objection answer', 'Answer the top fear in one line.', [
                  '“Worried about mess? Here’s how we protect your home.”',
                  '“Surprise fees? Not here. Upfront quote.”'
                ], 'Get a quote'),
                mkAdType('review_push', 'Review-led retarget', 'Lead with the review, then the offer.', [
                  '“They nailed it — clean finish.”',
                  '“On time. Done right. Worth it.”'
                ], 'Claim a slot'),
                mkAdType('scarcity_slots', 'Slots scarcity', 'Real constraint urgency.', [
                  '“Limited installs this week.”',
                  '“Next openings: today + tomorrow.”'
                ], 'Check times'),
                mkAdType('price_value', 'Value vs price', 'Anchor value; keep it simple.', [
                  '“Bundle pricing beats à la carte.”',
                  '“Upfront pricing. Pro result.”'
                ], 'See pricing')
              ]
            };
          };

          let frameworks: any = null;
          if (openai) {
            const aiInput = {
              offer_id: offerId,
              offer_name: offerName,
              headline,
              line_items: lineItems,
              value_equation: {
                dream_outcome: safeString(rawOfferData?.dreamOutcome || rawOfferData?.dream_outcome || ''),
                perceived_likelihood: safeString(rawOfferData?.likelihoodOfAchievement || rawOfferData?.likelihood_of_achievement || ''),
                time_delay: safeString(rawOfferData?.timeDelay || rawOfferData?.time_delay || ''),
                effort_sacrifice: safeString(rawOfferData?.effortSacrifice || rawOfferData?.effort_sacrifice || '')
              },
              risk_reversal: safeString(rawOfferData?.riskReversal || rawOfferData?.risk_reversal || ''),
              scarcity_mechanism: safeString(rawOfferData?.scarcityMechanism || rawOfferData?.scarcity_mechanism || ''),
              price_hint: (rawOfferData && rawOfferData.totals && (rawOfferData.totals.customerPrice != null)) ? rawOfferData.totals.customerPrice : null,
              offer_data: rawOfferData,
              db_offer_row: offerRow
            };

            const prompt = `You are a senior direct-response creative strategist for Home2Smart (home services: TV mounting, cameras, doorbells, smart home installs).\n\nTask: Create a compact offer-specific framework for ads that helps a creative team ship high-converting assets quickly.\n\nPROMO / PSYCHOLOGY GUARDRAILS (do not ignore):\n- Specificity beats hype: use concrete outcomes, inclusions, and constraints.\n- Credibility: use proof mechanisms (process, reviews, before/after, guarantees/risk reversal if provided). Avoid unverifiable superlatives.\n- Friction reduction: address top objections (mess, damage, timing, price surprises, trust).\n- Ethical urgency only: no fake countdowns, no false scarcity, no misleading claims.\n- Value framing: increase desirability (dream outcome), increase perceived likelihood, reduce time-to-result, reduce effort/sacrifice — using the INPUT_JSON fields when available.\n\nIMPORTANT: A framework is NOT generic labels. It must include 2 short guidance sentences that are conditional to THIS offer:\n- tof_guidance: 1 sentence telling what to lead with at TOF.\n- bof_guidance: 1 sentence telling what to lead with at BOF (include price/conditions/timeframe language only if present in the offer).\n\nReturn VALID JSON ONLY (no markdown) in exactly this shape:\n\n{\n  "version": "h2s_offer_frameworks_v1",\n  "generated_at": "ISO-8601 string",\n  "summary": "string (<=200 chars)",\n  "tof_guidance": "string (1 sentence)",\n  "bof_guidance": "string (1 sentence)",\n  "offer_snapshot": {\n    "offer_id": "string",\n    "offer_name": "string",\n    "headline": "string",\n    "includes": "string"\n  },\n  "pillars": [\n    {\n      "key": "offer_clarity|objection_killer|price_anchor|proof|scarcity|hook",\n      "title": "string",\n      "goal": "string",\n      "softly_filled": ["string"],\n      "hook_lines": ["string"],\n      "asset_notes": ["string"]\n    }\n  ],\n  "tof_ad_types": [\n    {\n      "key": "string",\n      "title": "string",\n      "premise": "string",\n      "hook_templates": ["string"],\n      "primary_text_examples": ["string"],\n      "cta": "string",\n      "asset_notes": ["string"]\n    }\n  ],\n  "bof_ad_types": [\n    {\n      "key": "string",\n      "title": "string",\n      "premise": "string",\n      "hook_templates": ["string"],\n      "primary_text_examples": ["string"],\n      "cta": "string",\n      "asset_notes": ["string"]\n    }\n  ]\n}\n\nRules:\n- Keep copy short and concrete. No hype. No emojis.\n- TOF: curiosity/education/problem; avoid heavy price talk.\n- BOF: clarity, proof, objections, light urgency; can mention price if it’s part of offer clarity.\n- Premises and examples must clearly tie to the offer snapshot (service/inclusions/location/timing) rather than generic home-service lines.\n- Provide exactly 6 pillars, exactly 5 TOF ad types, exactly 5 BOF ad types.\n\nINPUT_JSON:\n${JSON.stringify(aiInput)}`;

            const completion = await openai.chat.completions.create({
              model: process.env.OPENAI_OFFER_MODEL || 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are rigorous. Return valid JSON only.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.2,
              max_tokens: 1800,
              response_format: { type: 'json_object' }
            });

            try {
              frameworks = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
            } catch {
              frameworks = null;
            }
          }

          if (!frameworks || typeof frameworks !== 'object') {
            frameworks = fallbackFrameworks();
          }

          // Normalize required fields
          frameworks.version = 'h2s_offer_frameworks_v1';
          frameworks.generated_at = generatedAt;
          if (!frameworks.summary) {
            try {
              const s = safeString(frameworks.offer_snapshot?.headline || '') || safeString(headline || '') || safeString(offerName || '');
              frameworks.summary = compact(s, 200);
            } catch {
              frameworks.summary = '';
            }
          }
          if (!frameworks.tof_guidance) frameworks.tof_guidance = safeString(frameworks.tofGuidance || '');
          if (!frameworks.bof_guidance) frameworks.bof_guidance = safeString(frameworks.bofGuidance || '');
          if (!frameworks.offer_snapshot) frameworks.offer_snapshot = {};
          frameworks.offer_snapshot.offer_id = offerId;
          frameworks.offer_snapshot.offer_name = frameworks.offer_snapshot.offer_name || offerName || '';

          // Merge into existing AI_Analysis
          let existingAi: any = offerRow.AI_Analysis;
          if (typeof existingAi === 'string') {
            try { existingAi = JSON.parse(existingAi); } catch { existingAi = {}; }
          }
          if (!existingAi || typeof existingAi !== 'object') existingAi = {};
          existingAi.offer_frameworks = frameworks;

          const updateOfferFrameworks = async (db: any) => {
            return await db
              .from('Offers')
              .update({ AI_Analysis: existingAi, Updated_At: new Date().toISOString() })
              .eq('Offer_ID', offerId)
              .select('Offer_ID, Updated_At, AI_Analysis')
              .single();
          };

          let { data: updatedOffer, error: updErr } = await updateOfferFrameworks(primary);
          if (updErr && isOffersSchemaMismatchError(updErr)) {
            ({ data: updatedOffer, error: updErr } = await updateOfferFrameworks(fallback));
          }

          if (updErr) {
            return NextResponse.json({ ok: false, error: `Failed to save frameworks: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = {
            offerId,
            updatedAt: updatedOffer.Updated_At,
            frameworks
          };
        }

      case 'saveOfferFrameworkChart':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const offerId = safeTrim(body?.offerId || body?.offer_id || body?.id || '');
          if (!offerId) {
            return NextResponse.json({ ok: false, error: 'Offer ID required' }, { status: 400, headers: corsHeaders(request) });
          }

          const chartRaw = body?.chart;
          const chart = (chartRaw && typeof chartRaw === 'object' && !Array.isArray(chartRaw)) ? chartRaw : null;
          if (!chart) {
            return NextResponse.json({ ok: false, error: 'chart object required' }, { status: 400, headers: corsHeaders(request) });
          }

          const { primary, fallback } = getOffersDbFallback();
          const loadOffer = async (db: any) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, AI_Analysis')
              .eq('Offer_ID', offerId)
              .maybeSingle();
          };

          let { data: offerRow, error: offerErr } = await loadOffer(primary);
          if (offerErr && isOffersSchemaMismatchError(offerErr)) {
            ({ data: offerRow, error: offerErr } = await loadOffer(fallback));
          }

          if (offerErr) {
            return NextResponse.json({ ok: false, error: `Failed to load offer: ${offerErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          if (!offerRow) {
            return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const createdBy = safeTrim((offerRow as any)?.Created_By).toUpperCase();
          const meUser = safeTrim(me.username).toUpperCase();
          if (me.role !== 'ADMIN' && createdBy && meUser && createdBy !== meUser) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403, headers: corsHeaders(request) });
          }

          const parseMaybeJson = (v: any) => {
            if (v == null) return null;
            if (typeof v === 'string') {
              try { return JSON.parse(v || '{}'); } catch { return null; }
            }
            if (typeof v === 'object') return v;
            return null;
          };

          const isPlainObject = (v: any) => {
            if (!v || typeof v !== 'object') return false;
            if (Array.isArray(v)) return false;
            const proto = Object.getPrototypeOf(v);
            return proto === Object.prototype || proto === null;
          };

          const deepMerge = (base: any, patch: any, depth = 0): any => {
            if (!isPlainObject(base)) base = {};
            if (!isPlainObject(patch)) return base;
            if (depth > 6) return { ...base, ...patch };
            const out: any = { ...base };
            for (const k of Object.keys(patch)) {
              const pv = (patch as any)[k];
              const bv = (base as any)[k];
              if (isPlainObject(pv) && isPlainObject(bv)) out[k] = deepMerge(bv, pv, depth + 1);
              else out[k] = pv;
            }
            return out;
          };

          let ai: any = parseMaybeJson((offerRow as any)?.AI_Analysis);
          if (!isPlainObject(ai)) ai = {};

          let frameworks: any = parseMaybeJson(ai.offer_frameworks);
          if (!isPlainObject(frameworks)) frameworks = {};

          const nowIso = new Date().toISOString();
          frameworks.chart = deepMerge(frameworks.chart, chart);
          frameworks.chart_updated_at = nowIso;

          ai.offer_frameworks = frameworks;

          const updateOffer = async (db: any) => {
            return await db
              .from('Offers')
              .update({ AI_Analysis: ai, Updated_At: nowIso })
              .eq('Offer_ID', offerId)
              .select('Offer_ID, Updated_At, AI_Analysis')
              .single();
          };

          let { data: updated, error: updErr } = await updateOffer(primary);
          if (updErr && isOffersSchemaMismatchError(updErr)) {
            ({ data: updated, error: updErr } = await updateOffer(fallback));
          }

          if (updErr) {
            return NextResponse.json({ ok: false, error: `Failed to save framework chart: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const updatedAi = parseMaybeJson((updated as any)?.AI_Analysis) || ai;
          const updatedFrameworks = (updatedAi && updatedAi.offer_frameworks) ? updatedAi.offer_frameworks : frameworks;
          return NextResponse.json(
            { ok: true, offerId, chart: (updatedFrameworks && updatedFrameworks.chart) ? updatedFrameworks.chart : frameworks.chart, offer_frameworks: updatedFrameworks },
            { headers: corsHeaders(request) }
          );
        }
        break;

      case 'saveOfferFrameworkModule':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const offerId = safeTrim(body?.offerId || body?.offer_id || body?.id || '');
          const stageRaw = safeTrim(body?.stage || body?.framework_stage || '');
          const moduleKey = safeTrim(body?.moduleKey || body?.module_key || body?.framework_ad_type_key || body?.key || '');
          const patchRaw = body?.patch;

          if (!offerId) {
            return NextResponse.json({ ok: false, error: 'Offer ID required' }, { status: 400, headers: corsHeaders(request) });
          }

          const stage = String(stageRaw || '').toLowerCase() === 'bof' ? 'bof' : 'tof';
          if (!moduleKey) {
            return NextResponse.json({ ok: false, error: 'moduleKey required' }, { status: 400, headers: corsHeaders(request) });
          }

          const { primary, fallback } = getOffersDbFallback();
          const loadOffer = async (db: any) => {
            return await db
              .from('Offers')
              .select('Offer_ID, Created_By, AI_Analysis')
              .eq('Offer_ID', offerId)
              .maybeSingle();
          };

          let { data: offerRow, error: offerErr } = await loadOffer(primary);
          if (offerErr && isOffersSchemaMismatchError(offerErr)) {
            ({ data: offerRow, error: offerErr } = await loadOffer(fallback));
          }

          if (offerErr) {
            return NextResponse.json({ ok: false, error: `Failed to load offer: ${offerErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          if (!offerRow) {
            return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const createdBy = safeTrim((offerRow as any)?.Created_By).toUpperCase();
          const meUser = safeTrim(me.username).toUpperCase();
          if (me.role !== 'ADMIN' && createdBy && meUser && createdBy !== meUser) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403, headers: corsHeaders(request) });
          }

          const parseMaybeJson = (v: any) => {
            if (v == null) return null;
            if (typeof v === 'string') {
              try { return JSON.parse(v || '{}'); } catch { return null; }
            }
            if (typeof v === 'object') return v;
            return null;
          };

          const isPlainObject = (v: any) => {
            if (!v || typeof v !== 'object') return false;
            if (Array.isArray(v)) return false;
            const proto = Object.getPrototypeOf(v);
            return proto === Object.prototype || proto === null;
          };

          const safeText = (v: any, max = 5000) => {
            const s = String(v == null ? '' : v);
            const t = s.trim().replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-');
            if (!t) return '';
            return t.length > max ? t.slice(0, max) : t;
          };

          const normalizePatch = (raw: any) => {
            const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
            const out: any = {};
            if ('idea_title' in src || 'ideaTitle' in src) out.idea_title = safeText((src as any).idea_title ?? (src as any).ideaTitle, 220);
            if ('hook' in src) out.hook = safeText((src as any).hook, 280);
            if ('primary_text' in src || 'primaryText' in src) out.primary_text = safeText((src as any).primary_text ?? (src as any).primaryText, 1800);
            if ('creative_direction' in src || 'creativeDirection' in src) out.creative_direction = safeText((src as any).creative_direction ?? (src as any).creativeDirection, 1800);
            if ('cta' in src) out.cta = safeText((src as any).cta, 180);
            return out;
          };

          let ai: any = parseMaybeJson((offerRow as any)?.AI_Analysis);
          if (!isPlainObject(ai)) ai = {};
          let frameworks: any = parseMaybeJson(ai.offer_frameworks);
          if (!isPlainObject(frameworks)) frameworks = {};
          if (!isPlainObject(frameworks.modules)) frameworks.modules = {};
          if (!isPlainObject(frameworks.modules[stage])) frameworks.modules[stage] = {};

          const nowIso = new Date().toISOString();
          const patch = normalizePatch(patchRaw);
          const existing = isPlainObject(frameworks.modules[stage][moduleKey]) ? frameworks.modules[stage][moduleKey] : {};
          const nextModule = {
            ...existing,
            ...patch,
            updated_at: nowIso,
            updated_by: safeTrim(me.username) || null
          };

          frameworks.modules[stage][moduleKey] = nextModule;
          frameworks.modules_updated_at = nowIso;
          ai.offer_frameworks = frameworks;

          const updateOffer = async (db: any) => {
            return await db
              .from('Offers')
              .update({ AI_Analysis: ai, Updated_At: nowIso })
              .eq('Offer_ID', offerId)
              .select('Offer_ID, Updated_At, AI_Analysis')
              .single();
          };

          let { data: updated, error: updErr } = await updateOffer(primary);
          if (updErr && isOffersSchemaMismatchError(updErr)) {
            ({ data: updated, error: updErr } = await updateOffer(fallback));
          }

          if (updErr) {
            return NextResponse.json({ ok: false, error: `Failed to save module: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          let updatedAi: any = parseMaybeJson((updated as any)?.AI_Analysis);
          if (!isPlainObject(updatedAi)) updatedAi = ai;
          let updatedFrameworks: any = parseMaybeJson(updatedAi.offer_frameworks);
          if (!isPlainObject(updatedFrameworks)) updatedFrameworks = frameworks;
          const updatedModule = (updatedFrameworks.modules && updatedFrameworks.modules[stage] && updatedFrameworks.modules[stage][moduleKey])
            ? updatedFrameworks.modules[stage][moduleKey]
            : nextModule;

          return NextResponse.json(
            { ok: true, offerId, stage, moduleKey, module: updatedModule, offer_frameworks: updatedFrameworks },
            { headers: corsHeaders(request) }
          );
        }
        break;

      case 'deleteOffer':
        // Delete an offer
        {
        const auth = await requireAdminToken(request);
        if (!auth.ok) {
          return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
        }

        if (!body.offerId) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Offer ID required' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const { error: deleteError } = await getSupabase()
          .from('Offers')
          .delete()
          .eq('Offer_ID', body.offerId);

        if (deleteError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to delete offer: ${deleteError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }

        result = { deleted: true, offerId: body.offerId };
        break;
        }

      case 'purgeTexasOffers':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const apply = body?.apply === true;
          const limit = Math.max(1, Math.min(5000, Number(body?.limit || 1000) || 1000));
          const reason = safeTrim(body?.reason || 'purgeTexasOffers');

          const db = getSupabase();

          // Pull a broad slice; this is an admin maintenance endpoint.
          const { data: rows, error } = await db
            .from('Offers')
            .select('Offer_ID, Offer_Name, Created_By, Status, Updated_At, Created_At, Message_Context, AI_Analysis')
            .order('Updated_At', { ascending: false })
            .limit(limit);

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to load offers: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          const list = Array.isArray(rows) ? rows : [];
          const matches = list.filter((r) => isLikelyTexasSeedOffer(r));
          const ids = matches.map((r) => safeTrim(r?.Offer_ID)).filter(Boolean);

          // Always return a preview list (first 50) so operators can verify without UI changes.
          const preview = matches.slice(0, 50).map((r) => ({
            offerId: safeTrim(r?.Offer_ID),
            name: safeTrim(r?.Offer_Name),
            createdBy: safeTrim(r?.Created_By),
            status: safeTrim(r?.Status),
            updatedAt: safeTrim(r?.Updated_At || r?.Created_At)
          }));

          if (!apply) {
            return NextResponse.json(
              { ok: true, apply: false, reason, scanned: list.length, matches: ids.length, preview },
              { headers: corsHeaders(request) }
            );
          }

          // Apply deletion in small chunks to avoid request limits.
          const chunkSize = 50;
          let deleted = 0;
          const errors: Array<{ offerId: string; error: string }> = [];

          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            if (!chunk.length) continue;

            const { error: delErr } = await db
              .from('Offers')
              .delete()
              .in('Offer_ID', chunk);

            if (delErr) {
              // If the chunk fails, try individually to isolate.
              for (const offerId of chunk) {
                const { error: oneErr } = await db
                  .from('Offers')
                  .delete()
                  .eq('Offer_ID', offerId);
                if (oneErr) errors.push({ offerId, error: oneErr.message });
                else deleted++;
              }
            } else {
              deleted += chunk.length;
            }
          }

          return NextResponse.json(
            { ok: true, apply: true, reason, scanned: list.length, matches: ids.length, deleted, errors, preview },
            { headers: corsHeaders(request) }
          );
        }

      case 'purge_old_data':
        {
          const auth = await requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const minDate = body?.min_date;
          if (!minDate) {
            return NextResponse.json(
              { ok: false, error: 'min_date is required (format: YYYY-MM-DD)' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          // Validate date format
          const dateObj = new Date(minDate);
          if (isNaN(dateObj.getTime())) {
            return NextResponse.json(
              { ok: false, error: 'Invalid date format. Use YYYY-MM-DD' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const db = getTrackingDb();
          
          // First, count how many records will be deleted
          const { count: deleteCount, error: countError } = await db
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true })
            .lt('occurred_at', minDate);

          if (countError) {
            return NextResponse.json(
              { ok: false, error: `Failed to count old records: ${countError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          // Delete old records
          const { error: deleteError } = await db
            .from('h2s_tracking_events')
            .delete()
            .lt('occurred_at', minDate);

          if (deleteError) {
            return NextResponse.json(
              { ok: false, error: `Failed to purge old data: ${deleteError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = { 
            ok: true, 
            deleted_count: deleteCount || 0,
            min_date: minDate,
            purged_at: new Date().toISOString()
          };
        }
        break;

      case 'adCreativeUpsert':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const creativeId = safeTrim(body?.creative_id || body?.creativeId || body?.id || '');
          const title = safeTrim(body?.title || body?.name || '');
          const service = safeTrim(body?.service || '');
          const stageRaw = safeTrim(body?.stage || 'tof').toLowerCase();
          const format = safeTrim(body?.format || '');
          const statusRaw = safeTrim(body?.status || 'draft').toLowerCase();
          const brief = safeTrim(body?.brief || body?.description || '');
          const bodyJson = (body?.body_json != null) ? body.body_json : (body?.bodyJson != null ? body.bodyJson : null);
          const force = ['1', 'true', 'yes', 'on'].includes(String(body?.force || '').toLowerCase());

          if (!title) {
            return NextResponse.json({ ok: false, error: 'title required' }, { status: 400, headers: corsHeaders(request) });
          }

          const stage = (stageRaw === 'tof' || stageRaw === 'mof' || stageRaw === 'bof') ? stageRaw : 'tof';
          const status = (statusRaw === 'draft' || statusRaw === 'ready' || statusRaw === 'running' || statusRaw === 'archived') ? statusRaw : 'draft';

          if (!creativeId) {
            if (!force) {
              let dupeQ: any = db
                .from('ad_creatives')
                .select('creative_id,title,service,stage,updated_at')
                .ilike('title', title)
                .eq('stage', stage)
                .limit(5);
              if (service) dupeQ = dupeQ.eq('service', service);

              const { data: dupes } = await dupeQ;
              if (Array.isArray(dupes) && dupes.length) {
                return NextResponse.json(
                  { ok: false, error: 'possible_duplicate', duplicates: dupes },
                  { status: 409, headers: corsHeaders(request) }
                );
              }
            }

            const createdBy = safeTrim(me.displayName || me.username || '');
            const insertPayload: any = {
              title,
              service: service || null,
              stage,
              format: format || null,
              status,
              brief: brief || null,
              body_json: bodyJson,
              created_by: createdBy || null
            };

            const { data: inserted, error } = await db
              .from('ad_creatives')
              .insert(insertPayload)
              .select('*')
              .single();

            if (error) {
              return NextResponse.json({ ok: false, error: `Failed to create creative: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
            }

            return NextResponse.json({ ok: true, creative: inserted }, { headers: corsHeaders(request) });
          }

          if (!isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id must be uuid' }, { status: 400, headers: corsHeaders(request) });
          }

          const updatePayload: any = {
            title,
            service: service || null,
            stage,
            format: format || null,
            status,
            brief: brief || null,
            body_json: bodyJson
          };

          const { data: updated, error: updErr } = await db
            .from('ad_creatives')
            .update(updatePayload)
            .eq('creative_id', creativeId)
            .select('*')
            .single();

          if (updErr) {
            return NextResponse.json({ ok: false, error: `Failed to update creative: ${updErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, creative: updated }, { headers: corsHeaders(request) });
        }

      case 'adCreativeAttachAsset':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const creativeId = safeTrim(body?.creative_id || body?.creativeId || '');
          if (!creativeId || !isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const asset = (body?.asset && typeof body.asset === 'object') ? body.asset : body;
          const url = safeTrim(asset?.url || '');
          const storageBucket = safeTrim(asset?.storage_bucket || asset?.storageBucket || asset?.bucket || '');
          const storagePath = safeTrim(asset?.storage_path || asset?.storagePath || asset?.path || '');
          const mediaKindRaw = safeTrim(asset?.media_kind || asset?.mediaKind || 'other').toLowerCase();
          const media_kind = (mediaKindRaw === 'photo' || mediaKindRaw === 'video' || mediaKindRaw === 'doc' || mediaKindRaw === 'text' || mediaKindRaw === 'other') ? mediaKindRaw : 'other';
          const contentType = safeTrim(asset?.content_type || asset?.contentType || asset?.mime || '');
          const contentHash = safeTrim(asset?.content_hash || asset?.contentHash || '');

          const widthPx = Number(asset?.width_px ?? asset?.widthPx);
          const heightPx = Number(asset?.height_px ?? asset?.heightPx);
          const durationSeconds = Number(asset?.duration_seconds ?? asset?.durationSeconds);
          const fileSizeKb = Number(asset?.file_size_kb ?? asset?.fileSizeKb);

          if (!url && !(storageBucket && storagePath)) {
            return NextResponse.json({ ok: false, error: 'asset must include url or (storage_bucket + storage_path)' }, { status: 400, headers: corsHeaders(request) });
          }

          const slotKey = safeTrim(body?.slot_key || body?.slotKey || '');
          const notes = safeTrim(body?.notes || '');
          const sortOrder = Number(body?.sort_order ?? body?.sortOrder ?? 100) || 100;

          const findExisting = async () => {
            if (contentHash) {
              const { data } = await db.from('ad_assets').select('*').eq('content_hash', contentHash).maybeSingle();
              if (data) return data;
            }
            if (storageBucket && storagePath) {
              const { data } = await db.from('ad_assets').select('*').eq('storage_bucket', storageBucket).eq('storage_path', storagePath).maybeSingle();
              if (data) return data;
            }
            if (url) {
              const { data } = await db.from('ad_assets').select('*').eq('url', url).maybeSingle();
              if (data) return data;
            }
            return null;
          };

          let existing = await findExisting();
          let assetRow: any = existing;
          let deduped = !!existing;

          if (!assetRow) {
            const insertPayload: any = {
              url: url || null,
              storage_bucket: storageBucket || null,
              storage_path: storagePath || null,
              media_kind,
              content_type: contentType || null,
              content_hash: contentHash || null,
              width_px: Number.isFinite(widthPx) ? widthPx : null,
              height_px: Number.isFinite(heightPx) ? heightPx : null,
              duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
              file_size_kb: Number.isFinite(fileSizeKb) ? fileSizeKb : null
            };

            const { data: inserted, error } = await db.from('ad_assets').insert(insertPayload).select('*').single();
            if (error) {
              const again = await findExisting();
              if (!again) {
                return NextResponse.json({ ok: false, error: `Failed to create asset: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
              }
              assetRow = again;
              deduped = true;
            } else {
              assetRow = inserted;
            }
          }

          const assetId = safeTrim(assetRow?.asset_id || assetRow?.Asset_ID || '');
          if (!assetId || !isUuid(assetId)) {
            return NextResponse.json({ ok: false, error: 'Invalid asset_id after upsert' }, { status: 500, headers: corsHeaders(request) });
          }

          const linkPayload: any = {
            creative_id: creativeId,
            asset_id: assetId,
            slot_key: slotKey || null,
            notes: notes || null,
            sort_order: sortOrder
          };

          const { error: linkErr } = await db
            .from('ad_creative_assets')
            .upsert(linkPayload, { onConflict: 'creative_id,asset_id' });

          if (linkErr) {
            return NextResponse.json({ ok: false, error: `Failed to attach asset: ${linkErr.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, creative_id: creativeId, asset: assetRow, deduped }, { headers: corsHeaders(request) });
        }

      case 'adAssetUploadInit':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          // Use the MGMT/Deliverables DB client since Ad Resources live there.
          const db = getDeliverablesDb();

          const bucket = safeTrim(body?.bucket || 'proof') || 'proof';
          const filenameRaw = safeTrim(body?.filename || body?.name || 'upload');
          const contentType = safeTrim(body?.content_type || body?.contentType || body?.mime || '') || 'application/octet-stream';

          // Keep paths predictable + safe. Bucket must already exist.
          const sanitize = (s: string) => {
            const base = String(s || 'upload').trim();
            const cleaned = base.replace(/[^a-zA-Z0-9._\- ]+/g, '').replace(/\s+/g, '_');
            return cleaned || 'upload';
          };

          const filename = sanitize(filenameRaw);
          const now = new Date();
          const y = String(now.getUTCFullYear());
          const m = String(now.getUTCMonth() + 1).padStart(2, '0');
          const d = String(now.getUTCDate()).padStart(2, '0');
          const nonce = randomTokenBase64Url(12);
          const path = `ad_resources/${y}-${m}-${d}/${nonce}_${filename}`;

          let signed: any = null;
          try {
            // Supabase JS v2 returns { data: { signedUrl, path, token }, error }
            const { data, error } = await (db as any).storage.from(bucket).createSignedUploadUrl(path, { upsert: false, contentType });
            if (error) {
              return NextResponse.json({ ok: false, error: `Failed to sign upload: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
            }
            signed = data;
          } catch (e: any) {
            return NextResponse.json({ ok: false, error: e?.message || 'Failed to sign upload' }, { status: 500, headers: corsHeaders(request) });
          }

          const signedUrl = safeTrim(signed?.signedUrl || signed?.signed_url || '');
          const outPath = safeTrim(signed?.path || path);
          if (!signedUrl || !outPath) {
            return NextResponse.json({ ok: false, error: 'Failed to sign upload (missing signedUrl/path)' }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, bucket, path: outPath, signed_url: signedUrl }, { headers: corsHeaders(request) });
        }

      case 'adCreativeSetTags':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const creativeId = safeTrim(body?.creative_id || body?.creativeId || '');
          if (!creativeId || !isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const tagsRaw = Array.isArray(body?.tags) ? body.tags : [];
          const kind = safeTrim(body?.kind || 'general') || 'general';
          const replace = ['1', 'true', 'yes', 'on'].includes(String(body?.replace || '').toLowerCase());

          const tags = Array.from(
            new Set(
              tagsRaw
                .map((t: any) => safeTrim(t).toLowerCase())
                .filter(Boolean)
                .slice(0, 30)
            )
          );

          if (replace) {
            const { error: delErr } = await db.from('ad_creative_tags').delete().eq('creative_id', creativeId);
            if (delErr) {
              return NextResponse.json({ ok: false, error: `Failed to clear tags: ${delErr.message}` }, { status: 500, headers: corsHeaders(request) });
            }
          }

          const ensured: any[] = [];
          for (const name of tags) {
            let { data: tagRow } = await db.from('ad_tags').select('tag_id,name,kind').eq('name', name).maybeSingle();
            if (!tagRow) {
              const { data: inserted, error: insErr } = await db
                .from('ad_tags')
                .insert({ name, kind })
                .select('tag_id,name,kind')
                .single();
              if (insErr) {
                const { data: again } = await db.from('ad_tags').select('tag_id,name,kind').eq('name', name).maybeSingle();
                if (!again) {
                  return NextResponse.json({ ok: false, error: `Failed to create tag "${name}": ${insErr.message}` }, { status: 500, headers: corsHeaders(request) });
                }
                tagRow = again;
              } else {
                tagRow = inserted;
              }
            }

            const tagId = safeTrim((tagRow as any)?.tag_id || '');
            if (tagId && isUuid(tagId)) {
              await db.from('ad_creative_tags').upsert({ creative_id: creativeId, tag_id: tagId }, { onConflict: 'creative_id,tag_id' });
              ensured.push(tagRow);
            }
          }

          return NextResponse.json({ ok: true, creative_id: creativeId, tags: ensured }, { headers: corsHeaders(request) });
        }

      case 'adCreativeLink':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const creativeId = safeTrim(body?.creative_id || body?.creativeId || '');
          if (!creativeId || !isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const offerId = safeTrim(body?.offer_id || body?.offerId || '');
          const deliverableId = safeTrim(body?.deliverable_id || body?.deliverableId || '');
          const frameworkVersion = safeTrim(body?.framework_version || body?.frameworkVersion || '');
          const frameworkStage = safeTrim(body?.framework_stage || body?.frameworkStage || '');
          const frameworkPillarKey = safeTrim(body?.framework_pillar_key || body?.frameworkPillarKey || '');
          const frameworkAdTypeKey = safeTrim(body?.framework_ad_type_key || body?.frameworkAdTypeKey || '');
          const notes = safeTrim(body?.notes || '');

          if (!offerId && !deliverableId && !frameworkAdTypeKey) {
            return NextResponse.json(
              { ok: false, error: 'Provide at least one link target (offer_id, deliverable_id, or framework_ad_type_key)' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const payload: any = {
            creative_id: creativeId,
            offer_id: offerId || null,
            deliverable_id: deliverableId || null,
            framework_version: frameworkVersion || null,
            framework_stage: frameworkStage || null,
            framework_pillar_key: frameworkPillarKey || null,
            framework_ad_type_key: frameworkAdTypeKey || null,
            notes: notes || null
          };

          const { data: inserted, error } = await db
            .from('ad_creative_links')
            .insert(payload)
            .select('*')
            .single();

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to link creative: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, link: inserted }, { headers: corsHeaders(request) });
        }

      case 'adCreativeUnlink':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const linkId = safeTrim(body?.link_id || body?.linkId || '');
          if (!linkId || !isUuid(linkId)) {
            return NextResponse.json({ ok: false, error: 'link_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const { error } = await db.from('ad_creative_links').delete().eq('link_id', linkId);
          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to unlink creative: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, link_id: linkId, deleted: true }, { headers: corsHeaders(request) });
        }

      case 'adCreativePerformanceUpsert':
        {
          const me = await getDashboardAuthUserFromSession(request);
          if (!me) {
            return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
          }

          const db = tasksDb;
          const creativeId = safeTrim(body?.creative_id || body?.creativeId || '');
          if (!creativeId || !isUuid(creativeId)) {
            return NextResponse.json({ ok: false, error: 'creative_id (uuid) required' }, { status: 400, headers: corsHeaders(request) });
          }

          const source = safeTrim(body?.source || 'meta') || 'meta';
          const periodStart = safeTrim(body?.period_start || body?.periodStart || '');
          const periodEnd = safeTrim(body?.period_end || body?.periodEnd || '');

          const payload: any = {
            creative_id: creativeId,
            source,
            period_start: periodStart || null,
            period_end: periodEnd || null,
            impressions: body?.impressions ?? null,
            clicks: body?.clicks ?? null,
            leads: body?.leads ?? null,
            spend: body?.spend ?? null,
            revenue: body?.revenue ?? null
          };

          const { data: row, error } = await db
            .from('ad_creative_performance')
            .upsert(payload, { onConflict: 'creative_id,source,period_start,period_end' })
            .select('*')
            .single();

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to upsert performance: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({ ok: true, performance: row }, { headers: corsHeaders(request) });
        }

      default:
        return invalidActionResponse(request, 'POST', action);
    }

    // Back-compat: keep `result`, but also return the named payload Dash.html expects.
    const payload: any = { ok: true, result, ...extraPayload };
    const responseAction = String(action || '');
    switch (responseAction) {
      case 'taskCreatorIntake':
        payload.taskCreatorIntake = result;
        break;
      case 'upsertTaskDraft':
        payload.upsertTaskDraft = result;
        break;
      case 'generateTaskDetails':
        payload.generateTaskDetails = result;
        break;
      case 'training':
        payload.training = result;
        break;
      case 'trainingCompletions':
        payload.trainingCompletions = result;
        break;
      case 'vaKnowledgeProfile':
        payload.vaKnowledgeProfile = result;
        break;
      case 'trainingAnalytics':
        payload.trainingAnalytics = result;
        break;
      case 'tasks':
        payload.tasks = result;
        break;
      case 'candidates':
        payload.candidates = result;
        break;
      case 'hours':
        payload.hours = result;
        break;
      case 'deliverables':
        payload.deliverables = result;
        break;
      case 'dashboardLogin':
        payload.dashboardLogin = result;
        break;
      case 'dashboardLogout':
        payload.dashboardLogout = result;
        break;
      case 'createDashboardUser':
        payload.createDashboardUser = result;
        break;
      case 'disableDashboardUser':
        payload.disableDashboardUser = result;
        break;
      case 'sendDashboardLoginInvite':
        payload.sendDashboardLoginInvite = result;
        break;
      case 'smsSend':
        payload.smsSend = result;
        break;
      case 'smsGroupSend':
        payload.smsGroupSend = result;
        break;
      case 'smsUpdateThread':
        payload.smsUpdateThread = result;
        break;
      case 'smsGroupUpsert':
        payload.smsGroupUpsert = result;
        break;
      case 'smsAdminInjectInbound':
        payload.smsAdminInjectInbound = result;
        break;
      case 'smsHideConversation':
        payload.smsHideConversation = result;
        break;
      default:
        break;
    }

    return NextResponse.json(payload, { headers: corsHeaders(request) });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }
}

/**
 * Update VA's knowledge profile based on training completion
 */
async function updateVaKnowledgeProfile(vaName: string, resourceId: string, aiAnalysis: any) {
  try {
    const supabaseMgmt = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    // Get or create profile
    const { data: existingProfile } = await supabaseMgmt
      .from('VA_Knowledge_Profiles')
      .select('*')
      .eq('VA_Name', vaName)
      .single();
    
    let profile = existingProfile;
    if (!profile) {
      const { data: newProfile } = await supabaseMgmt
        .from('VA_Knowledge_Profiles')
        .insert({
          VA_Name: vaName,
          Skill_Competencies: {},
          Top_Skill_Gaps: [],
          Recommended_Trainings: []
        })
        .select()
        .single();
      profile = newProfile;
    }
    
    // Get training resource to extract skills
    const { data: resource } = await supabaseMgmt
      .from('Training_Resources')
      .select('*')
      .eq('Resource_ID', resourceId)
      .single();
    
    // Parse existing competencies
    const competencies = profile?.Skill_Competencies || {};
    
    // Update skills from this training
    if (resource?.Skills_Taught) {
      const skills = resource.Skills_Taught.split(',').map((s: string) => s.trim());
      const confidenceScore = aiAnalysis?.confidenceScore || 70;
      
      skills.forEach((skill: string) => {
        if (!competencies[skill]) {
          competencies[skill] = {
            score: confidenceScore,
            lastUpdated: new Date().toISOString(),
            trainingCount: 1
          };
        } else {
          // Update existing skill (weighted average)
          const current = competencies[skill];
          competencies[skill] = {
            score: Math.round((current.score + confidenceScore) / 2),
            lastUpdated: new Date().toISOString(),
            trainingCount: current.trainingCount + 1
          };
        }
      });
    }
    
    // Calculate overall mastery score (average of all skills)
    const skillScores = Object.values(competencies).map((c: any) => c.score);
    const overallScore = skillScores.length > 0
      ? Math.round(skillScores.reduce((a: number, b: number) => a + b, 0) / skillScores.length)
      : 0;
    
    // Get total trainings count
    const { count: totalCount } = await supabaseMgmt
      .from('Training_Completions')
      .select('*', { count: 'exact', head: true })
      .eq('Completed_By', vaName);
    
    // Get total learning hours
    const { data: completions } = await supabaseMgmt
      .from('Training_Completions')
      .select('Time_Spent_Minutes')
      .eq('Completed_By', vaName);
    const totalMinutes = (completions || []).reduce((sum, c) => sum + (c.Time_Spent_Minutes || 0), 0);
    
    // Extract skill gaps from AI analysis
    const skillGaps = aiAnalysis?.knowledgeGaps || [];
    
    // Update profile
    await supabaseMgmt
      .from('VA_Knowledge_Profiles')
      .update({
        Skill_Competencies: competencies,
        Total_Trainings_Completed: totalCount || 0,
        Total_Learning_Hours: totalMinutes / 60,
        Overall_Mastery_Score: overallScore,
        Top_Skill_Gaps: skillGaps,
        Last_Analyzed_At: new Date().toISOString()
      })
      .eq('VA_Name', vaName);
    
  } catch (error) {
    console.error('Error updating VA knowledge profile:', error);
  }
}
