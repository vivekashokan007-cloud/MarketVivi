// 20 Nov 2026 review fix: a saved single-leg Paper request (mr_single_leg_pending_v1) must be recovered on cold start
// even when the Market Copilot card is not rendered (market closed / no baseline / stale or missing brain result),
// polled by request id only (never resubmitted), one chain per id, tolerant of a NativeBridge that appears later,
// and shown on Trade with its definitive outcome.  Also checks the compact page-side trace hooks.
// REAL app.js functions in a VM (development harness, not session evidence).  Fails on b531 742a655a.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function body(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 3);
}
const FNS = ['iaEsc', 'saveSingleLegPending', 'singleLegLastOutcomes', 'singleLegRecordOutcome', 'kickSingleLegPoll',
  'resumeSingleLegPending', 'pollSingleLegAdmit', 'finishSingleLegAdmit', 'singleLegOutcomeLine', 'renderSingleLegRecoveryBlock',
  'slTraceState', 'flushSingleLegTrace', 'slTrace'];
function harness({ saved = null, bridge = null } = {}) {
  const store = {};
  if (saved) store.mr_single_leg_pending_v1 = JSON.stringify(saved);
  const c = { String, Number, JSON, Object, Array, Math, Date, Intl, Set, alerts: [], timers: [], renders: 0, statusCalls: [], trace: [],
    window: {}, alert: m => c.alerts.push(m), setTimeout: (f, ms) => c.timers.push({ f, ms }),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    getIndexSelector: () => 'BOTH', loadSingleLegStore: () => null, renderAll: () => { c.renders++; }, store };
  c.globalThis = c;
  c.setBridge = (statusFn) => {
    c.window.NativeBridge = { singleLegTraceAppend: j => { c.trace.push(JSON.parse(j)); return '{"ok":true}'; },
      ...(statusFn ? { singleLegAdmitStatus: rid => { c.statusCalls.push(rid); return JSON.stringify(statusFn(rid)); } } : {}) };
  };
  if (bridge) c.setBridge(bridge);
  vm.createContext(c);
  vm.runInContext(`const SINGLE_LEG_PENDING_KEY='mr_single_leg_pending_v1'; const SINGLE_LEG_LAST_OUTCOME_KEY='mr_single_leg_last_outcome_v1';
    var SINGLE_LEG_PENDING={}; var SINGLE_LEG_POLLING={};\n` + FNS.map(body).join('\n') + '\nthis.__pend=()=>SINGLE_LEG_PENDING; this.__poll=()=>SINGLE_LEG_POLLING;', c);
  return c;
}
const runTimers = (c, k = 1) => { for (let i = 0; i < k; i++) { const t = c.timers.splice(0); for (const x of t) x.f(); } };
const pollCount = c => c.timers.filter(t => /pollSingleLegAdmit/.test(String(t.f))).length;
const CANCELLED = rid => ({ status: 'REJECTED', reason: 'CANCELLED_BEFORE_COMMIT', completed: true, found: true, reconciled: true, request_id: rid });

