import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function block(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} extraction`);
  return app.slice(a, b);
}

const src = block('function reconcileNativeSessionUi(', 'function nextAutoStartText(')
  + block('function updateLockScanUi(', 'function renderAll(');

function page({ acknowledged, running, baseline = { date: '2026-11-02' } }) {
  const writes = [];
  const lock = { disabled: false, textContent: '🔒 Lock & Scan' };
  const status = { textContent: '' }, watch = { textContent: '' };
  const fields = [{ disabled: false }, { disabled: false }];
  const snap = { baseline, pollHistory: [{ t: '13:40' }], latestPoll: { date: '2026-11-02' }, serviceStatus: { running, polls: 54 } };
  const ctx = {
    STATE: { pollCount: 0, isWatching: false, morningExpandedAfterLock: false },
    document: { getElementById: id => ({ 'btn-lock': lock, status, 'watch-status': watch })[id],
      querySelectorAll: () => fields },
    nativeBridge: () => true, renderSnapshot: () => snap, getTodayNativeBaseline: () => baseline,
    hasLockedMorningForToday: () => acknowledged,
    todayNativeSessionActive: () => true, latestPollData: () => snap.latestPoll,
    readNativeJson: () => { throw Error('snapshot already supplied'); },
    collapseMorning: () => writes.push('collapse'),
    updateStickyLayout: () => writes.push('layout'),
    Number,
  };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { ctx, snap, lock, status, watch, fields, writes };
}

test('update with saved morning record and stopped service restores lock immediately without rewriting it', () => {
  const p = page({ acknowledged: true, running: false });
  assert.equal(p.ctx.reconcileNativeSessionUi(p.snap), true);
  assert.equal(p.lock.disabled, true);
  assert.equal(p.lock.textContent, 'Locked');
  assert.deepEqual(p.fields.map(f => f.disabled), [true, true]);
  assert.match(p.status.textContent, /Use Trade → Rescan/);
  assert.match(p.watch.textContent, /waiting for polling/);
  assert.deepEqual(p.writes, ['collapse', 'collapse']);
});

test('running service restores watching; a dated baseline alone cannot invent a morning lock', () => {
  const active = page({ acknowledged: true, running: true });
  assert.equal(active.ctx.reconcileNativeSessionUi(active.snap), true);
  assert.equal(active.lock.textContent, 'Watching...');
  assert.match(active.watch.textContent, /Poll #54/);

  const stale = page({ acknowledged: false, running: true });
  assert.equal(stale.ctx.reconcileNativeSessionUi(stale.snap), false);
  stale.ctx.updateLockScanUi(stale.snap);
  assert.equal(stale.lock.disabled, false);
  assert.deepEqual(stale.fields.map(f => f.disabled), [false, false]);
});

test('the form distinguishes editing from refreshing candidates', () => {
  assert.match(html, /id="btn-rescan"[^>]*>✎ Edit morning inputs<\/button>/);
  const scan = block('async function rescanStrategies(', '// TRADE MANAGEMENT');
  assert.match(scan, /requestImmediatePoll\(\)/);
  assert.doesNotMatch(scan, /setMorningInput|lockMorningData/);
});
