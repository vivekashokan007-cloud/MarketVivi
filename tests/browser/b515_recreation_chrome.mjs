// b515 (CDX-GROK-BACKGROUND-RESUME-1) headless-Chrome reproduction of Android's background Activity destruction
// followed by same-process re-creation: the old document is torn down (pagehide/visibility hidden, as WebView.onPause/
// destroy do) and a NEW document of the same origin boots app.js again with the same DOM storage — what a new WebView
// after restoreState() does. Supabase reads are slowed (DELAY_MS) to reproduce the real boot awaits.
// The AndroidBridge is a recording stub behind the REAL MainActivity.kt facade (MARKETAPP_DIR).
// Local/CI evidence only — not an Android WebView and not a phone pass.
//
//   MARKETAPP_DIR=../Marketapp PWA_DIR=. PLAYWRIGHT_CORE=<dir with node_modules/playwright-core> node tests/browser/b515_recreation_chrome.mjs
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PWA = path.resolve(process.env.PWA_DIR || path.join(here, '..', '..'));
const MA = path.resolve(process.env.MARKETAPP_DIR || path.join(PWA, '..', 'Marketapp'));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const DELAY_MS = Number(process.env.DELAY_MS || 2500);
const req = createRequire(path.join(path.resolve(process.env.PLAYWRIGHT_CORE || PWA), 'noop.js'));
const { chromium } = req('playwright-core');
const F = await import(pathToFileURL(path.join(MA, 'tools', 'bridge_facade', 'facade.mjs')).href);
const FACADE_JS = F.extractFacadeJs();

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); let f = u.pathname === '/' ? '/index.html' : u.pathname;
  const p = path.join(PWA, path.normalize(f));
  if (!p.startsWith(PWA) || !existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(readFileSync(p));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

// 26 Oct 09:16 IST market session, native service running with 8 polls (the recorded first return).
const NOW_IST = Date.parse('2026-10-26T03:46:00Z');
const FAKE_SUPABASE = `window.supabase = { createClient() {
  const res = { data: [], error: null };
  const chain = new Proxy(function(){}, { get(t, k) { if (k === 'then') return (ok) => setTimeout(() => ok(res), ${DELAY_MS}); return () => chain; },
                                          apply() { return chain; } });
  return { from: () => chain, rpc: () => chain, functions: { invoke: () => chain }, auth: { getSession: () => chain } };
} };`;
const ANDROID_STUB = `(() => {
  const today = '2026-10-26';
  const polls = Array.from({ length: 8 }, (_, i) => ({ date: today, slot: i + 1, time: '09:' + (15 + 5 * i), spots: {} }));
  const fixed = {
    isNative: true, getServiceStatus: JSON.stringify({ running: true, sessionActive: true, polls: 8, tokenReady: true, marketOpen: true, marketReason: 'OPEN', expectedPollsByNow: 8 }),
    getPollHistory: JSON.stringify(polls), getLatestPoll: JSON.stringify(polls[7]), getOpenTrades: '[]', getClosedTrades: '[]',
    getBrainResult: '{}', getCandidates: '[]', getTradeMode: 'intraday', getTradeModeExplicit: false, getBaseline: '{}',
    getGlobalDirection: '{}', getApprovedBranchProposals: '[]', refreshApprovedBranchProposals: '[]', getCachedEvaluationJob: '{}',
    getOvernightInputState: '{}', getAllConfig: '{}', getConfig: 'null',
  };
  window.__abCalls = [];
  window.AndroidBridge = new Proxy({}, { get(t, k) {
    if (typeof k !== 'string') return undefined;
    return (...args) => { window.__abCalls.push(k); return Object.prototype.hasOwnProperty.call(fixed, k) ? fixed[k] : '{}'; };
  } });
})();`;
// Bridge methods that would be an ACTION if a screen restore called them.
// evAcceptanceRecovery (EV journal read) and setOpenTrades (echo of native getOpenTrades, no-op when unchanged) are
// existing boot behaviour on main and are reported, not counted as restore actions.
const ACTIONS = /^(setMorningInput|setEveningClose|recordClosedTrade|setClosedTrades|triggerDayEvaluation|triggerDayEvaluationForce|triggerEvaluationJob|triggerMLRetrain|approveBranchProposal|rejectBranchProposal|setExecutionSandboxEnabled|setSandboxToken|runSandboxOrderDebugAction|setOrderProxyUrl|setResearchCollectorEnabled|startMarketService|userStopMarketService|requestImmediatePoll|ev\w*Accept\w*|evManualClose\w*|requestPaperCloseQuote)$/;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const results = [];
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 412, height: 360 }, timezoneId: 'Asia/Kolkata' });
  // one wall clock for every document of the scenario: 26 Oct 09:16 IST + real elapsed time since the scenario began
  await context.addInitScript(`(() => { const T0 = ${NOW_IST}, S = ${Date.now()}; const R = Date; const real = R.now.bind(R);
    window.__shiftMs = window.__shiftMs || 0;
    const now = () => T0 + (real() - S) + (window.__shiftMs || 0);
    function D(...a) { if (!new.target) return new R(now()).toString(); return a.length ? new R(...a) : new R(now()); }
    D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; })();`);
  await context.addInitScript(ANDROID_STUB);
  await context.addInitScript(FACADE_JS);
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.request().url().includes('supabase-js') ? r.fulfill({ contentType: 'application/javascript', body: FAKE_SUPABASE }) : r.fulfill({ status: 204, body: '' }));
  const logs = [];
  try { results.push({ name, ...(await fn(context, logs)) }); } catch (e) { results.push({ name, error: String(e && e.stack || e) }); }
  await context.close();
}
async function open(context, logs, tag) {
  const page = await context.newPage();
  page.on('console', m => logs.push(`${tag} ${m.text()}`));
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  return { page, t0 };
}
// a user edit as the WebView delivers it: value change + bubbling input/change events
const typeIn = (page, id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const tallestTab = (page) => page.evaluate(async () => {
  let best = { tab: 'market', max: -1 };
  for (const b of document.querySelectorAll('.tab-btn')) { b.click(); await new Promise(r => setTimeout(r, 60));
    const max = document.documentElement.scrollHeight - innerHeight; if (b.dataset.tab !== 'market' && max > best.max) best = { tab: b.dataset.tab, max }; }
  return best; });
const state = (page) => page.evaluate(() => ({ tab: STATE.activeTab, y: Math.round(scrollY), h: document.documentElement.scrollHeight,
  fii: document.getElementById('in-fii-cash').value, dii: document.getElementById('in-dii-cash').value, gift: document.getElementById('in-eve-gift').value,
  calls: window.__abCalls.slice() }));
const settle = (page) => page.waitForFunction(() => window.__booted === true || /phase=boot|b162|tab handlers/.test(String(window.__lastBoot || '')), null, { timeout: 1 }).catch(() => {});

async function bootDone(page, logs, tag, timeout = DELAY_MS * 6 + 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (logs.some(l => l.startsWith(tag) && (/\[b162\]/.test(l) || /phase=boot/.test(l)))) return Date.now() - start;
    await page.waitForTimeout(50);
  }
  return -1;
}

