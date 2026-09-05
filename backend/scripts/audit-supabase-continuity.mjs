const input = await new Promise((resolve, reject) => {
  let raw = '';
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (!/[\r\n]/.test(raw)) return;
    process.stdin.pause();
    try { resolve(JSON.parse(raw.trim())); } catch (error) { reject(error); }
  });
});

const timeout = () => AbortSignal.timeout(15000);
const clean = (value) => String(value || '').trim().replaceAll('\\', '');

async function inspect(label, urlValue, keyValue) {
  const url = clean(urlValue).replace(/\/+$/, '');
  const key = clean(keyValue);
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const specResponse = await fetch(`${url}/rest/v1/`, {
    headers: { ...headers, accept: 'application/openapi+json' },
    signal: timeout()
  });
  if (!specResponse.ok) throw new Error(`${label} OpenAPI request failed: ${specResponse.status}`);
  const spec = await specResponse.json();
  const tables = [];
  for (const name of Object.keys(spec.definitions || {}).sort()) {
    const response = await fetch(`${url}/rest/v1/${encodeURIComponent(name)}?select=*`, {
      method: 'HEAD',
      headers: { ...headers, prefer: 'count=exact', range: '0-0' },
      signal: timeout()
    });
    const range = response.headers.get('content-range') || '';
    const total = range.includes('/') ? range.split('/').at(-1) : null;
    tables.push({ name, rows: total === '*' || total === null ? null : Number(total), status: response.status });
  }
  const bucketsResponse = await fetch(`${url}/storage/v1/bucket`, { headers, signal: timeout() });
  const buckets = bucketsResponse.ok
    ? (await bucketsResponse.json()).map(({ id, name, public: isPublic, file_size_limit }) => ({ id, name, public: isPublic, file_size_limit }))
    : [{ error: `bucket inventory failed: ${bucketsResponse.status}` }];
  return { project: new URL(url).hostname.split('.')[0], tables, buckets };
}

const source = await inspect('source', input.source_url, input.source_service_role_key);
const destination = await inspect('destination', input.destination_url, input.destination_service_role_key);
console.log(JSON.stringify({ source, destination }, null, 2));
