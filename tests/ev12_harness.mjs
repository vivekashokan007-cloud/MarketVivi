// Shared sandbox for the implied-EV v1.2 PWA block (actual app.js source, executed in a vm context).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('const EV12_POLICY_ID');
const end = src.indexOf('// UI RENDERING', start);
export const block = src.slice(start, src.lastIndexOf('\n// ═', end));

/** Remote trades_v2 stand-in with the same conditional semantics as DB.updateOpenTrade. */
export function remoteStore(rows = {}) {
  return {
    rows, inserts: 0, updates: 0, failNextUpdate: false, failReads: false, loseInsertResponse: false, nextId: 9000,
    byUid(uid) { return Object.values(this.rows).find(r => r.entry_snapshot?.ev_trade_uid === uid) || null; },
  };
}

export function sandbox(extra = {}, store = remoteStore()) {
  const ctx = {
    console, Math, Number, String, JSON, Date, Set, Promise, setTimeout, Array, Object,
    STATE: {}, C: { CAPITAL: 250000 }, bd: {},
    document: { getElementById: (id) => (ctx._els[id] ||= { innerHTML: '' }) }, _els: {},
    friendlyType: (t) => t, jsArg: (v) => JSON.stringify(String(v ?? '')),
    safeParseNB: (raw, fb) => { try { return raw == null ? fb : JSON.parse(raw); } catch (_) { return fb; } },
    currentOpenTrades: () => ctx._open, _open: [],
    findOpenTradeById: (id) => ctx._open.find(t => String(t.id) === String(id)) || null,
    removeOpenTradeFromState: (id) => { ctx._open = ctx._open.filter(t => String(t.id) !== String(id)); },
    addOpenTradeToState: (t) => {
      ctx._open = ctx._open.filter(x => String(x.id) !== String(t.id)); ctx._open.push(t);
      ctx.NativeBridge.setOpenTrades(JSON.stringify(ctx._open));   // same as the real syncToNative
    },
    recordClosedTradeToNative: (t, p) => ctx._closed.push({ t, p }), _closed: [],
    addNotificationLog: (...a) => ctx._logs.push(a), _logs: [], renderAll: () => {},
    alert: (m) => ctx._alerts.push(m), _alerts: [], confirm: () => true,
    _store: store,
    DB: {
      async findTradeByEvUid(uid) { return store.failReads ? null : (store.byUid(uid) ? { id: store.byUid(uid).id, status: store.byUid(uid).status } : null); },
      async insertTrade(t) {
        if (store.byUid(t.entry_snapshot?.ev_trade_uid)) return null;   // unique partial index
        store.inserts++; const id = store.nextId++;
        store.rows[id] = { ...JSON.parse(JSON.stringify(t)), id };
        if (store.loseInsertResponse) { store.loseInsertResponse = false; return null; }
        return { id };
      },
      async readTrade(id) { if (store.failReads || (store.failReadsN > 0 && store.failReadsN--)) return null; const r = store.rows[id]; return r ? JSON.parse(JSON.stringify(r)) : null; },
      async updateOpenTrade(id, patch) {
        if (store.beforeUpdate) { const h = store.beforeUpdate; store.beforeUpdate = null; await h(id, patch); }
        store.updates++;
        if (store.failNextUpdate) { store.failNextUpdate = false; return false; }
        const r = store.rows[id];
        if (r && r.status === 'OPEN') Object.assign(r, JSON.parse(JSON.stringify(patch)));
        return true;
      },
      async updateTrade(id, p) { ctx._updates.push({ id, p }); return true; },
    },
    _updates: [],
    NativeBridge: native(),
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx;
}

/** Native stand-in mirroring RuleBFillLedger + EvAcceptance semantics (journal before ACK, remote proof only). */
function native() {
  const n = {
    ledger: {}, manualResults: [], acks: [], marks: [], manual: [], remoteFailed: [], cancelled: [], confirmed: [], prepared: [],
    recovery: [],
    evRuleBPending() { return JSON.stringify(Object.values(n.ledger).filter(e => (['EXIT_FILLED', 'UNRESOLVED'].includes(e.state)
      && !['REMOTE_CONFIRMED', 'MANUAL_CLOSE_CONFLICT'].includes(e.delivery))
      || (e.state === 'MANUAL_CLOSED' && e.delivery === 'MANUAL_PENDING' && e.manual_patch))); },
    evRuleBJournal(id, patch) {
      const e = n.ledger[id]; if (!e) return 'UNKNOWN_TRADE';
      if (e.delivery === 'REMOTE_PENDING') return JSON.stringify(e.journal_patch) === patch ? 'ALREADY_JOURNALED' : 'JOURNALED_PATCH_DIFFERS';
      e.delivery = 'REMOTE_PENDING'; e.journal_patch = JSON.parse(patch); return 'JOURNALED';
    },
    evRuleBRemoteFailed(id, d) { n.remoteFailed.push([id, d]); return true; },
    evRuleBAckState(id, st) {
      const e = n.ledger[id]; if (!e || e.delivery !== 'REMOTE_PENDING') return false;
      e.delivery = st; n.acks.push([id, st]); return true;
    },
    evRuleBAck() { return false; },
    // mirrors RuleBFillLedger.noteManualClose / manualJournal / manualResult (Codex C2)
    evNoteManualClose(id, did) {
      n.manual.push([id, did]);
      const e = n.ledger[id];
      if (!e) { n.ledger[id] = { trade_id: id, decision_id: did, state: 'MANUAL_CLOSED', delivery: 'MANUAL_PENDING' }; return 'MANUAL_PENDING'; }
      if (e.state === 'MANUAL_CLOSED') return e.delivery === 'MANUAL_PENDING' ? 'MANUAL_PENDING' : 'ALREADY_MANUAL';
      if (e.delivery === 'REMOTE_CONFIRMED' && e.state === 'EXIT_FILLED') return 'RULE_B_ALREADY_CONFIRMED';
      if (e.delivery === 'MANUAL_CLOSE_CONFLICT') return 'ALREADY_MANUAL';
      e.manual_pending = true; return 'RULE_B_TERMINAL_PENDING_DELIVERY';
    },
    evManualCloseJournal(id, patch) {
      const e = n.ledger[id]; if (!e) return 'UNKNOWN_TRADE';
      if (!((e.state === 'MANUAL_CLOSED' && e.delivery === 'MANUAL_PENDING') || e.manual_pending)) return 'NO_PENDING_MANUAL_CLOSE';
      if (e.manual_patch) return JSON.stringify(e.manual_patch) === patch ? 'ALREADY_JOURNALED' : 'JOURNALED_PATCH_DIFFERS';
      e.manual_patch = JSON.parse(patch); return 'JOURNALED';
    },
    evManualCloseResult(id, r) {
      const e = n.ledger[id]; if (!e) return 'REFUSED';
      n.manualResults.push([id, r]);
      if (r === 'MANUAL_WON') {
        if (e.state === 'MANUAL_CLOSED') e.delivery = 'REMOTE_CONFIRMED';
        else if (e.delivery === 'REMOTE_CONFIRMED' && e.state === 'EXIT_FILLED') return 'REFUSED';
        else e.delivery = 'MANUAL_CLOSE_CONFLICT';
        delete e.manual_pending; return e.delivery;
      }
      if (r === 'RULE_B_WON' && e.state === 'EXIT_FILLED') { delete e.manual_pending; return e.delivery; }
      return 'REFUSED';
    },
    nativeOpen: [], failSetOpen: false, reconciledClosed: [],
    setOpenTrades(json) { if (n.failSetOpen) throw new Error('native setOpenTrades failed'); n.nativeOpen = JSON.parse(json); },
    getOpenTrades() { return JSON.stringify(n.nativeOpen); },
    evAcceptanceReconciledClosed(did) { n.reconciledClosed.push(did); return JSON.stringify({ state: 'CLOSED' }); },
    evMarkTradePersisted(did, id, uid) { n.marks.push([did, id, uid]); return JSON.stringify({ state: 'PERSISTED', trade_id: id }); },
    evAcceptanceRecovery() { return JSON.stringify(n.recovery); },
    evPrepareAcceptance(day, did) { n.prepared.push([day, did]); return JSON.stringify({ ok: true, request_id: 'r1' }); },
    evGetAcceptance() { return JSON.stringify(n.prepareResult); },
    evConfirmAcceptance(did, rid) { n.confirmed.push([did, rid]); return JSON.stringify(n.confirmResult); },
    evCancelAcceptance(did, rid) { n.cancelled.push([did, rid]); return JSON.stringify({ status: 'CANCELLED' }); },
  };
  return n;
}

export const ACC = {
  status: 'COMMITTED', state: 'COMMITTED', decision_id: 'ev12:NF:2026-10-08:2980bce595335afd',
  trade_uid: '1b4e28ba-2fa1-51d2-883f-0016d3cca427', reservation_id: 'res1',
  accepted_at_ms: Date.UTC(2026, 9, 8, 7, 3), ev_robust_at_acceptance: 950.2, risk_allowance_at_acceptance: 13317.7,
  entry_fill: { entry_cash_pts: 98.65, units: 65, structural_loss_pts: 201.35, structural_max_profit_pts: 98.65, legs: [
    { instrument_key: 'C5', qty: -1, strike: 22500, cp: 1, price: 120 }, { instrument_key: 'C8', qty: 1, strike: 22800, cp: 1, price: 40 },
    { instrument_key: 'P1', qty: -1, strike: 22100, cp: -1, price: 60 }, { instrument_key: 'P8', qty: 1, strike: 21800, cp: -1, price: 41.35 }] },
  frozen_policy: { policy_id: 'paper_rule_b_v1', decision_id: 'ev12:NF:2026-10-08:2980bce595335afd', planned_exit_session: '2026-10-12',
    expiry: '2026-10-13', contract_lot: 65, n_lots: 1, structure: 'IC200_300', family: 'IC' },
};
export const VIEW = { source_label: 'IMPLIED_EV_V12_EXPERIMENT', mode: 'active', recommendation: { actionable: true, session_date: '2026-10-08',
  decision_id: ACC.decision_id,
  pick: { structure: 'IC200_300', family: 'IC', type: 'IRON_CONDOR', legs: [[-1, 22500, 1], [1, 22800, 1], [-1, 22100, -1], [1, 21800, -1]],
    ev_robust_per_lot: '972.55', risk_allowance: '13317.74', planned_exit: '2026-10-12 15:15 IST (Rule B)', expiry: '2026-10-13', calibration_version: 'c' } } };
export const ECON = { status: 'OK', economics_version: 'ev_v12_rule_b_close_economics_v1', units: 65, entry_cash_pts: 98.65,
  close_value_pts: -100.25, gross_pnl: -104.0, entry_fee: 112.51, exit_fee: 103.07, fees_total: 215.58, net_pnl: -319.58,
  entry_fee_identity: { fee_contract_version: 'ev_v12_fee_teacher_v2_dated_20261013' },
  exit_fee_identity: { fee_contract_version: 'ev_v12_fee_teacher_v2_dated_20261013' } };

/** An open Rule B trade, stored remotely as row `id` and (optionally) in the PWA cache. */
export function openRuleB(c, id = 9001, { cached = true } = {}) {
  const t = c.ev12TradeFromAcceptance(VIEW, ACC); t.id = id;
  c._store.rows[id] = JSON.parse(JSON.stringify({ ...t, status: 'OPEN' }));
  if (cached) c._open.push(t);
  return t;
}

export function fillEntry(id, extra = {}) {
  return { trade_id: String(id), state: 'EXIT_FILLED', decision_id: ACC.decision_id, delivery: 'PENDING_APPLY', economics: ECON,
    fill: { kind: 'PLANNED_EXIT', ts_iso: '2026-10-12T15:15:30+05:30', close_value_pts: -100.25, legs: [] }, ...extra };
}
