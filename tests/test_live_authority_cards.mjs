import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}
function harness({ allowed = true, full = false, choice = false } = {}) {
  const c = { String, Number, JSON, Object, Array, Math, Date, calls: [],
    bd: { by_index: { NF: { decision_id: 'idx1_nf' } } },
    getIndexSelector: () => 'BOTH', friendlyType: x => x,
    paperObservationAuthorization: () => ({ allowed, reason: 'IDENTITY_UNAVAILABLE', analysis_only: true }),
    paperTradeCapacity: () => ({ available: !full, count: full ? 2 : 0, limit: 2 }),
    indexStructureChoiceAvailable: () => choice,
  };
  vm.createContext(c);
  vm.runInContext(['iaEsc', 'renderAuthorityCandidateCard', 'renderAuthorityWatchlist', 'renderCandidateCard'].map(fn).join('\n'), c);
  return c;
}
const missing = { authorityPolicyVersion: 'index_direction_v1', index: 'NF', id: 'NF_IC', type: 'IRON_CONDOR',
  expiry: '2026-11-03', lotSize: null, maxProfit: null, maxLoss: null, frictionCost: null,
  frictionCostStatus: 'LOT_SIZE_UNKNOWN', entryEligible: false,
  entryEligibility: { reasons: ['lot_unavailable', 'friction_unavailable'] },
  lotEvidence: { status: 'UNAVAILABLE', reasons: ['CONTRACT_METADATA_UNAVAILABLE'] },
  legs: [{ action: 'SELL', strike: 23350, option_type: 'CE', bid: 92.5, ask: 93.5 }],
  // Old fields may be present in a mixed payload but must not be interpreted here.
  probProfit: 1, ev: 99999, forces: { aligned: 3 },
};

test('real renderer handles the phone-shaped missing data without invented probability, margin or ranking', () => {
  const html = harness().renderCandidateCard(missing, 23350, 1);
  assert.match(html, /bid ₹92.50 \/ ask ₹93.50/);
  assert.match(html, /Lot:<\/span><strong>Unavailable<\/strong>/);
  assert.match(html, /CONTRACT_METADATA_UNAVAILABLE/);
  assert.match(html, /lot_unavailable, friction_unavailable/);
  assert.match(html, /Broker margin: unavailable/);
  assert.match(html, /Manual Paper analysis/);
  assert.doesNotMatch(html, /undefined|NaN|100%|TRACK RECORD|Kelly|EV\/|#1|₹0(?:\D|$)/);
});

test('verified candidate shows bounded costs and keeps explicit structure choice', () => {
  const html = harness({ choice: true }).renderCandidateCard({ ...missing, entryEligible: true,
    lotSize: 65, maxProfit: 5000, maxLoss: 4750, frictionCost: 258.48, frictionCostStatus: 'OK',
    lotEvidence: { status: 'VERIFIED', reasons: [] } }, 23350, 1);
  assert.match(html, /dated NSE table verified/);
  assert.match(html, /Max loss:<\/span><strong>₹4750.00<\/strong>/);
  assert.match(html, /Estimated costs:<\/span><strong>₹258.48<\/strong>/);
  assert.match(html, /Choose for Paper/);
  assert.match(html, /chooseIndexStructureForPaper\(&quot;NF&quot;,&quot;idx1_nf&quot;,&quot;NF_IC&quot;\)/);
});

test('authority strategy is a scannable card with separate legs, risk, warnings and Paper actions', () => {
  const c = harness({ choice: true });
  const x = { ...missing, entryEligible: true, lotSize: 65, lotEvidence: { status: 'VERIFIED', reasons: [] },
    maxProfit: 5235.75, maxLoss: 4514.25, frictionCost: 212.15, frictionCostStatus: 'OK',
    legs: [
      { action: 'SELL', strike: 23250, option_type: 'CE', bid: 59.7, ask: 59.8 },
      { action: 'SELL', strike: 23150, option_type: 'PE', bid: 72.75, ask: 72.95 },
      { action: 'BUY', strike: 23400, option_type: 'CE', bid: 21.85, ask: 21.95 },
      { action: 'BUY', strike: 23000, option_type: 'PE', bid: 29.8, ask: 29.95 },
    ] };
  const before = JSON.stringify(x);
  const html = c.renderAuthorityCandidateCard(x);
  // compact: summary + mini grid + actions visible, full legs/metrics inside the collapsed details panel
  assert.match(html, /ia-card-head[\s\S]*ia-mini-grid[\s\S]*ia-card-actions[\s\S]*ia-toggle[\s\S]*class="ia-details"[^>]* hidden[\s\S]*ia-legs[\s\S]*ia-metrics/);
  assert.equal((html.match(/class="ia-leg"/g) || []).length, 4);
  assert.equal((html.match(/ia-leg-action ia-sell/g) || []).length, 2);
  assert.equal((html.match(/ia-leg-action ia-buy/g) || []).length, 2);
  assert.match(html, /₹5235.75/);
  assert.match(html, /₹4514.25/);
  assert.match(html, /Policy alternative, not ranked/);
  assert.match(html, /Choose for Paper/);
  assert.match(html, /Manual Paper analysis/);
  assert.doesNotMatch(html, /TRACK RECORD|Kelly|EV\/|REAL TRADE/);
  assert.equal(JSON.stringify(x), before);
});

test('manual Paper preserves unavailable and capacity gates; no real entry button added', () => {
  assert.match(harness({ allowed: false }).renderAuthorityCandidateCard(missing), /disabled title="IDENTITY_UNAVAILABLE"/);
  assert.match(harness({ full: true }).renderAuthorityCandidateCard(missing), /PAPER FULL \(2\/2\)/);
  assert.doesNotMatch(harness().renderAuthorityCandidateCard(missing), /takeTrade\([^)]*, false\)|REAL TRADE/);
});

