/**
 * Executable JS harness for Codex B1/B6/B7 + R2.4/R2.5/R2.6 rectification.
 * Extracts into a temporary directory so the worktree stays clean.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'app.js');
const src = fs.readFileSync(appPath, 'utf8');
const producerFixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests', 'fixtures', 'paper_analysis_authorization_v1.json'), 'utf8'
));
const producerCandidate = producerFixture.candidates.find((candidate) => candidate.id === 'fixture_nf_1');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-paper-extract-'));
const extractOut = path.join(tmpDir, '_extracted_paper_fns.js');
execSync('python3 tests/_extract_paper_fns.py', {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, PAPER_EXTRACT_OUT: extractOut },
});
const extracted = fs.readFileSync(extractOut, 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const confirms = [];
const inserts = [];
const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, Set, Map,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  alert: () => {},
  confirm: (m) => { confirms.push(String(m)); return true; },
  STATE: { pollHistory: [], positioningCandidates: [], tradeMode: 'intraday', lastScanTime: null, biasDrift: 0, contrarianPCR: null },
  bd: { generated_candidates: [], watchlist: [], brain_version: '2.6.41', institutionalRegime: null, gapInfo: null, morningBias: null, position_live: {}, positions: {} },
  CALIBRATION: { win_rates: {} },
  C: { NF_LOT: 65, BNF_LOT: 30 },
  API: { todayIST: () => '2026-09-10', minutesSinceOpen: () => 60, tradingDTE: () => 5 },
  NativeBridge: {
    getLatestPoll: () => '{}', getPollHistory: () => '[]', getBnfChain: () => '{}', getNfChain: () => '{}',
    getMorningSnapshot: () => '{}', getYesterdayHistory: () => '[]', getBnfBreadth: () => '{}',
    getNf50Breadth: () => '{}', getGlobalDirection: () => '{}', getBaseline: () => '{}',
  },
  localeNumberOrFallback: (n) => (n == null ? '--' : String(n)),
  friendlyType: (t) => String(t || ''),
  alignmentDots: () => '•••',
  forceIcon: () => '●',
  candidateLegCount: (c) => (c && (c.sellStrike2 != null || c.buyStrike2 != null) ? 4 : 2),
  paperTradeCapacity: () => ({ available: true, count: 0, limit: 2 }),
  finalEntryAuthorization: (cand) => {
    if (cand?.finalEntryAllowed === true) return { allowed: true, reason: '' };
    if (cand?.directionSafe === false || cand?.entryAction === 'BLOCKED' || cand?.blocked === true) {
      return { allowed: false, reason: 'brain blocked' };
    }
    if (cand?.entryEligible === false) return { allowed: false, reason: 'entry not eligible' };
    return { allowed: true, reason: '' };
  },
  marginDisplay: () => ({ value: 10000, label: '', source: 'EST' }),
  peakCash: () => 5000,
  realMarginValue: () => 10000,
  numericField: () => null,
  renderBrainForCandidate: () => '',
  latestPollData: () => ({ nfSpot: 25000, bnfSpot: 52000, vix: 14 }),
  safeParseNB: (raw, fb) => { try { return JSON.parse(raw || 'null') ?? fb; } catch { return fb; } },
};

vm.runInNewContext(
  extracted + '\n;globalThis.__MR = { normalizePaperIndexKey, parsePositiveIntegralLotJs, paperContractIdentityGate, paperTradeAuthorization, paperAnalysisAuthorization, paperTestVetoes, confirmPaperTest, experimentalKellyAdvisoryReadout, sanitizeTradeForInsert, renderCandidateCard };',
  sandbox,
  { filename: '_extracted_paper_fns.js', timeout: 5000 },
);
const MR = sandbox.__MR;

function baseCand(over = {}) {
  return {
    ...JSON.parse(JSON.stringify(producerCandidate)),
    width: 100, isCredit: true,
    forces: { f1: 1, f2: 1, f3: 1, aligned: 3 }, entryEligible: true,
    executionReadiness: { ready: true, mode: 'paper', gate: 'READY', reasons: [] },
    directionSafe: true, entryAction: 'TAKE', p_ml: 0.55, identity_complete: true,
    ...over,
  };
}

// --- R1 retained ---
const htmlOk = MR.renderCandidateCard(baseCand(), 25000, 'R1');
assert(typeof htmlOk === 'string' && htmlOk.length > 50, 'render ok');

const htmlAlt = MR.renderCandidateCard(baseCand({
  directionSafe: false, blocked: true, entryAction: 'BLOCKED', entryEligible: false,
  forces: { f1: 1, f2: 1, f3: 0, aligned: 2 },
}), 25000, 'A1');
assert(/PAPER ANALYSIS/i.test(htmlAlt), 'analysis label');
assert(/disabled/i.test(htmlAlt), 'real disabled');

const htmlLocked = MR.renderCandidateCard(baseCand({
  id: 'alt2', directionSafe: false, blocked: true, entryAction: 'BLOCKED', entryEligible: false,
  forces: { f1: 1, f2: 1, f3: 0, aligned: 2 },
}), 25000, 'A2');
assert(/PAPER ANALYSIS LOCKED/i.test(htmlLocked), 'locked');

const noBrain = MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: undefined, paperAnalysisEligible: undefined }));
assert(noBrain.allowed === false, 'no structural fallback');

assert(MR.paperAnalysisAuthorization(baseCand()).allowed === true, 'real producer authorization ok');
assert(MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: { allowed: true } })).allowed === false, 'bare allowed locked');
assert(MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: { allowed: true, authorization_id: 'x1' } })).allowed === false, 'missing schema/brain locked');
assert(MR.paperAnalysisAuthorization(baseCand({ index: null, paperAnalysisEligibility: { allowed: true, authorization_id: 'z', schema_version: 'paper_analysis_v1', brain_version: 'b', candidate_id: 'c1' } })).allowed === false, 'no index invent');
assert(MR.normalizePaperIndexKey('') === null && MR.normalizePaperIndexKey('BNF') === 'BNF', 'index normalize');
assert(MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: { allowed: true, authorization_id: 'z', schema_version: 'paper_analysis_v1', brain_version: 'b', candidate_id: 'c1' }, lot_conflict: true })).allowed === false, 'conflict');
assert(MR.paperTradeAuthorization(baseCand({ index: 'UNKNOWN', lotSize: 65 })).allowed === false, 'unknown index');

// R2.4: legacy boolean alone NEVER authorizes
const legacyOnly = MR.paperAnalysisAuthorization(baseCand({
  paperAnalysisEligibility: undefined,
  paperAnalysisEligible: true,
}));
assert(legacyOnly.allowed === false, 'legacy boolean locked');
assert(legacyOnly.source === 'legacy_boolean_ignored_not_authorization', 'legacy source diagnostic');
assert(legacyOnly.legacy_boolean_diagnostic === true, 'legacy diagnostic retained');

// R2.5: fractional lot rejected
const frac = MR.paperContractIdentityGate(baseCand({ lotSize: 65.5, contract_lot_size: 65.5, contract_identity: { identity_complete: true, contract_lot_size: 65.5 } }));
assert(frac.ok === false, 'fractional lot rejected');
assert(frac.lotFieldStatus === 'field_present_but_invalid', 'fractional status');

// nested-only BNF identity → authorized lot equals nested
const bnfNested = MR.paperTradeAuthorization(baseCand({
  index: 'BNF', lotSize: undefined, lot_size: undefined, contract_lot_size: undefined,
  quantity_units: undefined,
  contract_identity: { identity_complete: true, lot_conflict: false, contract_lot_size: 35, index_key: 'BNF', number_of_lots: 1, quantity_units: 35 },
  sellStrike: 52000, buyStrike: 52100,
}));
assert(bnfNested.allowed === true, 'bnf nested auth');
assert(bnfNested.lotSize === 35, 'authorized lot equals nested 35');

const nfNested = MR.paperTradeAuthorization(baseCand({
  lotSize: undefined, lot_size: undefined,
  contract_identity: { identity_complete: true, lot_conflict: false, contract_lot_size: 65, index_key: 'NF', number_of_lots: 2, quantity_units: 130 },
  number_of_lots: 2, quantity_units: 130, contract_lot_size: 65,
}));
assert(nfNested.allowed === true, 'nf two-lot');
assert(nfNested.lotSize === 65 && nfNested.number_of_lots === 2 && nfNested.quantity_units === 130, 'qty consistency');

// R2.6: sanitize strips unsupported top-level paper provenance; nested survives
const sanitized = MR.sanitizeTradeForInsert({
  strategy_type: 'BEAR_CALL',
  index_key: 'NF',
  lot_size: 65,
  number_of_lots: 1,
  quantity_units: 65,
  paper_lane: 'paper_analysis',
  selection_source: 'operator_paper_analysis',
  paper_policy_version: 'v1',
  brain_authorization_id: 'auth-9',
  paper_test: { paper_lane: 'paper_analysis', schema_version: 'paper_lane_provenance_v2_20260913' },
  entry_snapshot: { lot_size: 65 },
  real_margin: 1,
});
assert(sanitized.paper_lane === undefined, 'no top-level paper_lane');
assert(sanitized.selection_source === undefined, 'no top-level selection_source');
assert(sanitized.paper_policy_version === undefined, 'no top-level paper_policy_version');
assert(sanitized.brain_authorization_id === undefined, 'no top-level brain_authorization_id');
assert(sanitized.paper_test === undefined, 'no top-level paper_test');
assert(sanitized.lot_size === undefined, 'no top-level lot_size');
assert(sanitized.entry_snapshot.paper_test.paper_lane === 'paper_analysis', 'nested provenance survives');
assert(sanitized.entry_snapshot.paper_lane === 'paper_analysis', 'compact mirror');
assert(sanitized.entry_snapshot.lot_size === 65, 'lot in snapshot');

confirms.length = 0;
MR.confirmPaperTest(baseCand(), { allowed: false, reason: 'wait' }, { count: 0, limit: 2 }, { paper_lane: 'paper_analysis' });
assert(/PAPER ANALYSIS/i.test(confirms[0]) && /EXPERIMENTAL/i.test(confirms[0]), 'analysis confirm');
confirms.length = 0;
MR.confirmPaperTest(baseCand(), { allowed: true, reason: '' }, { count: 0, limit: 2 }, { paper_lane: 'paper_primary' });
assert(/PAPER TEST/i.test(confirms[0]), 'primary confirm');

assert(MR.experimentalKellyAdvisoryReadout(baseCand()) === '' || !/lot/i.test(MR.experimentalKellyAdvisoryReadout(baseCand()) || ''), 'kelly hidden');

assert(src.includes('paper_lane_provenance_v2_20260913'), 'provenance schema');
assert(src.includes('brain_authorization_id'), 'brain auth id');
assert(!src.includes("source: 'pwa_structural_fallback'"), 'no fallback source');
assert(!src.includes('else if (typeof candidate?.paperAnalysisEligible === \'boolean\')'), 'legacy auth branch removed');

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
console.log('PASS: test_paper_render_rectification.mjs');
