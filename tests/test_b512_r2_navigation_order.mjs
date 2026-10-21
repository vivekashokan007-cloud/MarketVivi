// b512 R2 regressions for Codex R2 (fresh native destination vs saved-state restore) and R3 (stale restore-scroll
// callbacks). Behavioural: runs the REAL switchTab + b512 restore/nav/persistence functions from app.js in a VM with
// a fake DOM, a deferred requestAnimationFrame/setTimeout queue and real event listeners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function switchTab(tabName)');
const end = app.indexOf('// EVENING CLOSE');
assert.ok(start > 0 && end > start, 'switchTab + b512 block present');
const block = app.slice(start, app.lastIndexOf('// ═══', end));
const TABS = ['market', 'positions', 'brain', 'ml', 'settings'];
const NOW = Date.parse('2026-10-21T05:00:00Z');   // 10:30 IST
const saved = (o = {}) => JSON.stringify({ v: 1, tab: 'ml', scroll: { ml: 1500 }, ts: NOW - 120_000, date: '2026-10-21', ...o });

function page({ stored = null, today = '2026-10-21' } = {}) {
  const store = new Map(stored ? [['mr_ui_state_v1', stored]] : []);
  const queue = []; const listeners = {}; const scrolls = [];
  const el = tab => ({ dataset: { tab }, id: `tab-${tab}`, classList: { toggle() {} } });
  const ctx = {
    STATE: { activeTab: 'market' }, API: { todayIST: () => today }, console: { info() {}, warn() {}, log() {} },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    document: { querySelectorAll: () => TABS.map(el), scrollingElement: { scrollTop: 0 }, addEventListener() {}, visibilityState: 'visible' },
    requestAnimationFrame: f => queue.push(f), setTimeout: f => { queue.push(f); return queue.length; }, Date: { now: () => NOW, parse: Date.parse },
  };
  ctx.window = { scrollY: 0, scrollTo: (x, y) => scrolls.push({ y, tab: ctx.STATE.activeTab }),
    addEventListener: (ev, f) => (listeners[ev] ||= []).push(f) };
  vm.createContext(ctx);
  vm.runInContext(block.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  const run = src => vm.runInContext(src, ctx);
  return {
    ctx, store, scrolls, run,
    // exactly what MainActivity's navigation script does on this head (LaunchNavigation.script / reviewed handleIntent)
    nativeOpenTab: t => run(`(typeof b512NativeNav==='function') ? b512NativeNav('${t}') : (typeof switchTab==='function' && switchTab('${t}'))`),
    userTap: t => run(`(typeof b512UserNav==='function') ? b512UserNav('${t}') : switchTab('${t}')`),
    // DOMContentLoaded tail: restore, open-trades default, bind persistence
    boot: (openTrades = false) => run(`(function(){ var p = b512RestoreUiState(${JSON.stringify(TABS)});
        if (!p && ${openTrades}) switchTab('positions'); b512BindUiStatePersistence(); return p ? p.tab : null; })()`),
    flush: () => { while (queue.length) queue.shift()(); },
    fire: ev => (listeners[ev] || []).forEach(f => f()),
  };
}

// ---------- R2 ----------
test('R2: warm onNewIntent during slow init beats a fresh same-day saved tab', () => {
  const p = page({ stored: saved() });
  p.nativeOpenTab('positions');           // after app.js executed, before DOMContentLoaded restore
  p.boot(); p.flush();
  assert.equal(p.ctx.STATE.activeTab, 'positions');
  assert.equal(p.scrolls.length, 0, 'saved ML offset must not be applied to the native destination');
  assert.equal(JSON.parse(p.store.get('mr_ui_state_v1')).tab, 'positions');
});

test('R2: user tab tap before restore is kept too', () => {
  const p = page({ stored: saved() });
  p.userTap('brain'); p.boot(); p.flush();
  assert.equal(p.ctx.STATE.activeTab, 'brain');
});

test('R2: cold-launch destination delivered after restore switches immediately', () => {
  const p = page({ stored: saved() });
  p.boot(); p.nativeOpenTab('positions'); p.flush();
  assert.equal(p.ctx.STATE.activeTab, 'positions');
  assert.equal(p.scrolls.filter(s => s.tab === 'positions').length, 0);
});

test('R2: ordinary restore with no new request restores saved tab and scroll', () => {
  const p = page({ stored: saved() });
  assert.equal(p.boot(), 'ml'); p.flush();
  assert.equal(p.ctx.STATE.activeTab, 'ml');
  assert.ok(p.scrolls.some(s => s.y === 1500 && s.tab === 'ml'));
});

test('R2 fallbacks: no saved / stale / new IST date -> default (or open-trades); native still wins', () => {
  for (const [name, opts] of [['none', {}], ['stale', { stored: saved({ ts: NOW - 7 * 3600_000 }) }], ['new IST date', { stored: saved({ date: '2026-10-20' }) }]]) {
    const a = page(opts); assert.equal(a.boot(), null, name); assert.equal(a.ctx.STATE.activeTab, 'market', name);
    const b = page(opts); b.boot(true); assert.equal(b.ctx.STATE.activeTab, 'positions', `${name} open-trades default`);
    const c = page(opts); c.nativeOpenTab('brain'); c.boot(true); c.flush(); assert.equal(c.ctx.STATE.activeTab, 'brain', `${name} + native`);
  }
});

test('R2: native nav rejects unsafe/unknown tabs and only navigates', () => {
  const p = page({ stored: saved() });
  p.boot();
  if (p.run(`typeof b512NativeNav`) === 'function') {
    assert.equal(p.run(`b512NativeNav("x');alert(1);('")`), 'rejected');
    assert.equal(p.run(`b512NativeNav('nosuchtab')`), 'rejected');
    assert.equal(p.ctx.STATE.activeTab, 'ml');
    const src = block.slice(block.indexOf('function b512NativeNav'), block.indexOf('function b512UiStateRestorePlan'));
    assert.doesNotMatch(src, /placeOrder|sendOrder|execute|submit|AndroidBridge|NativeBridge|getOpenTrades/);
  } else assert.fail('b512NativeNav missing');
});

// ---------- R3 ----------
test('R3: selecting another tab before queued restore callbacks fire -> no scroll on the new tab', () => {
  const p = page({ stored: saved() });
  p.boot();                       // rAF + 400ms timeout queued for ML 1500
  p.userTap('positions');
  p.flush();
  assert.deepEqual(p.scrolls.filter(s => s.tab === 'positions'), []);
});

test('R3: same-tab manual touch/scroll before callbacks supersedes the restore scroll', () => {
  const p = page({ stored: saved() });
  p.boot(); p.fire('touchstart'); p.flush();
  assert.deepEqual(p.scrolls, []);
});

test('R3: native navigation after restore also cancels pending restore scroll', () => {
  const p = page({ stored: saved() });
  p.boot(); p.nativeOpenTab('brain'); p.flush();
  assert.deepEqual(p.scrolls.filter(s => s.tab === 'brain'), []);
});
