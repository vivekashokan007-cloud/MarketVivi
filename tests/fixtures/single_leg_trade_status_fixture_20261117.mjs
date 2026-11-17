// SYNTHETIC FIXTURE (development, not session evidence). No 17 Nov 2026 session export was available when this
// was written, so this does NOT reproduce BNF poll #17 (~10:37 IST); it is shaped after Codex's description
// (BNF BULL, path efficiency 0.57, two spread alternatives) and the index_single_leg_v1 plan schema at
// Marketapp 398e1ab2 (mr.single_leg_plan.v2). Instrument keys are placeholders, not broker identifiers.
export const FIXTURE_LABEL = 'SYNTHETIC FIXTURE — not a 17 Nov session export';
const spread = (ix, type, legs) => ({ authorityPolicyVersion: 'index_direction_v1', index: ix, id: `${ix}-${type}-FX`, type,
  expiry: ix === 'NF' ? '2026-11-24' : '2026-11-25', lotSize: ix === 'NF' ? 65 : 30, maxProfit: 3000, maxLoss: 3500,
  frictionCost: 210.5, frictionCostStatus: 'OK', entryEligible: true, entryEligibility: { reasons: [] },
  lotEvidence: { status: 'VERIFIED', reasons: [] }, width: legs[1].strike - legs[0].strike, legs });
const k = (ix, strike, ot) => `FIXTURE|${ix}|2026-11-2x|${strike}${ot}`;
export function plan(ix, over = {}) {
  const strike = ix === 'NF' ? 26000 : 58500;
  const option_type = over.option_type || 'CE';
  const key = k(ix, strike, option_type);
  const { side, ...rest } = over;
  return { policy_id: 'index_single_leg_v1', schema: 'mr.single_leg_plan.v2', index: ix, admit: false,
    decision_id: `fx_${ix.toLowerCase()}_17`, action: (side === 'SELL' ? 'SELL_' : 'BUY_') + option_type,
    strike, option_type, instrument_key: key, quote_needed: [key],
    // contract identity as index_single_leg_v1.contract_identity publishes it (index + instrument_key included)
    contract: { index: ix, instrument_key: key, lot_size: ix === 'NF' ? 65 : 30, expiry: ix === 'NF' ? '2026-11-24' : '2026-11-25', reasons: [] },
    status: 'ADMISSIBLE', reasons: [], ...rest };
}
export function decision(ix, over = {}) {
  return { decision_id: `fx_${ix.toLowerCase()}_17`, availability: 'AVAILABLE',
    direction: { value: 'BULL', strength: 'MODERATE', er: 0.57 }, display: `${ix} up · path efficiency 0.57 (fixture)`,
    structure_policy: { allowed: ['BULL_CALL', 'BULL_PUT', 'BUY_CE', 'SELL_PE'] },
    action: { value: 'CANDIDATES', reasons: [] }, ...over };
}
export function spreads(ix) {
  const b = ix === 'NF' ? 26000 : 58500, w = ix === 'NF' ? 100 : 300;
  return [spread(ix, 'BULL_CALL', [{ action: 'BUY', strike: b, option_type: 'CE', bid: 120, ask: 121 },
                                   { action: 'SELL', strike: b + w, option_type: 'CE', bid: 70, ask: 71 }]),
          spread(ix, 'BULL_PUT', [{ action: 'BUY', strike: b - 2 * w, option_type: 'PE', bid: 40, ask: 41 },
                                  { action: 'SELL', strike: b - w, option_type: 'PE', bid: 80, ask: 81 }])];
}
export function result({ nf = {}, bnf = {}, nfPlan, bnfPlan, nfCands, bnfCands, drop = [] } = {}) {
  const by_index = { NF: decision('NF', nf), BNF: decision('BNF', bnf) };
  const sl = { NF: nfPlan === undefined ? plan('NF') : nfPlan, BNF: bnfPlan === undefined ? plan('BNF') : bnfPlan };
  for (const ix of drop) delete by_index[ix];
  for (const ix of ['NF', 'BNF']) if (sl[ix] === null) delete sl[ix];
  return { fixture: FIXTURE_LABEL, direction_authority: { active: 'index_direction_v1' }, by_index,
    candidates_by_index: { NF: nfCands ?? spreads('NF'), BNF: bnfCands ?? spreads('BNF') },
    managed_policy: { NF: { gates: [] }, BNF: { gates: [] } }, single_leg_by_index: sl,
    brain_result_completed_at_ms: Date.now() };
}
// The six states, each as (result, env) for one index. Used by tests and the 360 px screenshots.
export const NEUTRAL = { direction: { value: 'NEUTRAL', er: 0.12 }, display: 'flat · path efficiency 0.12 (fixture)',
  structure_policy: { allowed: ['IRON_CONDOR'] }, action: { value: 'NO_TRADE', reasons: ['NO_ELIGIBLE_CANDIDATE'] } };
export function sixStates(ix) {
  const o = ix === 'NF' ? 'nf' : 'bnf', P = ix === 'NF' ? 'nfPlan' : 'bnfPlan';
  const C = ix === 'NF' ? 'nfCands' : 'bnfCands';
  return {
    OFF: [result(), { enabled: false, fresh: true }],
    RESULT_UNAVAILABLE: [result(), { enabled: true, fresh: false, freshReason: 'Brain result is older than 12 min (stale)' }],
    NO_DIRECTIONAL_PROPOSAL: [result({ [o]: NEUTRAL, [P]: null, [C]: [] }), { enabled: true, fresh: true }],
    BLOCKED: [result({ [P]: plan(ix, { status: 'BLOCKED', reasons: ['SPREAD_GT_3PCT', 'REENTRY_GAP_LT_30M'] }) }), { enabled: true, fresh: true }],
    AWAITING_BROKER_SNAPSHOT: [result({ [P]: plan(ix, { status: 'ELIGIBLE_PENDING_SNAPSHOT', reasons: ['BROKER_SNAPSHOT_UNAVAILABLE'] }) }), { enabled: true, fresh: true }],
    ELIGIBLE: [result(), { enabled: true, fresh: true }],
  };
}
