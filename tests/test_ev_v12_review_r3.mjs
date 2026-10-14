// Codex R2 re-review (14 Oct 2026) C2/C3: the PWA reproduction, inverted, on the actual app.js functions
// (applyRuleBFill / ev12ManualClose / ev12ManualDeliver / ev12PersistAcceptance / ev12RecoverAcceptances).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, remoteStore, src, ACC, VIEW, ECON, openRuleB, fillEntry } from './ev12_harness.mjs';

const MANUAL_PATCH = { status: 'CLOSED', exit_reason: 'Manual', exit_date: '2026-10-12T09:00:00.000Z', actual_pnl: 50, net_pnl: 12.5,
  close_trace_json: { source: 'manual' } };

function rbSetup(id = 9001, extra = {}) {
  const c = sandbox();
  const t = openRuleB(c, id);
  const e = fillEntry(id, extra); c.NativeBridge.ledger[String(id)] = e;
  return { c, t, e };
}

test('C2 probe inverted: same exit_reason but another decision/fill/net is not proof - no ACK', async () => {
  const { c, e } = rbSetup();
  c._store.rows[9001] = { ...c._store.rows[9001], status: 'CLOSED', exit_reason: 'RULE_B_PLANNED_EXIT', net_pnl: 9999,
    close_trace_json: { ev_decision_id: 'other', fill: { close_value_pts: 1 } } };
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'ARBITRATION_MISMATCH');
  assert.equal(c.NativeBridge.acks.length, 0);
  assert.equal(c._closed.length, 0);
  assert.deepEqual(c.NativeBridge.remoteFailed.at(-1), ['9001', 'CLOSE_PROOF_MISMATCH']);
  assert.equal(c._store.rows[9001].net_pnl, 9999);   // never overwritten
});

test('C2: the exact digest must land - altered net, decision or uid on the stored row is refused', async () => {
  for (const mutate of [
    (row) => { row.net_pnl = 1.23; },
    (row) => { row.entry_snapshot = { ...row.entry_snapshot, ev_trade_uid: 'other-uid' }; },
    (row) => { row.entry_snapshot = { ...row.entry_snapshot, ev_decision_id: 'ev12:NF:other' }; },
    (row) => { row.actual_pnl = 5; },
  ]) {
    const { c, e } = rbSetup();
    c._store.beforeUpdate = async (id, patch) => { /* the write lands, then something else alters the row */ };
    const orig = c.DB.updateOpenTrade;
    c.DB.updateOpenTrade = async (id, patch) => { const ok = await orig(id, patch); mutate(c._store.rows[id]); return ok; };
    const r = await c.applyRuleBFill(e);
    assert.notEqual(r.state, 'REMOTE_CONFIRMED');
    assert.equal(c.NativeBridge.acks.length, 0);
  }
  // the digest covers the frozen fill identity
  const { c, e } = rbSetup();
  const p1 = c.ev12ClosePatch(e, c._open[0]);
  const p2 = c.ev12ClosePatch({ ...e, fill: { ...e.fill, ts_iso: '2026-10-12T15:16:30+05:30' } }, c._open[0]);
  assert.notEqual(p1.close_trace_json.close_digest, p2.close_trace_json.close_digest);
  assert.equal(p1.close_trace_json.close_writer, 'RULE_B');
});

test('C2: lost update response - the readback of the exact digest confirms once', async () => {
  const { c, e } = rbSetup();
  const orig = c.DB.updateOpenTrade;
  c.DB.updateOpenTrade = async (id, p) => { await orig(id, p); return false; };   // landed, response lost
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'REMOTE_CONFIRMED');
  assert.equal(c._store.rows[9001].net_pnl, ECON.net_pnl);
  assert.deepEqual(c.NativeBridge.acks, [['9001', 'REMOTE_CONFIRMED']]);
});

test('C2: manual close arriving after a confirmed Rule B close never writes', async () => {
  const { c, t, e } = rbSetup();
  assert.equal((await c.applyRuleBFill(e)).state, 'REMOTE_CONFIRMED');
  const before = JSON.stringify(c._store.rows[9001]);
  const updates = c._store.updates;
  const r = await c.ev12ManualClose(t, MANUAL_PATCH, MANUAL_PATCH);
  assert.equal(r.state, 'RULE_B_WON');
  assert.equal(c._store.updates, updates);
  assert.equal(JSON.stringify(c._store.rows[9001]), before);
});

