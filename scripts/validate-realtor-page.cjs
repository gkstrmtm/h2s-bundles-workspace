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
assert.doesNotMatch(html, /Preview only: profile details persist/);
assert.doesNotMatch(html, /—/);

console.log(`realtor partner page OK: ${scripts.length} active scripts validated`);

const dispatch = fs.readFileSync('frontend/dispatch.html', 'utf8');
assert.match(dispatch, /admin_partners/);
assert.match(dispatch, /admin_partner_status/);
assert.match(dispatch, /state=client&partner=/);
assert.match(dispatch, /https:\/\/partners\.home2smart\.com\/r\//);
console.log('dispatch partner approval and public-link wiring OK');
