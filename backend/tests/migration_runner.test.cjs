const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const runner = require('../apply_migration_pg');
const ref = 'nkccbnrduojnzjfrpwva';
const direct = `postgresql://postgres:example@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const registeredTarget = () => runner.loadTarget('production', { DATABASE_URL_DIRECT: direct });
const target = () => {
  const config = registeredTarget();
  return {
    ...config,
    authorizedMigrations: config.authorizedMigrations.filter(version => version !== '031_commercial_reliability.sql'),
    commercial031: { ...config.commercial031, reviewOnly: true, authorization: undefined },
    commercial032: { ...config.commercial032, reviewOnly: true, authorization: undefined, sqlSha256: null },
    stripe033: { ...config.stripe033, reviewOnly: true, authorization: undefined, sqlSha256: null },
    queue034: { ...config.queue034, reviewOnly: true, authorization: undefined, sqlSha256: null },
    business035: { ...config.business035, reviewOnly: true, authorization: undefined, sqlSha256: null },
    calendar036: { ...config.calendar036, reviewOnly: true, authorization: undefined, sqlSha256: null },
    residential037: { ...config.residential037, reviewOnly: true, authorization: undefined, sqlSha256: null },
    workspace038: { ...config.workspace038, reviewOnly: true, authorization: undefined, sqlSha256: null },
    notification039: { reviewOnly: false, authorization: 'Fixture only; no remote authority',
      sqlSha256: runner.migrations().find(file => file.version === '039_notification_routing.sql').sha256 },
  };
};

test('registered production authorization includes exactly the owner-approved reviewed migration scope', () => {
  const config = registeredTarget();
  assert.deepEqual(config.authorizedMigrations, runner.migrations().map(file => file.version).filter(version => !version.startsWith('039_')));
  assert.equal(config.commercial031.reviewOnly, false);
  assert.match(config.commercial031.authorization, /2026-10-20/);
  assert.equal(config.commercial031.sqlSha256, 'c0e2425df45f7bea99fa6d45dc9becd0dd99ccac80cee95417c8add00de1b071');
  assert.equal(config.commercial032.reviewOnly, false);
  assert.match(config.commercial032.authorization, /2026-10-23/);
  assert.equal(config.commercial032.sqlSha256, 'f703d2a575d32593a1945d4b147d215da8ebaafb93e7aaca99511d24c44b197d');
  assert.equal(config.stripe033.reviewOnly, false);
  assert.match(config.stripe033.authorization, /2026-10-23/);
  assert.equal(config.stripe033.sqlSha256, '29ade041dc667e96c786103d7b944b74aa2122c20c950b62668a5f9cd1d86620');
  assert.equal(config.queue034.reviewOnly,false);
  assert.match(config.queue034.authorization,/2026-10-23/);
  assert.equal(config.queue034.sqlSha256,'5e3111b9a44cf0e88c0b7653f934733ba022b8ea5a47f70cfcb152167172a695');
  assert.equal(config.business035.reviewOnly,false);
  assert.match(config.business035.authorization,/2026-10-23/);
  assert.equal(config.business035.sqlSha256,'432fc68a95337ba0372a6583cf5c405616ad1cfaa6146ad33affefd574433c45');
  assert.equal(config.calendar036.reviewOnly,false);
  assert.match(config.calendar036.authorization,/2026-10-23 at 14:38/);
  assert.equal(config.calendar036.sqlSha256,'34a46bba7bd55f05591ad504a4a3beb38c5a0bf5c9968b1b334756e11a85b665');
  assert.equal(config.residential037.reviewOnly,false);
  assert.match(config.residential037.authorization,/2026-10-26/);
  assert.equal(config.residential037.sqlSha256,'7f7652cf1cdd2f15b3eda64f428bb2a1d0473f3f162353f28fe317ded72227ac');
  assert.equal(config.workspace038.reviewOnly,false);
  assert.match(config.workspace038.authorization,/2026-10-26/);
  assert.equal(config.workspace038.sqlSha256,'f362259f2ae778507aab8fbaab86faf9f02ec350627141e52a6490d07a43f29d');
  assert.throws(()=>runner.authorizeApply(config,ref),/outside the explicitly authorized scope/);
  assert.equal(config.notification039.reviewOnly,true);
  assert.equal(config.notification039.authorization,null);
  assert.equal(config.notification039.sqlSha256,runner.migrations().find(file=>file.version.startsWith('039_')).sha256);
  assert.throws(()=>runner.authorizeApply({...config,authorizedMigrations:runner.migrations().map(file=>file.version)},ref),/039 remains review-only/);
  assert.throws(()=>runner.authorizeApply({...config,
    authorizedMigrations:config.authorizedMigrations.filter(version=>!/^03[78]_/.test(version))},ref),/outside the explicitly authorized scope/);
  const future={...config,residential037:{reviewOnly:true},workspace038:{reviewOnly:true}};
  assert.throws(()=>runner.authorizeApply({...future,authorizedMigrations:runner.migrations().map(file=>file.version)},ref),/037 remains review-only/);
  assert.throws(()=>runner.authorizeApply({...future,authorizedMigrations:runner.migrations().map(file=>file.version),residential037:{reviewOnly:false,authorization:'Fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('037_')).sha256}},ref),/038 remains review-only/);
  for (const calendar036 of [
    {...config.calendar036,reviewOnly:true},
    {...config.calendar036,authorization:null},
    {...config.calendar036,sqlSha256:'changed'},
  ]) assert.throws(() => runner.authorizeApply({...future,authorizedMigrations:runner.migrations().map(file=>file.version),calendar036},ref),/036 remains review-only/);
});

test('target is explicit, no MGMT or generic URL fallback, and exact project/session port is checked', () => {
  assert.throws(() => runner.loadTarget('missing', {}), /registered/);
  assert.throws(() => runner.loadTarget('production', { DATABASE_URL: direct }), /Missing DATABASE_URL_DIRECT/);
  for (const url of [direct.replace(ref, 'wrongproject'), direct.replace(':5432', ':6543'), direct.replace('/postgres?', '/other?')]) {
    assert.throws(() => runner.loadTarget('production', { DATABASE_URL_DIRECT: url }), /target mismatch/);
  }
  const config = target();
  assert.equal(config.environment, 'production');
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.doesNotThrow(() => runner.loadTarget('production', {
    DATABASE_URL_DIRECT: `postgresql://postgres.${ref}:example@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }));
});

