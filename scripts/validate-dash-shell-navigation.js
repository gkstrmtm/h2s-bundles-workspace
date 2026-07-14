/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dashJsPath = path.join(__dirname, '..', 'frontend', 'dash.js');
const dashHtmlPath = path.join(__dirname, '..', 'frontend', 'dash.html');

const dashJs = fs.readFileSync(dashJsPath, 'utf8');
const dashHtml = fs.readFileSync(dashHtmlPath, 'utf8');

function expectMatch(pattern, source, message) {
  assert(pattern.test(source), message);
}

function extractCompatTabs(html) {
  const navMatch = html.match(/<nav class="tabs" style="display: none;">([\s\S]*?)<\/nav>/);
  assert(navMatch, 'Missing hidden compatibility tab nav in dash.html');
  const tabs = [];
  const regex = /data-tab="([^"]+)"/g;
  let match;
  while ((match = regex.exec(navMatch[1])) !== null) {
    tabs.push(match[1]);
  }
  return tabs;
}

function extractShellTabs(js) {
  const mapMatch = js.match(/const DASH_SHELL_TABS = Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/);
  assert(mapMatch, 'Missing DASH_SHELL_TABS definition');
  const tabs = [];
  const regex = /^\s*([a-z]+):\s*\{/gm;
  let match;
  while ((match = regex.exec(mapMatch[1])) !== null) {
    tabs.push(match[1]);
  }
  return tabs;
}

function main() {
  const shellTabs = extractShellTabs(dashJs);
  const compatTabs = extractCompatTabs(dashHtml);
  const expectedTabs = [
    'pipeline',
    'screening',
    'techinterview',
    'reports',
    'tasks',
    'training',
    'workspace',
    'deliverables',
    'offerbuilder',
    'admin',
    'proofpacks',
    'sms'
  ];

  assert.deepStrictEqual(shellTabs, expectedTabs, 'DASH_SHELL_TABS no longer matches the expected shell tab set/order');
  assert.deepStrictEqual([...compatTabs].sort(), [...expectedTabs].sort(), 'Hidden compatibility tabs must match the canonical shell tab set');

  expectMatch(/const DASH_SHELL_DEFAULT_TAB = 'pipeline';/, dashJs, 'Default shell tab must remain pipeline');
  expectMatch(/const requestedTab = hasUrlTab \? urlTab : \(isValid \? savedTab : DASH_SHELL_DEFAULT_TAB\);/, dashJs, 'Restore logic must prioritize URL tab over saved tab and default');
  expectMatch(/source: restoreSource/, dashJs, 'Restore logic must pass an explicit navigation source into switchToTab');
  expectMatch(/fallbackTab: DASH_SHELL_DEFAULT_TAB/, dashJs, 'Restore logic must route through the canonical fallback tab');
  expectMatch(/const activeTab = getActiveShellTab\(\);/, dashJs, 'switchToTab must derive the active tab from canonical shell state');
  expectMatch(/ensureSidebarGroupForTab\(normalizedTargetTab, \{ persist: true \}\);/, dashJs, 'switchToTab must reopen the owning sidebar group');
  expectMatch(/if \(targetConfig\.requiresAdmin && !checkAdminAuth\(\)\)/, dashJs, 'Admin-gated tabs must fail closed through canonical tab config');
  expectMatch(/Opened Pipeline instead\./, dashJs, 'Invalid or blocked navigation must fail closed to the default shell tab');
  expectMatch(/window\.switchToTab = function\(tab, options\)/, dashJs, 'Global switchToTab wrapper must accept options');
  expectMatch(/originalSwitchToTab\(tab, options\);/, dashJs, 'Global switchToTab wrapper must forward options');
  expectMatch(/initFeatureIfNeeded\(normalizeShellTabId\(tab\)\)/, dashJs, 'Global switchToTab wrapper must normalize tab ids before deferred feature init');

  console.log('PASS validate-dash-shell-navigation');
  console.log(`Verified ${shellTabs.length} shell tabs, restore precedence wiring, admin fallback, sidebar reveal, and wrapper option forwarding.`);
}

try {
  main();
} catch (error) {
  console.error('FAIL validate-dash-shell-navigation');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
