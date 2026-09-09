# Evening evaluation and notification audit

Date: 2026-09-09. Reviewed Marketapp `9c294282d4d93ca0eb24eeff32a5167d2fe661bc`
and MarketVivi `2f629d9b65449a63cd47988018d7f88b1e293a6b`, v2.6.18/b449.
Scope: scheduling, service ownership, restart/retry, input preparation, labels,
persistence, reports, UI status, notification selection and Android dispatch.

## Conclusion and limits

There are confirmed source defects and reproducible Python failures. They can
explain restart loops, missing alerts, misleading completion, and inconsistent
evaluation timestamps. They do **not** identify which failure occurred on the
user's phone on a particular evening: that requires device logs and session data.

The Supabase project listing succeeded. The first read-only schema query was
rejected by automatic approval review because of a usage limit. No alternate
database route was attempted. No current database counts or crash evidence are
claimed in this audit. No runtime, database, ranking, notification policy, model,
version, or remote repository was changed. Only this report, a local probe, and
project knowledge were written.

Earlier CI success establishes compilation and existing test success, not full
device verification. This corrects the earlier conversation's overly broad
description of the release as “fully validated.”

## Evaluation lifecycle

The watch service hands off after close, normally scheduling a 16:30 IST alarm.
The alarm attempts to start MarketMLService and displays a tap-to-run reminder.
The service prepares cached snapshot/chain files, evaluates four snapshots per
batch in Python, appends outcomes locally, uploads outcomes, aggregates accuracy,
builds teacher research, records completion, and starts C3 finalization.
NativeBridge supplies progress/retry status to the PWA. Training at 23:00 remains
deliberately disabled; evening evaluation is a different operation.

## Prioritized findings

### E1 — High: retry destroys the checkpoint before testing it

`MarketMLService.runDayEvaluation` calls `updateEvaluationJobState` with total
and completed snapshots both zero at entry. That method writes those values to
SharedPreferences. Later `canResume` requires the persisted total to equal the
new positive total. Therefore an existing 40/77 checkpoint becomes 0/0, the
comparison fails, and the output file is reset. Input preparation also writes
zero completed progress. The cached-input fast path does not avoid the initial
reset. A failed-save retry likewise re-evaluates rather than simply re-uploading.

Evidence: source-order proof in the attached probe; not a JVM/device execution.
PWA and native messages promising resume/save-only recovery are currently false.
Fix: preserve a session/config/input-identified checkpoint before any display
state update; separate compute, upload, and report recovery. Verify process death
after a batch and network failure after local completion.

### E2 — High: no single owner for evaluation and foreground service lifetime

Every `ACTION_DAY_EVALUATION` in `MarketMLService.onStartCommand` launches another
coroutine. There is no service-level job/mutex check. The alarm's notification
uses a foreground-service PendingIntent, so tapping it can start another run
while its automatic run is active, bypassing NativeBridge's running guard.
Both runs use the same dated input/output files and preference keys.

Each action independently calls `stopForeground` and `stopSelf(startId)` in its
finally block. A newer short action can stop the service while older work remains;
an older action can remove foreground status from newer work. C3 starts through
this same service before evaluation's finally removes foreground status.

Evidence: source-confirmed reachable race, not an observed on-phone collision.
Fix: one evaluation job per session and one service lifetime owner; queue or join
duplicate requests. Keep foreground status until all owned work finishes.

### E3 — High: full-memory processing remains in the service

`evaluation_job_prepare` loads the entire snapshot and chain arrays into the
Python job cache. After batched evaluation, the Kotlin service calls
`readJsonArrayFile(outputsFile)` (`readText` plus full JSONArray parsing), then
constructs persistence arrays and another sanitized report array. Python inputs
remain cached until the final cleanup.

The earlier NativeBridge report-reader fix does not remove this service path.
Source confirms several whole-corpus allocations; an actual OOM on this release
was **not** reproduced or measured. Outcome append also truncates the closing
bracket in place; a process death can leave invalid JSON, whose fallback reader
silently returns an empty array. Fix: bounded streaming upload/report inputs and
atomic per-batch files with checksums; malformed checkpoints must remain errors.

### E4 — High: all snapshot evaluations can error and still finish as DONE

`evaluation_job_run_batch` catches snapshot exceptions, advances `end`, and
returns `ok: true`. Kotlin records only the current batch's error message and
advances progress; it does not accumulate an error count for completion. Zero
produced outcomes take the successful-empty save branch and can reach DONE.

Evidence: actual Python batch execution with two injected snapshot exceptions
returned `ok=true`, `end=2`, `error_count=2`, `produced_count=0`. Completion
consequence is established by the Kotlin control flow. Fix: distinguish legitimate
no-label results from processing failures; preserve failed snapshot IDs and
session-wide counts, and report PARTIAL/FAILED rather than clean completion.

### E5 — High: EOD P&L can be paired with a quote timestamp it did not use

