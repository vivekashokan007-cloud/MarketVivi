# G7 Paper experiment baseline — frozen 2026-09-12

**Package:** G7 (freeze a paper experiment after G1–G6)  
**Plan:** `docs/PLAN_final_implementation_20260912.md` §11 and §15 Release C  
**Executor:** Grok Bot  
**Status:** baseline **declared and tagged**. Prospective paper only.  
**Publishing:** docs-only on MarketVivi (this file). **No APK bump** — freeze label is shipped **2.6.41 / b472**.  
**Not claimed:** permission for real trading, training enablement, `p_ml` gate removal, G3 `--apply`, Auth cutover.

> **This document establishes evidence identity for one tested paper policy.**  
> Passing later review of this experiment does **not** authorize live broker orders, automatic model promotion, sizing adoption, or any unreviewed strategy change.

---

## 1. Compatible bundle (exact freeze pin)

No version bump. Runtime identity is the already-shipped G0–G6 tip.

| Surface | Frozen value | Source |
|---|---|---|
| Marketapp `origin/main` | `6ebd206ea19901f3663ea311cf8956e134e6301d` | `feat(G6): versioned performance ledger and shadow comparisons (2.6.41/b472)` |
| MarketVivi code/labels tip (pre this doc) | `7418b92e855d9d168ab09b5a034e0fcef3db1dfe` | `docs(G6): Release C prep and sync labels to v2.6.41 · b472` |
| Android `versionName` | `2.6.41` | `Marketapp/app/build.gradle.kts` |
| Android `versionCode` | `472` | same |
| Python `BRAIN_VERSION` | `2.6.41` | `Marketapp/app/src/main/python/brain.py` |
| Python `TRACE_SCHEMA_VERSION` | `1.1` | same |
| PWA label | `v2.6.41 · b472` | MarketVivi `index.html` title + version span |

**Experiment identity:** `paper_baseline_g7_20260912_b472`

This G7 commit is **documentation only**. It will advance the MarketVivi SHA after `7418b92`. That new SHA is **not** a new policy version. The compatible runtime bundle remains Marketapp `6ebd206` + MarketVivi labels at `7418b92` (`v2.6.41 · b472`). Any later commit that changes decisions, recording, costs, or hashes **starts a new experiment segment** and must not reuse this identity.

Worktree for this package: `/workspace/g7-freeze/{MarketVivi,Marketapp}`.

---

## 2. Model / teacher asset hashes

Recomputed on Marketapp `6ebd206` (bytes unchanged vs G0 manifest). Paths under `Marketapp/app/src/main/assets/`. SHA-256 of file bytes:

| Asset | SHA-256 | Embedded metadata |
|---|---|---|
| `ml_model.json` | `795b333049dbab16715a907d172d612f9fe4f4d6156b76ada4a2c6eee21d5dfd` | `version=2.1.1`, `trained=true`, `n_train=8372`, `base_wr≈0.5876` |
| `temporal_model.json` | `92e8f0df1628daa1610cd606706dbfaa20ddae26eda5310683846322024217fd` | `ver=1.0`, `trained=true`, `n_train=8372` |
| `teacher_table_stage2a.json` | `9ed5bdf3909062ecbb6201cfd2ea4125ab21131bc6d05cbccb9ac8fc78bde655` | `schema=stage2a_teacher_table_v1`, scope `2026-06-01..2026-06-25` |

Feature schema used by the G6 ledger: `ml_feature_schema_v2_1_1_n38` (38-dim GBT/NN). Device-local overrides in `filesDir` were **not** inspected on a phone for this freeze. If a device has overwritten these assets, that device is **out of this experiment** until hashes are re-verified.

`ml_models` DB is not the hash source. Claude’s unprovided 627-test / sizing artifact is **not** in this bundle.

---

## 3. Schema / access notes (as shipped)

| Item | Frozen state | Provenance |
|---|---|---|
| `ml_recommendation_outcomes.snapshot_id` | `bigint NOT NULL` (live nulls 0 at G0 probe) | Remote `20260912082710_ml_recommendation_outcomes_snapshot_id_not_null` |
| Archive `ml_recommendation_outcomes_archive` | RLS **on**, **no** anon/authenticated policies, **no** grants to anon/authenticated | G1 Phase 1a (`20260912154532` + `20260912154943`) |
| Public `TRUNCATE` to anon/authenticated | **0** | G1 Phase 1a |
| Public `DELETE` to anon | **0** | G1 Phase 1a |
| Anon `INSERT`/`UPDATE` on recording tables | **Still allowed** (containment) | G1 matrix §8 / §10 — **not** Auth cutover |
| G1 auth stub | **OFF** — `AuthAccess.DEFAULT_SESSION_ENABLED = false`; bearer falls back to anon | `AuthAccess.kt`; PWA `g1_auth_session_enabled` not `'1'` |
| `ml_evaluation_runs` | Added; RLS on; anon revoke; authenticated read; service_role write | G5 `20260912170000_g5_ml_evaluation_runs.sql` |
| `ml_evaluation_metrics` | Added; identity upsert **not** date-only | G6 `20260912180000_g6_ml_evaluation_metrics.sql` |
| Ownership columns (`user_id` / `owner_id`) | **None** on critical tables | G1 matrix — Phase 2 mapping not done |

