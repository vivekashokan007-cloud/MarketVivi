// Codex review R2 (14 Oct 2026): the review's JS defect probe, inverted, against the actual app.js functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sandbox, remoteStore, src, ACC, VIEW, ECON, openRuleB, fillEntry } from './ev12_harness.mjs';

function acceptSandbox(over = {}, store = remoteStore()) {
  const c = sandbox({ bd: { implied_ev_v12: VIEW }, ...over }, store);
  c.NativeBridge.prepareResult = { ...ACC, status: 'RESERVED', state: 'RESERVED' };
  c.NativeBridge.confirmResult = { ...ACC };
  return c;
}

test('R1 probe: cancelling the confirmation consumes nothing and saves no trade', async () => {
  const c = acceptSandbox({ confirm: () => false });
  await c.acceptEvDecision('2026-10-08');
  assert.equal(c.NativeBridge.prepared.length, 1);
  assert.deepEqual(c.NativeBridge.prepared[0], ['2026-10-08', ACC.decision_id]);   // decision identity sent
  assert.equal(c.NativeBridge.confirmed.length, 0);
  assert.deepEqual(c.NativeBridge.cancelled, [[ACC.decision_id, 'res1']]);
  assert.equal(c._store.inserts, 0);
});

test('R1: confirm -> idempotent insert stamped with ev_trade_uid -> persisted with the row id', async () => {
  const c = acceptSandbox();
  await c.acceptEvDecision('2026-10-08');
  assert.equal(c.NativeBridge.confirmed.length, 1);
  assert.equal(c._store.inserts, 1);
  const row = c._store.byUid(ACC.trade_uid);
  assert.ok(row);
  assert.deepEqual(c.NativeBridge.marks, [[ACC.decision_id, String(row.id), ACC.trade_uid]]);
  assert.equal(c._open.length, 1);
  // replay (double tap after commit): native replays the same record, no second row
  c.NativeBridge.prepareResult = { ...ACC, replay: true };
  await c.acceptEvDecision('2026-10-08');
  assert.equal(c._store.inserts, 1);
});

test('R1: a lost insert response is recovered by readback, never a duplicate; recovery at startup', async () => {
  const store = remoteStore(); store.loseInsertResponse = true;
  const c = acceptSandbox({}, store);
  c.NativeBridge.prepareResult = { ...ACC, status: 'RESERVED' };
  c.NativeBridge.confirmResult = { ...ACC };
  await c.acceptEvDecision('2026-10-08');
  assert.equal(store.inserts, 1);
  assert.equal(c.NativeBridge.marks.length, 1);
  // crash between COMMITTED and insert: startup recovery inserts once; a second recovery is a no-op
  const s2 = remoteStore(); const r = sandbox({}, s2);
  r.NativeBridge.recovery = [{ ...ACC }];
  await r.ev12RecoverAcceptances();
  await r.ev12RecoverAcceptances();
  assert.equal(s2.inserts, 1);
  assert.equal(Object.keys(s2.rows).length, 1);
});

test('R1: in-flight guard - concurrent taps run one acceptance', async () => {
  const c = acceptSandbox();
  await Promise.all([c.acceptEvDecision('2026-10-08'), c.acceptEvDecision('2026-10-08')]);
  assert.equal(c.NativeBridge.prepared.length, 1);
});

test('R2: structural gross bounds are separate from the fee-inclusive risk allowance', () => {
  const c = sandbox();
  const t = c.ev12TradeFromAcceptance(VIEW, ACC);
  assert.equal(t.max_loss, Math.round(201.35 * 65 * 100) / 100);
  assert.equal(t.max_profit, Math.round(98.65 * 65 * 100) / 100);
  assert.notEqual(t.max_loss, Math.round(ACC.risk_allowance_at_acceptance));
  assert.equal(t.entry_snapshot.risk_allowance_at_acceptance, 13317.7);
});

