// b515 (CDX-GROK-BACKGROUND-RESUME-1): background Activity destruction -> same-process re-creation -> a NEW WebView
// document boots app.js again. These tests run the REAL app.js navigation (b512) + draft (b515) functions in fresh VM
// "pages" that share one localStorage, i.e. what survives a WebView re-creation. Local/CI evidence only, not a phone pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const dStart = app.indexOf('// b515: unsaved-input drafts');
const dEnd = app.indexOf('// ═══ TAB SWITCHING ═══');
const nStart = app.indexOf('function switchTab(tabName)');
const nEnd = app.lastIndexOf('// ═══', app.indexOf('// EVENING CLOSE'));
assert.ok(dStart > 0 && dEnd > dStart && nStart > dEnd && nEnd > nStart, 'b515 + b512 blocks present');
const draftBlock = app.slice(dStart, dEnd);
const navBlock = app.slice(nStart, nEnd);
const SRC = (draftBlock + '\n' + navBlock).replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');

const TABS = ['market', 'oi', 'strategies', 'positions', 'ml', 'logs'];
const TODAY = '2026-10-26';
const T0 = Date.parse('2026-10-26T03:46:37Z');          // 09:16:37 IST, the recorded background time
const MORNING = ['in-fii-cash', 'in-fii-short', 'in-dii-cash', 'in-fii-idx-fut', 'in-fii-stk-fut', 'in-dow-close', 'in-crude-settle', 'in-gift-spot'];
const EVENING = ['in-eve-dow', 'in-eve-crude', 'in-eve-gift'];

