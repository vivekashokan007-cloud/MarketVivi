// Codex review of checkpoint A (17 Nov 2026): A1 tap bound to the DISPLAYED identity, A2 identity validation before
// eligibility, A3 uncovered-short exclusion on every recommendation card.  REAL app.js renderers in a VM against
// the SYNTHETIC fixture (development, not session evidence).  Native first-read matching is covered on the JVM
// (Marketapp SingleLegAdmissionCoordinatorTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as FX from './fixtures/single_leg_trade_status_fixture_20261117.mjs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 3);
}
const LABELS = (() => { const a = src.indexOf('const SL_TRADE_STATE_LABEL'); return src.slice(a, src.indexOf('};', a) + 2); })();
const BUY_RE = (src.match(/^const SL_OUTRIGHT_BUY_ACTION = .*$/m) || [''])[0];
assert.ok(BUY_RE, 'shared outright-buy rule present');
function harness({ bridge = {}, positions = [], bd = {} } = {}) {
  const c = { String, Number, JSON, Object, Array, Math, Date, Intl, alerts: [], timers: [], bd,
    window: { NativeBridge: { getSingleLegPaperEnabled: () => true, singleLegRead: () => JSON.stringify({ positions }), ...bridge } },
    alert: m => c.alerts.push(m), setTimeout: f => c.timers.push(f),
    localStorage: (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; })(),
    getIndexSelector: () => 'BOTH', friendlyType: x => x, iaTodayIst: () => '2026-11-17',
    paperObservationAuthorization: () => ({ allowed: true, reason: '', analysis_only: true }),
    paperTradeCapacity: () => ({ available: true, count: 0, limit: 2 }), indexStructureChoiceAvailable: () => false,
    brainFreshnessStatus: () => ({ fresh: true, reason: '' }), singleLegCapital: () => ({ status: 'SET', capital: 250000 }) };
  vm.createContext(c);
  vm.runInContext(`let SINGLE_LEG_STORE=null; const SINGLE_LEG_PENDING_KEY='mr_single_leg_pending_v1'; let SINGLE_LEG_PENDING={}; let SINGLE_LEG_POLLING={};\n`
    + LABELS + '\n' + BUY_RE + '\n' + ['iaEsc', 'singleLegEnabled', 'loadSingleLegStore', 'saveSingleLegPending', 'resumeSingleLegPending',
      'singleLegAdmissionCheck', 'singleLegAdmitButton', 'admitSingleLegFromButton', 'admitSingleLeg', 'pollSingleLegAdmit',
      'finishSingleLegAdmit', 'renderSingleLegCard', 'singleLegTradeState', 'renderSingleLegTradeStatus',
      'renderAuthorityCandidateCard', 'renderAuthorityWatchlist'].map(fn).join('\n'), c);
  return c;
}
const section = (html, ix) => { const a = html.indexOf(`<section class="ia-index-section" data-index="${ix}"`); assert.ok(a >= 0); return html.slice(a, html.indexOf('</section>', a)); };
const tradeState = (html, ix) => (section(html, ix).match(/data-sl-state="([A-Z_]+)"/) || [])[1];
const copilotRow = (html, ix) => { const a = html.indexOf(`<div class="brain-detail sl-row" data-index="${ix}">`); assert.ok(a >= 0); return html.slice(a, html.indexOf('</div>', a)); };
const both = (bi, ix, extra) => { const c = harness({ bd: bi, ...extra }); return { c, trade: section(c.renderAuthorityWatchlist(bi), ix), tradeAll: c.renderAuthorityWatchlist(bi), copilot: copilotRow(c.renderSingleLegCard(bi), ix) }; };

