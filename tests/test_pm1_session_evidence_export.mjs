// PM1 (2.6.86 / b517): session evidence export button, old-APK feature detection, review input provenance.
// Runs the REAL app.js functions; the facade test runs the REAL injected NativeBridge facade when the paired
// Marketapp checkout is available (MARKETAPP_DIR), and an OLD (2.6.85) facade without the method.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 3);
}
const FNS = ['iaEsc', 'iaTodayIst', 'reviewNet', 'renderReviewGroups', 'renderDailyReviewCard', 'sessionEvidenceSupported',
  'exportSessionEvidence', 'renderSessionEvidenceLine', 'renderReviewInputs'];
function ctx(nb) {
  const c = { JSON, String, Object, Array, Math, Intl, Date, Number, renders: 0 };
  c.window = { NativeBridge: nb };
  vm.createContext(c);
  vm.runInContext(`const M0_PWA_IDENTITY = { version: '2.6.86', build: 517, app_js_v: 1381 }; let DAILY_REVIEW_CACHE=null; let SESSION_EVIDENCE_RESULT=null; function renderAll(){ renders++; }\n${FNS.map(fn).join('\n')}`, c);
  return c;
}

test('old APK (no exportSessionEvidence): button shows app update needed and never calls an absent method', () => {
  const c = ctx({ dailyReviewLatest: () => '{}' });
  assert.equal(c.sessionEvidenceSupported(), false);
  assert.match(c.renderDailyReviewCard(), /Export session evidence/);
  assert.match(c.renderDailyReviewCard(), /app update needed \(2\.6\.86 · b517\)/);
  c.exportSessionEvidence();
  assert.match(c.renderSessionEvidenceLine(), /app update needed/);
});

test('new APK: the button calls the bridge with the IST date and the visible PWA version; result line renders', () => {
  const calls = [];
  const c = ctx({ exportSessionEvidence: (d, v) => { calls.push([d, v]); return JSON.stringify({ ok: true, status: 'OK', bytes: 12345,
    sha256: 'abcdef0123456789ff', session_date_used: '2026-11-02', fileName: 'mr_session_evidence_2026-11-02.json' }); } });
  c.exportSessionEvidence();
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls[0][1], '2.6.86/b517/v1381');
  const line = c.renderSessionEvidenceLine();
  assert.match(line, /mr_session_evidence_2026-11-02\.json · 12345 bytes · sha256 abcdef012345 · session 2026-11-02/);
  assert.doesNotMatch(line, /abcdef0123456789/);
});

test('bounded failure is shown as a failure, never as a saved file', () => {
  const c = ctx({ exportSessionEvidence: () => JSON.stringify({ ok: false, status: 'AUTHORITY_OVER_CAP', bytes: 900 }) });
  c.exportSessionEvidence();
  assert.match(c.renderSessionEvidenceLine(), /failed: AUTHORITY_OVER_CAP/);
  const t = ctx({ exportSessionEvidence: () => { throw new Error('x'); } });
  t.exportSessionEvidence();
  assert.match(t.renderSessionEvidenceLine(), /failed: EXPORT_ERROR/);
});

test('review input provenance: PM1 inputs shown; older reports say provenance not recorded', () => {
  const c = ctx({});
  vm.runInContext(`DAILY_REVIEW_CACHE = ${JSON.stringify({ latest: { revision: 1, by_index: { NF: { coverage: {} }, BNF: { coverage: {} } },
    inputs: { manual_status: 'SUPPLIED', manual_trade_rows: 1, trades_source: 'prefs.closed_trades', single_leg_outcome_rows: 2 } } })};`, c);
  assert.match(c.renderDailyReviewCard(), /manual trades SUPPLIED \(1 rows, prefs\.closed_trades\) · local single-leg outcomes 2 rows/);
  vm.runInContext(`DAILY_REVIEW_CACHE = ${JSON.stringify({ latest: { revision: 1, by_index: {} } })};`, c);
  assert.match(c.renderDailyReviewCard(), /provenance not recorded \(older build\)/);
});

test('real injected facade: new MainActivity exposes exportSessionEvidence; the 2.6.85 facade does not', async () => {
  const dir = process.env.MARKETAPP_DIR;
  if (!dir || !existsSync(path.join(dir, 'tools', 'bridge_facade', 'facade.mjs'))) {
    console.log('# SKIPPED real facade check: MARKETAPP_DIR not set');
    return;
  }
  const { runFacade, extractFacadeJs, mainActivitySource } = await import(path.join(dir, 'tools', 'bridge_facade', 'facade.mjs'));
  const calls = [];
  const ab = new Proxy({}, { get: (_t, n) => (...a) => { calls.push([n, ...a]); return JSON.stringify({ ok: true, status: 'OK' }); } });
  const nb = runFacade({ AndroidBridge: ab });
  assert.equal(typeof nb.exportSessionEvidence, 'function');
  nb.exportSessionEvidence('2026-11-02', '2.6.86/b517/v1381');
  assert.deepEqual(calls.at(-1), ['exportSessionEvidence', '2026-11-02', '2.6.86/b517/v1381']);
  // the same PWA code against the facade WITHOUT the method (2.6.85 shape) -> app update needed
  const oldJs = extractFacadeJs(mainActivitySource()).split('\n').filter(l => !l.includes('exportSessionEvidence')).join('\n');
  const oldNb = runFacade({ AndroidBridge: ab }, oldJs);
  const c = ctx(oldNb);
  c.exportSessionEvidence();
  assert.match(c.renderSessionEvidenceLine(), /app update needed/);
});
