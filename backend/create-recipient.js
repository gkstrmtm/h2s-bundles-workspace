require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('\n✨ Creating new recipient for dispatch jobs...\n');
  
  const newRecipient = {
    recipient_key: `booking-recipient-${Date.now()}`,
    email_normalized: null,
    phone_e164: null,
    first_name: null,
    zip: null,
    marketing_opt_in: false
  };
  
  const { data, error } = await supabase
    .from('h2s_recipients')
    .insert(newRecipient)
    .select()
    .single();
    
  if (error) {
    console.error('❌ Failed to create recipient:', error);
  } else {
    console.log('✅ New recipient created!');
    console.log(`   recipient_id: ${data.recipient_id}`);
    console.log(`   recipient_key: ${data.recipient_key}`);
    console.log('\nYou can now use this recipient_id for new dispatch jobs.');
  }
}

main();
