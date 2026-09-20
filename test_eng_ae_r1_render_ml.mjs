import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end ${endMarker}`);
  return src.slice(start, end);
}

const helpers = [
  extract('function deriveHoldingHorizon', '\nfunction filterPaperRowsForSameSessionTeacherComparison'),
  extract('function filterPaperRowsForSameSessionTeacherComparison', '\nfunction buildTeacherLaneStatsFromOutcomes'),
].join('\n');

const renderStart = src.indexOf('function renderML');
const renderEnd = src.indexOf('\nfunction ', renderStart + 10);
const renderFn = src.slice(renderStart, renderEnd);

const mlEl = { innerHTML: '' };
const base = {
  console, Intl, Date, Number, String, Array, Object, Math, Boolean, JSON, Set, Map,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  formatSessionDateLabel: (d) => d || '',
  STATE: {
    mlEvaluationOutcomes: [],
    mlEvaluationLaneSummary: {},
    mlTeacherResearchReport: {},
    mlStatusRefreshAt: 0,
    evaluatorJob: null,
    evaluatorProposals: [],
    approvedBranchProposals: [],
  },
  document: {
    getElementById: (id) => (id === 'ml-content' ? mlEl : {
      innerHTML: '', style: {}, disabled: false, textContent: '', value: '',
      classList: { add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, removeEventListener(){}, querySelectorAll(){ return []; },
    }),
    querySelectorAll: () => [],
  },
  window: {},
  alert() {},
  confirm() { return true; },
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  readNativeJson: (_m, fb) => fb,
  readNativeValue: (_m, fb='') => fb,
  renderSnapshot: (snapshot) => snapshot || {},
  maybeAutoRefreshMlStatus() {},
  getMLModelStatusCached: () => ({}),
  getMLDecisionsCached: () => [],
  getMLEvaluationOutcomesCached: () => [],
  getMLEvaluationLaneSummaryCached: () => ({}),
  getMLTeacherResearchReportCached: () => ({}),
  getTeacherResearchReportCached: () => ({}),
  getBrainSnapshotsCached: () => [],
  safeParseNB: (v, fb) => (v && typeof v === 'object' ? v : fb),
  isLiveRecommendationWindow: () => false,
  evaluatorStatusLabel: () => '',
  formatCompactTs: () => '',
  resolveDecisionWon: () => null,
  buildMlLaneStatsFromOutcomes: () => ({
    NF_intraday:{index:'NF',mode:'intraday',rows:0,labeled:0,wins:0},
    NF_swing:{index:'NF',mode:'swing',rows:0,labeled:0,wins:0},
    BNF_intraday:{index:'BNF',mode:'intraday',rows:0,labeled:0,wins:0},
    BNF_swing:{index:'BNF',mode:'swing',rows:0,labeled:0,wins:0},
  }),
  buildMlLaneStats: () => ({
    NF_intraday:{index:'NF',mode:'intraday',rows:0,labeled:0,wins:0},
    NF_swing:{index:'NF',mode:'swing',rows:0,labeled:0,wins:0},
    BNF_intraday:{index:'BNF',mode:'intraday',rows:0,labeled:0,wins:0},
    BNF_swing:{index:'BNF',mode:'swing',rows:0,labeled:0,wins:0},
  }),
  buildTeacherLaneStatsFromOutcomes: () => ({
    NF_intraday:{rows:0,successes:0}, NF_swing:{rows:0,successes:0},
    BNF_intraday:{rows:0,successes:0}, BNF_swing:{rows:0,successes:0},
  }),
  buildCandidatePipelineDiagnostics: () => ({
    stageEntries: [], reasonEntries: [], indexSummaries: [],
    totalCandidates: 0, acceptedCandidates: 0, rejectedCandidates: 0,
  }),
  localeNumberOrFallback: (n) => (n == null ? '--' : String(n)),
};

const sandbox = new Proxy(base, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === 'symbol') return undefined;
    const name = String(prop);
    if (name.endsWith('Cached') || name.startsWith('get')) {
      return () => (/(outcome|decision|history|proposal|snapshot)/i.test(name) ? [] : {});
    }
    if (name.startsWith('build')) return target.buildMlLaneStats;
    if (name.startsWith('is') || name.startsWith('maybe')) return () => false;
    if (name.startsWith('format') || name.startsWith('evaluator') || name.startsWith('resolve')) return (v) => String(v ?? '');
    return () => '';
  }
});

vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

const same = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30',
  exit_date: '2026-09-08T14:50:00+05:30',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(same.holding_horizon, 'SAME_SESSION');

const overnight = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T14:50:00+05:30',
  exit_date: '2026-09-09T10:05:00+05:30',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(overnight.holding_horizon, 'OVERNIGHT');
assert.equal(overnight.comparable_for_teacher_pool, false);

const fridayMonday = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-11T14:50:00+05:30',
  exit_date: '2026-09-14T10:05:00+05:30',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(fridayMonday.holding_horizon, 'MULTIDAY');

const utcMidnight = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:00:00+05:30',
  exit_date: '2026-09-08T19:30:00Z',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(utcMidnight.holding_horizon, 'OVERNIGHT');

const openPos = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30', status: 'OPEN', trade_mode: 'intraday'
});
assert.equal(openPos.holding_horizon, 'OPEN');

const filtered = sandbox.filterPaperRowsForSameSessionTeacherComparison([
  { entry_date: '2026-09-08T10:15:00+05:30', exit_date: '2026-09-08T14:50:00+05:30', status: 'CLOSED', trade_mode: 'intraday' },
  { entry_date: '2026-09-08T14:50:00+05:30', exit_date: '2026-09-09T10:05:00+05:30', status: 'CLOSED', trade_mode: 'intraday' },
  { entry_date: '2026-09-08T10:15:00+05:30', status: 'OPEN', trade_mode: 'intraday' },
]);
assert.equal(filtered.kept_count, 1);
assert.equal(filtered.excluded_total, 2);

vm.runInContext(renderFn, sandbox);
assert.equal(typeof sandbox.renderML, 'function');

mlEl.innerHTML = '';
sandbox.renderML({
  serviceStatus: {
    evaluationDoneForTarget: true,
    evaluationDoneToday: true,
    labelsSaved: false,
    labelsSavedKnown: true,
    learningComplete: false,
    evaluationPhase: 'INCOMPLETE_IDENTITY',
    evaluationRetryable: true,
    missingIdentityCount: 44,
    missingIdentityPreview: '2,3,4',
    evaluationTargetDate: '2026-09-17',
    c3FinalizationPhase: '',
    lastEvaluationOutcomeCount: 31,
    lastEvaluationProducedCount: 75,
    lastEvaluationMessage: 'identity incomplete',
  },
  brainResult: {},
  executionInfraStatus: {},
  pollHistory: [],
  signalStats: {},
  orderProxyUrl: '',
});
assert.match(mlEl.innerHTML, /Labels saved:\s*<b[^>]*>NO<\/b>/);
assert.doesNotMatch(mlEl.innerHTML, /Day evaluation:\s*<b[^>]*>LABELS_SAVED<\/b>/);
assert.match(mlEl.innerHTML, /INCOMPLETE_IDENTITY|Identity coverage incomplete/);
assert.match(mlEl.innerHTML, /44 missing/);

mlEl.innerHTML = '';
sandbox.renderML({
  serviceStatus: {
    evaluationDoneForTarget: true,
    labelsSaved: null,
    labelsSavedKnown: false,
    learningComplete: null,
    evaluationPhase: 'DONE',
    evaluationTargetDate: '2026-09-17',
    c3FinalizationPhase: 'INELIGIBLE',
    c3FinalizationReasonCode: 'NO_C3_FRAMES',
    c3FinalizationReason: 'no frames',
    c3FinalizationSessionDate: '2026-09-17',
  },
  brainResult: {},
  executionInfraStatus: {},
  pollHistory: [],
  signalStats: {},
  orderProxyUrl: '',
});
assert.match(mlEl.innerHTML, /Labels saved:\s*<b[^>]*>UNKNOWN\/PENDING<\/b>/);
assert.doesNotMatch(mlEl.innerHTML, /Labels saved:\s*<b[^>]*>YES<\/b>/);
assert.match(mlEl.innerHTML, /INELIGIBLE/);
assert.doesNotMatch(mlEl.innerHTML, />FAILED<\/b> · Learning/);

mlEl.innerHTML = '';
sandbox.renderML({
  serviceStatus: {
    evaluationTargetDate: '2026-09-17',
    labelsSaved: true,
    labelsSavedKnown: true,
    evaluationDoneForTarget: true,
    c3FinalizationPhase: 'DONE',
    c3FinalizationSessionDate: '2026-09-16',
  },
  brainResult: {},
  executionInfraStatus: {},
  pollHistory: [],
  signalStats: {},
  orderProxyUrl: '',
});
assert.match(mlEl.innerHTML, /STALE\/UNAVAILABLE/);

console.log('PWA R1 renderML counterexamples OK');
