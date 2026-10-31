// Delivery A (draft) — per-index direction authority in the PWA, on the REAL app.js functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 3);
}
const FNS = ['isIndexAuthorityActive', 'getIndexSelector', 'iaEsc', 'indexAuthorityEntryAuthorization',
  'renderIndexAuthorityPanel', 'renderIndexAuthorityPanels', 'renderDailyReviewCard', 'iaTodayIst',
  'indexStructureChoiceAvailable', 'renderIndexAlerts', 'chooseIndexStructureForPaper', 'setIndexSelector',
  'singleLegEnabled', 'setSingleLegEnabled', 'loadSingleLegStore', 'admitSingleLeg', 'renderSingleLegCard',
  'pollSingleLegAdmit', 'finishSingleLegAdmit', 'saveSingleLegPending', 'resumeSingleLegPending', 'singleLegCapital', 'setSingleLegCapitalPrompt', 'reviewNet', 'renderReviewGroups',
  'sessionEvidenceSupported', 'renderSessionEvidenceLine', 'renderReviewInputs'];
function ctx(sel = 'BOTH') {
  const store = { mr_index_selector_v1: sel };
  const c = { JSON, String, Object, Array, Math, Intl, Date, Number, calls: [], alerts: [], timers: [], window: {}, setTimeout: f => c.timers.push(f), prompt: () => c.promptValue, alert: m => c.alerts.push(m), localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  vm.createContext(c);
  vm.runInContext(`const INDEX_SELECTOR_KEY='mr_index_selector_v1'; let DAILY_REVIEW_CACHE=null; let SESSION_EVIDENCE_RESULT=null; let PENDING_STRUCTURE_CHOICE=null; let SINGLE_LEG_STORE=null; const SINGLE_LEG_PENDING_KEY='mr_single_leg_pending_v1'; let SINGLE_LEG_PENDING={}; let SINGLE_LEG_POLLING={}; var bd={};\nfunction takeTrade(id, p){ calls.push(['takeTrade', id, p, PENDING_STRUCTURE_CHOICE]); }\n${FNS.map(fn).join('\n')}`, c);
  return c;
}
const cand = { id: 'NF-BULL_CALL-1', index: 'NF', type: 'BULL_CALL', entryEligible: true, legs: [] };
function bi({ action = 'CANDIDATES', selected = null } = {}) {
  return {
    direction_authority: { active: 'index_direction_v1' },
    by_index: {
      NF: { direction: { value: 'BULL', strength: 'STRONG' }, display: 'Nifty up', regime: { value: 'TREND_UP' },
        structure_policy: { allowed: ['BULL_CALL', 'BULL_PUT'] }, action: { value: action, candidate_ids: [cand.id], reasons: [] } },
      BNF: { direction: { value: 'UNAVAILABLE' }, reason_codes: ['ANCHOR_MISSING'], action: { value: 'WAIT', reasons: ['DIRECTION_UNAVAILABLE'] } },
    },
    candidates_by_index: { NF: [cand], BNF: [] },
    managed_policy: { NF: { selected, reason: selected ? null : 'STRUCTURE_CHOICE_RULE_UNSPECIFIED', gates: [] } },
  };
}
test('per-index authority: entry only for the managed-selected candidate of its own index', () => {
  const c = ctx();
  assert.equal(c.isIndexAuthorityActive(bi()), true);
  assert.equal(c.indexAuthorityEntryAuthorization(cand, bi()).allowed, false);
  assert.match(c.indexAuthorityEntryAuthorization(cand, bi()).reason, /STRUCTURE_CHOICE_RULE_UNSPECIFIED/);
  assert.equal(c.indexAuthorityEntryAuthorization(cand, bi({ selected: { candidate_id: cand.id } })).allowed, true);
  assert.equal(c.indexAuthorityEntryAuthorization(cand, bi({ action: 'WAIT', selected: { candidate_id: cand.id } })).allowed, false);
  assert.equal(c.indexAuthorityEntryAuthorization({ ...cand, index: 'BNF' }, bi({ selected: { candidate_id: cand.id } })).allowed, false);
});
test('index selector blocks entries on the other index', () => {
  const c = ctx('BNF');
  assert.equal(c.indexAuthorityEntryAuthorization(cand, bi({ selected: { candidate_id: cand.id } })).allowed, false);
});
test('panels: every view labelled by index; no combined direction; unavailable shows reason', () => {
  const html = ctx().renderIndexAuthorityPanels(bi());
  assert.match(html, /NF · BULL/);
  assert.match(html, /BNF · UNAVAILABLE/);
  assert.match(html, /ANCHOR_MISSING/);
  assert.match(html, /combined NF\+BNF direction retired/);
  assert.match(html, /Daily review/);
  const only = ctx('NF').renderIndexAuthorityPanels(bi());
  assert.doesNotMatch(only, /data-index="BNF"/);
});
test('legacy payload is not treated as the new authority', () => {
  assert.equal(ctx().isIndexAuthorityActive({ verdict: { action: 'ENTER' } }), false);
});

test('R5: explicit structure choice - each allowed alternative selectable, validated natively, no default', () => {
  const c = ctx();
  const b = bi();
  b.by_index.NF.decision_id = 'idx1_nf';
  b.candidates_by_index.NF.push({ id: 'NF-BULL_PUT-1', index: 'NF', type: 'BULL_PUT', entryEligible: true, legs: [] });
  const html = c.renderIndexAuthorityPanel('NF', b.by_index.NF, b.candidates_by_index.NF, b.managed_policy.NF);
  assert.equal((html.match(/Choose for Paper/g) || []).length, 2);
  assert.match(html, /chooseIndexStructureForPaper\('NF','idx1_nf','NF-BULL_PUT-1'\)/);
  const seen = [];
  c.window.NativeBridge = { indexAuthorityChoose: (i, d, id) => { seen.push([i, d, id]); return JSON.stringify({ status: 'CHOSEN', choice: { candidate_id: id, selection_basis: 'USER_EXPLICIT' } }); } };
  c.chooseIndexStructureForPaper('NF', 'idx1_nf', 'NF-BULL_PUT-1');
  assert.deepEqual(seen, [['NF', 'idx1_nf', 'NF-BULL_PUT-1']]);
  assert.equal(c.calls[0][1], 'NF-BULL_PUT-1');
  assert.equal(c.calls[0][3].selection_basis, 'USER_EXPLICIT');
  c.window.NativeBridge = { indexAuthorityChoose: () => JSON.stringify({ status: 'REJECTED', reason: 'DECISION_NOT_CURRENT' }) };
  c.chooseIndexStructureForPaper('NF', 'idx1_old', 'NF-BULL_CALL-1');
  assert.equal(c.calls.length, 1);
  assert.match(c.alerts[0], /DECISION_NOT_CURRENT/);
  const ineligible = { ...b.candidates_by_index.NF[0], entryEligible: false };
  assert.equal(c.indexStructureChoiceAvailable(ineligible, b.by_index.NF), false);
  const c2 = ctx('BNF');
  assert.equal(c2.indexStructureChoiceAvailable(b.candidates_by_index.NF[0], b.by_index.NF), false);
});

test('R5: selector is sent to native; INDEX alerts shown per index', () => {
  const c = ctx();
  const sent = [];
  c.window.NativeBridge = { setIndexSelector: v => sent.push(v) };
  c.setIndexSelector('BNF');
  assert.deepEqual(sent, ['BNF']);
  vm.runInContext(`bd = { alerts: [{ category: 'INDEX', index: 'NF', title: 'NF: alternatives available (your choice)' }, { category: 'INDEX', index: 'BNF', title: 'BNF x' }] };`, c);
  assert.match(c.renderIndexAlerts('NF'), /alternatives available/);
  assert.doesNotMatch(c.renderIndexAlerts('NF'), /BNF x/);
});

test('R5: authority candidates carry no rank into the Paper entry snapshot', () => {
  assert.match(src, /authorityOrdered \? null\s*: \(rankedValue\(cand\.pc2PaperRank\)/);
  assert.match(src, /followed_app: authorityOrdered \? null : candRank === 1/);
  assert.match(src, /structure_choice: structureChoice/);
});

// Delivery B: single-leg Paper card (explicit opt-in, every block reason shown, explicit admission via native)
test('single-leg card: off by default, shows every block reason, admit only when on and admissible', () => {
  const c = ctx();
  const b = bi();
  b.single_leg_by_index = { NF: { admit: false, action: 'BUY_CE', strike: 24100, reasons: ['CONTRACT_METADATA_UNAVAILABLE', 'QUOTE_FRESHNESS_UNVERIFIED'] },
    BNF: { admit: false, reasons: ['DIRECTION_UNAVAILABLE'] } };
  const off = c.renderSingleLegCard(b);
  assert.match(off, /CONTRACT_METADATA_UNAVAILABLE, QUOTE_FRESHNESS_UNVERIFIED/);
  assert.match(off, /DIRECTION_UNAVAILABLE/);
  assert.match(off, /Turn on/);
  assert.doesNotMatch(off, /sl-admit/);
  const calls = [];
  c.window.NativeBridge = { getSingleLegPaperEnabled: () => true, singleLegRead: () => JSON.stringify({ positions: [{ index: 'NF', action: 'BUY_CE', instrument_key: 'SYNTH_FO|1', status: 'OPEN' }] }),
    singleLegAdmit: ix => { calls.push(ix); return JSON.stringify({ status: 'ADMITTED', position_id: 'p1' }); } };
  vm.runInContext('SINGLE_LEG_STORE=null', c);
  b.single_leg_by_index.NF = { admit: true, status: 'ADMISSIBLE', action: 'BUY_CE', strike: 24100, units: 65, capital_required: 12938.41, capital_basis: 'LONG_PREMIUM_PLUS_FEE', reasons: [] };
  const on = c.renderSingleLegCard(b);
  assert.match(on, /admitSingleLeg\('NF'\)/);
  assert.doesNotMatch(on, /admitSingleLeg\('BNF'\)/);
  assert.match(on, /SYNTH_FO\|1 · OPEN/);
  assert.match(on, /Paper fill estimate from broker snapshot; exchange quote age unavailable\./);
  assert.equal(c.admitSingleLeg('NF').status, 'ADMITTED');
  assert.deepEqual(calls, ['NF']);
  assert.equal(c.alerts.length, 0);
});
test('single-leg admit: native rejection is surfaced with its reasons, never silently accepted', () => {
  const c = ctx();
  c.window.NativeBridge = { singleLegAdmit: () => JSON.stringify({ status: 'REJECTED', reason: 'PROPOSAL_NOT_ADMISSIBLE', reasons: ['MARGIN_EVIDENCE_STALE'] }), singleLegRead: () => '{}' };
  assert.equal(c.admitSingleLeg('NF').status, 'REJECTED');
  assert.match(c.alerts[0], /PROPOSAL_NOT_ADMISSIBLE \(MARGIN_EVIDENCE_STALE\)/);
  const none = ctx(); none.admitSingleLeg('NF');
  assert.match(none.alerts[0], /BRIDGE_UNAVAILABLE/);
});

test('R7: proposal waiting only for a broker snapshot is tappable (non-circular); blocked ones are not', () => {
  const c = ctx();
  c.window.NativeBridge = { getSingleLegPaperEnabled: () => true, singleLegRead: () => '{}' };
  const b = bi();
  b.single_leg_by_index = { NF: { admit: false, status: 'ELIGIBLE_PENDING_SNAPSHOT', action: 'BUY_CE', strike: 24100, reasons: ['BROKER_SNAPSHOT_UNAVAILABLE'] },
    BNF: { admit: false, status: 'BLOCKED', action: 'SELL_PE', reasons: ['MARGIN_UNAVAILABLE', 'QUANTITY_SHORTFALL'] } };
  const html = c.renderSingleLegCard(b);
  assert.match(html, /needs a fresh broker snapshot at tap/);
  assert.match(html, /admitSingleLeg\('NF'\)/);
  assert.doesNotMatch(html, /admitSingleLeg\('BNF'\)/);
  assert.match(html, /MARGIN_UNAVAILABLE, QUANTITY_SHORTFALL/);
  assert.doesNotMatch(html, /FRESHNESS_VERIFIED/);
});

test('R8: admission is non-blocking - PENDING with request id, page polls status until completed', () => {
  const c = ctx();
  let n = 0;
  c.window.NativeBridge = { getSingleLegPaperEnabled: () => true, singleLegRead: () => '{}',
    singleLegAdmit: () => JSON.stringify({ status: 'PENDING', request_id: 'rq1' }),
    singleLegAdmitStatus: id => { n++; return JSON.stringify(n < 2 ? { status: 'PENDING', phase: 'FETCHING', request_id: id }
      : { status: 'REJECTED', reason: 'STATE_CHANGED_DURING_FETCH:selector', completed: true, request_id: id }); } };
  assert.equal(c.admitSingleLeg('NF').status, 'PENDING');
  assert.equal(c.alerts.length, 0);
  const b = bi(); b.single_leg_by_index = { NF: { status: 'ADMISSIBLE', action: 'BUY_CE', reasons: [] } };
  assert.match(c.renderSingleLegCard(b), /admission pending \(QUEUED\)/);
  c.timers.shift()();                                   // first poll: still fetching
  assert.match(c.renderSingleLegCard(b), /admission pending \(FETCHING\)/);
  c.timers.shift()();                                   // second poll: completed
  assert.match(c.alerts[0], /STATE_CHANGED_DURING_FETCH:selector/);
  assert.doesNotMatch(c.renderSingleLegCard(b), /admission pending/);
});

test('R8: capital is native-owned; unset capital is shown and rejected, never assumed', () => {
  const c = ctx();
  const saved = [];
  c.window.NativeBridge = { getSingleLegPaperEnabled: () => true, singleLegRead: () => '{}',
    getSingleLegCapital: () => JSON.stringify({ status: 'UNSET' }),
    setSingleLegCapital: v => { saved.push(v); return JSON.stringify(v > 0 ? { status: 'OK', capital: v } : { status: 'REJECTED', reason: 'CAPITAL_CONFIG_INVALID' }); } };
  assert.match(c.renderSingleLegCard(bi()), /Capital: .*not set/);
  c.promptValue = '-5'; c.setSingleLegCapitalPrompt();
  assert.match(c.alerts[0], /CAPITAL_CONFIG_INVALID/);
  c.promptValue = '300000'; assert.equal(c.setSingleLegCapitalPrompt().status, 'OK');
  assert.deepEqual(saved, [-5, 300000]);
  c.window.NativeBridge.getSingleLegCapital = () => JSON.stringify({ status: 'SET', capital: 300000 });
  assert.match(c.renderSingleLegCard(bi()), /Capital: ₹300000/);
});

test('R8: daily review shows single-leg BUY/SELL, multi-leg by strategy, unknown as unknown, per index', () => {
  const c = ctx();
  const seg = { 'ACTUAL_PAPER|index_single_leg_v1': { source: 'ACTUAL_PAPER', policy_version: 'index_single_leg_v1', groups: {
      SINGLE_LEG_BUY: { entries: 2, exits: 1, resolved: 1, unresolved: 1, fees_total: 40, net_pnl_after_costs: null, net_unknown: 1, net_status: 'UNKNOWN',
        exit_reasons: { STOP: 1 }, denominators: { LONG_PREMIUM_PLUS_FEE: { n: 2, capital_known: 2 } },
        by_action: { BUY_CE: { entries: 2, net_status: 'UNKNOWN', net_pnl_after_costs: null, net_unknown: 1 }, BUY_PE: { entries: 0, net_status: 'NO_OBSERVATIONS' } } },
      SINGLE_LEG_SELL: { entries: 0, exits: 0, resolved: 0, unresolved: 0, fees_total: null, net_pnl_after_costs: null, net_status: 'NO_OBSERVATIONS',
        exit_reasons: {}, denominators: {}, by_action: { SELL_CE: { entries: 0, net_status: 'NO_OBSERVATIONS' }, SELL_PE: { entries: 0, net_status: 'NO_OBSERVATIONS' } } } } },
    'HYPOTHETICAL|index_managed_v1': { source: 'HYPOTHETICAL', policy_version: 'index_managed_v1', groups: {
      'MULTI_LEG:IRON_CONDOR': { entries: 1, exits: 1, resolved: 1, unresolved: 0, fees_total: 80, net_pnl_after_costs: -30, net_status: 'KNOWN', exit_reasons: {}, denominators: {} } } } };
  c.DAILY_REVIEW_CACHE = null;
  vm.runInContext(`DAILY_REVIEW_CACHE = ${JSON.stringify({ latest: { by_index: { NF: { coverage: {}, paper_outcome_groups: seg }, BNF: { coverage: {} } } } })};`, c);
  const html = c.renderDailyReviewCard();
  assert.match(html, /SINGLE_LEG_BUY: entries 2 .*net unknown \(1 unknown, 1 unresolved\)/s);
  assert.match(html, /BUY_PE: 0 · 0 observations/);
  assert.match(html, /SINGLE_LEG_SELL: entries 0/);
  assert.match(html, /Hypothetical · index_managed_v1/);
  assert.match(html, /MULTI_LEG:IRON_CONDOR: .*net after costs ₹-30/s);
  assert.match(html, /LONG_PREMIUM_PLUS_FEE 2\/2/);
  assert.doesNotMatch(html, /combined/i);
});

test('R9: outcome after the normal polling period is still shown; reload resumes; never a timer-made rejection', () => {
  const c = ctx();
  let n = 0;
  c.window.NativeBridge = { getSingleLegPaperEnabled: () => true, singleLegRead: () => '{}',
    singleLegAdmit: () => JSON.stringify({ status: 'PENDING', request_id: 'rq9' }),
    singleLegAdmitStatus: id => { n++; return JSON.stringify(n < 160 ? { status: 'PENDING', phase: 'OUTCOME_UNCONFIRMED', request_id: id }
      : { status: 'ADMITTED', position_id: 'sl1_x', completed: true, reconciled: true, request_id: id }); } };
  c.admitSingleLeg('NF');
  for (let i = 0; i < 155; i++) c.timers.shift()();
  assert.equal(c.alerts.length, 0);                                  // no NOT_ADMITTED / poll-limit verdict
  const b = bi(); b.single_leg_by_index = { NF: { status: 'ADMISSIBLE', action: 'BUY_CE', reasons: [] } };
  assert.match(c.renderSingleLegCard(b), /outcome not yet confirmed/);
  // page reload: a fresh context sharing the same localStorage resumes polling the persisted id
  const saved = c.localStorage.getItem('mr_single_leg_pending_v1');
  assert.match(saved, /rq9/);
  const d = ctx(); d.localStorage.setItem('mr_single_leg_pending_v1', saved);
  d.window.NativeBridge = { ...c.window.NativeBridge, singleLegAdmitStatus: id => JSON.stringify({ status: 'ADMITTED', completed: true, request_id: id }) };
  d.renderSingleLegCard(b);
  d.timers.shift()();
  assert.equal(d.alerts.length, 0);                                  // ADMITTED -> no failure alert
  assert.doesNotMatch(d.renderSingleLegCard(b), /pending/);
  assert.doesNotMatch(d.localStorage.getItem('mr_single_leg_pending_v1'), /rq9/);
  while (c.timers.length && n < 170) c.timers.shift()();
  assert.equal(c.alerts.length, 0);
  assert.doesNotMatch(c.renderSingleLegCard(b), /pending/);
});
