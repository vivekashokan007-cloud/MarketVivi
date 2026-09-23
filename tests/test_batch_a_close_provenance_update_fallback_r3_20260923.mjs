/**
 * R3 counterexample: fallback updateTrade must not report success while dropping
 * close_trace_json / close_reason_provenance.
 *
 * Mocks DB update behavior mirroring production MarketVivi paths.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract helpers used by production updateTrade.
const buildMatch = appJs.match(/function buildTradeUpdateFallbackPatch\(patch\) \{[\s\S]*?\n\}/);
const acceptMatch = appJs.match(/function shouldAcceptTradeUpdateFallback\(originalPatch, fallbackPatch\) \{[\s\S]*?\n\}/);
assert.ok(buildMatch, 'buildTradeUpdateFallbackPatch required in app.js');
assert.ok(acceptMatch, 'shouldAcceptTradeUpdateFallback required in app.js');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  buildMatch[0] + '\n' + acceptMatch[0] + '\n'
  + 'this.buildTradeUpdateFallbackPatch = buildTradeUpdateFallbackPatch;\n'
  + 'this.shouldAcceptTradeUpdateFallback = shouldAcceptTradeUpdateFallback;\n',
  sandbox
);

const build = sandbox.buildTradeUpdateFallbackPatch;
const accept = sandbox.shouldAcceptTradeUpdateFallback;

const closePatch = {
  status: 'CLOSED',
  exit_reason: 'manual_book_profit_button',
  close_trace_json: {
    source: 'manual_close',
    close_reason_provenance: {
      close_reason: 'manual_book_profit_button',
      provenance: 'manual_book_profit_button',
      brain_book_event: false,
    },
  },
  friction_cost: 12.5,
  net_pnl: 100,
};

const fallback = build(closePatch);
assert.ok(
  Object.prototype.hasOwnProperty.call(fallback, 'close_trace_json'),
  'fallback must retain close_trace_json'
);
assert.ok(
  fallback.close_trace_json.close_reason_provenance,
  'fallback must retain close_reason_provenance inside close_trace_json'
);
assert.ok(!Object.prototype.hasOwnProperty.call(fallback, 'friction_cost'));
assert.ok(!Object.prototype.hasOwnProperty.call(fallback, 'net_pnl'));
assert.strictEqual(accept(closePatch, fallback), true);

// Counterexample: a fallback that drops close_trace_json must NOT be accepted as success.
const dropped = { ...closePatch };
delete dropped.close_trace_json;
delete dropped.friction_cost;
delete dropped.net_pnl;
assert.strictEqual(
  accept(closePatch, dropped),
  false,
  'must not accept fallback success while dropping close_trace_json provenance'
);

/**
 * Mock production updateTrade paths: primary fails, then fallback.
 * Mirrors DB.updateTrade catch/retry behavior in app.js.
 */
async function mockUpdateTrade(updateImpl, id, patch) {
  try {
    const result = await updateImpl(id, patch, 'primary');
    if (result && result.error) throw new Error(result.error);
    return true;
  } catch (e) {
    const fallbackPatch = build(patch);
    if (!accept(patch, fallbackPatch)) {
      return false;
    }
    const result = await updateImpl(id, fallbackPatch, 'fallback');
    if (result && !result.error) {
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'close_trace_json')) {
      return false;
    }
    return false;
  }
}

// Path 1: primary success keeps provenance.
{
  let seen = null;
  const ok = await mockUpdateTrade(async (_id, patch, phase) => {
    seen = { phase, patch };
    return { error: null };
  }, 't1', closePatch);
  assert.strictEqual(ok, true);
  assert.strictEqual(seen.phase, 'primary');
  assert.ok(seen.patch.close_trace_json.close_reason_provenance);
}

// Path 2: primary fails on optional fields; fallback keeps close_trace_json → success.
{
  let phases = [];
  const ok = await mockUpdateTrade(async (_id, patch, phase) => {
    phases.push(phase);
    if (phase === 'primary') return { error: 'column friction_cost does not exist' };
    assert.ok(patch.close_trace_json, 'fallback patch must include close_trace_json');
    assert.ok(patch.close_trace_json.close_reason_provenance);
    assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'friction_cost'));
    return { error: null };
  }, 't2', closePatch);
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(phases, ['primary', 'fallback']);
}

// Path 3 (counterexample): fallback that would drop close_trace_json must return false.
{
  async function badUpdateTrade(updateImpl, id, patch) {
    try {
      const result = await updateImpl(id, patch, 'primary');
      if (result && result.error) throw new Error(result.error);
      return true;
    } catch (e) {
      // Simulate the OLD buggy behavior: strip close_trace_json then succeed.
      const buggyFallback = { ...patch };
      delete buggyFallback.close_trace_json;
      delete buggyFallback.friction_cost;
      delete buggyFallback.net_pnl;
      if (!accept(patch, buggyFallback)) {
        return false; // R3 gate prevents reporting success
      }
      const result = await updateImpl(id, buggyFallback, 'fallback');
      return !!(result && !result.error);
    }
  }
  const ok = await badUpdateTrade(async () => ({ error: 'schema' }), 't3', closePatch);
  assert.strictEqual(
    ok,
    false,
    'fallback path must not report success while dropping close_trace_json provenance'
  );
}

// Path 4: close_trace_json itself rejected by DB → still false (no silent drop).
{
  const ok = await mockUpdateTrade(async (_id, patch, phase) => {
    if (phase === 'primary') return { error: 'close_trace_json rejected' };
    // fallback still has close_trace_json; also rejected
    return { error: 'close_trace_json rejected' };
  }, 't4', closePatch);
  assert.strictEqual(ok, false);
}

console.log('batch_a_close_provenance_update_fallback_r3_ok');