test('C2: manual update delayed until after the Rule B readback - Rule B wins, manual stops, no overwrite', async () => {
  const { c, t, e } = rbSetup();
  assert.equal(c.ev12NoteManualClose(t), 'RULE_B_TERMINAL_PENDING_DELIVERY');   // manual tapped while fill pending
  // the Rule B write lands first (inside the manual writer's window)
  c._store.beforeUpdate = async () => { assert.equal((await c.applyRuleBFill({ ...e, manual_pending: false })).state, 'REMOTE_CONFIRMED'); };
  const r = await c.ev12ManualClose(t, MANUAL_PATCH, MANUAL_PATCH);
  assert.equal(r.state, 'RULE_B_WON');
  assert.equal(c._store.rows[9001].exit_reason, 'RULE_B_PLANNED_EXIT');
  assert.equal(c._store.rows[9001].close_trace_json.close_writer, 'RULE_B');
  assert.deepEqual(c.NativeBridge.acks, [['9001', 'REMOTE_CONFIRMED']]);
  assert.equal(c._closed.length, 1);                                 // only the Rule B close is projected
});

test('C2: Rule B arriving after a committed manual close records MANUAL_CLOSE_CONFLICT and keeps the manual row', async () => {
  const { c, t, e } = rbSetup();
  assert.equal(c.ev12NoteManualClose(t), 'RULE_B_TERMINAL_PENDING_DELIVERY');
  const m = await c.ev12ManualClose(t, MANUAL_PATCH, MANUAL_PATCH);
  assert.equal(m.state, 'MANUAL_WON');
  assert.equal(c.NativeBridge.ledger['9001'].delivery, 'MANUAL_CLOSE_CONFLICT');
  // a stale Rule B delivery attempt (e.g. another WebView) must not overwrite
  const r = await c.applyRuleBFill({ ...e, delivery: 'REMOTE_PENDING', journal_patch: c.ev12ClosePatch(e, t) });
  assert.equal(r.state, 'MANUAL_CLOSE_CONFLICT');
  assert.equal(c._store.rows[9001].exit_reason, 'Manual');
  assert.equal(c._store.rows[9001].close_trace_json.close_writer, 'MANUAL');
});

test('C2: manual remote failure stays MANUAL_PENDING, survives a restart and is retried verbatim', async () => {
  const c = sandbox(); const t = openRuleB(c, 9002);
  c._store.failNextUpdate = true;
  const r = await c.ev12ManualClose(t, MANUAL_PATCH, MANUAL_PATCH);
  assert.equal(r.state, 'MANUAL_PENDING');
  assert.equal(c._store.rows[9002].status, 'OPEN');
  assert.equal(c._closed.length, 0);                                 // not recorded as closed before proof
  assert.equal(c.NativeBridge.ledger['9002'].delivery, 'MANUAL_PENDING');
  // restart: a fresh WebView over the same native ledger + remote store
  const d = sandbox({ NativeBridge: c.NativeBridge }, c._store);
  const pending = JSON.parse(d.NativeBridge.evRuleBPending());
  assert.equal(pending.length, 1);
  // recovery must not reinstall a trade whose manual close is pending
  d.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: '9002' }];
  const rec = await d.ev12RecoverAcceptances(new Set(['9002']));
  assert.equal(rec[0].reason, 'MANUAL_CLOSE_PENDING');
  assert.equal(d._open.length, 0);
  const again = await d.applyRuleBFill(pending[0]);
  assert.equal(again.state, 'MANUAL_WON');
  assert.equal(d._store.rows[9002].close_trace_json.close_writer, 'MANUAL');
  assert.equal(d._store.rows[9002].close_trace_json.close_digest, c.NativeBridge.ledger['9002'].manual_patch.close_trace_json.close_digest);
  assert.equal(d.NativeBridge.ledger['9002'].delivery, 'REMOTE_CONFIRMED');
  assert.equal(d._closed.length, 1);
  assert.equal(JSON.parse(d.NativeBridge.evRuleBPending()).length, 0);
});

test('C2: restart with the Rule B writer pending (journaled) confirms with the same patch', async () => {
  const { c, e } = rbSetup();
  c._store.failNextUpdate = true;
  assert.equal((await c.applyRuleBFill(e)).state, 'REMOTE_PENDING');
  const d = sandbox({ NativeBridge: c.NativeBridge }, c._store);
  const [p] = JSON.parse(d.NativeBridge.evRuleBPending());
  assert.equal((await d.applyRuleBFill(p)).state, 'REMOTE_CONFIRMED');
  assert.equal(d._store.rows[9001].close_trace_json.close_digest, p.journal_patch.close_trace_json.close_digest);
});

test('C2: non-experiment manual close path is unchanged (unconditional DB.updateTrade, native record first)', () => {
  assert.match(src, /const closeSynced = await DB\.updateTrade\(trade\.id, remoteClosePatch\);/);
  // experiment branch returns before the shared write unless the manual writer WON (then the identical patch)
  const i = src.indexOf('if (ev12Experiment) {\n            const arb');
  const j = src.indexOf('const closeSynced = await DB.updateTrade(trade.id, remoteClosePatch);');
  assert.ok(i > 0 && j > i);
  assert.match(src.slice(i, j), /if \(arb\.patch\) Object\.assign\(remoteClosePatch, arb\.patch\);/);
  const t = { id: 1, paper: true, entry_snapshot: { selection_source: 'pc2' } };
  assert.equal(sandbox().isEvRuleBTrade(t), false);
});

