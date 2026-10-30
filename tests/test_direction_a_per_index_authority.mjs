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
  'renderIndexAuthorityPanel', 'renderIndexAuthorityPanels', 'renderDailyReviewCard', 'iaTodayIst'];
function ctx(sel = 'BOTH') {
  const store = { mr_index_selector_v1: sel };
  const c = { JSON, String, Object, Array, Math, Intl, Date, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  vm.createContext(c);
  vm.runInContext(`const INDEX_SELECTOR_KEY='mr_index_selector_v1'; let DAILY_REVIEW_CACHE=null;\n${FNS.map(fn).join('\n')}`, c);
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
