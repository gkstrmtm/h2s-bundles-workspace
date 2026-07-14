import crypto from 'node:crypto';
import { getBearerToken, getDashboardAuthUserFromSession, type DashboardAuthUser } from '@/lib/dashboardAuth';

const OWNER_MEDIA_TOKEN_PREFIX = 'owner-media';
const OWNER_MEDIA_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const OWNER_MEDIA_SHARED_USER: DashboardAuthUser = {
  userId: 'owner-media-shared',
  username: 'OWNERMEDIA',
  displayName: 'Owner Uploads',
  role: 'VA',
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const b64 = Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function randomTokenBase64Url(length = 24): string {
  return bytesToBase64Url(new Uint8Array(crypto.randomBytes(length)));
}

function getOwnerMediaSecret(): string {
  return String(process.env.H2S_OWNER_MEDIA_SESSION_SECRET || process.env.H2S_OWNER_MEDIA_PIN || '8385').trim() || '8385';
}

function signOwnerMediaTokenBody(body: string): string {
  return crypto.createHmac('sha256', getOwnerMediaSecret()).update(body, 'utf8').digest('base64url');
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getOwnerMediaPin(): string {
  return String(process.env.H2S_OWNER_MEDIA_PIN || '8385').trim() || '8385';
}

export function createOwnerMediaSessionToken() {
  const expiresAtMs = Date.now() + OWNER_MEDIA_SESSION_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const nonce = randomTokenBase64Url(18);
  const body = `${OWNER_MEDIA_TOKEN_PREFIX}.${expiresAtMs}.${nonce}`;
  const signature = signOwnerMediaTokenBody(body);
  return {
    token: `${body}.${signature}`,
    expiresAt,
    me: OWNER_MEDIA_SHARED_USER,
  };
}

export function getOwnerMediaSessionUserFromToken(token: string): DashboardAuthUser | null {
  const value = String(token || '').trim();
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const [prefix, expiresAtRaw, nonce, signature] = parts;
  if (prefix !== OWNER_MEDIA_TOKEN_PREFIX || !expiresAtRaw || !nonce || !signature) return null;

  const expiresAtMs = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;

  const body = `${prefix}.${expiresAtRaw}.${nonce}`;
  const expectedSignature = signOwnerMediaTokenBody(body);
  if (!constantTimeEquals(expectedSignature, signature)) return null;

  return { ...OWNER_MEDIA_SHARED_USER };
}

export async function getOwnerMediaAuthUser(request: Request): Promise<DashboardAuthUser | null> {
  const dashboardUser = await getDashboardAuthUserFromSession(request);
  if (dashboardUser) return dashboardUser;

  const token = getBearerToken(request);
  if (!token) return null;
  return getOwnerMediaSessionUserFromToken(token);
}
