// const fetch = require('node-fetch'); // Built-in in Node 22

const TOKEN = "eyJzdWIiOiIyMDllMjM0My0xMzBjLTQ1YTItYjUyNi0wNjJhMTFmNzcwOWUiLCJyb2xlIjoicHJvIiwiZW1haWwiOiJnZXJhbGRicm9vbWVAZ21haWwuY29tIiwiaWF0IjoxNzY4MjQ5NDcyLCJleHAiOjE3Njg4NTQyNzJ9.Jyg5JNjNYL8I8WuzPHLImnQ6pNOyxXfz0BihRDATqKA";
const URL = "https://h2s-backend.vercel.app/api/portal_jobs?debug=1";

async function run() {
  console.log(`Hitting ${URL} with token...`);
  
  try {
    const res = await fetch(URL, {
      method: "POST", // Using POST as the original script did, but ensuring debug logic works
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: TOKEN, debug: true })
    });

    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log("================ RAW START ================");
    console.log(text);
    console.log("================ RAW END ==================");
    
    try {
      const data = JSON.parse(text);
      console.log('--- FULL RESPONSE DUMP ---');
      console.log(JSON.stringify(data, null, 2));
      console.log('--------------------------');

      if (data.debugData) {
        console.log('\n✅ DEBUG DATA RECEIVED');
        console.log('Raw Dispatch Jobs:', data.debugData.dispatch_jobs_raw);
        console.log('Jobs after Enrichment:', data.debugData.jobs_with_order_link);
        console.log('Jobs after Zip Match:', data.debugData.jobs_zip_match);
        console.log('Final Returned:', data.debugData.jobs_final_returned);
      } else {
        console.log('⚠️  No debugData found in response.');
      }

    } catch (e) {
      console.log('Raw Response (Not JSON):', text);
    }
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

run();
