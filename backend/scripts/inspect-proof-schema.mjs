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

const url = String(input.url || '').trim().replace(/\/+$/, '');
const key = String(input.service_role_key || '').trim().replaceAll('\\', '');
const response = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/openapi+json' },
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error(`OpenAPI request failed: ${response.status}`);
const document = await response.json();
const wanted = new Set(['proof_packs', 'proof_assets', 'proof_slots']);
const output = {};
for (const [name, schema] of Object.entries(document.definitions || {})) {
  if (wanted.has(name)) output[name] = schema;
}
console.log(JSON.stringify(output, null, 2));
