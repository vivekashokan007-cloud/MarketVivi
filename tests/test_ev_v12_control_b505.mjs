// b505 (Codex revised A, evidence item 1): persistent "EV experiment (Paper only)" control.
// Runs the actual app.js EV block in a vm (tests/ev12_harness.mjs) against a native stand-in that mirrors
// EvExperiment.status / EvExperiment.setMode (Kotlin, 2.6.74).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sandbox, src } from './ev12_harness.mjs';

const VER = 'ev_k_v1_2_live:p2026-10-13:3e2a3f7ed322';

/** Mirrors EvExperiment.kt: prefs + execution mode; Off/Observe only, Paper only, readback. */
function device({ mode = null, exec = 'paper', cache = false, attempt = null, stored = null } = {}) {
  const d = {
    prefs: { mode }, exec, cache, attempt, stored, sets: [], statusCalls: 0, throwStatus: false, ignoreWrites: false,
    resolved() { const m = String(d.prefs.mode ?? 'off').trim().toLowerCase(); return ['observe', 'active'].includes(m) ? m : 'off'; },
    evGetMode() { return d.resolved(); },
    evGetStatus() {
      d.statusCalls++;
      if (d.throwStatus) throw new Error('bridge died');
      return JSON.stringify({
        schema: 'ev_native_status_v1', mode: d.resolved(),
        mode_stored: d.prefs.mode == null ? 'UNSET' : (['off', 'observe', 'active'].includes(String(d.prefs.mode).trim().toLowerCase()) ? 'RECOGNIZED' : 'UNRECOGNIZED'),
        execution_mode: d.exec, experiment_applies: d.exec === 'paper' && d.resolved() !== 'off',
        selectable_modes: ['off', 'observe'], can_change: d.exec === 'paper',
        cache_present: !!d.cache, cache_parse: d.cache ? 'PARSED' : 'ABSENT',
        cached_calibration_version: d.cache ? (d.cache.version ?? VER) : null,
        cached_available_at: d.cache ? '2026-10-14T17:28:01.478722+05:30' : null,
        last_fetch_attempt_ms: d.attempt, cache_stored_ms: d.stored, fetch_success_recorded: d.stored != null,
        native_validation: 'NOT_PERFORMED', app_version: '2.6.74' });
    },
    evSetMode(m) {
      d.sets.push(m);
      if (d.exec === 'paper' && ['off', 'observe'].includes(m) && !d.ignoreWrites) d.prefs.mode = m;
      return d.resolved();
    },
  };
  return d;
}

function setup(dev, extra = {}) {
  const ctx = sandbox({ ...extra });
  if (dev === undefined) delete ctx.NativeBridge; else ctx.NativeBridge = dev;
  return ctx;
}
const html = (ctx) => ctx._els['ev12-control'].innerHTML;
const render = (ctx) => { ctx.renderEvControl(); return html(ctx); };
const enabled = (h, label) => new RegExp(`ev12SetMode\\('${label}'\\)"(?! disabled)`).test(h);

test('Off is visible before any EV result, read from the device (not assumed)', () => {
  const dev = device();
  const ctx = setup(dev);
  assert.equal(ctx.bd.implied_ev_v12, undefined);
  const h = render(ctx);
  assert.match(h, /EV experiment \(Paper only\)/);
  assert.match(h, /Device EV mode:<\/span> Off/);
  assert.ok(dev.statusCalls >= 1);
  assert.match(h, /Calibration cache:<\/span> absent/);
  assert.match(h, /Last fetch attempt:<\/span> none/);
  assert.match(h, /Latest validation:<\/span> Not yet validated/);
  assert.match(h, /Switching Off does not close existing positions or erase experiment journals/);
  assert.ok(enabled(h, 'off') && enabled(h, 'observe'));
});

test('explicit Observe writes via native and is confirmed by readback; refused write shows no false success', () => {
  const dev = device();
  const ctx = setup(dev);
  render(ctx);
  assert.equal(ctx.ev12SetMode('observe'), true);
  assert.deepEqual(dev.sets, ['observe']);
  assert.equal(dev.prefs.mode, 'observe');
  assert.match(html(ctx), /Saved: Observe \(read back from the device\)/);
  assert.match(html(ctx), /Device EV mode:<\/span> Observe/);
  const dev2 = device(); dev2.ignoreWrites = true;
  const ctx2 = setup(dev2);
  assert.equal(ctx2.ev12SetMode('observe'), false);
  assert.match(html(ctx2), /Change not confirmed: device reports Off/);
  assert.doesNotMatch(html(ctx2), /Saved/);
});

