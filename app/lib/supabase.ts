import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
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

// Get Supabase client for Database 1 (tracking events database)
export function getSupabaseDb1(): SupabaseClient | null {
  // Try to use Database 1 credentials if available
  const db1Url = process.env.SUPABASE_URL_DB1;
  const db1Key = process.env.SUPABASE_SERVICE_KEY_DB1;

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
