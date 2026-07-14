const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const FRONTEND_ROOT = path.resolve(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT || 3000);
const BACKEND_ORIGIN = process.env.H2S_PREVIEW_BACKEND_ORIGIN || 'https://h2s-backend.vercel.app';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(message);
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const rawPath = decodeURIComponent(requestUrl.pathname || '/');
  const relativePath = rawPath === '/' || rawPath === '/media' || rawPath === '/media.html' || rawPath === '/owner-media'
    ? '/owner-media.html'
    : rawPath;
  const targetPath = path.resolve(FRONTEND_ROOT, `.${relativePath}`);

  if (!targetPath.startsWith(FRONTEND_ROOT)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(targetPath);
    if (stat.isDirectory()) {
      sendText(res, 403, 'Directory listing disabled');
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(targetPath).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function proxyApi(req, res) {
  const target = new URL(req.url || '/', BACKEND_ORIGIN);
  const headers = { ...req.headers };
  delete headers.host;
  headers.origin = `http://127.0.0.1:${PORT}`;

  const proxyReq = https.request(target, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, {
      ...proxyRes.headers,
      'Cache-Control': 'no-store',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    sendText(res, 502, `Proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Local frontend preview running at http://127.0.0.1:${PORT}\n`);
  process.stdout.write(`Proxying /api/* to ${BACKEND_ORIGIN}\n`);
});