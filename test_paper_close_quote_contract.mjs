import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

assert.match(src, /requestFreshPaperCloseQuote\(tradeId\)/);
assert.match(src, /requestPaperCloseQuote/);
assert.match(src, /getPaperCloseQuote/);
assert.match(src, /paper_close_quote_v1/);
assert.match(src, /valuation_quality === 'OK'/);
assert.match(src, /mark_basis === 'EXECUTABLE'/);
assert.match(src, /Number\.isFinite\(Number\(row\[name\]\)\)/);
assert.match(src, /Date\.now\(\) < Number\(row\.expires_at_ms\)/);
assert.match(src, /QUOTE_INCOMPLETE/);
assert.match(src, /CROSSED_QUOTE/);
assert.match(src, /NON_POSITIVE_EXECUTABLE_QUOTE/);
assert.match(src, /Manual Paper close: fresh quote required/);

// The Paper path must not silently fall back to the periodic display mark.
const closeStart = src.indexOf('async function closeTrade');
const closeEnd = src.indexOf('\nfunction ', closeStart + 1);
assert.ok(closeStart >= 0 && closeEnd > closeStart, 'closeTrade not found');
const closeBody = src.slice(closeStart, closeEnd);
assert.match(closeBody, /await requestFreshPaperCloseQuote\(tradeId\)/);
assert.match(closeBody, /fresh quote is authoritative for this close only/);
assert.match(closeBody, /paper_close_quote:/);
assert.doesNotMatch(closeBody, /isPaper && .*current_premium.*fallback/i);

console.log('Paper close quote contract checks OK');
