'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { packagePortal, ASSETS, BACKEND_ORIGIN } = require('../tools/package-portal.cjs');

const root = path.resolve(__dirname, '..', '..');
function isolated(t) {
  // Keep all test output inside this checkout, never in the real serving directory.
  const directory = fs.mkdtempSync(path.join(root, '.portal-packaging-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function read(relative) {
  return fs.readFileSync(path.join(root, ...relative.split('/')));
}

test('packages canonical portal and only its confirmed standalone enrollment assets', t => {
  const outputDir = path.join(isolated(t), 'public');
  const sources = ['portal.html', ...ASSETS];
  const before = sources.map(read);
  assert.deepEqual(packagePortal({ outputDir }), sources);
  const actual = fs.readFileSync(path.join(outputDir, 'portal.html'), 'utf8');
  let expected = before[0].toString('utf8');
  for (const relative of ASSETS) {
    expected = expected.replace(`"./${relative}"`, `"${BACKEND_ORIGIN}/${relative}"`);
    assert.deepEqual(fs.readFileSync(path.join(outputDir, ...relative.split('/'))), read(relative));
  }
  // Every legacy inline handler, auth, upload, signature and completion path is preserved.
  assert.equal(actual, expected);
  assert.deepEqual(sources.map(read), before);
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['frontend', 'portal.html']);
  assert.deepEqual(fs.readdirSync(path.join(outputDir, 'frontend')).sort(),
    ['field-installation.js', 'field-workflow.css']);
  const first = sources.map(relative => fs.readFileSync(path.join(outputDir, ...relative.split('/'))));
  fs.writeFileSync(path.join(outputDir, 'unrelated.txt'), 'retain existing public files');
  packagePortal({ outputDir });
  assert.deepEqual(sources.map(relative => fs.readFileSync(path.join(outputDir, ...relative.split('/')))), first);
  assert.equal(fs.readFileSync(path.join(outputDir, 'unrelated.txt'), 'utf8'), 'retain existing public files');
});

test('verified dependency list matches local document assets with no transitive module/CSS loads', () => {
  const html = read('portal.html').toString('utf8');
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1]).filter(url => url.startsWith('./'));
  assert.deepEqual(references, ASSETS.map(relative => `./${relative}`));
  const js = read('frontend/field-installation.js').toString('utf8');
  assert.match(js, /global\.H2SFieldInstallation = \{mount\}/);
  assert.doesNotMatch(js, /\bimport\s*(?:[('"{*]|\w)|\brequire\s*\(|createElement\(\s*['"](?:script|link)['"]/);
  assert.doesNotMatch(read('frontend/field-workflow.css').toString('utf8'), /@import\b|url\s*\(/i);
});

test('generated URLs reach backend asset files from every committed portal entry path', t => {
  const outputDir = path.join(isolated(t), 'public');
  packagePortal({ outputDir });
  const config = JSON.parse(execFileSync('git', ['show', 'HEAD:frontend/vercel.json'],
    { cwd: root, encoding: 'utf8' }));
  const routes = config.rewrites.filter(route =>
    route.has?.some(condition => condition.type === 'host' && condition.value === 'portal.home2smart.com'));
  for (const source of ['/portal', '/portal/(.*)', '/portal.html', '/:path*']) {
    assert.equal(routes.find(route => route.source === source)?.destination, `${BACKEND_ORIGIN}/portal.html`);
  }
  const html = fs.readFileSync(path.join(outputDir, 'portal.html'), 'utf8');
  for (const relative of ASSETS) {
    // Root-relative URLs would also hit the portal-domain HTML catchall.
    assert.notEqual(new URL(`./${relative}`, 'https://portal.home2smart.com/portal/job/123').origin,
      BACKEND_ORIGIN);
    for (const entry of ['/portal', '/portal/', '/portal/job/123', '/portal.html']) {
      const url = new URL(`${BACKEND_ORIGIN}/${relative}`, `https://portal.home2smart.com${entry}`);
      assert.ok(html.includes(`"${url.href}"`));
      assert.equal(url.origin, BACKEND_ORIGIN);
      assert.deepEqual(fs.readFileSync(path.join(outputDir, ...url.pathname.slice(1).split('/'))), read(relative));
    }
  }
});

test('CLI resolves canonical source independently of cwd and requires valid arguments', t => {
  const directory = isolated(t), outputDir = path.join(directory, 'served');
  const tool = path.join(root, 'backend', 'tools', 'package-portal.cjs');
  execFileSync(process.execPath, [tool, '--output', outputDir], { cwd: directory });
  assert.ok(fs.existsSync(path.join(outputDir, 'frontend', 'field-installation.js')));
  const invalid = spawnSync(process.execPath, [tool, '--output'], { cwd: directory, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage:/);
});

test('missing assets or changed canonical references fail before creating output', t => {
  const directory = isolated(t), sourceRoot = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  fs.mkdirSync(path.join(sourceRoot, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'portal.html'), read('portal.html'));
  assert.throws(() => packagePortal({ sourceRoot, outputDir }), /ENOENT/);
  assert.equal(fs.existsSync(outputDir), false);
  for (const relative of ASSETS) fs.writeFileSync(path.join(sourceRoot, ...relative.split('/')), read(relative));
  fs.writeFileSync(path.join(sourceRoot, 'portal.html'), '<html>wrong mirror</html>');
  assert.throws(() => packagePortal({ sourceRoot, outputDir }), /canonical asset reference/);
  assert.equal(fs.existsSync(outputDir), false);
  assert.throws(() => packagePortal(), /explicit outputDir/);
  assert.throws(() => packagePortal({ outputDir: root }), /canonical sources/);
});

test('build retains Prisma and Next behavior after packaging, including Vercel entrypoint', () => {
  const pkg = JSON.parse(read('backend/package.json'));
  assert.equal(pkg.scripts['vercel-build'], 'npm run build');
  assert.equal(pkg.scripts['package:portal'], 'node tools/package-portal.cjs');
  assert.equal(pkg.scripts['package:forecast'], 'node tools/package-forecast-policy.cjs');
  assert.equal(pkg.scripts.build, 'npm run package:forecast && npm run package:portal && cross-env NODE_OPTIONS=--max-old-space-size=6144 npx prisma generate && cross-env NODE_OPTIONS=--max-old-space-size=6144 next build');
  assert.match(pkg.scripts.postinstall,/npm --prefix \.\.\/config\/pricing ci --ignore-scripts --include=dev && npm run package:forecast$/);
});
