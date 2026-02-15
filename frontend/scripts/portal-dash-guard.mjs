#!/usr/bin/env node
/*
  Portal Dash Guard

  Goal: prevent deploying a frontend config that accidentally serves the wrong dashboard.

  - Pre-check: validate frontend/vercel.json contains the required host-based rewrites
    for portal.home2smart.com dash routes pointing to the canonical Dash.html URL.
  - Post-check: fetch the live portal alias and assert it is serving the canonical file
    via the meta marker: <meta name="h2s-source-file" content="Dash.html">.

  Usage:
    node ./scripts/portal-dash-guard.mjs pre
    node ./scripts/portal-dash-guard.mjs post

  Escape hatch:
    H2S_SKIP_GUARDS=1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_HOST = 'portal.home2smart.com';
const CANONICAL_DASH_URL = '/dash.html';
const PORTAL_CHECK_URL = 'https://portal.home2smart.com/dash?about=1';

function fail(message) {
  console.error(`[guard] FAIL: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[guard] OK: ${message}`);
}

function warn(message) {
  console.warn(`[guard] WARN: ${message}`);
}

function getMetaContent(html, metaName) {
  const re = new RegExp(
    `<meta\\s+[^>]*name=["']${escapeRegExp(metaName)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(re);
  return match ? match[1] : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function fetchText(url) {
  if (typeof fetch !== 'function') {
    fail('Global fetch() not available. Use Node 18+ to run guards.');
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function loadFrontendVercelJson(frontendDir) {
  const vercelJsonPath = path.join(frontendDir, 'vercel.json');
  let raw;
  try {
    raw = await fs.readFile(vercelJsonPath, 'utf8');
  } catch {
    fail(`Missing ${vercelJsonPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`Could not parse ${vercelJsonPath} as JSON: ${e?.message || e}`);
  }

  const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : [];
  return { vercelJsonPath, rewrites };
}

function isPortalHostRewrite(rule) {
  const has = Array.isArray(rule?.has) ? rule.has : [];
  return has.some((h) => h && h.type === 'host' && h.value === REQUIRED_HOST);
}

function findRewriteIndex(rewrites, source) {
  return rewrites.findIndex((r) => r && r.source === source && isPortalHostRewrite(r));
}

async function preCheck() {
  const frontendDir = process.cwd();
  const { vercelJsonPath, rewrites } = await loadFrontendVercelJson(frontendDir);

  const requiredSources = [
    '/dash',
    '/dash/(.*)',
    '/dashboard',
    '/Dash',
    '/Dash/(.*)',
    '/Dash.html',
    '/dash.html',
  ];

  for (const source of requiredSources) {
    const idx = findRewriteIndex(rewrites, source);
    if (idx < 0) {
      fail(`${vercelJsonPath} is missing a portal host rewrite for ${source}`);
    }

    const rule = rewrites[idx];
    if (rule.destination !== CANONICAL_DASH_URL) {
      fail(
        `${vercelJsonPath} portal rewrite for ${source} points to ${JSON.stringify(
          rule.destination
        )} (expected ${CANONICAL_DASH_URL})`
      );
    }
  }

  const catchAllIdx = findRewriteIndex(rewrites, '/:path*');
  if (catchAllIdx >= 0) {
    for (const source of requiredSources) {
      const idx = findRewriteIndex(rewrites, source);
      if (idx > catchAllIdx) {
        fail(
          `${vercelJsonPath} portal rewrite for ${source} occurs after the portal catch-all (/:path*). Move it above to ensure it matches.`
        );
      }
    }
  }

  const repoRootDash = path.resolve(frontendDir, '..', 'Dash.html');
  try {
    const dashHtml = await fs.readFile(repoRootDash, 'utf8');
    const sourceMeta = getMetaContent(dashHtml, 'h2s-source-file');
    if (sourceMeta && sourceMeta !== 'Dash.html') {
      fail(`${repoRootDash} meta h2s-source-file=${JSON.stringify(sourceMeta)} (expected "Dash.html")`);
    }
  } catch {
    warn(`Could not read ${repoRootDash} for a sanity check (file may not exist locally).`);
  }

  const frontendDash = path.resolve(frontendDir, 'dash.html');
  try {
    const dashHtml = await fs.readFile(frontendDash, 'utf8');
    const sourceMeta = getMetaContent(dashHtml, 'h2s-source-file');
    if (sourceMeta !== 'Dash.html') {
      fail(`${frontendDash} meta h2s-source-file=${JSON.stringify(sourceMeta)} (expected "Dash.html")`);
    }
  } catch {
    warn(`Could not read ${frontendDash} for a sanity check (file may not exist locally).`);
  }

  const rootVercelJsonPath = path.resolve(frontendDir, '..', 'vercel.json');
  try {
    const raw = await fs.readFile(rootVercelJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rootRewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : [];

    const requiredRoot = ['/dash', '/dash/(.*)', '/dash.html', '/Dash.html', '/Dash', '/Dash/(.*)'];
    for (const source of requiredRoot) {
      const rule = rootRewrites.find((r) => r && r.source === source);
      if (!rule) {
        fail(`${rootVercelJsonPath} is missing rewrite for ${source} -> /Dash.html`);
      }
      if (rule.destination !== '/Dash.html') {
        fail(
          `${rootVercelJsonPath} rewrite for ${source} points to ${JSON.stringify(
            rule.destination
          )} (expected "/Dash.html")`
        );
      }
    }
  } catch (e) {
    warn(`Could not validate root vercel.json routing: ${e?.message || e}`);
  }

  ok('Pre-checks passed (portal dash routes point to canonical Dash.html).');
}

async function postCheck() {
  const maxAttempts = 12;
  const delayMs = 1500;
  let last = { status: 0, sourceMeta: null, buildMeta: null, url: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t = Date.now();
    const url = `${PORTAL_CHECK_URL}&t=${t}`;
    last.url = url;

    const { status, text } = await fetchText(url);
    last.status = status;
    if (status < 200 || status >= 300) {
      // transient deploy/proxy hiccups; retry
    } else {
      last.sourceMeta = getMetaContent(text, 'h2s-source-file');
      last.buildMeta = getMetaContent(text, 'h2s-dash-build');

      if (last.sourceMeta === 'Dash.html') {
        ok(
          `Post-check passed (portal /dash serves Dash.html, build=${
            last.buildMeta || 'unknown'
          }, attempts=${attempt}).`
        );
        return;
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  fail(
    `Portal /dash did not confirm canonical Dash.html after ${maxAttempts} attempts. ` +
      `lastStatus=${last.status} h2s-source-file=${JSON.stringify(last.sourceMeta)} ` +
      `build=${JSON.stringify(last.buildMeta)} url=${last.url}`
  );
}

async function main() {
  if (process.env.H2S_SKIP_GUARDS === '1') {
    warn('H2S_SKIP_GUARDS=1 set; skipping guard checks.');
    return;
  }

  const stage = process.argv[2];
  if (!stage || !['pre', 'post'].includes(stage)) {
    console.error('Usage: node ./scripts/portal-dash-guard.mjs <pre|post>');
    process.exit(2);
  }

  if (stage === 'pre') await preCheck();
  if (stage === 'post') await postCheck();
}

main().catch((e) => {
  fail(e?.stack || e?.message || String(e));
});
