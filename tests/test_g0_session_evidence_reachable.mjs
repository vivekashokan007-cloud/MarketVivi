// G0 (handoff 3 Nov 2026 s3): session evidence export reachable after close / pre-poll / stale / live, IST date
// picker, explicit failure on a date mismatch, exactly one export section.  Runs the REAL app.js functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `app.js defines ${name}`);
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 3);
}
const FNS = ['iaEsc', 'iaTodayIst', 'sessionEvidenceSupported', 'sessionEvidenceDateValid', 'sessionEvidenceRecentDates',
  'setSessionEvidenceDate', 'exportSessionEvidence', 'renderSessionEvidenceParts', 'renderSessionEvidenceLine',
  'renderSessionEvidenceCard', 'renderSessionEvidence', 'renderSessionEvidenceShortcut'];
function ctx(nb, now) {
  const els = { 'session-evidence': { innerHTML: '' }, 'session-evidence-shortcut': { innerHTML: '' } };
  const RealDate = Date;
  const FakeDate = now ? class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return new RealDate(now).getTime(); } } : RealDate;
  const c = { JSON, String, Object, Array, Math, Intl, Date: FakeDate, Number, isNaN, renders: 0, els };
  c.window = { NativeBridge: nb };
  c.document = { getElementById: id => els[id] || null };
  vm.createContext(c);
  vm.runInContext(`const M0_PWA_IDENTITY = { version: '2.6.93', build: 524, app_js_v: 1388 }; let SESSION_EVIDENCE_RESULT=null; let SESSION_EVIDENCE_DATE=null;
    function renderAll(){ renders++; renderSessionEvidence(); }\n${FNS.map(fn).join('\n')}`, c);
  return c;
}
const okBridge = (calls, used = d => d, extra = {}) => ({ exportSessionEvidence: (d, v) => { calls.push([d, v]); const u = used(d);
  return JSON.stringify({ ok: true, status: 'OK', bytes: 2048, sha256: 'feedfacecafebeef00', session_date_used: u, session_date_requested: d,
    fileName: `mr_session_evidence_${u}.json`, parts: { authority_doc: { status: 'MISSING' }, learning_ledger: { status: 'PRESENT' }, logs: { status: 'TRUNCATED' }, daily_review_doc: { status: 'PRESENT' } }, ...extra }); } });

test('section is rendered by renderAll on the Trade tab, outside the live verdict branch, with a Market shortcut', () => {
  assert.match(html, /id="tab-strategies">[\s\S]*?<div id="session-evidence"><\/div>/);
  assert.match(html, /id="tab-market">[\s\S]*?<div id="session-evidence-shortcut"><\/div>[\s\S]*?<!-- TAB 2: OI -->/);
  const ra = fn('renderAll');
  assert.match(ra, /try \{ renderSessionEvidence\(\); \}/);
  assert.ok(ra.indexOf('renderSessionEvidence()') < ra.indexOf('renderMarket(snap)'), 'rendered independently of the market renderer');
  // exactly one export control: not in the authority panels, the daily review, or brain insights
  for (const f of ['renderBrainInsights', 'renderIndexAuthorityPanels', 'renderDailyReviewCard']) assert.doesNotMatch(fn(f), /exportSessionEvidence\(/, f);
  assert.equal((src.match(/onclick="exportSessionEvidence\(\)"/g) || []).length, 1);
  assert.equal((html.match(/id="session-evidence"/g) || []).length, 1);
});

for (const [label, nowIso] of [['closed market (22:07 IST)', '2026-11-03T16:37:00Z'], ['pre-poll (08:30 IST)', '2026-11-04T03:00:00Z'],
  ['live market (11:00 IST)', '2026-11-04T05:30:00Z']]) {
  test(`${label}: section renders, defaults to today's IST date, no brain/poll state needed`, () => {
    const c = ctx(okBridge([]), nowIso);
    c.renderSessionEvidence();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(nowIso));
    assert.match(c.els['session-evidence'].innerHTML, /📦 Session evidence \(local\)/);
    assert.match(c.els['session-evidence'].innerHTML, new RegExp(`Export session evidence for ${today}`));
    assert.match(c.els['session-evidence'].innerHTML, /Separate from "Export research evidence \(read-only\)"/);
    assert.match(c.els['session-evidence-shortcut'].innerHTML, /switchTab\('strategies'\)/);
  });
}

