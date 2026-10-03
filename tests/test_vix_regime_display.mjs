// VIX regime display: the PWA must show the brain's relative regime (or say
// plainly that it is held neutral), never the old fixed-band trading calls,
// and must round sigma badges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker after ${startMarker}`);
  return src.slice(start, end);
}

const helperSrc = slice('function vixFixedBand(vix)', '\nfunction renderMarket(');
const sandbox = { C: { IV_LOW: 15, IV_HIGH: 20, IV_VERY_HIGH: 24 }, Number, String, Math, Object };
vm.createContext(sandbox);
vm.runInContext(`${helperSrc}\nthis.vixFixedBand = vixFixedBand; this.formatSigma = formatSigma; this.describeVixRegime = describeVixRegime;`, sandbox);
const { vixFixedBand, formatSigma, describeVixRegime } = sandbox;

const fresh = (over = {}) => ({
  schema_version: 'pc2_vix_regime_context_live_v2',
  regime: 'VERY_HIGH',
  basis: 'vix_percentile',
  support_status: 'SUPPORTED',
  vix: 15.37,
  vix_percentile: 100,
  support_count: 60,
  window: 60,
  history_status: 'FRESH',
  history_source: 'vixDailyHistory',
  history_oldest_date: '2026-07-06',
  history_newest_date: '2026-09-30',
  history_sessions_behind: 0,
  history_max_sessions_behind: 2,
  constant_band_regime: 'NORMAL',
  decision_scope: 'paper_corrected',
  ...over,
});

test('sigma badges are rounded to two decimals', () => {
  assert.equal(formatSigma(-0.736975468032293), '-0.74');
  assert.equal(formatSigma(1.5), '1.50');
  assert.equal(formatSigma(0), '0.00');
  assert.equal(formatSigma(-0.001), '0.00', 'no negative zero');
  assert.equal(formatSigma(null), null);
  assert.equal(formatSigma(undefined), null);
  assert.equal(formatSigma(''), null);
  assert.equal(formatSigma('abc'), null);
  assert.equal(formatSigma(Infinity), null);
});

test('fixed band is reference only', () => {
  assert.equal(vixFixedBand(15.02), 'NORMAL');
  assert.equal(vixFixedBand(15), 'LOW');
  assert.equal(vixFixedBand(20), 'ELEVATED');
  assert.equal(vixFixedBand(24), 'VERY HIGH');
  assert.equal(vixFixedBand(NaN), null);
});

test('fresh brain regime is the headline, band is secondary', () => {
  const view = describeVixRegime(fresh(), 15.37);
  assert.equal(view.source, 'brain');
  assert.equal(view.label, 'VERY HIGH · 100th pct');
  assert.equal(view.verdictClass, 'sell');
  assert.equal(view.stale, false);
  assert.match(view.verdict, /vs last 60 sessions to 2026-09-30/);
  assert.equal(view.bandText, 'Fixed band (15/20/24): NORMAL');
  assert.doesNotMatch(view.verdict, /SELL PREMIUM|forces aligned/);
});

test('low and normal regimes map to buy and neutral styling', () => {
  assert.equal(describeVixRegime(fresh({ regime: 'LOW', vix_percentile: 4.2 }), 11).verdictClass, 'buy');
  assert.equal(describeVixRegime(fresh({ regime: 'NORMAL', vix_percentile: 50 }), 12).verdictClass, 'neutral');
  assert.equal(describeVixRegime(fresh({ regime: 'HIGH', vix_percentile: 70 }), 13).label, 'HIGH · 70th pct');
});

test('stale history is shown as held neutral with its age', () => {
  const view = describeVixRegime(fresh({
    regime: 'NORMAL', basis: 'neutral_stale_history', support_status: 'STALE_HISTORY',
    vix_percentile: null, support_count: 0, history_status: 'STALE',
    history_newest_date: '2026-06-29', history_sessions_behind: 65,
  }), 15.37);
  assert.equal(view.label, 'NEUTRAL');
  assert.equal(view.stale, true);
  assert.equal(view.verdictClass, 'neutral');
  assert.match(view.verdict, /stale \(newest close 2026-06-29, 65 sessions behind\)/);
  assert.match(view.verdict, /Paper Force 3 neutral/);
});