test('C3 probe inverted: WebView death after PERSISTED - recovery reinstalls the frozen entry into the native open list', async () => {
  let persisted = false;
  const pending = sandbox({ addOpenTradeToState: () => { throw new Error('simulated WebView death after insert'); } });
  const mark = pending.NativeBridge.evMarkTradePersisted;
  pending.NativeBridge.evMarkTradePersisted = (...a) => { persisted = true; return mark(...a); };
  const r = await pending.ev12PersistAcceptance(ACC, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NATIVE_OPEN_INSTALL_UNCONFIRMED');
  assert.equal(persisted, true);
  const id = Object.keys(pending._store.rows)[0];
  const resumed = sandbox({}, pending._store);
  resumed.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: id }];   // A.recovery now returns PERSISTED
  const out = await resumed.ev12RecoverAcceptances();
  assert.equal(out[0].reason, 'REINSTALLED');
  assert.equal(resumed._open.length, 1);
  assert.equal(pending._store.inserts, 1);                                  // no second row / fill / decision
  const nat = resumed.NativeBridge.nativeOpen;                              // PositionTickService source
  assert.equal(nat.length, 1);
  assert.equal(String(nat[0].id), id);
  assert.equal(nat[0].entry_snapshot.position_policy_id, 'paper_rule_b_v1');
  assert.equal(nat[0].entry_snapshot.ev_trade_uid, ACC.trade_uid);
  assert.equal(nat[0].entry_snapshot.planned_exit_session, '2026-10-12');   // due exit discoverable natively
  assert.equal(nat[0].entry_premium, 98.65);                                // frozen entry, not a new fill
  assert.equal((await resumed.ev12RecoverAcceptances())[0].reason, 'ALREADY_OPEN');
});

test('C3: interruption before insert / after insert before markPersisted - one row, stable uid', async () => {
  const s = remoteStore();
  const a = sandbox({}, s); a.NativeBridge.recovery = [{ ...ACC }];
  await a.ev12RecoverAcceptances();
  const b = sandbox({}, s); b.NativeBridge.recovery = [{ ...ACC }];        // crash after insert, before mark
  await b.ev12RecoverAcceptances();
  assert.equal(s.inserts, 1);
  assert.deepEqual(b.NativeBridge.marks[0].slice(2), [ACC.trade_uid]);
  assert.equal(b.NativeBridge.nativeOpen.length, 1);
});

test('C3: native setOpenTrades failure is not a successful handoff; a later recovery completes it', async () => {
  const a = sandbox();
  a.NativeBridge.failSetOpen = true;
  const real = a.addOpenTradeToState;
  a.addOpenTradeToState = (t) => { try { real(t); } catch (_) { /* real syncToNative swallows the error */ } };
  const r = await a.ev12PersistAcceptance(ACC, null);
  assert.equal(r.reason, 'NATIVE_OPEN_INSTALL_UNCONFIRMED');
  a.NativeBridge.failSetOpen = false;
  a.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: String(r.trade.id) }];
  assert.equal((await a.ev12RecoverAcceptances())[0].reason, 'REINSTALLED');
  assert.equal(a.NativeBridge.nativeOpen.length, 1);
});

test('C3: stale bootstrap - CLOSED remote row is reconciled, never reinstalled; unreadable row is retried', async () => {
  const c = sandbox(); openRuleB(c, 9003, { cached: false });
  c._store.rows[9003].status = 'CLOSED';
  c.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: '9003' }];
  assert.equal((await c.ev12RecoverAcceptances())[0].reason, 'RECONCILED_CLOSED');
  assert.deepEqual(c.NativeBridge.reconciledClosed, [ACC.decision_id]);
  assert.equal(c._open.length, 0);
  const d = sandbox(); openRuleB(d, 9004, { cached: false });
  d._store.failReads = true;
  d.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: '9004' }];
  assert.equal((await d.ev12RecoverAcceptances())[0].reason, 'READBACK_FAILED');
  d._store.failReads = false;
  assert.equal((await d.ev12RecoverAcceptances())[0].reason, 'REINSTALLED');
  // a uid mismatch on the row is never installed
  const e = sandbox(); openRuleB(e, 9005, { cached: false });
  e._store.rows[9005].entry_snapshot.ev_trade_uid = 'x';
  e.NativeBridge.recovery = [{ ...ACC, state: 'PERSISTED', trade_id: '9005' }];
  assert.equal((await e.ev12RecoverAcceptances())[0].reason, 'TRADE_UID_MISMATCH');
});
