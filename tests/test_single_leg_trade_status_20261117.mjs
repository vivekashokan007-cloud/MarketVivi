// Trade screen: per-index single-leg Paper status beside the spread candidates (Codex review 17 Nov 2026).
// Runs the REAL app.js functions in a VM against a SYNTHETIC fixture (no 17 Nov session export was available).
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
const labelsAt = src.indexOf('const SL_TRADE_STATE_LABEL');
const LABELS = src.slice(labelsAt, src.indexOf('};', labelsAt) + 2);
const BUY_RE = (src.match(/^const SL_OUTRIGHT_BUY_ACTION = .*$/m) || [''])[0];
// the admit button now carries the DISPLAYED identity (A1); match it by index
const ADMIT = ix => new RegExp(`class="sl-admit"[^>]*data-index="${ix}"[^>]*onclick="admitSingleLegFromButton\\(this\\)">Paper: fetch quote &amp; admit`);
function harness({ enabled = true, fresh = true, freshReason = '', sel = 'BOTH', pending = {}, bd = {} } = {}) {
  const c = { String, Number, JSON, Object, Array, Math, Date, calls: [], bd,
    getIndexSelector: () => sel, friendlyType: x => x,
    paperObservationAuthorization: () => ({ allowed: true, reason: '', analysis_only: true }),
    paperTradeCapacity: () => ({ available: true, count: 0, limit: 2 }),
    indexStructureChoiceAvailable: () => false,
    singleLegEnabled: () => enabled, brainFreshnessStatus: () => ({ fresh, reason: freshReason }),
    SINGLE_LEG_PENDING: pending };
  vm.createContext(c);
  vm.runInContext(LABELS + '\n' + BUY_RE + '\n' + ['iaEsc', 'singleLegAdmissionCheck', 'singleLegAdmitButton', 'singleLegTradeState', 'renderSingleLegTradeStatus',
    'renderAuthorityCandidateCard', 'renderAuthorityWatchlist'].map(fn).join('\n'), c);
  return c;
}
const section = (html, ix) => {
  const a = html.indexOf(`<section class="ia-index-section" data-index="${ix}"`);
  assert.ok(a >= 0, `section ${ix}`);
  return html.slice(a, html.indexOf('</section>', a));
};
const stateOf = (html, ix) => (section(html, ix).match(/data-sl-state="([A-Z_]+)"/) || [])[1];

for (const ix of ['NF', 'BNF']) {
  test(`${ix}: all six states, independently of the other index`, () => {
    const other = ix === 'NF' ? 'BNF' : 'NF';
    for (const [want, [bi, env]] of Object.entries(FX.sixStates(ix))) {
      const c = harness();
      const s = c.singleLegTradeState(ix, bi, env);
      assert.equal(s.state, want, `${ix} ${want}`);
      assert.equal(s.index, ix);
      // the other index's plan in the same result is untouched by this index's state
      if (env.enabled && env.fresh) assert.equal(c.singleLegTradeState(other, bi, env).state, 'ELIGIBLE', `${other} beside ${ix} ${want}`);
      const html = harness({ enabled: env.enabled, fresh: env.fresh, freshReason: env.freshReason, bd: bi }).renderAuthorityWatchlist(bi);
      assert.equal(stateOf(html, ix), want);
      assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
    }
  });
}

test('blocked shows the exact reasons; awaiting snapshot and eligible offer the existing admission only', () => {
  const S = FX.sixStates('BNF');
  const blocked = harness({ bd: S.BLOCKED[0] }).renderAuthorityWatchlist(S.BLOCKED[0]);
  assert.match(section(blocked, 'BNF'), /Blocked<\/span> · SPREAD_GT_3PCT, REENTRY_GAP_LT_30M/);
  assert.doesNotMatch(section(blocked, 'BNF'), /admitSingleLeg/);
  for (const k of ['AWAITING_BROKER_SNAPSHOT', 'ELIGIBLE']) {
    const html = harness({ bd: S[k][0] }).renderAuthorityWatchlist(S[k][0]);
    assert.match(section(html, 'BNF'), ADMIT('BNF'));
  }
  const aw = harness({ bd: S.AWAITING_BROKER_SNAPSHOT[0] }).renderAuthorityWatchlist(S.AWAITING_BROKER_SNAPSHOT[0]);
  assert.match(section(aw, 'BNF'), /Awaiting broker snapshot<\/span> · BROKER_SNAPSHOT_UNAVAILABLE/);
});

