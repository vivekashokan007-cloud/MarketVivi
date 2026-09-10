# v2.6.22 / b453 — Evaluation recovery and notification truth

## Scope

This correctness-only release finishes the next evaluator/notification batch.
It does not change strategy generation, ranking, model behavior, OOD policy,
or Real/Sandbox/Paper entry authority.

## Evaluator recovery

- **E6:** reminder scheduling now catches up within today's 16:30–18:30 IST
  window instead of moving directly to tomorrow. An alarm encountered while an
  evaluation is running keeps the retry schedule and shows an in-progress status.
- **E7:** the 45-minute evaluation budget is now enforced cooperatively at
  preparation, batch-checkpoint, save and aggregation boundaries. A stale
  preference cannot unlock a retry while the in-process evaluator still owns the
  session. This does not claim force-cancellation of a blocking Chaquopy call;
  device lifecycle/cancellation testing remains required.
- **E8:** Supabase completion now requires the evaluation, recommendation and
  rejected-research outputs relevant to the run. Component success fields and
  precise failure messaging prevent a partial upload from reporting DONE.

## Notification truth

- **N1:** a position-risk alert remains first, but a confirmed setup is included
  in the same ordered delivery set rather than silently consumed.
- **N3/N4:** alert dedupe is acknowledged only after Android accepts the
  notification. Transport records selected, attempted, posted-to-OS and specific
  suppression/failure outcomes (throttle, permission, app/channel disabled or
  notify failure). Posted-to-OS does not claim the user saw or heard it.
- **N5:** the evaluator uses one phase-aware notification: running opens ML
  status without starting another run; failure offers guarded retry; research
  warning opens status; success clears the status notification.
- Position-risk re-entry after a clear (**N2**) remains an explicit policy choice
  and is intentionally unchanged.

The tick quote-contract label now accurately states its existing behavior:
finite two-sided, non-crossed book plus a strictly positive executable close side,
independent of LTP.

## Release identity

| Component | Version |
|---|---|
| Android/Kotlin | `versionName 2.6.22`, `versionCode 453` |
| Python brain | `BRAIN_VERSION = "2.6.22"` |
| PWA | `v2.6.22 · b453`, `app.js?v=1329` |

## Verification completed locally

- `python3 -m py_compile app/src/main/python/brain.py`
- Python discovery: **510 tests passed**
- `python3 MarketVivi/audit/evaluation_notification_20260909.py` (N1/N3 and
  E6–E8/N4/N5 checks pass at Python/source level)
- `node --check app.js` and `git diff --check`

Gradle 8.7 cannot be downloaded in this environment, so Android compilation,
alarm/retry behavior, permission/channel suppression, and notification UI must be
validated on CI/device before deployment.
