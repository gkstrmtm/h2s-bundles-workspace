require('dotenv').config({ path: '.env.production.local' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const sql = `
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'commercial_leads',
        'commercial_consultation_requests',
        'sms_threads',
        'sms_messages',
        'owner_media_uploads'
      )
    order by table_name
  `;
  const res = await client.query(sql);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