await scenario('background-destroy-then-same-process-recreation', async (context, logs) => {
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  // make the Market tab tall enough to scroll on a phone-sized viewport, then act like the user
  await a.page.click('.tab-btn[data-tab="market"]');
  await typeIn(a.page, 'in-fii-cash', '-1200');
  await typeIn(a.page, 'in-dii-cash', '5706');
  await typeIn(a.page, 'in-eve-gift', '23300');
  await a.page.evaluate(() => { const max = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, Math.max(0, Math.min(260, max))); });
  await a.page.waitForTimeout(400);                      // scroll listener throttle
  const before = await state(a.page);
  const actionsBefore = before.calls.filter(c => ACTIONS.test(c));
  // Activity destroyed in background: WebView.onPause() (b515 APK calls window.mrUiFlush first), then destroy
  await a.page.evaluate(() => { try { window.mrUiFlush && window.mrUiFlush('native_pause'); } catch (e) {} });
  await a.page.close({ runBeforeUnload: false });
  // same-process re-creation: a NEW WebView document, same DOM storage
  const b = await open(context, logs, 'P2');
  const sampled = [];
  const tStart = Date.now();
  for (let i = 0; i < 6; i++) { await b.page.waitForTimeout(250); sampled.push({ ms: Date.now() - tStart, ...(await b.page.evaluate(() => ({ tab: STATE.activeTab, y: Math.round(scrollY) }))) }); }
  const bootMs = await bootDone(b.page, logs, 'P2');
  await b.page.waitForTimeout(1500);
  const after = await state(b.page);
  return { before: { ...before, calls: undefined }, sampledDuringBoot: sampled, bootMs,
    after: { ...after, calls: undefined }, actionsCold: actionsBefore, actionsRecreated: after.calls.filter(c => ACTIONS.test(c)),
    restoreLogs: logs.filter(l => /ui-restore|b512 UI state|b162|explicit destination/.test(l)) };
});

