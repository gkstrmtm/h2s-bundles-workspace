const projectOrigin = 'https://nkccbnrduojnzjfrpwva.supabase.co';
const runPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function stagingSandboxIdentity() {
  const runId = process.env.H2S_STAGING_SANDBOX_RUN_ID;
  if (!runId) return null;
  if (!runPattern.test(runId) || process.env.VERCEL_ENV !== 'preview'
    || process.env.H2S_STAGING_SYNTHETIC_ONLY !== 'true'
    || process.env.H2S_FIELD_STRIPE_MODE !== 'test' || process.env.H2S_FIELD_STRIPE_LIVE_ENABLED !== 'false') {
    throw new Error('Private staging sandbox identity/mode is invalid; refusing unscoped database access');
  }
  const schema = 'h2s_test_' + runId.replace(/-/g, '');
  if (process.env.H2S_STAGING_DATABASE_SCHEMA !== schema) {
    throw new Error('Private staging schema does not match the test run');
  }
  return { runId, schema, filesBucket: 'h2s-test-' + runId + '-files', proofBucket: 'h2s-test-' + runId + '-proof' };
}
export function stagingSandboxOptions(origin: string, transport: typeof fetch = fetch) {
  const run = stagingSandboxIdentity();
  if (!run) return {};
  const scopedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (new URL(origin).origin !== projectOrigin || url.origin !== projectOrigin) {
      throw new Error('Private staging refused an unexpected provider origin');
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (url.pathname.startsWith('/rest/v1/')) {
      headers.set('Accept-Profile', run.schema);
      headers.set('Content-Profile', run.schema);
    } else if (url.pathname.startsWith('/storage/v1/')) {
      const parts = url.pathname.split('/');
      const object = parts[3] === 'object';
      const index = object && ['sign','public','authenticated','list','upload','info'].includes(parts[4]) ? 5 : 4;
      const bucket = decodeURIComponent(parts[index] || '');
      const mapped = bucket === 'commercial-private-files' ? run.filesBucket
        : ['h2s-job-artifacts','job-artifacts','artifacts','dispatch-artifacts','uploads'].includes(bucket)
          ? run.proofBucket : bucket;
      if (![run.filesBucket,run.proofBucket].includes(mapped)) {
        throw new Error('Private staging refused a bucket outside the test run');
      }
      parts[index] = encodeURIComponent(mapped);
      url.pathname = parts.join('/');
    } else {
      throw new Error('Private staging refused an unscoped provider API');
    }
    const request = input instanceof Request ? new Request(url, input) : url;
    return transport(request, { ...init, headers });
  };
  return { global: { fetch: scopedFetch } };
}