test('unknown/unapproved targets, missing baseline, missing confirmation, and extra migrations are blocked', () => {
  const config = target();
  assert.throws(() => runner.authorizeApply({ ...config, environment: 'unknown' }, ref), /unclassified/);
  assert.throws(() => runner.authorizeApply({ ...config, applyAuthorized: false }, ref), /authorized/);
  assert.throws(() => runner.authorizeApply(config, 'wrong'), /confirm-project/);
  assert.throws(() => runner.authorizeApply({ ...config, baselineSha256: null }, ref), /baseline/);
  assert.throws(() => runner.authorizeApply({ ...config, authorizedMigrations: [] }, ref), /scope/);
  assert.throws(() => runner.authorizeApply(config, ref), /scope/);
  const future = { ...config, authorizedMigrations: runner.migrations().map(file => file.version) };
  assert.throws(() => runner.authorizeApply(future, ref), /review-only/);
  const reviewed031 = {
    ...future, commercial031: { ...future.commercial031, reviewOnly: false, authorization: 'Local test only; no remote authority' },
  };
  assert.throws(() => runner.authorizeApply(reviewed031, ref), /032 remains review-only/);
  const reviewed032 = { ...reviewed031,
    commercial032: { reviewOnly: false, authorization: 'Local test only; no remote authority',
      sqlSha256: runner.migrations().find(file => file.version.startsWith('032_')).sha256 } };
  assert.throws(() => runner.authorizeApply(reviewed032, ref), /033 remains review-only/);
  assert.throws(() => runner.authorizeApply({ ...reviewed032,
    stripe033:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:'changed'} },ref), /033 remains review-only/);
  const reviewed033={ ...reviewed032,
    stripe033:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('033_')).sha256} };
  assert.throws(() => runner.authorizeApply(reviewed033,ref),/034 remains review-only/);
  assert.throws(() => runner.authorizeApply({...reviewed033,queue034:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:'changed'}},ref),/034 remains review-only/);
  const reviewed034={...reviewed033,queue034:{reviewOnly:false,authorization:'Local fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('034_')).sha256}};
  assert.throws(()=>runner.authorizeApply(reviewed034,ref),/035 remains review-only/);
  assert.throws(()=>runner.authorizeApply({...reviewed034,business035:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:'changed'}},ref),/035 remains review-only/);
  const reviewed035={...reviewed034,business035:{reviewOnly:false,authorization:'Local fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('035_')).sha256}};
  assert.throws(() => runner.authorizeApply(reviewed035,ref),/036 remains review-only/);
  const reviewed036={...reviewed035,calendar036:{reviewOnly:false,authorization:'Local fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('036_')).sha256}};
  assert.throws(()=>runner.authorizeApply(reviewed036,ref),/037 remains review-only/);
  assert.throws(()=>runner.authorizeApply({...reviewed036,residential037:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:'changed'}},ref),/037 remains review-only/);
  const reviewed037={...reviewed036,residential037:{reviewOnly:false,authorization:'Local fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('037_')).sha256}};
  assert.throws(()=>runner.authorizeApply(reviewed037,ref),/038 remains review-only/);
  assert.throws(()=>runner.authorizeApply({...reviewed037,workspace038:{reviewOnly:false,authorization:'Local fixture only',sqlSha256:'changed'}},ref),/038 remains review-only/);
  assert.doesNotThrow(()=>runner.authorizeApply({...reviewed037,workspace038:{reviewOnly:false,authorization:'Local fixture only',
    sqlSha256:runner.migrations().find(file=>file.version.startsWith('038_')).sha256}},ref));
});

test('TLS requires a CA, keeps certificate/hostname verification, and rejects insecure global overrides', () => {
  assert.throws(() => runner.sslOptions({}), /MIGRATION_CA_CERT_PATH/);
  assert.throws(() => runner.sslOptions({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /forbidden/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-ca-test-'));
  const filename = path.join(directory, 'ca.crt');
  try {
    fs.writeFileSync(filename, tls.rootCertificates[0]);
    const ssl = runner.sslOptions({ MIGRATION_CA_CERT_PATH: filename });
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, undefined);
    assert.ok(ssl.ca.includes(tls.rootCertificates[0]));
    fs.writeFileSync(filename, 'not a certificate');
    assert.throws(() => runner.sslOptions({ MIGRATION_CA_CERT_PATH: filename }));
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('only reviewed migrations are selected and history detects changed or out-of-order SQL', () => {
  const files = runner.migrations();
  assert.equal(files.length, 11);
  assert.deepEqual(files.map((file) => file.version), ['029_create_media_placements.sql', '030_owner_media_placement_fields.sql', '031_commercial_reliability.sql','032_commercial_operations.sql','033_atomic_stripe_order_metadata.sql','034_commercial_followup_delivery.sql','035_commercial_business_tools.sql','036_commercial_calendar_workload.sql','037_residential_inquiries.sql','038_residential_workspace.sql','039_notification_routing.sql']);
  const config = target();
  const rows = files.map((file) => ({
    version: file.version, sha256: file.sha256, project_ref: ref, environment: 'production',
  }));
  assert.doesNotThrow(() => runner.checkHistory(rows, files, config));
  assert.throws(() => runner.checkHistory([{ ...rows[0], sha256: 'changed' }], files, config), /mismatch/);
  assert.throws(() => runner.checkHistory(rows.slice().reverse(), files, config), /mismatch/);
  assert.throws(() => runner.checkHistory([{ ...rows[0], project_ref: 'other' }], files, config), /mismatch/);
  assert.ok(files.every((file) => !/create table if not exists public\.(media_placements|owner_media_uploads)/i.test(file.sql)));
});

test('apply rolls back on unreviewed schema drift before running any migration or recording history', async () => {
  const queries = [];
  const client = { async query(sql) {
    queries.push(sql);
    return { rows: sql.includes('to_regclass') ? [{ name: null }] : [] };
  } };
  const config = target();
  const future = { ...config, authorizedMigrations: runner.migrations().map(file => file.version),
    commercial031: { ...config.commercial031, reviewOnly: false, authorization: 'Local test only; no remote authority' },
    commercial032: { reviewOnly: false, authorization: 'Local test only; no remote authority', sqlSha256: runner.migrations().find(file => file.version.startsWith('032_')).sha256 },
    stripe033: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('033_')).sha256 },
    queue034: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('034_')).sha256 },
    business035: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('035_')).sha256 },
    calendar036: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('036_')).sha256 },
    residential037: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('037_')).sha256 },
    workspace038: { reviewOnly:false,authorization:'Local fixture only',sqlSha256:runner.migrations().find(file=>file.version.startsWith('038_')).sha256 } };
  await assert.rejects(runner.apply(client, future, ref), /differs from.*baseline/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.some((sql) => /create table|insert into|alter table/i.test(sql)));
});

