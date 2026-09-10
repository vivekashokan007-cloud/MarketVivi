# v2.6.21 / b452 — Evaluation truth and checkpoint integrity

## Scope

This release repairs two evaluator-truth issues before further ranking or
entry-policy research. It makes no strategy, model, OOD, Real, Sandbox or
Paper-entry-policy change.

- **E5 — executable EOD attribution:** a managed EOD outcome now records the
  last path point with a valid gross mark and executable round-trip quote cost.
  An LTP-only terminal chain row can no longer lend its timestamp to an earlier
  executable P&L. TP and SL attribution remains unchanged.
- **E3 — bounded source loading:** Python retains input paths and configuration
  in the evaluation-job cache, reads only the requested snapshot batch, and
  streams the matching index/expiry chain rows for that batch. A truncated input
  is a retryable error, never an empty evaluation.
- **E3 — atomic output recovery:** Kotlin rebuilds a valid JSON array in a
  temporary file and atomically replaces the checkpoint. It no longer truncates
  the existing `]` in place. Empty or malformed output is explicit failure;
  it is never interpreted as zero rows. The final parsed count must match the
  checkpoint count before persistence.

The database schema is unchanged. The corrected persisted `exit_ts` is the
authoritative stored effect. The additional local/report fields
`exit_valuation_status` and `terminal_path_ts` document how an EOD exit was
valued without adding an unreviewed production column.

## Release identity

| Component | Version |
|---|---|
| Android/Kotlin | `versionName 2.6.21`, `versionCode 452` |
| Python brain | `BRAIN_VERSION = "2.6.21"` |
| PWA | `v2.6.21 · b452`, `app.js?v=1328` |

## Verification completed locally

- `python3 -m py_compile app/src/main/python/brain.py`
- Python discovery: **508 tests passed** (including EOD-tail and streaming-input
  regressions)
- `python3 MarketVivi/audit/evaluation_notification_20260909.py` confirms the
  E5 probe now attributes the exit to the last executable timestamp
- `node --check app.js`
- `git diff --check`

Android compilation could not run locally because Gradle 8.7 is not cached and
the environment cannot reach the Gradle distribution host. CI/device install
and an interrupted/resumed evening-evaluation exercise remain release gates.

## Deliberately still open

The final persistence/report aggregation still uses a complete local outcome
array after the bounded evaluator run. Per-batch Supabase persistence and
streaming report aggregation are a follow-up hardening task; this release fixes
the input-cache peak and prevents the prior checkpoint-corruption/empty-output
failure mode without changing output semantics mid-release.
