import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('function mlEvaluationAttemptState(');
const end = source.indexOf('\n}\n', start) + 2;
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('OOM/save failures expose the terminal phase without waiting for retry flags', () => {
  for (const phase of ['FAILED_SAVE', 'FAILED', 'FAILED_RESEARCH', 'STALLED']) {
    const state = context.mlEvaluationAttemptState({ evaluationPhase: phase, evaluationLastError: 'OutOfMemoryError' });
    assert.equal(state.failed, true); assert.equal(state.retryable, true);
    assert.equal(state.phase, phase); assert.equal(state.error, 'OutOfMemoryError');
  }
});
test('running and genuinely pending attempts are not fabricated failures', () => {
  for (const phase of ['RUNNING', 'PREPARING', '', 'LABELS_SAVED']) {
    const state = context.mlEvaluationAttemptState({ evaluationPhase: phase });
    assert.equal(state.failed, false); assert.equal(state.retryable, false);
  }
});
test('failure state is wired into the ML renderer and retains native retry advice', () => {
  assert.equal(context.mlEvaluationAttemptState({ evaluationPhase: 'INCOMPLETE_IDENTITY', evaluationRetryable: true }).retryable, true);
  assert.match(source, /const evaluationAttempt = mlEvaluationAttemptState\(service\)/);
  assert.match(source, /evaluationAttempt\.failed \? evaluationAttempt\.phase/);
});
