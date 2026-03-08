
const { Client } = require('pg');
require('dotenv').config({ path: 'c:\\Users\\tabar\\h2s-bundles-workspace\\backend\\.env.production.local' });

async function fixDataProperly() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('No DATABASE_URL found');
    return;
  }
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB.');
    
    // Check table name
    let tableName = 'Training_Resources'; 
    try {
        await client.query(`SELECT 1 FROM "${tableName}" LIMIT 1`);
    } catch {
        tableName = 'training_resources'; 
    }
    console.log(`Using table: "${tableName}"`);
    
    // Find Ad Gen Bootcamp
    // Use title (case sensitive quotes if mixed case)
    const searchRes = await client.query(`SELECT * FROM "${tableName}" WHERE "Title" ILIKE $1`, ['%Ad Gen Bootcamp%']);
    
    if (searchRes.rows.length === 0) {
        console.log('Ad Gen Bootcamp not found.');
        return;
    }
    
    const r = searchRes.rows[0];
    const id = r.Resource_ID || r.id;
    const titleCol = r.Title ? 'Title' : 'title';
    console.log(`Found: ${r[titleCol]} (${id})`);

    const originalUrl = 'https://www.youtube.com/watch?v=rXv2hBcIm4U&utm_source=chatgpt.com';
    
    // CORRECT STRUCTURE:
    // Assets = ["url1", "url2", "url3"]
    // Assets_Meta = { "url1": { title: "..." }, ... }
    
    const assets = [
        originalUrl,
        originalUrl.replace('?', '?part=2&'),
        originalUrl.replace('?', '?part=3&')
    ];
    
    const assetsMeta = {};
    assetsMeta[assets[0]] = { title: 'Part 1 - Introduction' };
    assetsMeta[assets[1]] = { title: 'Part 2 - Advanced Techniques' };
    assetsMeta[assets[2]] = { title: 'Part 3 - Scaling Up' };
    
    console.log('Updating Assets to:', JSON.stringify(assets, null, 2));
    console.log('Updating Assets_Meta to:', JSON.stringify(assetsMeta, null, 2));
    
    const idCol = r.Resource_ID ? 'Resource_ID' : 'id';
    
    // Update both columns
    // We need to be careful with column names casing. Usually prisma implies exact casing if quoted.
    // The previous script check revealed "Assets" and "Assets_Meta" columns existed (mixed case).
    
    const updateQ = `UPDATE "${tableName}" SET "Assets" = $1, "Assets_Meta" = $2 WHERE "${idCol}" = $3`;
    
    await client.query(updateQ, [JSON.stringify(assets), JSON.stringify(assetsMeta), id]);
    console.log('Update successful.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fixDataProperly();
