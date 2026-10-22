// b513: status honesty for a failed evening identity verification (Codex brief D). Renders the real renderML.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end ${endMarker}`);
  return src.slice(start, end);
}

const helpers = [
  extract('function mlEvaluationAttemptState(', '\nfunction renderML('),
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
vm.runInContext(renderFn, sandbox);

// b513 (Codex brief D): 21 Oct 2026 phone state after the second failed read-back, today's session.
const failedToday = {
  evaluationPhase: 'FAILED_IDENTITY_COVERAGE', evaluationTargetDate: '2026-10-21', evaluationTargetIsToday: true,
  evaluationRunning: false, evaluationDoneForTarget: false, evaluationDoneToday: false,
  labelsSaved: false, labelsSavedKnown: true, learningComplete: false, modelTrained: false, paperModelActive: false,
  missingIdentityCount: 19638, identityReadbackFailed: true,
  identityReadbackError: 'stage=evaluation table=ml_evaluation_outcomes session=2026-10-21 class=query_statement_timeout_57014 page=36 http=500 code=57014',
  lastEvaluationOutcomeCount: 19638, lastEvaluationProducedCount: 19638, evaluationProgressTotal: 78, evaluationProgressCompleted: 78,
  lastEvaluationMessage: 'Evaluation for 2026-10-21: 19638 result rows were written (upload acknowledged), but server identity verification FAILED after 3 attempt(s).',
};
function render(serviceStatus) {
  mlEl.innerHTML = '';
  sandbox.renderML({ serviceStatus, brainResult: {}, executionInfraStatus: {}, pollHistory: [], signalStats: {}, orderProxyUrl: '' });
  return mlEl.innerHTML;
}

test('failed verification today is not shown as "waiting for post-close evaluation"', () => {
  const html = render(failedToday);
  assert.doesNotMatch(html, /Waiting for post-close evaluation/);
  assert.match(html, /server identity verification FAILED/);
  assert.match(html, /FAILED_IDENTITY_COVERAGE/);
});

test('rows written are labelled as not verified, and nothing claims certification', () => {
  const html = render(failedToday);
  assert.match(html, /Result rows written \(not verified\):\s*<b>19638<\/b>/);
  assert.doesNotMatch(html, /Outcomes persisted/);
  assert.match(html, /Labels saved:\s*<b[^>]*>NO<\/b>/);
  assert.match(html, /Model trained this run: <b>NO<\/b>/);
  assert.match(html, /New Paper model active: <b>NO<\/b>/);
  assert.doesNotMatch(html, /LABELS_SAVED|EVALUATION_DATE_RECORDED/);
});

test('verification failure is not described as absent rows and shows the classified diagnostic', () => {
  const html = render(failedToday);
  assert.match(html, /19638 identities unverified/);
  assert.match(html, /not an absence result/);
  assert.match(html, /query_statement_timeout_57014/);
  assert.doesNotMatch(html, /19638 missing/);
});

test('a genuinely untouched today session still says waiting', () => {
  const html = render({ evaluationTargetDate: '2026-10-21', evaluationTargetIsToday: true, evaluationPhase: '',
    lastEvaluationMessage: 'Scheduled for 16:30+', labelsSavedKnown: false });
  assert.match(html, /Waiting for post-close evaluation/);
});

test('helpers classify attempt phases', () => {
  for (const p of ['FAILED_IDENTITY_COVERAGE', 'INCOMPLETE_IDENTITY', 'FAILED_SAVE', 'STALLED', 'INCOMPLETE_H2_MARKET_DATA', 'FAILED'])
    assert.equal(sandbox.mlEvaluationAttemptRecorded({ evaluationPhase: p }), true, p);
  for (const p of ['', 'DONE', 'LABELS_SAVED', 'RESEARCH_ONLY', 'SAVING'])
    assert.equal(sandbox.mlEvaluationAttemptRecorded({ evaluationPhase: p }), false, p);
  assert.equal(sandbox.mlOutcomeCountLabel({ evaluationPhase: 'LABELS_SAVED' }), 'Outcomes persisted');
});
