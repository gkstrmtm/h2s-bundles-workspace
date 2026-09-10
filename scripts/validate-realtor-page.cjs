const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('frontend/realtor-partner.html', 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !match[1].includes('application/x-h2s-preview-disabled'));

for (const [, , source] of scripts) {
  new Function(source);
}

assert.ok(scripts.length >= 4, 'Expected the live funnel and supporting scripts');
assert.match(html, /name="brokerage_approval_confirmed"/);
assert.match(html, /api\(\s*"partner_apply"/);
assert.match(html, /api\(\s*"partner_session"/);
assert.match(html, /api\(\s*`partner_public\?slug=/);
assert.match(html, /api\(\s*"partner_headshot"/);
assert.match(html, /api\(\s*"partner_password_reset"/);
assert.match(html, /api\(\s*"partner_password_update"/);
assert.match(html, /api\(\s*"partner_profile"/);
assert.match(html, /id="share-native"/);
assert.match(html, /id="metric-introductions"/);
assert.match(html, /class="client-advantage"/);
assert.match(html, /recoveryMode && session\?\.access_token/);
assert.match(html, /via=\$\{encodeURIComponent\(referralToken\)\}/);
assert.match(html, /https:\/\/shop\.home2smart\.com\/bundles/);
assert.match(html, /params\.get\("state"\) === "account"\) openLogin\(\)/);
assert.doesNotMatch(html, /partners\.home2smart\.com/);
assert.doesNotMatch(html, /Preview only: profile details persist/);
assert.doesNotMatch(html, /—/);

console.log(`realtor partner page OK: ${scripts.length} active scripts validated`);

const dispatch = fs.readFileSync('frontend/dispatch.html', 'utf8');
assert.match(dispatch, /admin_partners/);
assert.match(dispatch, /admin_partner_status/);
assert.match(dispatch, /state=client&partner=/);
assert.match(dispatch, /https:\/\/partner\.home2smart\.com\/r\//);
assert.match(dispatch, /partnerSummary/);
assert.match(dispatch, /Waiting \$\{ageDays/);
const vercel = fs.readFileSync('vercel.json', 'utf8');
assert.match(vercel, /"source": "\/admin"/);
assert.match(vercel, /"value": "partner\.home2smart\.com"/);
assert.match(vercel, /"source": "\/:path\*"[\s\S]*?"destination": "\/partner-404\.html"/);
assert.doesNotMatch(vercel, /"destination": "\/"[\s\S]*?"permanent": false[\s\S]*?partner\.home2smart\.com/);
assert.doesNotMatch(vercel, /partners\.home2smart\.com/);
const notFound = fs.readFileSync('partner-404.html', 'utf8');
assert.match(notFound, /<title>404 \| Home2Smart<\/title>/);
assert.match(notFound, /<h1>404<\/h1>/);
assert.match(notFound, /<p>Page not found\.<\/p>/);
assert.match(notFound, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(notFound, /Realtor Partners/);
assert.doesNotMatch(notFound, /—/);
console.log('dispatch partner approval and public-link wiring OK');

const bundles = fs.readFileSync('frontend/bundles.js', 'utf8');
assert.match(bundles, /function h2sRenderPartnerBenefit/);
assert.match(bundles, /Eligible partner pricing and scheduling benefits/);
assert.match(bundles, /partner_referral_slug/);
assert.match(bundles, /partner_referral_token/);
assert.doesNotMatch(bundles, /—/);
console.log('booking referral continuity OK');
