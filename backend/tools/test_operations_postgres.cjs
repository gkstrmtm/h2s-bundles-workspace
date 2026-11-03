const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const net = require('node:net'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const suites = [
  ['H2S_ASSIGNMENT_TEST_DATABASE_URL', 'h2s_assignment_fixture_', 'management_assignments_concurrency.test.cjs'],
  ['H2S_CALENDAR_TEST_DATABASE_URL', 'h2s_calendar_fixture_', 'commercial_calendar_concurrency.test.cjs'],
];
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--bin') throw Error('Usage: node tools\\test_operations_postgres.cjs --bin <PostgreSQL bin directory>');
  const bin = path.resolve(argv[1]), suffix = process.platform === 'win32' ? '.exe' : '';
  for (const command of ['initdb', 'pg_ctl']) if (!fs.existsSync(path.join(bin, command + suffix))) throw Error(`Missing PostgreSQL executable: ${command}`);
  const roots = [], env = { ...process.env };
  const execute = (command, args) => {
    const result = spawnSync(path.join(bin, command + suffix), args, {
      encoding: 'utf8', windowsHide: true, stdio: command === 'pg_ctl' ? 'ignore' : 'pipe',
    });
    if (result.error || result.status !== 0) throw Error(`${command} failed: ${result.stderr || result.error?.message || result.stdout}`);
    return result.stdout;
  };
  try {
    for (const [key, prefix] of suites) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-operations-pg-')), data = path.join(root, 'data');
      const cluster = { root, data, started: false };
      roots.push(cluster);
      fs.writeFileSync(path.join(root, '.h2s-disposable'), 'h2s-operations-test');
      const password = crypto.randomBytes(24).toString('hex'), pwfile = path.join(root, 'init-password');
      fs.writeFileSync(pwfile, password, { mode: 0o600 });
      execute('initdb', ['-D', data, '-U', 'h2s_fixture', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', pwfile]);
      fs.unlinkSync(pwfile);
      const port = await unusedPort();
      cluster.started = true;
      execute('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
      const database = prefix + crypto.randomBytes(6).toString('hex');
      const client = new Client({ host: '127.0.0.1', port, user: 'h2s_fixture', password, database: 'postgres' });
      try {
        await client.connect();
        const identity = (await client.query("select current_setting('data_directory') directory,host(inet_server_addr()) address")).rows[0];
        if (path.relative(path.resolve(identity.directory), data) !== '' || identity.address !== '127.0.0.1') throw Error('Disposable PostgreSQL identity mismatch');
        await client.query(`create database "${database}"`);
      } finally { await client.end(); }
      env[key] = `postgresql://h2s_fixture:${password}@127.0.0.1:${port}/${database}`;
      console.log(`Verified disposable local PostgreSQL for ${key}; no production configuration loaded.`);
    }
    const result = spawnSync(process.execPath, ['--test', ...suites.map(([, , file]) => path.resolve(__dirname, '..', 'tests', file))],
      { env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error('Native PostgreSQL tests failed.');
  } finally {
    const cleanupErrors = [];
    for (const cluster of roots.reverse()) {
      try {
        if (cluster.started) execute('pg_ctl', ['-D', cluster.data, '-m', 'fast', '-w', '-t', '30', 'stop']);
        if (path.dirname(cluster.root) !== os.tmpdir() || !path.basename(cluster.root).startsWith('h2s-operations-pg-')
          || fs.readFileSync(path.join(cluster.root, '.h2s-disposable'), 'utf8') !== 'h2s-operations-test') throw Error('Refusing unrecognized test-directory cleanup');
        fs.rmSync(cluster.root, { recursive: true });
      } catch (error) {
        cleanupErrors.push(new Error(`Disposable cluster retained at ${cluster.root}: ${error.message}`));
      }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, cleanupErrors.map(error => error.message).join('\n'));
  }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
