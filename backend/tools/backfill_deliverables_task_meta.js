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

function missingColumnHint(err) {
  const msg = String(err?.message || err || '');
  if (msg.toLowerCase().includes('column') && msg.toLowerCase().includes('does not exist')) return true;
  if (msg.toLowerCase().includes('schema cache')) return true;
  return false;
}

async function main() {
  const limit = Number(pickArg('--limit', '500'));
  const dryRun = hasFlag('--dry-run') || !hasFlag('--yes');

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

  const supabaseMgmt = createClient(mgmtUrl, mgmtKey);
  const supabaseMain = createClient(mainUrl, mainKey);

  console.log(`[backfill] mode=${dryRun ? 'DRY_RUN' : 'APPLY'} limit=${limit}`);

  // Pull deliverables that *already* have Task_ID but are missing Task_Title/Task_URL.
  const { data: deliverables, error: dErr } = await supabaseMgmt
    .from('Deliverables')
    .select('Deliverable_ID, Title, Task_ID, Task_Title, Task_URL, Created_At')
    .not('Task_ID', 'is', null)
    .order('Created_At', { ascending: false })
    .limit(limit);

  if (dErr) {
    console.error('[backfill] Failed to load deliverables:', dErr);
    if (missingColumnHint(dErr)) {
      console.error('[backfill] Hint: MGMT Deliverables table may be missing Task_* columns. Run migration 005_alter_deliverables_add_task_ref.sql in the MGMT SQL editor first.');
    }
    process.exit(1);
  }

  const needs = (deliverables || []).filter((d) => {
    const taskId = d.Task_ID;
    if (!taskId) return false;
    const missingTitle = d.Task_Title == null || String(d.Task_Title).trim() === '';
    const missingUrl = d.Task_URL == null || String(d.Task_URL).trim() === '';
    return missingTitle || missingUrl;
  });

  console.log(`[backfill] deliverables fetched=${(deliverables || []).length} needing_backfill=${needs.length}`);
  if (!needs.length) {
    console.log('[backfill] Nothing to backfill.');
    return;
  }

  const taskIds = [...new Set(needs.map((d) => String(d.Task_ID)))];

  const tasksById = new Map();
  for (const group of chunk(taskIds, 200)) {
    const { data: tasks, error: tErr } = await supabaseMain
      .from('Tasks')
      .select('Task_ID, Title, URL')
      .in('Task_ID', group);

    if (tErr) {
      console.error('[backfill] Failed to load tasks:', tErr);
      process.exit(1);
    }

    for (const t of tasks || []) {
      tasksById.set(String(t.Task_ID), t);
    }
  }

  let updated = 0;
  let skippedNoTask = 0;
  let errors = 0;

  for (const d of needs) {
    const taskId = String(d.Task_ID);
    const task = tasksById.get(taskId);
    if (!task) {
      skippedNoTask += 1;
      continue;
    }

    const nextTitle = (d.Task_Title == null || String(d.Task_Title).trim() === '') ? (task.Title || null) : d.Task_Title;
    const nextUrl = (d.Task_URL == null || String(d.Task_URL).trim() === '') ? (task.URL || null) : d.Task_URL;

    if (nextTitle === d.Task_Title && nextUrl === d.Task_URL) continue;

    if (dryRun) {
      updated += 1;
      continue;
    }

    const patch = {};
    if (nextTitle !== d.Task_Title) patch.Task_Title = nextTitle;
    if (nextUrl !== d.Task_URL) patch.Task_URL = nextUrl;

    const { error: uErr } = await supabaseMgmt
      .from('Deliverables')
      .update(patch)
      .eq('Deliverable_ID', d.Deliverable_ID);

    if (uErr) {
      errors += 1;
      console.error('[backfill] Update failed:', { deliverableId: d.Deliverable_ID, taskId, error: uErr });
      if (missingColumnHint(uErr)) {
        console.error('[backfill] Hint: MGMT Deliverables table may be missing Task_Title/Task_URL. Run migration 005_alter_deliverables_add_task_ref.sql in the MGMT SQL editor first.');
        break;
      }
      continue;
    }

    updated += 1;
  }

  console.log(`[backfill] done updated=${updated} skipped_no_task=${skippedNoTask} errors=${errors}`);
  if (dryRun) {
    console.log('[backfill] Dry run only. Re-run with --yes to apply updates.');
  }
}

main().catch((e) => {
  console.error('[backfill] Fatal:', e?.stack || e?.message || String(e));
  process.exit(1);
});