`_managed_teacher_outcome` initializes `exit_point` to the last path point.
When later points fail executable valuation, it skips them and retains P&L from
the preceding valid point, without changing the EOD exit point/step.

Evidence: using the existing quote-contract fixture, stripping bid/ask from the
last point gives the same ₹49.46 as the preceding point at 04:25:18Z, but records
04:30:19Z as the exit. Distant TP/SL thresholds isolate the EOD branch. These are
fixture values, not newly queried trade results.

Fix: bind P&L, fees, timestamp, and quote identity to the same successfully valued
point. Distinguish last available valuation from a verified market-close exit;
flag missing terminal coverage instead of silently implying an executable EOD.

### E6 — Medium: scheduling can skip the current evening or lose retries

`nextEvaluationReminderAt` advances to the next market day whenever the current
time is at or after 16:30, including 17:00 inside the reminder window. Application
startup invokes it, so restarting during the window can replace an existing
reminder with tomorrow's. The receiver returns immediately when a running marker
exists, without scheduling a follow-up or checking marker staleness. A run still
active at the 30-minute reminder can consume the retry chain before later failing.

`AlarmManager.set` is inexact. It does not itself qualify for Android's exact-alarm
foreground-service-start exemption; background auto-start can fail unless another
exemption applies. Actual behavior depends on device/OS/app state. The current
exception capture and tap-to-run notification are useful fallback evidence.
Fix: catch up during the current window, persist retry scheduling independently
of run state, and use an Android-supported background execution design.

### E7 — Medium: timeout and stale detection do not cancel the underlying work

The 45-minute `EVENING_EVAL_TIMEOUT_MS` constant is unused. Three-minute
`withTimeoutOrNull` wrappers surround synchronous Chaquopy calls. Coroutine
cancellation is cooperative; those wrappers do not establish an interruptible
Python deadline. Saving/report phases do not periodically heartbeat, while
NativeBridge declares work stalled after 15 minutes. It can unlock retry while
the original computation is still running, compounding E2.

Fix: cooperative cancellation/checkpoints within the evaluator, a real job
identity/liveness check, and phase-aware progress. Do not treat a timer alone as
proof the old job has stopped. Device cancellation tests remain required.

### E8 — Medium: completion does not describe each output's actual status

`SupabaseClient.saveEvaluationOutcomes` defines success using evaluation rows
alone. Recommendation/rejected writes can fail while evaluation succeeds. Fallback
payloads can omit teacher/canonical/attribution fields and still report success.
Counting all rows for a date does not prove the exact run's IDs and label versions
were written. These are explicit compatibility behaviors, but need separate
partial-output status, not a single undifferentiated completion signal.

Teacher-report failure sets both `evaluation_done_date` and `FAILED_RESEARCH`,
cancels reminders, and depends on manual recovery. Native/PWA code exposes retry,
but it currently routes through the E1 full restart. Fix: canonical outcome
completion, research completion, and each upload should have independent status
and targeted recovery. Do not delete or relabel historical data as part of this.

### E9 — Medium: aggregation timing and messaging can mislead

`maybeAggregateWeek` only runs for a Saturday session, whereas automatic
evaluation is scheduled for market days. Normal weekday sessions never trigger
that weekly branch. `maybeAggregateMonth` stops at the last Friday, potentially
omitting later Monday–Thursday sessions in the same month. It does not recompute
them subsequently through the normal trigger.

The daily aggregation ignores `postAggregateRow`'s Boolean result and sends
“Brain accuracy today” even if both destination writes fail. It formats zero
labelled rows as 0.0%, and the calculation is the primary H2 win fraction, not
managed-net profitability or a complete measure of ML prediction quality. The
monthly notification asks users to run retraining even though retraining remains
disabled. Fix: calendar-complete idempotent aggregation, explicit denominator and
label basis, checked persistence, and messages consistent with training status.

### N1 — High: a confirmed setup alert can disappear behind a position alert

`NotificationAgent.process_contract` updates the setup's last-announced state
before replacing its contract with position notifications. On the next poll,
that never-emitted setup is considered unchanged. Prioritizing risk is sensible;
consuming the pending setup without emitting or deferring it is the defect.

Evidence: actual Python sequence: first confirmation poll; second confirmation
with position risk emits only “Stop Loss Near”; third poll emits nothing with
reason `UNCHANGED_SETUP`. Fix: persist state only for emitted/deferred contracts;
queue lower-priority eligible events or return the complete ordered event set.

### N2 — Policy gap: risk re-entry is suppressed for the same trade/state

`position_alert_states` accumulates states using `update`, rather than forgetting
cleared episodes. Risk → clear → same risk emits only the first alert. This is
reproduced, but whether to re-alert and after what delay requires an explicit
episode/cooldown policy; it must not be called an accidental regression without
that decision. Keep same-poll deduplication and escalation behavior.

### N3 — Medium: operational alerts are marked seen without dispatch

