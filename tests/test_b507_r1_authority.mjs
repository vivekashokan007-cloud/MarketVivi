// b507 R1 — Codex F1 (stale result keeps entry authority) and F5 (locked summary mixes native lock with drafts)
// reproductions, run on the REAL app.js functions (extracted verbatim) with a fake DOM + NativeBridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// ═══ B507 OVERNIGHT INPUT AUTHORITY'), src.indexOf('// ═══ END B507 ═══'));
function fn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  const end = src.indexOf('\n}\n', m.index);
  return src.slice(m.index, end + 3);
}
const FNS = ['brainResultTimestampMs', 'brainFreshnessStatus', 'hasBrainPayload', 'adoptBrainResult',
  'applyBrainRangeSigma', 'finalEntryAuthorization', 'morningFieldValue', 'buildMorningSummaryHtml'];
const staleLine = /^const BRAIN_RESULT_STALE_MS.*$/m.exec(src)[0];

const S = '2026-10-15';
const NOW = Date.UTC(2026, 9, 15, 4, 0);          // 09:30 IST
function nativeState(rev, { locked = true } = {}) {
  return { schema: 'overnight_inputs_v1', session: S, status: 'OK', input_revision: rev, pair_revision: 'p' + rev,
    morning: locked ? { session: S, captured_at_ms: NOW - 25 * 60e3, seq: 1, revision: 'm1', snapshot_revision: 'snap1',
      dowClose: '46300', crudeSettle: '61', giftSpot: '25300',
      snapshot: { fiiCash: '-1200', fiiShortPct: '71', diiCash: '900', fiiIdxFut: null, fiiStkFut: null,
        dowClose: '46300', crudeSettle: '61', giftSpot: '25300', upstoxBias: '' } } : null,
    evening: { intended_session: S, captured_at_ms: NOW - 13 * 3600e3, dow: '46000', crude: '62.5', gift: '25200' } };
}
function app({ state, fields = {}, brainRaw = 'null' }) {
  const bridge = { isNative: () => true, getOvernightInputState: () => JSON.stringify(state.current),
    getBrainResult: () => brainRaw };
  const doc = { getElementById: (id) => (id in fields ? { value: fields[id] } : null) };
  const ctx = { console, JSON, Number, String, Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } },
    Array, Object, Math, RegExp, NativeBridge: bridge, document: doc,
    C: { POLL_INTERVAL_MS: 5 * 60e3 }, API: { todayIST: () => S }, STATE: {}, bd: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${staleLine}\n${block}\n${FNS.map(fn).join('\n')}\nvar bd = {};`, ctx);
  return ctx;
}
function result(rev, extra = {}) {
  return { brain_result_completed_at_ms: NOW - 60e3,
    input_identity: { session: S, input_revision: rev, market_collected_at_ms: NOW - 90e3 },
    verdict: { action: 'SELL PREMIUM', decision_gate: { state: 'ACTIONABLE' }, execution_candidate_id: 'c1' },
    generated_candidates: [{ id: 'c1' }], ...extra };
}
const CAND = { id: 'c1', entryEligible: true, executionReady: true };

test('F1 repro: empty native result after save B — kept result A loses authority (was PENDING/ready/fresh/allowed)', () => {
  const state = { current: nativeState('A') };
  const c = app({ state });
  assert.equal(c.adoptBrainResult(result('A')), true);
  assert.equal(c.finalEntryAuthorization(CAND).allowed, true);          // baseline: A is current
  state.current = nativeState('B');                                      // acknowledged save B
  c.b507InvalidateCurrentAuthority();
  c.adoptBrainResult({});                                                // native readback empty (rejected/cleared)
  // Codex reproduction BUG values were: brainRefreshPending true, brainReady TRUE, fresh TRUE, allowed TRUE
  assert.equal(c.STATE.brainRefreshPending, true);
  assert.equal(c.STATE.brainReady, false);
  assert.equal(c.brainFreshnessStatus().fresh, false);
  assert.equal(c.brainFreshnessStatus().historical, true);
  const auth = c.finalEntryAuthorization(CAND);
  assert.equal(auth.allowed, false);
  assert.match(auth.reason, /earlier inputs/);
  assert.equal(c.bd.input_identity.input_revision, 'A');               // still viewable (Paper tab not locked)
});

test('F1: stale NONEMPTY result for A after save B is adopted only as historical', () => {
  const state = { current: nativeState('B') };
  const c = app({ state });
  c.adoptBrainResult(result('A'));
  assert.equal(c.STATE.brainReady, false);
  assert.match(c.STATE.brainResultHistoricalReason, /earlier inputs/);
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
});

test('F1: a matching result for B restores authority', () => {
  const state = { current: nativeState('B') };
  const c = app({ state });
  c.adoptBrainResult(result('A'));
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
  assert.equal(c.adoptBrainResult(result('B')), true);
  assert.equal(c.STATE.brainReady, true);
  assert.equal(c.STATE.brainRefreshPending, false);
  assert.equal(c.brainFreshnessStatus().fresh, true);
  assert.equal(c.finalEntryAuthorization(CAND).allowed, true);
});

test('F1: other-session or identity-less result is never current; F4 age uses market collection time', () => {
  const state = { current: nativeState('B') };
  const c = app({ state });
  c.adoptBrainResult(result('B', { input_identity: { session: '2026-10-14', input_revision: 'B' } }));
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
  c.adoptBrainResult({ ...result('B'), input_identity: undefined });
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
  // a refresh completed now over market data collected 20 min ago is stale
  c.adoptBrainResult(result('B', { brain_result_completed_at_ms: NOW - 1e3,
    input_identity: { session: S, input_revision: 'B', market_collected_at_ms: NOW - 20 * 60e3 } }));
  assert.equal(c.brainFreshnessStatus().fresh, false);
  assert.match(c.brainFreshnessStatus().reason, /stale \(20m old\)/);
});

test('F5 repro: form FII Cash -9999 with native Dow 46300 — every row native, -9999 only as a draft', () => {
  const state = { current: nativeState('A') };
  const c = app({ state, fields: { 'in-fii-cash': '-9999', 'in-dow-close': '46300', 'in-fii-short': '71' } });
  const html = c.buildMorningSummaryHtml();
  assert.match(html, /🔒 Morning data locked/);
  const grid = html.slice(html.indexOf('morning-summary-grid'), html.indexOf('b507-drafts') > 0 ? html.indexOf('b507-drafts') : undefined);
  assert.ok(grid.includes('<span>FII Cash</span><b>-1200</b>'), 'FII Cash from the native lock');
  assert.ok(grid.includes('<span>Dow</span><b>46300</b>'));
  assert.ok(!grid.includes('-9999'), 'draft value never inside the locked grid');
  assert.match(html, /Draft \(not locked\): FII Cash -9999/);
  assert.ok(!/Draft \(not locked\):[^<]*Dow/.test(html), 'equal values are not drafts');
  assert.ok(html.includes('snap1'), 'snapshot revision shown');
});

test('F5: no native lock -> draft title, never "locked"', () => {
  const state = { current: nativeState('A', { locked: false }) };
  const c = app({ state, fields: { 'in-fii-cash': '-9999' } });
  const html = c.buildMorningSummaryHtml();
  assert.match(html, /NOT locked \(draft\)/);
  assert.ok(!html.includes('🔒 Morning data locked'));
});

test('R2: unreadable supported authority never re-enables result A after acknowledged B', () => {
  for (const get of [() => { throw new Error('bridge unavailable'); }, () => '{', () => 'null',
    () => '[]', () => '{}', () => JSON.stringify({ ...nativeState('B'), schema: 'unknown' })]) {
    const state = { current: nativeState('A') };
    const c = app({ state });
    c.adoptBrainResult(result('A'));
    assert.equal(c.finalEntryAuthorization(CAND).allowed, true);
    state.current = nativeState('B');
    c.b507InvalidateCurrentAuthority();
    const restore = c.NativeBridge.getOvernightInputState;
    c.NativeBridge.getOvernightInputState = get;
    c.adoptBrainResult({});
    assert.equal(c.brainFreshnessStatus().fresh, false);
    assert.equal(c.STATE.brainReady, false);
    assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
    assert.equal(c.b507OvernightCardModel(c.bd, c.b507NativeState()).reason, 'AUTHORITY_UNAVAILABLE');
    assert.equal(c.hasBrainPayload(c.bd), true, 'historical result remains viewable');
    assert.match(c.buildMorningSummaryHtml(), /NOT locked \(draft\)/);
    c.NativeBridge.getOvernightInputState = restore;
    assert.equal(c.finalEntryAuthorization(CAND).allowed, false, 'A stays obsolete when B read recovers');
    c.adoptBrainResult(result('B'));
    assert.equal(c.finalEntryAuthorization(CAND).allowed, true);
  }
});

test('R2: a lost capability or acknowledged save cannot downgrade to legacy authority', () => {
  const c = app({ state: { current: nativeState('B') } });
  c.adoptBrainResult(result('B'));
  delete c.NativeBridge.getOvernightInputState;
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
  assert.equal(c.b507NativeState().authority_read_status, 'UNAVAILABLE');
  const ackOnly = app({ state: { current: nativeState('B') } });
  delete ackOnly.NativeBridge.getOvernightInputState;
  ackOnly.b507CheckedAck({ ok: true, kind: 'morning', revision: 'B', record: {} }, 'morning');
  assert.equal(ackOnly.b507NativeState().authority_read_status, 'UNAVAILABLE');
});

test('R2: genuinely unsupported legacy capability preserves only legacy result time rules', () => {
  const c = app({ state: { current: nativeState('B') } });
  delete c.NativeBridge.getOvernightInputState;
  assert.equal(c.b507NativeState(), null);
  c.adoptBrainResult({ ...result('B'), input_identity: undefined });
  assert.equal(c.brainFreshnessStatus().fresh, true);
  assert.equal(c.finalEntryAuthorization(CAND).allowed, true);
  c.adoptBrainResult(result('B'));
  assert.equal(c.finalEntryAuthorization(CAND).allowed, false, 'b507 result needs its authority');
});

test('R2: invalid market collection identity cannot use the completion clock as a fallback', () => {
  const c = app({ state: { current: nativeState('B') } });
  for (const ts of [undefined, null, 0, -1, 'bad', NOW + 120e3]) {
    c.adoptBrainResult(result('B', { input_identity: { session: S, input_revision: 'B', market_collected_at_ms: ts } }));
    assert.equal(c.brainFreshnessStatus().fresh, false);
    assert.equal(c.finalEntryAuthorization(CAND).allowed, false);
  }
});