await scenario('positions-tab-recreation-with-late-render', async (context, logs) => {
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  const best = await tallestTab(a.page);
  await a.page.click(`.tab-btn[data-tab="${best.tab}"]`);
  await a.page.waitForTimeout(300);
  const tall = await a.page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await a.page.evaluate(() => window.scrollTo(0, Math.floor((document.documentElement.scrollHeight - innerHeight) * 0.6)));
  await a.page.waitForTimeout(400);
  const before = await state(a.page);
  await a.page.close({ runBeforeUnload: false });        // old APK path: only pagehide/visibility hidden fire
  const b = await open(context, logs, 'P2');
  await b.page.waitForTimeout(200);
  const early = await b.page.evaluate(() => STATE.activeTab);
  const bootMs = await bootDone(b.page, logs, 'P2');
  await b.page.waitForTimeout(1500);
  const after = await state(b.page);
  return { chosenTab: best.tab, maxScrollable: tall, before: { tab: before.tab, y: before.y }, earlyTab200ms: early, bootMs, after: { tab: after.tab, y: after.y },
    restoreLogs: logs.filter(l => /ui-restore|b512 UI state/.test(l)) };
});

await scenario('cold-start-next-day-no-resurrection', async (context, logs) => {
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  await typeIn(a.page, 'in-fii-cash', '-1200');
  await a.page.click('.tab-btn[data-tab="ml"]');
  await a.page.evaluate(() => window.mrUiFlush && window.mrUiFlush('native_pause'));
  await a.page.close();
  // next IST day: shift the clock 24h for the new document only
  await context.addInitScript(`window.__shiftMs = 24 * 3600 * 1000;`);
  const b = await open(context, logs, 'P2');
  await bootDone(b.page, logs, 'P2');
  const after = await state(b.page);
  return { after: { tab: after.tab, fii: after.fii }, actions: after.calls.filter(c => ACTIONS.test(c)), restoreLogs: logs.filter(l => /ui-restore/.test(l)) };
});

// R1 (Codex b515 review): the SAME live document crosses IST midnight; then only a flush (native onPause) happens, or
// a genuine edit to one field on the new day. Yesterday's untouched edits must never come back on the new day.
await scenario('live-document-crosses-midnight-then-flush', async (context, logs) => {
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  await typeIn(a.page, 'in-fii-cash', '-1200');
  await typeIn(a.page, 'in-eve-gift', '23300');
  await a.page.evaluate(() => window.mrUiFlush && window.mrUiFlush('native_pause'));     // legitimate 26 Oct flush
  const dateBefore = await a.page.evaluate(() => API.todayIST());
  await a.page.evaluate(() => { window.__shiftMs = 24 * 3600 * 1000; });                 // same document, next IST day
  const dateAfter = await a.page.evaluate(() => API.todayIST());
  await a.page.evaluate(() => window.mrUiFlush && window.mrUiFlush('native_pause'));     // flush only, no edit
  const storedAfterFlush = await a.page.evaluate(() => localStorage.getItem('mr_ui_drafts_v1'));
  await a.page.close({ runBeforeUnload: false });
  await context.addInitScript(`window.__shiftMs = 24 * 3600 * 1000;`);
  const b = await open(context, logs, 'P2');
  await bootDone(b.page, logs, 'P2');
  const after = await state(b.page);
  return { dateBefore, dateAfter, storedAfterFlush, after: { fii: after.fii, gift: after.gift }, actions: after.calls.filter(c => ACTIONS.test(c)),
    restoreLogs: logs.filter(l => /ui-restore/.test(l)) };
});

