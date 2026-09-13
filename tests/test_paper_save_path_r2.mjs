/**
 * R2.6 executable Paper save-path: authorization → confirm → sanitize → insert →
 * fallback → readback. Does not rely on source-string assertions as sole proof.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

function extractFunction(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let i = m.index;
  // include async keyword
  const asyncPrefix = src.slice(Math.max(0, i - 6), i);
  if (asyncPrefix.includes('async')) i = src.lastIndexOf('async', i);
  let depth = 0;
  let started = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unterm ${name}`);
}

const names = [
  'normalizePaperIndexKey',
  'parsePositiveIntegralLotJs',
  'paperContractIdentityGate',
  'paperTradeAuthorization',
  'paperAnalysisAuthorization',
  'paperTestVetoes',
  'confirmPaperTest',
  'sanitizeTradeForInsert',
  'candidateLegCount',
  'paperTradeCapacity',
  'finalEntryAuthorization',
];

// Prefer extractor for the shared set; manually pull takeTradeImpl + helpers.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-paper-save-'));
const extractOut = path.join(tmpDir, '_extracted_paper_fns.js');
execSync('python3 tests/_extract_paper_fns.py', {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, PAPER_EXTRACT_OUT: extractOut },
});
let extracted = fs.readFileSync(extractOut, 'utf8');
// Append takeTradeImpl and minimal deps that extractor may not include.
for (const n of ['takeTradeImpl']) {
  try {
    const body = extractFunction(appSrc, n);
    if (!extracted.includes(`function ${n}`) && !extracted.includes(`async function ${n}`)) {
      extracted += '\n\n' + body;
    }
  } catch (e) {
    throw e;
  }
}

const stored = [];
const alerts = [];
const confirms = [];
let realAction = false;

const candidates = {
  c_analysis: {
    id: 'c_analysis', type: 'BEAR_CALL', index: 'NF', expiry: '2026-09-17', tDTE: 2,
    sellStrike: 25000, sellType: 'CE', sellLTP: 40, buyStrike: 25100, buyType: 'CE', buyLTP: 20,
    width: 100, netPremium: 20, isCredit: true, maxProfit: 1300, maxLoss: 5200,
    // Nested-only identity — flat lotSize intentionally absent / different constant would be 65
    contract_lot_size: 65, number_of_lots: 1, quantity_units: 65,
    identity_complete: true,
    contract_identity: { identity_complete: true, lot_conflict: false, contract_lot_size: 65, index_key: 'NF', number_of_lots: 1, quantity_units: 65 },
    forces: { f1: 1, f2: 1, f3: 1, aligned: 3 },
    entryEligible: false, directionSafe: false, entryAction: 'BLOCKED', blocked: true,
    executionReadiness: { ready: false, mode: 'paper', reasons: ['blocked'] },
    paperAnalysisEligibility: { allowed: true, authorization_id: 'pa-r2', reasons: [], schema_version: 'paper_analysis_v1', brain_version: 'brain_test_v1', candidate_id: 'c_analysis' },
    estCost: 12,
  },
};

const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, Set, Map, Promise,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  alert: (m) => { alerts.push(String(m)); },
  confirm: (m) => { confirms.push(String(m)); return true; },
  setTimeout,
  window: {},
  STATE: { pollHistory: [], positioningCandidates: [], tradeMode: 'intraday', lastScanTime: null, biasDrift: 0, contrarianPCR: null, openTrades: [] },
  bd: {
    generated_candidates: [candidates.c_analysis],
    watchlist: [],
    brain_version: 'brain_test_v1',
    institutionalRegime: null,
    gapInfo: null,
    morningBias: null,
    position_live: {},
    positions: {},
  },
  CALIBRATION: { win_rates: {} },
  C: { NF_LOT: 999, BNF_LOT: 888 }, // poison constants — paper must not use after auth
  API: { todayIST: () => '2026-09-13', minutesSinceOpen: () => 60, tradingDTE: () => 2 },
  NativeBridge: {
    getLatestPoll: () => JSON.stringify({ nfSpot: 25000, bnfSpot: 52000, vix: 14, bias: { label: 'N', net: 0, signals: [] } }),
    getPollHistory: () => '[]',
    getBnfChain: () => JSON.stringify({ strikes: {} }),
    getNfChain: () => JSON.stringify({ strikes: { 25000: { CE: { oi: 1 } }, 25100: { CE: { oi: 1 } } } }),
    getMorningSnapshot: () => '{}',
    getYesterdayHistory: () => '[]',
    getBnfBreadth: () => '{}',
    getNf50Breadth: () => '{}',
    getGlobalDirection: () => '{}',
    getBaseline: () => '{}',
  },
  DB: {
    supabase: {
      from: () => ({ insert: async () => ({ data: null, error: null }), update: async () => ({ error: null }), select: () => ({ single: async () => ({ data: null, error: null }) }) }),
    },
    async insertTrade(trade) {
      const sanitized = sandbox.sanitizeTradeForInsert
        ? sandbox.sanitizeTradeForInsert(trade)
        : trade;
      // Simulate absent-column rejection once if unsupported top-level fields sneak in
      const unsupported = ['paper_lane', 'selection_source', 'paper_policy_version', 'brain_authorization_id', 'paper_test'];
      const hasUnsupported = unsupported.some((k) => Object.prototype.hasOwnProperty.call(sanitized, k) && sanitized[k] != null);
      if (hasUnsupported) {
        const err = new Error('column paper_lane does not exist');
        console.warn('[DB] insertTrade failed:', err.message);
        return null;
      }
      const row = { id: `db-${stored.length + 1}`, ...sanitized };
      stored.push(row);
      return { id: row.id };
    },
    async updateTrade() { return true; },
  },
  findCandidateById: (id) => candidates[id] || null,
  addOpenTradeToState: (t) => { sandbox.STATE.openTrades.push(t); },
  playSound: () => {},
  switchTab: () => {},
  renderAll: () => {},
  addNotificationLog: () => {},
  friendlyType: (t) => String(t || ''),
  realMarginValue: () => 10000,
  numericField: () => null,
  candidateLegCount: (c) => (c && (c.sellStrike2 != null || c.buyStrike2 != null) ? 4 : 2),
  paperTradeCapacity: () => ({ available: true, count: 0, limit: 2 }),
  finalEntryAuthorization: (cand) => {
    if (cand?.blocked || cand?.entryAction === 'BLOCKED' || cand?.directionSafe === false) {
      return { allowed: false, reason: 'brain blocked' };
    }
    return { allowed: true, reason: '' };
  },
  safeParseNB: (raw, fb) => { try { return JSON.parse(raw || 'null') ?? fb; } catch { return fb; } },
};

sandbox.window = { NativeBridge: sandbox.NativeBridge };
vm.runInNewContext(
  extracted + `
    ;globalThis.sanitizeTradeForInsert = sanitizeTradeForInsert;
    ;globalThis.paperAnalysisAuthorization = paperAnalysisAuthorization;
    ;globalThis.paperTradeAuthorization = paperTradeAuthorization;
    ;globalThis.paperContractIdentityGate = paperContractIdentityGate;
    ;globalThis.confirmPaperTest = confirmPaperTest;
    ;globalThis.paperTestVetoes = paperTestVetoes;
    ;globalThis.normalizePaperIndexKey = normalizePaperIndexKey;
    ;if (typeof takeTradeImpl === 'function') globalThis.takeTradeImpl = takeTradeImpl;
  `,
  sandbox,
  { filename: 'paper_save_path.js', timeout: 10000 },
);

assert(typeof sandbox.takeTradeImpl === 'function', 'takeTradeImpl extracted');
assert(typeof sandbox.sanitizeTradeForInsert === 'function', 'sanitize present');

await sandbox.takeTradeImpl('c_analysis', true);

assert(confirms.length >= 1, 'confirmation invoked');
assert(/PAPER ANALYSIS/i.test(confirms[0]), 'paper analysis confirm');
assert(stored.length === 1, 'one DB insert');
const row = stored[0];
assert(row.paper_lane === undefined, 'no unsupported top-level paper_lane');
assert(row.paper_test === undefined, 'no unsupported top-level paper_test');
assert(row.selection_source === undefined, 'no unsupported top-level selection_source');
assert(row.entry_snapshot?.paper_test?.paper_lane === 'paper_analysis', 'nested paper_analysis lane');
assert(row.entry_snapshot?.paper_lane === 'paper_analysis', 'compact mirror lane');
assert(row.entry_snapshot?.lot_size === 65, 'persisted lot equals authorized 65');
assert(row.entry_snapshot?.paper_test?.structural_contract?.authorization_lot_size === 65, 'auth lot stamped');
assert(row.entry_snapshot?.paper_test?.structural_contract?.lot_size === 65, 'structural lot');
// Poison constants were 999 — prove they were not used
assert(row.entry_snapshot?.lot_size !== 999, 'no C.NF_LOT fallback');
assert(alerts.every((a) => !/REAL TRADE/i.test(a)), 'no Real action');
assert(sandbox.STATE.openTrades.length === 1, 'local open trade');
assert(sandbox.STATE.openTrades[0].entry_snapshot?.paper_test?.paper_lane === 'paper_analysis', 'readback lane');

// paper_primary vs paper_analysis separation: primary path blocked for this candidate
stored.length = 0;
candidates.c_primary = {
  ...candidates.c_analysis,
  id: 'c_primary',
  blocked: false, directionSafe: true, entryAction: 'TAKE', entryEligible: true,
  paperAnalysisEligibility: undefined,
};
sandbox.bd.generated_candidates.push(candidates.c_primary);
sandbox.bd.watchlist.push(candidates.c_primary);
await sandbox.takeTradeImpl('c_primary', true);
assert(stored.length === 1, 'primary insert');
assert(stored[0].entry_snapshot?.paper_test?.paper_lane === 'paper_primary', 'paper_primary lane');

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
// R3.1 multi-lot persistence
stored.length = 0;
alerts.length = 0;
confirms.length = 0;
candidates.c_lots2 = {
  ...candidates.c_analysis,
  id: 'c_lots2',
  number_of_lots: 2,
  quantity_units: 130,
  contract_identity: { identity_complete: true, lot_conflict: false, contract_lot_size: 65, index_key: 'NF', number_of_lots: 2, quantity_units: 130 },
  paperAnalysisEligibility: { allowed: true, authorization_id: 'pa-lots2', reasons: [], schema_version: 'paper_analysis_v1', brain_version: 'brain_test_v1', candidate_id: 'c_lots2' },
};
sandbox.bd.generated_candidates.push(candidates.c_lots2);
await sandbox.takeTradeImpl('c_lots2', true);
assert(stored.length === 1, '2-lot insert');
assert(stored[0].lots === 2, 'top-level lots=2');
assert(stored[0].entry_snapshot?.contract_lot_size === 65, 'snapshot contract_lot_size');
assert(stored[0].entry_snapshot?.number_of_lots === 2, 'snapshot number_of_lots');
assert(stored[0].entry_snapshot?.quantity_units === 130, 'snapshot quantity_units');
assert(stored[0].entry_snapshot?.lot_size === 130, 'legacy lot_size = total units');

// R3.7 bare {allowed:true} locked at analysis authorization (not structural primary)
const bareAuth = sandbox.paperAnalysisAuthorization({
  ...candidates.c_analysis,
  id: 'c_bare',
  paperAnalysisEligibility: { allowed: true },
});
assert(bareAuth.allowed === false, 'bare allowed:true must not authorize analysis');
assert(/provenance/i.test(bareAuth.source + bareAuth.reason), 'provenance incomplete source');

console.log('PASS: test_paper_save_path_r2.mjs');