test('call sites: recovery is not gated on the Copilot card (boot, reconcile, renderAll, bridge-ready, visible)', () => {
  const dom = src.slice(src.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(dom.slice(0, 4000), /resumeSingleLegPending\('boot'\)/);
  assert.match(body('reconcileNativeSessionUi'), /resumeSingleLegPending\('reconcile'\)/);
  const ra = body('renderAll');
  assert.ok(ra.indexOf("resumeSingleLegPending('renderAll')") >= 0 && ra.indexOf("resumeSingleLegPending('renderAll')") < ra.indexOf('renderWatchlist(snap)'));
  assert.match(src, /addEventListener\('mr-native-bridge-ready',[\s\S]{0,120}resumeSingleLegPending\('bridge-ready'\)/);
  assert.match(src, /visibilitychange[\s\S]{0,160}resumeSingleLegPending\('visible'\)/);
});

test('Trade renders the saved request in every renderWatchlist branch (no baseline, authority, no result, legacy)', () => {
  const rw = body('renderWatchlist');
  for (const b of ['NO_TODAY_BASELINE', 'AUTHORITY', 'NO_AUTHORITY_RESULT', 'LEGACY']) assert.ok(rw.includes(`renderSingleLegRecoveryBlock('${b}')`), b);
});

for (const [name, saved] of [['BNF', { BNF: { request_id: 'bnf-rid-1', phase: 'FETCHING' } }], ['NF', { NF: { request_id: 'nf-rid-1', phase: 'COMMITTING' } }]]) {
  const ix = Object.keys(saved)[0], rid = saved[ix].request_id;
  test(`${name} cold start, market closed: restored, shown, one chain, polled by id only, definitive outcome shown`, () => {
    const c = harness({ saved, bridge: CANCELLED });
    c.resumeSingleLegPending('boot');
    for (let i = 0; i < 6; i++) c.resumeSingleLegPending('renderAll');
    assert.equal(c.__pend()[ix].request_id, rid); assert.equal(c.__pend()[ix].recovered, true);
    assert.equal(pollCount(c), 1, 'one chain per request id');
    const blk = c.renderSingleLegRecoveryBlock('NO_TODAY_BASELINE');
    assert.match(blk, new RegExp(`data-index="${ix}" data-request-id="${rid}" data-sl-recovery="PENDING"`));
    assert.match(blk, /recovered after restart/);
    runTimers(c);
    assert.deepEqual([...c.statusCalls], [rid]);
    assert.equal(c.__pend()[ix], undefined); assert.equal(JSON.parse(c.store.mr_single_leg_pending_v1)[ix], undefined);
    const out = c.renderSingleLegRecoveryBlock('LEGACY');
    assert.match(out, new RegExp(`data-request-id="${rid}" data-sl-outcome="REJECTED"`)); assert.match(out, /CANCELLED_BEFORE_COMMIT/);
    assert.equal(pollCount(c), 0);
    assert.ok(c.trace.some(t => t.kind === 'RECOVERY_STARTED' && t.request_id === rid) && c.trace.some(t => t.kind === 'RECOVERY_OUTCOME' && t.request_id === rid));
  });
}

test('authority branch: indices with their own Trade row are not duplicated in the recovery block', () => {
  const c = harness({ saved: { NF: { request_id: 'a', phase: 'QUEUED' }, BNF: { request_id: 'b', phase: 'QUEUED' } }, bridge: () => ({ status: 'PENDING', phase: 'QUEUED' }) });
  c.resumeSingleLegPending('boot');
  const block = c.renderSingleLegRecoveryBlock('AUTHORITY');
  assert.match(block, /data-index="NF" data-request-id="a"/);
  assert.match(block, /Legacy NF/);
  assert.doesNotMatch(block, /data-index="BNF"|sl-admit/);
});

test('delayed bridge: no NativeBridge at boot -> waits on the same chain, no resubmit; readiness kicks it once', () => {
  const c = harness({ saved: { NF: { request_id: 'late', phase: 'COMMITTING' } } });
  c.resumeSingleLegPending('boot');
  for (let i = 0; i < 20; i++) runTimers(c);
  assert.equal(pollCount(c), 1); assert.equal(c.statusCalls.length, 0);
  assert.equal(c.__pend().NF.reason, 'BRIDGE_UNAVAILABLE'); assert.equal(c.__pend().NF.recovered, true);
  assert.match(c.renderSingleLegRecoveryBlock('NO_TODAY_BASELINE'), /waiting for the app bridge/);
  c.setBridge(rid => ({ status: 'ADMITTED', position_id: 'sl1', completed: true, found: true, request_id: rid }));
  c.resumeSingleLegPending('bridge-ready'); c.resumeSingleLegPending('visible');   // second resume must not add a chain
  const [oldPoll, readyPoll] = c.timers.splice(0);
  assert.equal(readyPoll.ms, 0);
  assert.ok(oldPoll.ms > readyPoll.ms);
  readyPoll.f();
  oldPoll.f();
  assert.equal(pollCount(c), 0);
  assert.deepEqual([...c.statusCalls], ['late'], 'old timer after completion cannot recreate the request');
  assert.equal(c.__pend().NF, undefined);
  assert.match(c.singleLegOutcomeLine('NF'), /data-sl-outcome="ADMITTED"[\s\S]*recovered after restart/);
  assert.equal(c.alerts.length, 0);
  const kinds = c.trace.map(t => t.kind);
  assert.ok(kinds.indexOf('RECOVERY_STARTED') < kinds.indexOf('RECOVERY_BRIDGE_WAIT') && kinds.includes('RECOVERY_OUTCOME'), kinds.join());
});

test('unresolved request keeps its id and state; a refusal without an id never drops another saved request', () => {
  const c = harness({ saved: { BNF: { request_id: 'u1', phase: 'FETCHING' } }, bridge: rid => ({ status: 'PENDING', phase: 'OUTCOME_UNCONFIRMED', reason: 'STORE_LOCK_BUSY', request_id: rid }) });
  c.resumeSingleLegPending('boot');
  runTimers(c, 5);
  assert.equal(c.__pend().BNF.request_id, 'u1'); assert.equal(c.__pend().BNF.phase, 'OUTCOME_UNCONFIRMED');
  assert.equal(JSON.parse(c.store.mr_single_leg_pending_v1).BNF.request_id, 'u1');
  assert.equal(pollCount(c), 1);
  c.finishSingleLegAdmit('BNF', { status: 'REJECTED', reason: 'NATIVE_IDENTITY_BINDING_UNAVAILABLE' }, undefined);
  assert.equal(c.__pend().BNF.request_id, 'u1', 'id-less refusal leaves the saved request');
});

test('trace queue before the bridge is bounded and evicts RENDER first; flushed in order when the bridge appears', () => {
  const c = harness();
  c.slTrace('CONFIG', { pwa_build: 'x' });
  for (let i = 0; i < 80; i++) c.slTrace('RENDER', { index: 'NF', row_state: 'S' + i });
  c.slTrace('TAP', { index: 'NF' });
  const st = c.slTraceState();
  assert.equal(st.queue.length, 60); assert.equal(st.queue[0].kind, 'CONFIG'); assert.ok(st.queueDropped > 0);
  c.setBridge(null);
  const dropped = st.queueDropped;
  assert.equal(c.flushSingleLegTrace(), true);
  assert.equal(c.trace.length, 61);
  assert.equal(c.trace[0].kind, 'PAGE_QUEUE_LOSS');
  assert.equal(c.trace[0].dropped_count, dropped);
  assert.equal(c.trace[1].kind, 'CONFIG');
  assert.equal(c.trace.at(-1).kind, 'TAP');
  assert.equal(st.queueDropped, 0);
  assert.equal(st.queue.length, 0);
});

test('trace retries an unacknowledged write without losing it or replaying earlier acknowledgements', () => {
  const c = harness();
  c.slTrace('TAP', { index: 'NF' });
  c.slTrace('REFUSED', { index: 'NF' });
  c.window.NativeBridge = {
    singleLegTraceAppend: j => {
      const event = JSON.parse(j);
      if (event.kind === 'REFUSED') return '{"ok":false,"status":"TRACE_ERROR"}';
      c.trace.push(event);
      return '{"ok":true}';
    },
  };
  assert.equal(c.flushSingleLegTrace(), false);
  assert.deepEqual(c.trace.map(event => event.kind), ['TAP']);
  assert.deepEqual(Array.from(c.slTraceState().queue, event => event.kind), ['REFUSED']);
  c.setBridge(null);
  assert.equal(c.flushSingleLegTrace(), true);
  assert.deepEqual(c.trace.map(event => event.kind), ['TAP', 'REFUSED']);
  assert.equal(c.slTraceState().queue.length, 0);
});
