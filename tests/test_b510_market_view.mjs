// b510 Batch A: the PWA market label uses ONLY the frozen synthesis view, never legacy `direction`.
// Runs the REAL app.js helpers (extracted verbatim) in a VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// ═══ B510 MARKET VIEW SEMANTICS ═══'), src.indexOf('// ═══ END B510 MARKET VIEW ═══'));
const ctx = { Number, String, Object };
vm.createContext(ctx);
vm.runInContext(block, ctx);

const aligned = {   // Codex acceptance probe after alignment: legacy direction is the BEAR lane.
  action: 'SELL PREMIUM', strategy: 'BEAR_CALL', direction: 'BEAR', execution_lane_direction: 'BEAR',
  market_direction: 'BULL', market_view_status: 'AVAILABLE', direction_semantics_version: 1,
  market_view_validated: false, market_bull_score: 1.55, market_bear_score: 0.15,
};

test('aligned probe: market BULL, strategy direction BEAR, label says unvalidated', () => {
  assert.equal(ctx.b510MarketViewLine(aligned), 'Market view: BULL · unvalidated, not a forecast');
  assert.match(ctx.b510StrategyDirectionLine(aligned), /^Strategy direction: BEAR · selected spread lane, not buy-call\/buy-put advice$/);
});

test('legacy payload without market fields shows unavailable, never the lane', () => {
  for (const legacy of [
    { action: 'SELL PREMIUM', strategy: 'BEAR_CALL', direction: 'BEAR' },
    { action: 'WAIT', direction: 'NEUTRAL', market_thesis: { direction: 'BEAR', strategy: 'BEAR_CALL' } },  // pre-b510 thesis
    { ...aligned, direction_semantics_version: undefined },          // unversioned
    { ...aligned, market_view_status: 'UNAVAILABLE' },
    { ...aligned, market_direction: 'UP' },                          // malformed
    null, undefined, 'BULL', [],
  ]) {
    assert.equal(ctx.b510MarketViewLine(legacy), 'Market view: unavailable', JSON.stringify(legacy));
    assert.equal(ctx.b510MarketView(legacy), null);
  }
});

test('warm-up / failed synthesis (UNAVAILABLE, null) displays unavailable, not NEUTRAL', () => {
  const warm = { action: 'WAIT', direction: 'NEUTRAL', market_direction: null, market_view_status: 'UNAVAILABLE',
    direction_semantics_version: 1, execution_lane_direction: null };
  assert.equal(ctx.b510MarketViewLine(warm), 'Market view: unavailable');
  assert.equal(ctx.b510StrategyDirectionLine(warm), '');
});

test('preserved b510 thesis is accepted after a forced WAIT', () => {
  const wait = { action: 'WAIT', direction: 'NEUTRAL', execution_lane_direction: null,
    market_thesis: { direction: 'BULL', market_direction: 'BULL', strategy: 'IRON_CONDOR' } };
  assert.equal(ctx.b510MarketViewLine(wait), 'Market view: BULL · unvalidated, not a forecast');
});

test('both render sites use the helper and the old lane-as-bias label is gone', () => {
  const insights = src.slice(src.indexOf('function renderBrainInsights()'), src.indexOf('function renderBrainInsights()') + 6000);
  assert.ok(insights.includes('${b510MarketViewLine(verdict)}'));
  const watch = src.slice(src.indexOf('function renderWatchlist('), src.indexOf('function renderWatchlist(') + 6000);
  assert.ok(watch.includes('${b510MarketViewLine(brainVerdict)}'));
  assert.ok(watch.includes('Context bias:'));
});
