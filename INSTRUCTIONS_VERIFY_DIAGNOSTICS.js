
const fetch = require('node-fetch');

// CONFIG
const ENDPOINT = 'https://h2s-backend.vercel.app/api/portal_jobs';
const TOKEN = 'h2sbackend@gmail.com'; // Using email as token usually enabled for debug/dev in this project context, or update with real JWT if needed.
// Based on previous context, the "token" parameter often accepts the raw email or a simple token in dev modes, 
// but if real JWT is required, the user will need to provide it. 
// However, the previous code showed `verifyPortalToken(token)` which likely expects a JWT. 
// If this script fails with 401, we will need the user to paste a real token.
// For now, I'll attempt to simulate what I can or ask the user to run it with a token.

// Actually, looking at route.ts: payload = verifyPortalToken(token).
// This implies we need a valid JWT signed with the secret. 
// Since I don't have the secret to sign one, I cannot generate a valid token locally.
// BUT, the user usually tests this by logging in.
// Instead of a broken script, I will create a script that prompts for the token OR assumes the user will run it in the browser console.

// Better approach: Create a simple HTML file that the user can open, which will hit the endpoint.
// Or just wait for deployment and instruct them.

console.log("----------------------------------------------------------------");
console.log("   DIAGNOSTIC VERIFICATION SCRIPT");
console.log("----------------------------------------------------------------");
console.log("1. Open https://h2s-portal.vercel.app (or your production portal)");
console.log("2. Open Chrome DevTools (F12) -> Console");
console.log("3. Paste the following code to force-fetch diagnostics:");
console.log("");
console.log(`
fetch('https://h2s-backend.vercel.app/api/portal_jobs', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('sb-access-token') // Adjust based on where token is stored
  },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(data => {
  console.log('Offers:', data.offers?.length);
  console.log('DIAGNOSTICS:', JSON.stringify(data.meta?.diagnostics, null, 2));
});
`);
console.log("----------------------------------------------------------------");
