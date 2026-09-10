# Market Radar v2.6.23 / b454 — ranking-evidence collection

Released September 10, 2026. Android/Kotlin, Python brain and PWA are synchronized at v2.6.23 / b454. The PWA cache key is `app.js?v=1330`.

## What changed

- The evaluator retains its existing top-200 final-rank evidence cohort unchanged.
- It now also captures a deterministic, bounded sample of up to 50 valid rows from final ranks greater than 200.
- Sampled rows preserve final rank, cohort size, selection-frame digest, sampling version, sample rank and inclusion probability.
- The evening evaluator applies the usual managed-net, executable-quote and friction contract to that sample.
- The daily teacher report is schema version 2 and exposes a separate `ranker_coverage_sample` summary without mixing sampled rows into shortlist metrics.

## Compatibility and limits

- Existing `primary`/`secondary` database roles and tables are unchanged. Sampled rows use `secondary` for compatible outcome storage; immutable snapshot context and the report preserve their independent evidence source.
- No database migration or production-data change is included.
- No user-facing mode, candidate cards, final ranking, Paper/Real authority, model, sizing, exit or broker-order behavior changed.
- This is telemetry collection, not a profitability claim or a policy promotion. Evaluate distinct sessions/events under a protocol frozen before outcomes are reviewed.

## Validation required for release

- Full Python regression suite and JavaScript syntax check.
- Git whitespace check.
- GitHub Actions signed Android release, because the local workspace cannot perform a representative Android build.
