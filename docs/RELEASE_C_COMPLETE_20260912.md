# Release C complete — 2026-09-12

**Release class:** measurable **paper** baseline (plan §15 Release C).  
**Frozen runtime:** Marketapp `6ebd206` · **2.6.41 / b472** · MarketVivi labels `7418b92` (`v2.6.41 · b472`).  
**G7 identity:** `paper_baseline_g7_20260912_b472` — see `docs/G7_PAPER_BASELINE_20260912.md`.  
**No APK bump** for the freeze. Training and live orders remain frozen. `p_ml` gate unchanged.

---

## What shipped (G4–G6)

| Pkg | Marketapp | MarketVivi | Version | Outcome |
|---|---|---|---|---|
| **G4** | `5a50a0c` | `9e9156e` | 2.6.39 / b470 | Versioned net target + executable exit contract. Live SHADOW_\* still gross `POSITION_POLICY_V1`. |
| **G5** | `e02d9c3` + fix `7669ad5` | `69fb1cd` | 2.6.40 / b471 | Durable `ml_evaluation_runs`; truthful labels-saved vs learning-complete; Sept 10–11 C3 **ineligible** (no fabricated rows). |
| **G6** | `6ebd206` | `7418b92` | **2.6.41 / b472** | `ml_evaluation_metrics` identity upsert; confidence decomposition; SHADOW_A/B **log-only**; SHADOW_C off. |
| **G7** | *(no code)* | this docs set | **same 2.6.41 / b472** | Hash-pinned paper experiment declared. Prospective only. |

Python on G6 tip: **679 tests OK**. Kotlin authored; local Gradle/device not run in the implementation sandbox.

---

## Freeze statement (G7)

One compatible bundle is tagged for forward paper evaluation:

- Marketapp `6ebd206ea19901f3663ea311cf8956e134e6301d`
- MarketVivi labels `7418b92e855d9d168ab09b5a034e0fcef3db1dfe`
- `versionName=2.6.41` · `versionCode=472` · `BRAIN_VERSION=2.6.41`
- Model SHA-256 `795b3330…1d5dfd` / temporal `92e8f0df…4217fd` / teacher `9ed5bdf3…bde655` (unchanged vs G0)

Declared universe, sessions, entry/exit, capital (₹2.5L, 10%, 1 lot), cost stresses, benchmarks, metrics, and stopping rules are in the G7 baseline. Shadows A/B remain log-only.

---

## Still frozen / not in Release C

- `ml_train.run` / `online_update` — frozen (`RETRAIN_DISABLED_REASON` still set; nightly alarm cancelled).
- Live broker path — `OrderExecutionService.EXECUTION_MODE = SANDBOX`.
- G1 Auth cutover — stub **OFF**; anon INSERT retained.
- G3 historical peak `--apply` — not run.
- G8 training-path repair — queued, offline only (`docs/G8_G9_QUEUED_20260912.md`).
- G9 sizing / BNF ML feature / DTE-scaled target — not adopted; sizing patch **not supplied**.
- G10 live automation — future gate.

---

## Evidence this release does **not** confer

Release C + G7 freeze is evidence that the **measurement stack** can host a named paper policy. It is **not** permission for real trading, automatic promotion, or sizing changes.
