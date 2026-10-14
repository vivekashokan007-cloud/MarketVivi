// b506 (Codex option A) regression test 3: the ACTUAL PWA chain. The sandbox starts with AndroidBridge only (a
// stand-in for the Kotlin @JavascriptInterface object, mirroring EvExperiment semantics); the REAL injected facade is
// extracted from Marketapp's MainActivity.kt and executed to create window.NativeBridge; then the REAL app.js EV code
// runs on top. No NativeBridge with EV methods is ever preinstalled.
// Needs a Marketapp checkout: MARKETAPP_DIR (CI checks it out), else the sibling ../Marketapp. Missing -> FAIL.
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
const VER = 'ev_k_v1_2_live:p2026-10-13:3e2a3f7ed322';

/** Kotlin-side stand-in: in-memory vs durable prefs, commit outcome, Paper authority, status + checked ack. */
function androidBridge({ mode = null, exec = 'paper', commit = 'ok', omit = [] } = {}) {
  const d = { mem: mode, disk: mode, exec, commit, calls: [] };
  const resolved = () => { const m = String(d.mem ?? 'off').trim().toLowerCase(); return ['observe', 'active'].includes(m) ? m : 'off'; };
  const ab = {
    isNative: () => true,
    evGetMode() { d.calls.push('evGetMode'); return resolved(); },
    evGetStatus() {
      d.calls.push('evGetStatus');
      return JSON.stringify({ schema: 'ev_native_status_v1', mode: resolved(), mode_stored: d.mem == null ? 'UNSET' : 'RECOGNIZED',
        execution_mode: d.exec, experiment_applies: d.exec === 'paper' && resolved() !== 'off', selectable_modes: ['off', 'observe'],
        can_change: d.exec === 'paper', cache_present: true, cache_parse: 'PARSED', cached_calibration_version: VER,
        cached_available_at: '2026-10-14T17:28:01.478722+05:30', last_fetch_attempt_ms: null, cache_stored_ms: null,
        fetch_success_recorded: false, native_validation: 'NOT_PERFORMED', app_version: '2.6.75' });
    },
    evSetMode(m) { d.calls.push('evSetMode'); return resolved(); },
    evSetModeChecked(m) {
      d.calls.push('evSetModeChecked');
      const prev = resolved();
      const ack = (ok, reason, persisted) => JSON.stringify({ schema: 'ev_set_ack_v1', ok, reason, requested: m,
        previous_mode: prev, effective_mode: resolved(), persisted, in_memory_changed: resolved() !== prev });
      if (d.exec !== 'paper') return ack(false, 'NOT_PAPER', null);
      if (!['off', 'observe'].includes(m)) return ack(false, m === 'active' ? 'ACTIVE_NOT_ENABLED' : 'INVALID_MODE', null);
      d.mem = m;
      if (d.commit === 'fail') return ack(false, 'PREFERENCE_WRITE_FAILED', false);
      d.disk = m;
      return ack(true, 'OK', true);
    },
    reload() { d.mem = d.disk; },
  };
  for (const k of omit) delete ab[k];
  return { ab, d };
}

/** Sandbox with AndroidBridge ONLY, then the real facade. */
function chain(ab, facadeJs = FACADE_JS) {
  const ctx = sandbox({});
  delete ctx.NativeBridge;                        // the harness default stand-in is removed
  ctx.AndroidBridge = ab;
  assert.equal(ctx.NativeBridge, undefined);
  F.runFacade(ctx, facadeJs);
  assert.equal(typeof ctx.NativeBridge, 'object');
  return ctx;
}
const html = (ctx) => ctx._els['ev12-control'].innerHTML;
const render = (ctx) => { ctx.renderEvControl(); return html(ctx); };

test('3a. Off status is read through the real facade from AndroidBridge', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  const h = render(ctx);
  assert.match(h, /Device EV mode:<\/span> Off/);
  assert.match(h, /Execution mode:<\/span> Paper/);
  assert.ok(d.calls.includes('evGetStatus'));
  assert.ok(!d.calls.some(c => c.startsWith('evSet')), 'render must not write');
});

test('3b. explicit Observe: durable success via evSetModeChecked, readback, survives restart', () => {
  const { ab, d } = androidBridge();
  const ctx = chain(ab);
  assert.equal(ctx.ev12SetMode('observe'), true);
  assert.match(html(ctx), /Saved: Observe \(persisted and read back from the device\)/);
  assert.ok(d.calls.includes('evSetModeChecked'));
  assert.ok(!d.calls.includes('evSetMode'), 'legacy string setter is never used');
  ab.reload();
  assert.match(render(chain(ab)), /Device EV mode:<\/span> Observe/);
});

test('3c. failed persistence with matching in-memory state is not Saved; restart shows durable Off', () => {
  const { ab } = androidBridge({ mode: 'off', commit: 'fail' });
  const ctx = chain(ab);
  assert.equal(ctx.ev12SetMode('observe'), false);
  assert.match(html(ctx), /Not saved persistently: the preference write failed\. Effective mode now: Observe \(in memory only/);
  assert.doesNotMatch(html(ctx), /Saved:/);
  ab.reload();
  assert.match(render(chain(ab)), /Device EV mode:<\/span> Off/);
});

test('3d. missing / old native capability: unavailable, setter disabled, no false version claim', () => {
  // (i) the released 2.6.74 facade had no ev forwarders: strip them from the real facade source
  const oldJs = FACADE_JS.split('\n').filter(l => !/^\s*ev[A-Z]\w*: function/.test(l)).join('\n');
  const { ab: ab1, d: d1 } = androidBridge();
  const c1 = chain(ab1, oldJs);
  const h1 = render(c1);
  assert.match(h1, /Device EV mode:<\/span> Unknown — native status unavailable/);
  assert.match(h1, /EV bridge support is unavailable[^<]*installed version not read/);
  assert.doesNotMatch(h1, /predates|older than/);
  assert.equal(c1.ev12SetMode('observe'), false);
  assert.deepEqual(d1.calls, []);
  // (ii) new facade, native object without the EV status/setter methods
  const { ab: ab2, d: d2 } = androidBridge({ omit: ['evGetStatus', 'evSetModeChecked'] });
  const c2 = chain(ab2);
  const h2 = render(c2);
  assert.match(h2, /Unknown — native status unavailable/);
  assert.doesNotMatch(h2, /ev12SetMode\('observe'\)"(?! disabled)/);
  assert.equal(c2.ev12SetMode('observe'), false);
  assert.ok(!d2.calls.some(c => c.startsWith('evSet')));
});

test('3e. Real execution: status visible through the facade, changes refused, Active never offered', () => {
  const { ab, d } = androidBridge({ exec: 'live', mode: 'observe' });
  const ctx = chain(ab);
  const h = render(ctx);
  assert.match(h, /Execution mode:<\/span> Real/);
  assert.doesNotMatch(h, /ev12SetMode\('active'\)/);
  assert.equal(ctx.ev12SetMode('off'), false);
  assert.equal(ctx.ev12SetMode('active'), false);
  assert.ok(!d.calls.some(c => c.startsWith('evSet')));
  assert.equal(d.mem, 'observe');
});