**Do not** revoke anon INSERT as part of this freeze. Auth cutover remains a separate, later gate.

---

## 4. Policy / contract versions in the bundle

| Constant | Value | Role in this experiment |
|---|---|---|
| `calibration_input_v1_net_eligible_20260912` | G2 adapter | Sole learning-admission contract |
| `g3_gross_extrema_v1_20260912` | G3 | Top-level `peak_pnl`/`trough_pnl` = **GROSS**; historical `--apply` **not** run |
| `position_exit_policy_v1_net_20260912` | G4 teacher/monitor contract | Learning target + conformance |
| `net_target_v1_gross_minus_costs_once_20260912` | G4 | `net = gross − costs` exactly once; win = net > 0 |
| `POSITION_POLICY_V1` | Legacy live shadow | **Live SHADOW_\* still gross** 0.50 / 0.60 |
| `pc2_paper_primary_v7` | Selector | Active ranking authority |
| `pc2_authority_policy_v2` | Authority | Unchanged |
| `entry_eligibility_v5_quote_friction_fail_closed` | Entry | Fail-closed quotes/friction |
| `net_economics_v2_executable_quote_contract` | Economics | Bid/ask executable, not LTP |
| `teacher_friction_v2_executable_bid_ask_charges` | Teacher costs | Entry-time friction |
| `sigma_distance_penalty_v2_symmetric_band` | Ranking de-rate | De-rate, never veto |
| `ml_feature_schema_v2_1_1_n38` | Features | Incompatible with any new index feature |

### Notification / ownership constants (F1–F5 / b460–b466 lineage, included)

| Constant | Value |
|---|---|
| `POSITION_ALERT_OWNERSHIP_VERSION` | `position_alert_ownership_v1_tick_service_authoritative` |
| `POSITION_EXIT_THRESHOLD_PUBLISH_VERSION` | `position_exit_thresholds_v1_published_from_brain` |
| `POSITION_ALERT_REENTRY_COOLDOWN_MS` | `45 * 60 * 1000` |

Notification pack ancestry **inside** `6ebd206` (do not re-port):

| Build / SHA | What landed |
|---|---|
| b460 `4fd12e4a21704831ae23bcee5ecd87916b1f3709` | F1 flat `force_alignment` for Book Profit; F2 tick shadow notify; F4 entry window 09:15–15:15 + morning-input notice |
| `07dca165527b12f38cb4d00274be7e5afed3df4d` | D1 — class-keyed shadow cooldown that survives HOLD |
| D4 `d3f4f68cabff8df5902fbc6d09d175e8542692ae` | 60s tick authoritative for Target / Stop / Degraded / EOD; brain keeps `POS_BOOK` |
| D6 `b7123f00a8b534cce72371156a1211d10accf08e` | Morning-input-off notice audible + delivery-gated |
| F3 / D7 `d44aecbc6080d1df8632b88b9a0c5d54e8c99e7b` | Per-trade alert bound + genuine re-entry cooldown |
| b465 `0457698dcfcf82a6859f139c56dd19a764715242` | Percentile exit levels published into the tick path |
| F5 `ce1ed7a4b9c76731fb11b2a6e41e876f493a2cf9` + docs `1d6b7f7504cc92e1157448489dad816d7790443e` | Economic `SETUP_READY` stability + choppy mute (b466) |

D4 remains **interim dual ownership** by design. Moving `POS_BOOK` off the brain is **not** part of this freeze.

---

## 5. Declared experiment (write-once, prospective)

Declared **before** treating any post-freeze session as evidence. Do not retune after an adverse day and keep this identity.

### 5.1 Instrument universe

