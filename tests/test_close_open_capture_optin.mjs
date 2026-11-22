// close_open_capture opt-in card (candidate-only research evidence; default OFF). Runs the REAL app.js section and,
// for the chain test, the REAL injected facade from Marketapp's MainActivity.kt (MARKETAPP_DIR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('// ── close_open_capture opt-in (CANDIDATE builds only');
const end = src.indexOf('// ── end close_open_capture opt-in');
assert.ok(start > 0 && end > start);
const code = src.slice(start, end);

function load(native) {
  const el = { innerHTML: '' };
  const ctx = { JSON, Object, String, Array, document: { getElementById: (id) => (id === 'close-open-capture' ? el : null) } };
  if (native !== undefined) ctx.NativeBridge = native;
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.coCaptureView = coCaptureView; this.coCaptureStatus = coCaptureStatus; this.renderCloseOpenCapture = renderCloseOpenCapture; this.coSetCaptureEnabled = coSetCaptureEnabled;', ctx);
  return { ctx, el };
}
// shape of CloseOpenCapture.statusSummary + NativeBridge.getCloseOpenCaptureStatus (Marketapp R2)
const status = (o) => JSON.stringify(Object.assign({ version: 'close_open_capture_v1', control_state: 'UNSET', enabled: false, default: 'OFF',
  producer_key: 'premium_followon', eligibility_rule: 'close_open_eligibility_v2_receipt_minute_inclusive',
  expiry_scope: 'NEAREST_EXPIRY_ONLY_AS_POLLED; refused when the next session is on or after expiry',
  lot_authority: { state: 'ABSENT_NOT_CAPTURED_BY_THIS_PATH', after_cost_use: 'REFUSED_UNTIL_QUANTITY_EVIDENCE' },
  makes_requests: false, calendar: { covered_years: [2026], today_covered: true, next_regular_session: '2026-11-26', next_reason: null },
  indices: { NF: { today_session_file: 'NOT_WRITTEN', queue: { entries: 0, by_state: {}, by_reason: {} } },
             BNF: { today_session_file: 'NOT_WRITTEN', queue: { entries: 0, by_state: {}, by_reason: {} } } },
  available: true, candidate_build: true }, o));

function native(initial = {}) {
  const d = { state: 'UNSET', candidate: true, calls: [] };
  Object.assign(d, initial);
  const impl = {
    getCloseOpenCaptureStatus: () => status({ candidate_build: d.candidate, enabled: d.state === 'ON', control_state: d.state }),
    getCloseOpenCaptureState: () => JSON.stringify({ state: d.state, version: 'close_open_capture_v1' }),
    setCloseOpenCapture: (on) => {
      if (!d.candidate) return JSON.stringify({ ok: false, status: 'NOT_CANDIDATE_BUILD', state: d.state });
      d.state = on === true ? 'ON' : 'OFF';
      return JSON.stringify({ ok: true, state: d.state, takes_effect: 'NEXT_POLL' });
    },
  };
  const nb = new Proxy({}, { get(_t, k) { if (typeof k === 'string') d.calls.push(k); return impl[k]; } });
  return { nb, d };
}

test('hidden without a bridge, on an older APK, on a production build, or on malformed status', () => {
  assert.equal(load().ctx.coCaptureStatus().reason, 'NO_NATIVE_BRIDGE');
  assert.equal(load({}).ctx.coCaptureStatus().reason, 'NATIVE_METHOD_ABSENT');
  assert.equal(load({ getCloseOpenCaptureStatus: () => '{"x":1}' }).ctx.coCaptureStatus().reason, 'MALFORMED');
  assert.equal(load({ getCloseOpenCaptureStatus: () => { throw new Error('x'); } }).ctx.coCaptureStatus().reason, 'STATUS_ERROR');
  for (const nbv of [undefined, {}, { getCloseOpenCaptureStatus: () => 'not json' }, native({ candidate: false }).nb,
                     { getCloseOpenCaptureStatus: () => '{"available":false,"reason":"NATIVE_METHOD_ABSENT"}' }]) {
    const { ctx, el } = load(nbv);
    el.innerHTML = 'stale';
    ctx.renderCloseOpenCapture();
    assert.equal(el.innerHTML, '', 'nothing rendered');
  }
});

