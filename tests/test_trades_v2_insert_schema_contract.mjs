/**
 * Schema contract for the trades_v2 insert payload.
 *
 * Why this test exists: on 2026-09-16 two new keys (`analysis_only`,
 * `valuation_status`) were added to the `takeTradeImpl` trade literal. Neither
 * column exists in trades_v2, so PostgREST rejected EVERY insert (PGRST204) and
 * every trade — paper and real — was silently written through the reduced
 * "essential fields" fallback, which drops all four instrument keys, the entire
 * second leg pair and execution_mode. The resulting rows cannot be quoted, so
 * the brain fails closed to HOLD/DATA_UNAVAILABLE forever.
 *
 * test_paper_save_path_r2.mjs could not catch it: its Supabase mock accepts any
 * payload and never errors. This test asserts statically that every top-level
 * key of the trade literal is either a real trades_v2 column or explicitly
 * stripped by sanitizeTradeForInsert before the insert.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

// Live trades_v2 columns (information_schema.columns, project fdynxkfxohbnlvayouje,
// read 2026-09-16). Update this list in the same commit as any schema migration.
const TRADES_V2_COLUMNS = new Set([
  'id', 'created_at', 'updated_at', 'strategy_type', 'index_key', 'expiry', 'width',
  'is_credit', 'entry_date', 'entry_spot', 'entry_vix', 'entry_atm_iv', 'entry_premium',
  'sell_strike', 'sell_type', 'sell_ltp', 'buy_strike', 'buy_type', 'buy_ltp',
  'max_profit', 'max_loss', 'lots', 'prob_profit', 'force_alignment', 'force_f1',
  'force_f2', 'force_f3', 'entry_pcr', 'entry_futures_premium', 'entry_bias',
  'entry_bias_net', 'status', 'current_pnl', 'current_spot', 'current_premium',
  'peak_pnl', 'exit_date', 'actual_pnl', 'exit_premium', 'exit_reason', 'exit_vix',
  'exit_atm_iv', 'exit_force_alignment', 'entry_regime', 'entry_credit_confidence',
  'entry_wall_score', 'entry_gamma_risk', 'entry_dii_cash', 'entry_absorption_ratio',
  'entry_gap_sigma', 'entry_gap_type', 'paper', 'trade_mode', 'exit_hold_minutes',
  'trough_pnl', 'exit_spot', 'exit_pcr', 'exit_bias', 'poll_count', 'entry_snapshot',
  'exit_snapshot', 'journey_stats', 'entry_max_pain', 'buy_ltp2', 'sell_ltp2',
  'sell_strike2', 'buy_strike2', 'sell_type2', 'buy_type2', 'p_ml', 'ml_action',
  'ml_regime', 'ml_edge', 'ml_ood', 'entry_sell_oi', 'entry_buy_oi', 'be_upper',
  'be_lower', 'entry_polls_json', 'entry_ctx_json', 'entry_baseline_json',
  'entry_trace_json', 'close_polls_json', 'close_ctx_json', 'close_baseline_json',
  'close_trace_json', 'execution_mode', 'execution_status', 'execution_error',
  'order_tag', 'sell_instrument_key', 'buy_instrument_key', 'sell_instrument_key2',
  'buy_instrument_key2', 'paper_close_reason_quality', 'paper_thesis_break_type',
  'paper_rule_followed', 'paper_close_note', 'paper_discipline', 'canonical_won',
  'outcome_h2', 'friction_cost', 'friction_breakdown_json', 'net_pnl', 'net_won',
  'friction_version', 'pnl_engine', 'structure_incomplete', 'pnl_reconciles',
  'pnl_engine_reason', 'implied_multiplier', 'recon_error', 'pnl_engine_classified_at',
]);

/** Replace comments with spaces so key detection is not confused by them. */
function stripComments(src) {
  const out = src.split('');
  let mode = 'code';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const nxt = src[i + 1] || '';
    if (mode === 'code') {
      if (ch === "'") mode = 'sq';
      else if (ch === '"') mode = 'dq';
      else if (ch === '`') mode = 'tmpl';
      else if (ch === '/' && nxt === '/') {
        while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      } else if (ch === '/' && nxt === '*') {
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = ' '; i++; }
        out[i] = ' '; out[i + 1] = ' '; i++;
      }
    } else if (mode === 'sq' && ch === "'" && src[i - 1] !== '\\') mode = 'code';
    else if (mode === 'dq' && ch === '"' && src[i - 1] !== '\\') mode = 'code';
    else if (mode === 'tmpl' && ch === '`' && src[i - 1] !== '\\') mode = 'code';
  }
  return out.join('');
}

