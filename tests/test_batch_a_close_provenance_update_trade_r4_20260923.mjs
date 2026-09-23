/**
 * R4: exercise the REAL DB.updateTrade / updateTradeWithSupabase path with a
 * mocked Supabase client — primary success, fallback success, close_trace_json
 * rejection. Do not mirror updateTrade logic in the test.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const buildMatch = appJs.match(/function buildTradeUpdateFallbackPatch\(patch\) \{[\s\S]*?\n\}/);
const acceptMatch = appJs.match(/function shouldAcceptTradeUpdateFallback\(originalPatch, fallbackPatch\) \{[\s\S]*?\n\}/);
const coreMatch = appJs.match(/async function updateTradeWithSupabase\(sb, id, patch\) \{[\s\S]*?\n\}/);
const dbUpdateMatch = appJs.match(/async updateTrade\(id, patch\) \{\s*\/\/ R4:[\s\S]*?return updateTradeWithSupabase\(this\.supabase, id, patch\);\s*\},/);

assert.ok(buildMatch, 'buildTradeUpdateFallbackPatch required in app.js');
assert.ok(acceptMatch, 'shouldAcceptTradeUpdateFallback required in app.js');
assert.ok(coreMatch, 'updateTradeWithSupabase required in app.js');
assert.ok(dbUpdateMatch, 'DB.updateTrade must delegate to updateTradeWithSupabase');

function makeMockClient(handler) {
  return {
    from(table) {
      return {
        update(patch) {
          return {
            eq(col, id) {
              return Promise.resolve(handler({ table, patch, col, id }));
            },
          };
        },
      };
    },
  };
}

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

const sandbox = {
  console,
  Object,
  Promise,
  Error,
  buildTradeUpdateFallbackPatch: null,
  shouldAcceptTradeUpdateFallback: null,
};
vm.createContext(sandbox);
vm.runInContext(
  buildMatch[0] + '\n' + acceptMatch[0] + '\n' + coreMatch[0] + '\n'
  + 'this.buildTradeUpdateFallbackPatch = buildTradeUpdateFallbackPatch;\n'
  + 'this.shouldAcceptTradeUpdateFallback = shouldAcceptTradeUpdateFallback;\n'
  + 'this.updateTradeWithSupabase = updateTradeWithSupabase;\n'
  + 'this.DB = {\n'
  + '  _client: null,\n'
  + '  get supabase() { return this._client; },\n'
  + '  async updateTrade(id, patch) { return updateTradeWithSupabase(this.supabase, id, patch); },\n'
  + '};\n',
  sandbox
);

assert.strictEqual(typeof sandbox.updateTradeWithSupabase, 'function');
assert.strictEqual(typeof sandbox.DB.updateTrade, 'function');

// --- Case 1: primary success — close_trace_json persisted; no fallback ---
{
  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    calls.push({ phase: calls.length === 0 ? 'primary' : 'fallback', patch });
    return { error: null };
  });
  const ok = await sandbox.DB.updateTrade('t1', closePatch);
  assert.strictEqual(ok, true, 'primary success must return true');
  assert.strictEqual(calls.length, 1, 'primary success must not invoke fallback');
  assert.strictEqual(calls[0].phase, 'primary');
  assert.ok(calls[0].patch.close_trace_json.close_reason_provenance);
  assert.ok(Object.prototype.hasOwnProperty.call(calls[0].patch, 'friction_cost'));
}

// --- Case 2: fallback success — primary fails, fallback keeps close_trace_json ---
{
  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    const phase = Object.prototype.hasOwnProperty.call(patch, 'friction_cost') ? 'primary' : 'fallback';
    calls.push({ phase, patch });
    if (phase === 'primary') return { error: { message: 'column friction_cost does not exist' } };
    assert.ok(patch.close_trace_json, 'fallback must retain close_trace_json');
    assert.ok(patch.close_trace_json.close_reason_provenance);
    assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'friction_cost'));
    return { error: null };
  });
  // supabase-js throws when error is truthy only if our code throws on error.
  // updateTradeWithSupabase does: if (error) throw error; — throwing a non-Error works.
  const ok = await sandbox.DB.updateTrade('t2', closePatch);
  assert.strictEqual(ok, true, 'fallback with close_trace_json retained must succeed');
  assert.deepStrictEqual(calls.map(c => c.phase), ['primary', 'fallback']);
}

// --- Case 3: close_trace_json rejection — fallback would drop it → NOT success ---
{
  // Force the real updateTradeWithSupabase gate by temporarily wrapping the
  // real buildTradeUpdateFallbackPatch to drop close_trace_json (simulating the
  // old buggy strip). The REAL shouldAcceptTradeUpdateFallback + REAL
  // updateTradeWithSupabase path must refuse success.
  const realBuild = sandbox.buildTradeUpdateFallbackPatch;
  sandbox.buildTradeUpdateFallbackPatch = function buggyDrop(patch) {
    const out = realBuild(patch);
    delete out.close_trace_json;
    return out;
  };
  // Re-bind core against the sandbox's current build/accept bindings.
  // updateTradeWithSupabase closed over the vm-local buildTradeUpdateFallbackPatch
  // from runInContext — so override inside the vm:
  vm.runInContext(
    'buildTradeUpdateFallbackPatch = function(patch) {\n'
    + '  const optionalAdditiveCloseFields = ["friction_cost","friction_breakdown_json","net_pnl","net_won","friction_version"];\n'
    + '  const fallbackPatch = { ...(patch || {}) };\n'
    + '  optionalAdditiveCloseFields.forEach(k => { delete fallbackPatch[k]; });\n'
    + '  delete fallbackPatch.close_trace_json; // simulate drop\n'
    + '  return fallbackPatch;\n'
    + '};\n',
    sandbox
  );
  // Re-install updateTradeWithSupabase so it sees the overridden build.
  vm.runInContext(coreMatch[0] + '\nthis.updateTradeWithSupabase = updateTradeWithSupabase;\n'
    + 'this.DB.updateTrade = async function(id, patch) { return updateTradeWithSupabase(this.supabase, id, patch); };\n',
    sandbox);

  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    calls.push(patch);
    return { error: { message: 'column friction_cost does not exist' } };
  });
  const ok = await sandbox.DB.updateTrade('t3', closePatch);
  assert.strictEqual(
    ok,
    false,
    'fallback that would drop close_trace_json must NOT report success'
  );
  // Only primary attempted; gate refuses before fallback write.
  assert.strictEqual(calls.length, 1, 'must not write a stripped fallback');
}

// --- Case 4: close_trace_json itself rejected by DB on fallback → false ---
{
  // Restore clean real helpers + core.
  vm.runInContext(
    buildMatch[0] + '\n' + acceptMatch[0] + '\n' + coreMatch[0] + '\n'
    + 'this.buildTradeUpdateFallbackPatch = buildTradeUpdateFallbackPatch;\n'
    + 'this.shouldAcceptTradeUpdateFallback = shouldAcceptTradeUpdateFallback;\n'
    + 'this.updateTradeWithSupabase = updateTradeWithSupabase;\n'
    + 'this.DB.updateTrade = async function(id, patch) { return updateTradeWithSupabase(this.supabase, id, patch); };\n',
    sandbox
  );
  sandbox.DB._client = makeMockClient(({ patch }) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'friction_cost')) {
      return { error: { message: 'column friction_cost does not exist' } };
    }
    return { error: { message: 'close_trace_json rejected' } };
  });
  const ok = await sandbox.DB.updateTrade('t4', closePatch);
  assert.strictEqual(ok, false, 'DB rejection of close_trace_json must not report success');
}

console.log('batch_a_close_provenance_update_trade_r4_ok');