// Each identity failure: Trade card shows RESULT_UNAVAILABLE + reason; Copilot shows the reason; neither offers a tap.
const CASES = [
  ['missing plan decision id', () => FX.result({ bnfPlan: FX.plan('BNF', { decision_id: undefined }) }), ['PLAN_DECISION_ID_MISSING']],
  ['blank plan decision id', () => FX.result({ bnfPlan: FX.plan('BNF', { decision_id: '  ' }) }), ['PLAN_DECISION_ID_MISSING']],
  ['missing index decision id', () => FX.result({ bnf: { decision_id: undefined } }), ['DECISION_ID_MISSING']],
  ['plan decision id differs', () => FX.result({ bnfPlan: FX.plan('BNF', { decision_id: 'fx_bnf_16' }) }), ['PLAN_DECISION_MISMATCH']],
  // Codex reproduction: an NF instrument under the BNF slot carrying the matching BNF decision id
  ['NF plan under the BNF slot with the BNF decision id', () => FX.result({ bnfPlan: { ...FX.plan('NF'), decision_id: 'fx_bnf_17' } }),
    ['PLAN_INDEX_MISMATCH', 'CONTRACT_INDEX_MISMATCH']],
  ['NF contract inside a BNF plan', () => FX.result({ bnfPlan: FX.plan('BNF', { contract: FX.plan('NF').contract }) }),
    ['CONTRACT_INDEX_MISMATCH', 'CONTRACT_INSTRUMENT_MISMATCH']],
  ['decision names another index', () => FX.result({ bnf: { index: 'NF' } }), ['DECISION_INDEX_MISMATCH']],
  ['instrument key missing', () => FX.result({ bnfPlan: FX.plan('BNF', { instrument_key: null }) }), ['INSTRUMENT_KEY_MISSING']],
  ['quote target is another instrument', () => FX.result({ bnfPlan: FX.plan('BNF', { quote_needed: ['FIXTURE|BNF|other'] }) }), ['QUOTE_INSTRUMENT_MISMATCH']],
  ['option type disagrees with the action', () => FX.result({ bnfPlan: FX.plan('BNF', { action: 'BUY_PE' }) }), ['OPTION_TYPE_MISMATCH']],
];
for (const [name, mk, reasons] of CASES) {
  test(`identity: ${name} -> unavailable on both cards, no admit button`, () => {
    for (const status of ['ADMISSIBLE', 'ELIGIBLE_PENDING_SNAPSHOT']) {
      const bi = mk(); if (bi.single_leg_by_index.BNF) bi.single_leg_by_index.BNF.status = status;
      const { c, trade, tradeAll, copilot } = both(bi, 'BNF');
      const s = c.singleLegTradeState('BNF', bi, { enabled: true, fresh: true });
      assert.equal(s.state, 'RESULT_UNAVAILABLE', `${name} ${status}`);
      assert.deepEqual([...s.reasons], reasons);
      assert.equal(s.identity, null);
      assert.equal(tradeState(tradeAll, 'BNF'), 'RESULT_UNAVAILABLE');
      for (const r of reasons) { assert.match(trade, new RegExp(r)); assert.match(copilot, new RegExp(r)); }
      assert.doesNotMatch(trade, /sl-admit/); assert.doesNotMatch(copilot, /sl-admit/);
      assert.match(copilot, /unavailable: /);
      // the other index is unaffected
      assert.equal(c.singleLegTradeState('NF', bi, { enabled: true, fresh: true }).state, 'ELIGIBLE');
    }
  });
}

test('action allowlist: unknown or missing-type actions are blocked with the reason on both cards', () => {
  for (const a of ['BUY_FUT', 'HOLD', 'buy_ce', 'BUY_CE_X']) {
    const bi = FX.result({ bnfPlan: FX.plan('BNF', { action: a }) });
    const { c, trade, copilot } = both(bi, 'BNF');
    const s = c.singleLegTradeState('BNF', bi, { enabled: true, fresh: true });
    assert.equal(s.state, 'BLOCKED', a);
    assert.equal(s.reasons[0], `ACTION_NOT_ALLOWED:${a}`);
    assert.match(trade, /ACTION_NOT_ALLOWED/); assert.match(copilot, /blocked: ACTION_NOT_ALLOWED/);
    assert.doesNotMatch(trade, /sl-admit/); assert.doesNotMatch(copilot, /sl-admit/);
  }
});

