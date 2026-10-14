// Codex R4-D2 regressions (review r5): strict value-preserving numeric canonicalization of the close evidence.
// The 24be1e85 probe inverted, on the real applyRuleBFill / ev12ManualPatch paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, openRuleB, fillEntry } from './ev12_harness.mjs';

const LEG = { instrument_key: 'C5', qty: -1, price: 120, bid: 119, ask: 120, quote_ts_ms: 1791798330000 };

async function run(mutate, legs = [LEG]) {
  const c = sandbox(); openRuleB(c); const e = fillEntry(9001);
  e.fill.legs = legs.map(l => ({ ...l }));
  c.NativeBridge.ledger['9001'] = e;
  const write = c.DB.updateOpenTrade;
  c.DB.updateOpenTrade = async (id, p) => { const ok = await write(id, p); if (mutate) mutate(c._store.rows[id]); return ok; };
  const r = await c.applyRuleBFill(e);
  return { r, c };
}
const leg0 = (row) => row.close_trace_json.fill.legs[0];

function refused({ r, c }, name) {
  assert.notEqual(r.state, 'REMOTE_CONFIRMED', name);
  assert.equal(c.NativeBridge.acks.length, 0, name + ': no native ACK');
  assert.equal(c._closed.length, 0, name + ': no closed projection');
}
function confirmed({ r, c }, name) {
  assert.equal(r.state, 'REMOTE_CONFIRMED', name);
  assert.equal(c.NativeBridge.acks.length, 1, name);
  assert.equal(c._closed.length, 1, name);
}

const BAD = [
  // the probe's mutations (previously rounded back into equality)
  ['probe different_quantity', row => { leg0(row).qty = -0.6; }],
  ['probe different_price', row => { leg0(row).price = 120.00001; }],
  ['probe different_bid', row => { leg0(row).bid = 119.00001; }],
  ['probe different_ask', row => { leg0(row).ask = 120.00001; }],
  ['probe different_source_time', row => { leg0(row).quote_ts_ms = 1791798330000.4; }],
  // P&L / value changes below the old 2- and 4-decimal rounding thresholds
  ['net below old threshold', row => { row.net_pnl = Number(row.net_pnl) + 0.004; }],
  ['gross below old threshold', row => { row.actual_pnl = Number(row.actual_pnl) - 0.001; }],
  ['close value below old threshold', row => { row.close_trace_json.fill.close_value_pts += 0.00004; }],
  ['qty fractional string', row => { leg0(row).qty = '-1.5'; }],
  // invalid types: rejected, never coerced
  ['qty boolean', row => { leg0(row).qty = true; }],
  ['qty object', row => { leg0(row).qty = { v: -1 }; }],
  ['qty array', row => { leg0(row).qty = [-1]; }],
  ['qty non-numeric string', row => { leg0(row).qty = '-1x'; }],
  ['qty infinite', row => { leg0(row).qty = '-1e400'; }],
  ['price NaN', row => { leg0(row).price = NaN; }],
  ['price missing', row => { delete leg0(row).price; }],
  ['bid boolean', row => { leg0(row).bid = false; }],
  ['source ms fractional string', row => { leg0(row).quote_ts_ms = '1791798330000.5'; }],
  ['net boolean', row => { row.net_pnl = true; }],
  ['exit_date number', row => { row.exit_date = Date.parse(row.exit_date); }],
  ['exit_date unparseable', row => { row.exit_date = 'not a date'; }],
  ['leg not an object', row => { row.close_trace_json.fill.legs[0] = 'C5'; }],
];
for (const [name, m] of BAD) test(`R4-D2 refused: ${name}`, async () => refused(await run(m), name));

const OK = [
  ['control exact', null],
  ['qty "-1.000"', row => { leg0(row).qty = '-1.000'; }],
  ['qty -1.0 number', row => { leg0(row).qty = -1.0; }],
  ['price "120.0" / bid "1.19e2"', row => { leg0(row).price = '120.0'; leg0(row).bid = '1.19e2'; }],
  ['source ms as integer string', row => { leg0(row).quote_ts_ms = '1791798330000'; }],
  ['exit_date +05:30 equivalent', row => { const t = Date.parse(row.exit_date); row.exit_date = new Date(t + 19800000).toISOString().replace('Z', '+05:30'); }],
  ['fill ts Z equivalent', row => { row.close_trace_json.fill.ts_iso = new Date(Date.parse(row.close_trace_json.fill.ts_iso)).toISOString(); }],
  ['net as numeric string', row => { row.net_pnl = String(row.net_pnl); }],
];
for (const [name, m] of OK) test(`R4-D2 control confirms: ${name}`, async () => confirmed(await run(m), name));

test('R4-D2: an invalid frozen fill (fractional qty from the ledger) is never proven', async () => {
  refused(await run(null, [{ ...LEG, qty: -0.6 }]), 'own invalid fill');
});

test('R4-D2: opposing manual winner with a sub-rounding stored change is not accepted', async () => {
  const c = sandbox(); const t = openRuleB(c, 9005);
  const mp = c.ev12ManualPatch(t, { status: 'CLOSED', exit_reason: 'Manual', exit_date: '2026-10-12T09:30:00.000Z',
    actual_pnl: 12, net_pnl: 10 });
  Object.assign(c._store.rows[9005], mp, { net_pnl: 10.001 });
  const e = fillEntry(9005); c.NativeBridge.ledger['9005'] = e;
  const r = await c.applyRuleBFill(e);
  assert.notEqual(r.state, 'MANUAL_CLOSE_CONFLICT');
  assert.equal(c.NativeBridge.manualResults.length, 0);
  assert.equal(c._closed.length, 0);
  // control: the same winner with an equivalent representation IS accepted
  const d = sandbox(); const t2 = openRuleB(d, 9005);
  Object.assign(d._store.rows[9005], d.ev12ManualPatch(t2, { status: 'CLOSED', exit_reason: 'Manual',
    exit_date: '2026-10-12T09:30:00.000Z', actual_pnl: 12, net_pnl: 10 }), { net_pnl: '10.00', exit_date: '2026-10-12T15:00:00+05:30' });
  const e2 = fillEntry(9005); d.NativeBridge.ledger['9005'] = e2;
  assert.equal((await d.applyRuleBFill(e2)).state, 'MANUAL_CLOSE_CONFLICT');
});

test('R4-D2: canonical evidence is value-preserving (no rounding) and rejects invalid types', () => {
  const c = sandbox();
  const ev = (leg, extra = {}) => c.ev12CloseEvidence('RULE_B', 'd', 'u', { status: 'CLOSED', exit_reason: 'X',
    exit_date: '2026-10-12T09:45:30.000Z', actual_pnl: 1, net_pnl: 1, ...extra,
    fill: { kind: 'PLANNED_EXIT', ts_iso: '2026-10-12T15:15:30+05:30', close_value_pts: -1, legs: [leg] } });
  assert.equal(ev(LEG), ev({ ...LEG, qty: '-1.000', price: '120.0' }));
  assert.notEqual(ev(LEG), ev({ ...LEG, price: 120.00001 }));
  assert.notEqual(ev(LEG, { net_pnl: 1 }), ev(LEG, { net_pnl: 1.001 }));
  assert.equal(ev({ ...LEG, qty: -0.6 }), null);
  assert.equal(ev({ ...LEG, qty: true }), null);
  assert.equal(ev({ ...LEG, quote_ts_ms: 1.5 }), null);
  assert.equal(c.ev12DigestOf(null), null);
});