test('render / reload / restore never writes the experiment preference', () => {
  const dev = device();
  for (let i = 0; i < 5; i++) { const ctx = setup(dev); render(ctx); ctx.renderEvExperiment(); }
  assert.deepEqual(dev.sets, []);
  assert.equal(dev.prefs.mode, null);
  // Static wiring: evSetMode is reached only from the explicit ev12SetMode handler (button onclick).
  const calls = [...src.matchAll(/NativeBridge\.evSetMode\(/g)].length;
  assert.equal(calls, 1);
  const fn = src.slice(src.indexOf('function ev12SetMode('), src.indexOf('async function ev12PollAcceptance('));
  assert.match(fn, /NativeBridge\.evSetMode\(mode\)/);
  assert.doesNotMatch(src, /localStorage[^\n]*ev12|ev12[^\n]*localStorage|evExperimentMode[^\n]*localStorage/);
  const boot = src.slice(src.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(boot.slice(0, 2500), /renderEvControl\(\)/);
  assert.doesNotMatch(boot, /ev12SetMode\(|evSetMode\(/);
});

test('absent bridge, older APK and throwing/invalid status show Unavailable and disable the setter', () => {
  const cases = [
    [setup(undefined), /Not running inside the Market Radar app/],
    [setup({ evGetMode: () => 'off', evSetMode: () => 'off' }), /predates 2\.6\.74/],
    [setup(Object.assign(device(), { throwStatus: true })), /could not report/],
    [setup({ evGetStatus: () => '{"schema":"other"}' }), /could not report/],
    [setup({ evGetStatus: () => '{"schema":"ev_native_status_v1","error":"STATUS_UNAVAILABLE"}' }), /could not report/],
    [setup({ evGetStatus: () => 'not json' }), /could not report/],
  ];
  for (const [ctx, why] of cases) {
    const h = render(ctx);
    assert.match(h, /Device EV mode:<\/span> Unknown — native status unavailable/);
    assert.match(h, why);
    assert.doesNotMatch(h, /Device EV mode:<\/span> Off/);
    assert.ok(!enabled(h, 'off') && !enabled(h, 'observe'));
    assert.equal(ctx.ev12SetMode('observe'), false);
    assert.match(html(ctx), /Not changed: native status unavailable/);
  }
  const old = { sets: [], evGetMode: () => 'off', evSetMode(m) { old.sets.push(m); return m; } };
  const ctx = setup(old); ctx.ev12SetMode('observe');
  assert.deepEqual(old.sets, []);                       // older APK: never written through the legacy setter
});

test('Real disables setters (status still shown); Active cannot be newly enabled; existing Active stays honest', () => {
  const real = device({ exec: 'live', mode: 'observe' });
  const ctx = setup(real);
  const h = render(ctx);
  assert.match(h, /Execution mode:<\/span> Real/);
  assert.match(h, /Device EV mode:<\/span> Observe/);
  assert.match(h, /changes are disabled outside Paper execution/);
  assert.ok(!enabled(h, 'off') && !enabled(h, 'observe'));
  assert.equal(ctx.ev12SetMode('off'), false);
  assert.deepEqual(real.sets, []);
  assert.equal(real.prefs.mode, 'observe');
  // Active: no control offers it, and the handler refuses it.
  const dev = device();
  const c2 = setup(dev);
  assert.doesNotMatch(render(c2), /ev12SetMode\('active'\)/);
  assert.equal(c2.ev12SetMode('active'), false);
  assert.deepEqual(dev.sets, []);
  const act = device({ mode: 'active' });
  const h3 = render(setup(act));
  assert.match(h3, /Device EV mode:<\/span> Active \(set earlier — awaiting its separate acceptance stage; not changed here\)/);
  assert.doesNotMatch(h3, /Device EV mode:<\/span> Off/);
  assert.equal(act.prefs.mode, 'active');
  // unrecognized stored value is shown as such
  assert.match(render(setup(device({ mode: 'weird' }))), /stored value unrecognized → treated as Off/);
});

test('cache and fetch labels are honest: attempt is not success; validation only for this publication + poll', () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0);
  // retained old cache + recent attempt, no store time (2.6.73-era cache)
  let ctx = setup(device({ mode: 'observe', cache: {}, attempt: now }));
  let h = render(ctx);
  assert.match(h, new RegExp(`Calibration cache:<\\/span> present — ${VER.replace(/[.:]/g, '\\$&')}`));
  assert.match(h, /Cache stored:<\/span> not recorded/);
  assert.match(h, /Last fetch attempt:<\/span> [^<]*IST \(an attempt, not proof of a successful refresh\)/);
  assert.doesNotMatch(h, /fetched|Fetched|refreshed at/);
  assert.match(h, /Latest validation:<\/span> Not yet validated/);
  // validation from a poll for a DIFFERENT publication is not shown
  ctx = setup(device({ mode: 'observe', cache: {}, attempt: now, stored: now - 60000 }));
  ctx.bd.implied_ev_v12 = { source_label: 'IMPLIED_EV_V12_EXPERIMENT', mode: 'observe', calibration_check: { calibration_version: 'other:v', status: 'OK', poll_ms: now } };
  assert.match(render(ctx), /Latest validation:<\/span> Not yet validated/);
  // validation from a poll BEFORE the cache was stored is not shown
  ctx.bd.implied_ev_v12.calibration_check = { calibration_version: VER, status: 'OK', poll_ms: now - 120000 };
  assert.match(render(ctx), /Latest validation:<\/span> Not yet validated/);
  // same publication, later poll -> shown with its own status
  ctx.bd.implied_ev_v12.calibration_check = { calibration_version: VER, status: 'NO_CALIBRATION_STALE', poll_ms: now };
  assert.match(render(ctx), /Latest validation:<\/span> NO_CALIBRATION_STALE \(poll /);
});

test('all status text is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const dev = device({ mode: 'observe', cache: { version: evil }, attempt: 1 });
  dev.exec = 'paper';
  const ctx = setup(dev);
  ctx.bd.implied_ev_v12 = { source_label: 'IMPLIED_EV_V12_EXPERIMENT', calibration_check: { calibration_version: evil, status: '<b>x</b>', poll_ms: 2 } };
  const h = render(ctx);
  assert.doesNotMatch(h, /<img|<b>x/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  const exec = device({ exec: '<script>' });
  assert.doesNotMatch(render(setup(exec)), /<script>/);
});

test('index.html hosts the persistent control above the EV card', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<div id="ev12-control"><\/div>\s*<div id="ev12-card"><\/div>/);
});
