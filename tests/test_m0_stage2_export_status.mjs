// M0 Stage 2 (CDX-STAGE2-BUILD-AUTH-1) CI-2/CI-4: the REAL Marketapp facade + the REAL app.js research card.
// Utilisation display (accepted formula, unknown never zero), toggle readback, independence from market/evaluation
// controls, and the read-only export button/result path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sandbox } from './ev12_harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MA = path.resolve(process.env.MARKETAPP_DIR || path.join(here, '..', '..', 'Marketapp'));
const FACADE = path.join(MA, 'tools', 'bridge_facade', 'facade.mjs');
assert.ok(existsSync(FACADE), `Marketapp checkout with tools/bridge_facade/facade.mjs required at ${MA}`);
process.env.MARKETAPP_DIR = MA;
const F = await import(pathToFileURL(FACADE).href);
const FACADE_JS = F.extractFacadeJs();

const CAP = (o = {}) => Object.assign({ schema: 'research_m0_capacity_v1', known: true, capacity: 4000, max_bytes: 2500000,
  entry_growth_reserve_bytes: 448, compaction_reserve_bytes: 128, reject_reserve_bytes: 768, active: 774, ledger_bytes: 301773,
  counts: { STAGED: 774, LAG_EXCEEDED: 0, ARCHIVE_ACKED: 0, RELEASED: 0 }, rejected_total: 0, identity_conflicts_total: 0,
  cap_refusals_process: 0, integrity: 'BACKLOG', computed_ms: Date.UTC(2026, 9, 23, 3, 0), ledger_age_ms: 120000 }, o);

const MARKET = ['startMarketService', 'stopMarketService', 'runEveningEvaluation', 'startEveningEvaluation', 'evSetMode'];

function androidBridge({ cap = CAP(), omit = [], stuck = false } = {}) {
  const d = { enabled: true, calls: [], exportArgs: [] };
  const st = () => JSON.stringify({ schema: 'research_m0_collector_v2:status', enabled: d.enabled, label: d.enabled ? 'ENABLED_NOT_CAPTURING' : 'DISABLED',
    sessions: [], envelopes_today: {}, protection: { integrity: 'BACKLOG' }, conflicts_total: 0, failures: {}, capacity: cap,
    toggle_semantics: 'OFF stops NEW research attempts and envelopes; an attempt already begun for the current poll finishes its capture/close. Market polling, position monitoring and evening evaluation are not affected.' });
  const ab = {
    isNative: () => true,
    getResearchCollectorStatus() { d.calls.push(['get']); return st(); },
    setResearchCollectorEnabled(on) { d.calls.push(['set', on]); if (!stuck) d.enabled = on; return st(); },
    exportResearchEvidence(id) { d.calls.push(['export']); d.exportArgs.push(id); return JSON.stringify({ status: 'PICKER_OPENING' }); },
    getResearchExportResult() { d.calls.push(['result']); return JSON.stringify({ status: 'NONE' }); },
    cancelResearchExport() { d.calls.push(['cancel']); return JSON.stringify({ cancel_requested: false }); },
  };
  for (const k of MARKET) ab[k] = () => { d.calls.push(['MARKET', k]); };
  for (const k of omit) delete ab[k];
  return { ab, d };
}
function chain(ab) { const ctx = sandbox({}); delete ctx.NativeBridge; ctx.AndroidBridge = ab; F.runFacade(ctx, FACADE_JS); return ctx; }
const card = (ctx) => { ctx.renderResearchCollector(); return ctx._els['research-m0'].innerHTML; };
const EVID = process.env.M0_EVIDENCE_DIR;
const save = (name, html) => { if (!EVID) return; mkdirSync(EVID, { recursive: true }); writeFileSync(path.join(EVID, name), `<!doctype html><meta charset="utf-8"><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;max-width:720px">${html}</body>`); };

test('S2a. utilisation uses the accepted formula with caps read from status (Codex counterexample state)', () => {
  const { ab } = androidBridge();
  const ctx = chain(ab);
  const u = ctx.m0Utilization(CAP());
  assert.equal(u.known, true);
  assert.equal(u.u_count, 774 / 4000);
  assert.equal(u.u_bytes, (301773 + 448 * 774 + 128) / (2500000 - 768));
  assert.equal(u.u, Math.max(u.u_count, u.u_bytes));
  assert.ok(Math.abs(u.u - 0.2595409309739952) < 1e-15);
  const h = card(ctx);
  assert.match(h, /active 774 \/ 4000/);
  assert.match(h, /sealed ledger 301773 B, reserve-inclusive 648653 \/ 2499232 B/);
  assert.match(h, /<b>U 25\.95%<\/b>/);
  assert.match(h, /capacity rejected 0 · identity conflicts 0 · byte-cap refusals \(this process\) 0 · integrity BACKLOG · ledger written 2 min ago/);
  assert.doesNotMatch(h, /0\.38324|0\.21676|U_eff/);   // non-accepted model figures never shown
  // caps come from status: a different cap changes U
  assert.equal(ctx.m0Utilization(CAP({ capacity: 774 })).u, 1);
  save('status_known.html', h);
});