test('missing, undated and thin history never produce a regime', () => {
  for (const status of ['MISSING', 'UNDATED']) {
    const view = describeVixRegime(fresh({ history_status: status, support_status: 'STALE_HISTORY', vix_percentile: null }), 14);
    assert.equal(view.label, 'NEUTRAL');
    assert.match(view.verdict, /No dated VIX history/);
  }
  const thin = describeVixRegime(fresh({ support_status: 'LOW_SUPPORT', vix_percentile: null, support_count: 12 }), 14);
  assert.equal(thin.label, 'NEUTRAL');
  assert.match(thin.verdict, /too thin \(12 closes, need 30\)/);
});

test('absolute guard is explained and Real does not claim the Paper correction', () => {
  const guarded = describeVixRegime(fresh({
    regime: 'HIGH', percentile_regime: 'VERY_HIGH', absolute_guard_applied: true,
  }), 15.37);
  assert.equal(guarded.label, 'HIGH · 100th pct');
  assert.match(guarded.verdict, /relative VERY HIGH capped by absolute VIX guard/);
  const real = describeVixRegime(fresh({ decision_scope: 'real_legacy_unchanged' }), 15.37);
  assert.equal(real.source, 'band');
  assert.match(real.verdict, /active for Paper only/);
});

test('absent or failed brain payload falls back to the labelled band', () => {
  for (const payload of [null, undefined, {}, { error: 'boom' }]) {
    const view = describeVixRegime(payload, 15.02);
    assert.equal(view.source, 'band');
    assert.equal(view.label, 'NORMAL');
    assert.match(view.verdict, /not available yet/);
  }
});

test('IV-percentile basis is shown as the regime the brain used', () => {
  const view = describeVixRegime(fresh({
    regime: 'HIGH', basis: 'iv_percentile', vix_percentile: null, evidence_percentile: 72,
    support_count: 0, history_status: 'STALE',
  }), 14);
  assert.equal(view.label, 'HIGH · 72th pct');
  assert.match(view.verdict, /by IV percentile/);
});

test('min support comes from the brain payload', () => {
  const thin = describeVixRegime(fresh({ support_status: 'LOW_SUPPORT', vix_percentile: null, evidence_percentile: null, support_count: 12, min_support: 40 }), 14);
  assert.match(thin.verdict, /12 closes, need 40/);
  const zero = describeVixRegime(fresh({ support_status: 'LOW_SUPPORT', vix_percentile: null, evidence_percentile: null, support_count: 0 }), 14);
  assert.match(zero.verdict, /0 closes, need 30/);
});

test('a stale brain result says so', () => {
  const view = describeVixRegime(null, 15.02, { brainStale: true });
  assert.equal(view.source, 'band');
  assert.match(view.verdict, /Brain result is stale/);
});

test('renderMarket uses the brain regime, gated on brain freshness', () => {
  const render = slice('function renderMarket(', '\nfunction renderOI(');
  assert.match(render, /const brainFresh = brainFreshnessStatus\(bd\)\.fresh;/);
  assert.match(render, /describeVixRegime\(\s*brainFresh \? bd\?\.vixRegime : null,/);
  assert.match(render, /\{ brainStale: !brainFresh && hasBrainPayload\(bd\) \}/);
  assert.match(render, /formatSigma\(Number\.isFinite\(l\.spotSigma\)/);
  assert.match(render, /formatSigma\(Number\.isFinite\(l\.vixSigma\)/);
  assert.doesNotMatch(render, /3 forces aligned for credit sellers/);
  assert.match(render, /escapeHtml\(ivRegime\)/);
});
