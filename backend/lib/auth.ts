/**
 * Centralized authentication for all portal routes.
 * NO FALLBACKS. NO SILENT FAILURES.
 */

import { NextRequest } from 'next/server';
import { getConfig } from './config';
import * as jose from 'jose';

export interface PortalTokenPayload {
  sub: string;        // pro_id
  role: 'pro';
  email: string;
  zip: string;
  iat: number;
  exp: number;
}

export interface AuthResult {
  ok: boolean;
  payload?: PortalTokenPayload;
  error?: string;
  errorCode?: string;
}

/**
 * Extract Bearer token from Authorization header or request body.
 */
export function extractToken(request: NextRequest | Request, body?: any): string | null {
  // Try header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Try body token field
  if (body?.token) {
    return body.token;
  }
  
  return null;
}

/**
 * Verify portal token using SUPABASE_SERVICE_KEY.
 * NO FALLBACK LOGIC.
 */
export async function verifyPortalToken(token: string): Promise<AuthResult> {
  const config = getConfig();
  
  if (!config.supabaseServiceKey) {
    console.error('[AUTH] FATAL: SUPABASE_SERVICE_KEY not configured');
    return {
      ok: false,
      error: 'Server configuration error: service key missing',
      errorCode: 'server_config_error'
    };
  }
  
  try {
    const secret = new TextEncoder().encode(config.supabaseServiceKey);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ['HS256']
    });
    
    // Validate required fields
    if (!payload.sub || payload.role !== 'pro') {
      return {
        ok: false,
        error: 'Invalid token payload',
        errorCode: 'invalid_token'
      };
    }
    
    return {
      ok: true,
      payload: payload as unknown as PortalTokenPayload
    };
  } catch (error: any) {
    console.error('[AUTH] Token verification failed:', error.message);
    return {
      ok: false,
      error: error.message.includes('expired') ? 'Token expired' : 'Invalid token',
      errorCode: error.message.includes('expired') ? 'token_expired' : 'invalid_token'
    };
  }
}

/**
 * Issue a new portal token.
 * Uses SUPABASE_SERVICE_KEY. Hard fails if not configured.
 */
export async function issuePortalToken(payload: {
  proId: string;
  email: string;
  zip: string;
}): Promise<string> {
  const config = getConfig();
  
  if (!config.supabaseServiceKey) {
    throw new Error('FATAL: Cannot issue token - SUPABASE_SERVICE_KEY not configured');
  }
  
  const secret = new TextEncoder().encode(config.supabaseServiceKey);
  
  const token = await new jose.SignJWT({
    sub: payload.proId,
    role: 'pro',
    email: payload.email,
    zip: payload.zip
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  
  return token;
}

/**
 * Require authentication for a route.
 * Returns payload if valid, throws with HTTP-ready error if not.
 */
export async function requireAuth(request: NextRequest | Request, body?: any): Promise<PortalTokenPayload> {
  const token = extractToken(request, body);
  
  if (!token) {
    throw new AuthError('Missing authorization token', 'missing_token', 401);
  }
  
  const result = await verifyPortalToken(token);
  
  if (!result.ok || !result.payload) {
    throw new AuthError(result.error || 'Authentication failed', result.errorCode || 'auth_failed', 401);
  }
  
  return result.payload;
}

/**
 * Custom error class for auth failures with HTTP status.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
