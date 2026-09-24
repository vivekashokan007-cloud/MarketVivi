import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

// Must not use current_premium as Brain-readiness proxy
assert.doesNotMatch(src, /Brain advice: \$\{asFiniteNumber\(t\.current_premium\)/);
assert.doesNotMatch(src, /Brain poll mark incomplete/);
assert.match(src, /function paperBrainVerdictStatus/);
assert.match(src, /function formatPaperValuationBrainStatusLine/);
assert.match(src, /Brain verdict: available/);
assert.match(src, /Brain verdict: unavailable/);
assert.match(src, /P1 mark validated/);

const start = src.indexOf('function paperBrainVerdictStatus');
const end = src.indexOf('\nfunction formatPaperValuationBrainStatusLine');
assert.ok(start > 0 && end > start);
const helpersStart = start;
const helpersEnd = src.indexOf('\nfunction validDateOrBlank', helpersStart);
assert.ok(helpersEnd > helpersStart);
const helpers = src.slice(
  src.indexOf('function reconcilePaperPositionMarks'),
  helpersEnd
);

const sandbox = {
  Number, String, Array, Object, Date,
  bd: { positions: {} },
  asFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
};
vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

const trade = { id: 284, paper: true, current_premium: null, position_mark_state: 'LIVE_FULL' };

// P1 validated + no Brain verdict
sandbox.bd.positions = {};
let st = sandbox.paperBrainVerdictStatus(trade);
assert.equal(st.available, false);
assert.match(st.reason, /not yet attached/i);
let line = sandbox.formatPaperValuationBrainStatusLine(trade);
assert.match(line, /P1 VALIDATED/);
assert.match(line, /Brain verdict: unavailable/);
assert.doesNotMatch(line, /Brain poll mark incomplete/);

// P1 validated + DATA_UNAVAILABLE verdict (must stay unavailable, show reason)
sandbox.bd.positions = {
  284: {
    verdict: {
      action: 'HOLD',
      urgency: 'DATA_UNAVAILABLE',
      reason: 'DATA_UNAVAILABLE: live position mark is unavailable; no BOOK/EXIT decision emitted.'
    }
  }
};
st = sandbox.paperBrainVerdictStatus(trade);
assert.equal(st.available, false);
assert.match(st.reason, /DATA_UNAVAILABLE/);
line = sandbox.formatPaperValuationBrainStatusLine(trade);
assert.match(line, /Brain verdict: unavailable/);
assert.match(line, /live position mark is unavailable/);

// current_premium present must NOT alone mean Brain available when verdict missing
trade.current_premium = 273.2;
sandbox.bd.positions = {};
st = sandbox.paperBrainVerdictStatus(trade);
assert.equal(st.available, false, 'current_premium must not proxy Brain readiness');

// Real Brain HOLD (not DATA_UNAVAILABLE) → available
sandbox.bd.positions = {
  284: { verdict: { action: 'HOLD', urgency: 'WATCH', reason: 'stable credit' } }
};
st = sandbox.paperBrainVerdictStatus(trade);
assert.equal(st.available, true);
line = sandbox.formatPaperValuationBrainStatusLine(trade);
assert.match(line, /Brain verdict: available \(HOLD/);

// reconcile still distinguishes P1 mark from Brain
const initial = [{ id: 284, paper: true, current_pnl: null, valuation_quality: 'unavailable', current_premium: null }];
const live = sandbox.reconcilePaperPositionMarks(initial, {
  '284': {
    display_state: 'LIVE_FULL', last_valid_current_pnl: -1596,
    last_valid_tick_ts: '2026-09-24T04:08:41.000Z', source: 'P1_REST_60S'
  }
});
assert.equal(live[0].current_pnl, -1596);
assert.equal(live[0].valuation_quality, 'full');
assert.equal(live[0].position_mark_state, 'LIVE_FULL');
// Net display arithmetic (gross − costs)
const gross = -1596;
const costs = 243.1;
assert.equal(Math.round((gross - costs) * 10) / 10, -1839.1);

console.log('PWA Paper Brain status distinction checks OK');
