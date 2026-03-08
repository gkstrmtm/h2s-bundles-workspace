/* eslint-disable no-console */

const { spawn } = require('child_process');
const path = require('path');

const smokeScript = path.join(__dirname, 'smoke-test-training-upload.js');
const timeoutMs = Number(process.env.SMOKE_WATCHDOG_TIMEOUT_MS || process.env.SMOKE_TIMEOUT_MS || 25000);

const nodeExe = process.execPath;

console.log('[watchdog] starting', smokeScript);
console.log('[watchdog] timeoutMs', timeoutMs);

const child = spawn(nodeExe, [smokeScript], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Ensure the child also has its own internal hard timeout.
    SMOKE_TIMEOUT_MS: String(Math.min(Math.max(5000, timeoutMs - 1000), timeoutMs))
  }
});

let killed = false;
const timer = setTimeout(() => {
  killed = true;
  console.error(`[watchdog] TIMEOUT: killing smoke test after ${timeoutMs}ms`);
  try { child.kill('SIGKILL'); } catch (_) {}
  // Give it a moment, then force exit.
  setTimeout(() => process.exit(124), 500).unref?.();
}, timeoutMs);

if (timer && typeof timer.unref === 'function') {
  // Keep timer referenced (do NOT unref): watchdog must fire even if child is quiet.
}

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) {
    console.error('[watchdog] child exited via signal', signal);
    process.exit(killed ? 124 : 1);
  }
  process.exit(code == null ? 1 : code);
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.error('[watchdog] failed to start smoke test', err);
  process.exit(1);
});
