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

// Constructable Date whose clock is the page's (tests may reassign .now, as Codex's review snippet does).
function fakeDate(now) {
  const R = Date;
  class D extends R { constructor(...a) { if (a.length) super(...a); else super(D.now()); } }
  D.now = () => now; D.parse = R.parse; D.UTC = R.UTC;
  return D;
}

/** One WebView document. `storage` is shared across pages (DOM storage survives Activity re-creation). */
function page(storage, { now = T0, today = TODAY, locked = false, maxScroll = 0, bridge = null, withSave = false } = {}) {
  const events = { dispatched: 0 }; const docListeners = {}; const winListeners = {}; const scrolls = []; const logs = []; const timers = [];
  const els = {};
  // like a DOM control, .value always reads back as a string (restoreEveningClose assigns numbers)
  const mkEl = (o) => { let v = ''; return Object.defineProperty({ ...o, disabled: false, dispatchEvent() { events.dispatched++; } }, 'value',
    { get: () => v, set: x => { v = String(x ?? ''); }, enumerable: true }); };
  for (const id of [...MORNING, ...EVENING, 'execution-proxy-url', 'mt-sell']) els[id] = mkEl({ id, tagName: 'INPUT' });
  els['in-upstox-bias'] = mkEl({ id: 'in-upstox-bias', tagName: 'SELECT', options: ['', 'Bullish', 'Bearish', 'Neutral'].map(value => ({ value })) });
  const tabEl = tab => ({ dataset: { tab }, id: `tab-${tab}`, classList: { toggle() {} } });
  const win = { scrollY: 0, _max: maxScroll,
    scrollTo(x, y) { win.scrollY = Math.max(0, Math.min(y, win._max)); scrolls.push({ y, at: win.scrollY, tab: ctx.STATE.activeTab }); },
    addEventListener: (ev, f) => (winListeners[ev] ||= []).push(f) };
  const ctx = {
    STATE: { activeTab: 'market' }, API: { todayIST: () => today },
    console: { info: (...a) => logs.push(a.join(' ')), warn() {}, log() {}, error() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    document: { querySelectorAll: () => TABS.map(tabEl), getElementById: id => els[id] || null, scrollingElement: {}, visibilityState: 'visible',
      addEventListener: (ev, f) => (docListeners[ev] ||= []).push(f) },
    performance: { getEntriesByType: () => [{ type: 'back_forward' }] },
    requestAnimationFrame: f => timers.push(f), setTimeout: f => { timers.push(f); return timers.length; },
    Date: fakeDate(now), hasLockedMorningForToday: () => locked,
  };
  ctx.window = win;
  // Any bridge access during restore is a contract violation: restoring a screen must never call native.
  // (bridge: the save-path tests give the page a recording NativeBridge for the explicit user Save only.)
  for (const name of ['NativeBridge', 'AndroidBridge']) {
    if (name === 'NativeBridge' && bridge) ctx.NativeBridge = bridge;
    else Object.defineProperty(ctx, name, { get() { throw new Error(`${name} touched during restore`); } });
  }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (withSave) vm.runInContext(SAVE_SRC, ctx);
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
    pagehide: () => (winListeners.pagehide || []).forEach(f => f()),
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
    JSON.stringify({ v: 2, date: TODAY, ts: T0, fields: { 'execution-proxy-url': { v: 'https://evil', base: '', d: TODAY, t: T0 }, 'mt-sell': { v: '55500', base: '', d: TODAY, t: T0 },
      'in-fii-cash': { v: '<img src=x>', base: '', d: TODAY, t: T0 }, 'in-upstox-bias': { v: 'Buy', base: '', d: TODAY, t: T0 } } })]]) {
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

// ═══ R1/R2 corrections (Codex b515 review, 27 Oct 2026) ═══
// The REAL save/restore path: saveEveningClose + restoreEveningClose and the helpers they call, extracted from app.js.
function fnSrc(name) {
  const k = app.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(k >= 0, `function ${name} present`);
  let i = app.indexOf('{', app.indexOf(')', k)), depth = 0;
  for (; i < app.length; i++) { if (app[i] === '{') depth++; else if (app[i] === '}' && --depth === 0) break; }
  return app.slice(k, i + 1);
}
function constSrc(name) {
  const k = app.search(new RegExp(`^const ${name} = `, 'm'));
  assert.ok(k >= 0, `${name} present`);
  return app.slice(k, app.indexOf('];', k) + 2).replace(/^const /, 'var ');
}
const SAVE_SRC = [constSrc('EVENING_NUMERIC_FIELDS'), 'var b507AuthoritySeen = false;', 'var B507_REQUIRED_APK = "b507";',
  ...['safeParseNB', 'callNativeJson', 'b507FmtIstTime', 'b507UnavailableAuthority', 'b507ReadNativeInputState', 'b507CheckedAck',
    'normalizeNumericText', 'parseStrictNumber', 'collectStrictNumericInputs', 'saveEveningClose', 'restoreEveningClose'].map(fnSrc),
  'function b507InvalidateCurrentAuthority() {}', 'function renderAll() {}'].join('\n');

const DAY2 = '2026-10-27';
const T1 = T0 + 24 * 3600000;                                // 27 Oct 09:16:37 IST

// Codex snippet 1 (verbatim, plus ONE line: the snippet's comment says a successful save acknowledged 23100 but issues
// no ack; the draft-subsystem ack hook the save path now calls is invoked there. The real save path is tested below).
test('review: later unsaved edit after an acknowledged evening save', () => {
  const storage = new Map();
  const before = page(storage);
  before.bootEarly();
  before.els['in-eve-gift'].value = '23000';
  before.bootDrafts();
  before.type('in-eve-gift', '23100');
  // Successful save acknowledges 23100. Current saveEveningClose
  // leaves that value in the form and has no draft-base update hook.
  before.run(`b515DraftsAcknowledged([{ id: 'in-eve-gift', stored: 23100, sent: '23100' }], 'saved_evening')`);   // [Grok R2: the ack]
  before.type('in-eve-gift', '23200');
  before.nativePause();

  const after = page(storage, { now: T0 + 60000 });
  after.bootEarly();
  after.els['in-eve-gift'].value = '23100';
  after.bootDrafts();
  assert.equal(after.els['in-eve-gift'].value, '23200');
});

// Codex snippet 2 (verbatim)
test('review: hidden flush cannot redate yesterday drafts', () => {
  const storage = new Map();
  const old = firstSession(storage);
  old.ctx.API.todayIST = () => '2026-10-27';
  old.ctx.Date.now = () => T0 + 24 * 3600000;
  old.hidden();

  const next = page(storage, {
    now: T0 + 24 * 3600000 + 60000,
    today: '2026-10-27'
  });
  next.bootEarly();
  next.bootDrafts();
  assert.equal(next.els['in-fii-cash'].value, '');
  assert.equal(next.els['in-eve-gift'].value, '');
});

function rollOver(p, now = T1) { p.ctx.API.todayIST = () => DAY2; p.ctx.Date.now = () => now; }

for (const [how, flush] of [['hidden', p => p.hidden()], ['native onPause', p => p.nativePause()], ['pagehide', p => p.pagehide()]]) {
  test(`R1: live document crosses IST midnight, then a ${how} flush: nothing from yesterday is written as today's`, () => {
    const storage = new Map();
    const old = firstSession(storage);
    old.nativePause();                                         // a legitimate same-day flush on 26 Oct
    assert.equal(JSON.parse(storage.get('mr_ui_drafts_v1')).date, TODAY);
    rollOver(old);
    flush(old);                                                // only the flush, no edit
    assert.equal(storage.has('mr_ui_drafts_v1'), false, 'yesterday\'s drafts are not re-serialised under 27 Oct');
    assert.ok(old.logs.some(l => /b515 drafts date rollover from=2026-10-26 to=2026-10-27 dropped=4/.test(l)));
    assert.equal(old.els['in-fii-cash'].value, '-1200', 'the visible form is left alone (no auto-clear, no save)');
    const next = page(storage, { now: T1 + 60000, today: DAY2 });
    next.bootEarly();
    const s = JSON.parse(next.bootDrafts());
    assert.equal(s.applied, 0);
    for (const id of ['in-fii-cash', 'in-dii-cash', 'in-eve-gift', 'in-upstox-bias']) assert.equal(next.els[id].value, '', id);
    assert.equal(next.events.dispatched, 0);
  });
}

test('R1: a genuine new-day edit after rollover is kept; it does not redate untouched old fields', () => {
  const storage = new Map();
  const old = firstSession(storage);                          // 26 Oct: fii -1200, dii 5706, gift 23300, bias Bearish
  rollOver(old);
  old.type('in-eve-gift', '23400');                           // the user's real edit on 27 Oct
  old.nativePause();
  const rec = JSON.parse(storage.get('mr_ui_drafts_v1'));
  assert.equal(rec.date, DAY2);
  assert.deepEqual(Object.keys(rec.fields), ['in-eve-gift'], 'only the field edited today is a draft');
  assert.deepEqual({ d: rec.fields['in-eve-gift'].d, t: rec.fields['in-eve-gift'].t }, { d: DAY2, t: T1 });
  old.ctx.Date.now = () => T1 + 30 * 60000;                   // a later flush keeps the edit's origin time
  old.hidden();
  assert.equal(JSON.parse(storage.get('mr_ui_drafts_v1')).fields['in-eve-gift'].t, T1);
  const next = page(storage, { now: T1 + 40 * 60000, today: DAY2 });
  next.bootEarly();
  const s = JSON.parse(next.bootDrafts());
  assert.equal(s.status, 'ok'); assert.equal(s.applied, 1);
  assert.equal(next.els['in-eve-gift'].value, '23400');
  for (const id of ['in-fii-cash', 'in-dii-cash', 'in-upstox-bias']) assert.equal(next.els[id].value, '', id);
  // editing an old field on the new day makes THAT field today's draft (and only it)
  next.type('in-fii-cash', '-900'); next.hidden();
  assert.deepEqual(Object.keys(JSON.parse(storage.get('mr_ui_drafts_v1')).fields).sort(), ['in-eve-gift', 'in-fii-cash']);
});

test('R1: fresh-document next-day cold start discards drafts; a record dated today carrying yesterday\'s edits is refused', () => {
  const storage = new Map();
  firstSession(storage).nativePause();
  const next = page(storage, { now: T1, today: DAY2 });
  assert.equal(next.bootEarly(), null);
  const s = JSON.parse(next.bootDrafts());
  assert.equal(s.status, 'stale_date'); assert.equal(s.applied, 0);
  assert.equal(next.els['in-fii-cash'].value, ''); assert.equal(storage.has('mr_ui_drafts_v1'), false);
  // defence in depth: a record flushed under 27 Oct whose field edits originate on 26 Oct
  const forged = new Map([['mr_ui_drafts_v1', JSON.stringify({ v: 2, date: DAY2, ts: T1, fields: {
    'in-fii-cash': { v: '-1200', base: '', d: TODAY, t: T0 }, 'in-eve-gift': { v: '23300', base: '', d: DAY2, t: T1 - 13 * 3600000 } } })]]);
  const q = page(forged, { now: T1 + 60000, today: DAY2 });
  q.bootEarly();
  const sq = JSON.parse(q.bootDrafts());
  assert.equal(sq.skipped['in-fii-cash'], 'stale_date'); assert.equal(sq.skipped['in-eve-gift'], 'stale_age');
  assert.equal(q.els['in-fii-cash'].value, ''); assert.equal(q.els['in-eve-gift'].value, '');
  // a pre-R1 (v1) record without per-field origin is not trusted
  const v1 = new Map([['mr_ui_drafts_v1', JSON.stringify({ v: 1, date: TODAY, ts: T0, fields: { 'in-fii-cash': { v: '-1200', base: '' } } })]]);
  const r = page(v1, { now: T0 + 60000 }); r.bootEarly();
  assert.equal(JSON.parse(r.bootDrafts()).status, 'malformed'); assert.equal(r.els['in-fii-cash'].value, '');
});

// ── R2 through the REAL saveEveningClose ack path ──
const EVE0 = { dow: 42000, crude: 80, gift: 23000, date: TODAY, saved_at: new Date(T0 - 3600000).toISOString() };
function recordingBridge(respond) {
  const calls = [];
  return { calls, setEveningClose(json) { calls.push(JSON.parse(json)); return JSON.stringify(respond(JSON.parse(json))); } };
}
const ACK = p => ({ ok: true, kind: 'evening', revision: 'rev-2', record: { dow: p.dow, crude: p.crude, gift: p.gift, intended_session: DAY2, captured_at_ms: T0 + 120000 } });
function evePage(storage, opts = {}) {
  const p = page(storage, { withSave: true, ...opts });
  p.bootEarly();
  p.run('restoreEveningClose(null)');                         // the authoritative restore (boot order: before drafts)
  p.bootDrafts();
  return p;
}

test('R2: real saveEveningClose ack advances the baseline; a later unsaved edit survives re-creation; other drafts kept', () => {
  const storage = new Map([['mr2_evening_close', JSON.stringify(EVE0)]]);
  const bridge = recordingBridge(ACK);
  const before = evePage(storage, { bridge });
  assert.equal(before.els['in-eve-gift'].value, '23000');
  before.type('in-fii-cash', '-1200');                        // an unrelated unsaved morning draft
  before.type('in-eve-gift', '23100');
  before.run('saveEveningClose()');                           // the user's explicit Save
  assert.equal(bridge.calls.length, 1); assert.equal(bridge.calls[0].gift, 23100);
  assert.equal(JSON.parse(storage.get('mr2_evening_close')).gift, 23100);
  const afterSave = JSON.parse(storage.get('mr_ui_drafts_v1'));
  assert.deepEqual(Object.keys(afterSave.fields), ['in-fii-cash'], 'saved evening draft cleared, unsaved morning draft kept');
  before.type('in-eve-gift', '23200');
  assert.equal(JSON.parse(storage.get('mr_ui_drafts_v1')).fields['in-eve-gift'].base, '23100', 'compared against the acknowledged value');
  before.nativePause();

  const after = page(storage, { now: T0 + 60000, withSave: true, bridge: {} });
  after.bootEarly();
  after.run('restoreEveningClose(null)');
  assert.equal(after.els['in-eve-gift'].value, '23100', 'authoritative restore loads the saved record');
  const s = JSON.parse(after.bootDrafts());
  assert.equal(s.status, 'ok'); assert.equal(s.applied, 2);
  assert.equal(after.els['in-eve-gift'].value, '23200');
  assert.equal(after.els['in-fii-cash'].value, '-1200');
  assert.equal(after.events.dispatched, 0);
  // newer authority still wins over the post-ack draft
  const newer = page(storage, { now: T0 + 90000, withSave: true, bridge: {} });
  newer.bootEarly(); newer.els['in-eve-gift'].value = '23150';
  assert.equal(JSON.parse(newer.bootDrafts()).skipped['in-eve-gift'], 'authority_changed');
  assert.equal(newer.els['in-eve-gift'].value, '23150');
});

test('R2: an acknowledged save of normalised text clears that draft (form shows the sent text, base the stored value)', () => {
  const storage = new Map([['mr2_evening_close', JSON.stringify(EVE0)]]);
  const before = evePage(storage, { bridge: recordingBridge(ACK) });
  before.type('in-eve-gift', ' 23100.0 ');
  before.run('saveEveningClose()');
  assert.equal(storage.has('mr_ui_drafts_v1'), false, 'nothing unsaved remains');
  before.hidden();
  assert.equal(storage.has('mr_ui_drafts_v1'), false);
});

for (const [why, respond, mutate] of [
  ['native rejects the save', () => ({ ok: false, error: 'rejected' }), null],
  ['save not confirmed (no revision/record)', () => ({ ok: true }), null],
  ['wrong ack kind', p => ({ ...ACK(p), kind: 'morning' }), null],
  ['form validation fails before any native call', ACK, p => p.type('in-eve-dow', 'abc')],
]) {
  test(`R2 failed save (${why}): baseline not advanced, draft not dropped`, () => {
    const storage = new Map([['mr2_evening_close', JSON.stringify(EVE0)]]);
    const bridge = recordingBridge(respond);
    const before = evePage(storage, { bridge });
    before.type('in-fii-cash', '-1200');
    before.type('in-eve-gift', '23100');
    if (mutate) mutate(before);
    before.run('saveEveningClose()');
    assert.equal(JSON.parse(storage.get('mr2_evening_close')).gift, 23000, 'nothing stored');
    const rec = JSON.parse(storage.get('mr_ui_drafts_v1'));
    assert.equal(rec.fields['in-eve-gift'].v, '23100'); assert.equal(rec.fields['in-eve-gift'].base, '23000');
    assert.equal(rec.fields['in-fii-cash'].v, '-1200');
    before.nativePause();
    const after = page(storage, { now: T0 + 60000, withSave: true, bridge: {} });
    after.bootEarly(); after.run('restoreEveningClose(null)');
    assert.equal(after.els['in-eve-gift'].value, '23000');
    after.bootDrafts();
    assert.equal(after.els['in-eve-gift'].value, '23100', 'the unsaved edit returns as a draft over the unchanged authority');
    assert.equal(after.els['in-fii-cash'].value, '-1200');
  });
}

test('R2: morning lock precedence unchanged after an evening ack', () => {
  const storage = new Map([['mr2_evening_close', JSON.stringify(EVE0)]]);
  const before = evePage(storage, { bridge: recordingBridge(ACK) });
  before.type('in-fii-cash', '-1200'); before.type('in-eve-gift', '23100');
  before.run('saveEveningClose()');
  before.type('in-eve-gift', '23200'); before.nativePause();
  const after = page(storage, { now: T0 + 60000, withSave: true, bridge: {}, locked: true });
  after.bootEarly(); after.run('restoreEveningClose(null)');
  const s = JSON.parse(after.bootDrafts());
  assert.equal(s.skipped['in-fii-cash'], 'locked'); assert.equal(after.els['in-fii-cash'].value, '');
  assert.equal(after.els['in-eve-gift'].value, '23200');
});

test('source contract: the b515 ack hook sits after the acknowledged evening save only', () => {
  const save = fnSrc('saveEveningClose');
  const ackAt = save.indexOf('if (!eveAck.ok) throw');
  const hookAt = save.indexOf('b515DraftsAcknowledged(');
  assert.ok(ackAt > 0 && hookAt > ackAt && hookAt > save.indexOf("localStorage.setItem('mr2_evening_close'"));
  assert.ok(hookAt < save.indexOf('} catch (e) {'));
  assert.equal(app.split('b515DraftsAcknowledged(').length - 1, 2, 'defined once, called once (evening save)');
});

// ═══ R3 correction (Codex b515 re-review, 28 Oct 2026): the draft baseline is date-scoped too ═══
// Codex's failing regression (verbatim). Uses this file's existing helpers fnSrc, rollOver, TODAY, DAY2, T1 and page.
test('review: new-day morning edit after nonblank old authority', () => {
  const storage = new Map([['mr2_morning',
    JSON.stringify({ date: TODAY, fiiCash: -1000 })]]);
  const morningSrc =
    fnSrc('clearMorningStorage') + '\n' + fnSrc('restoreMorningData');

  const old = page(storage);
  old.bootEarly();
  old.run(morningSrc);
  old.run('restoreMorningData(null)');
  assert.equal(old.els['in-fii-cash'].value, '-1000');
  old.bootDrafts();

  rollOver(old);
  old.type('in-fii-cash', '-900');
  old.nativePause();

  const next = page(storage, { now: T1 + 60000, today: DAY2 });
  next.bootEarly();
  next.run(morningSrc);
  next.run('restoreMorningData(null)');
  assert.equal(storage.has('mr2_morning'), false);
  next.bootDrafts();
  assert.equal(next.els['in-fii-cash'].value, '-900');
});

const MORNING_SRC = fnSrc('clearMorningStorage') + '\n' + fnSrc('restoreMorningData');
// A document that booted on 26 Oct with the saved morning record restored (and optionally an evening record).
function morningPage(storage, opts = {}) {
  const p = page(storage, opts);
  p.bootEarly();
  p.run(MORNING_SRC);
  p.run('restoreMorningData(null)');
  if (opts.withSave) p.run('restoreEveningClose(null)');
  p.bootDrafts();
  return p;
}
function recreate(storage, opts = {}) {
  const p = page(storage, { now: T1 + 60000, today: DAY2, ...opts });
  p.bootEarly();
  p.run(MORNING_SRC);
  p.run('restoreMorningData(null)');
  if (opts.withSave) p.run('restoreEveningClose(null)');
  return { p, s: JSON.parse(p.bootDrafts()) };
}
const MORNING26 = JSON.stringify({ date: TODAY, fiiCash: -1000, diiCash: 5706, giftSpot: 24100, upstoxBias: 'Bearish' });

test('R3: a genuine new-day entry numerically EQUAL to yesterday\'s base is a draft and survives re-creation', () => {
  const storage = new Map([['mr2_morning', MORNING26]]);
  const old = morningPage(storage);
  assert.equal(old.els['in-fii-cash'].value, '-1000');
  rollOver(old);
  old.type('in-fii-cash', '-1000');                            // re-entered on 27 Oct: same number as yesterday
  old.nativePause();
  const rec = JSON.parse(storage.get('mr_ui_drafts_v1'));
  assert.equal(rec.date, DAY2);
  assert.deepEqual(rec.fields['in-fii-cash'], { v: '-1000', base: '', d: DAY2, t: T1 }, 'compared with 27 Oct authority (none), not 26 Oct');
  assert.deepEqual(Object.keys(rec.fields), ['in-fii-cash'], 'untouched 26 Oct morning values are not drafts');
  assert.ok(old.logs.some(l => /b515 drafts date rollover from=2026-10-26 to=2026-10-27 dropped=0 rebased=9/.test(l)));
  const { p: next, s } = recreate(storage);
  assert.equal(storage.has('mr2_morning'), false, 'the real restore removed the 26 Oct record');
  assert.equal(s.status, 'ok'); assert.equal(s.applied, 1);
  assert.equal(next.els['in-fii-cash'].value, '-1000');
  for (const id of ['in-dii-cash', 'in-gift-spot', 'in-upstox-bias']) assert.equal(next.els[id].value, '', id);
  assert.equal(next.events.dispatched, 0, 'restore only: no event, no save, no lock, no scan');
});

test('R3: untouched nonblank previous-day morning values never return after rollover + flush', () => {
  const storage = new Map([['mr2_morning', MORNING26]]);
  const old = morningPage(storage);
  rollOver(old);
  old.hidden(); old.nativePause(); old.pagehide();
  assert.equal(storage.has('mr_ui_drafts_v1'), false);
  assert.equal(old.els['in-fii-cash'].value, '-1000', 'visible form left alone (no auto-clear)');
  const { p: next, s } = recreate(storage);
  assert.equal(s.applied, 0);
  for (const id of ['in-fii-cash', 'in-dii-cash', 'in-gift-spot', 'in-upstox-bias']) assert.equal(next.els[id].value, '', id);
});

test('R3: newer current-day saved/locked morning authority still wins over a genuine new-day draft', () => {
  // (a) a 27 Oct record saved AFTER the draft was typed (another path / device) wins
  const sa = new Map([['mr2_morning', MORNING26]]);
  const a = morningPage(sa);
  rollOver(a); a.type('in-fii-cash', '-900'); a.nativePause();
  sa.set('mr2_morning', JSON.stringify({ date: DAY2, fiiCash: -950 }));
  const { p: na, s: ssa } = recreate(sa);
  assert.equal(ssa.skipped['in-fii-cash'], 'authority_changed');
  assert.equal(na.els['in-fii-cash'].value, '-950');
  // (b) morning locked for 27 Oct: the locked record wins, the draft is skipped as locked
  const sb = new Map([['mr2_morning', MORNING26]]);
  const b = morningPage(sb);
  rollOver(b); b.type('in-fii-cash', '-900'); b.nativePause();
  sb.set('mr2_morning', JSON.stringify({ date: DAY2, fiiCash: -975 }));
  const { p: nb, s: ssb } = recreate(sb, { locked: true });
  assert.equal(ssb.skipped['in-fii-cash'], 'locked');
  assert.equal(nb.els['in-fii-cash'].value, '-975');
  // (c) a 27 Oct record already present at rollover is the new base: a later edit compares against IT, and an even
  // newer 27 Oct record still wins
  const sc = new Map([['mr2_morning', MORNING26]]);
  const c = morningPage(sc);
  sc.set('mr2_morning', JSON.stringify({ date: DAY2, fiiCash: -800, upstoxBias: 'Neutral' }));
  rollOver(c); c.type('in-fii-cash', '-900'); c.nativePause();
  assert.equal(JSON.parse(sc.get('mr_ui_drafts_v1')).fields['in-fii-cash'].base, '-800');
  const { p: nc, s: ssc } = recreate(sc);
  assert.equal(ssc.applied, 1); assert.equal(nc.els['in-fii-cash'].value, '-900');
  assert.equal(nc.els['in-upstox-bias'].value, 'Neutral');
  sc.set('mr2_morning', JSON.stringify({ date: DAY2, fiiCash: -850 }));
  const { p: nd, s: ssd } = recreate(sc, { now: T1 + 120000 });
  assert.equal(ssd.skipped['in-fii-cash'], 'authority_changed'); assert.equal(nd.els['in-fii-cash'].value, '-850');
});

test('R3: evening baseline is not blanked by the rollover (its restore is not date-scoped)', () => {
  const storage = new Map([['mr2_morning', MORNING26], ['mr2_evening_close', JSON.stringify(EVE0)]]);
  const old = morningPage(storage, { withSave: true, bridge: {} });
  assert.equal(old.els['in-eve-gift'].value, '23000');
  rollOver(old);
  old.type('in-eve-gift', '23400');
  old.nativePause();
  assert.equal(JSON.parse(storage.get('mr_ui_drafts_v1')).fields['in-eve-gift'].base, '23000');
  const { p: next, s } = recreate(storage, { withSave: true, bridge: {} });
  assert.equal(next.els['in-eve-gift'].value, '23400'); assert.equal(s.applied, 1);
  // a newer evening reference saved for the new day still wins
  storage.set('mr2_evening_close', JSON.stringify({ ...EVE0, gift: 23350, date: DAY2 }));
  const { p: n2, s: s2 } = recreate(storage, { withSave: true, bridge: {}, now: T1 + 120000 });
  assert.equal(s2.skipped['in-eve-gift'], 'authority_changed'); assert.equal(n2.els['in-eve-gift'].value, '23350');
});
