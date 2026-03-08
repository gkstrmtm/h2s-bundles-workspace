/*
Smoke verification for portal dashboard fixes.

This is intentionally lightweight and safe:
- Validates local source files contain expected patterns (hours calc, task JSON headers, bug report submit wiring)
- Fetches production assets and validates the same patterns are live

Exit code:
- 0: all checks passed
- 1: one or more checks failed
*/

const fs = require('fs');
const path = require('path');
const https = require('https');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'h2s-smoke-verify/1.0',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: data });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function okLine(label, ok, details) {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = details ? ` - ${details}` : '';
  return `${status}  ${label}${suffix}`;
}

function assertContains(haystack, needle, label) {
  const ok = haystack.includes(needle);
  return { ok, label, details: `contains ${JSON.stringify(needle)}` };
}

function assertRegex(haystack, re, label) {
  const ok = re.test(haystack);
  return { ok, label, details: `matches ${String(re)}` };
}

async function main() {
  const workspaceRoot = process.cwd();

  const localDashJs = path.join(workspaceRoot, 'frontend', 'dash.js');
  const localDashHtml = path.join(workspaceRoot, 'frontend', 'dash.html');

  const checks = [];

  // Local file checks
  const dashJs = readText(localDashJs);
  const dashHtml = readText(localDashHtml);

  // Hours logging reliability
  checks.push(assertContains(dashJs, 'function parseTimeToMinutes', 'Local hours: parseTimeToMinutes() exists'));
  checks.push(assertContains(dashJs, 'function computeDurationHours', 'Local hours: computeDurationHours() exists'));
  checks.push(assertRegex(dashJs, /computeDurationHours\(\s*startTime\s*,\s*endTime\s*\)/, 'Local hours: submitHours uses computeDurationHours'));
  checks.push(assertContains(dashHtml, 'oninput="calculateDuration()"', 'Local hours UI: duration updates on input'));

  // Tasks JSON content-type hardening
  const taskActions = [
    'addTask',
    'updateTask',
    'deleteTask',
    'upsertTaskDraft',
    'generateTaskDetails',
  ];
  for (const action of taskActions) {
    checks.push(assertContains(dashJs, `action=${action}`, `Local tasks: has endpoint action=${action}`));
  }
  checks.push(assertContains(dashJs, "'Content-Type': 'application/json'", 'Local tasks: JSON Content-Type header present'));

  // Deliverables should already be JSON-based; just verify the submit function exists.
  checks.push(assertRegex(dashJs, /async function submitDeliverable\(/, 'Local deliverables: submitDeliverable() exists'));

  // Bug report submission reliability
  checks.push(assertContains(dashJs, 'submitReport(evt)', 'Local bugs: submitReport(evt) signature'));
  checks.push(assertContains(dashJs, 'submitReport(event)', 'Local bugs: onclick passes event'));
  checks.push(assertContains(dashJs, 'bugReportSubmitBtn', 'Local bugs: stable submit button id'));
  checks.push(assertContains(dashJs, 'action=bug_report_submit', 'Local bugs: submit endpoint action=bug_report_submit'));

  // Production checks (no-cache)
  const prodJsUrl = 'https://portal.home2smart.com/dash.js';
  const prodHtmlUrl = 'https://portal.home2smart.com/dash';

  const [{ status: prodJsStatus, body: prodJs }, { status: prodHtmlStatus, body: prodHtml }] = await Promise.all([
    fetchText(prodJsUrl, { 'Cache-Control': 'no-cache' }),
    fetchText(prodHtmlUrl, { 'Cache-Control': 'no-cache' }),
  ]);

  checks.push({ ok: prodJsStatus >= 200 && prodJsStatus < 300, label: 'Prod dash.js reachable', details: `status ${prodJsStatus}` });
  checks.push({ ok: prodHtmlStatus >= 200 && prodHtmlStatus < 300, label: 'Prod dash reachable', details: `status ${prodHtmlStatus}` });

  checks.push(assertContains(prodJs, 'function computeDurationHours', 'Prod hours: computeDurationHours() live'));
  checks.push(assertContains(prodJs, "'Content-Type': 'application/json'", 'Prod tasks: JSON Content-Type header live'));
  checks.push(assertContains(prodHtml, 'oninput="calculateDuration()"', 'Prod hours UI: duration updates on input live'));

  checks.push(assertContains(prodJs, 'submitReport(event)', 'Prod bugs: onclick passes event live'));
  checks.push(assertContains(prodJs, 'bugReportSubmitBtn', 'Prod bugs: stable submit button id live'));

  // Summarize
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    process.stdout.write(okLine(c.label, c.ok, c.details) + '\n');
  }

  if (failed.length) {
    process.stdout.write(`\nFAILED: ${failed.length} check(s) failed\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`\nOK: all ${checks.length} checks passed\n`);
    process.exitCode = 0;
  }
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e && e.stack ? e.stack : String(e)}\n`);
  process.exit(1);
});
