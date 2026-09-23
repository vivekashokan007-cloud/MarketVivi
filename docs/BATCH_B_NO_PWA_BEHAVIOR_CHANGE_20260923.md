# Batch B — MarketVivi / PWA note (2026-09-23)

Batch B valuation/parity work is Marketapp-side (Python modules + silent Kotlin
parity recording in `PositionTickService` policy_trace only).

This MarketVivi tip on `work/batch-b-valuation-parity-20260923` carries **no**
PWA display-economics change, no BOOK/EXIT wording change, and no notification
authority selection. Live card P&L math and Paper close semantics remain as on
the Batch A tip (`8c31492`).

Observation-only dual-path inventory remains documentation; Batch C may later
consume same-event parity evidence before any authority selection.