test('NF and BNF keep separate action/reasons and no combined legacy banner', () => {
  const c = harness();
  const html = c.renderAuthorityWatchlist({ by_index: {
    NF: { direction: { value: 'BULL' }, action: { value: 'CANDIDATES', reasons: [] } },
    BNF: { direction: { value: 'NEUTRAL' }, action: { value: 'NO_TRADE', reasons: ['lot_unavailable'] } },
  }, candidates_by_index: { NF: [missing], BNF: [] } });
  assert.match(html, /NF · BULL/);
  assert.match(html, /BNF · NEUTRAL/);
  assert.match(html, /NO_TRADE · lot_unavailable/);
  assert.doesNotMatch(html, /Context bias|Morning:|by current menu rank/);
  assert.match(fn('renderWatchlist'), /isIndexAuthorityActive\(bd\)[\s\S]*renderAuthorityWatchlist\(bd\)/);
});

test('active authority does not append retired Kelly and combined-direction insight cards', () => {
  const c = { bd: { direction_authority: { active: 'index_direction_v1' },
    risk: [{ title: 'Kelly 16%' }], market: [{ title: 'Direction (F1) is your edge' }] },
    STATE: { brainReady: true, brainLastRun: 0 }, Date, Math,
    isLiveRecommendationWindow: () => true, brainFreshnessStatus: () => ({ fresh: true }),
    isIndexAuthorityActive: () => true, renderIndexAuthorityPanels: () => 'NF PANEL · BNF PANEL',
    renderBrainCard: () => { throw Error('retired insight renderer must not run'); },
  };
  vm.createContext(c);
  vm.runInContext(fn('renderBrainInsights'), c);
  assert.match(c.renderBrainInsights(), /NF PANEL · BNF PANEL/);
  assert.doesNotMatch(c.renderBrainInsights(), /Kelly|F1|signals/);
});

// R2 (Codex review of PR #26): the Choose action must follow Paper authorization and capacity.
function clickHarness({ allowed = true, full = false } = {}) {
  const calls = { choose: 0, take: 0, alerts: [] };
  const four = { index: 'NF', id: 'NF_IC', type: 'IRON_CONDOR', entryEligible: true };
  const c = { String, Number, JSON, Object, Array, Math, Date, calls,
    window: { NativeBridge: { indexAuthorityChoose: () => { calls.choose++; return JSON.stringify({ status: 'CHOSEN', choice: { id: 'x' } }); } } },
    alert: m => calls.alerts.push(m), takeTrade: () => { calls.take++; },
    findCandidateById: id => (id === four.id ? four : null),
    paperObservationAuthorization: () => ({ allowed, reason: 'IDENTITY_UNAVAILABLE', analysis_only: true }),
    paperTradeCapacity: () => ({ available: !full, count: full ? 2 : 0, limit: 2 }),
  };
  vm.createContext(c);
  vm.runInContext('let PENDING_STRUCTURE_CHOICE = null;\n' + fn('chooseIndexStructureForPaper'), c);
  return c;
}
const avail4 = { ...missing, entryEligible: true, lotSize: 65, lotEvidence: { status: 'VERIFIED', reasons: [] },
  maxProfit: 5000, maxLoss: 4750, frictionCost: 258.48, frictionCostStatus: 'OK' };

