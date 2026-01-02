// COMPLETE API ENDPOINT AUDIT
// Maps every API call bundles.html makes to backend endpoints

const ENDPOINTS = [
  // Core Data Endpoints
  { name: 'Bundles Data (aggregated)', url: 'https://h2s-backend.vercel.app/api/bundles-data', method: 'GET', required: true },
  { name: 'Shop Catalog', url: 'https://h2s-backend.vercel.app/api/shop?action=catalog', method: 'GET', required: true },
  { name: 'Reviews', url: 'https://h2s-backend.vercel.app/api/reviews?limit=5&onlyVerified=true', method: 'GET', required: true },
  
  // Checkout Flow
  { name: 'Create Checkout Session', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'create_checkout_session'}, required: true },
  { name: 'Promo Validate (GET)', url: 'https://h2s-backend.vercel.app/api/promo_validate?code=TEST', method: 'GET', required: false },
  { name: 'Promo Check Cart (POST)', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'promo_check_cart'}, required: false },
  
  // User Authentication
  { name: 'Sign In', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'signin'}, required: false },
  { name: 'Create User', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'create_user'}, required: false },
  { name: 'Request Password Reset', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'request_password_reset'}, required: false },
  { name: 'Reset Password', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'reset_password'}, required: false },
  { name: 'Get User Info', url: 'https://h2s-backend.vercel.app/api/shop?action=user&email=test@test.com', method: 'GET', required: false },
  { name: 'Update User', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'upsert_user'}, required: false },
  { name: 'Change Password', url: 'https://h2s-backend.vercel.app/api/shop', method: 'POST', body: {__action: 'change_password'}, required: false },
  { name: 'Get Orders', url: 'https://h2s-backend.vercel.app/api/shop?action=orders&email=test@test.com', method: 'GET', required: false },
  
  // AI & Recommendations
  { name: 'AI Sales Recommendations', url: 'https://h2s-backend.vercel.app/api/shop?action=ai_sales&email=test@test.com&mode=recommendations', method: 'GET', required: false },
  
  // Appointment Scheduling
  { name: 'Schedule Appointment (V1)', url: 'https://h2s-backend.vercel.app/api/schedule-appointment', method: 'POST', required: true },
  { name: 'Get Availability', url: 'https://h2s-backend.vercel.app/api/get-availability', method: 'GET', required: false },
  
  // Analytics
  { name: 'Track Event', url: 'https://h2s-backend.vercel.app/api/track', method: 'POST', required: true },
  { name: 'Stats', url: 'https://h2s-backend.vercel.app/api/stats', method: 'GET', required: false },
  
  // Order Management
  { name: 'Order Pack', url: 'https://h2s-backend.vercel.app/api/shop?action=orderpack&session_id=test', method: 'GET', required: false },
  { name: 'Quote', url: 'https://h2s-backend.vercel.app/api/quote', method: 'POST', required: false }
];

async function auditAllEndpoints() {
  console.log('🔍 COMPLETE API ENDPOINT AUDIT\n');
  console.log('Testing ALL endpoints bundles.html actually calls:\n');
  console.log('=' .repeat(80) + '\n');

  const results = [];
  let criticalFailures = 0;

  for (const endpoint of ENDPOINTS) {
    const { name, url, method, body, required } = endpoint;
    
    process.stdout.write(`${required ? '🔴' : '🔵'} ${name}... `);
    
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (body && method === 'POST') {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);
      const isSuccess = res.status >= 200 && res.status < 400;
      
      let data;
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }

      if (isSuccess) {
        console.log(`✅ ${res.status}`);
        results.push({ name, status: 'PASS', code: res.status, required });
      } else {
        console.log(`❌ ${res.status} ${data?.error || ''}`);
        results.push({ name, status: 'FAIL', code: res.status, error: data?.error, required });
        if (required) criticalFailures++;
      }
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      results.push({ name, status: 'ERROR', error: err.message, required });
      if (required) criticalFailures++;
    }
  }

  // SUMMARY
  console.log('\n' + '='.repeat(80));
  console.log('📊 AUDIT SUMMARY\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status !== 'PASS').length;
  const criticalPassed = results.filter(r => r.required && r.status === 'PASS').length;
  const criticalTotal = results.filter(r => r.required).length;

  console.log(`Total Endpoints: ${ENDPOINTS.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🔴 Critical (required): ${criticalPassed}/${criticalTotal}\n`);

  // CRITICAL FAILURES
  if (criticalFailures > 0) {
    console.log('🚨 CRITICAL FAILURES (Required for basic functionality):\n');
    results.filter(r => r.required && r.status !== 'PASS').forEach(r => {
      console.log(`   ❌ ${r.name}`);
      console.log(`      Status: ${r.status}`);
      if (r.error) console.log(`      Error: ${r.error}`);
    });
    console.log('');
  }

  // MISSING FEATURES
  const optionalFailed = results.filter(r => !r.required && r.status !== 'PASS');
  if (optionalFailed.length > 0) {
    console.log('⚠️  OPTIONAL FEATURES NOT WORKING:\n');
    optionalFailed.forEach(r => {
      console.log(`   • ${r.name} (${r.status})`);
    });
    console.log('');
  }

  // PATTERN ANALYSIS
  console.log('🔍 PATTERN ANALYSIS:\n');
  
  const postFails = results.filter(r => r.status !== 'PASS' && r.name.includes('POST'));
  if (postFails.length > 0) {
    console.log(`   ⚠️  ${postFails.length} POST handlers failing`);
  }

  const shopActions = results.filter(r => r.name.includes('api/shop') && r.status !== 'PASS');
  if (shopActions.length > 0) {
    console.log(`   ⚠️  ${shopActions.length} /api/shop actions failing`);
  }

  const authFails = results.filter(r => (r.name.includes('User') || r.name.includes('Sign') || r.name.includes('Password')) && r.status !== 'PASS');
  if (authFails.length > 0) {
    console.log(`   ⚠️  ${authFails.length} authentication endpoints failing`);
  }

  console.log('\n' + '='.repeat(80));

  if (criticalFailures === 0) {
    console.log('✅ ALL CRITICAL ENDPOINTS WORKING');
    console.log('🎉 Core functionality should work');
  } else {
    console.log('❌ CRITICAL FAILURES DETECTED');
    console.log('🚨 Core functionality will NOT work');
  }

  console.log('\n');
  return criticalFailures === 0;
}

auditAllEndpoints().catch(console.error);