test('stale brain: section independent of bd / brain freshness (no reference to brain state)', () => {
  for (const f of ['renderSessionEvidenceCard', 'renderSessionEvidence', 'exportSessionEvidence']) {
    assert.doesNotMatch(fn(f), /\bbd\b|brainFreshness|isLiveRecommendationWindow|STATE\./, f);
  }
});

test('after close on 4 Nov the user can pick 2 Nov and 3 Nov; the bridge gets that exact date; file/manifest date shown', () => {
  const calls = [];
  const c = ctx(okBridge(calls), '2026-11-04T16:37:00Z');
  const chips = c.renderSessionEvidenceCard();
  assert.match(chips, /setSessionEvidenceDate\('2026-11-03'\)/);
  assert.match(chips, /setSessionEvidenceDate\('2026-11-02'\)/);
  assert.doesNotMatch(chips, /setSessionEvidenceDate\('2026-11-01'\)/);   // Sunday
  for (const d of ['2026-11-02', '2026-11-03']) {
    c.setSessionEvidenceDate(d);
    c.exportSessionEvidence();
    assert.equal(calls.at(-1)[0], d);
    const line = c.renderSessionEvidenceLine();
    assert.match(line, new RegExp(`Saved mr_session_evidence_${d}\\.json · 2048 bytes · sha256 feedfacecafe`));
    assert.match(line, new RegExp(`requested ${d} · actual ${d}`));
    assert.match(line, /authority_doc: <span[^>]*>MISSING/);      // missing stays MISSING
    assert.match(line, /learning_ledger: <span[^>]*>PRESENT/);
    assert.match(line, /logs: <span[^>]*>TRUNCATED/);
  }
});

test('missing date: native SESSION_DATE_MISSING is a failure, not a saved file', () => {
  const c = ctx({ exportSessionEvidence: d => JSON.stringify({ ok: false, status: 'SESSION_DATE_MISSING', session_date_requested: d, session_date_used: '' }) }, '2026-11-04T16:37:00Z');
  c.exportSessionEvidence('2026-10-01');
  const line = c.renderSessionEvidenceLine();
  assert.match(line, /failed: SESSION_DATE_MISSING · requested 2026-10-01 · actual none/);
  assert.doesNotMatch(line, /Saved/);
});

test('mismatched fallback from an older APK (silently used another day) is shown as a mismatch failure', () => {
  const c = ctx(okBridge([], () => '2026-11-02'), '2026-11-04T16:37:00Z');
  c.exportSessionEvidence('2026-11-03');
  const r = c.SESSION_EVIDENCE_RESULT ?? vm.runInContext('SESSION_EVIDENCE_RESULT', c);
  assert.equal(r.ok, false);
  assert.equal(r.status, 'SESSION_DATE_MISMATCH');
  const line = c.renderSessionEvidenceLine();
  assert.match(line, /failed: SESSION_DATE_MISMATCH · requested 2026-11-03 · actual 2026-11-02/);
  assert.match(line, /that file is the 2026-11-02 session, not 2026-11-03/);
  assert.doesNotMatch(line, /^<div[^>]*>Saved/);
});

test('invalid / future dates never reach the bridge', () => {
  const calls = [];
  const c = ctx(okBridge(calls), '2026-11-04T05:30:00Z');
  for (const d of ['2026-11-05', '2026-02-30', '../x', '']) {
    c.exportSessionEvidence(d || 'bad');
    assert.match(c.renderSessionEvidenceLine(), /INPUT_INVALID/, d);
  }
  assert.equal(calls.length, 0);
});

test('old APK without the method: app update needed, no call', () => {
  const c = ctx({}, '2026-11-04T16:37:00Z');
  c.exportSessionEvidence('2026-11-03');
  assert.match(c.renderSessionEvidenceLine(), /app update needed/);
});
