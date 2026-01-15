import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ GUARDRAIL: SINGLE DATABASE ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
// This project uses ONE Supabase database (SUPABASE_URL).
// All tables (orders, jobs, pros, payouts, etc.) are in the SAME database.
// 
// DO NOT create separate "dispatch" or "main" database assumptions!
// getSupabaseDispatch() falls back to getSupabase() when no separate
// SUPABASE_URL_DISPATCH env var exists (which is the normal case).
//
// If you see errors about "dispatch database not found", the fix is NOT
// to create separate credentials - the fix is to use getSupabase() or
// ensure getSupabaseDispatch() returns the main client (which it does).
// ═══════════════════════════════════════════════════════════════════════════

let supabaseInstance: SupabaseClient | null = null;
let supabaseMgmtInstance: SupabaseClient | null = null;
let supabaseInstanceDb1: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(`Missing Supabase credentials: URL=${!!supabaseUrl}, KEY=${!!supabaseServiceKey}`);
    }

    supabaseInstance = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  
  return supabaseInstance;
}

// Get Supabase client for Management Database (Candidates, Tasks, Hours, Training, VA Knowledge)
export function getSupabaseMgmt(): SupabaseClient {
  if (!supabaseMgmtInstance) {
    const mgmtUrl = process.env.SUPABASE_URL_MGMT;
    const mgmtKey = process.env.SUPABASE_SERVICE_KEY_MGMT || process.env.SUPABASE_SERVICE_ROLE_KEY_MGMT;

    if (!mgmtUrl || !mgmtKey) {
      throw new Error(`Missing Supabase Management DB credentials: URL=${!!mgmtUrl}, KEY=${!!mgmtKey}`);
    }

    supabaseMgmtInstance = createClient(mgmtUrl, mgmtKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  
  return supabaseMgmtInstance;
}

// Get Supabase client for Database 1 (tracking events database)
export function getSupabaseDb1(): SupabaseClient | null {
  // Try to use Database 1 credentials if available
  const db1Url = process.env.SUPABASE_URL_DB1;
  const db1Key = process.env.SUPABASE_SERVICE_KEY_DB1 || process.env.SUPABASE_SERVICE_ROLE_KEY_DB1;

  if (!db1Url || !db1Key) {
    // If no separate DB1 credentials, return null to use proxy approach
    return null;
  }

  if (!supabaseInstanceDb1) {
    supabaseInstanceDb1 = createClient(db1Url, db1Key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  
  return supabaseInstanceDb1;
}

// Get Supabase client for Dispatch / Portal Database
// Used by Pro Portal endpoints that operate on dispatch tables (jobs, assignments, payouts, etc.)
export function getSupabaseDispatch(): SupabaseClient | null {
  // USE THE SAME DATABASE - no separate dispatch URL needed
  return getSupabase();
}
