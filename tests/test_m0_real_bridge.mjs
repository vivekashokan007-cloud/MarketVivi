// M0 Batch 1 W1 (Codex R1, equivalent of review_m0/counterexamples/real_bridge.mjs, which was not in the handoff):
// the sandbox starts with AndroidBridge ONLY; the REAL injected facade from Marketapp's MainActivity.kt creates
// window.NativeBridge; the REAL app.js research card then runs on top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

const STATUS = { schema: 'research_m0_collector_v2:status', enabled: false, label: 'DISABLED', collection_start: null,
  calendar_version: 'research_m0_cal_v2', sessions: [], envelopes_today: {}, protection: { integrity: 'NO_EVIDENCE' }, conflicts_total: 0, failures: {} };

function androidBridge({ omit = [] } = {}) {
  const d = { enabled: false, calls: [] };
  const st = () => JSON.stringify(Object.assign({}, STATUS, { enabled: d.enabled, label: d.enabled ? 'ENABLED_NOT_CAPTURING' : 'DISABLED' }));
  const ab = {
    isNative: () => true,
    getResearchCollectorStatus() { d.calls.push(['get']); return st(); },
    setResearchCollectorEnabled(on) { d.calls.push(['set', on]); d.enabled = on; return st(); },
  };
  for (const k of omit) delete ab[k];
  return { ab, d };
}

function chain(ab, js = FACADE_JS) {
  const ctx = sandbox({});
  delete ctx.NativeBridge;
  ctx.AndroidBridge = ab;
  assert.equal(ctx.NativeBridge, undefined);
  F.runFacade(ctx, js);
  return ctx;
}
const card = (ctx) => { ctx.renderResearchCollector(); return ctx._els['research-m0'].innerHTML; };

test('W1a. the real facade exposes both research methods (AndroidBridge-only startup)', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  assert.equal(typeof ctx.NativeBridge.getResearchCollectorStatus, 'function');
  assert.equal(typeof ctx.NativeBridge.setResearchCollectorEnabled, 'function');
  const h = card(ctx);
  assert.match(h, /Full-day research — collector off/);
  assert.deepEqual(d.calls, [['get']], 'render reads status only, never writes');
});

test('W1b. enable/disable forwarding and return values through the real wrapper', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  const r = JSON.parse(ctx.NativeBridge.setResearchCollectorEnabled(true));
  assert.equal(r.enabled, true); assert.equal(r.label, 'ENABLED_NOT_CAPTURING');
  assert.deepEqual(d.calls.at(-1), ['set', true]);
  assert.equal(typeof d.calls.at(-1)[1], 'boolean');
  ctx.m0SetResearchEnabled(false);
  assert.deepEqual(d.calls.find((c) => c[0] === 'set' && c[1] === false), ['set', false]);
  assert.match(card(ctx), /collector off/);
  ctx.m0SetResearchEnabled(true);
  assert.match(card(ctx), /enabled, not currently capturing/);
});

test('W1c. older APK: AndroidBridge without the methods -> explicit unavailable state, no crash', () => {
  const { ab, d } = androidBridge({ omit: ['getResearchCollectorStatus', 'setResearchCollectorEnabled'] });
  const ctx = chain(ab);
  const st = ctx.m0ResearchStatus();
  assert.equal(st.available, false); assert.equal(st.reason, 'NATIVE_METHOD_ABSENT');
  assert.match(card(ctx), /status unknown/);
  assert.doesNotThrow(() => ctx.m0SetResearchEnabled(true));
  assert.equal(d.calls.length, 0);
});

test('W1d. older APK facade (no research entries at all) -> OLDER_APK_NO_STATUS, no crash', () => {
  const { ab } = androidBridge();
  const stripped = FACADE_JS.replace(/\/\/ M0 full-day research collector[\s\S]*?setResearchCollectorEnabled: function\(on\) \{[\s\S]*?\n\s*\},\n/, '');
  assert.ok(stripped.length < FACADE_JS.length && !/ResearchCollector/.test(stripped));
  const ctx = chain(ab, stripped);
  assert.equal(typeof ctx.NativeBridge.getResearchCollectorStatus, 'undefined');
  assert.equal(ctx.m0ResearchStatus().reason, 'OLDER_APK_NO_STATUS');
  assert.match(card(ctx), /not available in the installed app/);
  assert.doesNotThrow(() => ctx.m0SetResearchEnabled(true));
});