| Item | Declared value |
|---|---|
| Indexes | **Nifty 50 (NF)** primary and **Bank Nifty (BNF)** secondary — both generated every poll |
| Strategies | `BEAR_CALL`, `BULL_PUT`, `IRON_CONDOR`, `IRON_BUTTERFLY` as produced by current `generate_candidates` |
| Expiry | NF weeklies + monthly as offered; BNF **monthly only** (weeklies discontinued). Soft-OOD monthly-DTE policy **v6 is not shipped** — runtime stays entry-eligibility **v5** |
| Lot metadata | Prefer live chain `lotSize`; fallback constants `NF_LOT=65`, `BNF_LOT=30` |
| Venue | NSE F&O, paper recording only |

Slices (NF/BNF, strategy, DTE, regime) are **observability** (G6). Thin slices must be reported as insufficient support, not as a new rule.

### 5.2 Sessions

| Clock (Asia/Kolkata) | Role |
|---|---|
| 09:15 | Session / entry open (requires `morning_input`) |
| 09:15–15:15 | Eligible **intraday entry** window (F4) |
| **15:15** | Policy exit intent; **no new intraday entry** at/after this cutoff |
| 15:30 | Python `check_execution_readiness` (documented; **not** the policy cutoff) |
| 15:40 | Native poll / session close (documented; **not** the policy cutoff) |

Overnight / swing / manual holds are a **separate cohort**. Do not force same-day EOD labels onto them. Include **all** eligible NSE sessions in the test window; report exclusions with reason. A holiday or feed-down day is an exclusion, not a deleted observation.

### 5.3 Entry (active policy — unchanged)

1. PC2 paper-primary v7 ranking (`safety_ineligible` → `rank_edge_effective` → context percentile → `prob_profit` → `candidate_id`).
2. Entry eligibility v5: complete legs, executable bid/ask, friction available, fail-closed on missing quotes.
3. **Numerical `p_ml` cap remains active:** final entry confidence = `min(market_fit, p_ml * 100)` plus remaining ML action/domain flags and every non-ML hard guard.
4. Capital block: max-loss > 10% of capital → ineligible.
5. Calibration consumers admit **eligible net** only (`calibration_input_v1_net_eligible_20260912`). Support &lt; 5 → explicit unavailable + deterministic fallback. No “Edge confirmed” on thin samples.

Do **not** remove the `p_ml` cap during this experiment. That is SHADOW_B, log-only.

### 5.4 Exit (two layers — do not conflate)

| Layer | Contract | Parameters |
|---|---|---|
| **Live / paper monitor (active)** | `POSITION_POLICY_V1` **gross** SHADOW_\* | `TP_MULT=0.50`, `SL_MULT=0.60` of **gross** max-profit / max-loss; tick-owned Target / Stop / Degraded / EOD |
| **Teacher / learning (measured)** | `position_exit_policy_v1_net_20260912` | Same 0.50 / 0.60 on **net** max-profit / max-loss; SL before TP before EOD; 15:15 IST; overnight = `OVERNIGHT_HOLD` |

Adopting the net contract as the **live** exit gate would be a **new** experiment identity. It is **not** this freeze.

Published percentile thresholds may only fire **earlier**. Stale/absent publication → constants stand. Gaps through the stop keep realized net (no clip to threshold). Missing executable marks → no invented fill.

### 5.5 Sizing / capital / concurrency (held fixed)

| Assumption | Declared value |
|---|---|
| Capital base | **₹2,50,000** (`_CONST['CAPITAL']` / `_capital`) |
| Per-trade risk budget | **10%** of capital (`MAX_RISK_PCT`) |
| Default size | **1 lot** (user operating assumption). G9 variable sizing is **not** supplied and **not** adopted |
| Concurrency | Existing capital-block / ranking suppression only — no new concurrency optimizer |
| Quantity unit | `INR_TOTAL` (G4). Per-unit premium is rejected |

A suggestion that changes lot count is **out of experiment** even if labelled advisory.

### 5.6 Costs / slippage stress

Primary economics use **recorded** executable friction (`teacher_friction_v2` / G2 net). These are paper-recorded costs, not independently verified cash brokerage.

**Pre-declared sensitivity (must be reported with any net headline):**

1. Recorded-friction net (as stored).
2. Recorded friction **+ ₹25 per closed trade**.
3. Best-trade dropout on the measured cohort (plan precedent: 92-row net-labelled paper cohort was **₹1,233.12**, **−₹702.12** without its best trade, **−₹1,066.88** at +₹25/trade).

Do not delete losses to improve a headline. UNKNOWN / untrusted / divergent rows stay in accounting sensitivity and stay **out** of learning until reconciled.

### 5.7 Benchmarks (same menus, same capital)

