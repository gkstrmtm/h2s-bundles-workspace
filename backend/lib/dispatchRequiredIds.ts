type SupabaseLikeClient = {
  from: (table: string) => any;
};

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function readEnvUuid(...keys: string[]): string | null {
  for (const k of keys) {
    const v = String(process.env[k] || '').trim();
    if (isUuid(v)) return v;
  }
  return null;
}

async function pickAnyUuidFromTable(client: SupabaseLikeClient, table: string, column: string): Promise<string | null> {
  try {
    const { data, error } = await client.from(table).select(column).limit(5);
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const v = (row as any)?.[column];
      if (isUuid(v)) return String(v).trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function pickSequenceId(client: SupabaseLikeClient): Promise<{ value: string | null; source: string }> {
  const env = readEnvUuid('DEFAULT_DISPATCH_SEQUENCE_ID', 'DISPATCH_DEFAULT_SEQUENCE_ID');
  if (env) return { value: env, source: 'env' };

  // Canonical FK target per schema.
  const direct = await pickAnyUuidFromTable(client, 'h2s_sequences', 'sequence_id');
  if (direct) return { value: direct, source: 'h2s_sequences' };

  // Back-compat guesses.
  for (const t of ['h2s_dispatch_sequences', 'dispatch_sequences', 'sequences', 'h2s_job_sequences', 'job_sequences']) {
    const v = await pickAnyUuidFromTable(client, t, 'sequence_id');
    if (v) return { value: v, source: t };
  }

  // Last resort: reuse from jobs (if any exist).
  const fromJobs = await pickAnyUuidFromTable(client, 'h2s_dispatch_jobs', 'sequence_id');
  if (fromJobs) return { value: fromJobs, source: 'h2s_dispatch_jobs' };

  return { value: null, source: 'none' };
}

async function pickRecipientId(client: SupabaseLikeClient): Promise<{ value: string | null; source: string }> {
  const env = readEnvUuid('DEFAULT_DISPATCH_RECIPIENT_ID', 'DISPATCH_DEFAULT_RECIPIENT_ID');
  if (env) return { value: env, source: 'env' };

  const direct = await pickAnyUuidFromTable(client, 'h2s_recipients', 'recipient_id');
  if (direct) return { value: direct, source: 'h2s_recipients' };

  for (const t of ['h2s_dispatch_recipients', 'dispatch_recipients', 'recipients']) {
    const v = await pickAnyUuidFromTable(client, t, 'recipient_id');
    if (v) return { value: v, source: t };
  }

  const fromJobs = await pickAnyUuidFromTable(client, 'h2s_dispatch_jobs', 'recipient_id');
  if (fromJobs) return { value: fromJobs, source: 'h2s_dispatch_jobs' };

  return { value: null, source: 'none' };
}

async function pickStepId(
  client: SupabaseLikeClient,
  sequenceId: string | null
): Promise<{ value: string | null; source: string; matchedSequenceId?: string | null }> {
  const env = readEnvUuid('DEFAULT_DISPATCH_STEP_ID', 'DISPATCH_DEFAULT_STEP_ID');
  if (env) return { value: env, source: 'env', matchedSequenceId: null };

  // Canonical FK target per schema.
  try {
    if (sequenceId && isUuid(sequenceId)) {
      // Try to pick the first step for the chosen sequence.
      const { data, error } = await client
        .from('h2s_sequence_steps')
        .select('step_id,sequence_id')
        .eq('sequence_id', sequenceId)
        .limit(5);
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const sid = (row as any)?.step_id;
          if (isUuid(sid)) return { value: String(sid).trim(), source: 'h2s_sequence_steps', matchedSequenceId: sequenceId };
        }
      }
    }
  } catch {
    // ignore
  }

  // Any step at all.
  try {
    const { data, error } = await client.from('h2s_sequence_steps').select('step_id,sequence_id').limit(5);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const sid = (row as any)?.step_id;
        if (isUuid(sid)) {
          const msid = (row as any)?.sequence_id;
          return { value: String(sid).trim(), source: 'h2s_sequence_steps', matchedSequenceId: isUuid(msid) ? String(msid).trim() : null };
        }
      }
    }
  } catch {
    // ignore
  }

  // Back-compat guesses.
  for (const t of [
    'h2s_dispatch_steps',
    'dispatch_steps',
    'h2s_steps',
    'steps',
    'h2s_dispatch_job_steps',
    'dispatch_job_steps',
    'h2s_job_steps',
    'job_steps',
    'h2s_dispatch_workflow_steps',
    'dispatch_workflow_steps',
    'workflow_steps',
  ]) {
    const v = await pickAnyUuidFromTable(client, t, 'step_id');
    if (v) return { value: v, source: t, matchedSequenceId: null };
  }

  const fromJobs = await pickAnyUuidFromTable(client, 'h2s_dispatch_jobs', 'step_id');
  if (fromJobs) return { value: fromJobs, source: 'h2s_dispatch_jobs', matchedSequenceId: null };

  return { value: null, source: 'none', matchedSequenceId: null };
}

export async function resolveDispatchRequiredIds(client: SupabaseLikeClient): Promise<{
  recipientId: string | null;
  sequenceId: string | null;
  stepId: string | null;
  diagnostics: any;
}> {
  const sequence = await pickSequenceId(client);
  const recipient = await pickRecipientId(client);
  const step = await pickStepId(client, sequence.value);

  return {
    recipientId: recipient.value,
    sequenceId: sequence.value,
    stepId: step.value,
    diagnostics: {
      recipient_source: recipient.source,
      sequence_source: sequence.source,
      step_source: step.source,
      step_matched_sequence_id: step.matchedSequenceId ?? null,
    },
  };
}
