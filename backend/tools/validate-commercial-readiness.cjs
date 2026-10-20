const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const ENV_FILES = ['.env.local', '.env.production.local', '.env.vercel.production', '.env'];
const loadedEnvFiles = [];

for (const rel of ENV_FILES) {
  const envPath = path.resolve(__dirname, '..', rel);
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath, override: true });
  loadedEnvFiles.push(rel);
}

const DEFAULT_BASE_URL = process.env.COMMERCIAL_VALIDATION_BASE_URL || 'http://127.0.0.1:3001';

function safeTrim(value) {
  return String(value || '').trim();
}

function hasEnv(name) {
  return Boolean(safeTrim(process.env[name]));
}

function summarizeEnv() {
  return {
    supabaseUrl: hasEnv('SUPABASE_URL'),
    supabaseServiceKey: hasEnv('SUPABASE_SERVICE_ROLE_KEY') || hasEnv('SUPABASE_SERVICE_KEY'),
    databaseUrl: hasEnv('DATABASE_URL'),
    twilioAccountSid: hasEnv('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: hasEnv('TWILIO_AUTH_TOKEN'),
    twilioFromNumber: hasEnv('TWILIO_FROM_NUMBER') || hasEnv('TWILIO_PHONE_NUMBER'),
    commercialCallNumber: hasEnv('COMMERCIAL_CALL_NUMBER') || hasEnv('PUBLIC_PHONE_NUMBER'),
    commercialSmsNumber: hasEnv('COMMERCIAL_SMS_NUMBER') || hasEnv('TWILIO_FROM_NUMBER') || hasEnv('TWILIO_PHONE_NUMBER'),
    commercialTechPhone: hasEnv('COMMERCIAL_CONSULTATION_TECH_PHONE') || hasEnv('COMMERCIAL_CONSULTATION_TECH_PHONES'),
    escalationPhones: hasEnv('COMMERCIAL_ESCALATION_PHONES') || hasEnv('DISPATCH_PHONES'),
    maintenanceToken: hasEnv('CRON_SECRET') || hasEnv('COMMERCIAL_MAINTENANCE_TOKEN'),
    twilioInboundWebhookUrl: hasEnv('TWILIO_INBOUND_SMS_WEBHOOK_URL'),
    twilioDisableSignatureValidation: safeTrim(process.env.TWILIO_DISABLE_SIGNATURE_VALIDATION) === '1',
    commercialPublicBaseUrl: hasEnv('COMMERCIAL_PUBLIC_BASE_URL') || hasEnv('PUBLIC_SITE_URL') || hasEnv('NEXT_PUBLIC_SITE_URL'),
  };
}

async function checkDirectDbConnection() {
  const url = safeTrim(process.env.DATABASE_URL);
  if (!url) {
    return { ok: false, error: 'missing DATABASE_URL' };
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query('select 1 as ok');
    await client.end();
    return { ok: true, row: result.rows[0] || null };
  } catch (error) {
    try { await client.end(); } catch {}
    return { ok: false, error: safeTrim(error && error.message) || 'db connection failed' };
  }
}

async function checkNamedConnection(label, connectionString) {
  const url = safeTrim(connectionString);
  if (!url) {
    return { label, ok: false, error: 'missing connection string' };
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query('select 1 as ok');
    await client.end();
    return { label, ok: true };
  } catch (error) {
    try { await client.end(); } catch {}
    return { label, ok: false, error: safeTrim(error && error.message) || 'connection failed' };
  }
}

async function checkDbPaths() {
  return Promise.all([
    checkNamedConnection('pooled', process.env.DATABASE_URL),
    checkNamedConnection('pooled_mgmt', process.env.DATABASE_URL_MGMT || process.env.DATABASE_URL),
    checkNamedConnection('direct', process.env.DATABASE_URL_DIRECT),
    checkNamedConnection('direct_mgmt', process.env.DATABASE_URL_MGMT_DIRECT || process.env.DATABASE_URL_DIRECT),
  ]);
}

const TABLES = [
  { name: 'commercial_leads', select: 'lead_id,revision,last_save_key' },
  { name: 'commercial_consultation_requests', select: 'request_id,submission_key' },
  { name: 'commercial_effects', select: 'request_id,kind,state' },
  { name: 'sms_threads', select: 'thread_id' },
  { name: 'sms_messages', select: 'message_id' },
  { name: 'owner_media_uploads', select: 'asset_id' },
];

async function checkTable(table, serviceKey) {
  const base = safeTrim(process.env.SUPABASE_URL).replace(/\/+$/, '');
  if (!base || !serviceKey) {
    return { table: table.name, ok: false, status: 0, error: 'missing SUPABASE_URL or service key' };
  }

  const url = `${base}/rest/v1/${table.name}?select=${encodeURIComponent(table.select)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  return {
    table: table.name,
    ok: response.ok,
    status: response.status,
    count: response.headers.get('content-range') || '',
    payload,
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: {
      contentType: response.headers.get('content-type') || '',
      cacheControl: response.headers.get('cache-control') || '',
    },
    payload,
  };
}

async function runSafeRouteProbes(baseUrl) {
  const missingToken = 'missing-readiness-token';
  const fakeSlot = '2026-12-01T15:00:00.000Z';
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnM8i8AAAAASUVORK5CYII=';
  const inboundBody = new URLSearchParams({
    From: '+15555550123',
    To: '+18645550123',
    Body: 'YES COM-ABC123',
    MessageSid: 'SM_test_readiness_probe',
  }).toString();

  const probes = {};
  probes.ownerMedia = await fetchJson(`${baseUrl}/api/owner-media/public?surface=commercial_intake&limit=4`);
  probes.intakeConfig = await fetchJson(`${baseUrl}/api/commercial-intake`);
  probes.intakeUnknownLead = await fetchJson(`${baseUrl}/api/commercial-intake?token=${encodeURIComponent(missingToken)}`);
  probes.intakeMissingContact = await fetchJson(`${baseUrl}/api/commercial-intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'Readiness Probe', serviceNeeds: ['Security Cameras'] }),
  });
  probes.photoUnknownLead = await fetchJson(`${baseUrl}/api/commercial-intake/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicToken: missingToken,
      filename: 'probe.png',
      mimetype: 'image/png',
      data: tinyPng,
    }),
  });
  probes.consultationMissingToken = await fetchJson(`${baseUrl}/api/commercial-consultation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedSlotStart: fakeSlot }),
  });
  probes.consultationUnknownLead = await fetchJson(`${baseUrl}/api/commercial-consultation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicToken: missingToken, selectedSlotStart: fakeSlot }),
  });
  probes.responseUnknownToken = await fetchJson(`${baseUrl}/api/commercial-consultation-response?token=${encodeURIComponent(missingToken)}`);
  probes.responseInvalidPost = await fetchJson(`${baseUrl}/api/commercial-consultation-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '', action: 'approve' }),
  });
  probes.maintenanceUnauthorized = await fetchJson(`${baseUrl}/api/commercial-consultation-maintenance`);
  probes.inboundSmsInvalidSignature = await fetchJson(`${baseUrl}/api/twilio/inbound-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'invalid-readiness-signature',
    },
    body: inboundBody,
  });

  return {
    baseUrl,
    probes,
    notes: [
      'No positive save, consultation-create, SMS-send, or call-placement probe is executed by this script.',
      'Unknown-token and missing-input probes are used to validate routing, validation, and failure semantics without intentionally sending live communications.',
    ],
  };
}

async function main() {
  const baseUrl = safeTrim(process.argv[2]) || DEFAULT_BASE_URL;
  const serviceKey = safeTrim(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  const env = summarizeEnv();
  const directDb = await checkDirectDbConnection();
  const dbPaths = await checkDbPaths();

  const tables = [];
  for (const table of TABLES) {
    tables.push(await checkTable(table, serviceKey));
  }

  const routes = await runSafeRouteProbes(baseUrl).catch((error) => ({
    baseUrl,
    error: safeTrim(error && error.message) || 'route probe failed',
  }));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    loadedEnvFiles,
    env,
    directDb,
    dbPaths,
    tables,
    routes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});