test('candidate build: default OFF, rule, calendar, lot authority and independence are stated', () => {
  const { nb } = native();
  const { ctx, el } = load(nb);
  ctx.renderCloseOpenCapture();
  const h = el.innerHTML;
  assert.match(h, /Close→open capture \(research\) — OFF · candidate build/);
  assert.match(h, /Off — nothing is recorded\./);
  assert.match(h, /coSetCaptureEnabled\(true\)/);
  assert.match(h, /close_open_eligibility_v2_receipt_minute_inclusive/);
  assert.match(h, /receipt minute decides \(inclusive\); the slot is only intent/);
  assert.match(h, /Nearest expiry only; refused when the next session is on or after expiry/);
  assert.match(h, /Calendar 2026; next regular session 2026-11-26/);
  assert.match(h, /Lot authority: absent — no after-cost use/);
  assert.match(h, /does not change the intraday premium capture or its denominator, Paper, admission, ranking, exits or Real/);
  assert.match(h, /<b>NF<\/b> — today NOT_WRITTEN; queue 0/);
  assert.match(h, /<b>BNF<\/b> — today NOT_WRITTEN; queue 0/);
});

test('uncovered calendar dates show the refusal; per-index stages and queue are shown', () => {
  const st = JSON.parse(status({ enabled: true, calendar: { covered_years: [2026], next_regular_session: null, next_reason: 'calendar_not_covered' },
    indices: { NF: { today_session_file: 'PRESENT', last_slot: { slot: '15:30', result: 'OBSERVED', quote_receipt: 'QUALIFYING_4/6', durable_write: 'WRITTEN', queue_write: 'NO_FAILURE_RECORDED' },
                     queue: { entries: 6, by_state: { QUEUED: 6 }, by_reason: {} }, refusals: {} },
               BNF: { today_session_file: 'PRESENT', queue: { entries: 6, by_state: { REFUSED_AT_ENQUEUE: 6 }, by_reason: { next_session_on_or_after_expiry: 6 } }, refusals: { calendar_not_covered: 1 } } } }));
  const h = load().ctx.coCaptureView(Object.assign(st, { available: true }));
  assert.match(h, /refused: calendar_not_covered/);
  assert.match(h, /<b>NF<\/b> — last 15:30 OBSERVED · QUALIFYING_4\/6 · write WRITTEN · queue NO_FAILURE_RECORDED; queue 6 \(QUEUED 6\)/);
  assert.match(h, /<b>BNF<\/b> — today PRESENT; queue 6 \(REFUSED_AT_ENQUEUE 6\); reasons next_session_on_or_after_expiry 6; refusals calendar_not_covered 1/);
});

test('toggling calls the bridge; the status shown is the native readback, not the request', () => {
  const { nb, d } = native();
  const { ctx, el } = load(nb);
  ctx.coSetCaptureEnabled(true);
  assert.equal(d.state, 'ON');
  assert.match(el.innerHTML, /— ON · candidate build/);
  assert.match(el.innerHTML, /On — records near-close quotes/);
  assert.match(el.innerHTML, /Requested on · app reads back on/);
  ctx.coSetCaptureEnabled(false);
  assert.equal(d.state, 'OFF');
  assert.match(el.innerHTML, /— OFF/);
  assert.match(el.innerHTML, /Requested off · app reads back off/);
  assert.deepEqual([...new Set(d.calls)].sort(), ['getCloseOpenCaptureState', 'getCloseOpenCaptureStatus', 'setCloseOpenCapture']);
});