test('R3 probe: a false remote update keeps the trade, does not ACK, and the replay retries the journaled patch', async () => {
  const c = sandbox();
  openRuleB(c, 9001);
  const e = fillEntry(9001); c.NativeBridge.ledger['9001'] = e;
  c._store.failNextUpdate = true;
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'REMOTE_PENDING');
  assert.equal(c._open.length, 1);
  assert.equal(c.NativeBridge.acks.length, 0);
  assert.equal(c._store.rows[9001].status, 'OPEN');
  const pending = JSON.parse(c.NativeBridge.evRuleBPending());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].delivery, 'REMOTE_PENDING');
  // "restart": a fresh WebView retries the SAME journaled patch
  const again = await c.applyRuleBFill(pending[0]);
  assert.equal(again.state, 'REMOTE_CONFIRMED');
  assert.equal(c._store.rows[9001].status, 'CLOSED');
  assert.deepEqual(c.NativeBridge.acks, [['9001', 'REMOTE_CONFIRMED']]);
});

test('R4 probe: the accepted Rule B close carries canonical net, fees and identities (no JS fee formula)', async () => {
  const c = sandbox();
  openRuleB(c, 9001);
  const e = fillEntry(9001); c.NativeBridge.ledger['9001'] = e;
  await c.applyRuleBFill(e);
  const p = c._closed[0].p;
  assert.equal(p.net_pnl, ECON.net_pnl);
  assert.equal(p.friction_cost, ECON.fees_total);
  assert.equal(p.friction_version, 'ev_v12_fee_teacher_v2_dated_20261013');
  assert.equal(p.friction_breakdown_json.exit_fee, ECON.exit_fee);
  assert.equal(p.net_won, false);
  assert.equal(p.canonical_won, false);   // gross -104
  // gross-positive / net-negative close is reported as such
  const c2 = sandbox(); openRuleB(c2, 9002);
  const e2 = fillEntry(9002, { economics: { ...ECON, gross_pnl: 50, net_pnl: -165.58 } }); c2.NativeBridge.ledger['9002'] = e2;
  await c2.applyRuleBFill(e2);
  assert.equal(c2._closed[0].p.canonical_won, true);
  assert.equal(c2._closed[0].p.net_won, false);
  // economics unavailable -> net explicitly unknown, never invented
  const c3 = sandbox(); openRuleB(c3, 9003);
  const e3 = fillEntry(9003, { economics: { status: 'UNKNOWN', reason: 'ENTRY_FILL_UNAVAILABLE' } }); c3.NativeBridge.ledger['9003'] = e3;
  await c3.applyRuleBFill(e3);
  assert.equal(c3._closed[0].p.net_pnl, null);
  assert.match(c3._closed[0].p.close_trace_json.net_status, /^UNKNOWN:ENTRY_FILL_UNAVAILABLE/);
});

test('R3 probe: an unloaded open-trade cache is not proof of closure - the remote row decides', async () => {
  const c = sandbox();
  openRuleB(c, 9001, { cached: false });
  const e = fillEntry(9001); c.NativeBridge.ledger['9001'] = e;
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'REMOTE_CONFIRMED');
  assert.equal(c._store.rows[9001].status, 'CLOSED');
  // and when the readback itself fails: no ACK at all
  const d = sandbox(); openRuleB(d, 9002, { cached: false }); d._store.failReads = true;
  const e2 = fillEntry(9002); d.NativeBridge.ledger['9002'] = e2;
  assert.equal((await d.applyRuleBFill(e2)).state, 'REMOTE_PENDING');
  assert.equal(d.NativeBridge.acks.length, 0);
});

test('R3 probe: UNRESOLVED is not ACKed before its remote update is proven', async () => {
  const c = sandbox();
  openRuleB(c, 9004);
  const e = { trade_id: '9004', state: 'UNRESOLVED', reason: 'deadline', decision_id: ACC.decision_id };
  c.NativeBridge.ledger['9004'] = e;
  c._store.failNextUpdate = true;
  assert.equal((await c.applyRuleBFill(e)).state, 'REMOTE_PENDING');
  assert.equal(c.NativeBridge.acks.length, 0);
  assert.equal((await c.applyRuleBFill(c.NativeBridge.ledger['9004'])).state, 'REMOTE_CONFIRMED');
});

