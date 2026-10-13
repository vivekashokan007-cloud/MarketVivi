// Implied-EV v1.2 Paper experiment: PWA card, acceptance mapping, Rule B close consumer, labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('const EV12_POLICY_ID');
const end = src.indexOf('// UI RENDERING', start);
const block = src.slice(start, src.lastIndexOf('\n// ═', end));

function sandbox(extra = {}) {
  const ctx = {
    console, Math, Number, String, JSON, Date, Set, Promise, setTimeout,
    STATE: {}, C: { CAPITAL: 250000 }, bd: {},
    document: { getElementById: (id) => (ctx._els[id] ||= { innerHTML: '' }) }, _els: {},
    friendlyType: (t) => t, jsArg: (v) => JSON.stringify(String(v ?? '')),
    safeParseNB: (raw, fb) => { try { return raw == null ? fb : JSON.parse(raw); } catch (_) { return fb; } },
    currentOpenTrades: () => ctx._open, _open: [],
    findOpenTradeById: (id) => ctx._open.find(t => String(t.id) === String(id)) || null,
    removeOpenTradeFromState: (id) => { ctx._open = ctx._open.filter(t => String(t.id) !== String(id)); },
    addOpenTradeToState: (t) => ctx._open.push(t),
    recordClosedTradeToNative: (t, p) => ctx._closed.push({ t, p }), _closed: [],
    DB: { updateTrade: async (id, p) => { ctx._updates.push({ id, p }); return true; }, insertTrade: async (t) => ({ id: 'new1' }) },
    _updates: [], addNotificationLog: () => {}, renderAll: () => {},
    NativeBridge: { evRuleBAck: (id) => { ctx._acks.push(id); return true; } }, _acks: [],
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx;
}

const ACC = {
  status: 'ACCEPTED', accepted_at_ms: Date.UTC(2026, 9, 8, 7, 3), ev_robust_at_acceptance: 950.2, risk_allowance_at_acceptance: 13317.7,
  entry_fill: { entry_cash_pts: 98.65, legs: [
    { instrument_key: 'C5', qty: -1, strike: 22500, cp: 1, price: 120 }, { instrument_key: 'C8', qty: 1, strike: 22800, cp: 1, price: 40 },
    { instrument_key: 'P1', qty: -1, strike: 22100, cp: -1, price: 60 }, { instrument_key: 'P8', qty: 1, strike: 21800, cp: -1, price: 41.35 }] },
  frozen_policy: { policy_id: 'paper_rule_b_v1', decision_id: 'ev12:NF:2026-10-08:2980bce595335afd', planned_exit_session: '2026-10-12',
    expiry: '2026-10-13', contract_lot: 65, n_lots: 1, structure: 'IC200_300' },
};
const VIEW = { source_label: 'IMPLIED_EV_V12_EXPERIMENT', mode: 'active', recommendation: { actionable: true, session_date: '2026-10-08',
  pick: { structure: 'IC200_300', family: 'IC', type: 'IRON_CONDOR', legs: [[-1, 22500, 1], [1, 22800, 1], [-1, 22100, -1], [1, 21800, -1]],
    ev_robust_per_lot: '972.55', risk_allowance: '13317.74', planned_exit: '2026-10-12 15:15 IST (Rule B)', expiry: '2026-10-13', calibration_version: 'c' } } };

test('acceptance maps to a Paper swing trade with frozen Rule B policy (IC/IB intraday stamping exempt)', () => {
  const c = sandbox();
  const t = c.ev12TradeFromAcceptance(VIEW, ACC);
  assert.equal(t.paper, true);
  assert.equal(t.trade_mode, 'swing');
  assert.equal(t.strategy_type, 'IRON_CONDOR');
  assert.equal(t.entry_snapshot.position_policy_id, 'paper_rule_b_v1');
  assert.equal(t.entry_snapshot.ev_decision_id, ACC.frozen_policy.decision_id);
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

test('Rule B fill closes once at the frozen fill and acks; replay is idempotent', async () => {
  const c = sandbox();
  const trade = c.ev12TradeFromAcceptance(VIEW, ACC); trade.id = 't1';
  c._open = [trade];
  const entry = { trade_id: 't1', state: 'EXIT_FILLED', decision_id: ACC.frozen_policy.decision_id,
    fill: { kind: 'PLANNED_EXIT', ts_iso: '2026-10-12T15:15:30+05:30', close_value_pts: -60.25, legs: [] } };
  await c.applyRuleBFill(entry);
  assert.equal(c._open.length, 0);
  assert.equal(c._updates.length, 1);
  const p = c._updates[0].p;
  assert.equal(p.exit_reason, 'RULE_B_PLANNED_EXIT');
  assert.equal(p.close_trace_json.policy_version, 'paper_rule_b_v1');
  assert.equal(p.actual_pnl, Math.round(65 * (98.65 - 60.25) * 100) / 100);
  assert.deepEqual(c._acks, ['t1']);
  await c.applyRuleBFill(entry);
  assert.equal(c._updates.length, 1);
  assert.deepEqual(c._acks, ['t1', 't1']);
  const late = sandbox(); const tr2 = { ...trade, id: 't2' }; late._open = [tr2];
  await late.applyRuleBFill({ ...entry, trade_id: 't2', fill: { ...entry.fill, kind: 'LATE_EXIT' } });
  assert.equal(late._updates[0].p.exit_reason, 'RULE_B_LATE_EXIT');
});

test('unresolved is flagged for review, never closed at a fake price', async () => {
  const c = sandbox();
  const trade = c.ev12TradeFromAcceptance(VIEW, ACC); trade.id = 't3';
  c._open = [trade];
  await c.applyRuleBFill({ trade_id: 't3', state: 'UNRESOLVED', reason: 'NO_VALID_QUOTE_BY_EXPIRY_DEADLINE' });
  assert.equal(c._open.length, 1);
  assert.equal(c._closed.length, 0);
  assert.equal(c._updates[0].p.close_trace_json.rule_b_state, 'UNRESOLVED');
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