test('one index with a proposal while the other is blocked: separate sections, no combined status', () => {
  const bi = FX.result({ bnfPlan: FX.plan('BNF', { status: 'BLOCKED', reasons: ['ENTRY_WINDOW_CLOSED'] }) });
  const html = harness({ bd: bi }).renderAuthorityWatchlist(bi);
  assert.equal(stateOf(html, 'NF'), 'ELIGIBLE');
  assert.equal(stateOf(html, 'BNF'), 'BLOCKED');
  assert.match(section(html, 'NF'), ADMIT('NF'));
  assert.doesNotMatch(section(html, 'NF'), /data-index="BNF" data-decision-id|ENTRY_WINDOW_CLOSED/);
  assert.doesNotMatch(section(html, 'BNF'), /admitSingleLeg/);
  assert.equal((html.match(/class="sl-trade-status"/g) || []).length, 2);
  assert.doesNotMatch(html, /NF\+BNF|combined|both indices/i);
  // reversed: BNF proposes, NF blocked
  const r = FX.result({ nfPlan: FX.plan('NF', { status: 'BLOCKED', reasons: ['MANAGED_POLICY_CAP_ONE_PER_INDEX'] }) });
  const h2 = harness({ bd: r }).renderAuthorityWatchlist(r);
  assert.equal(stateOf(h2, 'NF'), 'BLOCKED');
  assert.equal(stateOf(h2, 'BNF'), 'ELIGIBLE');
});

