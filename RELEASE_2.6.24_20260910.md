# Market Radar v2.6.24 / b455 — malformed evaluator checkpoint recovery

Released September 10, 2026. Android/Kotlin, Python brain and PWA are synchronized at v2.6.24 / b455. PWA cache key: `app.js?v=1331`.

## Fix

When an existing `outcomes_<date>.json` is malformed, the evening evaluator no longer crashes repeatedly while attempting to resume. It preserves strict JSON validation, logs `EVAL_RESUME_DISCARDED_MALFORMED_OUTPUTS`, replaces only the derived checkpoint through the existing atomic writer, resets progress and evaluates again from retained brain snapshots.

## Scope

This is a correctness-only recovery. It does not alter database schema or data, candidate generation, ranking, PAPER TEST, Real/Sandbox authority, model, sizing, exits or broker orders.

## Validation

- Full Python regression suite, including malformed-output recovery contract coverage.
- JavaScript syntax and Git whitespace checks.
- GitHub Actions signed Android release and debug APK validation.