test('happy path: matched identity is ELIGIBLE on both cards and the button carries exactly the displayed ids', () => {
  for (const ix of ['NF', 'BNF']) {
    const bi = FX.result();
    const { c, trade, copilot } = both(bi, ix);
    const s = c.singleLegTradeState(ix, bi, { enabled: true, fresh: true });
    assert.equal(s.state, 'ELIGIBLE');
    const want = `data-index="${ix}" data-decision-id="fx_${ix.toLowerCase()}_17" data-instrument-key="FIXTURE|${ix}|2026-11-2x|${ix === 'NF' ? 26000 : 58500}CE" onclick="admitSingleLegFromButton(this)"`;
    assert.ok(trade.includes(want), trade); assert.ok(copilot.includes(want), copilot);
    assert.match(copilot, /admissible/);
  }
  // awaiting snapshot is tappable too, with the same binding
  const aw = FX.result({ nfPlan: FX.plan('NF', { status: 'ELIGIBLE_PENDING_SNAPSHOT', reasons: ['BROKER_SNAPSHOT_UNAVAILABLE'] }) });
  assert.match(both(aw, 'NF').trade, /data-decision-id="fx_nf_17"/);
});

test('A1: the tap forwards the displayed decision id and instrument key to the bound native entry only', () => {
  const sent = [], legacy = [];
  const bi = FX.result();
  const c = harness({ bd: bi, bridge: { singleLegAdmitDisplayed: (ix, d, k) => { sent.push([ix, d, k]); return JSON.stringify({ status: 'ADMITTED', position_id: 'p' }); },
    singleLegAdmit: ix => { legacy.push(ix); return '{}'; } } });
  const html = section(c.renderAuthorityWatchlist(bi), 'BNF');
  const attr = k => (html.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
  const el = { getAttribute: k => attr(k) };
  assert.equal(c.admitSingleLegFromButton(el).status, 'ADMITTED');
  assert.deepEqual(sent, [['BNF', 'fx_bnf_17', 'FIXTURE|BNF|2026-11-2x|58500CE']]);
  assert.deepEqual(legacy, []);
  assert.equal(c.alerts.length, 0);
});

test('A1: no identity, or a native build without the bound entry, sends nothing and says why', () => {
  const legacy = [];
  const c = harness({ bridge: { singleLegAdmit: ix => { legacy.push(ix); return '{"status":"PENDING","request_id":"x"}'; } } });
  assert.equal(c.admitSingleLeg('NF').reason, 'DISPLAYED_IDENTITY_REQUIRED');
  assert.equal(c.admitSingleLeg('NF', 'fx_nf_17', '').reason, 'DISPLAYED_IDENTITY_REQUIRED');
  assert.equal(c.admitSingleLeg('NF', 'fx_nf_17', 'K').reason, 'NATIVE_IDENTITY_BINDING_UNAVAILABLE');
  assert.deepEqual(legacy, []);
  assert.match(c.alerts.at(-1), /NATIVE_IDENTITY_BINDING_UNAVAILABLE/);
});

test('A1: identity changed before the native first read -> clear report, nothing admitted, a new tap is required', () => {
  let n = 0;
  const c = harness({ bridge: {
    singleLegAdmitDisplayed: () => JSON.stringify({ status: 'PENDING', request_id: 'rq1' }),
    singleLegAdmitStatus: id => JSON.stringify(++n < 2 ? { status: 'PENDING', phase: 'QUEUED', request_id: id }
      : { status: 'REJECTED', reason: 'DISPLAYED_PROPOSAL_CHANGED:decision_id', requires_new_tap: true, completed: true, request_id: id }) } });
  assert.equal(c.admitSingleLeg('BNF', 'fx_bnf_17', 'FIXTURE|BNF|2026-11-2x|58500CE').status, 'PENDING');
  c.timers.shift()(); c.timers.shift()();
  assert.equal(c.alerts.length, 1);
  assert.match(c.alerts[0], /proposal changed after you tapped \(decision_id\)\. Nothing was admitted - review the current proposal and tap again\. \[DISPLAYED_PROPOSAL_CHANGED:decision_id\]/);
  const bi = FX.result();
  assert.match(section(c.renderAuthorityWatchlist(bi), 'BNF'), /class="sl-admit"/);     // pending cleared: a NEW tap is possible
});

test('A3: an admissible uncovered short is blocked on BOTH cards with the reason; Manual Paper, research and positions stay', () => {
  for (const status of ['ADMISSIBLE', 'ELIGIBLE_PENDING_SNAPSHOT']) {
    for (const ot of ['PE', 'CE']) {
      const bi = FX.result({ bnfPlan: FX.plan('BNF', { side: 'SELL', option_type: ot, status, capital_required: 98000, capital_basis: 'BROKER_MARGIN' }) });
      const positions = [{ index: 'BNF', action: 'SELL_PE', instrument_key: 'FIXTURE|BNF|old', status: 'OPEN' },
        { index: 'NF', action: 'SELL_CE', instrument_key: 'FIXTURE|NF|old', status: 'EXIT_PENDING', exit_pending_reason: 'QUOTE_STALE' }];
      const { trade, copilot, c } = both(bi, 'BNF', { positions });
      assert.match(copilot, new RegExp(`SELL_${ot} 58500 .* · blocked: UNCOVERED_SHORT_NOT_OFFERED`));
      assert.doesNotMatch(copilot, /sl-admit/);
      assert.match(trade, /Blocked<\/span> · UNCOVERED_SHORT_NOT_OFFERED/);
      assert.doesNotMatch(trade, /sl-admit/);
      // the plan (research record) is shown as published, not rewritten
      assert.equal(bi.single_leg_by_index.BNF.action, `SELL_${ot}`); assert.equal(bi.single_leg_by_index.BNF.status, status);
      // Manual Paper on the spread cards is unchanged
      assert.equal((trade.match(/takeTrade\(/g) || []).length, 2);
      // existing short positions and their exit state are still listed
      const card = c.renderSingleLegCard(bi);
      assert.match(card, /BNF SELL_PE FIXTURE\|BNF\|old · OPEN/);
      assert.match(card, /NF SELL_CE FIXTURE\|NF\|old · EXIT_PENDING · pending: QUOTE_STALE/);
      // NF beside it is still offered
      assert.match(copilotRow(card, 'NF'), /sl-admit/);
    }
  }
});

test('the source keeps the outright-buy rule in ONE shared function used by both cards', () => {
  assert.equal((src.match(/^function singleLegAdmissionCheck\(/gm) || []).length, 1);
  assert.equal((src.match(/[=?] singleLegAdmissionCheck\(ix, bi\)/g) || []).length, 2);   // Copilot card + Trade status
  assert.equal((src.match(/onclick="admitSingleLeg\(/g) || []).length, 0);
  assert.equal((src.match(/\? singleLegAdmitButton\(ix, /g) || []).length, 2);
});

// R2 (Codex reply, 17 Nov 2026): an identity failure kept only the identity reasons, so a genuine blocked
// expiry-day plan with no instrument key showed only INSTRUMENT_KEY_MISSING and dropped the plan's own
// EXPIRY_DAY_NO_NEXT_CHAIN and BROKER_SNAPSHOT_UNAVAILABLE.  Shape after index_single_leg_v1.plan_entry on an
// NF expiry day (contract_identity: instrument_key None, reasons EXPIRY_DAY_NO_NEXT_CHAIN). SYNTHETIC values.
const nfExpiryDayPlan = (over = {}) => FX.plan('NF', { status: 'BLOCKED', instrument_key: null, quote_needed: [],
  contract: { index: 'NF', instrument_key: null, lot_size: null, expiry: '2026-11-17', reasons: ['EXPIRY_DAY_NO_NEXT_CHAIN'] },
  reasons: ['EXPIRY_DAY_NO_NEXT_CHAIN', 'BROKER_SNAPSHOT_UNAVAILABLE'], ...over });

test('R2: NF expiry-day plan without an instrument key shows identity AND source reasons; unavailable, no tap; BNF independent', () => {
  for (const bnfPlan of [FX.plan('BNF'), FX.plan('BNF', { status: 'ELIGIBLE_PENDING_SNAPSHOT', reasons: ['BROKER_SNAPSHOT_UNAVAILABLE'] })]) {
    const bi = FX.result({ nfPlan: nfExpiryDayPlan(), bnfPlan });
    const c = harness({ bd: bi });
    const s = c.singleLegTradeState('NF', bi, { enabled: true, fresh: true });
    assert.equal(s.state, 'RESULT_UNAVAILABLE');
    assert.deepEqual([...s.reasons], ['INSTRUMENT_KEY_MISSING', 'EXPIRY_DAY_NO_NEXT_CHAIN', 'BROKER_SNAPSHOT_UNAVAILABLE']);
    assert.equal(s.identity, null);
    const all = c.renderAuthorityWatchlist(bi), nf = section(all, 'NF');
    assert.equal(tradeState(all, 'NF'), 'RESULT_UNAVAILABLE');
    assert.match(nf, /Result unavailable<\/span> · INSTRUMENT_KEY_MISSING, EXPIRY_DAY_NO_NEXT_CHAIN, BROKER_SNAPSHOT_UNAVAILABLE/);
    assert.match(nf, /instrument unavailable/);
    assert.doesNotMatch(nf, /sl-admit/);
    // BNF renders on its own, with its own binding
    const b = c.singleLegTradeState('BNF', bi, { enabled: true, fresh: true });
    const want = bnfPlan.status === 'ADMISSIBLE' ? 'ELIGIBLE' : 'AWAITING_BROKER_SNAPSHOT';
    assert.equal(b.state, want);
    assert.equal(tradeState(all, 'BNF'), want);
    const bnf = section(all, 'BNF');
    assert.match(bnf, /data-decision-id="fx_bnf_17" data-instrument-key="FIXTURE\|BNF\|2026-11-2x\|58500CE"/);
    assert.doesNotMatch(bnf, /INSTRUMENT_KEY_MISSING|EXPIRY_DAY_NO_NEXT_CHAIN/);
  }
});

test('R2: identity and source reasons are deduplicated, identity first, order kept', () => {
  const bi = FX.result({ nfPlan: nfExpiryDayPlan({ reasons: ['INSTRUMENT_KEY_MISSING', 'EXPIRY_DAY_NO_NEXT_CHAIN',
    'BROKER_SNAPSHOT_UNAVAILABLE', 'EXPIRY_DAY_NO_NEXT_CHAIN'] }) });
  const c = harness({ bd: bi });
  const s = c.singleLegTradeState('NF', bi, { enabled: true, fresh: true });
  assert.equal(s.state, 'RESULT_UNAVAILABLE');
  assert.deepEqual([...s.reasons], ['INSTRUMENT_KEY_MISSING', 'EXPIRY_DAY_NO_NEXT_CHAIN', 'BROKER_SNAPSHOT_UNAVAILABLE']);
  // a blocked short keeps its plan reasons too, still deduplicated
  const sh = FX.result({ bnfPlan: FX.plan('BNF', { side: 'SELL', option_type: 'PE', status: 'BLOCKED',
    reasons: ['UNCOVERED_SHORT_NOT_OFFERED', 'SPREAD_GT_3PCT'] }) });
  const t = harness({ bd: sh }).singleLegTradeState('BNF', sh, { enabled: true, fresh: true });
  assert.equal(t.state, 'BLOCKED');
  assert.deepEqual([...t.reasons], ['UNCOVERED_SHORT_NOT_OFFERED', 'SPREAD_GT_3PCT']);
});
