// b507 real chain, stage 3 (Codex overnight-integrity conditions 4, 5, 9): Kotlin SessionInputs golden (native
// context + getOvernightInputState payloads, written by B507OvernightIntegrityTest) -> Python brain overnight stage
// golden (test_b507_real_chain.py) -> REAL app.js b507 renderer, reached through the REAL MainActivity facade with
// AndroidBridge only. Needs a Marketapp checkout: MARKETAPP_DIR (CI checks it out), else ../Marketapp. Missing -> FAIL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MA = path.resolve(process.env.MARKETAPP_DIR || path.join(here, '..', '..', 'Marketapp'));
const CHAIN = path.join(MA, 'tools', 'b507_chain');
assert.ok(existsSync(path.join(CHAIN, 'brain_output_golden.json')), `Marketapp b507 chain goldens required at ${CHAIN}`);
process.env.MARKETAPP_DIR = MA;
const F = await import(pathToFileURL(path.join(MA, 'tools', 'bridge_facade', 'facade.mjs')).href);
const NATIVE = JSON.parse(readFileSync(path.join(CHAIN, 'native_context_golden.json'), 'utf8'));
const BRAIN = JSON.parse(readFileSync(path.join(CHAIN, 'brain_output_golden.json'), 'utf8'));

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const a = src.indexOf('// ═══ B507 OVERNIGHT INPUT AUTHORITY');
const b = src.indexOf('// ═══ END B507 ═══');
assert.ok(a > 0 && b > a, 'b507 block present in app.js');
const BLOCK = src.slice(a, b);

/** AndroidBridge only -> real facade -> real app.js b507 block. */
function chain(nativeState) {
  const ab = new Proxy({}, { get: (_t, k) => (k === 'getOvernightInputState' ? () => JSON.stringify(nativeState)
    : (k === 'isNative' ? () => true : () => '{}')) });
  const ctx = { console, JSON, Number, String, Date, Array, Object, Math, AndroidBridge: ab };
  ctx.window = ctx;
  vm.createContext(ctx);
  F.runFacade(ctx);
  vm.runInContext(BLOCK, ctx);
  assert.equal(typeof ctx.NativeBridge.getOvernightInputState, 'function');
  return ctx;
}

/** What MarketWatchService attaches to the stored result (source-contract-tested in Kotlin). */
function result(brainCase, nativeState, extra = {}) {
  return { ...BRAIN[brainCase], input_identity: { ...BRAIN[brainCase].input_identity,
    input_revision: nativeState.input_revision, session: nativeState.session, ...extra } };
}

function render(ctx, res) {
  const st = ctx.b507ReadNativeInputState(ctx.NativeBridge);
  const model = ctx.b507OvernightCardModel(res, st);
  return { model, html: ctx.b507RenderOvernightCard(model) };
}

test('current: card shows the computed percentages and full provenance for the acknowledged pair', () => {
  const st = NATIVE.native_state_ok;
  const ctx = chain(st);
  const { model, html } = render(ctx, result('ok', st));
  assert.equal(model.kind, 'CURRENT');
  for (const pct of ['(+0.65%)', '(-2.4%)', '(+0.4%)']) assert.ok(html.includes(pct), pct);
  assert.ok(html.includes('Dow: 46000→46300'));
  assert.ok(html.includes(`pair ${st.pair_revision}`));
  assert.ok(html.includes('Session 2026-10-15'));
  assert.ok(html.includes('evening ref 2026-10-14 20:00 IST'));
  assert.ok(html.includes('morning lock 2026-10-15 09:05 IST'));
  assert.ok(html.includes('computed 2026-10-15 09:30 IST (poll 09:30)'));
  assert.equal(BRAIN.ok.overnightDelta.identity.pair_revision, st.pair_revision, 'python validated the same pair');
});

test('unavailable: missing evening reference and service-only rollover show a named reason and no numbers', () => {
  for (const [nativeKey, brainKey, reason] of [['native_state_no_evening', 'no_evening', 'NO_EVENING_REFERENCE'],
    ['native_state_rollover', 'rollover', 'MORNING_WRONG_SESSION']]) {
    const st = NATIVE[nativeKey];
    const ctx = chain(st);
    const { model, html } = render(ctx, result(brainKey, st));
    assert.equal(model.kind, 'UNAVAILABLE');
    assert.equal(model.reason, reason);
    assert.equal(BRAIN[brainKey].overnightDelta.reason, reason, 'python reached the same reason independently');
    assert.ok(html.includes('Overnight comparison unavailable'));
    assert.doesNotMatch(html, /%\)/);
  }
});

