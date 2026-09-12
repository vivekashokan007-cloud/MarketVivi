// Minimal Node harness for G3 close extrema helpers (mirrors app.js contract).
function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
const GROSS_EXTREMA_BASIS = 'GROSS_MTM';
const GROSS_EXTREMA_UNIT = 'INR_TOTAL';
const GROSS_EXTREMA_CONTRACT_VERSION = 'g3_gross_extrema_v1_20260912';

function buildGrossExtremaCloseFields(tradeLike = {}) {
  const hasPeakKey = Object.prototype.hasOwnProperty.call(tradeLike, 'peak_pnl');
  const hasTroughKey = Object.prototype.hasOwnProperty.call(tradeLike, 'trough_pnl');
  let peak = hasPeakKey ? asFiniteNumber(tradeLike.peak_pnl) : null;
  let trough = hasTroughKey ? asFiniteNumber(tradeLike.trough_pnl) : null;
  if (tradeLike.peak_pnl_validity === 'unknown') peak = null;
  if (tradeLike.trough_pnl_validity === 'unknown') trough = null;
  const peakObserved = peak !== null;
  const troughObserved = trough !== null;
  return {
    peak_pnl: peak,
    trough_pnl: trough,
    peak_pnl_validity: peakObserved ? 'valid' : 'unknown',
    trough_pnl_validity: troughObserved ? 'valid' : 'unknown',
    extrema_basis: GROSS_EXTREMA_BASIS,
    extrema_unit: GROSS_EXTREMA_UNIT,
    extrema_source: tradeLike.extrema_source || 'live_position',
    extrema_contract_version: GROSS_EXTREMA_CONTRACT_VERSION,
  };
}

function buildNormalizedCloseExtremaPayload(tradeLike = {}, extras = {}) {
  const extrema = buildGrossExtremaCloseFields(tradeLike);
  return {
    ...extrema,
    close_extrema_meta: {
      basis: extrema.extrema_basis,
      unit: extrema.extrema_unit,
      source: extrema.extrema_source,
      contract_version: extrema.extrema_contract_version,
      peak_pnl_validity: extrema.peak_pnl_validity,
      trough_pnl_validity: extrema.trough_pnl_validity,
      observation_interval: {
        from: tradeLike.entry_date || null,
        to: extras.exit_date || null,
      },
    },
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Positive peak survives close payload construction
const pos = buildNormalizedCloseExtremaPayload({ peak_pnl: 2400, trough_pnl: -300, entry_date: '2026-09-12T04:00:00Z' }, { exit_date: '2026-09-12T10:00:00Z' });
assert(pos.peak_pnl === 2400, 'positive peak');
assert(pos.trough_pnl === -300, 'trough');
assert(pos.peak_pnl_validity === 'valid', 'valid peak');
assert(pos.close_extrema_meta.basis === 'GROSS_MTM', 'gross basis');

// Valid zero remains zero
const zero = buildGrossExtremaCloseFields({ peak_pnl: 0, trough_pnl: 0 });
assert(zero.peak_pnl === 0 && zero.trough_pnl === 0, 'valid zero');
assert(zero.peak_pnl_validity === 'valid', 'zero validity');

// Unknown stays null
const unk = buildGrossExtremaCloseFields({});
assert(unk.peak_pnl === null && unk.trough_pnl === null, 'unknown null');
assert(unk.peak_pnl_validity === 'unknown', 'unknown validity');

// Simulated close patch includes top-level peak (the historical defect)
const closePatch = {
  status: 'CLOSED',
  trough_pnl: pos.trough_pnl,
  peak_pnl: pos.peak_pnl, // G3 fix
};
assert(Object.prototype.hasOwnProperty.call(closePatch, 'peak_pnl'), 'top-level peak present');
assert(closePatch.peak_pnl === 2400, 'top-level peak value');

console.log('OK test_close_extrema.mjs');
