import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

async function validateLegacyProSession(client: any, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await client
      .from('h2s_sessions')
      .select('pro_id, expires_at')
      .eq('session_id', token)
      .single();

    if (error || !data) return null;
    if (data.expires_at && new Date() > new Date(data.expires_at)) return null;
    return data.pro_id ? String(data.pro_id) : null;
  } catch {
    return null;
  }
}

function normalizeAnnouncementRow(row: any) {
  const r = row && typeof row === 'object' ? row : {};
  const announcement_id =
    r.announcement_id ??
    r.announcementId ??
    r.id ??
    r.uuid ??
    r.announcement_uuid ??
    r.announcementID ??
    '';

  const title = typeof r.title === 'string' ? r.title : String(r.title ?? '');
  const message = typeof r.message === 'string' ? r.message : String(r.message ?? '');
  const type = typeof r.type === 'string' ? r.type : String(r.type ?? 'info');
  const priorityRaw = r.priority ?? r.priority_score ?? r.rank ?? 10;
  const priority = Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : 10;
  const video_url = typeof r.video_url === 'string' ? r.video_url : String(r.video_url ?? r.videoUrl ?? '');

  const created_at = r.created_at ?? r.createdAt ?? null;
  const created_by = r.created_by ?? r.createdBy ?? null;
  const expires_at = r.expires_at ?? r.expiresAt ?? null;

  const is_active =
    typeof r.is_active === 'boolean'
      ? r.is_active
      : typeof r.active === 'boolean'
        ? r.active
        : r.is_active === 'false'
          ? false
          : r.is_active === 'true'
            ? true
            : r.active === 'false'
              ? false
              : r.active === 'true'
                ? true
                : r.is_active ?? r.active ?? true;

  return {
    ...r,
    announcement_id: String(announcement_id),
    title,
    message,
    type,
    priority,
    video_url,
    created_at,
    created_by,
    expires_at,
    is_active,
  };
}

const VIEW_TABLE_CANDIDATES = [
  'h2s_dispatch_announcement_views',
  'h2s_dispatch_announcement_viewed',
  'h2s_announcement_views',
  'announcement_views',
  'h2s_dispatch_announcement_reads',
  'announcement_reads',
];

async function tryFetchViewedIds(client: any, params: { proId?: string; proEmail?: string }) {
  const proId = String(params.proId || '').trim();
  const proEmail = String(params.proEmail || '').trim();

  for (const table of VIEW_TABLE_CANDIDATES) {
    // Try common column combinations. If a table doesn't exist or columns mismatch, we just move on.
    const attempts: Array<{ col: string; value: string }> = [];
    if (proId) attempts.push({ col: 'pro_id', value: proId }, { col: 'viewer_id', value: proId }, { col: 'user_id', value: proId });
    if (proEmail) attempts.push({ col: 'pro_email', value: proEmail }, { col: 'viewer_email', value: proEmail }, { col: 'email', value: proEmail });

    for (const a of attempts) {
      try {
        const { data, error } = await client.from(table).select('*').eq(a.col as any, a.value).limit(500);
        if (error) continue;

        const ids = (data || [])
          .map((r: any) => r?.announcement_id ?? r?.announcementId ?? r?.id ?? r?.announcement_uuid ?? r?.announcementID)
          .filter((x: any) => x !== null && x !== undefined)
          .map((x: any) => String(x));

        if (ids.length) return { ok: true as const, ids, source_table: table };
        // Even if empty, we can treat it as a successful read.
        return { ok: true as const, ids: [], source_table: table };
      } catch {
        // try next
      }
    }
  }

  return { ok: false as const, ids: [] as string[] };
}

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';
    const isAdmin = (searchParams.get('admin') || '') === 'true';

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    // Accept both signed tokens and legacy UUID tokens
    const payload = verifyPortalToken(token);

    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      // Announcements are non-critical; return empty rather than erroring.
      return NextResponse.json({ ok: true, announcements: [], viewed_ids: [] }, { headers: corsHeaders(request) });
    }

    const sb: any = dispatchClient as any;

    // ==== Preferred path (legacy backend contract): h2s_announcements + h2s_announcement_views
    try {
      let proId: string | null = null;
      if (!isAdmin) {
        // Signed pro token OR legacy session in h2s_sessions
        if (payload?.role === 'pro' && payload?.sub) {
          proId = String(payload.sub);
        } else {
          proId = await validateLegacyProSession(sb, token);
        }
      }

      const nowIso = new Date().toISOString();
      let query = sb
        .from('h2s_announcements')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      // Filter by expiration
      query = query.or(`expires_at.is.null,expires_at.gt.${nowIso}`);

      const { data: announcements, error: announcementsError } = await query;

      if (!announcementsError) {
        let viewed_ids: string[] = [];
        if (proId) {
          try {
            const { data: views, error: viewsError } = await sb
              .from('h2s_announcement_views')
              .select('announcement_id')
              .eq('pro_id', proId);

            if (!viewsError && Array.isArray(views)) {
              viewed_ids = views
                .map((v: any) => v?.announcement_id)
                .filter((x: any) => x !== null && x !== undefined)
                .map((x: any) => String(x));
            }
          } catch {
            // ignore; fallback below
          }
        }

        return NextResponse.json(
          {
            ok: true,
            announcements: announcements || [],
            viewed_ids,
            source_table: 'h2s_announcements',
          },
          { headers: corsHeaders(request) }
        );
      }
    } catch {
      // fall through to schema-discovery path below
    }

    // Try common table names (prefer the one portal already subscribes to conceptually)
    const tableCandidates = [
      'h2s_dispatch_announcements',
      'dispatch_announcements',
      'h2s_portal_announcements',
      'portal_announcements',
      'team_announcements',
      'h2s_team_announcements',
      'h2s_announcements',
      'announcements',
    ];

    for (const table of tableCandidates) {
      try {
        const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false }).limit(200);

        if (!error) {
          const normalized = (data || []).map(normalizeAnnouncementRow);

          let viewed_ids: string[] = [];
          if (payload?.role === 'pro') {
            const viewed = await tryFetchViewedIds(sb, { proId: payload.sub, proEmail: payload.email });
            viewed_ids = viewed.ok ? viewed.ids : [];
          }

          return NextResponse.json(
            {
              ok: true,
              announcements: normalized,
              // If you later add a viewed table, we can fill this in.
              viewed_ids,
              source_table: table,
            },
            { headers: corsHeaders(request) }
          );
        }
      } catch {
        // try next
      }
    }

    // If no table exists, keep it non-blocking.
    return NextResponse.json({ ok: true, announcements: [], viewed_ids: [] }, { headers: corsHeaders(request) });
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg) || /format/i.test(msg);

    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}
