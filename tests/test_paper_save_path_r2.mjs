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
const producerFixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests', 'fixtures', 'paper_analysis_authorization_v1.json'), 'utf8'
));
const fixtureById = Object.fromEntries(producerFixture.candidates.map((candidate) => [candidate.id, candidate]));

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
  'paperObservationAuthorization',
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
for (const n of ['finiteNumberOrNull','readValidatedMorningFiiDii','computeFiiDerivNet','readVixPreviousCloseAttribution','takeTradeImpl']) {
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
    ...JSON.parse(JSON.stringify(fixtureById.fixture_nf_1)),
    id: 'fixture_nf_1', width: 100, isCredit: true,
    forces: { f1: 1, f2: 1, f3: 1, aligned: 3 },
    entryEligible: false, directionSafe: false, entryAction: 'BLOCKED', blocked: true,
    executionReadiness: { ready: false, mode: 'paper', reasons: ['blocked'] },
    estCost: 12,
  },
};
candidates.fixture_nf_1 = candidates.c_analysis;

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
    brain_version: '2.6.41',
    institutionalRegime: null,
    gapInfo: null,
    morningBias: null,
    position_live: {},
    positions: {},
  },
  CALIBRATION: { win_rates: {} },
  C: { NF_LOT: 999, BNF_LOT: 888 }, // poison constants — paper must not use after auth
  API: { todayIST: () => '2026-09-10', minutesSinceOpen: () => 60, tradingDTE: () => 5 },
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
  brainFreshnessStatus: () => ({ fresh: true, reason: '' }),
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

await sandbox.takeTradeImpl('fixture_nf_1', true);

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
  ...JSON.parse(JSON.stringify(fixtureById.fixture_nf_2)),
  id: 'fixture_nf_2', width: 100, isCredit: true,
  forces: { f1: 1, f2: 1, f3: 1, aligned: 3 },
  entryEligible: false, directionSafe: false, entryAction: 'BLOCKED', blocked: true,
  executionReadiness: { ready: false, mode: 'paper', reasons: ['blocked'] },
};
candidates.fixture_nf_2 = candidates.c_lots2;
sandbox.bd.generated_candidates.push(candidates.c_lots2);
await sandbox.takeTradeImpl('fixture_nf_2', true);
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
assert(/authorization/i.test(bareAuth.source + bareAuth.reason), 'authorization incomplete source');

// 2 Nov phone regression: REAL observation authorization + REAL takeTradeImpl +
// REAL sanitization. No stub replaces quote projection or Paper authorization.
const authorityDebit = {
  id:'phone_bnf_debit', authorityPolicyVersion:'index_direction_v1', authorityOrder:'FIXED_PRESENTATION_ORDER_NOT_A_RANK',
  index:'BNF',type:'BEAR_PUT',expiry:'2026-11-23',lotSize:30,lots:1,isCredit:false,netPremium:-169.4,
  sellStrike:54400,sellType:'PE',buyStrike:54800,buyType:'PE',width:400,maxProfit:6918,maxLoss:5082,
  entryEligible:true,blocked:true, // manual analysis stays available while final managed entry is blocked
  lotEvidence:{status:'VERIFIED',index:'BNF',expiry:'2026-11-23'},
  legs:[{action:'SELL',strike:54400,option_type:'PE',bid:622.45,ask:624,instrument_key:'NSE_FO|BNF54400PE'},
    {action:'BUY',strike:54800,option_type:'PE',bid:789.75,ask:791.85,instrument_key:'NSE_FO|BNF54800PE'}],
};
const authorityFour = {
  ...authorityDebit,id:'phone_nf_condor',index:'NF',type:'IRON_CONDOR',expiry:'2026-11-03',lotSize:65,isCredit:true,
  sellStrike:23250,sellType:'CE',buyStrike:23400,buyType:'CE',sellStrike2:23150,sellType2:'PE',buyStrike2:23000,buyType2:'PE',
  lotEvidence:{status:'VERIFIED',index:'NF',expiry:'2026-11-03'},
  legs:[['SELL',23250,'CE',59.7,59.8],['SELL',23150,'PE',72.75,72.95],['BUY',23400,'CE',21.85,21.95],['BUY',23000,'PE',29.8,29.95]]
    .map(([action,strike,option_type,bid,ask])=>({action,strike,option_type,bid,ask,instrument_key:`NSE_FO|NF${strike}${option_type}`})),
};
for (const [source, premium, units] of [[authorityDebit,169.4,30],[authorityFour,80.55,65]]) {
  candidates[source.id]=source;sandbox.bd.generated_candidates.push(source);
  const before=JSON.stringify(source);stored.length=0;alerts.length=0;confirms.length=0;
  await sandbox.takeTradeImpl(source.id,true);
  assert(stored.length===1, 'phone-shaped Paper candidate saved: '+alerts.join(' | '));
  const saved=JSON.parse(JSON.stringify(stored[0])); // durable JSON round trip
  assert(saved.entry_premium===premium,'positive debit/credit convention');
  assert(saved.entry_snapshot.quantity_units===units && saved.entry_snapshot.contract_lot_size===units,'correct index units after schema sanitization');
  assert(saved.sell_ltp===source.legs[0].bid,'SELL records simulated bid');
  assert(saved.entry_snapshot.paper_entry_quote.basis==='SIMULATED_BUY_ASK_SELL_BID','quote basis retained');
  assert(saved.entry_snapshot.paper_entry_quote.exchange_freshness_verified===false,'no exchange freshness claim');
  assert(saved.entry_snapshot.paper_entry_quote.legs.length===source.legs.length,'all exact legs retained');
  assert(saved.entry_snapshot.paper_entry_quote.lot_evidence.index===source.index,'lot provenance index retained');
  assert(saved.entry_snapshot.candidate_rank===null,'no rank invented');
  assert(saved.entry_snapshot.paper_test.paper_lane==='paper_analysis','manual observation does not claim managed admission');
  assert(confirms.some(x=>x.includes('BUY at ask, SELL at bid')),'simulated price basis is disclosed before confirmation');
  assert(JSON.stringify(source)===before,'published candidate remains untouched');
}
stored.length=0;
await sandbox.takeTradeImpl(authorityDebit.id,false);
assert(stored.length===0,'blocked Real path cannot use the Paper adapter');
for (const bad of [{...authorityDebit,id:'bad_bid',legs:authorityDebit.legs.map(l=>({...l,bid:null}))},
                   {...authorityDebit,id:'bad_expiry',legs:authorityDebit.legs.map(l=>({...l,expiry:'2026-11-03'}))}]) {
  candidates[bad.id]=bad;stored.length=0;await sandbox.takeTradeImpl(bad.id,true);
  assert(stored.length===0,'invalid exact Paper quotes cannot save');
}

console.log('PASS: test_paper_save_path_r2.mjs');
