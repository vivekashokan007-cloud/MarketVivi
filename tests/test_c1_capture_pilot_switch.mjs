// C1 capture pilot switch (candidate-only research evidence; default OFF). Runs the REAL app.js section and, for the
// chain test, the REAL injected facade from Marketapp's MainActivity.kt (MARKETAPP_DIR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('// ── C1 capture pilot (CANDIDATE builds only');
const end = src.indexOf('// ── end C1 capture pilot');
assert.ok(start > 0 && end > start);
const code = src.slice(start, end);

function load(native) {
  const el = { innerHTML: '' };
  const ctx = { JSON, Object, String, document: { getElementById: (id) => (id === 'c1-capture' ? el : null) } };
  if (native !== undefined) ctx.NativeBridge = native;
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.c1PilotView = c1PilotView; this.c1PilotStatus = c1PilotStatus; this.renderC1Pilot = renderC1Pilot; this.c1SetPilotEnabled = c1SetPilotEnabled;', ctx);
  return { ctx, el };
}
const status = (o) => JSON.stringify(Object.assign({ schema: 'c1_capture_pilot_status_v1', available: true, candidate_build: true,
  enabled: false, gate: 'PILOT_DISABLED', paper_mode: true, label: 'PILOT_DISABLED', evidence_only: true }, o));

/** Native double that records EVERY property access, so any non-C1 call would be visible. */
function native(initial = {}) {
  const d = { enabled: false, candidate: true, mode: 'paper', calls: [] };
  Object.assign(d, initial);
  const gate = () => !d.candidate ? 'NOT_CANDIDATE_BUILD' : !d.enabled ? 'PILOT_DISABLED' : d.mode !== 'paper' ? 'NOT_PAPER_MODE' : null;
  const impl = {
    getC1CapturePilotStatus: () => status({ candidate_build: d.candidate, enabled: d.candidate && d.enabled, gate: gate() }),
    getC1CapturePilotEnabled: () => d.candidate && d.enabled,
    setC1CapturePilotEnabled: (on) => { if (d.candidate) d.enabled = on === true; return impl.getC1CapturePilotStatus(); },
  };
  const nb = new Proxy({}, { get(_t, k) { if (typeof k === 'string') d.calls.push(k); return impl[k]; } });
  return { nb, d };
}

test('hidden when not a candidate build, without a bridge, on an older APK, or on malformed status', () => {
  assert.equal(load().ctx.c1PilotStatus().reason, 'NO_NATIVE_BRIDGE');
  assert.equal(load({}).ctx.c1PilotStatus().reason, 'NATIVE_METHOD_ABSENT');
  assert.equal(load({ getC1CapturePilotStatus: () => '{"x":1}' }).ctx.c1PilotStatus().reason, 'MALFORMED');
  assert.equal(load({ getC1CapturePilotStatus: () => { throw new Error('x'); } }).ctx.c1PilotStatus().reason, 'STATUS_ERROR');
  for (const nbv of [undefined, {}, { getC1CapturePilotStatus: () => 'not json' }, native({ candidate: false }).nb,
                     { getC1CapturePilotStatus: () => '{"available":false,"reason":"NATIVE_METHOD_ABSENT"}' }]) {
    const { ctx, el } = load(nbv);
    el.innerHTML = 'stale';
    ctx.renderC1Pilot();
    assert.equal(el.innerHTML, '', 'nothing rendered');
  }
});

test('candidate build: default OFF with a clear off status and an "on" button', () => {
  const { nb } = native();
  const { ctx, el } = load(nb);
  ctx.renderC1Pilot();
  assert.match(el.innerHTML, /Paper capture \(C1 research\) — OFF · candidate build/);
  assert.match(el.innerHTML, /Off — nothing is captured\./);
  assert.match(el.innerHTML, /c1SetPilotEnabled\(true\)/);
  assert.match(el.innerHTML, /Turn Paper capture on/);
  assert.match(el.innerHTML, /does not change manual Paper, admission, ranking, exits or Real/);
});

test('toggling calls the bridge; the status shown is the getter readback, not the request', () => {
  const { nb, d } = native();
  const { ctx, el } = load(nb);
  ctx.c1SetPilotEnabled(true);
  assert.equal(d.enabled, true);
  assert.match(el.innerHTML, /— ON · candidate build/);
  assert.match(el.innerHTML, /On — capturing exact-contract quote evidence/);
  assert.match(el.innerHTML, /Requested on · app reads back on/);
  ctx.c1SetPilotEnabled(false);
  assert.equal(d.enabled, false);
  assert.match(el.innerHTML, /— OFF/);
  assert.match(el.innerHTML, /Requested off · app reads back off/);
  // only C1 pilot methods were ever touched: no Paper, admission, single-leg, EV or Real call
  assert.deepEqual([...new Set(d.calls)].sort(), ['getC1CapturePilotEnabled', 'getC1CapturePilotStatus', 'setC1CapturePilotEnabled']);
});