| Variant | Flag | Role |
|---|---|---|
| **ACTIVE** | always | Live gate with numerical `p_ml` cap — **the policy under test** |
| **SHADOW_A** `SHADOW_A_NET_CAL_BASELINE` | on, **log-only** | Corrected net-calibration + existing ML entry integration |
| **SHADOW_B** `SHADOW_B_NO_PML_CAP` | on, **log-only** | Remove only the numerical `p_ml` cap **in logs**; live recommendation unchanged |
| **SHADOW_C** `SHADOW_C_ML_FREE_DETERMINISTIC` | **off** | Research stub — not in this experiment |
| Deterministic market-fit | logged in confidence decomposition | Named separately; **not** a calibrated probability |
| Hindsight-best candidate | diagnostic upper bound only | **Not** the attainable strategy benchmark |

Compare identical eligible menus, common capital/concurrency, timestamped availability. WAIT quality is reported separately. Repeated overlapping candidates are not independent trades.

### 5.8 Metrics (G6 ledger)

Identity (unique upsert, **not** date-only):

`run_id + session_date + model_hash + feature_schema_version + policy_selector_version + net_target_version + cohort_execution_mode + variant`

Must separate:

- Confidence: `raw_p_ml`, `market_fit_confidence`, `final_entry_score` (named; not a probability).
- Prediction calibration: eligible joined count, missing coverage, Brier, reliability bins. **Missing outcomes ≠ zeros/losses.**
- Policy economics: net expectancy, profit factor, turnover, costs, exposure, closed/open equity drawdown, loss tails.
- Populations: menu/prediction vs selected vs paper closures vs broker fills (fills expected empty — live path off).
- Slices: NF/BNF, strategy, DTE, regime, execution mode with `thin_support`.

Zero eligible predictions → unavailable metrics with n=0. Mixed model/target versions **must not** be pooled.

### 5.9 Stopping / review criteria

Declared **now**, not after seeing results:

1. **Do not** change thresholds, selector, costs, lot count, or gate after an adverse session and keep this identity.
2. Do **not** declare “validated” after an arbitrary trade count or a few profitable days.
3. Review is **session/block-aware**. Minimum honest review needs a block of complete eligible sessions with functioning post-close stages (labels + C3 terminal-ok + performance_metrics), not a handful of closed trades.
4. Support for any slice claim must match observed variance and a **pre-stated** meaningful net effect under the +₹25 and best-trade-dropout stresses. Thin slices → insufficient, not a new rule.
5. Include all eligible sessions; list exclusions. Disclose overnight / overlapping exposure.
6. Historical C3 gaps (2026-09-10 / 09-11) stay **ineligible** (capped populations). They are not this experiment’s evidence and must not be fabricated.
7. Historical peak `--apply` stays **off**. Forward-path G3 extrema apply from b469 onward; pre-repair zeros remain diagnostic, not silently “fixed” into this baseline.
8. **Stop-the-experiment (operational)** if: live orders are enabled; `ml_train.run` / `online_update` runs without a new gate; `p_ml` cap is removed from the live path; Auth stub is flipped on without the cutover plan; hashes diverge from §1–§2; or a decision-changing hotfix ships without a new segment id.
9. **Promotion / live-trading:** **never** a G7 outcome. A later G10 + explicit Vivek authorization is required.

---

## 6. Shadows stay log-only; `p_ml` gate stays active

| Control | Frozen setting |
|---|---|
| Live entry score | `min(market_fit, p_ml * 100)` **unchanged** |
| SHADOW_A / SHADOW_B | Log + `ml_evaluation_metrics` only |
| SHADOW_C | Off |
| Training | Frozen. `RETRAIN_DISABLED_REASON = "Retrain paused until canonical won-label unification is completed."` Nightly alarm cancelled. `ml_retrain_force_enable` default false. **Do not** enable `ml_train.run` / `online_update` |
| Live broker path | `OrderExecutionService.EXECUTION_MODE = "SANDBOX"` |

The reported historical `p_ml` correlation of −0.29 remains an **unproven causal hypothesis** (G0). It cannot authorize removing the gate.

---

## 7. Lineage included in this freeze (G0–G6 + notif pack)

