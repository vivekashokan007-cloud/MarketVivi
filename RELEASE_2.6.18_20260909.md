# Market Radar v2.6.18 / b449

## Purpose

This release repairs two verified safety-state failures and completes the reviewed position-tick guard work. It does not alter selector authority, final PWA entry authority, model weights, database schema, historical labels, or the soft-OOD eligibility policy.

## Changes

- A close recorded from the PWA now enters a bounded pending-close journal. Native bootstrap keeps that close until a successful Supabase response contains the same trade ID. A failed or malformed response leaves the existing ledger intact.
- Daily-risk state now survives the Kotlin persistence compactor used before both local-cache and Supabase snapshot writes. Teacher-research and ML compaction paths retain the same field.
- Position tick guards are now `position_tick_guards_v4_complete_book_position`: a valuation needs both bid and ask for every leg, and `raw_mark_complete` requires all required strategy legs rather than only all resolved legs.
- Standard Python discovery now includes the formerly uncollected top-level legacy tests. Gamma/wall producer tests now recognise the current shadow producer and detect both missing and duplicate tags.

## Release identity

| Surface | Value |
|---|---|
| Android/Kotlin | `versionName 2.6.18`, `versionCode 449` |
| Python brain | `BRAIN_VERSION = "2.6.18"` |
| PWA | `v2.6.18 · b449`, `app.js?v=1325` |

## Validation

- Python compilation passed.
- Full configured Python suite: **504 passed**. This includes the 134 previously uncollected top-level cases.
- PWA JavaScript syntax and Git whitespace checks passed.
- The local Android Gradle wrapper could not download Gradle 8.7 in this environment, so Kotlin/JUnit and signed-APK validation remain the GitHub Actions release gates. The release workflow is triggered because `app/build.gradle.kts` changed.

## Field verification after install

1. Confirm persisted snapshots include `context_json.snapshot_daily_risk_state` for a zero-trade poll and after a close.
2. Close a paper trade, force or observe a bootstrap before the remote row becomes visible, and confirm the daily STOP remains when its net loss breaches the existing threshold.
3. Confirm a later server response containing that ID removes it from `pending_closed_trades` without removing it from the closed ledger.
4. Confirm `position_tick_guards_v4_complete_book_position` rows reject one-sided books and do not mark truncated iron structures as `raw_mark_complete`.

The current backend still produces ACTIONABLE entries under v5 where candidates meet its requirements. Soft-OOD policy remains a separate research decision.