test('S2b. unknown / malformed / corrupt capacity is explicit, never zero', () => {
  for (const [cap, re] of [[null, /not available in the installed app/], [CAP({ known: false, integrity: 'LEDGER_CORRUPT', reason: 'ledger_unreadable:digest_mismatch', active: null }), /LEDGER_CORRUPT \(ledger_unreadable:digest_mismatch\)/],
    [CAP({ ledger_bytes: '301773' }), /malformed ledger_bytes/],
    [CAP({ counts: { STAGED: 774, LAG_EXCEEDED: 0, ARCHIVE_ACKED: 0, RELEASED: 0, UNRECOGNISED: 1 } }), /unsupported ledger state UNRECOGNISED/],
    [CAP({ known: undefined }), /not marked known/], [CAP({ counts: { STAGED: 1, LAG_EXCEEDED: 0, ARCHIVE_ACKED: 0, RELEASED: 0 } }), /active does not equal/],
    [CAP({ known: false, integrity: 'MALFORMED', reason: 'entry_state_unsupported:UNRECOGNISED', active: null, u: null }), /MALFORMED \(entry_state_unsupported:UNRECOGNISED\)/], [CAP({ active: -1 }), /malformed active/], [CAP({ capacity: undefined }), /malformed capacity/], [CAP({ active: 1.5 }), /malformed active/]]) {
    const { ab } = androidBridge({ cap });
    const h = card(chain(ab));
    assert.match(h, /Capacity: UNKNOWN — /); assert.match(h, re);
    assert.doesNotMatch(h, /U 0\.00%|<b>U /);
    if (cap && cap.known === false) save('status_unknown_corrupt.html', h);
  }
});

test('S2c. toggle shows the actual readback and touches only the research collector', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  ctx.m0SetResearchEnabled(false);
  let h = card(ctx);
  assert.match(h, /Requested off · app reads back off/);
  assert.match(h, /Market polling, position monitoring and evening evaluation are not affected/);
  assert.equal(d.calls.filter((c) => c[0] === 'MARKET').length, 0);
  assert.deepEqual([...new Set(d.calls.map((c) => c[0]))].sort(), ['get', 'set']);
  save('toggle_off_readback.html', h);
  // native refuses (stuck): the card says so instead of echoing the request
  const s = androidBridge({ stuck: true });
  const c2 = chain(s.ab);
  c2.m0SetResearchEnabled(false);
  h = card(c2);
  assert.match(h, /Requested off · app reads back on — NOT applied/);
});

test('S2d. export button forwards PWA identity through the real facade; result callback renders verified state', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  ctx.m0ExportResearch();
  assert.deepEqual(JSON.parse(d.exportArgs[0]), { version: '2.6.83', build: 514, app_js_v: 1378 });
  assert.match(card(ctx), /Export: PICKER_OPENING/);
  assert.equal(d.calls.filter((c) => c[0] === 'set' || c[0] === 'MARKET').length, 0, 'export never toggles or touches market');
  ctx.m0OnResearchExportResult(JSON.stringify({ status: 'COMPLETE_VERIFIED', zip_sha256: 'ab'.repeat(32), zip_bytes: 95525,
    readback: { ok: true, files_verified: 87 }, evidence_status: 'NO_FINDINGS' }));
  let h = card(ctx);
  assert.match(h, /Export: COMPLETE_VERIFIED · zip sha256 (ab){32} · 95525 B · readback verified \(87 files\)/);
  save('export_verified.html', h);
  ctx.m0OnResearchExportResult(JSON.stringify({ status: 'CANCELLED', partial_output: 'DOCUMENT_INCOMPLETE_NOT_VALID' }));
  assert.match(card(ctx), /CANCELLED · the saved document is INCOMPLETE and not valid evidence/);
  ctx.m0OnResearchExportResult(JSON.stringify({ status: 'COMPLETE_VERIFIED', evidence_status: 'FINDINGS_REPORTED', corrupt_count: 1, missing_reference_count: 2, readback: { ok: true, files_verified: 9 } }));
  h = card(ctx);
  assert.match(h, /evidence findings: FINDINGS_REPORTED \(corrupt 1, missing refs 2\) — exported as-is, not repaired/);
  save('export_findings.html', h);
  ctx.m0OnResearchExportResult('{bad');
  assert.match(card(ctx), /MALFORMED_RESULT/);
});

test('S2e. older APK without export: explicit unavailable via facade, no crash', () => {
  const { ab } = androidBridge({ omit: ['exportResearchEvidence', 'getResearchExportResult', 'cancelResearchExport'] });
  const ctx = chain(ab);
  assert.equal(JSON.parse(ctx.NativeBridge.exportResearchEvidence('{}')).reason, 'NATIVE_METHOD_ABSENT');
  ctx.m0ExportResearch();
  assert.match(card(ctx), /Export: UNAVAILABLE/);
});

test('S2f. status card renders without any export having run', () => {
  const { ab, d } = androidBridge();
  const h = card(chain(ab));
  assert.match(h, /Capacity: active/);
  assert.doesNotMatch(h, /Export:/);
  assert.deepEqual(d.calls, [['get']]);
});
