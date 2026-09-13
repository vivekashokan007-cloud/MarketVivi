/**
 * R3.1 + R3.7: multi-lot save/readback and paper analysis auth binding.
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
  const asyncPrefix = src.slice(Math.max(0, i - 6), i);
  if (asyncPrefix.includes('async')) i = src.lastIndexOf('async', i);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') {
      depth--;
      if (started && depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unterm ${name}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-r3-'));
const extractOut = path.join(tmpDir, '_extracted_paper_fns.js');
execSync('python3 tests/_extract_paper_fns.py', {
  cwd: root, stdio: 'pipe', env: { ...process.env, PAPER_EXTRACT_OUT: extractOut },
});
let extracted = fs.readFileSync(extractOut, 'utf8');
for (const n of ['takeTradeImpl']) {
  const body = extractFunction(appSrc, n);
  if (!extracted.includes(`function ${n}`) && !extracted.includes(`async function ${n}`)) {
    extracted += '\n\n' + body;
  }
}

const stored = [];
const alerts = [];
const confirms = [];

const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests', 'fixtures', 'paper_analysis_authorization_v1.json'),
  'utf8',
));
assert(fixture.generated_by === 'Marketapp/tools/generate_paper_analysis_authorization_fixture.py', 'real producer fixture provenance');
assert(fixture.compaction_path === 'brain._candidate_view -> NativeBridge allowlist -> PWA', 'real compaction path provenance');
const candidates = Object.fromEntries(fixture.candidates.map((candidate) => {
  candidate.width = 100;
  candidate.isCredit = true;
  candidate.forces = { f1: 1, f2: 1, f3: 1, aligned: 3 };
  candidate.executionReadiness = { ready: false, mode: 'paper', reasons: ['blocked'] };
  candidate.estCost = 12 * candidate.number_of_lots;
  return [candidate.id, candidate];
}));

const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, Set, Map, Promise,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  alert: (m) => { alerts.push(String(m)); },
  confirm: (m) => { confirms.push(String(m)); return true; },
  setTimeout,
  window: {},
  STATE: { pollHistory: [], positioningCandidates: [], tradeMode: 'intraday', lastScanTime: null, biasDrift: 0, contrarianPCR: null, openTrades: [] },
  bd: {
    generated_candidates: Object.values(candidates),
    watchlist: [],
    brain_version: '2.6.41',
    institutionalRegime: null, gapInfo: null, morningBias: null,
    position_live: {}, positions: {},
  },
  CALIBRATION: { win_rates: {} },
  C: { NF_LOT: 999, BNF_LOT: 888 },
  API: { todayIST: () => '2026-09-10', minutesSinceOpen: () => 60, tradingDTE: () => 5 },
  NativeBridge: {
    getLatestPoll: () => JSON.stringify({ nfSpot: 25000, bnfSpot: 52000, vix: 14, bias: { label: 'N', net: 0, signals: [] } }),
    getPollHistory: () => '[]',
    getBnfChain: () => JSON.stringify({ strikes: {} }),
    getNfChain: () => JSON.stringify({ strikes: {} }),
    getMorningSnapshot: () => '{}',
    getYesterdayHistory: () => '[]',
    getBnfBreadth: () => '{}',
    getNf50Breadth: () => '{}',
    getGlobalDirection: () => '{}',
    getBaseline: () => '{}',
  },
  DB: {
    supabase: { from: () => ({ insert: async () => ({ data: null, error: null }), update: async () => ({ error: null }), select: () => ({ single: async () => ({ data: null, error: null }) }) }) },
    async insertTrade(trade) {
      const sanitized = sandbox.sanitizeTradeForInsert(trade);
      const unsupported = ['paper_lane', 'selection_source', 'paper_policy_version', 'brain_authorization_id', 'paper_test'];
      if (unsupported.some((k) => Object.prototype.hasOwnProperty.call(sanitized, k) && sanitized[k] != null)) return null;
      const row = { id: `db-${stored.length + 1}`, ...sanitized };
      stored.push(row);
      return { id: row.id };
    },
    async updateTrade() { return true; },
  },
  findCandidateById: (id) => candidates[id] || null,
  addOpenTradeToState: (t) => { sandbox.STATE.openTrades.push(t); },
  playSound: () => {}, switchTab: () => {}, renderAll: () => {}, addNotificationLog: () => {},
  friendlyType: (t) => String(t || ''),
  realMarginValue: () => 10000, numericField: () => null,
  candidateLegCount: (c) => 2,
  paperTradeCapacity: () => ({ available: true, count: 0, limit: 99 }),
  finalEntryAuthorization: () => ({ allowed: false, reason: 'brain blocked' }),
  safeParseNB: (raw, fb) => { try { return JSON.parse(raw || 'null') ?? fb; } catch { return fb; } },
};
sandbox.window = { NativeBridge: sandbox.NativeBridge };
vm.runInNewContext(
  extracted + `;globalThis.sanitizeTradeForInsert=sanitizeTradeForInsert;globalThis.paperAnalysisAuthorization=paperAnalysisAuthorization;globalThis.takeTradeImpl=takeTradeImpl;`,
  sandbox, { filename: 'r3.js', timeout: 10000 },
);

const oneLotPnls = {};
for (const index of ['NF', 'BNF']) {
  const cls = index === 'NF' ? 65 : 30;
  for (const n of [1, 2, 4]) {
    stored.length = 0;
    const id = `fixture_${index.toLowerCase()}_${n}`;
    await sandbox.takeTradeImpl(id, true);
    assert(stored.length === 1, `${id} saved`);
    const row = stored[0];
    assert(row.lots === n, `${id} lots`);
    assert(row.entry_snapshot.contract_lot_size === cls, `${id} cls`);
    assert(row.entry_snapshot.number_of_lots === n, `${id} n`);
    assert(row.entry_snapshot.quantity_units === cls * n, `${id} qty`);
    assert(row.entry_snapshot.lot_size === cls * n, `${id} legacy total`);
    assert(row.entry_snapshot.quantity_units === row.entry_snapshot.contract_lot_size * row.entry_snapshot.number_of_lots, `${id} product`);
  }
}

// Auth binding rejects
const bare = sandbox.paperAnalysisAuthorization({ paperAnalysisEligibility: { allowed: true } });
assert(bare.allowed === false, 'bare {allowed:true} locked');
const legacy = sandbox.paperAnalysisAuthorization({ paperAnalysisEligible: true });
assert(legacy.allowed === false, 'legacy boolean locked');
const full = sandbox.paperAnalysisAuthorization(candidates.fixture_nf_1);
assert(full.allowed === true, 'fully bound auth passes');
for (const [field, reason] of [
  ['candidate_id', 'candidate'], ['session_date', 'session'], ['scan_identity', 'scan'],
  ['expiry', 'expiry'], ['brain_version', 'brain_version'],
  ['contract_identity_digest', 'identity_digest'],
]) {
  const mutated = JSON.parse(JSON.stringify(candidates.fixture_nf_1));
  mutated.paperAnalysisEligibility[field] = `stale-${field}`;
  const rejected = sandbox.paperAnalysisAuthorization(mutated);
  assert(rejected.allowed === false, `${field} mismatch locked`);
  assert(rejected.reasons.some((item) => String(item).includes(reason)), `${field} mismatch reason`);
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
console.log('PASS: test_paper_r3_multilot_auth.mjs');
