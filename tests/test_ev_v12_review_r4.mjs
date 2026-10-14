// Codex D1/D2 regressions (review r4): the de05adc7 probe inverted, on the real app.js paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, openRuleB, fillEntry, src } from './ev12_harness.mjs';

for (const field of ['exit_date', 'fill_time', 'fill_legs', 'fill_bid', 'fill_quote_ts', 'net_pnl']) {
  test(`D2 probe: stored evidence altered after the write (${field}) is NOT acknowledged`, async () => {
    const c = sandbox(); openRuleB(c); const e = fillEntry(9001);
    e.fill.legs = [{ instrument_key: 'C5', qty: -1, price: 120, bid: 119, ask: 120, quote_ts_ms: 1791798330000 }];
    c.NativeBridge.ledger['9001'] = e;
    const write = c.DB.updateOpenTrade;
    c.DB.updateOpenTrade = async (id, p) => {
      const ok = await write(id, p), row = c._store.rows[id];
      if (field === 'exit_date') row.exit_date = '2026-10-13T09:45:00.000Z';
      if (field === 'fill_time') row.close_trace_json.fill.ts_iso = '2026-10-13T15:15:00+05:30';
      if (field === 'fill_legs') row.close_trace_json.fill.legs[0].price = 999;
      if (field === 'fill_bid') row.close_trace_json.fill.legs[0].bid = 1;
      if (field === 'fill_quote_ts') row.close_trace_json.fill.legs[0].quote_ts_ms = 1;
      if (field === 'net_pnl') row.net_pnl = Number(row.net_pnl) + 1;
      return ok;
    };
    const r = await c.applyRuleBFill(e);
    assert.notEqual(r.state, 'REMOTE_CONFIRMED');
    assert.equal(c.NativeBridge.acks.length, 0);
    assert.equal(c._closed.length, 0);
  });
}

test('D2: harmless representation differences (key order, +05:30 vs Z, 120 vs "120.0000") still prove the close', async () => {
  const c = sandbox(); openRuleB(c); const e = fillEntry(9001);
  e.fill.legs = [{ instrument_key: 'C5', qty: -1, price: 120, bid: 119, ask: 120, quote_ts_ms: 1791798330000 }];
  c.NativeBridge.ledger['9001'] = e;
  const write = c.DB.updateOpenTrade;
  c.DB.updateOpenTrade = async (id, p) => {
    const ok = await write(id, p), row = c._store.rows[id];
    const l = row.close_trace_json.fill.legs[0];
    row.close_trace_json.fill.legs[0] = { quote_ts_ms: l.quote_ts_ms, ask: String(l.ask) + '.0000', bid: l.bid, price: l.price, qty: l.qty, instrument_key: l.instrument_key };
    const t = Date.parse(row.exit_date); row.exit_date = new Date(t + 19800000).toISOString().replace('Z', '+05:30');
    return ok;
  };
  assert.equal((await c.applyRuleBFill(e)).state, 'REMOTE_CONFIRMED');
  assert.equal(c.NativeBridge.acks.length, 1);
});

test('D2: an opposing winner is proven only by a self-consistent stored close', async () => {
  const c = sandbox(); const t = openRuleB(c, 9005);
  const mp = c.ev12ManualPatch(t, { status: 'CLOSED', exit_reason: 'Manual', exit_date: '2026-10-12T09:30:00.000Z', actual_pnl: 12, net_pnl: 10 });
  Object.assign(c._store.rows[9005], mp, { actual_pnl: 999 });   // digest copied, stored evidence altered
  const e = fillEntry(9005); c.NativeBridge.ledger['9005'] = e;
  const r = await c.applyRuleBFill(e);
  assert.notEqual(r.state, 'MANUAL_CLOSE_CONFLICT');
  assert.equal(c.NativeBridge.manualResults.length, 0);
  assert.equal(c._closed.length, 0);
});

test('D1 probe: the native request failing records NOTHING (no hidden intent), remote stays OPEN', async () => {
  const c = sandbox(); const t = openRuleB(c);
  c.NativeBridge.failRequest = true;
  const r = await c.ev12ManualClose(t, {}, { status: 'CLOSED', exit_reason: 'Manual', actual_pnl: 50, net_pnl: 12.5 });
  assert.equal(r.state, 'NOT_RECORDED');
  assert.equal(c.NativeBridge.ledger['9001'], undefined);
  assert.equal(c._store.rows[9001].status, 'OPEN');
  assert.equal(c._store.updates, 0);
});

test('D1: the old two-step note/journal path is not used by the manual close', async () => {
  const c = sandbox(); const t = openRuleB(c);
  c.NativeBridge.evNoteManualClose = () => { throw new Error('must not be called'); };
  c.NativeBridge.evManualCloseJournal = () => { throw new Error('must not be called'); };
  const r = await c.ev12ManualClose(t, {}, { status: 'CLOSED', exit_reason: 'Manual', exit_date: '2026-10-12T09:30:00.000Z', actual_pnl: 50, net_pnl: 12.5 });
  assert.equal(r.state, 'MANUAL_WON');
  const e = c.NativeBridge.ledger['9001'];
  assert.ok(e.manual_patch, 'intent and patch recorded together');
  assert.equal(c._store.rows[9001].status, 'CLOSED');
  const m = src.slice(src.indexOf('async function ev12ManualClose('), src.indexOf('async function ev12ReconcileUnjournaledManual('));
  assert.doesNotMatch(m, /evNoteManualClose|evManualCloseJournal|ev12NoteManualClose/);
});

test('D1: an oversize / invalid patch is refused and changes nothing', async () => {
  for (const mode of ['oversize', 'invalid']) {
    const c = sandbox(); const t = openRuleB(c);
    if (mode === 'oversize') c.NativeBridge.maxPatch = 10;
    const p = mode === 'oversize' ? { status: 'CLOSED', exit_reason: 'Manual', actual_pnl: 1, net_pnl: 1 } : { status: 'OPEN' };
    const r = await c.ev12ManualClose(t, {}, p);
    assert.equal(r.state, 'NOT_RECORDED');
    assert.equal(c.NativeBridge.ledger['9001'], undefined);
    assert.equal(c._store.rows[9001].status, 'OPEN');
  }
});

test('D1: a legacy patchless intent is OFFERED and withdrawn when the remote row is OPEN (no invented fill)', async () => {
  const c = sandbox(); openRuleB(c);
  c.NativeBridge.ledger['9001'] = { trade_id: '9001', decision_id: 'x', state: 'MANUAL_CLOSED', delivery: 'MANUAL_PENDING' };
  const pend = JSON.parse(c.NativeBridge.evRuleBPending());
  assert.equal(pend.length, 1);
  const r = await c.applyRuleBFill(pend[0]);
  assert.equal(r.state, 'MANUAL_INTENT_WITHDRAWN');
  assert.deepEqual(c.NativeBridge.abandoned, ['9001']);
  assert.equal(c.NativeBridge.ledger['9001'], undefined);
  assert.equal(c._store.rows[9001].status, 'OPEN');
  assert.equal(c._store.updates, 0);
  assert.equal(JSON.parse(c.NativeBridge.evRuleBPending()).length, 0);
});

test('D1: a patchless manual flag on a Rule B fill is withdrawn and the Rule B close proceeds', async () => {
  const c = sandbox(); openRuleB(c); const e = fillEntry(9001); e.manual_pending = true;
  c.NativeBridge.ledger['9001'] = e;
  const r = await c.applyRuleBFill(e);
  assert.equal(r.state, 'REMOTE_CONFIRMED');
  assert.equal(c.NativeBridge.ledger['9001'].manual_pending, undefined);
});
