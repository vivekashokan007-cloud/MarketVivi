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
  'indexStructureChoiceAvailable', 'renderIndexAlerts', 'chooseIndexStructureForPaper', 'setIndexSelector'];
function ctx(sel = 'BOTH') {
  const store = { mr_index_selector_v1: sel };
  const c = { JSON, String, Object, Array, Math, Intl, Date, calls: [], alerts: [], window: {}, alert: m => c.alerts.push(m), localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  vm.createContext(c);
  vm.runInContext(`const INDEX_SELECTOR_KEY='mr_index_selector_v1'; let DAILY_REVIEW_CACHE=null; let PENDING_STRUCTURE_CHOICE=null; var bd={};\nfunction takeTrade(id, p){ calls.push(['takeTrade', id, p, PENDING_STRUCTURE_CHOICE]); }\n${FNS.map(fn).join('\n')}`, c);
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
