// Implied-EV v1.2 Paper experiment: PWA card, acceptance mapping, Rule B close consumer, labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sandbox, src, ACC, VIEW, openRuleB, fillEntry } from './ev12_harness.mjs';

test('acceptance maps to a Paper swing trade with frozen Rule B policy (IC/IB intraday stamping exempt)', () => {
  const c = sandbox();
  const t = c.ev12TradeFromAcceptance(VIEW, ACC);
  assert.equal(t.paper, true);
  assert.equal(t.trade_mode, 'swing');
  assert.equal(t.strategy_type, 'IRON_CONDOR');
  assert.equal(t.entry_snapshot.position_policy_id, 'paper_rule_b_v1');
  assert.equal(t.entry_snapshot.ev_decision_id, ACC.frozen_policy.decision_id);
  assert.equal(t.entry_snapshot.ev_trade_uid, ACC.trade_uid);
  assert.equal(t.entry_snapshot.planned_exit_session, '2026-10-12');
  assert.deepEqual([t.sell_strike, t.sell_type, t.buy_strike, t.buy_type], [22500, 'CE', 22800, 'CE']);
  assert.deepEqual([t.sell_strike2, t.sell_type2, t.buy_strike2, t.buy_type2], [22100, 'PE', 21800, 'PE']);
  assert.equal(t.sell_instrument_key2, 'P1');
  assert.equal(t.lot_size, 65);
  assert.equal(c.isEvRuleBTrade(t), true);
  assert.equal(c.ev12PlannedExitLabel(t), 'Planned exit 2026-10-12 15:15 IST (Rule B)');
  assert.equal(c.isEvRuleBTrade({ ...t, paper: false }), false);
});

test('card is labelled experimental and only actionable views get the accept button', () => {
  const c = sandbox();
  c.bd = { implied_ev_v12: VIEW };
  c.renderEvExperiment();
  const html = c._els['ev12-card'].innerHTML;
  assert.match(html, /EXPERIMENTAL · Implied-EV v1\.2 · Paper only/);
  assert.match(html, /Planned exit|Rule B/);
  assert.match(html, /acceptEvDecision/);
  c.bd = { implied_ev_v12: { ...VIEW, mode: 'observe', recommendation: { ...VIEW.recommendation, actionable: false } } };
  c.renderEvExperiment();
  assert.doesNotMatch(c._els['ev12-card'].innerHTML, /acceptEvDecision/);
  c.bd = { implied_ev_v12: { source_label: 'X' } };
  c.renderEvExperiment();
  assert.equal(c._els['ev12-card'].innerHTML, '');
});

test('Rule B fill closes once at the frozen fill with canonical net, acks with remote proof; replay is idempotent', async () => {
  const c = sandbox();
  openRuleB(c, 9001);
  const e = fillEntry(9001); c.NativeBridge.ledger['9001'] = e;
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'REMOTE_CONFIRMED');
  const row = c._store.rows[9001];
  assert.equal(row.status, 'CLOSED');
  assert.equal(row.exit_reason, 'RULE_B_PLANNED_EXIT');
  assert.equal(row.close_trace_json.policy_version, 'paper_rule_b_v1');
  assert.equal(row.actual_pnl, -104);
  assert.equal(row.net_pnl, -319.58);
  assert.equal(c._open.length, 0);
  assert.deepEqual(c.NativeBridge.acks, [['9001', 'REMOTE_CONFIRMED']]);
  // replay: nothing pending any more, and a replayed entry is confirmed by readback without a second write
  assert.equal(JSON.parse(c.NativeBridge.evRuleBPending()).length, 0);
  const updates = c._store.updates;
  await c.applyRuleBFill({ ...c.NativeBridge.ledger['9001'] });
  assert.equal(c._store.updates, updates);
  const late = sandbox(); openRuleB(late, 9002);
  const le = fillEntry(9002, { fill: { ...e.fill, kind: 'LATE_EXIT' } }); late.NativeBridge.ledger['9002'] = le;
  await late.applyRuleBFill(le);
  assert.equal(late._store.rows[9002].exit_reason, 'RULE_B_LATE_EXIT');
});

test('unresolved is flagged for review, never closed at a fake price', async () => {
  const c = sandbox();
  openRuleB(c, 9003);
  const e = { trade_id: '9003', state: 'UNRESOLVED', reason: 'NO_VALID_QUOTE_BY_EXPIRY_DEADLINE', decision_id: ACC.decision_id };
  c.NativeBridge.ledger['9003'] = e;
  await c.applyRuleBFill(e);
  assert.equal(c._open.length, 1);
  assert.equal(c._closed.length, 0);
  assert.equal(c._store.rows[9003].status, 'OPEN');
  assert.equal(c._store.rows[9003].close_trace_json.rule_b_state, 'UNRESOLVED');
  assert.deepEqual(c.NativeBridge.acks, [['9003', 'REMOTE_CONFIRMED']]);
});

test('capital excludes open experiment risk; trade card shows Rule B label; render hook installed', () => {
  const c = sandbox();
  const trade = c.ev12TradeFromAcceptance(VIEW, ACC);
  c._open = [trade];
  assert.equal(c.ev12CapitalAvailable(), 250000 - 13317.7);
  assert.match(src, /isEvRuleBTrade\(t\)\n\s+\? `<span class="mode-tag mode-swing">EXPERIMENT · \$\{ev12Escape\(ev12PlannedExitLabel\(t\)\)\}/);
  assert.match(src, /refreshBrainData\(snap\);[^\n]*\n\s+try \{ renderEvExperiment\(\); applyRuleBFills\(\); \}/);
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<div id="ev12-card"><\/div>\s*<div id="watchlist">/);
});
