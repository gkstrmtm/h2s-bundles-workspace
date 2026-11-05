const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const http = require('node:http'), https = require('node:https'), net = require('node:net');
const workspace = path.resolve(__dirname, '..', '..');
const port = Number(process.env.H2S_REVIEW_PORT || 50271);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local review port.');
const origin = 'https://127.0.0.1:' + port;
const httpPort = process.env.H2S_REVIEW_HTTP_PORT ? Number(process.env.H2S_REVIEW_HTTP_PORT) : null;
if (httpPort !== null && (!Number.isInteger(httpPort) || httpPort < 1024 || httpPort > 65535 || httpPort === port))
    throw Error('Invalid optional loopback HTTP review port.');
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
if (cp.execFileSync('git', ['branch', '--show-current'], { cwd: workspace, encoding: 'utf8' }).trim() !== 'retro-dev')
    throw Error('The interactive review requires retro-dev.');
const tls = {
    key: fs.readFileSync(process.env.H2S_REVIEW_TLS_KEY),
    cert: fs.readFileSync(process.env.H2S_REVIEW_TLS_CERT)
};
global.fetch = async () => { throw Error('External network disabled in isolated walkthrough.'); };
for (const client of [http, https]) for (const method of ['request', 'get'])
    client[method] = () => { throw Error('External HTTP disabled in isolated walkthrough.'); };
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const options = typeof args[0] === 'object' ? args[0] : { host: args[1] };
    if (options.host && !['127.0.0.1', 'localhost', '::1'].includes(options.host))
        throw Error('External sockets disabled in isolated walkthrough.');
    return nativeConnect.apply(this, args);
};
const { createWalkthrough } = require('./walkthrough-fixture.cjs');
const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
};
const assets = new Map();
const worktree = process.env.H2S_REVIEW_WORKTREE === 'true';
const reviewedAssets=new Set(['frontend/sales.html','frontend/sales-app.js','frontend/sales-app.css','frontend/dashboard-controls.js',
    'frontend/dash.html','frontend/dash.js','frontend/field-sales.js','frontend/field-sales.css','frontend/field-commerce.js',
    'frontend/field-workflow.js','frontend/field-workflow.css','frontend/field-earnings.js']);
