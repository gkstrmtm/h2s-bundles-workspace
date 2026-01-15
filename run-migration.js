import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = 'https://vqbrqzhzuzqjlhqqxahz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxYnJxemh6dXpxamxocXF4YWh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNjI5NjU2MiwiZXhwIjoyMDUxODcyNTYyfQ.twX3EQj5dSI2FCRJEVn7WMT0jh6YmIDjDxe_VNFbSA8';

const supabase = createClient(supabaseUrl, supabaseKey);

const sql = readFileSync('./backend/migrations/add_metadata_to_jobs.sql', 'utf8');

console.log('Running migration...\n');
console.log(sql);
console.log('\n---\n');

const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

if (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}

console.log('✅ Migration completed successfully');