await scenario('live-document-crosses-midnight-then-one-real-edit', async (context, logs) => {
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  await typeIn(a.page, 'in-fii-cash', '-1200');
  await typeIn(a.page, 'in-eve-gift', '23300');
  await a.page.evaluate(() => { window.__shiftMs = 24 * 3600 * 1000; });
  await typeIn(a.page, 'in-eve-gift', '23400');                                           // the genuine new-day edit
  await a.page.evaluate(() => window.mrUiFlush && window.mrUiFlush('native_pause'));
  const stored = await a.page.evaluate(() => JSON.parse(localStorage.getItem('mr_ui_drafts_v1') || 'null'));
  await a.page.close({ runBeforeUnload: false });
  await context.addInitScript(`window.__shiftMs = 24 * 3600 * 1000;`);
  const b = await open(context, logs, 'P2');
  await bootDone(b.page, logs, 'P2');
  const after = await state(b.page);
  return { storedFields: stored && Object.keys(stored.fields), storedDate: stored && stored.date, after: { fii: after.fii, gift: after.gift },
    actions: after.calls.filter(c => ACTIONS.test(c)), restoreLogs: logs.filter(l => /ui-restore/.test(l)) };
});

// R3 (Codex b515 re-review): a saved NONBLANK 26 Oct morning record is the restored baseline; the same document lives
// into 27 Oct and the user genuinely enters FII Cash -900 and re-enters DII Cash 5706 (equal to yesterday's value).
// The 27 Oct re-creation's real restoreMorningData drops the 26 Oct record; both new-day entries must return as drafts.
await scenario('nonblank-prior-day-morning-base-then-new-day-edits', async (context, logs) => {
  const s = await open(context, logs, 'P0');
  await s.page.evaluate(() => localStorage.setItem('mr2_morning', JSON.stringify({ date: '2026-10-26', fiiCash: -1000, diiCash: 5706 })));
  await s.page.close({ runBeforeUnload: false });
  const a = await open(context, logs, 'P1');
  await bootDone(a.page, logs, 'P1');
  const restored = await state(a.page);
  await a.page.evaluate(() => { window.__shiftMs = 24 * 3600 * 1000; });
  await typeIn(a.page, 'in-fii-cash', '-900');
  await typeIn(a.page, 'in-dii-cash', '5706');
  await a.page.evaluate(() => window.mrUiFlush && window.mrUiFlush('native_pause'));
  const stored = await a.page.evaluate(() => JSON.parse(localStorage.getItem('mr_ui_drafts_v1') || 'null'));
  await a.page.close({ runBeforeUnload: false });
  await context.addInitScript(`window.__shiftMs = 24 * 3600 * 1000;`);
  const b = await open(context, logs, 'P2');
  await bootDone(b.page, logs, 'P2');
  const after = await state(b.page);
  const morningAfter = await b.page.evaluate(() => localStorage.getItem('mr2_morning'));
  return { restoredDay1: { fii: restored.fii, dii: restored.dii }, stored, after: { fii: after.fii, dii: after.dii }, morningRecordAfter: morningAfter,
    actions: after.calls.filter(c => ACTIONS.test(c)), restoreLogs: logs.filter(l => /ui-restore/.test(l)) };
});

await browser.close(); server.close();
console.log(JSON.stringify({ pwaDir: PWA, marketappDir: MA, delayMs: DELAY_MS, chrome: CHROME, results }, null, 2));