/** Top-level keys of the first `const trade = { ... }` literal in the source. */
function tradeLiteralKeys(rawSrc) {
  const litStart = rawSrc.indexOf('const trade = {');
  assert(litStart !== -1, 'trade literal not found in app.js');
  let d = 0;
  let litEnd = rawSrc.length;
  for (let i = rawSrc.indexOf('{', litStart); i < rawSrc.length; i++) {
    const c = rawSrc[i];
    if (c === '{' || c === '[' || c === '(') d++;
    else if (c === '}' || c === ']' || c === ')') { d--; if (d === 0) { litEnd = i + 1; break; } }
  }
  const src = stripComments(rawSrc.slice(litStart, litEnd));
  const open = src.indexOf('{');
  const keys = [];
  let depth = 0;
  let mode = 'code';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (mode === 'code') {
      if (ch === "'") mode = 'sq';
      else if (ch === '"') mode = 'dq';
      else if (ch === '`') mode = 'tmpl';
      else if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') { depth--; if (depth === 0) break; }
      else if (depth === 1) {
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(i));
        // Only a key if the previous non-whitespace character opens the literal
        // or ends the previous entry — otherwise it is a ternary `cond ? a : b`.
        if (m) {
          let k = i - 1;
          while (k >= 0 && /\s/.test(src[k])) k--;
          const prev = src[k];
          if (prev === '{' || prev === ',') { keys.push(m[1]); i += m[0].length - 1; }
        }
      }
    } else if (mode === 'sq' && ch === "'" && src[i - 1] !== '\\') mode = 'code';
    else if (mode === 'dq' && ch === '"' && src[i - 1] !== '\\') mode = 'code';
    else if (mode === 'tmpl' && ch === '`' && src[i - 1] !== '\\') mode = 'code';
  }
  assert(keys.length > 20, `expected a full trade literal, parsed ${keys.length} keys`);
  return [...new Set(keys)];
}

/** Keys sanitizeTradeForInsert explicitly deletes before the insert. */
function strippedKeys(src) {
  const start = src.indexOf('function sanitizeTradeForInsert');
  assert(start !== -1, 'sanitizeTradeForInsert not found');
  const body = src.slice(start, src.indexOf('\n}', start));
  return new Set([...body.matchAll(/delete\s+clone\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

const literalKeys = tradeLiteralKeys(appSrc);
const stripped = strippedKeys(appSrc);
const unknown = literalKeys.filter((k) => !TRADES_V2_COLUMNS.has(k) && !stripped.has(k));

assert(
  unknown.length === 0,
  `trade insert payload carries ${unknown.length} key(s) that are neither trades_v2 ` +
  `columns nor stripped by sanitizeTradeForInsert — PostgREST will reject the whole ` +
  `insert (PGRST204) and every trade will fall back to the reduced payload: ` +
  unknown.join(', ')
);

// Every stripped key must be genuinely absent from the schema; stripping a real
// column would silently discard data the row is supposed to carry.
const overStripped = [...stripped].filter((k) => TRADES_V2_COLUMNS.has(k));
assert(
  overStripped.length === 0,
  `sanitizeTradeForInsert strips key(s) that DO exist in trades_v2: ${overStripped.join(', ')}`
);

// The reduced fallback must never be reachable for structural reasons: the legs
// and instrument keys it omits are exactly what makes a position quotable.
for (const required of [
  'sell_instrument_key', 'buy_instrument_key', 'sell_instrument_key2',
  'buy_instrument_key2', 'sell_strike2', 'buy_strike2', 'sell_ltp2', 'buy_ltp2',
]) {
  assert(literalKeys.includes(required), `trade literal must carry ${required}`);
  assert(TRADES_V2_COLUMNS.has(required), `${required} must exist in trades_v2`);
}

console.log(`OK trades_v2 insert schema contract — ${literalKeys.length} literal keys, ${stripped.size} stripped, 0 unknown`);