test('status reflects the native getter: on but not Paper is a visible waiting state; a refused set is flagged', () => {
  const { nb, d } = native({ enabled: true, mode: 'real' });
  const { ctx, el } = load(nb);
  ctx.renderC1Pilot();
  assert.match(el.innerHTML, /— ON/);
  assert.match(el.innerHTML, /On, waiting — Paper mode is not active, so nothing is captured\./);
  assert.doesNotMatch(el.innerHTML, /capturing exact-contract/);
  const stuck = { getC1CapturePilotStatus: () => status({ enabled: false }), getC1CapturePilotEnabled: () => false, setC1CapturePilotEnabled: () => '' };
  const s = load(stuck);
  s.ctx.c1SetPilotEnabled(true);
  assert.match(s.el.innerHTML, /Requested on · app reads back off — NOT applied/);
  assert.equal(d.calls.includes('setC1CapturePilotEnabled'), false, 'rendering never sets');
});

test('escapes native strings', () => {
  const { ctx } = load();
  const html = ctx.c1PilotView({ available: true, candidate_build: true, enabled: true, gate: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/);
});

test('wired into the Trade tab and the boot + snapshot renders; Paper/admission code untouched by the section', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="c1-capture"><\/div>\s*<div id="research-m0"><\/div>/);
  assert.match(src, /try \{ renderC1Pilot\(\); \} catch \(e\) \{ console\.warn\('\[boot\] C1 pilot render failed:/);
  assert.match(src, /try \{ renderC1Pilot\(\); \} catch \(e\) \{ console\.warn\('\[C1\] pilot render failed:/);
  for (const forbidden of ['singleLeg', 'SingleLeg', 'admit', 'setTradeMode', 'evSet', 'paper_trades', 'supabase'])
    assert.ok(!code.includes(forbidden), `C1 section must not reference ${forbidden}`);
  assert.ok(!/NativeBridge\.(?!getC1CapturePilotStatus|getC1CapturePilotEnabled|setC1CapturePilotEnabled)\w+\(/.test(code), 'only C1 bridge calls');
});

test('real injected facade (MARKETAPP_DIR) carries the switch end to end', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const MA = path.resolve(process.env.MARKETAPP_DIR || path.join(here, '..', '..', 'Marketapp'));
  const FACADE = path.join(MA, 'tools', 'bridge_facade', 'facade.mjs');
  assert.ok(fs.existsSync(FACADE), `Marketapp checkout required at ${MA}`);
  process.env.MARKETAPP_DIR = MA;
  const F = await import(pathToFileURL(FACADE).href);
  const { d } = native();
  const calls = [];
  const ab = {
    getC1CapturePilotStatus: () => { calls.push('status'); return status({ enabled: d.enabled, gate: d.enabled ? null : 'PILOT_DISABLED' }); },
    getC1CapturePilotEnabled: () => { calls.push('get'); return d.enabled; },
    setC1CapturePilotEnabled: (on) => { calls.push(['set', on]); d.enabled = on; },
  };
  const fctx = { AndroidBridge: ab };
  const js = F.extractFacadeJs();
  const nbReal = F.runFacade(fctx, js);
  const { ctx, el } = load(nbReal);
  ctx.renderC1Pilot();
  if (!js.includes('getC1CapturePilotStatus')) {
    // compatibility run against a production (pre-C1-switch) native facade: the switch must simply be absent
    assert.equal(el.innerHTML, '');
    assert.deepEqual(calls, []);
    return;
  }
  assert.match(el.innerHTML, /— OFF/);
  ctx.c1SetPilotEnabled(true);
  assert.equal(d.enabled, true);
  assert.match(el.innerHTML, /— ON[\s\S]*Requested on · app reads back on/);
  assert.deepEqual(calls.filter(c => Array.isArray(c)), [['set', true]]);
  // an older APK facade (no C1 methods) hides the switch
  const old = load(F.runFacade({ AndroidBridge: {} }, F.extractFacadeJs()));
  old.ctx.renderC1Pilot();
  assert.equal(old.el.innerHTML, '');
});
