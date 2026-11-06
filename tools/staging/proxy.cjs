'use strict';

const LIMIT = 4_456_448;

function createProxy({ backendOrigin, bypassSecret, fetchImpl = fetch }) {
  const origin = new URL(backendOrigin);
  if (origin.protocol !== 'https:' || !/^h2s-staging-backend(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin.hostname)
    || origin.origin !== backendOrigin || !bypassSecret) {
    throw new Error('A private staging backend origin and server-only bypass are required');
  }
  return async function proxy(req, res) {
    function failure(status, error) {
      console.error('Private staging proxy:', error);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, error }));
    }
    try {
      const source = new URL(req.url, 'https://staging.invalid');
      const rawPath = req.query?.__staging_path ?? source.searchParams.get('__staging_path');
      if (typeof rawPath !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(rawPath)) {
        return failure(400, 'Invalid staging API path');
      }
      const capture = source.searchParams.getAll('path');
      if (capture.length && (capture.length !== 1 || capture[0] !== rawPath || source.pathname !== `/api/${rawPath}`)) {
        return failure(400, 'Invalid staging routing metadata');
      }
      const target = new URL(`/api/${rawPath}`, origin);
      for (const [key, value] of source.searchParams) {
        if (key !== '__staging_path' && key !== 'path') target.searchParams.append(key, value);
      }
      const headers = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (/^(authorization|content-type|accept|origin|x-requested-with|x-h2s-[a-z-]+|x-portal-token)$/i.test(key)
          && typeof value === 'string') headers[key] = value;
      }
      headers['x-vercel-protection-bypass'] = bypassSecret;
      const chunks = [];
      let length = 0;
      if (!['GET', 'HEAD'].includes(req.method)) {
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          length += bytes.length;
          if (length > LIMIT) return failure(413, 'Staging request exceeds the application proof limit');
          chunks.push(bytes);
        }
      }
      const response = await fetchImpl(target.href, {
        method: req.method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      if (response.status >= 300 && response.status < 400) {
        return failure(502, 'The private staging backend unexpectedly redirected; access must be verified');
      }
      res.statusCode = response.status;
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Private staging upstream request failed:', error.name);
      failure(502, 'The private staging backend could not be reached');
    }
  };
}

module.exports = { createProxy, LIMIT };