/** One WebView document. `storage` is shared across pages (DOM storage survives Activity re-creation). */
function page(storage, { now = T0, today = TODAY, locked = false, maxScroll = 0 } = {}) {
  const events = { dispatched: 0 }; const docListeners = {}; const winListeners = {}; const scrolls = []; const logs = []; const timers = [];
  const els = {};
  for (const id of [...MORNING, ...EVENING, 'execution-proxy-url', 'mt-sell']) els[id] = { id, tagName: 'INPUT', value: '', disabled: false, dispatchEvent() { events.dispatched++; } };
  els['in-upstox-bias'] = { id: 'in-upstox-bias', tagName: 'SELECT', value: '', disabled: false,
    options: ['', 'Bullish', 'Bearish', 'Neutral'].map(value => ({ value })), dispatchEvent() { events.dispatched++; } };
  const tabEl = tab => ({ dataset: { tab }, id: `tab-${tab}`, classList: { toggle() {} } });
  const win = { scrollY: 0, _max: maxScroll,
    scrollTo(x, y) { win.scrollY = Math.max(0, Math.min(y, win._max)); scrolls.push({ y, at: win.scrollY, tab: ctx.STATE.activeTab }); },
    addEventListener: (ev, f) => (winListeners[ev] ||= []).push(f) };
  const ctx = {
    STATE: { activeTab: 'market' }, API: { todayIST: () => today },
    console: { info: (...a) => logs.push(a.join(' ')), warn() {}, log() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    document: { querySelectorAll: () => TABS.map(tabEl), getElementById: id => els[id] || null, scrollingElement: {}, visibilityState: 'visible',
      addEventListener: (ev, f) => (docListeners[ev] ||= []).push(f) },
    performance: { getEntriesByType: () => [{ type: 'back_forward' }] },
    requestAnimationFrame: f => timers.push(f), setTimeout: f => { timers.push(f); return timers.length; },
    Date: { now: () => now, parse: Date.parse }, hasLockedMorningForToday: () => locked,
  };
  ctx.window = win;
  // Any bridge access during restore is a contract violation: restoring a screen must never call native.
  for (const name of ['NativeBridge', 'AndroidBridge']) Object.defineProperty(ctx, name, { get() { throw new Error(`${name} touched during restore`); } });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const run = s => vm.runInContext(s, ctx);
  const p = {
    ctx, els, win, scrolls, logs, events, run,
    // the DOMContentLoaded order on this head: early nav restore + bind; authoritative restores; drafts; render; scroll
    bootEarly: () => run(`(function(){ var v = ${JSON.stringify(TABS)}; var plan = b512RestoreUiState(v); b512BindUiStatePersistence(); return plan ? plan.tab : null; })()`),
    bootDrafts: () => JSON.parse(run('JSON.stringify(b515RestoreDrafts())') || 'null') && run('b515BindDraftPersistence(), JSON.stringify(b515LastDraftSummary)'),
    render: (height) => { win._max = height; },
    schedule: () => run('b512SchedulePendingScroll(5, 1)'),
    flushTimers: () => { let n = 0; while (timers.length && n++ < 200) timers.shift()(); },
    tap: tab => run(`b512UserNav('${tab}')`),
    scrollTo: y => { win.scrollTo(0, y); (winListeners.scroll || []).forEach(f => f()); p.flushTimers(); },
    type: (id, v) => { els[id].value = v; (docListeners.input || []).forEach(f => f({ type: 'input', target: els[id] })); },
    touch: () => (winListeners.touchstart || []).forEach(f => f()),
    nativePause: () => run(`window.mrUiFlush('native_pause')`),
    hidden: () => { ctx.document.visibilityState = 'hidden'; (docListeners.visibilitychange || []).forEach(f => f()); },
    summary: phase => run(`b515RestoreSummaryLine('${phase}')`),
  };
  return p;
}

function firstSession(storage, opts) {
  const p = page(storage, opts);
  p.bootEarly(); p.bootDrafts(); p.render(6000);
  p.tap('positions'); p.scrollTo(900);
  p.type('in-fii-cash', '-1200'); p.type('in-dii-cash', '5706'); p.type('in-eve-gift', '23300');
  p.els['in-upstox-bias'].value = 'Bearish'; p.type('in-upstox-bias', 'Bearish');
  return p;
}

test('recreation: tab immediately, scroll once content exists, unsaved inputs back; no event, no bridge, no action', () => {
  const storage = new Map();
  const before = firstSession(storage);
  before.nativePause();                                    // b515 APK onPause hook (old APK: visibilitychange/pagehide)
  // Activity destroyed in background; ~25 min later the same process re-creates it with a NEW WebView document.
  const after = page(storage, { now: T0 + 25 * 60_000, maxScroll: 0 });
  assert.equal(after.bootEarly(), 'positions');
  assert.equal(after.ctx.STATE.activeTab, 'positions', 'tab is right before any network await');
  after.flushTimers();                                     // early rAF/400ms try while the page is still short
  assert.equal(after.win.scrollY, 0);
  assert.equal(JSON.parse(storage.get('mr_ui_state_v1')).scroll.positions, 900, 'pending offset not overwritten by the short page');
  const sum = JSON.parse(after.bootDrafts());
  assert.equal(sum.status, 'ok'); assert.equal(sum.applied, 4);
  assert.equal(after.els['in-fii-cash'].value, '-1200');
  assert.equal(after.els['in-dii-cash'].value, '5706');
  assert.equal(after.els['in-eve-gift'].value, '23300');
  assert.equal(after.els['in-upstox-bias'].value, 'Bearish');
  assert.equal(after.events.dispatched, 0, 'restore dispatches no input/change event (no auto-save, no bridge write)');
  after.render(5000); after.schedule(); after.flushTimers();
  assert.equal(after.win.scrollY, 900, 'restored offset applied after late render');
  assert.ok(after.logs.some(l => l.includes('scroll applied tab=positions y=900')));
});

test('authoritative values win: saved/locked morning record and a newer evening reference are never overwritten', () => {
  const storage = new Map();
  firstSession(storage).hidden();
  // (a) authority changed since the draft was typed (e.g. Lock & Scan saved -1500 from another path)
  const a = page(storage, { now: T0 + 60_000 });
  a.bootEarly(); a.els['in-fii-cash'].value = '-1500';     // what restoreMorningData() put there
  const sa = JSON.parse(a.bootDrafts());
  assert.equal(a.els['in-fii-cash'].value, '-1500');
  assert.equal(sa.skipped['in-fii-cash'], 'authority_changed');
  // (b) morning locked today -> all morning drafts skipped, evening draft still restored
  const storage2 = new Map(); firstSession(storage2).hidden();
  const b = page(storage2, { now: T0 + 60_000, locked: true });
  b.bootEarly(); const sb = JSON.parse(b.bootDrafts());
  assert.equal(b.els['in-fii-cash'].value, ''); assert.equal(sb.skipped['in-fii-cash'], 'locked');
  assert.equal(b.els['in-eve-gift'].value, '23300');
  // (c) a field disabled by reconcileNativeSessionUi is skipped as locked
  const storage3 = new Map(); firstSession(storage3).hidden();
  const c = page(storage3, { now: T0 + 60_000 }); c.bootEarly(); c.els['in-dii-cash'].disabled = true;
  assert.equal(JSON.parse(c.bootDrafts()).skipped['in-dii-cash'], 'locked');
});

test('stale session / cold start next day: default screen, drafts discarded, nothing resurrected', () => {
  const storage = new Map();
  firstSession(storage).hidden();
  const next = page(storage, { now: T0 + 24 * 3600_000, today: '2026-10-27' });
  assert.equal(next.bootEarly(), null);
  assert.equal(next.ctx.STATE.activeTab, 'market');
  const s = JSON.parse(next.bootDrafts());
  assert.equal(s.status, 'stale_date'); assert.equal(s.applied, 0);
  assert.equal(next.els['in-fii-cash'].value, '');
  assert.equal(storage.has('mr_ui_drafts_v1'), false, 'stale drafts removed');
  assert.match(next.summary('boot'), /state=stale_date .*drafts=stale_date\/applied:0/);
});

test('malformed / missing / hostile saved state: safe usable default, never throws', () => {
  for (const [nav, drafts] of [['{bad', '{bad'], ['null', 'null'], [JSON.stringify({ v: 1, tab: 'javascript:x', ts: T0, date: TODAY }),
    JSON.stringify({ v: 1, date: TODAY, ts: T0, fields: { 'execution-proxy-url': { v: 'https://evil', base: '' }, 'mt-sell': { v: '55500', base: '' },
      'in-fii-cash': { v: '<img src=x>', base: '' }, 'in-upstox-bias': { v: 'Buy', base: '' } } })]]) {
    const storage = new Map([['mr_ui_state_v1', nav], ['mr_ui_drafts_v1', drafts]]);
    const p = page(storage);
    assert.doesNotThrow(() => p.bootEarly());
    assert.equal(p.ctx.STATE.activeTab, 'market');
    const s = JSON.parse(p.bootDrafts());
    assert.equal(s.applied, 0);
    assert.equal(p.els['execution-proxy-url'].value, ''); assert.equal(p.els['mt-sell'].value, '');
    assert.equal(p.els['in-fii-cash'].value, ''); assert.equal(p.els['in-upstox-bias'].value, '');
    if (s.status === 'ok') {
      assert.equal(s.skipped['execution-proxy-url'], 'not_allowlisted'); assert.equal(s.skipped['mt-sell'], 'not_allowlisted');
      assert.equal(s.skipped['in-fii-cash'], 'malformed'); assert.equal(s.skipped['in-upstox-bias'], 'not_an_option');
    }
  }
});

test('repeated background returns: one storage record, stable authoritative base, idempotent', () => {
  const storage = new Map();
  firstSession(storage).nativePause();
  let last = null;
  for (let i = 1; i <= 3; i++) {
    const p = page(storage, { now: T0 + i * 20 * 60_000, maxScroll: 6000 });
    assert.equal(p.bootEarly(), 'positions');
    p.bootDrafts(); p.schedule(); p.flushTimers();
    assert.equal(p.win.scrollY, 900); assert.equal(p.els['in-fii-cash'].value, '-1200');
    p.hidden();
    last = JSON.parse(storage.get('mr_ui_drafts_v1'));
    assert.equal(last.fields['in-fii-cash'].base, '', 'base stays the authoritative value, not the restored draft');
  }
  assert.deepEqual(Object.keys(last.fields).sort(), ['in-dii-cash', 'in-eve-gift', 'in-fii-cash', 'in-upstox-bias']);
  assert.deepEqual([...storage.keys()].sort(), ['mr_ui_drafts_v1', 'mr_ui_state_v1']);
});

test('user intent during boot wins: touch or tab tap supersedes the pending restore scroll', () => {
  const storage = new Map(); firstSession(storage).hidden();
  const a = page(storage, { now: T0 + 60_000 }); a.bootEarly(); a.touch(); a.render(6000); a.schedule(); a.flushTimers();
  assert.equal(a.win.scrollY, 0);
  const b = page(storage, { now: T0 + 60_000 }); b.bootEarly(); b.tap('ml'); b.render(6000); b.schedule(); b.flushTimers();
  assert.equal(b.ctx.STATE.activeTab, 'ml'); assert.equal(b.scrolls.filter(s => s.tab === 'ml').length, 0);
});

test('typing clears the draft when the value returns to the authoritative one; diagnostics carry no values', () => {
  const storage = new Map();
  const p = firstSession(storage);
  p.type('in-fii-cash', ''); p.type('in-dii-cash', ''); p.type('in-eve-gift', ''); p.els['in-upstox-bias'].value = ''; p.type('in-upstox-bias', '');
  assert.equal(storage.has('mr_ui_drafts_v1'), false);
  firstSession(storage).hidden();
  const q = page(storage, { now: T0 + 60_000 }); q.bootEarly(); q.bootDrafts();
  const line = q.summary('boot');
  assert.match(line, /^\[ui-restore\] b515 phase=boot nav=back_forward state=ok tab=positions scrollPending=900 drafts=ok\/applied:4 skipped=-$/);
  assert.doesNotMatch(line, /1200|5706|23300|Bearish/);
});

test('source contract: restore path never touches native, events, trades, mode or Lock & Scan', () => {
  assert.doesNotMatch(draftBlock, /NativeBridge|AndroidBridge|dispatchEvent|\.click\(|submit|lockAndScan|startWatchLoop|setTradeMode|placeOrder|insertTrade|DB\./);
  const allow = draftBlock.slice(draftBlock.indexOf('const B515_DRAFT_FIELDS'), draftBlock.indexOf('];', draftBlock.indexOf('const B515_DRAFT_FIELDS')));
  assert.doesNotMatch(allow, /execution-proxy-url|token|proxy|mt-|theme|sandbox/i);
  const boot = app.slice(app.indexOf("document.addEventListener('DOMContentLoaded'"));
  const i = (s) => { const k = boot.indexOf(s); assert.ok(k > 0, s); return k; };
  assert.ok(i('b512RestoreUiState(b512ValidTabs)') < i('await '));
  assert.ok(i('restoreEveningClose(cloudConfig)') < i('b515RestoreDrafts()'));
  assert.ok(i('b515RestoreDrafts()') < i('b515BindDraftPersistence()'));
  assert.ok(i("renderAll(); } catch (e) { console.warn('[boot] renderAll failed:'") < i('b512SchedulePendingScroll()'));
  assert.match(app, /window\.mrUiFlush = mrUiFlush;/);
});

// Paired-repo contract: the EXACT script the b515 APK evaluates in onPause (BackgroundResume.FLUSH_SCRIPT) reaches this
// page's flush and persists the screen + drafts. Skipped only when the paired Marketapp ref predates b515.
const BR = process.env.MARKETAPP_DIR ? join(process.env.MARKETAPP_DIR, 'app/src/main/java/com/marketradar/app/BackgroundResume.kt') : '';
test('native onPause FLUSH_SCRIPT (paired Marketapp) calls window.mrUiFlush and persists; old page returns absent', { skip: !(BR && existsSync(BR)) && 'paired Marketapp has no BackgroundResume.kt' }, () => {
  const m = readFileSync(BR, 'utf8').match(/const val FLUSH_SCRIPT\s*=\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(m, 'FLUSH_SCRIPT literal found');
  const script = JSON.parse('"' + m[1] + '"');
  const storage = new Map();
  const p = firstSession(storage);
  storage.delete('mr_ui_state_v1'); storage.delete('mr_ui_drafts_v1');
  assert.equal(p.run(script), 'ok');
  assert.equal(JSON.parse(storage.get('mr_ui_state_v1')).tab, 'positions');
  assert.equal(JSON.parse(storage.get('mr_ui_drafts_v1')).fields['in-fii-cash'].v, '-1200');
  const old = vm.createContext({ window: {} });                       // a pre-b515 page (no mrUiFlush): harmless no-op
  assert.equal(vm.runInContext(script, old), 'absent');
});
