const test = require('node:test'), assert = require('node:assert/strict');
const { Client } = require('pg');
const { schema, migration, reliability, context, assign, respond, id } = require('./helpers/management_assignment_fixture.cjs');
const connectionString = process.env.H2S_ASSIGNMENT_TEST_DATABASE_URL;
test('041 independent PostgreSQL sessions serialize management and existing assignment writers', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/h2s_assignment_fixture_[a-z0-9_]+$/);
  const first = new Client({ connectionString }), second = new Client({ connectionString }), observer = new Client({ connectionString });
  await Promise.all([first.connect(), second.connect(), observer.connect()]);
  try {
    await first.query(schema); await first.query(migration); await first.query(reliability);
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
    await first.query("update h2s_dispatch_job_assignments set state='offer_sent' where job_id=$1", [id(101)]);
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

    await first.query('BEGIN');
    assert.equal((await respond(first, { job: id(102) })).job_status, 'assigned');
    const acceptanceRetry = respond(second, { job: id(102) }).then(value => value, error => ({ error }));
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await acceptanceRetry).replayed, true);
    assert.equal((await observer.query("select count(*)::int n from h2s_management_assignment_activity where source='technician_response'")).rows[0].n, 1);
    await assert.rejects(respond(first, { job: id(102), pro: id(501) }), { code: '42501' });

    for (let n = 103; n <= 107; n++) await first.query(`insert into h2s_dispatch_jobs(job_id,order_id,status,due_at)
      values($1,'ORD-FIXTURE','queued',$2)`, [id(n), `2099-01-0${n - 100}T15:00:00Z`]);
    await assign(first, { job: id(103), operation: id(703) });
    await first.query('BEGIN');
    await respond(first, { job: id(103), action: 'decline' });
    const acceptVersusDecline = respond(second, { job: id(103) }).then(() => null, error => error);
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await acceptVersusDecline).code, '23514');
    assert.equal((await observer.query('select status from h2s_dispatch_jobs where job_id=$1', [id(103)])).rows[0].status, 'queued');
    assert.equal((await respond(first, { job: id(103), action: 'decline' })).replayed, true);
    await assert.rejects(second.query(`insert into h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state)
      values('legacy-bypass-after-decline',$1,$2,'accepted')`, [id(103),id(501)]), { code: '42501' });

    const rollbackSnapshot = (await context(first, id(104))).context;
    await first.query('BEGIN');
    await assign(first, { job: id(104), operation: id(704), snapshot: rollbackSnapshot });
    const rolledBackRetry = assign(second, { job: id(104), operation: id(704), snapshot: rollbackSnapshot }).then(value => value, error => ({ error }));
    await waitForLock(); await first.query('ROLLBACK');
    assert.equal((await rolledBackRetry).replayed, false);
    assert.equal((await observer.query('select count(*)::int n from h2s_management_assignment_activity where job_id=$1', [id(104)])).rows[0].n, 1);

    await assign(first, { job: id(105), operation: id(705) });
    await first.query(`create function fixture_response_audit_fail() returns trigger language plpgsql as $$
      begin if NEW.new_state='accepted' then raise exception 'Fixture response audit failure'; end if; return NEW; end$$;
      create trigger fixture_response_fail before insert on h2s_management_assignment_activity
      for each row execute function fixture_response_audit_fail();`);
    await assert.rejects(respond(first, { job: id(105) }), /Fixture response audit failure/);
    assert.equal((await observer.query('select state from h2s_dispatch_job_assignments where job_id=$1', [id(105)])).rows[0].state, 'pending');
    assert.equal((await observer.query('select status from h2s_dispatch_jobs where job_id=$1', [id(105)])).rows[0].status, 'queued');
    await first.query('drop trigger fixture_response_fail on h2s_management_assignment_activity');
    await respond(first, { job: id(105) });

    await assign(first, { job: id(106), operation: id(706) });
    await first.query(`create function fixture_deferred_status_fail() returns trigger language plpgsql as $$
      begin if NEW.status='assigned' then raise exception 'Fixture deferred status failure'; end if; return NEW; end$$;
      create constraint trigger fixture_deferred_fail after update on h2s_dispatch_jobs deferrable initially deferred
      for each row execute function fixture_deferred_status_fail();`);
    await assert.rejects(respond(first, { job: id(106) }), /Fixture deferred status failure/);
    assert.equal((await observer.query('select state from h2s_dispatch_job_assignments where job_id=$1', [id(106)])).rows[0].state, 'pending');
    assert.equal((await observer.query('select count(*)::int n from h2s_management_assignment_activity where job_id=$1', [id(106)])).rows[0].n, 1);
    await first.query('drop trigger fixture_deferred_fail on h2s_dispatch_jobs');
    await respond(first, { job: id(106) });

    const repeatableSnapshot = (await context(first, id(107))).context;
    await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await context(second, id(107));
    await assign(first, { job: id(107), operation: id(707), snapshot: repeatableSnapshot });
    const staleTransaction = assign(second, { job: id(107), operation: id(708), pro: id(501), snapshot: repeatableSnapshot }).then(() => null, error => error);
    await waitForLock(); await first.query('COMMIT');
    assert.equal((await staleTransaction).code, '40001'); await second.query('ROLLBACK');
    await first.query(`insert into h2s_dispatch_jobs(job_id,order_id,status,due_at)
      values($1,'ORD-FIXTURE','queued','2099-01-08T15:00:00Z')`, [id(108)]);
    assert.equal((await second.query('select count(*)::int n from h2s_management_assignment_requests where job_id=$1', [id(108)])).rows[0].n, 0);
    await assign(first, { job: id(108), operation: id(709) });
    await assert.rejects(second.query("update h2s_dispatch_job_assignments set state='accepted' where job_id=$1", [id(108)]), { code: '42501' });
    assert.equal((await observer.query('select state from h2s_dispatch_job_assignments where job_id=$1', [id(108)])).rows[0].state, 'pending');
    await respond(first, { job: id(108) });
    assert.equal((await observer.query(`select count(*)::int n from(
      select job_id from h2s_dispatch_job_assignments
      where state is null or state not in('declined','expired','cancelled','canceled','completed','done','rejected')
      group by job_id having count(*)>1) conflicts`)).rows[0].n, 0);
    assert.equal((await observer.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    await Promise.all([first.end(),second.end(),observer.end()]);
  }
});