Only one operational alert is selected, while all current operational keys are
stored as seen. Two new warnings together emit only the first; the second remains
suppressed while its key persists. Actual Python probe reproduces this. Fix:
acknowledge selected events individually and defer the rest with a bounded policy.

### N4 — Medium: dispatched telemetry cannot prove a notification was posted

Kotlin saves the agent state before dispatch. `NotificationHelper.send` returns
Unit and may silently return for its 30-second throttle. The caller nevertheless
returns true and records `dispatched=true`. It does not check app/channel enablement
or runtime notification permission at dispatch; requesting permission in
MainActivity does not prove it was granted. A denied/disabled/suppressed alert can
be consumed without usable delivery evidence.

Fix: record selected, attempted, posted-to-OS, and suppressed/failed separately.
Return structured transport results, acknowledge only after the chosen outcome,
and expose blocked channel/permission status. Posted-to-OS still does not mean
the user saw or heard it; user settings and Do Not Disturb retain authority.

### N5 — Medium: evaluation status notification lifecycle is incomplete

The receiver always says “Day Evaluation Ready / Tap to evaluate” even after
starting it automatically. Tapping invokes another service start (E2). Cancelling
the alarm does not cancel the already-posted notification ID 2003. Failure and
FAILED_RESEARCH paths do not publish a dedicated actionable completion/failure
notification; the foreground “Running day evaluation” notification is removed.
Fix: one status notification that changes with phase, opens the ML status screen,
and offers only valid guarded retry actions after work ends.

## Verification and what works

- Full existing Python suite: **504 passed** in this audit.
- Six local characterization probes: three notification sequences, batch failure
  injection, EOD quote attribution, and one Kotlin source-order checkpoint proof.
  These reproduce defects; they are not six safety tests passing.
- Existing tests cover executable bid/ask preservation, wrong-expiry rejection,
  net friction and stop gap-through behavior, entry ineligibility, multiple
  simultaneous position risks, and position alerts overriding entry WAIT.
- The native notification permission request exists; its absence is not alleged.
- PWA trading notifications remain native-brain-owned; no second PWA trading
  alert authority was found in the reviewed path.
- Local Android/device lifecycle, memory-pressure, Doze, permission-denial,
  process-death and alarm tests were not executed. No current phone logs were
  available. Read-only database verification remains blocked as described above.

Probe: [audit/evaluation_notification_20260909.py](audit/evaluation_notification_20260909.py).
Run from the workspace: `python3 MarketVivi/audit/evaluation_notification_20260909.py`.

## Recommended implementation sequence

1. Repair checkpoint ownership, duplicate starts, atomic batch output, and recovery
   phase separation together; test restart/save-failure/duplicate-click sequences.
2. Fix EOD quote attribution and aggregate failure accounting; retain data-integrity
   exclusions and disabled training while verifying labels.
3. Stream finalization and add cooperative liveness/cancellation before declaring
   memory and timeout recovery resolved.
4. Fix notification event acknowledgement, pending-event handling, and evaluation
   status notifications; define risk re-entry behavior explicitly.
5. Repair reminder catch-up and complete calendar aggregation. Validate on the
   phone in background, after restart, and with network/notification denial.

A follow-up runtime release must keep brain/Kotlin/PWA versions synchronized.
This audit alone does not authorize implementation or deployment.

## Follow-up: v2.6.19/b450 implementation status

The following implementation was completed after this audit. Android/Python/PWA
markers are synchronized at `v2.6.19 / b450`; the PWA cache-buster is
`app.js?v=1326`.

- **E1 resolved at code level:** initial PREPARING state no longer overwrites
  saved total/completed progress before the output/checkpoint compatibility test.
- **E2 resolved for in-process starts at code level:** one active day evaluator is
  claimed per service process and duplicate alarm/tap launches are ignored. A
  shared foreground action count keeps the service foreground while an accepted
  evaluator or C3 finalizer remains active.
- **E4 resolved at code level:** Python stops at the first snapshot exception and
  returns the successful prefix plus `fatal_snapshot_error_count`; Kotlin saves
  that checkpoint then transitions to FAILED instead of completing the run.
- The audit probe now checks these repairs and continues reproducing unresolved
  N1/N2/N3 and E5 behavior. It is source/Python coverage, not phone lifecycle
  verification. Full Python discovery passes 505 tests; Gradle tests cannot run
  locally because Gradle 8.7 is unavailable and its download host is unreachable.

E3, E5–E9 and N1–N5 remain open except where explicitly noted above. No model,
ranking, entry-policy, training, Supabase or remote-repository action was part of
this implementation.

## Platform references

Android background-start restrictions and exemptions:
[Foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
Exact versus inexact alarms:
[Schedule alarms](https://developer.android.com/develop/background-work/services/alarms).
Cooperative cancellation:
[Kotlin cancellation and timeouts](https://kotlinlang.org/docs/coroutines-cancellation.html).
These support the platform analysis, not an assertion of a specific phone failure.
