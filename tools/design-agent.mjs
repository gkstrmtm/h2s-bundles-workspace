#!/usr/bin/env node
/**
 * Local design agent — routes questions to the Exhibit API.
 *
 * Usage:
 *   node tools/design-agent.mjs "describe your screen or question here"
 *   node tools/design-agent.mjs "..." --route internal-operations
 *   node tools/design-agent.mjs "..." --verbose
 *
 * Flags:
 *   --route <id>   Narrow the surface archetype. Options:
 *                    internal-operations | landing-page | product-application
 *                    developer-tool | conversion-funnel | docs-knowledge | commerce-marketplace
 *   --verbose      Print the full JSON response instead of the condensed summary.
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const AGENT_ENDPOINT = 'https://exhibit-beta.vercel.app/api/agent';

function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request(u, { method: 'GET', headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function formatSummary(body) {
  if (!body || typeof body !== 'object') return String(body);
  const lines = [];

  const arch = body.classification?.archetype;
  if (arch?.label) lines.push(`\n  Surface     : ${arch.label}` + (arch.supportLevel ? ` [${arch.supportLevel}]` : ''));

  const dp = body.designProfile;
  if (dp?.label) {
    lines.push(`  Profile     : ${dp.label}`);
    if (dp.summary) lines.push(`  Summary     : ${dp.summary}`);
    if (dp.layoutMood) lines.push(`  Layout Mood : ${dp.layoutMood}`);
    if (dp.spacing?.density) lines.push(`  Density     : ${dp.spacing.density}`);
    if (dp.typography?.body) lines.push(`  Body Font   : ${dp.typography.body}`);
    if (dp.iconSystem?.primaryLibrary)
      lines.push(`  Icons       : ${dp.iconSystem.primaryLibrary} @ ${dp.iconSystem.defaultSize}`);
  }

  if (dp?.colorAndElevation?.rules?.length) {
    lines.push(`\n  Color Rules:`);
    dp.colorAndElevation.rules.forEach((r) => lines.push(`    · ${r}`));
  }

  const ci = body.contextIntelligence;
  if (ci?.complaintTranslation?.likelyDesignFailures?.length) {
    lines.push(`\n  Likely Failures:`);
    ci.complaintTranslation.likelyDesignFailures.forEach((f) => lines.push(`    · ${f}`));
  }

  const fc = body.foundationCommunication;
  if (fc?.applyWithoutAsking?.length) {
    lines.push(`\n  Apply Immediately:`);
    fc.applyWithoutAsking.forEach((r) => lines.push(`    · ${r}`));
  }

  if (fc?.assumedUserPreferences?.likelyLikes?.length) {
    lines.push(`\n  User Likely Likes:`);
    fc.assumedUserPreferences.likelyLikes.forEach((l) => lines.push(`    + ${l}`));
  }

  if (fc?.assumedUserPreferences?.likelyDislikes?.length) {
    lines.push(`\n  User Likely Dislikes:`);
    fc.assumedUserPreferences.likelyDislikes.forEach((d) => lines.push(`    - ${d}`));
  }

  const rp = body.resourcePull;
  if (rp?.avoid?.length) {
    lines.push(`\n  Avoid:`);
    rp.avoid.forEach((a) => lines.push(`    · ${a}`));
  }

  if (body.nextQuestions?.length) {
    lines.push(`\n  Clarifying Questions:`);
    body.nextQuestions.forEach((q) => lines.push(`    ? ${q}`));
  }

  if (fc?.clarifyBeforeBuilding?.ask) {
    lines.push(`\n  Critical Ask Before Building:`);
    lines.push(`    "${fc.clarifyBeforeBuilding.ask}"`);
    if (fc.clarifyBeforeBuilding.why) lines.push(`    → ${fc.clarifyBeforeBuilding.why}`);
  }

  return lines.length ? lines.join('\n') : JSON.stringify(body, null, 2);
}

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log('\nUsage: node tools/design-agent.mjs "<question>" [--route <id>] [--verbose]');
    console.log('\nRoute IDs:');
    console.log('  internal-operations   hiring dashboards, admin queues, approval flows');
    console.log('  landing-page          marketing homepages, SaaS landing pages');
    console.log('  product-application   settings, workspaces, general software UI');
    console.log('  developer-tool        editors, consoles, power-user panels');
    console.log('  conversion-funnel     lead capture, signup, checkout');
    console.log('  docs-knowledge        docs, help centers, knowledge bases');
    console.log('  commerce-marketplace  storefronts, product pages, checkout');
    console.log('\nExamples:');
    console.log('  node tools/design-agent.mjs "internal hiring pipeline with left-nav sidebar"');
    console.log('  node tools/design-agent.mjs "landing page for home services SaaS" --route landing-page');
    console.log('  node tools/design-agent.mjs "color audit for dashboard" --route internal-operations --verbose');
    process.exit(0);
  }

  let question = null;
  let routeHint = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--route' && args[i + 1]) {
      routeHint = args[++i];
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (!args[i].startsWith('--')) {
      question = args[i];
    }
  }

  if (!question) {
    console.error('Error: No question provided. Run with --help for usage.');
    process.exit(1);
  }

  const url = new URL(AGENT_ENDPOINT);
  url.searchParams.set('question', question);
  if (routeHint) url.searchParams.set('routeHint', routeHint);

  const displayUrl = url.href.length > 100 ? url.href.slice(0, 100) + '...' : url.href;
  console.log(`\nQuerying Exhibit design agent...`);
  console.log(`  ${displayUrl}`);

  let result;
  try {
    result = await fetchUrl(url.href);
  } catch (err) {
    console.error(`\n[Exhibit API] Network error - could not reach ${AGENT_ENDPOINT}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  if (result.status !== 200) {
    console.error(`\n[Exhibit API] HTTP ${result.status} - request failed.`);
    if (typeof result.body === 'object') {
      console.error(JSON.stringify(result.body, null, 2));
    } else {
      console.error(result.body);
    }
    process.exit(1);
  }

  console.log(`[Exhibit API] 200 OK - guidance received.`);

  if (verbose) {
    console.log('\n--- Full Response ---');
    console.log(JSON.stringify(result.body, null, 2));
  } else {
    console.log('\n--- Design Guidance ---');
    console.log(formatSummary(result.body));
    console.log('\n  (run with --verbose for full JSON)');
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
