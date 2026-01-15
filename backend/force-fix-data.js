
const { createClient } = require('@supabase/supabase-js');
const url = "https://ulbzmgmxrqyipclrbohi.supabase.co";
// Service Role Key
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MDE3OSwiZXhwIjoyMDc4NjI2MTc5fQ.LdMPrz04SRxAJgin-vAgABi4vd8uUiKqjWZ6ZJ1t9B4";
const client = createClient(url, key);

const JOB_ID = 'f03abd56-19bf-4108-a1eb-7b027bd8c677';
const PRO_EMAIL = 'geraldbroome@gmail.com';

async function fix() {
  console.log('--- APPLYING DATA FIX ---');
  
  // 1. Fix Job Coordinates (Greenwood, SC approx)
  console.log(`Updating Job ${JOB_ID} with coordinates...`);
  const { error: jobError } = await client
    .from('h2s_dispatch_jobs')
    .update({ 
        geo_lat: 34.1954, 
        geo_lng: -82.1618,
        service_zip: '29649' // Ensure zip is set
    })
    .eq('job_id', JOB_ID);
    
  if (jobError) console.error('Job update failed:', jobError);
  else console.log('Job coordinates updated.');

  // 2. Fix Pro Radius (Boost to 100 miles)
  console.log(`Updating Pro ${PRO_EMAIL} radius to 100 miles...`);
  
  // Try all possible tables since the schema is fragmented
  await client.from('h2s_pros').update({ service_radius_miles: 100 }).eq('email', PRO_EMAIL);
  await client.from('H2S_Pros').update({ service_radius_miles: 100 }).eq('email', PRO_EMAIL);
  await client.from('h2s_pro_profiles').update({ radius_miles: 100 }).eq('email', PRO_EMAIL);
  await client.from('h2s_technicians').update({ radius: 100 }).eq('email', PRO_EMAIL);
  
  console.log('Pro radius updated.');
}

fix();