test('a refused set is flagged with its reason; rendering never sets', () => {
  const stuck = { getCloseOpenCaptureStatus: () => status({}), getCloseOpenCaptureState: () => '{"state":"UNSET"}',
    setCloseOpenCapture: () => '{"ok":false,"status":"NOT_CANDIDATE_BUILD","state":"UNSET"}' };
  const s = load(stuck);
  s.ctx.coSetCaptureEnabled(true);
  assert.match(s.el.innerHTML, /Requested on · app reads back off — NOT applied \(NOT_CANDIDATE_BUILD\)/);
  const { nb, d } = native();
  load(nb).ctx.renderCloseOpenCapture();
  assert.equal(d.calls.includes('setCloseOpenCapture'), false);
});

test('escapes native strings', () => {
  const st = JSON.parse(status({ eligibility_rule: '<img src=x onerror=alert(1)>' }));
  const html = load().ctx.coCaptureView(Object.assign(st, { available: true }));
  assert.doesNotMatch(html, /<img/);
});

test('wired after the C1 and M0 cards and into the boot + snapshot renders; no other control is referenced', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="c1-capture"><\/div>\s*<div id="research-m0"><\/div>\s*<div id="close-open-capture"><\/div>/);
  assert.match(src, /try \{ renderCloseOpenCapture\(\); \} catch \(e\) \{ console\.warn\('\[boot\] close-open render failed:/);
  assert.match(src, /try \{ renderCloseOpenCapture\(\); \} catch \(e\) \{ console\.warn\('\[CO\] close-open render failed:/);
  for (const forbidden of ['singleLeg', 'SingleLeg', 'admit', 'setTradeMode', 'evSet', 'paper_trades', 'supabase', 'PremiumCapture', 'setPremiumCapture', 'C1CapturePilot'])
    assert.ok(!code.includes(forbidden), `close_open section must not reference ${forbidden}`);
  assert.ok(!/NativeBridge\.(?!getCloseOpenCaptureStatus|getCloseOpenCaptureState|setCloseOpenCapture)\w+\(/.test(code), 'only close_open bridge calls');
});

test('real injected facade (MARKETAPP_DIR) carries the switch end to end', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const MA = path.resolve(process.env.MARKETAPP_DIR || path.join(here, '..', '..', 'Marketapp'));
  const FACADE = path.join(MA, 'tools', 'bridge_facade', 'facade.mjs');
  assert.ok(fs.existsSync(FACADE), `Marketapp checkout required at ${MA}`);
  process.env.MARKETAPP_DIR = MA;
  const F = await import(pathToFileURL(FACADE).href);
  const { nb: _unused, d } = native();
  const calls = [];
  const ab = {
    getCloseOpenCaptureStatus: () => { calls.push('status'); return status({ enabled: d.state === 'ON', control_state: d.state }); },
    getCloseOpenCaptureState: () => { calls.push('state'); return JSON.stringify({ state: d.state }); },
    setCloseOpenCapture: (on) => { calls.push(['set', on]); d.state = on ? 'ON' : 'OFF'; return JSON.stringify({ ok: true, state: d.state }); },
  };
  const js = F.extractFacadeJs();
  const nbReal = F.runFacade({ AndroidBridge: ab }, js);
  const { ctx, el } = load(nbReal);
  ctx.renderCloseOpenCapture();
  if (!js.includes('getCloseOpenCaptureStatus')) {
    // compatibility run against a native facade without the R2 opt-in: the card must simply be absent
    assert.equal(el.innerHTML, '');
    assert.deepEqual(calls, []);
    return;
  }
  assert.match(el.innerHTML, /— OFF/);
  ctx.coSetCaptureEnabled(true);
  assert.equal(d.state, 'ON');
  assert.match(el.innerHTML, /— ON[\s\S]*Requested on · app reads back on/);
  assert.deepEqual(calls.filter(c => Array.isArray(c)), [['set', true]]);
  const old = load(F.runFacade({ AndroidBridge: {} }, F.extractFacadeJs()));
  old.ctx.renderCloseOpenCapture();
  assert.equal(old.el.innerHTML, '');
});
