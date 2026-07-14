import crypto from 'node:crypto';
import { getSupabase, getSupabaseMgmt } from '@/lib/supabase';

export type DashboardAuthUser = {
  userId: string;
  username: string;
  displayName: string;
  role: 'VA' | 'ADMIN';
};

const DASHBOARD_SESSION_TOKEN_HEADER = 'authorization';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const b64 = Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getDashboardDb() {
  try {
    return getSupabaseMgmt();
  } catch {
    return getSupabase();
  }
}

export function getBearerToken(request: Request): string {
  const raw = String(request.headers.get(DASHBOARD_SESSION_TOKEN_HEADER) || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = crypto.createHash('sha256').update(String(text || ''), 'utf8').digest();
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function getDashboardAuthUserFromSession(request: Request): Promise<DashboardAuthUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  const db = getDashboardDb();

  try {
    const tokenHash = await sha256Base64Url(token);

    const { data: session, error: sessionError } = await db
      .from('Dashboard_Sessions')
      .select('Session_ID, User_ID, Expires_At')
      .eq('Token_Hash', tokenHash)
      .maybeSingle();

    if (sessionError || !session) return null;

    const expiresAt = session.Expires_At ? new Date(session.Expires_At) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;

    const { data: user, error: userError } = await db
      .from('Dashboard_Users')
      .select('User_ID, Username, Display_Name, Role, Is_Disabled')
      .eq('User_ID', session.User_ID)
      .maybeSingle();

    if (userError || !user || user.Is_Disabled) return null;

    try {
      await db
        .from('Dashboard_Sessions')
        .update({ Last_Seen_At: new Date().toISOString() })
        .eq('Session_ID', session.Session_ID);
    } catch {
      // ignore best-effort last-seen updates
    }

    return {
      userId: String(user.User_ID),
      username: String(user.Username || '').trim().toUpperCase(),
      displayName: String(user.Display_Name || user.Username || '').trim(),
      role: String(user.Role || 'VA').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'VA',
    };
  } catch {
    return null;
  }
}