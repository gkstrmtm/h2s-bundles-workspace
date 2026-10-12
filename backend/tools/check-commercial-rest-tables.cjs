require('dotenv').config({ path: '.env.production.local' });

const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const selectByTable = {
  commercial_leads: 'lead_id',
  commercial_consultation_requests: 'request_id',
  sms_threads: 'thread_id',
  sms_messages: 'message_id',
  owner_media_uploads: 'asset_id',
};

async function checkTable(table) {
  const select = selectByTable[table] || '*';
  const url = `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
    table,
    status: response.status,
    ok: response.ok,
    count: response.headers.get('content-range') || '',
    payload,
  };
}

async function main() {
  const tables = [
    'commercial_leads',
    'commercial_consultation_requests',
    'sms_threads',
    'sms_messages',
    'owner_media_uploads',
  ];

  const results = [];
  for (const table of tables) {
    results.push(await checkTable(table));
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