test('programmatic apply also rejects 031 before making any database call', async () => {
  const client = { async query() { assert.fail('An unauthorized apply must not contact the database'); } };
  await assert.rejects(runner.apply(client, target(), ref), /scope/);
});

test('031 baseline accepts only the inspected catalog and detects untracked objects or policy drift', () => {
  const review = require('../lib/commercial_migration_review.cjs');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-baselines', '031_commercial_reliability.json'))).schema;
  assert.doesNotThrow(() => review.assertBaseline(baseline, target()));
  for (const field of ['relations', 'columns', 'indexes', 'policies', 'routines', 'triggers', 'defaultPrivileges']) {
    const changed = structuredClone(baseline);
    changed[field].push({ name: 'untracked-object' });
    assert.throws(() => review.assertBaseline(changed, target()), /differs/);
  }
  assert.throws(() => review.assertBaseline(baseline, { ...target(), commercial031: { ...target().commercial031, sqlSha256: 'changed' } }), /checksum/);
});

test('031 recognizes only the exact reviewed 036 order trigger, never a name-only exemption', () => {
  const review = require('../lib/commercial_calendar_review.cjs');
  const sql = fs.readFileSync(path.join(__dirname,'..','migrations',review.version),'utf8').replace(/\r\n/g,'\n');
  const row = {
    table_name:'h2s_orders',name:'commercial_calendar_order_sync',enabled:'O',
    definition:'CREATE CONSTRAINT TRIGGER commercial_calendar_order_sync AFTER UPDATE ON public.h2s_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commercial_sync_calendar()',
    function_body:/create function public\.commercial_sync_calendar\([\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(sql)[1],
    security_definer:true,config:['search_path=public, pg_temp'],
  };
  assert.equal(review.isReviewedOrderTrigger(row),true);
  const constraint={table_name:'h2s_orders',name:'commercial_calendar_order_sync',type:'t',
    definition:'TRIGGER DEFERRABLE INITIALLY DEFERRED',validated:true};
  assert.equal(review.isReviewedOrderConstraint(constraint,[row]),true);
  assert.equal(review.isReviewedOrderConstraint(constraint,[]),false);
  assert.equal(review.isReviewedOrderConstraint({...constraint,type:'f'},[row]),false);
  assert.equal(review.isReviewedOrderConstraint({...constraint,validated:false},[row]),false);
  for(const change of [
    {table_name:'commercial_leads'},{enabled:'D'},{definition:row.definition.replace('UPDATE','INSERT')},
    {function_body:'begin return null; end'},{security_definer:false},{config:['search_path=public']},
  ]) assert.equal(!!review.isReviewedOrderTrigger({...row,...change}),false);
});

test('031 recognizes only exact reviewed 037 inquiry triggers and rejects altered guards',()=>{
  const review=require('../lib/residential_inquiry_review.cjs');
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',review.version),'utf8').replace(/\r\n/g,'\n');
  for(const [name,table,fn] of [
    ['h2s_lead_market_guard','commercial_leads','h2s_guard_lead_market'],
    ['h2s_inquiry_request_guard','commercial_consultation_requests','h2s_guard_inquiry_request'],
  ]){
    const row={name,table_name:table,enabled:'O',security_definer:true,config:['search_path=public, pg_temp'],
      definition:`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      function_body:new RegExp(`create function public\\.${fn}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)[1]};
    assert.equal(review.isReviewedInquiryTrigger(row),true);
    for(const change of [
      {name:'unreviewed'},{table_name:'h2s_orders'},{enabled:'D'},{security_definer:false},
      {config:['search_path=public']},{function_body:'begin return new; end'},{definition:row.definition.replace('UPDATE','DELETE')},
    ])assert.equal(review.isReviewedInquiryTrigger({...row,...change}),false);
  }
});

test('031 recognizes only the exact reviewed 037 market index',()=>{
  const review=require('../lib/residential_inquiry_review.cjs');
  const row={table_name:'commercial_leads',name:'h2s_lead_market_submitted',valid:true,unique:false,predicate:null,
    definition:"CREATE INDEX h2s_lead_market_submitted ON public.commercial_leads USING btree (COALESCE((attribution ->> 'market'::text), 'commercial'::text), last_submitted_at DESC)"};
  assert.equal(review.isReviewedMarketIndex(row),true);
  for(const change of [
    {table_name:'h2s_orders'},{name:'unreviewed'},{valid:false},{unique:true},{predicate:'false'},
    {definition:row.definition.replace('DESC','ASC')},{definition:row.definition.replace("'commercial'","'residential'")},
  ])assert.equal(review.isReviewedMarketIndex({...row,...change}),false);
});
