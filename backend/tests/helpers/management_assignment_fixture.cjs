const fs = require('node:fs'), path = require('node:path');
const { id } = require('./commercial_operations_fixture.cjs');
const schema = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create table h2s_dispatch_jobs(job_id uuid primary key,order_id text,status text not null check(status in
    ('queued','assigned','in_progress','completed','cancelled','done')),due_at timestamptz,updated_at timestamptz default now());
  create table h2s_orders(id uuid primary key,order_id text unique,total numeric,commercial_request_id uuid,
    metadata_json jsonb,service_name text,customer_name text,customer_email text,updated_at timestamptz default now(),status text default 'paid');
  create table h2s_pros(pro_id uuid primary key,name text,email text unique,is_active boolean);
  create table h2s_dispatch_job_assignments(assign_id text primary key,job_id text,pro_id text,state text,
    offer_sent_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),
    accepted_at timestamptz,declined_at timestamptz);
  create table h2s_jobs(job_id text primary key,customer_email text);
  create table h2s_payouts_ledger(payout_id uuid primary key,job_id text references h2s_jobs(job_id),pro_id uuid references h2s_pros(pro_id));
  insert into h2s_orders values('${id(100)}','ORD-FIXTURE',1200,null,'{}','TV installation','Fixture Customer','fixture@example.invalid',now());
  insert into h2s_dispatch_jobs values('${id(101)}','ORD-FIXTURE','queued','2099-01-01T15:00:00Z',now()),
    ('${id(102)}','ORD-FIXTURE','queued','2099-01-01T16:00:00Z',now());
  insert into h2s_pros values('${id(500)}','Fixture Installer','tech@example.invalid',true),
    ('${id(501)}','Other Installer','other@example.invalid',true),
    ('${id(502)}','Inactive Installer','inactive@example.invalid',false),
    ('${id(503)}','','unnamed@example.invalid',true);
`;
const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', 'migrations', '041_management_assignment.sql'), 'utf8');
const reliability = fs.readFileSync(path.resolve(__dirname, '..', '..', 'migrations', '042_management_offer_reliability.sql'), 'utf8');
const preview = async (db, job = id(101)) => (await db.query('select h2s_management_assignment_preview($1) value', [job])).rows[0].value;
const context = async (db, job = id(101)) => (await db.query('select h2s_management_assignment_context($1) value', [job])).rows[0].value;
const assign = async (db, { job = id(101), pro = id(500), operation = id(700), actor = id(9), snapshot, note = 'Reviewed fixture technician offer' } = {}) => (
  await db.query('select h2s_management_assign_technician($1,$2,$3,$4,$5,$6) value',
    [job, pro, operation, actor, snapshot ?? (await context(db, job)).context, note])).rows[0].value;
const respond = async (db, { job = id(101), pro = id(500), action = 'accept' } = {}) => (
  await db.query('select h2s_management_respond_to_offer($1,$2,$3) value', [job, pro, action])).rows[0].value;
module.exports = { schema, migration, reliability, preview, context, assign, respond, id };
