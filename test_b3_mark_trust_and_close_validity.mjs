import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// B3 + A1 (2026-09-26): PWA surfaces native mark trust and requires per-leg
// quote validity for Paper manual close when a newer APK publishes it.
const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function reconcilePaperPositionMarks');
const end = src.indexOf('\nfunction validDateOrBlank', start);
const sandbox = { Number, String, Array, Object, Date, asFiniteNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; } };
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end), sandbox);

const base = [{ id: 276, paper: true, current_pnl: null, valuation_quality: 'unavailable' }];
// Untrusted, never validated: P&L untouched, label surfaced.
const u = sandbox.reconcilePaperPositionMarks(base, { '276': {
  display_state: 'UNAVAILABLE', last_valid_current_pnl: null,
  mark_trust_state: 'UNTRUSTED', mark_trust_cause: 'WIDE_LIQUIDATION_BOOK', quote_validity_state: 'VALID' } });
assert.equal(u[0].current_pnl, null);
assert.equal(u[0].position_mark_trust_state, 'UNTRUSTED');
assert.equal(u[0].position_mark_trust_cause, 'WIDE_LIQUIDATION_BOOK');
assert.equal(u[0].positionDataDegraded, true);
// Untrusted latest with an older trusted last-valid: stale display, still labelled.
const s = sandbox.reconcilePaperPositionMarks(base, { '276': {
  display_state: 'STALE_LAST_VALID', last_valid_current_pnl: -7000,
  mark_trust_state: 'UNTRUSTED', mark_trust_cause: 'UNRESOLVED' } });
assert.equal(s[0].current_pnl, -7000);
assert.equal(s[0].valuation_quality, 'stale');
assert.equal(s[0].position_mark_trust_state, 'UNTRUSTED');
// Legacy mark without trust fields: unchanged behaviour (no trust keys).
const l = sandbox.reconcilePaperPositionMarks(base, { '276': { display_state: 'LIVE_FULL', last_valid_current_pnl: 10 } });
assert.equal(l[0].position_mark_trust_state, undefined);
// Real: untouched even with trust fields.
const r = sandbox.reconcilePaperPositionMarks([{ id: 9, paper: false, current_pnl: 5 }], { '9': {
  display_state: 'UNAVAILABLE', mark_trust_state: 'UNTRUSTED' } });
assert.equal(r[0].position_mark_trust_state, undefined);
assert.equal(r[0].current_pnl, 5);

// Manual close contract.
assert.match(src, /QUOTE_SOURCE_INVALID: '/);
assert.match(src, /&& paperCloseQuoteValidityAccepted\(row\)/);
assert.match(src, /quote_validity_state: paperCloseQuote\.quote_validity_state \?\? null/);
assert.match(src, /MARK UNTRUSTED/);
console.log('B3 PWA mark trust / close validity checks OK');
