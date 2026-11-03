const fs = require('node:fs'), path = require('node:path');
const dotenv = require('dotenv'), { Client } = require('pg');
const { loadTarget, sslOptions } = require('../apply_migration_pg.js');
async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== '--read-only') throw Error('Usage: node tools\\reconcile_assignments_readonly.cjs --read-only');
  for (const name of ['.env.migrations.local', '.env.local']) {
    const file = path.resolve(__dirname, '..', name);
    if (fs.existsSync(file)) for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  const client = new Client({ connectionString: loadTarget('production').connectionString, ssl: sslOptions(), connectionTimeoutMillis: 12000 });
  let transaction = false;
  try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    await client.query("SET LOCAL statement_timeout='15s'");
    const joins = `from h2s_dispatch_job_assignments a
      left join h2s_dispatch_jobs j on j.job_id::text=lower(a.job_id)
      left join h2s_jobs l on l.job_id=a.job_id
      left join h2s_pros p on p.pro_id::text=lower(a.pro_id)
      left join h2s_dispatch_pros d on d.pro_id=a.pro_id`;
    const query = async sql => (await client.query(sql)).rows;
    const report = {
      inspectedAt: new Date().toISOString(), readOnly: true,
      migrationState: await query(`select to_regclass('public.h2s_management_assignment_config') is not null assignment_schema,
        to_regprocedure('public.h2s_management_respond_to_offer(uuid,uuid,text)') is not null response_rpc,
        to_regclass('public.h2s_dispatch_legacy_job_links') is not null reviewed_links`),
      cohorts: await query(`select a.state,count(*)::int assignments,
        count(*)filter(where j.job_id is null)::int missing_dispatch,
        count(*)filter(where l.job_id is not null)::int legacy_job_matches,
        count(*)filter(where p.pro_id is not null)::int portal_pro_matches,
        count(*)filter(where d.pro_id is not null)::int dispatch_pro_matches,
        count(*)filter(where exists(select 1 from h2s_orders o where o.id::text=lower(a.job_id)))::int order_uuid_references,
        count(*)filter(where exists(select 1 from h2s_orders o where o.order_id=a.job_id))::int public_order_references,
        count(*)filter(where exists(select 1 from h2s_orders o where o.session_id=a.job_id))::int checkout_session_references,
        min(a.created_at)::date first_date,max(a.created_at)::date last_date ${joins} group by a.state order by 1`),
      conflicts: await query(`select left(md5(a.job_id),12) job_case,count(*)::int assignments,
        count(distinct a.pro_id)::int technician_references,array_agg(distinct a.state) states,
        bool_or(j.job_id is not null) dispatch_exists ${joins}
        where a.state is null or a.state not in('declined','expired','cancelled','canceled','completed','done','rejected')
        group by a.job_id having count(*)>1 order by 1`),
      namespaces: await query(`select
        (select count(*)::int from h2s_dispatch_jobs) dispatch_jobs,
        (select count(*)::int from h2s_jobs) legacy_jobs,
        (select count(*)::int from h2s_dispatch_jobs d join h2s_jobs l on d.job_id::text=l.job_id) same_job_key,
        (select count(*)::int from h2s_pros) portal_pros,
        (select count(*)::int from h2s_dispatch_pros) dispatch_pros,
        (select count(*)::int from h2s_dispatch_pros d join h2s_pros p on d.pro_id=p.pro_id::text) same_pro_key,
        (select count(*)::int from h2s_dispatch_pros d join h2s_pros p on lower(d.email)=lower(p.email)) shared_email`),
      cases: await query(`select left(md5(a.assign_id),12) assignment_case,left(md5(a.job_id),12) job_case,
        a.state,j.job_id is null missing_dispatch,l.job_id is not null legacy_job_match,
        p.pro_id is null unresolved_portal_pro,d.pro_id is not null dispatch_directory_pro
        ${joins} order by 1`),
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { if (transaction) await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}
module.exports = { main };
if (require.main === module) main().catch(error => {
  console.error('Read-only reconciliation failed', { code: error.code || 'DIAGNOSTIC_FAILED', message: error.code ? undefined : error.message });
  process.exitCode = 1;
});
