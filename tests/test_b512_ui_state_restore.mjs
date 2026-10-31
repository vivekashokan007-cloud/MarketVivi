// b512: tab + scroll survive an Activity/WebView re-creation; nothing that could re-execute an action is restored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf("const B512_UI_STATE_KEY");
const end = app.indexOf("function b512BindUiStatePersistence");
assert.ok(start > 0 && end > start, 'b512 block present');
const block = app.slice(start, end);
const TABS = ['market', 'positions', 'brain', 'settings'];

function sandbox({ today = '2026-10-21', now = Date.parse('2026-10-21T05:00:00Z'), stored = null, scrollY = 0 } = {}) {
  const store = new Map(stored ? [['mr_ui_state_v1', stored]] : []);
  const calls = { switchTab: [], scrollTo: [] };
  const ctx = {
    STATE: { activeTab: 'market' }, API: { todayIST: () => today }, console: { info() {}, warn() {} },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    window: { scrollY, scrollTo: (x, y) => calls.scrollTo.push(y) }, document: { scrollingElement: { scrollTop: scrollY } },
    requestAnimationFrame: f => f(), setTimeout: f => f(), Date: { now: () => now, parse: Date.parse },
  };
  ctx.switchTab = (t) => { calls.switchTab.push(t); ctx.STATE.activeTab = t; vm.runInContext('b512SaveUiState()', ctx); };
  vm.createContext(ctx);
  vm.runInContext(block.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return { ctx, store, calls, run: src => vm.runInContext(src, ctx) };
}

test('restore plan accepts only a same-IST-day, fresh, known tab', () => {
  const { run } = sandbox();
  const now = Date.parse('2026-10-21T05:00:00Z');
  const ok = { v: 1, tab: 'positions', scroll: { positions: 812.4 }, ts: now - 60_000, date: '2026-10-21' };
  run(`globalThis.P = (r, n) => b512UiStateRestorePlan(r, '2026-10-21', n, ${JSON.stringify(TABS)})`);
  const P = (r, n = now) => run(`JSON.stringify(P(${JSON.stringify(JSON.stringify(r))}, ${n}))`);
  assert.equal(P(ok), JSON.stringify({ tab: 'positions', scrollY: 812 }));
  assert.equal(P({ ...ok, date: '2026-10-20' }), 'null');           // new session -> default screen
  assert.equal(P({ ...ok, ts: now - 7 * 3600 * 1000 }), 'null');    // stale
  assert.equal(P({ ...ok, ts: now + 60_000 }), 'null');             // clock skew / future
  assert.equal(P({ ...ok, tab: 'javascript:alert(1)' }), 'null');   // unknown tab
  assert.equal(P({ ...ok, v: 2 }), 'null');
  assert.equal(run(`JSON.stringify(b512UiStateRestorePlan('{bad', '2026-10-21', 1, ['market']))`), 'null');
});

test('recreation: saved tab and scroll are restored and win over the default', () => {
  const now = Date.parse('2026-10-21T05:00:00Z');
  const stored = JSON.stringify({ v: 1, tab: 'brain', scroll: { brain: 1500 }, ts: now - 120_000, date: '2026-10-21' });
  const { run, calls, store } = sandbox({ stored, now, scrollY: 0 });
  const plan = run(`JSON.stringify(b512RestoreUiState(${JSON.stringify(TABS)}))`);
  assert.equal(plan, JSON.stringify({ tab: 'brain', scrollY: 1500 }));
  assert.deepEqual(calls.switchTab, ['brain']);
  assert.ok(calls.scrollTo.includes(1500));
  // the restore switch must not overwrite the saved offset with the fresh page's scroll 0
  assert.equal(JSON.parse(store.get('mr_ui_state_v1')).scroll.brain, 1500);
});

test('saving before restore is a no-op, then tab and scroll are recorded', () => {
  const { run, store, ctx } = sandbox({ scrollY: 640 });
  run('b512SaveUiState()');
  assert.equal(store.has('mr_ui_state_v1'), false);
  run(`b512RestoreUiState(${JSON.stringify(TABS)})`);            // nothing stored -> no plan, enables saving
  ctx.switchTab('positions'); run('b512SaveUiState()');           // scroll event while on positions
  const saved = JSON.parse(store.get('mr_ui_state_v1'));
  assert.equal(saved.tab, 'positions'); assert.equal(saved.scroll.positions, 640); assert.equal(saved.date, '2026-10-21');
  assert.deepEqual(Object.keys(saved).sort(), ['date', 'scroll', 'tab', 'ts', 'v']);  // navigation state only
});

test('boot wiring: restored tab wins, open-trades default otherwise; no action replay', () => {
  const boot = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded'"));
  // b515: the restore moved BEFORE the first network await; the open-trades default still only applies without a
  // restored plan (and now also only if nobody navigated during boot).
  assert.ok(boot.indexOf('const b512Plan = b512RestoreUiState(b512ValidTabs);') > 0);
  assert.ok(boot.indexOf('const b512Plan = b512RestoreUiState(b512ValidTabs);') < boot.indexOf('await '), 'restore precedes the first await');
  assert.match(boot, /if \(!b512Plan && b512NavGen === b515NavGenAfterRestore && readNativeJson\('getOpenTrades', \[\]\)\.length > 0\) \{\s*switchTab\('positions'\);/);
  assert.match(boot, /b512BindUiStatePersistence\(\);/);
  assert.match(app, /function switchTab\(tabName\) \{[\s\S]*?STATE\.activeTab = tabName;\s*b512NavGen\+\+;[^\n]*\n\s*b512SaveUiState\(\);\s*\}/);
  assert.doesNotMatch(block, /placeOrder|sendOrder|execute|submit|getOpenTrades|AndroidBridge|\.value\b/);
});
