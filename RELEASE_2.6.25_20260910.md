# Market Radar v2.6.25 / b456 — evaluator multi-batch append repair

Released September 10, 2026. Android/Kotlin, Python brain and PWA are synchronized at v2.6.25 / b456. PWA cache key: `app.js?v=1332`.

## Fix

The evening evaluator now preserves the existing JSON array prefix while appending a second or later outcome batch. The temporary-file suffix is opened in append mode, then the complete array is atomically renamed into place.

This fixes the confirmed b455 device failure where a second batch created a file starting with `,`, after which strict JSON validation correctly rejected it.

## Scope

Correctness-only: strict JSON validation and malformed-checkpoint recovery remain enabled. No database schema/data, ranking, PAPER TEST, Real/Sandbox authority, model, sizing, exits or broker orders changed.

## Validation

- Full Python regression suite, including the two-batch append source contract.
- JavaScript syntax and Git whitespace checks.
- GitHub Actions signed Android release and debug APK validation.
