#!/usr/bin/env node
/*
  Generate a workspace Docs/SQL archive manifest + file copies.

  What it does:
  - Scans for workspace documentation files (Markdown + SQL)
  - Copies them into frontend/library/files/
  - Writes frontend/library/manifest.json (archive feed; not task-submitted deliverables)

  Usage:
    node ./scripts/generate-library-manifest.mjs

  Escape hatch:
    H2S_SKIP_LIBRARY=1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FRONTEND_DIR = process.cwd();
const WORKSPACE_ROOT = path.resolve(FRONTEND_DIR, '..');

const OUT_DIR = path.join(FRONTEND_DIR, 'library');
const OUT_FILES_DIR = path.join(OUT_DIR, 'files');
const OUT_MANIFEST = path.join(OUT_DIR, 'manifest.json');

const INCLUDED_EXTS = new Set(['.md', '.sql']);
const SKIP_BASENAMES = new Set(['README.md']);

const EXTRA_DIRS = [path.join(WORKSPACE_ROOT, 'backend', 'tools')];

function safeSlug(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function tryExtractDateFromName(name) {
  const s = String(name);
  const m1 = s.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/(20\d{2})_(\d{2})_(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function titleFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryFromFilename(filename) {
  const upper = filename.toUpperCase();
  const rules = [
    ['ACCOUNT', ['ACCOUNT_TAB', 'ACCOUNT']],
    ['AUDIT', ['AUDIT', 'UX_AUDIT']],
    ['CHECKOUT', ['CHECKOUT']],
    ['BUNDLES', ['BUNDLES', 'BUNDLE']],
    ['BACKEND', ['BACKEND']],
    ['DATA', ['DATA', 'DATABASE', 'SCHEMA']],
    ['ADMIN', ['ADMIN']],
    ['ARCH', ['ARCHITECTURE']],
    ['MIGRATION', ['MIGRATION', 'BACKFILL']],
    ['SQL', ['.SQL']],
  ];

  for (const [cat, keys] of rules) {
    for (const k of keys) {
      if (upper.includes(k)) return cat;
    }
  }

  return 'GENERAL';
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listCandidateFilesInDir(dir, { rootLabel }) {
  const out = [];
  if (!(await exists(dir))) return out;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = path.join(dir, e.name);
    const ext = path.extname(e.name).toLowerCase();
    if (!INCLUDED_EXTS.has(ext)) continue;
    if (SKIP_BASENAMES.has(e.name)) continue;

    const rel = path.relative(WORKSPACE_ROOT, abs).replace(/\\/g, '/');
    out.push({ abs, rel, name: e.name, ext, rootLabel });
  }
  return out;
}

function uniqueTargetName(usedNames, originalName) {
  const ext = path.extname(originalName);
  const base = originalName.slice(0, Math.max(0, originalName.length - ext.length));

  let candidate = originalName;
  let i = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}--${i}${ext}`;
    i += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function sha1File(p) {
  const buf = await fs.readFile(p);
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function main() {
  if (process.env.H2S_SKIP_LIBRARY === '1') {
    console.log('[library] H2S_SKIP_LIBRARY=1 set; skipping library generation.');
    return;
  }

  await fs.mkdir(OUT_FILES_DIR, { recursive: true });

  const candidates = [...(await listCandidateFilesInDir(WORKSPACE_ROOT, { rootLabel: 'root' }))];
  for (const d of EXTRA_DIRS) {
    candidates.push(
      ...(await listCandidateFilesInDir(d, {
        rootLabel: path.relative(WORKSPACE_ROOT, d).replace(/\\/g, '/'),
      }))
    );
  }

  candidates.sort((a, b) => {
    const da = tryExtractDateFromName(a.name);
    const db = tryExtractDateFromName(b.name);
    if (da && db) return db.localeCompare(da);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return a.name.localeCompare(b.name);
  });

  const usedNames = new Set();
  const items = [];

  for (const c of candidates) {
    const stat = await fs.stat(c.abs);
    if (!stat.isFile()) continue;

    // Skip huge files to keep deploy fast.
    if (stat.size > 2_000_000) continue;

    const targetName = uniqueTargetName(usedNames, c.name);
    const targetRelPath = `library/files/${targetName}`;
    const targetAbs = path.join(FRONTEND_DIR, targetRelPath);

    await fs.copyFile(c.abs, targetAbs);

    const date = tryExtractDateFromName(c.name);
    const title = titleFromFilename(c.name);
    const category = categoryFromFilename(c.name);
    const hash = await sha1File(c.abs);

    items.push({
      id: `${safeSlug(title)}-${hash.slice(0, 10)}`,
      title,
      category,
      date,
      ext: c.ext.slice(1),
      size: stat.size,
      path: targetRelPath,
      original_path: c.rel,
      source_group: c.rootLabel,
    });
  }

  const manifest = {
    ok: true,
    generated_at: new Date().toISOString(),
    workspace_root: path.basename(WORKSPACE_ROOT),
    count: items.length,
    items,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[library] Wrote ${OUT_MANIFEST}`);
  console.log(`[library] Items: ${items.length}`);
}

main().catch((e) => {
  console.error('[library] Failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});