test('R3: a manual close that won the race is recorded as MANUAL_CLOSE_CONFLICT, the Rule B close is not applied', async () => {
  const c = sandbox();
  openRuleB(c, 9005);
  // Codex C2: the manual winner is proven by its own close digest + identity (not just "not OPEN")
  // Codex D2: a REAL manual patch (digest over its complete evidence), not a fake digest string
  const mp = c.ev12ManualPatch(c._store.rows[9005], { status: 'CLOSED', exit_reason: 'Manual', exit_date: '2026-10-12T09:30:00.000Z',
    actual_pnl: 12, net_pnl: 10 });
  Object.assign(c._store.rows[9005], mp);
  const e = fillEntry(9005); c.NativeBridge.ledger['9005'] = e;
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'MANUAL_CLOSE_CONFLICT');
  assert.equal(c._store.rows[9005].exit_reason, 'Manual');
  assert.equal(c._store.updates, 0);
  assert.equal(c._closed.length, 0);
  // the experiment manual close goes through the shared arbitration (no unconditional DB.updateTrade)
  assert.match(src, /const arb = await ev12ManualClose\(trade, closePatch, remoteClosePatch\);/);
  assert.match(src, /if \(arb\.state !== 'MANUAL_WON'\) \{/);
  assert.match(src, /if \(!ev12Experiment\) recordClosedTradeToNative\(trade, closePatch\);/);
  const m = sandbox(); const t = openRuleB(m, 9006);
  assert.equal(m.ev12NoteManualClose(t), 'MANUAL_PENDING');          // pending, not remote-confirmed
  assert.deepEqual(m.NativeBridge.manual, [['9006', ACC.decision_id]]);
  assert.equal(m.ev12NoteManualClose({ ...t, entry_snapshot: {} }), null);
});

test('R4 probe: the native closed-trade projection keeps the experiment joins', () => {
  const a = src.indexOf('function ev12NativeSnapshot(');
  const b = src.indexOf('\n}\n', src.indexOf('function recordClosedTradeToNative(')) + 3;
  const calls = [];
  const ctx = { window: { NativeBridge: { recordClosedTrade: (s) => calls.push(JSON.parse(s)) } }, console, JSON,
    buildGrossExtremaCloseFields: (x) => x };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  const c = sandbox();
  const t = c.ev12TradeFromAcceptance(VIEW, ACC); t.id = 9001;
  ctx.recordClosedTradeToNative(t, { exit_date: 'x', actual_pnl: -104, net_pnl: -319.58, exit_reason: 'RULE_B_PLANNED_EXIT',
    close_trace_json: { source: 'rule_b_native_ledger', policy_version: 'paper_rule_b_v1', net_status: 'CANONICAL_DATED_FEES' } });
  const rec = calls[0];
  assert.equal(rec.exit_reason, 'RULE_B_PLANNED_EXIT');
  assert.equal(rec.net_pnl, -319.58);
  assert.deepEqual(rec.entry_snapshot, { position_policy_id: 'paper_rule_b_v1', ev_decision_id: ACC.decision_id,
    ev_trade_uid: ACC.trade_uid, planned_exit_session: '2026-10-12' });
  assert.equal(rec.close_trace.policy_version, 'paper_rule_b_v1');
  // a non-experiment trade projects no snapshot (unchanged shape for v7 rows)
  ctx.recordClosedTradeToNative({ id: 1, paper: true, entry_snapshot: { selection_source: 'pc2' } }, { exit_reason: 'Manual' });
  assert.equal(calls[1].entry_snapshot, null);
});

test('old ACK-without-proof bridge is not used', () => {
  assert.doesNotMatch(src, /NativeBridge\.evRuleBAck\(/);
  assert.doesNotMatch(src, /evRequestAcceptance/);
});
