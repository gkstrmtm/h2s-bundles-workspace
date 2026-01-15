/**
 * Centralized configuration with hard failures.
 * NO FALLBACKS. NO SILENT DEFAULTS.
 * If required env vars are missing, the app MUST NOT start.
 */

interface AppConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  buildId: string;
  nodeEnv: string;
  supabaseHost: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`FATAL: Required environment variable ${key} is missing or empty. Application cannot start.`);
  }
  return value.trim();
}

function initConfig(): AppConfig {
  // Required env vars - hard fail if missing
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_KEY');
  
  // Build ID (set at build time, defaults only for local dev)
  const buildId = process.env.BUILD_ID || `local-dev-${Date.now()}`;
  
  // Node env
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Extract host from Supabase URL for health checks
  let supabaseHost = 'unknown';
  try {
    const url = new URL(supabaseUrl);
    supabaseHost = url.hostname;
  } catch {
    supabaseHost = 'invalid-url';
  }
  
  console.log('[CONFIG] Initialized:', {
    buildId,
    nodeEnv,
    supabaseHost,
    hasSupabaseKey: !!supabaseServiceKey
  });
  
  return {
    supabaseUrl,
    supabaseServiceKey,
    buildId,
    nodeEnv,
    supabaseHost
  };
}

// Initialize once on module load
let config: AppConfig;
try {
  config = initConfig();
} catch (error: any) {
  console.error('[CONFIG] FATAL ERROR:', error.message);
  // In production, this should crash the app
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  throw error;
}

export function getConfig(): AppConfig {
  return config;
}

export function isTokenSecretConfigured(): boolean {
  try {
    return !!config.supabaseServiceKey && config.supabaseServiceKey.length > 0;
  } catch {
    return false;
  }
}
