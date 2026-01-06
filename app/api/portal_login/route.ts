import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { issuePortalToken } from '@/lib/portalTokens';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function normalizeEmail(email: any): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeZip(zip: any): string {
  return String(zip || '').trim();
}

const PRO_TABLE_CANDIDATES = [
  // Mixed-case table (quoted identifier) in some Supabase projects.
    'H2S_Pros', // Added for actual dispatch pros table name recognition
  'h2s_dispatch_pros',
  'h2s_pros',
  'h2s_pro_profiles',
  'h2s_techs',
  'h2s_technicians',
];

const EMAIL_COLUMNS = ['email', 'Email', 'pro_email', 'tech_email'];
const ZIP_COLUMNS = ['zip', 'Zip', 'postal_code', 'zipcode', 'zip_code', 'home_zip'];
const ID_COLUMNS = ['pro_id', 'Pro_ID', 'id', 'tech_id', 'Tech_ID'];
const NAME_COLUMNS = ['name', 'full_name', 'pro_name', 'tech_name', 'display_name'];

async function tryFindPro(client: any, email: string, zip: string) {
  for (const table of PRO_TABLE_CANDIDATES) {
    // Try combinations of email+zip columns.
    for (const emailCol of EMAIL_COLUMNS) {
      for (const zipCol of ZIP_COLUMNS) {
        try {
          const { data, error } = await client
            .from(table)
            .select('*')
            .eq(emailCol as any, email)
            .eq(zipCol as any, zip)
            .limit(1);

          if (error) {
            continue;
          }

          const row = data?.[0];
          if (row) {
            return { table, row };
          }
        } catch {
          // ignore and continue
        }
      }

      // Fallback: email-only match (some tables may not store zip)
      try {
        const { data, error } = await client
          .from(table)
          .select('*')
          .eq(emailCol as any, email)
          .limit(1);

        if (error) {
          continue;
        }

        const row = data?.[0];
        if (row) {
          return { table, row };
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).length) return obj[k];
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const zip = normalizeZip(body?.zip);

    if (!email || !zip) {
      return NextResponse.json(
        { ok: false, error: 'Email and ZIP required', error_code: 'bad_request' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Dispatch database not configured (set SUPABASE_URL_DISPATCH / SUPABASE_SERVICE_KEY_DISPATCH)',
          error_code: 'dispatch_db_not_configured',
        },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    const hit = await tryFindPro(dispatchClient, email, zip);
    if (!hit) {
      return NextResponse.json(
        { ok: false, error: 'Account not found or ZIP mismatch', error_code: 'not_found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }

    const proId = String(pickFirst(hit.row, ID_COLUMNS) || email);
    const name = pickFirst(hit.row, NAME_COLUMNS) || '';

    const token = issuePortalToken({ sub: proId, role: 'pro', email });

    return NextResponse.json(
      {
        ok: true,
        token,
        pro: {
          pro_id: proId,
          email,
          name,
          source_table: hit.table,
        },
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal error', error_code: 'server_error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

// portal.html calls GET(action) which uses POST for portal_login, but allow GET too for manual testing.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const zip = searchParams.get('zip');
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ email, zip }),
    })
  );
}
