export type DispatchSchema = {
  assignmentsTable: string;
  assignmentsProCol: string;
  assignmentsJobCol: string;
  assignmentsStateCol?: string;

  jobsTable: string;
  jobsIdCol: string;
  jobsStatusCol?: string;

  discoveredAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { schema: DispatchSchema; expiresAt: number } | null = null;

const ASSIGN_PRO_ID_COLS = ['pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_uuid', 'tech_uuid', 'user_id'];
const ASSIGN_PRO_EMAIL_COLS = ['pro_email', 'tech_email', 'email'];
const ASSIGN_JOB_REF_COLS = ['job_id', 'dispatch_job_id', 'work_order_id', 'workorder_id', 'ticket_id', 'order_id', 'id'];
const ASSIGN_STATE_COLS = ['assign_state', 'assignment_state', 'status', 'state'];

const JOB_ID_COLS = ['job_id', 'dispatch_job_id', 'work_order_id', 'workorder_id', 'ticket_id', 'id'];
const JOB_STATUS_COLS = ['status', 'job_status', 'state'];

// Helpful “shape” columns to prefer a real jobs table.
const JOB_HINT_COLS = [
  'service_name',
  'service_id',
  'address',
  'city',
  'state',
  'zip',
  'start_iso',
  'window',
  'description',
  'line_items',
  'metadata',
  'notes',
  'created_at',
];

function norm(s: string): string {
  return String(s || '').toLowerCase();
}

function scoreTableName(name: string, kind: 'assign' | 'job'): number {
  const n = norm(name);
  let score = 0;
  const bump = (needle: string, points: number) => {
    if (n.includes(needle)) score += points;
  };

  if (kind === 'assign') {
    bump('assign', 8);
    bump('assignment', 8);
    bump('dispatch', 4);
    bump('job', 3);
    bump('offer', 2);
    bump('work', 1);
    bump('ticket', 1);
  } else {
    bump('job', 8);
    bump('dispatch', 4);
    bump('work', 2);
    bump('ticket', 2);
    bump('order', 1);
  }

  // Small penalty for obviously wrong tables.
  if (n.includes('tracking')) score -= 5;
  if (n.includes('pixel')) score -= 5;
  if (n.includes('review')) score -= 3;

  return score;
}

function pickFirstExisting(cols: Set<string>, preferred: string[]): string | null {
  for (const c of preferred) {
    if (cols.has(c)) return c;
  }
  return null;
}

function looksLikeEmail(value: string): boolean {
  const s = String(value || '').trim();
  return s.includes('@') && s.includes('.') && s.length <= 254;
}

function readEnvOverride(name: string): string | null {
  const v = process.env[name];
  return v && String(v).trim().length ? String(v).trim() : null;
}

function getSchemaFromEnv(): DispatchSchema | null {
  const assignmentsTable = readEnvOverride('PORTAL_ASSIGNMENTS_TABLE') || readEnvOverride('DISPATCH_ASSIGNMENTS_TABLE');
  const jobsTable = readEnvOverride('PORTAL_JOBS_TABLE') || readEnvOverride('DISPATCH_JOBS_TABLE');
  if (!assignmentsTable || !jobsTable) return null;

  const assignmentsProCol = readEnvOverride('PORTAL_ASSIGNMENTS_PRO_COL') || 'pro_id';
  const assignmentsJobCol = readEnvOverride('PORTAL_ASSIGNMENTS_JOB_COL') || 'job_id';
  const assignmentsStateCol = readEnvOverride('PORTAL_ASSIGNMENTS_STATE_COL') || 'assign_state';

  const jobsIdCol = readEnvOverride('PORTAL_JOBS_ID_COL') || 'job_id';
  const jobsStatusCol = readEnvOverride('PORTAL_JOBS_STATUS_COL') || 'status';

  return {
    assignmentsTable,
    assignmentsProCol,
    assignmentsJobCol,
    assignmentsStateCol,
    jobsTable,
    jobsIdCol,
    jobsStatusCol,
    discoveredAt: Date.now(),
  };
}

const ASSIGN_TABLE_CANDIDATES = [
  'h2s_dispatch_job_assignments',
  'dispatch_job_assignments',
  'dispatch_assignments',
  'job_assignments',
  'job_assignment',
  'assignments',
  'h2s_job_assignments',
  'h2s_dispatch_assignments',
  'h2s_assignments',
];

const JOB_TABLE_CANDIDATES = [
  'h2s_dispatch_jobs',
  'dispatch_jobs',
  'h2s_jobs',
  'jobs',
  'job',
  'work_orders',
  'workorders',
  'h2s_work_orders',
  'tickets',
  'h2s_tickets',
];

async function probeTable(client: any, table: string): Promise<{ ok: boolean; row?: any }> {
  try {
    const { data, error } = await client.from(table).select('*').limit(1);
    if (error) return { ok: false };
    return { ok: true, row: Array.isArray(data) ? data[0] : undefined };
  } catch {
    return { ok: false };
  }
}

function inferColsFromRow(row: any): Set<string> {
  if (!row || typeof row !== 'object') return new Set<string>();
  return new Set(Object.keys(row));
}

export async function resolveDispatchSchema(
  client: any,
  params?: { preferProValue?: string; preferEmailValue?: string }
): Promise<DispatchSchema | null> {
  const env = getSchemaFromEnv();
  if (env) return env;
  if (cached && cached.expiresAt > Date.now()) return cached.schema;
  if (!client) return null;

  const preferEmail = looksLikeEmail(params?.preferProValue || '') || looksLikeEmail(params?.preferEmailValue || '');

  // Find assignments table by probing candidates and inferring columns from a sample row.
  let bestAssign: { table: string; cols: Set<string>; score: number } | null = null;
  for (const table of ASSIGN_TABLE_CANDIDATES) {
    const hit = await probeTable(client, table);
    if (!hit.ok) continue;

    const cols = inferColsFromRow(hit.row);
    // If table exists but is empty, cols may be unknown; still keep as weak candidate.
    const hasPro = cols.size
      ? ASSIGN_PRO_ID_COLS.some((c) => cols.has(c)) || ASSIGN_PRO_EMAIL_COLS.some((c) => cols.has(c))
      : true;
    const hasJobRef = cols.size ? ASSIGN_JOB_REF_COLS.some((c) => cols.has(c)) : true;
    if (!hasPro || !hasJobRef) continue;

    const score = scoreTableName(table, 'assign') + (cols.size ? 2 : 0);
    if (!bestAssign || score > bestAssign.score) bestAssign = { table, cols, score };
  }

  if (!bestAssign) return null;

  const assignmentsProCol = bestAssign.cols.size
    ? (preferEmail
        ? pickFirstExisting(bestAssign.cols, [...ASSIGN_PRO_EMAIL_COLS, ...ASSIGN_PRO_ID_COLS])
        : pickFirstExisting(bestAssign.cols, [...ASSIGN_PRO_ID_COLS, ...ASSIGN_PRO_EMAIL_COLS]))
    : preferEmail
      ? ASSIGN_PRO_EMAIL_COLS[0]
      : ASSIGN_PRO_ID_COLS[0];

  const assignmentsJobCol = bestAssign.cols.size
    ? pickFirstExisting(bestAssign.cols, ASSIGN_JOB_REF_COLS)
    : ASSIGN_JOB_REF_COLS[0];

  const assignmentsStateCol = bestAssign.cols.size
    ? (pickFirstExisting(bestAssign.cols, ASSIGN_STATE_COLS) || undefined)
    : undefined;

  if (!assignmentsProCol || !assignmentsJobCol) return null;

  // Find jobs table similarly.
  let bestJobs: { table: string; cols: Set<string>; score: number } | null = null;
  for (const table of JOB_TABLE_CANDIDATES) {
    const hit = await probeTable(client, table);
    if (!hit.ok) continue;
    const cols = inferColsFromRow(hit.row);

    const score = scoreTableName(table, 'job') + JOB_HINT_COLS.reduce((acc, c) => acc + (cols.has(c) ? 1 : 0), 0);
    if (!bestJobs || score > bestJobs.score) bestJobs = { table, cols, score };
  }
  if (!bestJobs) return null;

  const jobsIdCol = bestJobs.cols.size
    ? (bestJobs.cols.has(assignmentsJobCol)
        ? assignmentsJobCol
        : pickFirstExisting(bestJobs.cols, ['job_id', 'dispatch_job_id', 'work_order_id', 'ticket_id', 'id']) ||
          pickFirstExisting(bestJobs.cols, JOB_ID_COLS))
    : 'job_id';

  if (!jobsIdCol) return null;

  const jobsStatusCol = bestJobs.cols.size ? pickFirstExisting(bestJobs.cols, JOB_STATUS_COLS) || undefined : undefined;

  const schema: DispatchSchema = {
    assignmentsTable: bestAssign.table,
    assignmentsProCol,
    assignmentsJobCol,
    assignmentsStateCol,
    jobsTable: bestJobs.table,
    jobsIdCol,
    jobsStatusCol,
    discoveredAt: Date.now(),
  };

  cached = { schema, expiresAt: Date.now() + CACHE_TTL_MS };
  return schema;
}