test('no-spread displays still show the single-leg status beside the empty spread list', () => {
  const bi = FX.result({ nfCands: [], bnfCands: [] });
  const html = harness({ bd: bi }).renderAuthorityWatchlist(bi);
  for (const ix of ['NF', 'BNF']) {
    assert.match(section(html, ix), /sl-trade-status[\s\S]*No policy candidate for this index/);
    assert.equal(stateOf(html, ix), 'ELIGIBLE');
  }
  // with spreads: status sits before the spread cards and Manual Paper stays on every spread card
  const full = FX.result();
  const h = harness({ bd: full }).renderAuthorityWatchlist(full);
  assert.match(section(h, 'BNF'), /sl-trade-status[\s\S]*BULL_CALL[\s\S]*BULL_PUT/);
  assert.equal((section(h, 'BNF').match(/takeTrade\(/g) || []).length, 2);
});

test('stale or missing results never show a proposal as eligible', () => {
  const bi = FX.result();
  const stale = harness({ fresh: false, freshReason: 'Brain result is from another session (historical)', bd: bi }).renderAuthorityWatchlist(bi);
  for (const ix of ['NF', 'BNF']) {
    assert.equal(stateOf(stale, ix), 'RESULT_UNAVAILABLE');
    assert.match(section(stale, ix), /another session \(historical\)/);
    assert.doesNotMatch(section(stale, ix), /admitSingleLeg/);
  }
  const c = harness();
  const env = { enabled: true, fresh: true };
  assert.deepEqual([...c.singleLegTradeState('BNF', FX.result({ drop: ['BNF'] }), env).reasons], ['INDEX_RESULT_MISSING']);
  assert.equal(c.singleLegTradeState('NF', FX.result({ drop: ['BNF'] }), env).state, 'ELIGIBLE');
  assert.deepEqual([...c.singleLegTradeState('NF', FX.result({ nfPlan: null }), env).reasons], ['PLAN_NOT_COMPUTED']);
  const un = FX.result({ bnf: { availability: 'UNAVAILABLE', direction: { value: 'UNAVAILABLE' }, reason_codes: ['ANCHOR_MISSING'] } });
  assert.deepEqual([...c.singleLegTradeState('BNF', un, env).reasons], ['ANCHOR_MISSING']);
  const mism = FX.result({ bnfPlan: FX.plan('BNF', { decision_id: 'fx_bnf_16' }) });
  assert.deepEqual([...c.singleLegTradeState('BNF', mism, env).reasons], ['PLAN_DECISION_MISMATCH']);
  assert.equal(c.singleLegTradeState('BNF', {}, env).state, 'RESULT_UNAVAILABLE');
  assert.equal(c.singleLegTradeState('BNF', null, env).state, 'RESULT_UNAVAILABLE');
});

test('no uncovered shorts: a short single-leg proposal is blocked and never offered, even if admissible', () => {
  for (const status of ['ADMISSIBLE', 'ELIGIBLE_PENDING_SNAPSHOT']) {
    const bi = FX.result({ bnfPlan: FX.plan('BNF', { side: 'SELL', option_type: 'PE', status }) });
    const html = harness({ bd: bi }).renderAuthorityWatchlist(bi);
    assert.equal(stateOf(html, 'BNF'), 'BLOCKED');
    assert.match(section(html, 'BNF'), /UNCOVERED_SHORT_NOT_OFFERED/);
    assert.doesNotMatch(section(html, 'BNF'), /admitSingleLeg/);
  }
});

test('no-direction plan from the brain (NEUTRAL) reads as no directional proposal; ER missing is blocked', () => {
  const c = harness(); const env = { enabled: true, fresh: true };
  const n = FX.result({ bnfPlan: FX.plan('BNF', { action: null, status: 'BLOCKED', reasons: ['NO_ENTRY_DIRECTION:NEUTRAL'] }) });
  assert.equal(c.singleLegTradeState('BNF', n, env).state, 'NO_DIRECTIONAL_PROPOSAL');
  const e = FX.result({ bnfPlan: FX.plan('BNF', { action: null, status: 'BLOCKED', reasons: ['ER_UNAVAILABLE'] }) });
  assert.deepEqual([...c.singleLegTradeState('BNF', e, env).reasons], ['ER_UNAVAILABLE']);
  assert.equal(c.singleLegTradeState('BNF', e, env).state, 'BLOCKED');
});

test('index selector, contract identity, pending admission and off state', () => {
  const bi = FX.result();
  const only = harness({ sel: 'BNF', bd: bi }).renderAuthorityWatchlist(bi);
  assert.doesNotMatch(only, /data-index="NF"/);
  assert.equal(stateOf(only, 'BNF'), 'ELIGIBLE');
  assert.match(section(only, 'BNF'), /FIXTURE\|BNF\|2026-11-2x\|58500CE · exp 2026-11-25 · lot 30/);
  const pend = harness({ bd: bi, pending: { BNF: { request_id: 'r1', phase: 'FETCHING' } } }).renderAuthorityWatchlist(bi);
  assert.match(section(pend, 'BNF'), /admission pending \(FETCHING\)/);
  assert.doesNotMatch(section(pend, 'BNF'), /admitSingleLeg/);
  assert.match(section(pend, 'NF'), ADMIT('NF'));
  const off = harness({ enabled: false, bd: bi }).renderAuthorityWatchlist(bi);
  for (const ix of ['NF', 'BNF']) {
    assert.match(section(off, ix), /Paper single-leg off[\s\S]*setSingleLegEnabled\(true\)/);
    assert.doesNotMatch(section(off, ix), /admitSingleLeg/);
  }
  assert.doesNotMatch(only + off + pend, /takeTrade\([^)]*, false\)|REAL TRADE/);
  assert.match(src, /renderSingleLegTradeStatus\(ix, bi\)/);
  assert.match(FX.FIXTURE_LABEL, /SYNTHETIC FIXTURE/);
});