| Pkg | Marketapp SHA | Version | Deliverable |
|---|---|---|---|
| G0 | `8fb14228157a8f275dfb7cfe0424b7bb1e3796d8` | pointer on 2.6.35/b466 | Evidence manifest |
| G1 | `526c559a88558f76f501b5f64e701b51282a64ce` | 2.6.36 / 467 | Archive RLS + auth stub **OFF** |
| G2 | `882af66898ba0b18384e50bb4872d678a483df32` | 2.6.37 / 468 | Net calibration adapter |
| G3 | `f46536f106eda0d9f46a6aaa107617637243f745` | 2.6.38 / 469 | Peak/trough forward path; `--apply` not run |
| G4 | `5a50a0c7f3153bd698a40a3abebc28487093e5aa` | 2.6.39 / 470 | Net target + exit contract |
| G5 | `e02d9c3664ebe1829490c4366427fc9efc90e777` + fix `7669ad532688f9c368bebb56db3408d2358899c2` | 2.6.40 / 471 | Evening-stage ledger |
| G6 | `6ebd206ea19901f3663ea311cf8956e134e6301d` | **2.6.41 / 472** | Metrics ledger + shadow A/B |
| Notif F1–F5 | `4fd12e4` … `1d6b7f7` (b460–b466) | included | See §4 |

Python unittest on G6 tip (recorded in G6 review): **679 tests OK**. Kotlin/Gradle and device checks were **not** executed in the implementation sandbox — blocked/unrun, not passed.

---

## 8. Release C acceptance checklist (plan §15) vs what shipped

Honest status against the **complete measured baseline** checklist. Partial items stay visible.

| Checklist item | Status | Notes |
|---|---|---|
| Anonymous and cross-account access blocked; legitimate authenticated recording and server evaluation demonstrated | **Partial / not claimed** | G1 Phase 1a containment only. Archive locked; TRUNCATE/anon DELETE gone. Anon INSERT/UPDATE on recording tables **retained**. Auth stub **OFF**. Full ownership + revoke-anon-INSERT is Phase 2 |
| Every calibration consumer uses eligible net inputs; missing evidence is unavailable, not silently profitable | **Met (G2)** | Contract `calibration_input_v1_net_eligible_20260912` |
| Peak/trough persist across close/restart/offline retry; any historical repair has a reviewed ID manifest | **Partial** | Forward path met (G3). Historical `--apply` **not** run; no approved ID write-manifest |
| One declared exit/label contract passes Python/Kotlin conformance; legacy metrics remain explicitly identified | **Met for teacher/monitor (G4)** | Live SHADOW_\* still gross `POSITION_POLICY_V1`. Legacy `canonical_won` / H2 / TP-hit **not** rewritten |
| Labels, research, C3 and performance have separate truthful, restartable completion states | **Met (G5+G6)** | `labels_saved ≠ learning_complete`; `performance_metrics` after C3 |
| Historical C3 gaps verified from original evidence or explicitly ineligible; no fabricated provenance | **Met** | 2026-09-10/11 C3 **ineligible** (`CAPPED_OR_INCOMPLETE_CANDIDATE_POPULATION`); dry-run only |
| Performance metrics have model/policy/target/cohort identity; hypothetical vs realized separate | **Met (G6)** | `ml_evaluation_metrics` identity upsert |
| Existing ML gate remains active unless a separately reviewed controlled comparison justifies a change | **Met** | Gate active; SHADOW_B log-only |
| New baseline contains exact Android/PWA/schema/model/configuration hashes | **Met** | This document §§1–4 |
| Actual Python, relevant Kotlin/PWA integration and device checks recorded; blocked checks visible | **Partial** | Python 679 OK. Kotlin unit tests authored; local JVM/device **not run** in sandbox |
| No live orders, automatic training promotion, sizing adoption or unreviewed strategy changes included | **Met** | Sandbox-only; training frozen; G9 sizing pending / not adopted |
| Vivek's publishing pause lifted before push / production write | **Met for this docs push** | User authorized G7 docs push. No production SQL write, no G3 `--apply`, no Auth revoke |

**Release C (G4–G6 + freeze identity) is complete as a paper measurement baseline.** It is **not** a live-trading release and **not** a completed security cutover.

---

## 9. What this freeze is / is not

**Is:** a versioned, hash-pinned, prospective **paper** experiment on the repaired measurement stack (G1 containment + G2 net cal + G3 forward extrema + G4 net contract + G5 stages + G6 ledger), with the notification pack F1–F5 already in ancestry.

**Is not:**

- Permission to place real orders.
- Permission to enable `ml_train` / `online_update`.
- Permission to remove the `p_ml` gate.
- Permission to run G3 `--apply`.
- Permission to revoke anon INSERT / flip the G1 auth stub on.
- Adoption of G9 sizing or a BNF construction / ML-schema change.
- A claim that historical paper net (₹238.83 combined / ₹1,233.12 on the 92-row cohort) is an edge.

Queued follow-ups: `docs/G8_G9_QUEUED_20260912.md`. Release C summary: `docs/RELEASE_C_COMPLETE_20260912.md`.
