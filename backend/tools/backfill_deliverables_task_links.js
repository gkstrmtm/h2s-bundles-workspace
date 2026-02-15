require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

function pickArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

function findFirstUuid(text) {
  const s = String(text || '');
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

async function main() {
  const mgmtUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_MGMT || process.env.SUPABASE_URL_MGMT;
  const mgmtKey = process.env.SUPABASE_SERVICE_ROLE_KEY_MGMT || process.env.SUPABASE_SERVICE_KEY_MGMT;
  const mainUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const mainKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!mgmtUrl || !mgmtKey) {
    console.error('Missing MGMT Supabase creds. Expected SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT in backend/.env.local');
    process.exit(1);
  }
  if (!mainUrl || !mainKey) {
    console.error('Missing MAIN Supabase creds. Expected SUPABASE_URL + SUPABASE_SERVICE_KEY in backend/.env.local');
    process.exit(1);
  }

  const dryRun = hasFlag('--dry-run') || !hasFlag('--yes');
  const limit = Number(pickArg('--limit', '200'));
  const mode = String(pickArg('--mode', 'exact')).toLowerCase(); // exact|contains

  const supabaseMgmt = createClient(mgmtUrl, mgmtKey);
  const supabaseMain = createClient(mainUrl, mainKey);

  console.log(`[link-backfill] mode=${dryRun ? 'DRY_RUN' : 'APPLY'} limit=${limit} matchMode=${mode}`);

  // 1) Load candidate deliverables (exclude SYSTEM_IMPORT so we don't try to match docs/sql archive items).
  const { data: deliverables, error: dErr } = await supabaseMgmt
    .from('Deliverables')
    .select('Deliverable_ID, Title, Description, Submitted_By, Status, Created_At, Task_ID, Task_Title, Task_URL')
    .order('Created_At', { ascending: false })
    .limit(2000);

  if (dErr) {
    console.error('[link-backfill] Failed to load deliverables:', dErr);
    process.exit(1);
  }

  const candidates = (deliverables || []).filter((d) => {
    if (d.Submitted_By === 'SYSTEM_IMPORT') return false;
    if (d.Task_ID) return false;
    const title = String(d.Title || '').trim();
    if (!title) return false;
    return true;
  }).slice(0, limit);

  console.log(`[link-backfill] deliverables fetched=${(deliverables || []).length} candidates=${candidates.length}`);
  if (!candidates.length) {
    console.log('[link-backfill] Nothing to backfill.');
    return;
  }

  // 2) Load tasks to match against.
  // Tasks have historically lived in MAIN for the portal, but some environments also mirror them in MGMT.
  const [mainTasksRes, mgmtTasksRes] = await Promise.all([
    supabaseMain
      .from('Tasks')
      .select('Task_ID, Title, URL, Description, Status, Updated_At, Created_At')
      .order('Updated_At', { ascending: false })
      .limit(5000),
    supabaseMgmt
      .from('Tasks')
      .select('Task_ID, Title, URL, Description, Status, Updated_At, Created_At')
      .order('Updated_At', { ascending: false })
      .limit(5000),
  ]);

  if (mainTasksRes.error) {
    console.error('[link-backfill] Failed to load MAIN tasks:', mainTasksRes.error);
    process.exit(1);
  }

  const mainTasks = mainTasksRes.data || [];
  const mgmtTasks = mgmtTasksRes.error ? [] : (mgmtTasksRes.data || []);

  const tasksByIdUnion = new Map();
  for (const t of [...mainTasks, ...mgmtTasks]) {
    const id = String(t.Task_ID);
    if (!id) continue;
    if (!tasksByIdUnion.has(id)) tasksByIdUnion.set(id, t);
  }

  const tasksArr = [...tasksByIdUnion.values()];
  console.log(`[link-backfill] tasks loaded main=${mainTasks.length} mgmt=${mgmtTasks.length} union=${tasksArr.length}`);

  const tasksById = new Map(tasksArr.map((t) => [String(t.Task_ID), t]));

  // Title index (only keep unique normalized titles)
  const titleToTask = new Map();
  const dupTitles = new Set();
  for (const t of tasksArr) {
    const key = normalizeTitle(t.Title);
    if (!key) continue;
    if (titleToTask.has(key)) {
      dupTitles.add(key);
      titleToTask.delete(key);
      continue;
    }
    if (!dupTitles.has(key)) titleToTask.set(key, t);
  }

  const planned = [];

  for (const d of candidates) {
    const desc = String(d.Description || '');
    const title = String(d.Title || '');

    // A) Strong match: a Task_ID uuid appears in description
    const embedded = findFirstUuid(desc);
    if (embedded && tasksById.has(embedded)) {
      const task = tasksById.get(embedded);
      planned.push({ deliverable: d, task, reason: 'desc_uuid' });
      continue;
    }

    // B) Exact normalized title match (unique)
    const norm = normalizeTitle(title);
    if (norm && titleToTask.has(norm)) {
      const task = titleToTask.get(norm);
      planned.push({ deliverable: d, task, reason: 'title_exact' });
      continue;
    }

    // C) Contains match (opt-in)
    if (mode === 'contains' && norm) {
      const hits = [];
      for (const t of tasksArr) {
        const tn = normalizeTitle(t.Title);
        if (!tn) continue;
        if (tn === norm) continue;
        if (tn.includes(norm) || norm.includes(tn)) hits.push(t);
        if (hits.length > 5) break;
      }
      if (hits.length === 1) {
        planned.push({ deliverable: d, task: hits[0], reason: 'title_contains_unique' });
      }
    }
  }

  console.log(`[link-backfill] planned_links=${planned.length}`);
  if (!planned.length) {
    console.log('[link-backfill] No safe matches found.');
    console.log('[link-backfill] Tip: re-run with --mode contains for slightly looser (still cautious) matching.');
    return;
  }

  // Preview first few planned updates.
  for (const p of planned.slice(0, 10)) {
    console.log(`- ${p.reason} deliverable=${p.deliverable.Deliverable_ID} title=${JSON.stringify(p.deliverable.Title)} -> task=${p.task.Task_ID} ${JSON.stringify(p.task.Title)}`);
  }
  if (planned.length > 10) console.log(`... (${planned.length - 10} more)`);

  if (dryRun) {
    console.log('[link-backfill] Dry run only. Re-run with --yes to apply these updates.');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const p of planned) {
    const patch = {
      Task_ID: String(p.task.Task_ID),
      Task_Title: p.task.Title || null,
      Task_URL: p.task.URL || null,
    };

    const { error: uErr } = await supabaseMgmt
      .from('Deliverables')
      .update(patch)
      .eq('Deliverable_ID', p.deliverable.Deliverable_ID);

    if (uErr) {
      errors += 1;
      console.error('[link-backfill] Update failed:', { deliverableId: p.deliverable.Deliverable_ID, taskId: p.task.Task_ID, error: uErr });
      continue;
    }

    updated += 1;
  }

  console.log(`[link-backfill] done updated=${updated} errors=${errors}`);
}

main().catch((e) => {
  console.error('[link-backfill] Fatal:', e?.stack || e?.message || String(e));
  process.exit(1);
});