test('available: Choose for Paper and Manual Paper are both enabled; click records choice then enters', () => {
  const html = harness({ choice: true }).renderAuthorityCandidateCard(avail4);
  assert.match(html, /<button class="ia-choose" onclick="chooseIndexStructureForPaper/);
  assert.match(html, /<button class="btn-paper" onclick="takeTrade/);
  assert.doesNotMatch(html, /disabled/);
  const c = clickHarness();
  assert.equal(c.chooseIndexStructureForPaper('NF', 'idx1_nf', 'NF_IC').status, 'CHOSEN');
  assert.equal(c.calls.choose, 1); assert.equal(c.calls.take, 1);
});

for (const [name, opts, re] of [['unavailable', { allowed: false }, /Paper unavailable \(IDENTITY_UNAVAILABLE\)/], ['full', { full: true }, /Paper slots full \(2\/2\)/]]) {
  test(`${name}: Choose is disabled with a visible reason and tapping cannot reach the bridge or Paper entry`, () => {
    const html = harness({ choice: true, ...opts }).renderAuthorityCandidateCard(avail4);
    assert.doesNotMatch(html, /onclick="chooseIndexStructureForPaper/);
    assert.doesNotMatch(html, /onclick="takeTrade/);
    assert.match(html, /<button class="ia-choose" disabled/);
    assert.match(html, /<button class="btn-paper" disabled/);
    assert.match(html, re);
    // Even a stale/forced tap on the handler must not call indexAuthorityChoose or takeTrade.
    const c = clickHarness(opts);
    const out = c.chooseIndexStructureForPaper('NF', 'idx1_nf', 'NF_IC');
    assert.equal(out.status, 'REJECTED');
    assert.equal(c.calls.choose, 0); assert.equal(c.calls.take, 0);
    assert.equal(c.calls.alerts.length, 1);
  });
}

// ---- Compact strategy cards v2 (Vivek, 4 Nov; Upstox list-row pattern) ----
const four4 = { ...avail4, legs: [
  { action: 'SELL', strike: 23250, option_type: 'CE', bid: 59.7, ask: 59.8 },
  { action: 'SELL', strike: 23150, option_type: 'PE', bid: 72.75, ask: 72.95 },
  { action: 'BUY', strike: 23400, option_type: 'CE', bid: 21.85, ask: 21.95 },
  { action: 'BUY', strike: 23000, option_type: 'PE', bid: 29.8, ask: 29.95 } ] };
const summaryOf = (html) => html.slice(0, html.indexOf('class="ia-details"'));
const detailsOf = (html) => html.slice(html.indexOf('class="ia-details"'));

test('v2 collapsed: line1 name + verdict, line2 legs/expiry + cost, line3 three columns, one control row', () => {
  const html = harness({ choice: true }).renderAuthorityCandidateCard(four4);
  const sum = summaryOf(html);
  assert.match(sum, /class="ia-name"><span class="ia-index">NF<\/span> IRON_CONDOR<\/h3><span class="ia-verdict ia-pos">Eligible</);
  assert.match(sum, /class="ia-side">SELL 2 \/ BUY 2 · Exp 3 Nov<\/span><span class="ia-r2v">Cost ₹258.48</);
  assert.match(sum, /<span>Max profit<\/span><strong class="ia-profit-v">₹5000.00[\s\S]*<span>Max loss<\/span><strong class="ia-loss-v">₹4750.00[\s\S]*<span>Lot<\/span><strong>65</);
  assert.match(sum, /<button class="ia-choose" onclick="chooseIndexStructureForPaper/);
  assert.match(sum, /<button type="button" class="ia-toggle" aria-expanded="false" aria-controls="ia-det-NF-NF_IC" aria-label="Show details"/);
  assert.doesNotMatch(sum, /ia-leg-strip|class="ia-leg"|btn-paper/);          // legs + Manual Paper moved to details
  assert.match(html, /<div class="ia-details" id="ia-det-NF-NF_IC" hidden>/);
  const det = detailsOf(html);
  assert.equal((det.match(/class="ia-sell">SELL /g) || []).length, 2);
  assert.equal((det.match(/class="ia-buy">BUY /g) || []).length, 2);
  assert.match(det, /<button class="btn-paper" onclick="takeTrade/);          // Manual Paper still reachable
});

test('v2: toggle expands/collapses (aria-expanded, aria-label, hidden) and state survives re-render', () => {
  const c = harness({ choice: true });
  vm.runInContext(src.slice(src.indexOf('const iaExpandedCards'), src.indexOf('\n}\n', src.indexOf('function toggleIaCardDetails(')) + 3), c);
  const attrs = { 'aria-expanded': 'false', 'aria-controls': 'ia-det-NF-NF_IC' };
  const btn = { textContent: '', getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
  const pAttrs = { hidden: '' };
  const panel = { removeAttribute: k => { delete pAttrs[k]; }, setAttribute: (k, v) => { pAttrs[k] = v; } };
  c.document = { getElementById: id => (id === 'ia-det-NF-NF_IC' ? panel : null) };
  assert.equal(c.toggleIaCardDetails(btn), true);
  assert.equal(attrs['aria-expanded'], 'true'); assert.equal(attrs['aria-label'], 'Hide details'); assert.ok(!('hidden' in pAttrs));
  assert.match(c.renderAuthorityCandidateCard(four4), /aria-expanded="true"[^>]*aria-label="Hide details"[\s\S]*id="ia-det-NF-NF_IC">/);
  assert.equal(c.toggleIaCardDetails(btn), false);
  assert.equal(attrs['aria-expanded'], 'false'); assert.ok('hidden' in pAttrs);
  assert.match(c.renderAuthorityCandidateCard(four4), /id="ia-det-NF-NF_IC" hidden>/);
});

test('v2: Paper unavailable / full keep Choose disabled with one-line visible reason; Manual Paper disabled in details', () => {
  for (const [opts, re] of [[{ allowed: false }, /Choose for Paper disabled: Paper unavailable \(IDENTITY_UNAVAILABLE\)/], [{ full: true }, /Choose for Paper disabled: Paper slots full \(2\/2\)/]]) {
    const html = harness({ choice: true, ...opts }).renderAuthorityCandidateCard(four4);
    assert.match(summaryOf(html), /<button class="ia-choose" disabled/);
    assert.match(summaryOf(html), re);
    assert.match(detailsOf(html), /<button class="btn-paper" disabled/);
    assert.doesNotMatch(html, /onclick="takeTrade|onclick="chooseIndexStructureForPaper/);
  }
  // Choose not offered: the compact row carries Manual Paper itself, with its reason visible
  const sum = summaryOf(harness({ allowed: false }).renderAuthorityCandidateCard(four4));
  assert.match(sum, /<button class="btn-paper" disabled title="IDENTITY_UNAVAILABLE">PAPER UNAVAILABLE/);
  assert.match(sum, /ia-action-reason[^>]*>Paper unavailable \(IDENTITY_UNAVAILABLE\)/);
});

test('v2: single-leg BUY name, BNF separate, lot/cost unavailable, Blocked amber; legacy EV not invented for authority', () => {
  const one = { ...missing, index: 'BNF', id: 'BNF_C', type: 'LONG_CALL', legs: [{ action: 'BUY', strike: 55500, option_type: 'CE', bid: 300, ask: 301 }] };
  const sum = summaryOf(harness().renderAuthorityCandidateCard(one));
  assert.match(sum, /<span class="ia-index">BNF<\/span> 55500 CE BUY<\/h3><span class="ia-verdict ia-amber">Blocked</);
  assert.match(sum, /Single leg BUY · Exp 3 Nov/);
  assert.match(sum, /Cost <strong class="ia-na">Unavailable|Cost Unavailable/);
  assert.match(sum, /<span>Lot<\/span><strong class="ia-na">Unavailable<\/strong>/);
  assert.doesNotMatch(sum, /EV |99999|undefined|NaN/);                         // missing.ev=99999 is legacy, ignored
});
