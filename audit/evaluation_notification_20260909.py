"""Read-only audit checks against the sibling Marketapp checkout.

Some probes reproduce remaining defects; others assert the v2.6.19 recovery
contract. No database or Android writes occur.
Run from any directory: python3 <this-file>
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'Marketapp/app/src/main/python'))
import brain


def call(result, poll):
    return json.loads(brain.brain_notification_process(result, {
        'now_ms': 1000000 + poll * 300000,
        'poll_id': poll, 'session_date': '2026-09-09',
        'entry_window_active': True,
    }))


def emitted(payload):
    contracts = payload['brain_notifications'] or [payload['brain_notification']]
    return [c['title'] for c in contracts if c['notify_user']]


def acknowledge(payload):
    contracts = payload['brain_notifications'] or [payload['brain_notification']]
    posted = [contract for contract in contracts if contract.get('notify_user')]
    return json.loads(brain.brain_notification_ack_deliveries(json.dumps(posted)))


def setup(alerts=None):
    return {
        'verdict': {'action': 'SELL PREMIUM', 'strategy': 'BULL_PUT', 'confidence': 66},
        'watchlist': [{'id': 'audit-c1', 'type': 'BULL_PUT', 'index': 'NF',
                       'executionReady': True, 'entryEligible': True,
                       'capitalBlocked': False, 'directionSafe': True}],
        'alerts': alerts or [],
    }


RISK = {'key': 'POS_STOP_audit-trade', 'category': 'POSITION', 'priority': 'urgent',
        'title': 'Stop Loss Near', 'body': 'Audit fixture risk'}


def record(name, evidence, defect_reproduced=True):
    print(json.dumps({'probe': name, 'defect_reproduced': defect_reproduced, 'evidence': evidence}))


brain.reset_notification_agent()
call(setup(), 1)
collision = call(setup([RISK]), 2)
collision_ack = acknowledge(collision)
following = call(setup(), 3)
assert emitted(collision) == ['Stop Loss Near', 'New Setup Ready']
assert collision_ack['best_candidate_id'] == 'audit-c1'
assert emitted(following) == []
record('N1_setup_delivered_with_position_collision', {
    'collision_emitted': emitted(collision), 'next_poll_emitted': emitted(following),
    'next_reason': following['brain_notification']['reason_code'],
}, defect_reproduced=False)

brain.reset_notification_agent()
wait = {'verdict': {'action': 'WAIT', 'confidence': 0}, 'watchlist': [], 'alerts': [RISK]}
first = call(wait, 1)
acknowledge(first)
call({**wait, 'alerts': []}, 2)
returned = call(wait, 3)
assert emitted(first) == ['Stop Loss Near'] and emitted(returned) == []
record('N2_same_risk_after_clear_remains_suppressed', {
    'first_emitted': emitted(first), 'after_clear_emitted': emitted(returned),
    'retained_states': returned['agent_state']['position_alert_states'],
})

brain.reset_notification_agent()
alerts = [
    {'key': 'MARKET_A', 'category': 'MARKET', 'priority': 'important', 'title': 'Warning A', 'body': 'A'},
    {'key': 'MARKET_B', 'category': 'MARKET', 'priority': 'important', 'title': 'Warning B', 'body': 'B'},
]
first = call({**wait, 'alerts': alerts}, 1)
acknowledge(first)
following = call({**wait, 'alerts': alerts}, 2)
acknowledge(following)
assert emitted(first) == ['Warning A'] and emitted(following) == ['Warning B']
record('N3_operational_warning_deferred_until_dispatch', {
    'first_emitted': emitted(first), 'next_emitted': emitted(following),
    'seen_keys': first['agent_state']['operational_alert_keys'],
}, defect_reproduced=False)

# A snapshot exception must leave the failed snapshot unadvanced. Kotlin uses the
# returned fatal count to persist the successful prefix and mark the job FAILED.
run_id = 'audit-failure-injection'
brain._EVAL_JOB_CACHE[run_id] = {'snapshots': [{'id': 1}, {'id': 2}], 'chain_rows': []}
try:
    with patch.object(brain, '_evaluate_snapshot_outcomes', side_effect=ValueError('audit malformed row')):
        result = json.loads(brain.evaluation_job_run_batch(run_id, 0, 4))
    assert result['ok'] is True and result['error_count'] == 1
    assert result['fatal_snapshot_error_count'] == 1
    assert result['end'] == 0 and result['outcomes'] == []
    record('E4_snapshot_error_stops_checkpoint', {
        k: result[k] for k in ('ok', 'end', 'error_count', 'fatal_snapshot_error_count', 'produced_count')
    }, defect_reproduced=False)
finally:
    brain.evaluation_job_finalize(run_id)

# Source-order verification of the Kotlin checkpoint repair; not JVM execution.
source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/MarketMLService.kt').read_text()
run = source[source.index('private suspend fun runDayEvaluation('):]
initial_state = run[:run.index('val py = Python.getInstance()')]
assert 'totalSnapshots = 0,' not in initial_state
assert 'completedSnapshots = 0,' not in initial_state
assert '(prefs.getInt("evaluation_total_snapshots", 0) == totalSnapshots)' in run
record('E1_checkpoint_preserved_before_resume_source_check', {
    'method': 'Kotlin source ordering, not JVM execution',
    'initial_preparing_write_resets_progress': False,
    'resume_requires_matching_saved_total': True,
}, defect_reproduced=False)

# Source-level guard for the in-process evaluator claim and shared foreground
# lifetime. Device/process-death behavior remains a release validation task.
assert 'claimEvaluationSession(sessionDate)' in source
assert 'DAY_EVAL_DUPLICATE_IGNORED' in source
assert 'finishServiceAction(startId)' in source
record('E2_single_evaluator_and_shared_foreground_source_check', {
    'method': 'Kotlin source inspection, not Android lifecycle execution',
    'duplicate_launch_claim': True,
    'foreground_actions_reference_counted': True,
}, defect_reproduced=False)

sys.path.insert(0, str(ROOT / 'Marketapp/app/src/main/python/tests'))
from test_evaluation_chain_quote_contract import candidate, snapshot, chain_rows
cand = candidate()
snap = snapshot(cand)
rows = chain_rows(True)
last_ts = max(row['poll_ts'] for row in rows)
config = brain._teacher_default_config()
# Deliberately distant thresholds isolate the EOD branch from TP/SL branches.
config.update(tp_capture_pct=100, sl_loss_multiple=100)
for row in rows:
    if row['poll_ts'] == last_ts:
        row.pop('bid')
        row.pop('ask')
with_tail = brain._managed_teacher_outcome(rows, snap, cand, config)
without_tail = brain._managed_teacher_outcome(
    [row for row in rows if row['poll_ts'] != last_ts], snap, cand, config)
assert with_tail['exit_reason'] == 'EOD'
assert with_tail['managed_pnl'] == without_tail['managed_pnl']
assert with_tail['exit_ts'] == without_tail['exit_ts'] != last_ts
assert with_tail['exit_valuation_status'] == 'EOD_LAST_EXECUTABLE'
record('E5_EOD_timestamp_uses_last_executable_quote', {
    'reported_exit': with_tail['exit_ts'], 'last_valued_ts': without_tail['exit_ts'],
    'unvalued_terminal_ts': last_ts,
    'same_pnl': with_tail['managed_pnl'],
}, defect_reproduced=False)

# Batch-B source contracts: these are deliberate source-level checks, not an
# Android lifecycle/device notification proof.
assert 'minutes in EVAL_REMINDER_START_MIN..EVAL_REMINDER_END_MIN' in source
assert 'Evaluation already running; retaining a retry reminder' in source
assert 'scheduleNextEvaluationReminder(context)' in source
record('E6_current_window_catchup_and_running_retry_source_check', {
    'method': 'Kotlin source inspection, not AlarmManager/device execution',
    'current_window_catches_up_today': True,
    'running_receiver_retains_retry_schedule': True,
}, defect_reproduced=False)

assert 'EVALUATION_TIME_BUDGET_EXCEEDED' in source
assert 'isEvaluationSessionActive(sessionDate: String)' in source
native_source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt').read_text()
assert 'if (MarketMLService.isEvaluationSessionActive(runningDate)) return false' in native_source
record('E7_cooperative_budget_and_active_session_stale_guard_source_check', {
    'method': 'Kotlin source inspection; does not claim force-cancellation of synchronous Python',
    'cooperative_budget': True,
    'active_session_cannot_be_stale_unlocked': True,
}, defect_reproduced=False)

supabase_source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/SupabaseClient.kt').read_text()
assert 'val success = evaluationSaved && recommendationSaved && rejectedSaved' in supabase_source
assert 'val recommendationSaved: Boolean' in supabase_source
record('E8_component_upload_status_source_check', {
    'method': 'Kotlin source inspection, no production write',
    'all_required_outputs_gate_completion': True,
    'component_status_exposed': True,
}, defect_reproduced=False)

watch_source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/MarketWatchService.kt').read_text()
helper_source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/NotificationHelper.kt').read_text()
assert 'brain_notification_ack_deliveries' in watch_source
assert 'posted_to_os_count' in watch_source
assert 'data class DeliveryResult' in helper_source
assert 'PERMISSION_DENIED' in helper_source and 'CHANNEL_DISABLED' in helper_source
record('N4_delivery_acknowledgement_and_transport_truth_source_check', {
    'method': 'Kotlin/Python source inspection, not a posted-notification device proof',
    'acknowledges_only_posted_contracts': True,
    'transport_outcomes_structured': True,
}, defect_reproduced=False)

assert 'Day Evaluation Ready' not in source
assert 'publishEvaluationStatus' in source
assert 'clearEvaluationStatusNotification' in source
record('N5_phase_aware_evaluation_notification_source_check', {
    'method': 'Kotlin source inspection, not Android UI verification',
    'running_status_does_not_offer_duplicate_start': True,
    'failure_retry_and_completion_warning_statuses': True,
}, defect_reproduced=False)
