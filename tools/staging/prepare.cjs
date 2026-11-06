'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function stagingOrigin(raw, kind) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.origin !== raw
    || !new RegExp(`^h2s-staging-${kind}(?:-[a-z0-9-]+)?\\.vercel\\.app$`).test(url.hostname)) {
    throw new Error(`Expected an exact private staging ${kind} origin`);
  }
  return raw;
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Staging inputs must not contain links');
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function adaptText(text, apiOrigin, frontendOrigin) {
  return text
    .replace(/https?:\/\/h2s-backend(?:-[a-z0-9-]+)?\.vercel\.app/gi, apiOrigin)
    .replace(/https?:\/\/(?:[a-z0-9-]+\.)?home2smart\.com/gi, frontendOrigin)
    .replace(/https?:\/\/h2s-campaign-intake\.vercel\.app/gi, frontendOrigin)
    .replace(/https?:\/\/[a-z0-9]+\.supabase\.co/gi, 'https://staging-not-configured.invalid')
    .replace(/https?:\/\/script\.google\.com/gi, `${apiOrigin}/_staging-blocked/legacy`);
}
function adaptRuntimeText(text, relative, apiOrigin, frontendOrigin) {
  // The verified shared-provider allowlist is an identity check, not an outbound production target.
  if (relative === path.join('backend', 'lib', 'stagingSandbox.ts')) return text;
  return adaptText(text, apiOrigin, frontendOrigin);
}
function assertNoSecret(text, file) {
  if (/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`Credential-like material blocks staging upload: ${file}`);
  }
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    let payload;
    try { payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString()); }
    catch { continue; }
    if (payload.role === 'service_role') throw new Error(`Service-role credential blocks staging upload: ${file}`);
  }
}
function isRuntimeFile(relative) {
  const parts = relative.split(path.sep);
  if (parts.some(part => part.startsWith('.env') || ['tests', 'migrations', 'scripts'].includes(part))) return false;
  if (/\.(?:md|pem|key|pfx|p12|bak)$/i.test(relative)) return false;
  if (relative === 'portal.html') return true;
  if (parts[0] === 'frontend') {
    return !parts.slice(1).some(part => /^_|^temp[-_]|^dash\.BROKEN_|\.test\.js$|^\.vercel$/.test(part));
  }
  if (parts[0] !== 'backend') return false;
  if (['app', 'lib', 'public'].includes(parts[1])) return true;
  if (parts[1] === 'tools') return parts.length === 3 && parts[2] === 'package-portal.cjs';
  return parts.length === 2 && [
    'package.json', 'package-lock.json', 'schema.prisma', 'next.config.js',
    'next-env.d.ts', 'tsconfig.json', 'vercel.json', 'middleware.ts',
  ].includes(parts[1]);
}
function verifyFrontendStamp(root, commit) {
  const html = fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8');
  const stamp = /const DASH_BUILD_STAMP = '(PORTAL_BUILD_[A-Za-z0-9_]+)'/.exec(html)?.[1];
  if (!stamp || !stamp.endsWith(commit.slice(0, 7))) throw new Error('Frontend stamp does not bind the selected source');
  const assets = [['dash.css', `dash.${stamp}.css`], ['dash.js', `dash.${stamp}.js`]];
  const references = [...html.matchAll(/dash\.(PORTAL_BUILD_[A-Za-z0-9_]+)\.(css|js)/g)];
  if (!references.length || references.some(match => match[1] !== stamp)) {
    throw new Error('Dashboard HTML contains missing or stale stamped asset references');
  }
  if (fs.existsSync(path.join(root, 'frontend', 'dash.bundle.js'))) {
    assets.push(['dash.bundle.js', `dash.bundle.${stamp}.js`]);
  }
  const changes = assets.map(([source, generated]) => {
    const actual = fs.readFileSync(path.join(root, 'frontend', generated));
    if (digest(actual) !== digest(fs.readFileSync(path.join(root, 'frontend', source)))) {
      throw new Error('Stamped dashboard asset differs from the canonical current source');
    }
    return { path: path.join('frontend', generated), before: null, after: digest(actual) };
  });
  return { stamp, changes };
}
function stampFrontend(root, commit) {
  const repository = path.resolve(__dirname, '..', '..');
  const options = { cwd: repository, encoding: 'utf8' };
  if (execFileSync('git', ['rev-parse', 'HEAD'], options).trim() !== commit) {
    throw new Error('The existing frontend stamp procedure requires the selected verified commit to be HEAD');
  }
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], options).trim();
  let script = execFileSync('git', ['show', `${commit}:deploy-frontend-safe.ps1`], options);
  if (!script.includes('[switch]$BuildOnly') || !script.includes('[switch]$KeepInjectedHtml')) {
    throw new Error('The committed frontend build-only procedure must be reviewed');
  }
  const htmlFiles = ['dash.html', 'portal.html'].map(name => path.join('frontend', name));
  const activeHtml = fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8');
  const obsoleteAssertions = [];
  for (const legacy of ['dash2.js', 'dash.bundle.js']) {
    if (!fs.existsSync(path.join(root, 'frontend', legacy))) {
      if (activeHtml.includes(legacy)) throw new Error(`An active dashboard dependency is missing: ${legacy}`);
      const requiredLine = script.split('\n').find(line => line.startsWith('$requiredFiles = '));
      if (!requiredLine?.includes(`"${legacy}"`)) throw new Error('Review the existing frontend required-file checks');
      script = script.replace(requiredLine, requiredLine.replace(`, "${legacy}"`, ''));
      obsoleteAssertions.push(legacy);
    }
  }
  const changes = htmlFiles.map(relative => ({ path: relative,
    before: fs.existsSync(path.join(root, relative)) ? digest(fs.readFileSync(path.join(root, relative))) : null }));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-staging-stamp-'));
  const scriptPath = path.join(temporary, 'deploy-frontend-safe.ps1');
  const wrapper = path.join(temporary, 'build-only.ps1');
  try {
    fs.writeFileSync(scriptPath, script);
    fs.writeFileSync(wrapper, `$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'UTF8'
& "$PSScriptRoot\\deploy-frontend-safe.ps1" -BuildOnly -KeepInjectedHtml
`);
    const log = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: root },
    });
    if (!log.includes('[BUILD ONLY] Skipping Vercel deploy.')) {
      throw new Error(`Frontend build-only execution was not confirmed:\n${log.trim().slice(-1600)}`);
    }
    for (const row of changes) row.after = digest(fs.readFileSync(path.join(root, row.path)));
    const verified = verifyFrontendStamp(root, commit);
    changes.push(...verified.changes);
    return { stamp: verified.stamp, changes, obsoleteAssertions };
  } finally {
    for (const file of [wrapper, scriptPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(temporary);
  }
}
function nativeMiddlewareSource(middleware, commit) {
  const marker = 'export function middleware(req: NextRequest) {';
  if (!/^[a-f0-9]{40}$/.test(commit) || middleware.split(marker).length !== 2) throw new Error('Review the staging middleware source contract');
  return "import { stagingSandboxIdentity } from './lib/stagingSandbox';\n" + middleware.replace(marker, `export async function middleware(req: NextRequest) {
  let scoped = false;
  try { scoped = !!stagingSandboxIdentity(); }
  catch (error) {
    console.error('Private staging scope rejected', { type: error instanceof Error ? error.name : 'Unknown' });
    return NextResponse.json({ ok: false, error: 'Private staging identity/mode is invalid; route remains quarantined.' }, { status: 503 });
  }
  const fieldRoutes = new Set(['/api/field-sales','/api/field-sales-photos','/api/field-sales-catalog',
    '/api/field-sales-transactions','/api/field-sales-agreement','/api/field-sales-stripe-webhook',
    '/api/field-sales-workflow','/api/field-sales-installation','/api/field-sales-company-installation',
    '/api/field-sales-earnings']);
  let allowed = scoped && fieldRoutes.has(req.nextUrl.pathname);
  if (scoped && req.nextUrl.pathname === '/api/v1') {
    let action = req.nextUrl.searchParams.get('action') || '';
    if (req.method === 'POST') {
      try {
        const raw = await req.clone().text();
        if (raw.length > 65536) return NextResponse.json({ ok: false, error: 'Request is too large' }, { status: 413 });
        const body: unknown = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Invalid authentication request' }, { status: 400 });
        const bodyAction = 'action' in body ? body.action : undefined;
        if (bodyAction !== undefined && typeof bodyAction !== 'string') return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
        if (action && bodyAction && action !== bodyAction) return NextResponse.json({ ok: false, error: 'Conflicting actions' }, { status: 400 });
        action = action || bodyAction || '';
      } catch {
        return NextResponse.json({ ok: false, error: 'Invalid authentication request' }, { status: 400 });
      }
    }
    allowed = req.method === 'GET' ? ['dashboardMe','dashboardUsers'].includes(action)
      : req.method === 'POST' && ['dashboardLogin','dashboardLogout','resetDashboardUserPin'].includes(action);
  }
  if (!allowed) {
    return NextResponse.json({ ok: false, code: 'STAGING_NOT_CONFIGURED', quarantined: true,
      sourceCommit: '${commit}', error: 'This route remains quarantined. Only authenticated, run-scoped synthetic sales are available.'
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }`);
}
function prepare({ root, commit, backendOrigin, frontendOrigin }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('An exact committed source SHA is required');
  backendOrigin = stagingOrigin(backendOrigin, 'backend');
  frontendOrigin = stagingOrigin(frontendOrigin, 'frontend');
  root = fs.realpathSync(root);
  if (fs.existsSync(path.join(root, '.git')) || fs.existsSync(path.join(root, 'staging-manifest.json'))) {
    throw new Error('Use a new committed export, never a worktree or previously prepared snapshot');
  }
  for (const required of ['portal.html', 'frontend', 'backend']) {
    if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing canonical staging source: ${required}`);
  }
  const changes = [];
  const allFiles = walk(root);
  if (allFiles.some(file => /(?:^|[\\/])\.env/.test(path.relative(root, file)))) {
    throw new Error('Environment files are forbidden in staging inputs');
  }
  const excludedFiles = allFiles.filter(file => !isRuntimeFile(path.relative(root, file)));
  const textFiles = allFiles.filter(file => isRuntimeFile(path.relative(root, file))
    && /\.(?:html|css|js|cjs|mjs|json|ts|svg|txt|xml|webmanifest|prisma)$/.test(file));
  for (const file of textFiles) {
    assertNoSecret(fs.readFileSync(file, 'utf8'), path.relative(root, file));
  }
  for (const file of excludedFiles) fs.unlinkSync(file);
  for (const file of textFiles) {
    const relative = path.relative(root, file), input = fs.readFileSync(file, 'utf8');
    const isFrontend = relative.startsWith(`frontend${path.sep}`);
    const result = adaptRuntimeText(input, relative, isFrontend ? frontendOrigin : backendOrigin, frontendOrigin);
    if (result !== input) {
      fs.writeFileSync(file, result);
      changes.push({ path: relative, before: digest(input), after: digest(result) });
    }
  }
  function write(relative, content) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
    fs.writeFileSync(file, content);
    changes.push({ path: relative, before, after: digest(content) });
  }
  const middlewarePath = path.join(root, 'backend', 'middleware.ts');
  const middleware = fs.readFileSync(middlewarePath, 'utf8');
  const marker = 'export function middleware(req: NextRequest) {';
  if (middleware.split(marker).length !== 2) throw new Error('Existing middleware contract changed; inspect before preparing');
  const nativeScope = fs.existsSync(path.join(root, 'backend', 'lib', 'stagingSandbox.ts'));
  write(path.join('backend', 'middleware.ts'), nativeScope ? nativeMiddlewareSource(middleware, commit) : middleware.replace(marker, `${marker}
  if (process.env.H2S_STAGING_QUARANTINE !== 'false') {
    return NextResponse.json({
      ok: false, code: 'STAGING_NOT_CONFIGURED', quarantined: true,
      sourceCommit: '${commit}',
      error: 'Private staging is quarantined. Isolated native database, storage, policy approvals and Stripe test verification are required.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }`));
  write(path.join('backend', 'tools', 'staging-build.cjs'), `'use strict';
const { spawnSync } = require('node:child_process');
// Constructor-only placeholders are confined to the build child, never runtime credentials.
const env = { ...process.env,
  SUPABASE_URL: 'https://staging-not-configured.invalid',
  SUPABASE_URL_MGMT: 'https://staging-not-configured.invalid',
  SUPABASE_URL_DISPATCH: 'https://staging-not-configured.invalid',
  SUPABASE_SERVICE_KEY: 'build-only-not-a-service-role-key',
  SUPABASE_SERVICE_KEY_MGMT: 'build-only-not-a-service-role-key',
  STRIPE_SECRET_KEY: 'sk_test_build_only_not_configured',
  STRIPE_WEBHOOK_SECRET: 'whsec_build_only_not_configured',
  DATABASE_URL: 'postgresql://build:build@staging-not-configured.invalid:5432/postgres',
};
const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit', env, shell: process.platform === 'win32',
});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
`);
  const backendConfig = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'vercel.json')));
  backendConfig.buildCommand = 'node tools/staging-build.cjs';
  backendConfig.crons = [];
  write(path.join('backend', 'vercel.json'), JSON.stringify(backendConfig, null, 2) + '\n');
  const nextPath = path.join(root, 'backend', 'next.config.js');
  write(path.join('backend', 'next.config.js'), fs.readFileSync(nextPath, 'utf8')
    + '\nmodule.exports.experimental = { ...module.exports.experimental, cpus: 2 };\n');
  write(path.join('frontend', 'api', 'staging-proxy.js'), fs.readFileSync(path.join(__dirname, 'proxy.cjs'), 'utf8')
    + `\nmodule.exports = async function (req, res) {
  try {
    return await createProxy({
      backendOrigin: process.env.H2S_STAGING_BACKEND_ORIGIN,
      bypassSecret: process.env.H2S_STAGING_BACKEND_BYPASS,
    })(req, res);
  } catch (error) {
    console.error('Private staging proxy configuration failed:', error.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, error: 'Private staging proxy is not configured' }));
  }
};\n`);
  write(path.join('frontend', 'vercel.json'), JSON.stringify({
    git: { deploymentEnabled: false },
    buildCommand: '', outputDirectory: '.', cleanUrls: false, trailingSlash: false,
    redirects: ['/portal', '/portal.html'].map(source => ({
      source, destination: `${backendOrigin}/portal`, permanent: false,
    })),
    rewrites: [
      { source: '/api/:path*', destination: '/api/staging-proxy?__staging_path=:path*' },
      { source: '/', destination: '/hub.html' },
      ...['dash', 'hub', 'sales', 'schedule-setup', 'commercial', 'commercial-approval', 'field-agreement',
        'bundles', 'gallery', 'deliverables', 'dispatch', 'funnel-track']
        .map(page => ({ source: `/${page}`, destination: `/${page}.html` })),
      { source: '/dashboard', destination: '/dash.html' },
    ],
    headers: [{ source: '/(.*)', headers: [
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      { key: 'Content-Security-Policy', value: "connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'" },
      { key: 'X-H2S-Staging-Source', value: commit },
    ] }],
  }, null, 2) + '\n');
  write('.vercelignore', [
    '**/.env*', '**/node_modules/**', '**/.next/**', '**/tests/**', '**/migrations/**',
    '**/*.md', '**/*.pem', '**/*.key', '**/*.pfx', '**/*.p12', '**/*.bak*',
    'backend/scripts/**', 'backend/tools/**', '!backend/tools/package-portal.cjs',
    '!backend/tools/staging-build.cjs', 'backend/_*', 'frontend/_*', 'frontend/temp*',
    'frontend/*.test.js', 'frontend/dash.BROKEN_*', 'staging-manifest.json',
  ].join('\n') + '\n');
  const built = stampFrontend(root, commit);
  changes.push(...built.changes);
  const manifest = { sourceCommit: commit, quarantine: true, backendOrigin, frontendOrigin,
    frontendBuildStamp: built.stamp,
    obsoleteLegacyStampAssertions: built.obsoleteAssertions,
    generatedAt: new Date().toISOString(), excludedFiles: excludedFiles.map(file => path.relative(root, file)), changes,
    overlaySha256: digest(JSON.stringify(changes)) };
  fs.writeFileSync(path.join(root, 'staging-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) {
  try {
    let result;
    if (process.argv[2] === '--stamp-only') {
      const root = fs.realpathSync(process.argv[3]);
      const manifestPath = path.join(root, 'staging-manifest.json');
      result = JSON.parse(fs.readFileSync(manifestPath));
      if (result.quarantine !== true) throw new Error('Only an existing quarantined export may be restamped');
      const built = stampFrontend(root, result.sourceCommit);
      result.frontendBuildStamp = built.stamp;
      result.obsoleteLegacyStampAssertions = built.obsoleteAssertions;
      result.changes.push(...built.changes);
      result.overlaySha256 = digest(JSON.stringify(result.changes));
      fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2) + '\n');
    } else {
      const [root, commit, backendOrigin, frontendOrigin] = process.argv.slice(2);
      result = prepare({ root, commit, backendOrigin, frontendOrigin });
    }
    console.log(JSON.stringify({ sourceCommit: result.sourceCommit, quarantine: true,
      frontendBuildStamp: result.frontendBuildStamp,
      overlaySha256: result.overlaySha256, adaptedFiles: result.changes.length }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, stagingOrigin, adaptText, adaptRuntimeText, assertNoSecret, isRuntimeFile, verifyFrontendStamp, nativeMiddlewareSource };
