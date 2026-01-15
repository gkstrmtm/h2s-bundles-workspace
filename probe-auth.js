
// const fetch = require('node-fetch'); // Native fetch in Node 18+

async function probe() {
    const API_BASE = 'https://h2s-backend.vercel.app/api';
    // const API_BASE = 'https://backend-h5cz0w7xr-tabari-ropers-projects-6f2e090b.vercel.app/api'; // Latest deployment specific

    console.log('--- PHASES 1: LOGIN ---');
    const loginRes = await fetch(`${API_BASE}/portal_login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'h2sbackend@gmail.com',
            zip: '29649'
        })
    });

    const loginData = await loginRes.json();
    console.log(`Login Status: ${loginRes.status}`);
    console.log('Login Body:', JSON.stringify(loginData, null, 2));

    if (!loginData.ok || !loginData.token) {
        console.error('FATAL: Login failed. Cannot proceed.');
        return;
    }

    const token = loginData.token;
    
    // Phase 1.5: Decode locally
    try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('\n--- PHASE 1.5: TOKEN DECODE ---');
        console.log('Payload:', payload);
    } catch (e) {
        console.error('Failed to decode token locally:', e.message);
    }

    console.log('\n--- PHASE 2: PORTAL_ME ---');
    const meUrl = `${API_BASE}/portal_me?token=${token}`;
    console.log(`GET ${meUrl}`);
    
    const meRes = await fetch(meUrl, {
        method: 'GET',
        headers: {
            // "Authorization": `Bearer ${token}` // Testing if header helps (it shouldn't based on code, but good to know)
        }
    });

    console.log(`Me Status: ${meRes.status}`);
    const meText = await meRes.text();
    console.log('Me Raw Body:', meText);

    try {
        const meJson = JSON.parse(meText);
        console.log('Me JSON:', JSON.stringify(meJson, null, 2));
    } catch {
        console.log('Me body was not JSON');
    }
}

// Node 18+ has built-in fetch, so we might not need require('node-fetch') if running in a modern env.
// If not, we'll see a crash and I'll adjust.
probe().catch(console.error);
