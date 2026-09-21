import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function reconcilePaperPositionMarks');
const end = src.indexOf('\nfunction validDateOrBlank', start);
assert.ok(start > 0 && end > start, 'position-mark reconciliation helpers not found');
const helpers = src.slice(start, end);
const sandbox = {
  Number, String, Array, Object, Date,
  asFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
};
vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

const initial = [{ id: 278, paper: true, current_pnl: null, valuation_quality: 'unavailable' }];
const live = sandbox.reconcilePaperPositionMarks(initial, {
  '278': {
    display_state: 'LIVE_FULL', last_valid_current_pnl: 1677,
    last_valid_tick_ts: '2026-09-21T04:17:47.983Z', source: 'P1_REST_60S'
  }
});
assert.equal(live[0].current_pnl, 1677);
assert.equal(live[0].valuation_quality, 'full');
assert.equal(live[0].position_mark_state, 'LIVE_FULL');

const stale = sandbox.reconcilePaperPositionMarks(initial, {
  '278': {
    display_state: 'STALE_LAST_VALID', last_valid_current_pnl: 1677,
    last_valid_tick_ts: '2026-09-21T04:17:47.983Z', source: 'P1_REST_60S'
  }
});
assert.equal(stale[0].current_pnl, 1677);
assert.equal(stale[0].valuation_quality, 'stale');
assert.equal(stale[0].position_mark_actionable, false);

const real = sandbox.reconcilePaperPositionMarks([{ id: 99, paper: false, current_pnl: 12 }], {
  '99': { display_state: 'LIVE_FULL', last_valid_current_pnl: 999 }
});
assert.equal(real[0].current_pnl, 12, 'Real position state must remain untouched');

console.log('PWA position mark reconciliation checks OK');
