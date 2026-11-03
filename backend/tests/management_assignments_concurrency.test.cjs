const test = require('node:test'), assert = require('node:assert/strict');
const { Client } = require('pg');
const { schema, migration, context, assign, id } = require('./helpers/management_assignment_fixture.cjs');
const connectionString = process.env.H2S_ASSIGNMENT_TEST_DATABASE_URL;
test('041 independent PostgreSQL sessions serialize management and existing assignment writers', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/h2s_assignment_fixture_[a-z0-9_]+$/);
  const first = new Client({ connectionString }), second = new Client({ connectionString }), observer = new Client({ connectionString });
  await Promise.all([first.connect(), second.connect(), observer.connect()]);
  try {
    await first.query(schema); await first.query(migration);
    await first.query('update h2s_management_assignment_config set enabled=true');
    const snapshot = (await context(first)).context;
    async function waitForLock() {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        if ((await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [second.processID])).rowCount) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail('Second session did not wait for the assignment lock');
    }
    await first.query('BEGIN');
    await assign(first, { snapshot });
    const competing = assign(second, { snapshot, operation: id(701), pro: id(501) }).then(() => null, error => error);
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await competing).code, '40001');
    await first.query('BEGIN');
    await first.query("update h2s_dispatch_job_assignments set state='accepted' where job_id=$1", [id(101)]);
    const existing = second.query(`insert into h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state)
      values('competing-portal',$1,$2,'accepted')`, [id(101),id(501)]).then(() => null, error => error);
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await existing).code, '23505');
    assert.equal((await observer.query('select count(*)::int n from h2s_dispatch_job_assignments')).rows[0].n, 1);
    assert.equal((await observer.query('select count(*)::int n from h2s_management_assignment_activity')).rows[0].n, 2);
    const nextSnapshot = (await context(first, id(102))).context;
    await first.query('BEGIN');
    await assign(first, { job: id(102), operation: id(702), snapshot: nextSnapshot });
    const retry = assign(second, { job: id(102), operation: id(702), snapshot: nextSnapshot }).then(value => value, error => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await retry).replayed, true);
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    await Promise.all([first.end(),second.end(),observer.end()]);
  }
});
