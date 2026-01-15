require('dotenv').config({ path: '.env.production.local' });

async function manuallyScheduleJob() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  MANUALLY TRIGGERING SCHEDULE-APPOINTMENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const orderId = 'ORD-1453D184';
  const sessionId = 'cs_live_a1v4HmLBXf2cg9Te8pjDKQ1ROeT5t0P5SVFviZne9qcmbYqkdIKCg2r0Cd';
  
  console.log(`Order ID: ${orderId}`);
  console.log(`Session ID: ${sessionId}\n`);
  console.log('Calling schedule-appointment endpoint...\n');
  
  try {
    // Test against newest deployment directly
const response = await fetch('https://backend-qg4t8mgh7-tabari-ropers-projects-6f2e090b.vercel.app/api/schedule-appointment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        session_id: sessionId,
        name: 'Tabari Roper',
        email: 'h2sbackend@gmail.com',
        phone: '8643239776',
        delivery_date: '2026-01-10',
        delivery_time: '10:00 AM - 12:00 PM',
      })
    });
    
    const data = await response.json();
    
    console.log('Response Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.ok) {
      console.log('\n✅ SUCCESS!');
      console.log(`   Job ID: ${data.job_id || 'N/A'}`);
      console.log(`   Payout: $${data.payout_estimated || 0}`);
    } else {
      console.log('\n❌ FAILED');
      console.log(`   Error: ${data.error || 'Unknown error'}`);
    }
    
  } catch (err) {
    console.error('\n❌ Request failed:', err.message);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

manuallyScheduleJob();
