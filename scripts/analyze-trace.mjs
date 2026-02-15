import fs from 'node:fs';
import path from 'node:path';

function ms(us) {
  return us / 1000;
}

function pickUrl(e) {
  return e?.args?.data?.url || e?.args?.beginData?.url || e?.args?.data?.scriptName || '';
}

const tracePathArg = process.argv[2] || 'tmp-longtask-trace.json';
const tracePath = path.resolve(tracePathArg);
const data = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
const traceEvents = Array.isArray(data.traceEvents) ? data.traceEvents : [];

const events = traceEvents.filter((e) => e && typeof e.ts === 'number');
const longTasks = events
  .filter((e) => e.name === 'RunTask' && e.ph === 'X' && typeof e.dur === 'number' && e.dur >= 50_000)
  .sort((a, b) => b.dur - a.dur);

console.log(`trace: ${tracePath}`);
console.log(`events: ${events.length}`);
console.log(`long tasks (>=50ms): ${longTasks.length}`);

if (!longTasks.length) process.exit(0);

const top = longTasks[0];
const start = top.ts;
const end = top.ts + top.dur;

console.log('\n== Top Long Task ==');
console.log({
  ts: top.ts,
  durMs: ms(top.dur).toFixed(1),
  pid: top.pid,
  tid: top.tid
});

const sameThread = events.filter((e) => e.pid === top.pid && e.tid === top.tid);

function within(e) {
  const dur = typeof e.dur === 'number' ? e.dur : 0;
  return e.ts >= start && e.ts + dur <= end;
}

function overlaps(e) {
  const dur = typeof e.dur === 'number' ? e.dur : 0;
  return e.ts < end && e.ts + dur > start;
}

const nested = sameThread
  .filter((e) => e.ph === 'X' && e.name !== 'RunTask' && typeof e.dur === 'number' && e.dur > 0 && within(e))
  .sort((a, b) => b.dur - a.dur)
  .slice(0, 25)
  .map((e) => ({
    name: e.name,
    durMs: ms(e.dur).toFixed(1),
    cat: (e.cat || '').split(',').slice(0, 3).join(','),
    url: pickUrl(e)
  }));

const overlap = sameThread
  .filter((e) => e.ph === 'X' && e.name !== 'RunTask' && typeof e.dur === 'number' && e.dur > 0 && overlaps(e))
  .sort((a, b) => b.dur - a.dur)
  .slice(0, 25)
  .map((e) => ({
    name: e.name,
    durMs: ms(e.dur).toFixed(1),
    cat: (e.cat || '').split(',').slice(0, 3).join(','),
    url: pickUrl(e)
  }));

console.log('\n== Top Nested Events ==');
console.table(nested);

console.log('\n== Top Overlapping Events ==');
console.table(overlap);
