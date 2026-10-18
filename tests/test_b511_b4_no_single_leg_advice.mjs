// b511 B4: the PWA never renders Buy CE / Buy PE advice from the market view, and every
// rendered structure pairs each BUY leg with a SELL leg. Runs the REAL app.js code in a VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const SINGLE = /\b(buy|long)[ _-]?(ce|pe|call|put)\b/i;

const mv = src.slice(src.indexOf('// ═══ B510 MARKET VIEW SEMANTICS ═══'), src.indexOf('// ═══ END B510 MARKET VIEW ═══'));
const ctx = { Number, String, Object };
vm.createContext(ctx);
vm.runInContext(mv, ctx);

test('market view and strategy lines never become buy-call/buy-put advice', () => {
  for (const md of ['BULL', 'BEAR', 'NEUTRAL']) {
    for (const [action, strategy, lane] of [['WAIT', null, null], ['SELL PREMIUM', 'BEAR_CALL', 'BEAR'],
      ['SELL PREMIUM', 'BULL_PUT', 'BULL'], ['BUY PREMIUM', 'BULL_CALL', 'BULL'], ['BUY PREMIUM', 'BEAR_PUT', 'BEAR'],
      ['SELL PREMIUM', 'IRON_CONDOR', 'NEUTRAL']]) {
      const v = { action, strategy, direction: lane || 'NEUTRAL', execution_lane_direction: lane,
        market_direction: md, market_view_status: 'AVAILABLE', direction_semantics_version: 1,
        market_view_validated: false, market_bull_score: 1, market_bear_score: 0.2 };
      const market = ctx.b510MarketViewLine(v);
      assert.doesNotMatch(market, SINGLE, JSON.stringify(v));
      const lane_ = ctx.b510StrategyDirectionLine(v);
      // The only permitted mention is the explicit disclaimer.
      assert.doesNotMatch(lane_.replace('not buy-call/buy-put advice', ''), SINGLE, JSON.stringify(v));
    }
  }
});

// Real candidate-card legs block (verbatim slice), executed per structure.
const start = src.indexOf('    // Legs — execution order: BUY protection first, then SELL credit (Indian margin rule)');
const end = src.indexOf('    // VIX trend badge for IC/IB candidates');
assert.ok(start > 0 && end > start, 'legs block markers present');
const legsFn = new vm.Script(`(function(cand, is4Leg, otmLabel){${src.slice(start, end)}; return legsText;})`);
const renderLegs = legsFn.runInNewContext({});

test('every rendered structure pairs BUY legs with SELL legs (no single long leg)', () => {
  const base = { buyStrike: 24500, buyType: 'CE', buyLTP: 120, sellStrike: 24700, sellType: 'CE', sellLTP: 60,
    buyStrike2: 24000, buyType2: 'PE', buyLTP2: 40, sellStrike2: 24200, sellType2: 'PE', sellLTP2: 70 };
  for (const [cand, four] of [[{ ...base, isCredit: false }, false], [{ ...base, isCredit: true }, false],
    [{ ...base, isCredit: true }, true]]) {
    const html = renderLegs(cand, four, 'OTM');
    const buys = (html.match(/\bBUY \d/g) || []).length;
    const sells = (html.match(/\bSELL \d/g) || []).length;
    assert.ok(buys >= 1 && sells >= 1 && sells === buys, html);
  }
});

test('bounded source check: no Buy CE/PE advice template anywhere in app.js', () => {
  const offenders = src.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => SINGLE.test(l) && !l.includes('not buy-call/buy-put advice'));
  assert.deepEqual(offenders, []);
});
