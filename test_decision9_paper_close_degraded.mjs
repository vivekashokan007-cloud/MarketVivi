import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Owner decision 9 (2026-09-26): Paper manual close is allowed after one bounded
// native refresh, labelled close_quote_quality=DEGRADED with a reason.
const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function paperCloseQuoteValidityAccepted');
const end = src.indexOf('\nasync function requestFreshPaperCloseQuote', start);
assert.ok(start > 0 && end > start);
const sb = {};
vm.createContext(sb);
vm.runInContext(src.slice(start, end) + '\nthis.f = paperCloseQuoteValidityAccepted;', sb);
const f = sb.f;
assert.equal(f({}), true);                                     // older APK
assert.equal(f({ quote_validity_state: null }), true);
assert.equal(f({ quote_validity_state: 'VALID', close_quote_quality: 'VALID' }), true);
assert.equal(f({ quote_validity_state: 'INVALID' }), false);   // B3-era APK: still rejected
assert.equal(f({ quote_validity_state: 'INVALID', close_quote_quality: 'DEGRADED' }), false);
assert.equal(f({ quote_validity_state: 'INVALID', close_quote_quality: 'DEGRADED', close_quote_degraded_reason: '  ' }), false);
assert.equal(f({ quote_validity_state: 'INVALID', close_quote_quality: 'VALID', close_quote_degraded_reason: 'x' }), false);
assert.equal(f({ quote_validity_state: 'INVALID', close_quote_quality: 'DEGRADED',
  close_quote_degraded_reason: 'quote_invalid_after_one_refresh:leg:NSE_FO|69802:source_stale' }), true);
assert.equal(f({ quote_validity_state: 'WEIRD', close_quote_quality: 'DEGRADED', close_quote_degraded_reason: 'x' }), false);
// Persisted + surfaced.
assert.match(src, /close_quote_quality: paperCloseQuote\.close_quote_quality \?\? null/);
assert.match(src, /close_quote_degraded_reason: paperCloseQuote\.close_quote_degraded_reason \?\? null/);
assert.match(src, /DEGRADED close quote \(still invalid after one refresh\)/);
console.log('decision 9 PWA degraded close checks OK');
