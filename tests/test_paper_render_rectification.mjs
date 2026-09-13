/**
 * Executable JS harness for Codex B1/B6/B7 rectification.
 * Evals extracted renderCandidateCard paths from app.js — proves no ReferenceError.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

// Refresh extraction each run so tests track app.js
execSync('python3 tests/_extract_paper_fns.py', { cwd: root, stdio: 'pipe' });
const extracted = fs.readFileSync(path.join(__dirname, '_extracted_paper_fns.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const confirms = [];
const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, Set, Map,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  alert: () => {},
  confirm: (m) => { confirms.push(String(m)); return true; },
  STATE: { pollHistory: [], positioningCandidates: [], tradeMode: 'intraday', lastScanTime: null, biasDrift: 0, contrarianPCR: null },
  bd: { generated_candidates: [], watchlist: [], brain_version: 'brain_test_v1', institutionalRegime: null, gapInfo: null, morningBias: null, position_live: {}, positions: {} },
  CALIBRATION: { win_rates: {} },
  C: { NF_LOT: 65, BNF_LOT: 30 },
  API: { todayIST: () => '2026-09-13', minutesSinceOpen: () => 60, tradingDTE: () => 2 },
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
  extracted + '\n;globalThis.__MR = { normalizePaperIndexKey, paperContractIdentityGate, paperTradeAuthorization, paperAnalysisAuthorization, paperTestVetoes, confirmPaperTest, experimentalKellyAdvisoryReadout, renderCandidateCard };',
  sandbox,
  { filename: '_extracted_paper_fns.js', timeout: 5000 },
);
const MR = sandbox.__MR;

function baseCand(over = {}) {
  return {
    id: 'c1', type: 'BEAR_CALL', index: 'NF', expiry: '2026-09-17', tDTE: 2,
    sellStrike: 25000, sellType: 'CE', sellLTP: 40, buyStrike: 25100, buyType: 'CE', buyLTP: 20,
    width: 100, netPremium: 20, isCredit: true, maxProfit: 1300, maxLoss: 5200, lotSize: 65,
    forces: { f1: 1, f2: 1, f3: 1, aligned: 3 }, entryEligible: true,
    executionReadiness: { ready: true, mode: 'paper', gate: 'READY', reasons: [] },
    directionSafe: true, entryAction: 'TAKE', p_ml: 0.55, identity_complete: true,
    contract_identity: { identity_complete: true, lot_conflict: false, contract_lot_size: 65, index_key: 'NF' },
    ...over,
  };
}

assert(MR.experimentalKellyAdvisoryReadout(baseCand()) === '', 'Kelly hidden');

let html;
try {
  html = MR.renderCandidateCard(baseCand({
    paperAnalysisEligibility: { allowed: true, authorization_id: 'auth-1' },
    finalEntryAllowed: true,
  }), 25000, 1);
} catch (e) {
  throw new Error('renderCandidateCard crash: ' + e.stack);
}
assert(html.includes('v1-card'), 'card html');
assert(!/readout lots|EXPERIMENTAL Kelly/i.test(html), 'no Kelly');
assert(/PAPER TEST/i.test(html), 'primary paper');

const htmlAlt = MR.renderCandidateCard(baseCand({
  id: 'alt1', directionSafe: false, entryAction: 'BLOCKED', blocked: true, entryEligible: false,
  forces: { f1: 1, f2: 1, f3: 0, aligned: 2 },
  paperAnalysisEligibility: { allowed: true, authorization_id: 'pa-9', reasons: [] },
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
assert(noBrain.source !== 'pwa_structural_fallback', 'fallback source gone');

assert(MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: { allowed: true, authorization_id: 'x1' } })).allowed === true, 'brain ok');
assert(MR.paperAnalysisAuthorization(baseCand({ index: null, paperAnalysisEligibility: { allowed: true } })).allowed === false, 'no index invent');
assert(MR.normalizePaperIndexKey('') === null && MR.normalizePaperIndexKey('BNF') === 'BNF', 'index normalize');
assert(MR.paperAnalysisAuthorization(baseCand({ paperAnalysisEligibility: { allowed: true }, lot_conflict: true })).allowed === false, 'conflict');
assert(MR.paperTradeAuthorization(baseCand({ index: 'UNKNOWN', lotSize: 65 })).allowed === false, 'unknown index');

confirms.length = 0;
MR.confirmPaperTest(baseCand(), { allowed: false, reason: 'wait' }, { count: 0, limit: 2 }, { paper_lane: 'paper_analysis' });
assert(/PAPER ANALYSIS/i.test(confirms[0]) && /EXPERIMENTAL/i.test(confirms[0]), 'analysis confirm');
confirms.length = 0;
MR.confirmPaperTest(baseCand(), { allowed: true, reason: '' }, { count: 0, limit: 2 }, { paper_lane: 'paper_primary' });
assert(/PAPER TEST/i.test(confirms[0]), 'primary confirm');

assert(src.includes('paper_lane_provenance_v2_20260913'), 'provenance schema');
assert(src.includes('brain_authorization_id'), 'brain auth id');
assert(src.includes('paper_lane: paperLane'), 'paper_lane stamp');
assert(!src.includes("source: 'pwa_structural_fallback'"), 'no fallback source');

console.log('PASS: test_paper_render_rectification.mjs');