function committed(relative) {
    if(worktree&&reviewedAssets.has(relative))return fs.readFileSync(path.join(workspace,...relative.split('/')));
    if (assets.has(relative)) return assets.get(relative);
    const names = cp.execFileSync('git', ['ls-tree', '-z', '--name-only', commit, '--', relative], { cwd: workspace, encoding: 'utf8' }).split('\0');
    if (!names.includes(relative)) return null;
    const data = cp.execFileSync('git', ['show', commit + ':' + relative], { cwd: workspace, maxBuffer: 15 * 1024 * 1024 });
    assets.set(relative, data); return data;
}
function samplePhoto() {
    const zlib = require('node:zlib'), width = 480, height = 240, raw = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = y * (width * 3 + 1) + 1 + x * 3, value = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? 180 : 240;
        raw.fill(value, offset, offset + 3);
    }
    const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
    const chunk = (name, data) => {
        const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
        size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
        return Buffer.concat([size, type, data, checksum]);
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
(async () => {
    const engine = await createWalkthrough({ origin });
    const gallery=process.env.H2S_REVIEW_SALES_GALLERY==='true'
        ?await require('./sales-preview-seed.cjs').seedSalesPreview(engine,samplePhoto()):null;
    const handler = async (req, res) => {
        try {
            const requestPort = req.socket.encrypted ? port : httpPort;
            const requestOrigin = req.socket.encrypted ? origin : 'http://127.0.0.1:' + httpPort;
            if (!requestPort || !['127.0.0.1:' + requestPort, 'localhost:' + requestPort].includes(req.headers.host)) return json(res, 403, { ok: false, error: 'Loopback only.' });
            if (req.headers.origin && req.headers.origin !== requestOrigin) return json(res, 403, { ok: false, error: 'Cross-origin request blocked.' });
            const url = new URL(req.url, origin);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob:; media-src 'self' blob: data:; frame-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'");
            let text = '';
            if (!['GET', 'HEAD'].includes(req.method)) for await (const chunk of req) {
                text += chunk; if (Buffer.byteLength(text) > 9 * 1024 * 1024) return json(res, 413, { ok: false, error: 'Local request exceeds 9 MiB.' });
            }
            let body;
            if (text) {
                try { body = JSON.parse(text); } catch { return json(res, 400, { ok: false, error: 'Invalid JSON.' }); }
            }
            if (url.pathname === '/walkthrough/status') return json(res, 200, { ...(await engine.status()), sourceCommit: commit, assetsMode:worktree?'reviewed-sales-working-tree':'committed', gallery, isolated: true, productionNetwork: false, outgoingPayments: false });
            if (url.pathname === '/walkthrough/control') {
                if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST required.' });
                if (!['reset', 'provider_capture', 'provider_decline'].includes(body?.action)) return json(res, 400, { ok: false, error: 'Unsupported review control.' });
                return json(res, 200, await engine.control(body.action, body));
            }
            if (url.pathname === '/walkthrough/sample-photo.png') {
                res.setHeader('Content-Type', 'image/png'); return res.end(samplePhoto());
            }
            if (url.pathname === '/walkthrough/artifact') {
                const response = await engine.request('walkthrough-artifact', 'GET', null, 'pro', url.search);
                res.writeHead(response.status, Object.fromEntries(response.headers));
                return res.end(Buffer.from(await response.arrayBuffer()));
            }
            if (url.pathname.startsWith('/api/')) {
                const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
                const actor = token === 'local-review-admin' ? 'admin' : token === 'h2s-sales:local-review' ? 'sales' : token === 'local-review-pro' ? 'pro' : token;
                const response = await engine.request(url.pathname.slice(5), req.method, body, actor, url.search);
                res.writeHead(response.status, Object.fromEntries(response.headers));
                return res.end(Buffer.from(await response.arrayBuffer()));
            }
            const local = { '/': 'walkthrough.html', '/walkthrough': 'walkthrough.html', '/walkthrough/navigator.js': 'walkthrough.js',
                '/walkthrough/boot.js': 'bootstrap.js', '/walkthrough/provider': 'walkthrough-provider.html', '/sales-review':'sales-preview.html' }[url.pathname];
            if (local) {
                res.setHeader('Content-Type', mime[path.extname(local)]);
                return res.end(fs.readFileSync(path.join(__dirname, local)));
            }
            let relative = decodeURIComponent(url.pathname).replace(/^\/frontend\//, '/').replace(/^\//, '');
            if (relative.split(/[\\/]/).some(part => part === '..') || !mime[path.extname(relative)]) return json(res, 404, { ok: false, error: 'Not an application asset.' });
            if (/^dash\.PORTAL_BUILD_.*\.css$/.test(relative)) relative = 'dash.css';
            if (/^dash\.PORTAL_BUILD_.*\.js$/.test(relative)) relative = 'dash.js';
            const appPath = relative === 'portal.html' ? 'portal.html' : 'frontend/' + relative;
            let data = committed(appPath);
            if (!data) return json(res, 404, { ok: false, error: 'Asset is not in the verified commit: ' + appPath });
            if (relative.endsWith('.html')) data = data.toString().replace(/<head([^>]*)>/i, '<head$1><script src="/walkthrough/boot.js"></script>')
                .replace(/content="https:\/\/h2s-backend\.vercel\.app"/g, 'content="' + requestOrigin + '"')
                .replaceAll('https://cdn.jsdelivr.net/gh/gkstrmtm/home2smart-assets@main/logo-180.png', '/media/home2smart-logo.png')
                .replaceAll('https://storage.googleapis.com/msgsndr/7Drmpw623JAkrfDKPdjG/media/68da0ce6f00445991d64a63f.png', '/media/home2smart-logo.png');
            res.setHeader('Content-Type', mime[path.extname(relative)]); res.end(data);
        } catch (error) {
            console.error('Isolated walkthrough request failed:', error.message);
            if (!res.headersSent) json(res, 500, { ok: false, error: error.message }); else res.end();
        }
    };
    const server = https.createServer(tls, handler);
    const httpServer = httpPort === null ? null : http.createServer(handler);
    server.listen(port, '127.0.0.1', () => console.log('READY ' + origin + '/ - committed ' + commit + '; isolated interactive walkthrough'));
    if (httpServer) httpServer.listen(httpPort, '127.0.0.1', () => console.log('READY http://127.0.0.1:' + httpPort + '/sales-review - synthetic editor preview; secure customer links remain HTTPS'));
    async function close() { server.close(); if (httpServer) httpServer.close(); await engine.close(); }
    for (const listener of [server, httpServer].filter(Boolean)) listener.once('error', error => {
        console.error('Local review listener failed:', error.message); close().catch(failure => console.error(failure)); process.exitCode = 1;
    });
    process.once('SIGINT', close); process.once('SIGTERM', close);
})().catch(error => { console.error('Interactive walkthrough startup failed:', error); process.exitCode = 1; });
