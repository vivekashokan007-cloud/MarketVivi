# v2.6.20 / b451 — Paper TEST unlock

## Scope

Paper is the only operator-facing experimental lane. This release lets the
operator record a **PAPER TEST** for any structurally recordable displayed
candidate, even when the current final brain authority does not select it.
It does not relax a Real or Sandbox gate and sends no broker order.

## Behavior

- Real and Sandbox continue to require `finalEntryAuthorization` and their
  existing execution-readiness, capital and risk safeguards.
- Paper requires valid two- or four-leg structure, expiry, strikes, CE/PE leg
  types, positive lot size and finite positive entry quotes for every leg.
- Paper displays current vetoes and asks for confirmation before recording.
- The active Paper capacity is consistently five positions per index. It is
  shown as `count/5`; reaching it is an operational capacity stop, not a
  final-selection-policy lock.

## Provenance

`trades_v2.entry_snapshot.paper_test` now carries:

- `paper_selection_source=operator_test` and
  `evidence_source=operator_paper_test`
- brain policy version, candidate/final/research/rendered ranks and confirmation
  timestamp
- final-authority result plus entry/execution vetoes
- structural-contract result, entry leg quotes/instrument keys, estimated
  friction and capacity at entry

The JSONB snapshot path is intentional: the current database schema may not
have top-level provenance columns, and the existing insert fallback preserves
`entry_snapshot`.

## Release identity

| Component | Version |
|---|---|
| Android/Kotlin | `versionName 2.6.20`, `versionCode 451` |
| Python brain | `BRAIN_VERSION = "2.6.20"` |
| PWA | `v2.6.20 · b451`, `app.js?v=1327` |

## Verification completed locally

- `node --check app.js`
- isolated Paper structural-authorization assertions: valid two-leg and four-leg
  candidates accepted; missing quote, invalid option type and missing expiry
  rejected
- `git diff --check`

Android Gradle/device verification remains required before installing or using
the release on the phone.