test('pending: a result for an older revision is never shown as current (save during/after analysis)', () => {
  const st = NATIVE.native_state_resaved;
  const ctx = chain(st);
  const old = result('ok', NATIVE.native_state_ok);
  const { model, html } = render(ctx, old);
  assert.equal(model.kind, 'PENDING');
  assert.equal(model.reason, 'RECALCULATING');
  assert.doesNotMatch(html, /%\)/);
  const waiting = chain({ ...st, refresh: { state: 'WAITING_FOR_POLL' } });
  const w = render(waiting, old);
  assert.ok(w.html.includes('waiting for the next poll'));
  // after the coalesced refresh publishes the newest revision, it is current again
  assert.equal(render(ctx, result('ok', st, { mode: 'REFRESH' })).model.kind, 'CURRENT');
  assert.ok(render(ctx, result('ok', st, { mode: 'REFRESH' })).html.includes('refresh of poll 09:30'));
});

test('historical: a pre-b507 result without identity is labelled historical', () => {
  const st = NATIVE.native_state_ok;
  const ctx = chain(st);
  const legacy = { overnightDelta: { summary: '🔴 OVERNIGHT BEARISH', signals: [{ name: 'Dow', from: 1, to: 2, pct: 1, dir: 'BULL' }] } };
  const { model, html } = render(ctx, legacy);
  assert.equal(model.kind, 'HISTORICAL');
  assert.ok(html.includes('HISTORICAL — not computed for the current inputs'));
});

test('saves: only an authoritative ack counts; failed or unconfirmed writes never show saved/locked', () => {
  const ctx = chain(NATIVE.native_state_ok);
  assert.equal(ctx.b507CheckedAck({ ok: false, error: 'SAVE_NOT_PERSISTED: evening was not saved; please retry' }, 'evening').ok, false);
  assert.match(ctx.b507CheckedAck({ ok: true }, 'morning').error, /install APK 2\.6\.76 \(b507\)/);   // old APK
  const okAck = ctx.b507CheckedAck({ ok: true, kind: 'evening', revision: 'r1', record: { dow: '46000' } }, 'evening');
  assert.equal(okAck.ok, true);
  assert.equal(ctx.b507CheckedAck({ ok: true, kind: 'evening', revision: 'r1', record: {} }, 'morning').ok, false);
});

test('lock: only a native morning record for today is a lock; restored drafts cannot claim one', () => {
  const ctx = chain(NATIVE.native_state_ok);
  const st = ctx.b507ReadNativeInputState(ctx.NativeBridge);
  assert.equal(ctx.b507MorningLockedToday(st, '2026-10-15'), true);
  assert.equal(ctx.b507MorningLockedToday(st, '2026-10-16'), false);
  assert.equal(ctx.b507MorningLockedToday({ status: 'MORNING_NOT_LOCKED', morning: null }, '2026-10-15'), false);
  const rows = ctx.b507MorningSummaryRows(st);
  assert.equal(JSON.stringify(rows.slice(0, 3).map(r => r[1])), '["46300","61","25300"]');
  // no b507 bridge -> no authority (legacy path), card states it
  const bare = { console, JSON, Number, String, Date, Array, Object, Math };
  vm.createContext(bare); vm.runInContext(BLOCK, bare);
  assert.equal(bare.b507ReadNativeInputState(undefined), null);
  assert.equal(bare.b507OvernightCardModel({}, null).reason, 'BRIDGE_UNAVAILABLE');
});

test('app.js wiring: card, lock, summary, saves and restore use the b507 authority', () => {
  assert.match(src, /\$\{b507RenderOvernightCard\(b507OvernightCardModel\(bd, b507ReadNativeInputState/);
  assert.match(src, /b507CheckedAck\(morningResult, 'morning'\)/);
  assert.match(src, /b507CheckedAck\(nativeResult, 'evening'\)/);
  assert.match(src, /if \(st\) return b507MorningLockedToday\(st, API\.todayIST\(\)\)/);
  assert.match(src, /Draft restored \(not saved for any session\)/);
  assert.doesNotMatch(src, /gd\.dowClose = parseFloat\(dowClose\);\s*\n\s*if \(typeof NativeBridge/);
  assert.doesNotMatch(src, /bd\.overnightDelta\.signals\.length > 0/);
});
