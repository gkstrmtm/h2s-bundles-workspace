import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ulbzmgmxrqyipclrbohi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MDE3OSwiZXhwIjoyMDc4NjI2MTc5fQ.LdMPrz04SRxAJgin-vAgABi4vd8uUiKqjWZ6ZJ1t9B4';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Adding metadata_json column to h2s_dispatch_jobs...\n');

// Execute SQL via Supabase
const { data, error } = await supabase.rpc('exec', {
  sql: `
    ALTER TABLE h2s_dispatch_jobs 
    ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;
    
    CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_metadata 
    ON h2s_dispatch_jobs USING GIN (metadata_json);
  `
});

if (error) {
  console.error('❌ Error:', error.message);
} else {
  console.log('✅ Migration completed successfully');
}
