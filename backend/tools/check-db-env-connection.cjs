const path = require('path');
const { Client } = require('pg');

async function tryFile(envFile) {
  const envPath = path.resolve(process.cwd(), envFile);
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_MGMT;
  require('dotenv').config({ path: envPath, override: true });
  const url = process.env.DATABASE_URL;
  if (!url) {
    return { envFile, ok: false, error: 'missing DATABASE_URL' };
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query('select 1 as ok');
    await client.end();
    return { envFile, ok: true, row: res.rows[0] };
  } catch (error) {
    try { await client.end(); } catch {}
    return { envFile, ok: false, error: error.message };
  }
}

(async () => {
  const files = ['.env.local', '.env.production.local', '.env.vercel.production'];
  const results = [];
  for (const file of files) {
    results.push(await tryFile(file));
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
