/* eslint-disable no-console */
const https = require('https');
const vm = require('vm');

const url = 'https://home2smart.com/funnel';

function fetchText(u) {
  return new Promise((resolve, reject) => {
    https
      .get(u, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ res, data }));
      })
      .on('error', reject);
  });
}

function isInlineScriptTag(attrs) {
  return !/\bsrc\s*=/.test(attrs);
}

function isJsonScriptTag(attrs) {
  return /type\s*=\s*['\"]application\/(?:ld\+json|json)['\"]/i.test(attrs);
}

function getInlineScripts(html) {
  const tags = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
    attrs: m[1] || '',
    body: m[2] || '',
  }));

  return tags.filter((t) => isInlineScriptTag(t.attrs)).filter((t) => !isJsonScriptTag(t.attrs));
}

function findBadControlChars(js) {
  const hits = [];
  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    const isControl = c < 32 || c === 127;
    const isAllowed = c === 9 || c === 10 || c === 13;
    if (isControl && !isAllowed) {
      hits.push({ index: i, code: c });
      if (hits.length >= 50) break;
    }
  }
  return hits;
}

function printSnippet(js, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(js.length, index + radius);
  const snippet = js.slice(start, end);
  console.log('snippet:', JSON.stringify(snippet));
}

(async () => {
  const { res, data: html } = await fetchText(url);
  console.log('status:', res.statusCode);
  console.log('content-type:', res.headers['content-type']);
  console.log('cache-control:', res.headers['cache-control']);
  console.log('server:', res.headers['server']);
  console.log('html length:', html.length);

  const scripts = getInlineScripts(html);
  console.log('inline non-json scripts:', scripts.length);

  scripts.forEach((s, idx) => {
    console.log('\n--- script', idx, 'len', s.body.length, 'attrs', JSON.stringify(s.attrs.trim().slice(0, 120)));

    const badControls = findBadControlChars(s.body);
    console.log('bad control chars (first 50):', badControls.length);
    if (badControls.length) {
      for (const hit of badControls.slice(0, 5)) {
        console.log('control char at', hit.index, 'code', hit.code);
        printSnippet(s.body, hit.index);
      }
    }

    try {
      new vm.Script(s.body);
      console.log('vm.Script: OK');
    } catch (e) {
      console.log('vm.Script ERROR:', String(e));
      const stack = String(e.stack || '').split('\n').slice(0, 6).join('\n');
      console.log(stack);

      // Try to locate first problematic char by incremental parsing (binary search)
      let lo = 0;
      let hi = s.body.length;
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2);
        try {
          new vm.Script(s.body.slice(0, mid));
          lo = mid;
        } catch {
          hi = mid;
        }
      }
      console.log('first failing prefix length (approx):', hi);
      printSnippet(s.body, hi);
    }
  });
})().catch((e) => {
  console.error('Fatal:', e);
  process.exitCode = 1;
});
