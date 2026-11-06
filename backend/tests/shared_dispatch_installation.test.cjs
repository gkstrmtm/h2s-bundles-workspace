const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{PGlite}=require('@electric-sql/pglite');
test('native shared-dispatch migration preserves sequence checks and separates installation identity',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create table h2s_dispatch_jobs(
    job_id uuid primary key default gen_random_uuid(),order_id text,status text not null default 'pending'
      check(status in('pending','sequence_sent')),
    recipient_id uuid not null,sequence_id uuid not null,step_id uuid not null,due_at timestamptz not null);
    insert into h2s_dispatch_jobs(recipient_id,sequence_id,step_id,due_at)
      values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now());`);
  await db.exec(fs.readFileSync(path.join(__dirname,'..','migrations','052_shared_dispatch_installation.sql'),'utf8'));
  assert.equal((await db.query('select job_kind from h2s_dispatch_jobs')).rows[0].job_kind,'sequence');
  await db.exec(`insert into h2s_dispatch_jobs(status,recipient_id,sequence_id,step_id,due_at)
    values('sequence_sent',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now())`);
  for(const sql of [
    `insert into h2s_dispatch_jobs(status,recipient_id,sequence_id,step_id,due_at)
      values('completed',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now())`,
    `insert into h2s_dispatch_jobs(status) values('pending')`,
    `insert into h2s_dispatch_jobs(job_kind,status) values('installation','completed')`,
    `insert into h2s_dispatch_jobs(job_kind,status,order_id,recipient_id)
      values('installation','completed','synthetic-order',gen_random_uuid())`,
    `insert into h2s_dispatch_jobs(job_kind,status,order_id) values('installation','sequence_sent','synthetic-order')`,
    `insert into h2s_dispatch_jobs(job_kind,status,order_id) values('unknown','completed','synthetic-order')`
  ])await assert.rejects(db.exec(sql),error=>error.code==='23514');
  await db.exec(`insert into h2s_dispatch_jobs(job_kind,status,order_id)
    values('installation','completed','synthetic-order')`);
  assert.equal((await db.query(`select count(*)::int n from h2s_dispatch_jobs where job_kind='installation'`)).rows[0].n,1);
});
