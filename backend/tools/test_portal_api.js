// Test the actual portal_jobs API endpoint to see what it returns
const fetch = require('node-fetch');
const fs = require('fs');

async function testPortalAPI() {
  console.log("🔍 Testing Portal Jobs API...\n");

  // Read env for API URL
  let apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  
  try {
    const dotenv = fs.readFileSync('.env.local', 'utf8');
    const lines = dotenv.split('\n');
    lines.forEach(line => {
      let [k, v] = line.split('=');
      if (k && v) {
        v = v.trim().replace(/^["']|["']$/g, '');
        if (k.trim() === 'NEXT_PUBLIC_API_URL') apiUrl = v;
      }
    });
  } catch (e) {}

  // Try both local and production
  const urls = [
    'http://localhost:3000/api/portal_jobs',
    'https://home2smart.vercel.app/api/portal_jobs',
    apiUrl + '/api/portal_jobs'
  ];

  for (const url of urls) {
    console.log(`\n📡 Testing: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // This is a test - would need real token from login
          'Authorization': 'Bearer test-token'
        }
      });

      console.log(`   Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 500));
      } else {
        const text = await response.text();
        console.log(`   Error: ${text.substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
  }
}

testPortalAPI();
