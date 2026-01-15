const DISPATCH_JOB_ALLOWED_KEYS = new Set([
  'job_id',
  'created_at',
  'updated_at',
  'recipient_id',
  'sequence_id',
  'step_id',
  'due_at',
  'status',
  'locked_at',
  'lock_owner',
  'attempt_count',
  'last_error',
  'order_id',
]);

/**
 * Guardrail: never allow schema-invented columns into h2s_dispatch_jobs writes.
 *
 * This intentionally drops any unknown keys instead of throwing, so checkout/scheduling
 * doesn't break in production if someone accidentally adds extra fields.
 */
export function filterDispatchJobPayload<T extends Record<string, any>>(payload: T): Partial<T> {
  if (!payload || typeof payload !== 'object') return payload;

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!DISPATCH_JOB_ALLOWED_KEYS.has(key)) continue;
    if (typeof value === 'undefined') continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export function getDispatchJobAllowedKeys(): string[] {
  return Array.from(DISPATCH_JOB_ALLOWED_KEYS);
}
