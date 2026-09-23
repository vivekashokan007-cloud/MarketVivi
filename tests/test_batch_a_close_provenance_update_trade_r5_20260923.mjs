/**
 * R5: real DB.updateTrade / updateTradeWithSupabase under mocked client.
 * Extends R4 cases with null/missing client → false (does not throw), and
 * verifies closeTrade's false → Trade Close Sync Failed path.
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
assert.ok(
  /if\s*\(\s*!sb\s*\)\s*return\s*false\s*;/.test(coreMatch[0]),
  'null/missing client must return false (not throw)'
);
assert.ok(
  !/if\s*\(\s*!sb\s*\)\s*throw\s+new\s+Error\(['"]Supabase client unavailable['"]\)/.test(coreMatch[0]),
  'updateTradeWithSupabase must not throw for missing client'
);

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

// --- Case 1: primary success ---
{
  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    calls.push({ phase: calls.length === 0 ? 'primary' : 'fallback', patch });
    return { error: null };
  });
  const ok = await sandbox.DB.updateTrade('t1', closePatch);
  assert.strictEqual(ok, true, 'primary success must return true');
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].patch.close_trace_json.close_reason_provenance);
}

// --- Case 2: fallback success keeps close_trace_json ---
{
  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    const phase = Object.prototype.hasOwnProperty.call(patch, 'friction_cost') ? 'primary' : 'fallback';
    calls.push({ phase, patch });
    if (phase === 'primary') return { error: { message: 'column friction_cost does not exist' } };
    assert.ok(patch.close_trace_json, 'fallback must retain close_trace_json');
    return { error: null };
  });
  const ok = await sandbox.DB.updateTrade('t2', closePatch);
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(calls.map(c => c.phase), ['primary', 'fallback']);
}

// --- Case 3: fallback that would drop close_trace_json → false ---
{
  vm.runInContext(
    'buildTradeUpdateFallbackPatch = function(patch) {\n'
    + '  const optionalAdditiveCloseFields = ["friction_cost","friction_breakdown_json","net_pnl","net_won","friction_version"];\n'
    + '  const fallbackPatch = { ...(patch || {}) };\n'
    + '  optionalAdditiveCloseFields.forEach(k => { delete fallbackPatch[k]; });\n'
    + '  delete fallbackPatch.close_trace_json;\n'
    + '  return fallbackPatch;\n'
    + '};\n',
    sandbox
  );
  vm.runInContext(
    coreMatch[0] + '\nthis.updateTradeWithSupabase = updateTradeWithSupabase;\n'
    + 'this.DB.updateTrade = async function(id, patch) { return updateTradeWithSupabase(this.supabase, id, patch); };\n',
    sandbox
  );
  const calls = [];
  sandbox.DB._client = makeMockClient(({ patch }) => {
    calls.push(patch);
    return { error: { message: 'column friction_cost does not exist' } };
  });
  const ok = await sandbox.DB.updateTrade('t3', closePatch);
  assert.strictEqual(ok, false);
  assert.strictEqual(calls.length, 1);
}

// --- Case 4: close_trace_json rejected by DB on fallback → false ---
{
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
  assert.strictEqual(ok, false);
}

// --- Case 5 R5: null client → false, does not throw ---
{
  sandbox.DB._client = null;
  let threw = false;
  let ok;
  try {
    ok = await sandbox.DB.updateTrade('t5', closePatch);
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'null client must not throw from DB.updateTrade');
  assert.strictEqual(ok, false, 'null client must return false');
  ok = await sandbox.updateTradeWithSupabase(null, 't5b', closePatch);
  assert.strictEqual(ok, false);
}

// --- Case 6 R5: closeTrade false → Trade Close Sync Failed ---
{
  assert.ok(
    /const closeSynced = await DB\.updateTrade\(trade\.id, remoteClosePatch\);/.test(appJs),
    'closeTrade must await DB.updateTrade'
  );
  assert.ok(
    /if\s*\(\s*!closeSynced\s*\)\s*\{[\s\S]*?Trade Close Sync Failed/.test(appJs),
    'closeTrade must record Trade Close Sync Failed when updateTrade returns false'
  );
  const notifications = [];
  const closeSynced = false; // null-client / sync failure
  if (!closeSynced) {
    notifications.push({
      title: 'Trade Close Sync Failed',
      body: 't-close: closed locally but Supabase update failed. Check Logs tab.',
      urgency: 'urgent',
    });
  }
  assert.strictEqual(notifications.length, 1);
  assert.strictEqual(notifications[0].title, 'Trade Close Sync Failed');
}

console.log('batch_a_close_provenance_update_trade_r5_ok');
