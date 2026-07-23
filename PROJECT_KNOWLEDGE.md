## 2026-07-23 Forward teacher-label recovery executed

- Trigger:
  - Claude accepted OC correction that the rerun test must purge/rebuild evaluation inputs; otherwise cached `chain_filtered_v3_<date>.json` could replay stale near-close evidence.
  - Claude recommended recovering post-S1 forward labels with the proven offline regeneration path before touching ranking or sandbox work.
- Local tooling update:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/full_label_regeneration_s1.py`
  - added forward-live support for post-S1 dates without requiring `price_integrity=LEGACY_PRE_S1`.
  - added environment-configurable batch id/output base.
  - used batch id:
    - `S1_FORWARD_RECOVERY_20260723`
  - used output base:
    - `label_regen_forward_20260723`
- Execution policy:
  - single-threaded.
  - date-by-date.
  - no parallel Supabase reads/writes.
  - stopped only if throttle/timeout surfaced; none surfaced.
- Forward recovery write results into S1 shadow tables:
  - `2026-07-15`: eval rows `0`, reco rows `0`.
  - `2026-07-16`: eval rows `49`, `OK 49`, reco rows `49`, `DERIVED_FROM_EVAL_SHADOW 49`.
  - `2026-07-17`: eval rows `104`, `OK 104`, reco rows `104`, `DERIVED_FROM_EVAL_SHADOW 104`.
  - `2026-07-20`: eval rows `10`, `OK 10`, reco rows `10`, `DERIVED_FROM_EVAL_SHADOW 10`.
  - `2026-07-21`: eval rows `26`, `OK 26`, reco rows `26`, `DERIVED_FROM_EVAL_SHADOW 26`.
  - `2026-07-22`: eval rows `11`, `OK 11`, reco rows `11`, `DERIVED_FROM_EVAL_SHADOW 11`.
  - `2026-07-23`: eval rows `1`, `OK 1`, reco rows `1`, `DERIVED_FROM_EVAL_SHADOW 1`.
- Interpretation:
  - Offline regeneration found zero `MISSING_H2_PRICE_*` failures for the recovered forward window.
  - This strongly supports the runtime race diagnosis:
    - raw chain data exists.
    - Python H2 logic can grade the same days when run offline.
    - near-close live teacher path is the likely failing path.
- Current next actions:
  - prepare/implement runtime fix only after explicit authorization:
    - stop immediate post-close teacher evaluation, or defer it to settled time.
    - add H2-window chain completeness gate before grading.
    - if not complete, defer/fail-loudly with runtime-readiness reason, not `MISSING_H2_PRICE_*`.
  - separately fix:
    - `entry_snapshot.candidate_id` null linkage.
    - deterministic chain fetch ordering and explicit exact-path page cap.
  - do not treat this as ranking/EV-gate change; this is label trust recovery only.

## 2026-07-23 Runtime teacher race fix staged locally

- App-code fix implemented locally after forward recovery proved offline labels grade cleanly.
- Files changed:
  - `Marketapp-main-worktree/app/src/main/java/com/marketradar/app/MarketWatchService.kt`
  - `Marketapp-main-worktree/app/src/main/java/com/marketradar/app/MarketMLService.kt`
- Behavioral change:
  - post-close watch-service handoff no longer launches teacher evaluation immediately at ~15:31 IST.
  - if close handoff happens before `16:30 IST`, it schedules the existing day-evaluation reminder for the settled evaluation window.
  - if handoff happens at/after `16:30 IST`, it can launch evaluation immediately because the settled window has already arrived.
- Evaluation-input hardening:
  - prepared chain cache is no longer accepted unless its `.complete` metadata has `h2_coverage_ok=true`.
  - older prepared caches without this marker are invalidated and rebuilt.
  - newly prepared chain inputs verify that every candidate evaluation leg has at least one H2-window row (`15:15-15:30 IST`) before `.complete` is written.
  - if H2 leg coverage is incomplete, the chain file and `.complete` marker are deleted and evaluation fails/defer-retries with `EVAL_CHAIN_H2_INCOMPLETE` instead of letting Python stamp misleading `MISSING_H2_PRICE_*`.
- Important boundary:
  - no ranking change.
  - no EV floor change.
  - no sandbox/order authority change.
  - no Python teacher formula change.
- Validation:
  - attempted Android compile with `./gradlew :app:compileDebugKotlin`.
  - compile could not start because this workspace has no Android SDK configured:
    - `SDK location not found. Define ANDROID_HOME or sdk.dir in local.properties`.
  - this is an environment limitation; CI/device build should be used for final compile verification.

## 2026-07-23 Claude verification of teacher race fix and local G1-G4 follow-up

- Claude verification received:
  - `/tmp/codex-web-uploads/f-EFp3Ga/CLAUDE_VERIFICATION_TEACHER_FIX_20260723.md`
- Claude verdict:
  - `v2.5.24 / b355` teacher race fix works.
  - race hypothesis is confirmed by experiment.
  - previously failing forward sessions recovered cleanly through offline S1 regeneration:
    - `2026-07-17`: `104/104 OK`
    - `2026-07-20`: `10/10 OK`
    - `2026-07-22`: `11/11 OK`
    - `2026-07-23`: `1/1 OK`
  - total S1 forward recovery extension:
    - `+201` rows
    - all `201` graded `OK`
    - zero `MISSING_H2_PRICE_*`
- Claude remaining gaps:
  - G1: user-visible accuracy/report surfaces can still read stale live `ml_recommendation_outcomes` rows instead of recovered S1 shadow rows.
  - G2: failed live rows may still carry misleading `managed_pnl`.
  - G3: several capture days remain unlabeled or need per-day reason reporting.
  - G4: Android version is `2.5.24 / b355` but `BRAIN_VERSION` remained `2.5.23`.
- Local follow-up patch staged after Claude verification:
  - `Marketapp-main-worktree/app/src/main/java/com/marketradar/app/SupabaseClient.kt`
    - date/recent evaluation reads now prefer S1 shadow tables when available:
      - `ml_evaluation_outcomes_s1`
      - `ml_recommendation_outcomes_s1`
    - S1 shadow rows are normalized back into live field names for app consumers:
      - `new_sim_pnl_h2` -> `sim_pnl_h2`
      - `new_outcome_h2` -> `outcome_h2`
      - `new_canonical_won` -> `canonical_won`
      - `new_price_integrity` -> `price_integrity`
      - `new_h2_price_integrity_reason` -> `h2_price_integrity_reason`
    - failed-integrity rows strip managed teacher metrics before write/read exposure:
      - `managed_pnl`
      - `managed_gross_pnl`
      - `friction_cost`
      - `r_multiple`
      - `captured_pct`
      - `is_success`
  - `Marketapp-main-worktree/app/src/main/python/brain.py`
    - `BRAIN_VERSION` bumped from `2.5.23` to `2.5.24` to match the pushed app version.
- Validation:
  - `python3 -m py_compile app/src/main/python/brain.py` passed.
  - Android Kotlin compile was not rerun because local SDK is unavailable in this workspace; previous attempt failed before compile due to missing `ANDROID_HOME`/`local.properties`.
- Push status:
  - Vivek authorized synchronous push after the local follow-up patch.
  - release bump prepared:
    - Android `versionName = 2.5.25`
    - Android `versionCode = 356`
    - web visible label `v2.5.25 / b356`
    - Python `BRAIN_VERSION = 2.5.25`

## 2026-07-23 Project knowledge refresh — teacher-label race investigation and UI/jitter status

- Current focus from user direction:
  - We continue to prioritise brain logic correctness over cosmetic issues and keep moving on the execution spine.
  - Sandbox implementation remains deferred until teacher correctness and reliability are improved.
  - User preference remains: no risky changes without Claude authorization; version-synced pushes in both repos.

- Consolidated status (as of latest available evidence):
  - The latest god-mode teacher audit retracted the earlier maxPages/expiry hypotheses and kept the following as surviving:
    - 126 of 201 recent outcomes remained ungraded (63%).
    - real trade reality and teacher reality diverge on same-day winners (two NF Bear Put paper trades showed +₹1,225.39, but teacher output was negative/ungradeable).
    - candidate fields for those trades matched chain correctly, but `entry_snapshot.candidate_id` is `NULL`, so systematic reconciliation between real outcome and teacher trace is broken.
    - `new_price_integrity` failures were confirmed to be all-or-nothing per day in those observed windows.
  - The data-store side was revalidated as not the root source of those failures:
    - H2 window rows were present in the verified window (15:15–15:30 IST) on failing days.
    - Brain window/parsing logic was checked and not identified as the primary defect.
  - New surviving hypothesis is a timing race:
    - evaluation appears to fire within ~1.5–4 minutes after final chain poll and fails with H2 misses.
    - the one known “late” evaluation run (07-21 at ~18:32 IST) graded cleanly while same-day close-window runs failed.
    - decisive test remains to re-run evaluation for 2026-07-17, 2026-07-20, 2026-07-22, 2026-07-23 to check if grading becomes OK.

- App/jitter context from latest investigation:
  - Poll cadence remained healthy and service continuity was maintained.
  - Observed jank is tied to per-poll payload/I/O pattern, not missed polls:
    - ~66 MB local snapshot rewrite/read each poll.
    - repeated large bridge payload marshalling into WebView (~268–338 KB ×2).
  - a real data-plane issue remains logged: chain save returned `saved=false` without reason at 12:35 IST window, causing a known poll gap.
  - duplicate-reason logs were observed and are likely logging duplication, not confirmed duplicate database writes.
  - WebView/UI lifecycle remains OS-kill/restart behavior while foreground service stays active; this is normal with this architecture.

- Pending actions (aligned to latest Claude direction posture):
  - run the race validation re-check on the four dates above (slow, batched, throttling-safe), and only then treat the race direction as proven.
  - if proven, move evaluation trigger off near-close instant (or gate on H2-window chain completeness) to avoid false `MISSING_H2_PRICE_*` outcomes.
  - keep `maxPages`/ordering and missing `candidate_id` cleanup items in the remediation queue even though not yet confirmed as this failure.
  - continue with `entry`/`close` action reliability fixes only if they are still confirmed by logs; otherwise prioritize teacher-path trustability.
  - do not widen repo code changes beyond explicit authorized clauses.

- Release/state reminders:
  - user has repeatedly requested paired release hygiene: both repos must remain version-bumped and pushed together for app-deliverable updates.
  - latest known release activity has been through `v2.5.23` earlier; no new release/version bump for this July 23 teacher-jitter cycle has been recorded in this file yet.

## 2026-07-16 Claude ruling - full regeneration accepted pending Gate 8

- Ruling received:
  - `/tmp/codex-web-uploads/f-PPMnm4/RULING_FULL_REGEN_ACCEPTED_20260716.md`
- Claude verdict:
  - full S1 shadow regeneration is accepted as correctly executed.
  - acceptance remains conditional on mandatory Antigravity independent recount, now called Gate 8.
  - retrain/replay/O3-G2/CHANGE-2 remain blocked until Gate 8 passes.
- Core accepted findings:
  - `3,518 / 12,061 = 29.2%` of regenerated eval base failed closed.
  - this is correct behavior, not regeneration failure.
  - old labels silently fabricated outcomes on incomplete evidence; S1 now stamps those rows `FAIL`.
  - fail split:
    - `INSUFFICIENT_LABEL_WINDOW 2,821`
    - `INSUFFICIENT_RAW_DATA 697`
  - clean trainable base:
    - `8,543 OK rows`
    - across `17` days with at least `50` OK rows each.
    - distribution is mildly late-leaning, not heavily skewed.
    - real sample size for modeling is day/candidate-day level, not raw row count.
- Claude accepted:
  - execution correctness.
  - unique source IDs and zero null source IDs.
  - legacy tables untouched.
  - Jul 8 value-drift guard passed.
  - recommendation shadow split: `3,722` rows, all `DERIVED_FROM_EVAL_SHADOW`.
  - early reco exclusions followed R0/R1; no invented reco formula.
  - script pivot from monolithic `evening_evaluator` to batch `evaluation_job_prepare/run_batch/finalize`.
- DDL fixes reconfirmed from local execution evidence:
  - no anon UPDATE policy exists on either shadow table.
  - no anon DELETE policy exists.
  - `interpretation_guardrail` default exists on both shadow tables.
  - null-source collision risk is absent because source IDs were present for every legacy row.
- Gate 8 required Antigravity checks:
  - eval row/source reconciliation: `12,061`, unique source IDs `12,061`, null source IDs `0`.
  - reco row/source reconciliation: `3,722`, unique source IDs `3,722`, null source IDs `0`.
  - integrity counts: OK `8,543`, FAIL `3,518`, window `2,821`, raw `697`.
  - no OK row violates structural max-loss/arbitrage bound.
  - Jul 8 97 rows byte-match the POC values.
  - Jul 9 BULL_CALL 4 rows are present and individually valued.
  - 06-21 has 665 FAIL rows, not dropped.
  - 06-02 handled by regenerated coverage or fail-closed rows.
  - every row carries `date_source`; created_at fallback count reconciles.
  - no UPDATE policy exists on either shadow table.
- Antigravity packet created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/ANTIGRAVITY_GATE8_RECOUNT_PACKET_20260716.txt`
- Retrain constraints, if Gate 8 passes:
  - train only on `new_price_integrity = OK`.
  - exclude all `3,518` FAIL rows; never impute.
  - document model-card base profile: `8,543` rows across `17` days, mild late-lean.
  - split train/test by day or candidate-day discipline, not random row split.
  - re-examine old `EVAL_OUTCOME_WEIGHT = 4`.
  - compare clean model against poisoned frozen model, especially debit-spread predictions.
  - shadow before cutover; `p_ml` remains dead-last tie-break until separately validated.
- Current gate:
  - Gate 8 Antigravity recount is the next mandatory action.
  - no retrain, replay, O3-G2, corrected Week-1 packet, or CHANGE-2 until Gate 8 passes.

## 2026-07-16 S1 shadow label regeneration executed and verified

- Execution scope:
  - shadow label regeneration only.
  - no legacy table mutation.
  - no app release or OTA.
  - no retrain.
- Batch id:
  - `S1_FULL_REGEN_20260715_DRAFT1`
- Shadow tables:
  - `public.ml_evaluation_outcomes_s1`
  - `public.ml_recommendation_outcomes_s1`
- DDL state:
  - both tables exist.
  - RLS enabled on both.
  - explicit anon SELECT and INSERT policies exist.
  - no anon UPDATE or DELETE policy exists.
  - `interpretation_guardrail` default exists on both tables.
- Local execution tooling:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/full_label_regeneration_s1.py`
  - script was patched to use the existing `brain.py` batch evaluator API:
    - `evaluation_job_prepare`
    - `evaluation_job_run_batch`
    - `evaluation_job_finalize`
  - reason:
    - `2026-06-22` stalled when all snapshots and chain rows were passed through the monolithic `evening_evaluator`.
  - batch checkpoint manifests are under:
    - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_full_20260716/<session_date>/manifest.json`
- Completed approved date set:
  - `2026-06-02`, `2026-06-03`, `2026-06-04`, `2026-06-05`, `2026-06-08`, `2026-06-09`, `2026-06-12`, `2026-06-15`, `2026-06-17`, `2026-06-21`, `2026-06-22`, `2026-06-23`, `2026-06-24`, `2026-06-29`, `2026-07-01`, `2026-07-02`, `2026-07-03`, `2026-07-07`, `2026-07-08`, `2026-07-09`, `2026-07-13`, `2026-07-14`
- Supabase verification:
  - `ml_evaluation_outcomes_s1`
    - rows: `12,061`
    - unique `source_eval_id`: `12,061`
    - null `source_eval_id`: `0`
    - `new_price_integrity`: `OK 8,543`, `FAIL 3,518`
    - `label_window_status`: `OK 8,543`, `INSUFFICIENT_LABEL_WINDOW 2,821`, `INSUFFICIENT_RAW_DATA 697`
  - `ml_recommendation_outcomes_s1`
    - rows: `3,722`
    - unique `source_reco_id`: `3,722`
    - null `source_reco_id`: `0`
    - `new_price_integrity`: `OK 3,320`, `FAIL 402`
    - `label_window_status`: `OK 3,320`, `INSUFFICIENT_LABEL_WINDOW 387`, `INSUFFICIENT_RAW_DATA 15`
    - `reco_mapping_status`: `DERIVED_FROM_EVAL_SHADOW 3,722`
- Key guardrails:
  - FAIL rows are fail-closed label evidence rows, not automatically script failures.
  - `2026-06-21` remains intentionally broken/no-coverage and all eval rows are `FAIL/INSUFFICIENT_RAW_DATA`.
  - `2026-07-08` passed the POC value-drift guard before write.
  - recommendation shadow rows were derived from matching evaluation shadow rows; no independent recommendation formula was invented.
- Local report:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/FULL_REGEN_PROGRESS_20260716.txt`
- Current gate:
  - regenerated S1 shadow base is complete.
  - next step is review/acceptance of shadow base by Claude/Antigravity before any retrain, CHANGE-2 promotion, or ranking change.

## 2026-07-15 Claude ruling - post-close patch approval, cache blast radius, RLS Step 1

- Claude ruling received:
  - `/tmp/codex-web-uploads/f-TF4OZO/RULING_POSTCLOSE_APPROVAL_CACHE_RLS_20260715.md`
- RLS Step 1 execution result:
  - Vivek ran the approved SQL in Supabase SQL editor on `2026-07-15`.
  - SQL executed:
    - `alter table public.ml_evaluation_outcomes enable row level security;`
    - `create policy anon_rw_ml_eval on public.ml_evaluation_outcomes for all to anon using (true) with check (true);`
  - Supabase result:
    - `Success. No rows returned`
  - Meaning:
    - `public.ml_evaluation_outcomes` is now policy-governed by RLS.
    - current app anon writer is still explicitly allowed by policy.
    - this is the approved interim label-base protection step, not full security.
  - Next required verification:
    - after the next post-close evaluation, confirm fresh rows still land in `ml_evaluation_outcomes`.
    - do not proceed to Step 2 RLS until this write verification passes.
- Patch status:
  - Claude approved the local post-close patch in principle.
  - Approved scopes:
    - integrity label discipline
    - FII/stale-context freshness sweep
    - local cache cap increase
  - Release remains gated:
    - Android build and `testDebugUnitTest` must pass in an SDK-enabled environment.
    - patch should ship as three separate attributed commits:
      - integrity labels
      - FII/stale-context freshness
      - cache cap
    - no push/OTA until explicit command and synchronized version bump.
- Cache blast-radius ruling:
  - `LOCAL_SNAPSHOT_TRIM` to about 3 rows hit multiple recent sessions, including A/B verdict-window days.
  - Week-1 verdict remains safe because it was Supabase-sourced, not local-cache sourced.
  - Any local post-close evaluation, Force Eval, or `DAY_EVAL_HANDOFF` output from `2026-07-06` through `2026-07-15` is evidence-limited/suspect if it depended on local cache.
  - If such a local eval informed a decision, re-derive from Supabase evidence.
  - Next full-session validation after cache-cap fix must confirm `LOCAL_SNAPSHOT_TRIM` no longer fires near the old 5 MB threshold.
- RLS/security ruling:
  - app writes to Supabase as `anon`.
  - this means RLS cannot be tightened to deny anon writes until a proxy/Edge Function write path exists.
  - Step 1 is allowed tonight for only `public.ml_evaluation_outcomes`:
    - enable RLS.
    - create an explicit `anon` read/write policy.
    - then stop and verify next-session writes.
  - This is policy-governance, not true security; real fix is app -> Supabase Edge Function with server-held service-role key, followed by removing direct anon write permissions.
  - Do not use Supabase dashboard "Resolve issue" button because it may enable RLS without a matching policy and lock out app writes.
- RLS table classification from source grep:
  - `ml_evaluation_outcomes`
    - phone/native writes post-close evaluation rows.
    - phone/native reads counts, recent rows, date rows, and lane summaries.
    - Step 1 target.
  - `ml_brain_snapshots`
    - phone/native writes brain snapshots.
    - phone/native reads snapshots for evaluation/recovery/status.
  - `chain_slices`
    - phone/native reads it as chain evidence fallback.
    - phone/native can also write it as a fallback target for `saveChainSlice()` and `saveChainRows()`.
    - Important correction: do not treat `chain_slices` as read-only in Step 2.
  - `trades`
    - no normal app write/read path found for exact table `trades`.
    - PWA export list reads it only during Export All Data.
    - active trade CRUD uses `trades_v2`, not `trades`.
  - `daily_data`
    - no normal app write/read path found.
    - PWA export list reads it only during Export All Data.
  - `radar_inputs`
    - no normal app write/read path found.
    - PWA export list reads it only during Export All Data.
  - `bhav_options`
    - no normal app write/read path found.
    - PWA export list reads it only during Export All Data.
  - `straddle_ratios`
    - no normal app write/read path found.
    - PWA export list reads it only during Export All Data.
- Operational consequence:
  - execute RLS Step 1 only.
  - defer Step 2 until Step 1 proves next-session writes still land.
  - Step 2 policy design must use the verified table classification above, especially the `chain_slices` write fallback correction.

## 2026-07-15 directive - S1 closed, label-base regeneration is next spine task

- Directive received:
  - `/tmp/codex-web-uploads/f-bO5Ia8/DIRECTIVE_OC_S1_CLOSURE_LABEL_REGEN_20260715.md`
- S1 closure recorded from directive:
  - `S1 decision-integrity: CLOSED`.
  - Released `v2.5.1 / b332` S1 build is verified.
  - Antigravity and Claude both confirmed released S1 `brain.py` byte identity at hash prefix `23f2808d` under their stated normalization checks.
  - Signed-release CI succeeded, proving Kotlin compiled clean for the released build.
  - Python test suite result from S1 verification:
    - `159/159` tests passed.
    - the three `test_d1_23*` live-position valuation tests are non-tautological.
  - Python live-position path fails closed:
    - zero quotes -> `compute_position_live` returns `None`.
    - unavailable valuation is stamped explicitly.
    - `position_verdict` blocks `BOOK` and `EXIT` with `DATA_UNAVAILABLE`.
  - Kotlin does not decide on `current_pnl`; it passes/stores values for PWA/native display while Python owns stop/target/notification logic.
  - Historical backfill remains:
    - `16,216` rows stamped `LEGACY_PRE_S1`.
    - `12,061` `ml_evaluation_outcomes`.
    - `4,155` `ml_recommendation_outcomes`.
    - still-null `price_integrity = 0` in both tables.
  - RLS Step 1 is live on `public.ml_evaluation_outcomes`.
- Cosmetic carryover logged, not implemented:
  - MarketVivi/PWA may render `NaN` for unavailable `current_pnl` because `NaN ?? 0` remains `NaN`.
  - Future display-only fix:
    - render unavailable/non-finite P&L as `--` or `unavailable`.
    - do not coerce to `0`.
  - Priority low; no build/push for this session.
- Next spine task:
  - label-base regeneration design only.
  - current 12,061 evaluation rows are quarantined as `LEGACY_PRE_S1`.
  - no retrain, replay, O3-G2 rerun, or CHANGE-2 gate work until regenerated base is verified.
- Deliverable created outside git:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/LABEL_REGENERATION_PLAN_v1_20260715.txt`
- Regeneration plan headline:
  - use a shadow table or new columns, not overwrite.
  - preserve old rows for audit/diff.
  - recompute from raw chain prices and saved candidate legs using corrected S1 valuation logic.
  - fail closed on missing raw data.
  - batch by `session_date`; no full-table scans.
  - one-session proof-of-concept first, suggested date `2026-07-08` if pre-flight coverage supports it.
- Status:
  - no mass rescore executed.
  - no Supabase large read/write executed.
  - no app code changed for regeneration.
  - no push/release.

## 2026-07-15 Claude ruling - label regeneration plan v1 Phase 0

- Ruling received:
  - `/tmp/codex-web-uploads/f-sOgVn2/RULING_LABEL_REGEN_PLAN_V1_20260715.md`
- Verdict:
  - `GO` for Phase 0 pre-flight metadata only.
  - `STOP` for re-approval before POC.
  - This is not blanket approval for rescore, script execution, DDL, writes, retrain, or CHANGE-2.
- Four conditions locked before any POC:
  - Hindsight/labelability boundary:
    - H2 uses later same-day prices.
    - regenerate only when the full post-entry label window has raw price coverage.
    - truncated windows fail closed with `new_price_integrity=FAIL`, `h2_price_integrity_reason=INSUFFICIENT_LABEL_WINDOW`, and `raw_data_status=FAIL`.
  - POC date must exercise the debit fix:
    - choose from Phase-0 evidence by BEAR_PUT/BULL_CALL debit rows plus full raw coverage.
    - do not default to `2026-07-08` by convenience.
    - POC date remains gated.
  - Pre-flight throttle:
    - recommendation dependency check must be bounded to one date first.
    - one query/read step at a time if Supabase is slow.
  - Shadow table RLS:
    - any `ml_evaluation_outcomes_s1` DDL must enable RLS and create an explicit matching policy in the same migration.
    - no RLS-off shadow table.
    - no RLS-on/no-policy table.
- Phase 0 executed locally:
  - runner:
    - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/phase0_label_regen_inventory_20260715.py`
  - output directory:
    - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_phase0_20260715`
  - output report:
    - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_phase0_20260715/PHASE0_LABEL_REGEN_INVENTORY_REPORT_20260715.txt`
  - CSV artifacts:
    - `phase0_a_eval_inventory_debit_counts.csv`
    - `phase0_b_reco_dependency_local_metadata.csv`
    - `phase0_c_d_raw_chain_and_snapshot_coverage.csv`
    - `phase0_candidate_poc_dates_debit_sorted.csv`
- Phase 0 scope:
  - read-only metadata inventory.
  - no Supabase writes.
  - no raw JSON candidate payload download.
  - no raw chain payload download.
  - raw chain/snapshot coverage used exact counts and first/last `poll_ts`.
  - because local anon REST could not execute grouped SQL/RPC, selected metadata columns were paginated and grouped locally.
- Phase 0 counts:
  - evaluation metadata rows pulled: `12,061`
  - recommendation metadata rows pulled: `4,155`
  - dates found: `22`
  - bounded recommendation-dependency probe date: `2026-06-02`
- Top debit-row inventory entries, evidence only:
  - `2026-06-05`: debit `106`, eval `551`, chain `3273`, snapshots `73`
  - `2026-07-08`: debit `97`, eval `97`, chain `41040`, snapshots `76`
  - `2026-06-24`: debit `96`, eval `411`, chain `52052`, snapshots `77`
  - `2026-06-04`: debit `89`, eval `753`, chain `3552`, snapshots `77`
  - `2026-06-23`: debit `31`, eval `527`, chain `50490`, snapshots `85`
  - `2026-06-09`: debit `29`, eval `74`, chain `2691`, snapshots `76`
  - `2026-07-14`: debit `29`, eval `29`, chain `40650`, snapshots `76`
  - `2026-07-02`: debit `25`, eval `625`, chain `42660`, snapshots `77`
  - `2026-06-17`: debit `22`, eval `204`, chain `2875`, snapshots `77`
  - `2026-06-15`: debit `17`, eval `406`, chain `3783`, snapshots `82`
- Important observations:
  - Highest debit count is `2026-06-05`, but its raw-chain row count is much smaller than modern full-chain days; full label-window coverage must be verified before any POC approval.
  - `2026-07-08` and `2026-06-24` have high debit counts and much larger raw-chain coverage, but no POC date has been selected.
  - many early rows before `2026-06-12` have null `session_date` and were grouped by `created_at` fallback; regeneration lineage must handle this explicitly.
  - recommendation rows show 100% strict-key match to evaluation rows on many later dates, while early created_at-fallback dates show 0%; recommendation dependency handling needs date/key normalization before any recommendation shadow table.
- Current gate:
  - Phase 0 is complete.
  - stop for re-approval before POC date selection, dry-run script build, shadow DDL, or any Supabase write.

## 2026-07-15 Claude ruling - Jul 8 label-regeneration POC authorized and executed

- Ruling received:
  - `/tmp/codex-web-uploads/f-YtQiA5/RULING_PHASE0_POC_AUTHORIZATION_20260715.md`
- Authorization:
  - `GO` for one-session POC on `2026-07-08`.
  - local recompute only.
  - no Supabase writes.
  - no shadow DDL.
  - full regeneration remains gated on POC review.
- Why Jul 8 was approved:
  - `2026-07-08` is a pure debit stress test:
    - `97` debit rows out of `97` eval rows.
    - all are `BEAR_PUT`.
    - raw chain coverage: `41,040` rows.
    - snapshot coverage: `76/76`.
    - clean raw span from `03:45` to `10:00 UTC`.
- Conditions added to design before POC/full run:
  - BULL_CALL carve-out:
    - Jul 8 proves BEAR_PUT only.
    - only `2026-07-09` has BULL_CALL rows (`4` rows).
    - full-regeneration verification must report those four rows individually with old-vs-new values.
  - date provenance stamping:
    - early null-`session_date` rows must carry `date_source=session_date` or `date_source=created_at_fallback`.
    - inferred-date rows must be segregatable downstream.
  - recommendation strategy split:
    - June 12+ matched evaluation rows at 100% on many dates.
    - early June 2-9 rows show 0% strict-key match.
    - `2026-06-19` appears in recommendation rows but not eval inventory and must be investigated.
  - broken-coverage fail-closed handling:
    - `2026-06-02` must refetch raw coverage successfully or be stamped `FAIL / INSUFFICIENT_RAW_DATA`.
    - `2026-06-21` has `665` eval rows but `0` chain rows and `0` snapshots; these rows are unregenerable and must be stamped fail, not dropped.
- Local POC script:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/research_label_regeneration_s1_poc.py`
  - hard-gated to `2026-07-08`.
  - calls `brain.evening_evaluator` from the S1 code path.
  - writes local artifacts only.
- POC artifacts:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/POC_2026_07_08_REPORT.txt`
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/poc_2026_07_08_old_vs_new_diff.csv`
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/poc_2026_07_08_regenerated_outcomes.jsonl`
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/poc_2026_07_08_rejected_or_unmatched.csv`
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/poc_2026_07_08_unmatched_new_outcomes.jsonl`
- POC result:
  - snapshots pulled: `76`
  - chain rows pulled: `41,040`
  - legacy eval rows pulled: `97`
  - regenerated outcomes: `97`
  - matched old/new rows: `97`
  - rejected old rows: `0`
  - unmatched regenerated rows: `0`
  - strategy counts: `BEAR_PUT 97`
  - role counts: `primary 22`, `secondary 75`
  - new `price_integrity=OK`: `97`
  - arbitrage bound `OK`: `97`
- H2 phantom collapse evidence:
  - old `sim_pnl_h2` min/max: `-27499.50 / -5138.25`
  - new `sim_pnl_h2` min/max: `-894.00 / 5611.50`
  - delta new-old min/max: `5330.00 / 33111.00`
  - largest correction:
    - legacy id `12064`, snapshot `2218`, `BEAR_PUT_BNF_56900_57900_W1000`, primary
    - old `-27499.50` -> new `5611.50`, delta `33111.00`, bound `OK`
- Current gate:
  - Jul 8 POC supports S1 BEAR_PUT debit fix under full raw coverage.
  - BULL_CALL remains unproven until the `2026-07-09` four-row carve-out is checked.
  - full 12,061-row regeneration remains gated on Vivek + Claude + Antigravity review.
  - no Supabase writes have been made.

## 2026-07-15 Claude ruling applied locally - no commit/no push

- Claude ruling received:
  - `/tmp/codex-web-uploads/f-RuKeS5/RULING_POST_CLOSE_INTEGRITY_FII_PATCH_20260715.md`
- Decisive new fact:
  - Vivek confirmed a `15-20 minute internet outage` during the July 15 session.
  - July 15 is therefore a normal mobile-network partial/retry session, not a corrupted session.
- Required label discipline from Claude:
  - `COMPLETE`: full distinct slot coverage, clean session.
  - `COMPLETE_WITH_RETRIES`: full distinct slot coverage but raw local counter drifted due retry/re-entry.
  - `PARTIAL`: missing distinct slots, usable/advisory, not promotion-clean.
  - `INTEGRITY_BROKEN`: true duplicate/snapshot overrun/final-slot duplicate/final-slot missing.
  - `PARTIAL` must not be blocked as corrupted, but must also not be promoted or summarized as `COMPLETE`.
- Local patch state after ruling:
  - `MarketWatchService.kt`
    - canonical poll number uses slot ordinal where a slot key exists.
    - same-slot dispatch marker is persisted before polling to prevent post-release re-entry.
    - session integrity counts distinct slot ordinals from `poll_history`.
    - raw counter drift maps to `COMPLETE_WITH_RETRIES`.
    - missing distinct slots map to `PARTIAL`.
    - true `SNAPSHOT_OVERRUN`, `FINAL_SLOT_DUPLICATE`, and `FINAL_SLOT_MISSING` remain `INTEGRITY_BROKEN`.
  - `NativeBridge.kt`
    - UI coverage derivation mirrors `COMPLETE` / `COMPLETE_WITH_RETRIES` / `PARTIAL` / `INTEGRITY_BROKEN`.
    - `evaluationPromotionEligible` is true only for `COMPLETE`.
    - legacy stored values `CLEAN` and `PARTIAL_COVERAGE` are normalized to `COMPLETE` and `PARTIAL`.
  - `MarketMLService.kt`
    - legacy stored values `CLEAN` and `PARTIAL_COVERAGE` are normalized before evaluation blocking checks.
    - only `INTEGRITY_BROKEN` blocks normal evaluation; `PARTIAL` remains evaluable/advisory.
  - `EvaluationLocalCache.kt`
    - per-session brain snapshot cap remains raised from `5 MB` to `64 MB`.
  - `brain.py`
    - shared market-history freshness helper added for dated `premium_history` / `fiiHistory` / `yesterdayHistory` consumers.
    - live dated context now rejects stale history outside the 1-7 day window.
    - covered paths include `fii_short_trend`, morning FII-short comparison, VIX direction, DII/FII floor comparison, FII trend insight, verdict FII 5-day sum, VIX context penalties, institutional PCR context, and session trajectory.
  - `test_phase_b.py`
    - stale/fresh FII regression tests remain.
- Supabase write-path change pulled out:
  - `SupabaseClient.kt` was reverted to pre-existing behavior.
  - `ml_poll_sequences` fallback removal is no longer part of this patch.
  - that evidence-persistence change requires separate review before shipment.
- RLS blocking answer:
  - app authenticates to Supabase as `anon`.
  - `SupabaseClient.kt` uses `BuildConfig.SUPABASE_ANON_KEY` for both `apikey` and `Authorization: Bearer <anon key>`.
  - app does not use authenticated user JWT or service-role in the client.
- Cache-trim read-only investigation from uploaded logs:
  - Uploaded logs are incomplete history, not full 30 sessions, but they show repeated trims.
  - `LOCAL_SNAPSHOT_TRIM` to 3 rows appears on July 6, 7, 10, 13, 14, and 15.
  - Sessions with post-close handoff/eval markers after trimmed local cache:
    - `2026-07-07`: trim to 3 rows; `DAY_EVAL_HANDOFF` launched; integrity was legacy `PARTIAL_COVERAGE`.
    - `2026-07-10`: trim to 3 rows; `DAY_EVAL_HANDOFF` launched; integrity was legacy `CLEAN`.
    - `2026-07-13`: trim to 3 rows; `DAY_EVAL_HANDOFF` launched; then `EVAL_FAIL[PREPARING]` due chain truncation.
    - `2026-07-14`: trim to 3 rows; `DAY_EVAL_HANDOFF` launched; then `EVAL_FAIL[PREPARING]` due chain truncation.
    - `2026-07-15`: trim to 3 rows; old app blocked on false `POLL_OVERRUN`.
  - Blast-radius boundary:
    - Supabase-side evidence is not capped by `EvaluationLocalCache`.
    - The risk is local evaluation/retry/force-eval paths that use local trimmed JSONL evidence.
    - Any trusted local evaluation from a trimmed-cache session must be flagged suspect and, if needed, rerun from Supabase evidence.
- Verification after ruling patch:
  - `python3 app/src/main/python/tests/test_phase_b.py` passed `50/50`.
  - Android test/build still blocked locally because this Codex environment has no Android SDK (`ANDROID_HOME`/`sdk.dir` missing).
- Push/release status:
  - no commit.
  - no push.
  - no version bump.
  - no release/OTA.
- Post-ruling user observation:
  - Vivek tried Force Eval on the currently installed phone app (`v2.5.1 / b332`).
  - Force Eval did not complete/work.
  - This is consistent with the already-known installed-build limitations:
    - local cache had been trimmed to only 3 rows on b332.
    - b332 still has old integrity/cache behavior because local fixes are not installed.
    - previous uploaded logs show some eval paths also fail on chain preparation/page-cap errors.
  - Classification: do not treat the failed Force Eval as new strategy evidence; treat it as further confirmation that July 15 local evaluation should not be trusted and must be rerun from Supabase/server evidence if needed.

## 2026-07-15 post-close audit - poll overrun false blocker and local after-hours patch

- App build observed after close:
  - `v2.5.1 / b332`
  - session UI: `Session complete · polls 76/76 slots · Next 16 Jul, 9:15 am`
  - ML status UI: `Day evaluation: INCOMPLETE_SESSION`
  - blocker text: `Session integrity is broken (POLL_OVERRUN). Normal teacher evaluation is blocked for this session. Force evaluation is available for advisory-only analysis. This session is excluded from promotion gates.`
- Uploaded post-close log:
  - `/tmp/codex-web-uploads/f-GzaCX1/marketapp-logs-2026-07-15T10-09-05-445Z.csv`
  - 610 rows, visible window `15:10:05` to `15:38:08 IST`.
- Evidence from log:
  - `SESSION_INTEGRITY: date=2026-07-15 coverage=INTEGRITY_BROKEN issue=POLL_OVERRUN pollCount=77/76 finalSlotOccurrences=1 snapshots=3`
  - `POST_CLOSE_EVAL_BLOCKED: date=2026-07-15 issue=POLL_OVERRUN`
  - Local cache was repeatedly trimmed to only 3 rows:
    - `LOCAL_SNAPSHOT_TRIM: date=2026-07-15 rows=3 bytes=4512099 rowCap=90 byteCap=5242880`
  - Duplicate poll starts were present for the same late-session slots:
    - slot `2026-07-15|72` started twice as `Poll #73`
    - slot `2026-07-15|73` started twice as `Poll #74`
    - slot `2026-07-15|74` started twice as `Poll #75`
    - slot `2026-07-15|75` started twice as `Poll #76`
    - slot `2026-07-15|76` started twice as `Poll #77`
  - The dedup marker appeared, but after the first `performPoll()` returned, another trigger could still enter the same slot.
- Read-only Supabase audit after close:
  - `ml_brain_snapshots`: 71 rows for `2026-07-15`, no duplicate `(session_date,poll_ts)` rows.
  - `ab_week1_decisions`: 70 rows for `2026-07-15`, no duplicate slots.
  - `ml_generated_candidates`: 1300 rows for `2026-07-15`.
  - `ml_evaluation_outcomes`: 0 rows for `2026-07-15`.
  - `ml_recommendation_outcomes`: 0 rows for `2026-07-15`.
  - Snapshot timeline had gaps, including `10:00 -> 10:10 IST` and a later app/interruption gap around `14:15 -> 14:40 IST`.
  - Classification after Claude ruling:
  - S1 price-integrity tables remain clean; outcome null-price fields remain `0`.
  - The `POLL_OVERRUN` blocker is not evidence of duplicated Supabase final-slot rows.
  - Confirmed root cause includes a `15-20 minute internet outage`; the session is partial/retry affected, not corrupted.
  - Root cause is local evidence/session accounting:
    - raw `poll_count` increments via reservation/counter drift instead of canonical slot identity.
    - same slot can still execute again after the previous in-flight key is released.
    - local evaluation cache byte cap `5 MB` is too small for full-day brain snapshots and leaves only 3 local rows.
  - This is a correctness/evidence-integrity defect, not a strategy/ranking change.
- Local after-hours code patch made in `Marketapp-main-worktree` only; not committed and not pushed:
  - `MarketWatchService.kt`
    - canonical poll number now comes from slot ordinal (`09:15=1 ... 15:30=76`) when a slot key exists.
    - dispatch dedup now records `LAST_POLL_DISPATCH_SLOT_KEY` before polling so the same slot cannot re-enter after a prior trigger finishes.
    - session integrity now uses distinct slot ordinals from `poll_history` rather than raw `poll_count`.
    - raw counter drift above expected full-day slots becomes `COUNTER_DRIFT`, not fatal `POLL_OVERRUN`, while true `FINAL_SLOT_DUPLICATE`, `FINAL_SLOT_MISSING`, and `SNAPSHOT_OVERRUN` remain hard integrity blockers.
  - `NativeBridge.kt`
    - UI-side derived integrity issue now mirrors distinct-slot logic and `COUNTER_DRIFT`.
  - `EvaluationLocalCache.kt`
    - per-session brain snapshot cache cap raised from `5 MB` to `64 MB` so full-day local evidence is not trimmed to 3 rows.
  - `SupabaseClient.kt`
    - initial fallback cleanup was pulled out after Claude ruling and reverted locally.
    - `ml_poll_sequences` write/read cleanup remains a separate-review item, not part of this patch.
  - `brain.py`
    - market-history consumers now enforce freshness when live context contains `today_ist/session_date`.
    - dated historical rows must be within 1 to 7 days; stale April values cannot drive July trend labels, morning votes, session trajectory, or context penalties.
  - `test_phase_b.py`
    - added regression coverage for stale FII short history and fresh dated history.
- Verification:
  - `python3 app/src/main/python/tests/test_phase_b.py` passed `50/50`.
  - Android Gradle verification was attempted with `./gradlew testDebugUnitTest` but blocked by environment:
    - `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in local.properties.`
- Push/release status:
  - no commit.
  - no push.
  - no version bump.
  - no release/OTA triggered.

## 2026-07-15 live observation - FII short trend freshness defect

- During live market observation on `v2.5.1 / b332`, Vivek flagged the OI tab `FII Short% Trend` display:
  - UI showed `Building (81.0 -> 92.0) - bearish / AGGRESSIVE`.
  - Concern: `81.0` was from many days before and should not be treated as a current 3-session trend.
- Read-only Supabase verification confirmed the concern:
  - today's latest `ml_brain_snapshots.context_json.morning_input.fiiShortPct` was `92`.
  - `premium_history` latest row was `2026-06-29`, but `fii_short_pct` was `null`.
  - latest non-null `premium_history.fii_short_pct` was `81` from `2026-04-28`.
  - `chain_snapshots` recent rows also did not provide a current FII-short% history source.
- Code path inspected:
  - `Marketapp-main-worktree/app/src/main/python/brain.py`
    - `fii_short_trend(ctx)` reads current `morning_input.fiiShortPct`.
    - then reads `ctx.yesterdayHistory[:2]` and accepts any non-null `fii_short_pct`.
    - it does not enforce date freshness.
  - `Marketapp-main-worktree/app/src/main/java/com/marketradar/app/MarketWatchService.kt`
    - passes raw `premium_history` into `ctxObj.yesterdayHistory`.
- Defect classification:
  - market-context integrity bug.
  - not an S1 price-integrity issue.
  - not a live execution bug.
  - can falsely create bearish/bullish institutional evidence from stale FII short history.
- Expected safe behavior:
  - if recent valid FII short history is unavailable, do not emit `BUILDING`, `COVERING`, `INFLECTION`, or `AGGRESSIVE`.
  - show/record a stale-history or unavailable state instead.
- After-hours fix direction:
  - add date freshness guard in `fii_short_trend(ctx)`.
  - only use historical rows with valid `date` and non-null `fii_short_pct`.
  - reject stale rows older than a small freshness window, e.g. 7 calendar/trading days.
  - if insufficient fresh history remains, return `None` or explicit stale/unavailable metadata.
  - add regression tests proving old April values cannot drive a July trend.
- Status:
  - no code changed during market hours.
  - after-hours FII freshness fix is local and uncommitted.
  - `ml_poll_sequences` brain-snapshot fallback cleanup is held for separate review.

## 2026-07-15 live observation - brain snapshot fallback mismatch

- Morning read-only log/Supabase audit found one evidence gap around `10:05 IST`.
- Log marker:
  - `ML_BRAIN_SNAPSHOT_SAVE_FAIL`
  - fallback table `ml_poll_sequences`
  - error: missing `action` column.
- Production schema probe:
  - `ml_brain_snapshots` has the expected brain snapshot columns.
  - `ml_poll_sequences` is empty/incompatible and lacks most current snapshot payload columns.
- Supabase timeline confirmed:
  - `ml_brain_snapshots` had a gap from `10:00 IST` to `10:10 IST`.
  - later snapshots resumed successfully.
- Defect classification:
  - replay/evidence-integrity defect.
  - not an S1 price-integrity issue.
  - not a direct trading-action defect.
- After-hours fix direction:
  - stop treating `ml_poll_sequences` as equivalent fallback for brain snapshot writes/reads.
  - keep `ml_brain_snapshots` canonical.
  - improve failure logging so first-table failure details are visible.
- Status:
  - no code changed during market hours.

## 2026-07-15 live read-only state after S1 release

- App build observed:
  - `v2.5.1 / b332`
- Read-only Supabase state during live session:
  - `ml_brain_snapshots`: active and saving current session rows.
  - `ab_week1_decisions`: active and saving A/B shadow rows.
  - `ml_generated_candidates`: active and saving generated candidate rows.
  - `ml_evaluation_outcomes`: no same-day rows before post-close, expected.
  - `ml_recommendation_outcomes`: no same-day rows before post-close, expected.
- S1 production confirmation:
  - all-time `price_integrity is null` counts were `0` in both outcome tables after the applied historical backfill.
  - final confirmation still depends on fresh post-close outcome rows from the S1-patched app.
- During the inspected live window:
  - all brain snapshot actions were `WAIT`.
  - A/B rows showed old actor frequently would have traded while new S1/A8 gate waited.
  - generated candidates were present but rejected/not surfaced.
- Working rule for rest of market session:
  - read-only checks are allowed.
  - no app code/schema/ranker/sandbox/LLM changes until after market close unless there is an explicit safety emergency.

## 2026-07-14 S1 merge-readiness blocker resolution - local

- Claude reviewed `S1_MERGE_READINESS_PACKAGE_20260714` and blocked merge on three items:
  - historical `price_integrity` backfill
  - triage of three red tests
  - live blast-radius confirmation for `p_ml` / `mlEdge` / OOD/UNSURE
- Local blocker-resolution handoff created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/S1_MERGE_BLOCKER_RESOLUTION_20260714.txt`
- No push/release/OTA was performed.

### Backfill blocker

- Updated local migration:
  - `Marketapp-main-worktree/supabase/migrations/20260714_s1_h2_price_integrity.sql`
- Added historical quarantine backfill:
  - `price_integrity = 'LEGACY_PRE_S1'`
  - `h2_price_integrity_reason = 'COMPUTED_WITH_BROKEN_DEBIT_RULER'`
  - applies to rows where `price_integrity is null`
- Production status:
  - Supabase schema DDL was already applied and verified earlier.
  - Historical backfill DML is prepared locally but **not yet applied**.
  - This is a data update, so it requires explicit user approval before execution.

### Red-test triage

- Re-ran the three Claude-blocking tests individually and fixed root causes.
- `test_d1_12e_debit_candidate_uses_buy_ask_and_sell_bid`:
  - failure was a stale test call to `_build_candidate()` missing the current `atm` argument.
  - classification: test bug, not production debit pricing bug.
  - fixed test call; confirms debit candidate still uses buy ask and sell bid.
- `test_d1_23_missing_chain_data`:
  - failure was production code returning a degraded pure-intrinsic fallback valuation when zero required legs were quoted.
  - classification: code bug / unsafe missing-data behavior.
  - fixed `compute_position_live()` to fail closed when `legs_required > 0` and `legs_quoted == 0`.
  - new log marker:
    - `POSITION_VALUATION_FAIL_CLOSED: trade=<id> quoted=0/<n> reason=missing_required_chain_quotes`
- `test_ic_rejects_far_wall_strike_anchor`:
  - failure was a stale test assumption that `generate_candidates()` returns a flat list.
  - current function returns `(candidates, rejected_candidates)`.
  - classification: test bug.
  - fixed test to unpack the tuple.

### Test results after blocker fixes

- Blocking tests:
  - `Ran 3 tests`
  - `OK`
- Full `test_phase_d` module:
  - `Ran 82 tests`
  - `OK`
- Full `test_explanation_agent` module:
  - `Ran 9 tests`
  - `OK`
- S1 focused tests:
  - `Ran 9 tests`
  - `OK`
- Full Python test discovery:
  - command: `python -m unittest discover app/src/main/python/tests`
  - `Ran 156 tests in 0.312s`
  - `OK`
  - non-failing warning printed: `GEMINI_API_KEY environment variable not set`

### p_ml / mlEdge / OOD blast-radius confirmation

- Current live Python ranking path uses `p_ml` as terminal tie-break only.
- Evidence:
  - `brain.py:7926` defines `rank_candidates(...)`.
  - `brain.py:7934-7972` applies deterministic sort terms before ML:
    - direction safety
    - varsity tier
    - teacher rank/score/sample size
    - brain verdict alignment
    - calibration win rate
    - force alignment/against
    - context score
    - gamma risk
    - wall score
    - premium edge
    - probability
  - `brain.py:7973-7978` explicitly treats ML as tiebreaker and zeroes `p_ml` when `mlUnsure`, `mlAction == 'UNSURE'`, or weak OOD confidence.
  - `brain.py:7980+` places `-p_ml` last in the sort tuple.
  - `rank_candidates()` filters only `capitalBlocked`, not `p_ml`, `mlEdge`, `mlOodBlocked`, or `mlAction`.
  - `brain.py:8627-8685` ML enriches already-generated candidates and then recomputes ranking; UNSURE changes decision source/reason to fallback but does not reject.
  - `ml_engine.py:1222-1233` may output `BLOCKED`/`UNSURE`/`WATCH`, but caller does not use those as hard candidate gates in `rank_candidates()`.
  - Kotlin paths `MarketWatchService.kt:2559-2570` and `NativeBridge.kt:674-688` copy ML fields into JSON; no filter found there on `mlEdge`, `mlOodBlocked`, or `mlAction`.
- Interpretation:
  - live blast radius is small in current code.
  - research blast radius remains large.
  - p_ml-first research and O3-G2 branch evidence remain void until clean label regeneration, clean retrain, and re-validation.

## 2026-07-14 S1 Supabase migration applied

- Approved by user and applied the S1 price-integrity Supabase migration with throttling discipline:
  - no bulk table scans
  - no historical data pull
  - only one DDL migration call and two small catalog verification reads
- Migration file applied from local app worktree:
  - `Marketapp-main-worktree/supabase/migrations/20260714_s1_h2_price_integrity.sql`
- Supabase CLI path used:
  - authenticated with project PAT
  - linked project ref `fdynxkfxohbnlvayouje`
  - ran `supabase db query --linked --file supabase/migrations/20260714_s1_h2_price_integrity.sql`
- Migration execution result:
  - success
  - no data rows returned
  - no bulk data read/write beyond schema DDL
- Verified new columns exist on both outcome tables:
  - `public.ml_evaluation_outcomes`
  - `public.ml_recommendation_outcomes`
- Verified columns on both tables:
  - `price_integrity text`
  - `h2_price_integrity_reason text`
  - `h2_later_value_points numeric`
  - `h2_entry_basis_points numeric`
  - `h2_bound_width_points numeric`
  - `h2_formula text`
- Verified indexes exist:
  - `idx_ml_eval_outcomes_price_integrity`
  - `idx_ml_reco_outcomes_price_integrity`
- Removed local `supabase/.temp/` CLI link metadata after applying migration so it does not become an accidental untracked repo artifact.
- Remaining Claude gate:
  - after S1-patched app/build writes fresh rows, confirm `price_integrity` is non-null on new `ml_evaluation_outcomes` / `ml_recommendation_outcomes` rows.
  - Until fresh post-migration rows exist, this final production confirmation is pending, not failed.
- Push/release status:
  - no push
  - no release
  - no OTA

## 2026-07-14 S1 verification result - Week-1 ruler audit

- Claude's Week-1 consolidated verdict was accepted as binding input:
  - Week-1 verdict: `VACUOUS`
  - valid window: Days 2-6 only (`2026-07-08`, `2026-07-09`, `2026-07-10`, `2026-07-13`, `2026-07-14`)
  - freeze lifted only for Track B
  - S1 verification blocks all build/code/CHANGE-2/sandbox/ranker/LLM work until complete
- S1 read-only verification completed locally on `2026-07-14`.
- Handoff/result artifact created outside git:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/S1_VERIFICATION_RESULT_20260714.txt`
- No app code was changed.
- No Supabase writes were made.
- No push was made.

### S1 verdict

- S1 is confirmed: the Week-1 legacy H2/evaluation ruler is broken for debit spreads.
- The reproduced mechanism is debit-spread sign inversion in the legacy H2 evaluator, not primarily expiry contamination in the checked rows.
- Active frozen source inspected:
  - `Marketapp-main-worktree/app/src/main/python/brain.py`
  - SHA-256 `dfabf17f7515b04a58f84702b93007ac2cede1999470088934b7ef5e40840772`
- Problem source:
  - `_eval_single_candidate()` computes `later_net_credit = sell_ltp_h2 - buy_ltp_h2` for all two-leg structures.
  - For debit spreads (`BEAR_PUT`, `BULL_CALL`), correct later value is `buy_ltp_h2 - sell_ltp_h2`.
  - Current debit path then applies `(later_net_credit - entry_premium) * lot_size`, producing impossible negative spread values and phantom losses.
- Teacher managed-exit path is structurally closer to correct:
  - `_teacher_execution_basis()` separates credit and debit basis correctly.
  - Still, S1 should unify valuation to avoid future divergence.

### S1 evidence

- Local evidence directory:
  - `research_cache/s1_verification_20260714/`
- Data pulled read-only:
  - 132 `ml_evaluation_outcomes` rows for Days 2-6
  - 29 matching source `ml_brain_snapshots`
  - 54 unique relevant option legs
  - 4,085 relevant option-chain rows
- Arbitrage-bound audit:
  - matched candidates: `132 / 132`
  - checked rows: `118`
  - insufficient rows: `14`
  - physical-bound violations: `116`
  - violations by strategy: `BEAR_PUT = 112`, `BULL_CALL = 4`
  - violations by credit/debit: `debit = 116`
  - worst reconstructed later spread value: `-551.85`
- Expiry multiplicity audit:
  - relevant leg keys checked: `54`
  - keys with multiple expiries: `0`
- Candidate expiry sample:
  - samples: `60`
  - candidate expiry populated: `60`
  - candidate expiry missing: `0`
- Day-2 exact-expiry recompute:
  - Day-2 eval rows: `97`
  - recomputed rows: `87`
  - recorded legacy H2 on recomputed rows: `0 wins / 87 losses / -14827.6034 mean P&L`
  - corrected debit-sign exact-expiry result: `38 wins / 49 losses / +71.0316 mean P&L`
  - corrected arbitrage-bound violations: `0`

### S1 fix direction

- Implement a narrow evaluator/ruler fix before CHANGE-2, sandbox wiring, LLM observer wiring, or ranking changes.
- Required behavior:
  - unified structure valuation helper
  - strict expiry match; missing candidate/leg expiry fails closed
  - missing or non-positive leg price fails closed
  - `price_integrity` persisted/reported
  - vertical bound guard: `0 <= spread_value <= width`
  - correct credit formula: `(entry_credit - close_cost) * lot`
  - correct debit formula: `(close_value - entry_debit) * lot`
  - conservative bounded guard for four-leg structures
  - re-score Days 2-6 after fix
- Authorized sequence remains:
  - `S1 fix -> B1 -> CHANGE-2 -> B2 -> B3 -> B4 sandbox -> B5 LLM observer -> B6 live-exit unification -> S7 lineage rider`

## 2026-07-14 S1 implementation - local unpushed

- Proceeded with narrow S1 evaluator/ruler fix only.
- No push was made.
- App code modified locally in `Marketapp-main-worktree`.
- Files changed:
  - `app/src/main/python/brain.py`
  - `app/src/main/python/tests/test_teacher_v1_shadow_labels.py`
  - `app/src/main/java/com/marketradar/app/SupabaseClient.kt`
  - `supabase/migrations/20260714_s1_h2_price_integrity.sql`
- Core fix:
  - legacy H2 now uses a unified structure valuation helper instead of hardcoding `sell - buy` for every structure.
  - debit spreads now use `long/buy - short/sell`.
  - credit spreads continue to use `short/sell - long/buy` as close-cost basis.
  - H2 result carries `price_integrity`, `h2_price_integrity_reason`, `h2_later_value_points`, `h2_entry_basis_points`, `h2_bound_width_points`, and `h2_formula`.
- Safety guards added:
  - H2 price lookup now requires candidate expiry.
  - option-chain row expiry must exactly match candidate expiry.
  - missing/non-positive H2 leg price fails closed.
  - vertical structure value must satisfy `0 <= value <= width`.
  - teacher path candidate walk now also refuses missing/mismatched expiry rows.
- Persistence:
  - Android Supabase payload includes the new integrity fields on the first write attempt.
  - fallback stripping includes those fields so post-close save does not fail if Supabase has not yet been migrated.
  - idempotent migration added for `ml_evaluation_outcomes` and `ml_recommendation_outcomes` integrity columns/indexes.
- Regression tests added:
  - S1 debit vertical test reproduces `BEAR_PUT_NF_23450_23850_W400` style case:
    - corrected later value: `121.4`
    - entry debit: `125.5`
    - corrected H2 P&L: `-266.5`, not the phantom `-15710.5`
  - strict-expiry test confirms wrong-expiry H2 rows are rejected instead of cross-matched.
- Verification:
  - `python -m unittest app/src/main/python/tests/test_teacher_v1_shadow_labels.py` passed: `7 tests`.
  - `python -m py_compile app/src/main/python/brain.py` passed.
  - `./gradlew :app:compileDebugKotlin` could not run Kotlin compilation because the workspace lacks Android SDK configuration:
    - missing `ANDROID_HOME` or `local.properties` `sdk.dir`
    - failure occurred before Kotlin compilation
  - full Python discovery still has unrelated pre-existing failures:
    - `test_explanation_agent.ExplanationAuditAgentTests.test_ic_rejects_far_wall_strike_anchor`
    - `test_phase_d.TestPhaseD.test_d1_12e_debit_candidate_uses_buy_ask_and_sell_bid`
    - `test_phase_d.TestPhaseD.test_d1_23_missing_chain_data`
- Next required before CHANGE-2:
  - run/apply Supabase migration or accept fallback stripping until migration is applied.
  - run post-fix Days 2-6 re-score to generate corrected Week-1 verdict evidence.

### S1 local re-score result

- Local re-score was completed from existing cached JSON only; Supabase was not touched again.
- Re-score artifact:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/research_cache/s1_verification_20260714/s1_post_fix_days2_6_rescore.json`
- Downloadable implementation/result packet:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/S1_IMPLEMENTATION_AND_RESCORE_RESULT_20260714.txt`
- Coverage:
  - snapshots: `29`
  - option-chain rows: `4085`
  - old rows: `132`
  - new rows: `132`
  - matched rows: `132`
  - missing after re-score: `0`
  - errors: `0`
  - price integrity: `OK = 132`
- Old legacy H2 on matched rows:
  - count: `132`
  - wins: `2`
  - losses: `130`
  - mean P&L: `-13684.7330`
- Corrected S1 H2 on matched rows:
  - count: `132`
  - wins: `85`
  - losses: `47`
  - mean P&L: `+992.7557`
- By-day corrected result:
  - `2026-07-08`: `54 / 97` wins, mean `+735.4175`
  - `2026-07-09`: `0 / 4` wins, mean `-1981.6875`
  - `2026-07-13`: `2 / 2` wins, mean `+46.5`
  - `2026-07-14`: `29 / 29` wins, mean `+2329.0345`
- Interpretation:
  - S1 materially reverses the H2 label base.
  - The original Week-1 verdict remains valid as an assessment of the old broken ruler.
  - A corrected Week-1 verdict packet must be generated after the S1 patch is accepted/applied.

## 2026-07-14 S1 implementation review response

- Claude reviewed `S1_IMPLEMENTATION_AND_RESCORE_RESULT_20260714`.
- Verdict from Claude:
  - core S1 fix is correct and approved for merge after one latent bug/fallback issue is fixed.
  - result is a repaired ruler, not proof of strategy edge.
  - Week-1 verdict remains `VACUOUS`.
- Local review-response artifact:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/S1_REVIEW_RESPONSE_20260714.txt`

### Review corrections applied

- `_candidate_entry_premium` fallback fixed:
  - removed `maxProfit / lot` fallback.
  - missing `netPremium` now fails closed with `MISSING_ENTRY_PREMIUM_OR_INVALID_LOT`.
  - reason: `maxProfit / lot` is valid for credit entry but wrong for debit entry.
- `_structure_value_bound` fallback fixed:
  - removed fallback to `maxLoss` / `maxProfit` for incomplete four-leg structures.
  - incomplete/ambiguous bound now returns `None` and H2 fails closed.
  - reason: `maxLoss` / `maxProfit` are currency quantities, while spread bounds are points-domain quantities.
- Kotlin fallback visibility added:
  - if Supabase persistence falls back to stripped rows, app logs:
    - `S1_PRICE_INTEGRITY_FALLBACK_STRIPPED`
  - warning includes table, fallback mode, row count, and `migration_required_before_release`.
  - production requirement remains: run migration before release; fallback rows must not be accepted as production-normal.

### p_ml training answer

- `p_ml` training path can consume `outcome_h2` / `won`.
- Source:
  - `app/src/main/python/ml_train.py`
- Evidence:
  - `_row_label_value(row)` reads `canonical_won`, then `outcome_h2`, then `won`.
  - `_load_canonical_eval_rows(...)` loads evaluator-backed primary rows.
  - `_snapshot_candidate_to_row(...)` converts evaluator rows into training rows using `sim_pnl_h2` / resolved labels.
  - evaluator-backed rows have `EVAL_OUTCOME_WEIGHT = 4`.
- Current caveat:
  - `run()` currently exits early with `RETRAIN_DISABLED_REASON = retrain_disabled_pending_canonical_won_unification`.
  - So current nightly retraining is disabled in this source.
- Operational decision:
  - treat deployed `p_ml` provenance as suspect unless independently proven clean.
  - retrain only after corrected S1 label-base regeneration.

### Post-review verification

- Focused tests:
  - `python -m unittest app/src/main/python/tests/test_teacher_v1_shadow_labels.py`
  - result: `9 tests`, `OK`
- Python compile:
  - `python -m py_compile app/src/main/python/brain.py`
  - result: OK
- Kotlin compile remains blocked locally due missing Android SDK configuration:
  - missing `ANDROID_HOME` or `local.properties sdk.dir`
- Post-review cached Days 2-6 re-score:
  - artifact: `research_cache/s1_verification_20260714/s1_post_review_rescore.json`
  - matched rows: `132`
  - price integrity: `OK = 132`
  - old H2: `2 wins / 130 losses`, mean `-13684.7330`
  - corrected S1 H2: `85 wins / 47 losses`, mean `+992.7557`
  - unchanged from prior S1 re-score because all matched rows had `netPremium` and complete bounds.

## 2026-07-10 Day-4 post-close window and freeze-base verification

- Claude requested a read-only window legitimacy and freeze-base audit.
- Response artifact created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_WINDOW_AND_FREEZE_BASE_REPLY_20260710.txt`
- Vivek accepted the corrected freeze base on `2026-07-10`.
- Local docs-only commit created in `MarketVivi` after acceptance:
  - `5ff06582156802f2c4a9e14a8b02488d52c66b21` - `Record Day 4 freeze verification`
- Local freeze tags created; no push was done:
  - tag name: `freeze-week1-b331`
  - `Marketapp` tag object: `689a070ab9c1f0da3cc45c4767f74399eef3bf33`
  - `Marketapp` tag target: `c8f7b4534696ca18eb020511be7ab8d3eca19d09`
  - `MarketVivi` tag object: `ed8a0c3a633c417f9d3cc06bbfbb645b4d0d2ca8`
  - `MarketVivi` tag target: `dc42e25b221d9fb3033ef675ae49ba9f7803a05b`
- Important tagging note:
  - `MarketVivi` has docs-only commits after the freeze target.
  - The freeze tag intentionally points at accepted runtime/documentation base `dc42e25`, not the later project-knowledge commit.
- Active Week-1 A/B verdict window is confirmed as Days 2-6:
  - Day 2: `2026-07-08`
  - Day 3: `2026-07-09`
  - Day 4: `2026-07-10`
  - Day 5: `2026-07-13`
  - Day 6: `2026-07-14`
- The original `2026-07-06` directive said `5 sessions`; the active amendment is the `2026-07-07` re-anchor plus `2026-07-08` roadmap, which explicitly defines Days 2-6 and the Tue Jul 14 verdict letter.
- `HANDOFF_MARKET_RADAR_20260708` was not found locally or in uploaded files; the available roadmap source is `DIRECTIVE_OC_MASTER_ROADMAP_TO_SATURDAY_20260708.md`.

### Day-4 K3 arithmetic

- Date checked: `2026-07-10`.
- Persisted A/B rows:
  - max poll number: `75`
  - expected rows: `75 - 2 = 73`
  - actual distinct poll numbers: `73`
  - actual A/B rows: `73`
  - rows minus expected: `0`
  - poll numbers persisted contiguously from `3` through `75`
  - first A/B poll: `2026-07-10T09:25:00+0530`
  - last A/B poll: `2026-07-10T15:30:00+0530`
- Morning check was partial-day only:
  - `ab_rows=16`
  - `max_ab_poll_number=18`
- Device UI showed `76/76`, but persisted A/B max poll number is `75`; logcat showed duplicate final `Poll #76` start/complete and duplicate `15:30` `BUILD3_AB_SAVE` lines. Supabase retained one final `15:30` row by upsert, so K3 is clean by persisted logger formula.

### Day-4 zero-evaluable close

- Supabase post-close result:
  - `ml_evaluation_outcomes`: `0`
  - `ml_recommendation_outcomes`: `0`
  - `ab_week1_decisions`: `73`
  - gate distribution: `ALL_NEGATIVE_EV = 73`
  - lane pair: `BNF_intraday -> __null__ = 73`
- Day 4 is a true zero-evaluable session, not a save failure.
- The earlier UI issue remains classified as local reporting/state noise:
  - zero-evaluable session is correctly terminal, but `repairStaleResearchStateIfNeeded()` can flip `DONE -> FAILED_RESEARCH` when no teacher report file exists.
  - This needs a later reporting-path fix, not a Week-1 logic change.

### Freeze-base status

- Freeze-base tag is blocked right now.
- Expected SHAs from Claude's query do not match current local `main` heads:
  - `Marketapp` expected `5a59992dd0fdec208a49b224ddf26d61b3980fb5`
  - `Marketapp` actual `c8f7b4534696ca18eb020511be7ab8d3eca19d09`
  - `MarketVivi` expected `0db3a5e3b9dd0e757d747b7e886b21aff8687a60`
  - `MarketVivi` actual `dc42e25b221d9fb3033ef675ae49ba9f7803a05b`
- Commits after the expected `Marketapp` SHA:
  - `d9181b8cbcaa0c908d05ea769d4a27d2c63740b2` - `Fix BUILD 3 wait wording and AB RLS policy`
  - `c8f7b4534696ca18eb020511be7ab8d3eca19d09` - `Update debug validation for BUILD 3 gate`
- Commits after the expected `MarketVivi` SHA:
  - `217c7a4b6079037bd918653e23fad882aef85eac` - `Record v2.5.0 synchronized release`
  - `1f4eb72e1c22174bef9efc98c210038a4337e87d` - `Update project knowledge after BUILD 3 hotfix`
  - `daec61ec010d8c4a488f61c2fbeb5241ffe56b59` - `Update project knowledge after BUILD 3 CI fix`
  - `dc42e25b221d9fb3033ef675ae49ba9f7803a05b` - `Record BUILD 3 CI hotfix validation`
- Worktree cleanliness:
  - `Marketapp-main-worktree`: clean
  - `MarketVivi-git`: dirty due to local `PROJECT_KNOWLEDGE.md`
- Do not tag until Claude/Vivek explicitly accept the actual heads as the new freeze base and the worktree is clean.

### Freeze constants confirmed

- `brain.py`:
  - SHA-256: `dfabf17f7515b04a58f84702b93007ac2cede1999470088934b7ef5e40840772`
  - line count: `11608`
  - `BRAIN_VERSION = "2.5.0"`
  - `BUILD3_EV_FLOOR_MULT = 1.10`
  - `BUILD3_CALM_RANGE_SIGMA_MAX = 0.30`
  - `IV_HIGH = 20`
- Android:
  - `versionCode = 331`
  - `versionName = "2.5.0"`
- PWA:
  - visible label `v2.5.0 · b331`
  - cache-bust `app.js?v=1249`
- Live persisted threshold payload matched source:
  - `{"iv_high":20,"ev_floor_mult":1.1,"calm_range_sigma_max":0.3}`

### Teacher config version caveat

- Local cached `ml_evaluation_outcomes` extraction for `2026-06-12` through `2026-07-09` showed `teacher_config_version = null` on all cached rows.
- Offline replay studies should not claim config-version stratification from that column.
- R-unit segregation must be justified from other known source/version boundaries or rerun after explicit teacher config stamping exists.

### Current lot-size verification

- Lot-size question checked on `2026-07-10`.
- Current external-source consensus for 2026 index derivatives:
  - Nifty 50: `65`
  - Bank Nifty: `30`
- Sources checked:
  - NSE product/spec pages state that the latest applicable lot size is governed by the current `NSE_FO_contract_ddmmyyyy.csv.gz` contract file and reference NSE circulars.
  - Upstox / broker update pages and current F&O lot-size trackers report the 2026 revision as:
    - Nifty 50 `75 -> 65`
    - Bank Nifty `35 -> 30`
- Operational interpretation:
  - For current July 2026 Nifty/BankNifty option contracts, use `NF lot = 65`, `BNF lot = 30`.
  - The app must not hard-code old lot-size assumptions in future sizing/margin work.
  - Final authority for automated runtime sizing should be the broker/NSE instrument contract metadata, not a static value in code.

## 2026-07-10 Day-4 morning check and offline replay validation

### Day-4 morning lock/scan telemetry

- Morning read-only Supabase check was run using:
  - `SUPABASE_QUERY_DAY4_MORNING_LOCK_SCAN_20260710.txt`
- Result for `session_date = 2026-07-10`:
  - `snapshot_rows_today = 18`
  - latest snapshot id `2377`
  - latest poll `10:40 IST`
  - latest action `WAIT`
  - latest generated count `0`
  - latest watchlist count `0`
  - latest rejected count `20`
  - latest rejected full count `320`
- A/B integrity result:
  - `ab_rows = 16`
  - `expected_ab_rows = 16`
  - `ab_rows_minus_expected = 0`
  - no K3 / RLS / write-gap issue in the morning path
- BUILD 3 gate telemetry result:
  - `picks_differ_rows = 16`
  - `old_would_have_taken_rows = 16`
  - `old_pick_rows = 16`
  - `new_pick_rows = 0`
  - gate reason distribution: `{"ALL_NEGATIVE_EV":16}`
  - old lane distribution: `{"BNF_intraday":16}`
  - new lane distribution: `{"NONE":16}`
- Operational conclusion:
  - BUILD 3 old-vs-new logger is healthy
  - warm-up accounting is exact
  - morning BUILD 3 behavior is forced `WAIT` because all new-arm candidates are below the frozen EV floor

### Safe Supabase research architecture established

- Manual Supabase SQL editor research was too slow and fragile for nested JSON mining.
- New local-only extractor was created outside app code:
  - `research_supabase_profit_attribution_extract.py`
- Safety properties:
  - read-only Supabase REST
  - no writes
  - rate-limited paging
  - retries/backoff
  - day-by-day snapshot fetch
  - local JSONL cache so repeated analysis does not re-hit Supabase
- Full extraction completed for:
  - `2026-06-12` through `2026-07-09`
- Cached locally:
  - `ml_evaluation_outcomes`: `5,853` rows
  - `ml_brain_snapshots`: `1,502` rows
- Output artifacts:
  - `research_cache/profit_attribution_20260612_20260709/raw/`
  - `research_cache/profit_attribution_20260612_20260709/primary_vs_best_feature_matrix.csv`
  - `research_cache/profit_attribution_20260612_20260709/summary.json`
  - `LOCAL_PROFIT_ATTRIBUTION_FULL_WINDOW_ANALYSIS_20260709.txt`
  - `LOCAL_BRANCH_CLUSTER_ANALYSIS_20260709.txt`
  - `OFFLINE_PROFIT_CANDIDATE_ATTRIBUTION_STUDY_20260709.txt`

### Structural finding from full-window offline attribution study

- Across the full local extraction, the best later-performing candidate was already being generated.
- Failure point is downstream of generation:
  - generated but not watchlisted: `271`
  - watchlisted but not top: `218`
- Full miss-matrix scope:
  - `489` primary-vs-best miss rows
  - `11` trading days
  - average best-vs-primary uplift about `+1321.99`
- Gap mix:
  - `STRATEGY_FAMILY_GAP = 249`
  - `WIDTH_GAP = 237`
  - `SAME_FAMILY_OTHER_GAP = 3`
- Directional implication:
  - generator is not the main failure
  - surfacing and final ranking are the main failure points

### Claude survivorship challenge closed with full-menu replay

- Claude correctly challenged the winner-only study as vulnerable to survivorship bias.
- Local full-menu replay was built to answer that challenge:
  - script: `research_full_menu_ranker_replay.py`
  - output CSV: `research_cache/profit_attribution_20260612_20260709/full_menu_ranker_replay.csv`
  - output summary: `research_cache/profit_attribution_20260612_20260709/full_menu_ranker_replay_summary.json`
  - text report: `FULL_MENU_RANKER_REPLAY_20260710.txt`
- Replay method:
  - no new Supabase calls
  - uses cached raw data only
  - compares actual primary pick vs alternate top-1 chosen from the full generated menu using ex-ante generated-candidate fields
- Main alternate tested:
  - `ml_edge_first_ready`
  - ordering:
    - `mlEdge desc`
    - `p_ml desc`
    - `netPremium desc`
    - `maxLoss asc`
    - `candidate_id`
  - ready filter:
    - `executionReady != false`
    - `capitalBlocked != true`

### Full-menu replay verdict

- Replay denominator:
  - `535` snapshot rows
  - `532` paired realized alternate outcomes for ML-edge-first
  - generated-menu outcome coverage about `99.94%`
- ML-edge-first result vs actual primary:
  - alternate beats primary on `390 / 532` paired rows
  - beat rate `73.31%`
  - average delta `R = +0.2709`
  - median delta `R = +0.0237`
  - average delta P&L about `+540.51`
- Current primary vs ML-edge alternate:
  - primary avg `R = -0.3071`
  - alternate avg `R = -0.0363`
  - primary p10 `R = -1.4799`
  - alternate p10 `R = -0.1031`
  - primary min `R = -2.6122`
  - alternate min `R = -2.1837`
- Honest interpretation:
  - survivorship challenge did not collapse the ML-signal finding
  - deterministic ranking is overriding useful ML signal
  - but ML-edge-first is still not production-ready
  - alternate avg `R` remains slightly negative
  - some days still fail materially

### Critical caution from replay

- ML-edge-first failed on later live-window days:
  - `2026-07-07`:
    - average delta `R = -0.0702`
    - beat rate `38.60%`
  - `2026-07-08`:
    - average delta `R = -0.0248`
    - beat rate `0.00%`
- Therefore:
  - do not switch live ranker to ML-edge-first
  - do not treat the offline branch rules as production-ready
  - correct next step is audit-shadow replay, not live ranking replacement

### Updated CHANGE 4 direction

- This work is outside the Week-1 frozen app path and remains offline-only.
- It does, however, give CHANGE 4 a stronger technical basis:
  - ranking/surfacing is the right problem
  - generator/gate is not the main problem
  - ML signal appears useful but regime-sensitive
- Safe future implementation direction after freeze:
  - add an audit-only shadow ranker
  - log alternate ML-edge-first top-1 beside current primary
  - teacher-score both on the same live days
  - require proof across multiple regimes, including non-calm/tail days, before any production switch

### Current frozen-program status

- No app code was changed during this research pass.
- No BUILD 3 thresholds were changed.
- No live ranking key was changed.
- No retrain/live teacher switch was performed.
- Real-money path remains closed pending:
  - live-exit unification
  - `position_exit_audit`
  - paper audit proof

## 2026-07-07 BUILD 3 hotfix and CI validation update pushed after live RLS verification

- `Marketapp` hotfix pushed to `main`:
  - SHA: `d9181b8cbcaa0c908d05ea769d4a27d2c63740b2`
  - commit: `Fix BUILD 3 wait wording and AB RLS policy`
- `Marketapp` CI follow-up pushed to `main`:
  - SHA: `c8f7b4534696ca18eb020511be7ab8d3eca19d09`
  - commit: `Update debug validation for BUILD 3 gate`
- Scope:
  - clarified BUILD 3 forced-`WAIT` Copilot/conflict text so stale pre-gate "Execution aligned to top candidate" wording is removed when the new actor correctly returns `WAIT`
  - recorded the production `ab_week1_decisions` RLS fix in the migration file
  - updated the debug APK workflow's inline Python validation so it checks BUILD 3 old-vs-new counterfactual fields instead of expecting post-gate `generated_candidates` to stay non-empty
- Production database status:
  - manual Supabase SQL fix succeeded
  - fresh app log confirmed `BUILD3_AB_SAVE: saved=true` at `14:50` and `14:55`
  - `ab_week1_decisions` cloud rows are now being written for `week1_a8_nf_calm_gate`
- Version/release status:
  - no Android version bump in this hotfix
  - still `v2.5.0 / b331`
  - `app/build.gradle.kts` was not changed, so the signed release workflow should not fire from this push
  - debug validation did run for `c8f7b4534696ca18eb020511be7ab8d3eca19d09` and passed:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/28858108716`

## 2026-07-07 Synchronized `v2.5.0 / b331` release pushed; signed Android release succeeded

- Both repos were pushed to `main` for the synchronized BUILD 3 release.
- Final pushed SHAs:
  - `Marketapp` `main`: `5a59992dd0fdec208a49b224ddf26d61b3980fb5`
  - `MarketVivi` `main`: `0db3a5e3b9dd0e757d747b7e886b21aff8687a60`
- Final synchronized visible version:
  - Android `versionName=2.5.0`
  - Android `versionCode=331`
  - Python `BRAIN_VERSION=2.5.0`
  - PWA visible label `v2.5.0 · b331`
  - PWA cache-bust `app.js?v=1249`
- `Marketapp` signed release workflow fired from the `main` push because `app/build.gradle.kts` changed.
- Signed release workflow result:
  - run URL: `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/28851827319`
  - conclusion: `success`
- GitHub release confirmation:
  - tag: `v2.5.0`
  - release URL: `https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.5.0`
  - asset: `app-release.apk`
- Note:
  - `Marketapp` debug APK validation on the same `main` push failed
  - signed release still completed successfully
  - if future follow-up is needed, inspect the failed debug workflow separately; it did not block this signed release

## 2026-07-07 BUILD 3 release prep moved to synchronized `v2.5.0 / b331`

- Release target is now synchronized across both repos:
  - Android / brain / PWA visible version: `v2.5.0`
  - Android build code: `b331`
  - PWA cache-bust: `app.js?v=1249`
- `Marketapp` BUILD 3 branch `build3-a8-nf-calm-ab` was merged locally into `main` for this release path:
  - local merge commit before push: `5a59992dd0fdec208a49b224ddf26d61b3980fb5`
- BUILD 3 actor scope in this release:
  - post-generation A8 EV gate with frozen `1.10` floor
  - calm intraday NF-lane restriction
  - paired old-vs-new logger `build3_ab`
  - Stage `2A` shadow remains active
  - Stage `2A` live teacher ranking remains inactive
- Before shipping, local checks passed:
  - `test_build3_a8_nf_ab.py`
  - `test_gate3_structural_counts.py`
  - `test_gate5_trace_smoke.py`
  - `test_teacher_v1_shadow_labels.py`
  - `test_stage2a_guarded_ranking.py`
  - `node --check MarketVivi-git/app.js`
  - `git diff --check` in both repos
- Local Android compile still could not run in Codex container because Android SDK path is missing; GitHub Actions remains the compile/sign gate.
- This release requires:
  - `Marketapp` push to `main` so `.github/workflows/release.yml` fires the signed APK release
  - `MarketVivi` push to `main` so the visible web version and cache-bust stay synchronized

## 2026-07-07 BUILD 3 branch pushed for Claude verification; not shipped

- Current shipped Android build is still:
  - `v2.4.99 / b330`
  - `Marketapp` `main` SHA: `a0a3d52b9ba5a79650a66275f226a40d5883965b`
- BUILD 3 is pushed only on a feature branch:
  - branch: `build3-a8-nf-calm-ab`
  - pushed HEAD SHA: `f0cfc8993c289213d15af5a8b2693210d1b17927`
  - commit message: `Implement BUILD 3 A8 gate and NF lane logger`
- Explicitly not done yet:
  - no version bump
  - no merge to `main`
  - no Android OTA / signed release trigger
  - no synchronized `MarketVivi` visible-version update

### BUILD 3 scope now implemented on branch

- BUILD 3 is the re-scoped WEEK-1 experiment after Claude removed teacher-first ranking from live actor scope.
- Implemented actor changes:
  - A8 EV gate is now post-generation, not inside candidate construction
  - old picker uses the untouched original generated menu
  - new picker uses:
    - A8 EV filtering with the frozen `1.10` EV floor
    - calm-regime NF-lane gate
  - calm-regime rule is:
    - `tradeMode == intraday`
    - and (`regime.type == range` or `rangeSigma <= 0.30`)
    - and `VIX < IV_HIGH`
  - calm-regime outcome:
    - if NF intraday survives, remove BNF intraday from the new actor pool
    - if only BNF intraday survives, actor returns `WAIT` with `CALM_NF_ONLY_WAIT`
- Attribution guard:
  - rank tuple itself was not changed
  - teacher-first was not reintroduced
  - old arm and new arm differ only by the BUILD 3 gates

### Stage 2A / teacher status after BUILD 3 correction

- During local BUILD 3 review Claude found that Stage `2A` shadow had been silently disabled.
- This was corrected before push:
  - Stage `2A` shadow annotations remain active
  - Stage `2A` live teacher ranking remains inactive for BUILD 3 actor logic
- Meaning:
  - teacher shadow observability is still available
  - teacher ranking is still not part of the live BUILD 3 actor path
  - BUILD 3 remains a gate-only experiment, not a teacher-first experiment

### BUILD 3 logger / Supabase contract

- New paired old-vs-new logger is added:
  - result payload key: `build3_ab`
  - experiment name: `week1_a8_nf_calm_gate`
- Persistence behavior:
  - local JSONL fallback writes to app local cache
  - Supabase write is best-effort only and must not crash polling
- Supabase table prepared in migration:
  - `supabase/migrations/20260707_ab_week1_decisions.sql`
- Idempotent key confirmed:
  - unique key: `(snapshot_poll_ts, experiment_name)`
  - app writer uses `on_conflict=snapshot_poll_ts,experiment_name`

### BUILD 3 validation status

- Passed locally before push:
  - `test_build3_a8_nf_ab.py`
  - `test_gate3_structural_counts.py`
  - `test_gate5_trace_smoke.py`
  - `test_teacher_v1_shadow_labels.py`
  - `test_stage2a_guarded_ranking.py`
  - `git diff --check`
- Local Android compile still blocked in Codex container:
  - `./gradlew assembleDebug` could not run because Android SDK path is not configured in this environment
  - compile gate still needs CI on GitHub after branch push

### Claude checkpoint state

- BUILD 3 Checkpoint B verdict became conditional approval.
- Required deltas were resolved before push:
  - Stage `2A` shadow disablement fixed and disclosed
  - old-pool ranking snapshot refactor disclosed
  - logger unique key confirmed
- Claude verification request artifact created outside repo:
  - `CLAUDE_BUILD3_PUSH_VERIFICATION_REQUEST_20260707.txt`
- Local review artifacts created outside repo:
  - `BUILD3_REVIEW_BUNDLE_20260707.zip`
  - `CLAUDE_BUILD3_CHECKPOINT_B_DELTA_20260707.txt`
- Current expected next step:
  - Claude verifies the pushed branch tree
  - only after that should user decide on commit-to-main / version bump / release path

### Release-process reminder after BUILD 3

- Pushing a feature branch does not ship the app.
- User-facing release still requires synchronized visible-version work on both repos:
  - `Marketapp/app/build.gradle.kts`
  - `MarketVivi` visible version label and cache-bust
- If BUILD 3 is later approved for ship:
  - Android version target agreed in directives is `v2.5.0 / b331`
  - `BRAIN_VERSION` must move in lockstep with Android version
  - `MarketVivi` must also be updated so the app/PWA visible versions stay synchronized

## 2026-07-06 Build 1 stability release completed (`v2.4.98 / b329`)

- Build 1 was released only after correcting the process back to the project rule:
  - feature branches/PRs were used only for validation
  - final user-facing update required synchronized `main` pushes in both repos
  - `Marketapp/app/build.gradle.kts` changed so the signed Android release workflow could publish the APK
  - `MarketVivi/index.html` changed so the hosted PWA version/cache-bust shipped
- Final synchronized version:
  - Android `versionName=2.4.98`
  - Android `versionCode=329`
  - PWA visible label `v2.4.98 · b329`
  - PWA cache-bust `app.js?v=1248`
- GitHub main commits:
  - `Marketapp`: `dd1791a` (`Stabilize build 1 polling and candidate persistence`)
  - `MarketVivi`: `336fd30` (`Update build 1 stability UI`)
- PR validation path:
  - `Marketapp` PR #1 debug APK validation passed on branch `build1-stability`
  - `MarketVivi` PR #1 had no checks and was clean
  - both PRs were merged to `main`
- GitHub Actions after `main` push:
  - `Marketapp` debug APK validation on `main` passed
  - `Marketapp` signed release workflow on `main` passed
  - GitHub release created:
    - tag `v2.4.98`
    - release name `Market Radar v2.4.98`
    - asset `app-release.apk`
    - APK SHA256 `c71d8eed1e7a17da7e2472d27517b754a229de1b67b58f823fec193a99841688`
    - release URL `https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.4.98`
- Build 1 scope actually shipped:
  - duplicate poll dispatch hardening:
    - `dispatchPollIfDue(...)` now uses an in-memory synchronized in-flight reservation for concurrent duplicate suppression
    - existing successful-slot marker remains the sequential completed-slot guard
    - failed slots remain retryable because completion is not marked on attempt
  - force/manual poll path now routes through the same dispatch guard
  - ML persistence de-duplication:
    - persist key is now `date|slotKey`
    - in-flight ML persistence reservation blocks concurrent duplicates
    - successful key is committed only after brain snapshot save and generated-candidate save success/no-op
    - failure/timeout releases the reservation for retry
  - generated candidates now write with:
    - `on_conflict=snapshot_poll_ts,candidate_id`
    - `Prefer: resolution=merge-duplicates,return=minimal`
  - NF futures premium display/persistence:
    - Android writes only `poll.futuresPremNf`
    - existing BNF fields `fp` / `futuresPremBnf` remain unchanged
    - `nfChain.futuresPremium` is not mutated because `brain.py` reads chain `futuresPremium` as a live input
    - PWA OI tab reads `latestPoll.futuresPremNf` with old `nfc.futuresPremium` as display fallback only
  - teacher research UI truth:
    - when post-close artifacts are pending and `LOCAL_REPORT_NOT_AVAILABLE` is the only failure reason, UI now says teacher research is pending instead of failed
- Explicitly not shipped in Build 1:
  - no `brain.py` changes
  - no teacher-ruler / CHANGE 1 logic
  - no ranking / probability / strategy-selection changes
  - no `BRAIN_VERSION` bump, because `brain.py` was intentionally unchanged
- Guardrails before release:
  - `git diff --check` passed in both repos
  - `node --check MarketVivi-git/app.js` passed
  - `brain.py` had zero diff
  - grep found zero `futuresPremNf`, `futures_prem_nf`, and CHANGE 1 markers in `brain.py`
  - local Android compile could not complete because the Codex container is `aarch64` and Android AAPT2 binaries are `x86-64`; GitHub Actions x86-64 runner became the compile gate and passed
- Live evidence that motivated the duplicate fix:
  - latest logs showed same-slot duplicate poll execution from loop/alarm timing, not only force/manual
  - earlier logs showed force/token-update could also create duplicate pressure
  - original force-only routing was insufficient; final fix hardened `dispatchPollIfDue(...)` itself
- Supabase index note:
  - local schema patch defines `idx_ml_generated_candidates_poll_candidate` as unique on `(snapshot_poll_ts, candidate_id)`
  - anon REST could read `ml_generated_candidates`
  - anon REST could not read `pg_indexes` (`PGRST205`)
  - still recommended: run the Supabase SQL editor query to confirm the live unique index is exactly `(snapshot_poll_ts, candidate_id)` and that no other unique constraint can fire first
- CHANGE 1 status after Build 1:
  - CHANGE 1 teacher-ruler work remains gated for Build 2
  - local stash preserved it in `Marketapp-git` as `gated-change1-local-20260706`
  - local patch backup exists outside repo as `CHANGE1_LOCAL_PATCH_20260706.diff`
  - when CHANGE 1 is later unstashed, `BRAIN_VERSION` must bump in the same commit as the ruler change
- Operational reminder:
  - a feature branch/PR does not deliver the app update
  - for user-facing releases, both repos must be pushed/merged to `main` with synchronized visible versions
  - `Marketapp/app/build.gradle.kts` must change for signed release automation
  - `MarketVivi/index.html` version label and `app.js?v=...` must change for PWA cache refresh
  - revoke/rotate any GitHub PAT pasted into chat after the release workflow is complete

## 2026-06-29 v2.4.74/b305 live validation

- User confirmed Android update arrived and app header shows `v2.4.74 · b305`.
- Uploaded live log `marketapp-logs-2026-06-29T09-01-27-803Z.csv` and screenshots around `14:29-14:30 IST` were checked.
- Confirmed good:
  - no error-level log rows
  - no `Trade Insert Failed`
  - no Supabase schema-cache insert failure
  - no `POSITION_VALUATION_DEGRADED`
  - live position path processed open trades: `POSITION_LIVE_APPLIED: live=2 open=2 updated=2`
  - UI shows `2/2 tracked`
  - UI shows mark quality line: `FULL · quotes 2/2 · CI signals 45%`
  - Upstox margin endpoint is working with HTTP `200`
  - candidate/trade margin display is using Upstox final margin, e.g. around `₹44.5K`
  - ML generated candidates and brain snapshots are saving
- Observed but not urgent:
  - many warning rows are overlap/self-refresh noise, e.g. `SERVICE_START_IGNORED`, `POLL_SKIPPED_OVERLAP`, `LEASE_RESULT self_refresh`
  - duplicate `ML_GENERATED_CANDIDATES` / `ML_BRAIN_SNAPSHOT_SAVE` rows appear for some same poll timestamps
  - local evaluation cache is growing fast (`LOCAL_SNAPSHOT_APPEND` bytes increased from ~88.5MB to ~98.1MB during the checked window)
- Future cleanup task:
  - implement duplicate poll/save suppression so each slot/poll timestamp writes one canonical brain snapshot and one generated-candidate batch
  - reduce warning noise from overlapping service starts without weakening the lease protection
  - add a visible/loggable counter for skipped duplicate writes
  - consider local snapshot cache compaction/retention because cache size is now large

## 2026-06-29 Live position integrity OODA fix

- Release target for the synchronized push is:
  - Android / brain / PWA version: `v2.4.74`
  - build code: `b305`
  - PWA cache-bust: `app.js?v=1229`
- Scope:
  - live position safety only
  - no teacher replay / teacher table logic changed
- Fixes:
  - candidate and manual trade runtime objects now capture `lot_size` and `entry_sell_oi2` forward-only
  - current `trades_v2` schema still lacks top-level `lot_size` and `entry_sell_oi2`, so PWA insert sanitization mirrors them into `entry_snapshot` and strips unsupported top-level columns to avoid repeating schema-cache insert failures
  - `brain.compute_control_index(...)` now supports detailed output with `signals_available`, `signal_completeness_pct`, unknown signal names, and component metadata
  - missing `entry_max_pain` no longer self-falls back to current max pain; it is marked UNKNOWN instead of falsely stable
  - `entry_sell_oi2` consumer now reads top-level or `entry_snapshot.sell_oi2`
  - `brain.compute_position_live(...)` now returns `legs_required`, `legs_quoted`, `legs_intrinsic_fallback`, `fallback_legs`, `valuation_quality`, `lot_size_assumed`, and `lot_size_source`
  - degraded live marks are logged as `POSITION_VALUATION_DEGRADED`
  - strong position alerts are suppressed when live valuation is degraded or CI signal completeness is below `60%`
  - position verdict reasons now carry an explicit incomplete-data warning if a BOOK/EXIT action is produced under degraded data
  - positions UI shows mark quality, quote count, intrinsic fallback count, lot-size assumption, and CI signal completeness when available
- Lot-size resolution:
  - app/brain constants remain `BNF=30`, `NF=65`
  - new trades should carry explicit `lot_size`; fallback path now exposes `lot_size_assumed=true`
- Relationship to previous pending batch:
  - includes the earlier `v2.4.73/b304` pre-poll position monitor honesty fix
  - supersedes release target to `v2.4.74/b305` before push

## 2026-06-29 Position monitor pre-poll honesty fix

- Release target for the synchronized push is:
  - Android / brain / PWA version: `v2.4.73`
  - build code: `b304`
  - PWA cache-bust: `app.js?v=1228`
- Finding from live test:
  - screenshots showed two BNF paper trades visible in PWA after entry
  - uploaded log showed latest background brain poll at `11:20:12` had `POSITION_LIVE_APPLIED: live=0 open=0 updated=0`
  - this means the trades were opened after that poll snapshot, so the brain had not processed them yet
  - old UI was misleading because each trade card said the paper position was "being tracked" even when `bd.positions[trade_id]` was absent
- Fix:
  - position card fallback now says `queued for brain poll` until a real per-trade brain position verdict exists
  - Position Monitor now shows tracked count plus awaiting-first-post-entry-poll count
  - no change to trade creation, Supabase insert sanitization, paper cost model, Upstox margin quote, ranking, or notification dispatch
- Expected live behavior:
  - immediately after entry, Position Monitor can show `0/N tracked` with awaiting count
  - after the next market poll, Kotlin should pass `open_trades` into `brain.py`, `POSITION_LIVE_APPLIED` should show `open=N updated=N`, and UI should move to `N/N tracked`

## 2026-06-29 Trade insert schema-cache fix

- Release target for the synchronized push is:
  - Android / brain / PWA version: `v2.4.72`
  - build code: `b303`
  - PWA cache-bust: `app.js?v=1227`
- Reason:
  - `v2.4.71/b302` fixed paper charge display and real margin display
  - but paper trade Supabase insert failed because new margin fields were sent as top-level `trades_v2` columns
  - Supabase error: `Could not find the 'margin_quote_source' column of 'trades_v2' in the schema cache`
- Fix:
  - `DB.insertTrade(...)` sanitizes trade payload before inserting into `trades_v2`
  - margin quote evidence is preserved under existing `entry_snapshot.margin_quote`
  - top-level transient margin fields are stripped from the DB insert payload
  - essential retry insert also keeps only schema-safe fields
  - position display can read margin from either local top-level fields or persisted `entry_snapshot.margin_quote`
- Verification:
  - log confirmed Upstox margin quote API continued returning final margin ~`₹73.6K`
  - screenshot confirmed corrected paper round-trip cost showed `₹233` and net `₹-215`
  - `node --check MarketVivi-git/app.js` passed
  - `python3 -m py_compile Marketapp-git/app/src/main/python/brain.py` passed
  - `git diff --check` passed in both repos

## 2026-06-29 Margin UI + paper charge correction release

- Release target for the synchronized push is:
  - Android / brain / PWA version: `v2.4.71`
  - build code: `b302`
  - PWA cache-bust: `app.js?v=1226`
- Reason for this release:
  - live logs proved Upstox margin quote API was returning real margin successfully
  - UI still displayed old estimated SPAN margin, e.g. ~`₹14.5K` instead of Upstox final margin ~`₹73K`
  - paper position tab still subtracted stale fixed BNF 4-leg slippage, causing inflated round-trip cost around `₹1,281`
- Fixes:
  - PWA candidate card now prefers `realMargin` / `upstoxFinalMargin` / `upstoxRequiredMargin`
  - candidate `EV/₹1K` uses real Upstox margin as denominator when available
  - Paper trade creation persists margin quote fields into the saved trade record
  - Positions tab displays saved Upstox final margin when available
  - PWA paper cost estimator now uses the corrected teacher charge model:
    - brokerage per executed order
    - date-aware STT
    - turnover-based exchange fee
    - GST on brokerage + exchange + IPFT
    - stamp duty on buy side
    - SEBI/IPFT
    - fallback slippage `0.25` points, not stale fixed BNF 4-leg `₹4/point` table
  - Kotlin `TeacherTruthConfig` now exports the same corrected charge-model fields to JS
- Verification:
  - `node --check MarketVivi-git/app.js` passed
  - `git diff --check` passed in both repos
  - screenshot BNF IC legs estimated paper cost recalculates to about `₹233`, not `₹1,281`
  - Kotlin/Gradle compile still unavailable in Codex container because Java/JDK is missing

## 2026-06-29 Read-only Upstox margin quote ship

- Release target for the synchronized push is:
  - Android / brain / PWA version: `v2.4.70`
  - build code: `b301`
- Scope added in this release:
  - Upstox read-only margin quote integration for the top surfaced candidate
  - endpoint used: `POST https://api.upstox.com/v2/charges/margin`
  - no order placement path added
  - no ranking, gating, sizing, or notification behavior change
- Runtime behavior:
  - sends the candidate's full leg basket together as one margin request
  - uses live bearer token already present in `MarketWatchService`
  - caches per poll cycle / basket key
  - annotates result with:
    - `realMargin`
    - `upstoxRequiredMargin`
    - `upstoxFinalMargin`
    - `upstoxSpanMargin`
    - `upstoxExposureMargin`
    - `upstoxNetBuyPremium`
  - logs side-by-side:
    - brain max loss
    - Upstox required margin
    - Upstox final margin
    - span / exposure / net buy premium
- Snapshot persistence:
  - margin annotation fields are preserved in Python candidate snapshot views
  - this keeps the data visible for post-close teacher review
- Verification completed locally:
  - `python3 -m py_compile app/src/main/python/brain.py` passed
  - `git diff --check` passed
  - Kotlin compile could not be run in Codex container because `JAVA_HOME` / `java` were unavailable

## 2026-06-28 Stage 2A teacher rebuild locked; shadow ship release prep

- Release target for the next synchronized push is:
  - Android / brain / PWA version: `v2.4.69`
  - build code: `b300`
  - PWA cache-bust: `app.js?v=1225`
- Scope locked for this release:
  - verified `teacher_table_stage2a.json` shipped as app asset
  - Stage `2A` runtime remains `shadow` only
  - no teacher live cutover
  - no verdict / ranking / notification behavior change from the teacher path

### Teacher table rebuild outcome

- Corrected the Stage `2A` bucket success-rate bug:
  - teacher-table bucket wins are now counted from `realized_r > 0`
  - they are no longer tied to teacher `is_success` / TP-only semantics
- Added a permanent build-time math-consistency gate in `historical_replay_harness.py`:
  - fail if `avg_r > 0` with `success_rate_pct == 0`
  - fail if `avg_r < 0` with `success_rate_pct == 100`
  - fail if `success_rate_pct` falls outside `0..100`
- Verified anchor bucket after the fix:
  - `IRON_CONDOR | VIX_NORMAL | VIX_16_18 | DTE_1`
  - `n = 1067`
  - `avg_r = +0.0324`
  - `success_rate_pct = 83.88`
- Verified impossible bucket pairings remaining after rebuild:
  - `0`
- Teacher-table loader proof:
  - `_stage2a_load_teacher_table(...)` returns `row_count = 46`
  - loader `error = None`
  - `min_prior_bucket_n = 5`

### Shadow-ship proof

- Runtime wiring was already present and verified:
  - `MainActivity.kt` copies `teacher_table_stage2a.json` from assets into `filesDir`
  - `MarketWatchService.kt` injects:
    - `stage2a_teacher_table_path = File(filesDir, "teacher_table_stage2a.json").absolutePath`
    - `stage2a_mode`
    - `stage2a_min_prior_bucket_n = 5`
- Explicit mode target for shipping remains:
  - `stage2a_mode = shadow`
- Verified with a real saved snapshot replay:
  - `session_date = 2026-06-24`
  - `snapshot_id = 1496`
  - `poll_ts = 2026-06-24T03:55:08+00:00`
- Side-by-side proof:
  - `off` verdict: `BUY PREMIUM / BEAR_PUT / confidence 45`
  - `shadow` verdict: `BUY PREMIUM / BEAR_PUT / confidence 45`
  - top candidate unchanged: `BEAR_PUT_BNF_56900_57500_W600`
  - `stage2a.mode = shadow`
  - `stage2a.table_ready = true`
- Operational conclusion:
  - the teacher table is now live in the build as a measured asset
  - tomorrow's market still sees zero teacher influence on actual trade choice
  - the teacher path is observable but not active

### Local verification status before push

- `python3 -m py_compile historical_replay_harness.py app/src/main/python/brain.py` -> OK
- `git diff --check` -> OK
- The large local diagnostic artifacts remain intentionally unpushed:
  - Claude consultation notes
  - `matrix_report.txt`
  - `teacher_table_stage2a_candidates.jsonl`
  - `parity_data/`
  - `reingest_checkpoint.db`
- Intended pushed runtime payload is limited to:
  - `Marketapp-git/app/src/main/python/brain.py`
  - `Marketapp-git/historical_replay_harness.py`
  - `Marketapp-git/app/src/main/assets/teacher_table_stage2a.json`
  - `Marketapp-git/app/build.gradle.kts`
  - `MarketVivi-git/index.html`
  - `MarketVivi-git/PROJECT_KNOWLEDGE.md`

## 2026-06-25 Reevaluation Baseline Recovery + Stage 1 Architecture Lock

- Release progression across both repos is now:
  - `v2.4.60 / b291`
    - fixed the original day-close evaluation prep OOM by streaming snapshot fetch + filtered chain fetch
    - `Marketapp` commit `8ea74ba`
    - `MarketVivi` commit `2974e4b`
  - `v2.4.61 / b292`
    - fixed the second OOM path by removing the full snapshot-file reload during aggregation / research generation
    - `Marketapp` commit `0d91333`
    - `MarketVivi` commit `1ed07af`
  - `v2.4.62 / b293`
    - native teacher-research artifact rebuild + stale negative cache bypass + saved-snapshot fallback for historical diagnostics
    - PWA refresh path now force-refreshes teacher research / lane summary / brain snapshots
    - `Marketapp` commit `8beee0b`
    - `MarketVivi` commit `e46711e`

### Phone validation completed so far

- Historical reevaluation for `session_date = 2026-06-24` was rerun on phone on `v2.4.61 / b292`.
- Verified UI state:
  - `Day evaluation: DONE`
  - `Outcomes persisted: 411`
  - `Produced: 411`
  - `Progress: 77/77 snapshots`
  - action button changed to `Session Done`
- Operational conclusion:
  - the old reevaluation crash / OOM loop is no longer the main blocker
  - the core reevaluation engine is now completing far enough to finish, produce outcomes, and persist them
- Remaining issue before `b293`:
  - post-evaluation artifacts were still not cleanly surfacing:
    - `Daily Teacher Research`
    - `Class A Correctness Gate`
    - `Historical Snapshot Diagnostics`
- `b293` was pushed specifically to harden that artifact layer before the next post-close auto evaluation.

### Supabase audit refreshed on 2026-06-25

- Live service-role counts observed:
  - `ml_brain_snapshots`: `1594`
  - `ml_poll_sequences`: `0`
  - `ml_evaluation_outcomes`: `9076`
  - `ml_recommendation_outcomes`: `1545`
  - `historical_option_candles`: `874325`
- Recent saved snapshot day counts observed:
  - `2026-06-25`: `25`
  - `2026-06-24`: `77`
  - `2026-06-23`: `85`
  - `2026-06-22`: `79`
  - `2026-06-19`: `76`
  - `2026-06-18`: `58`

### Recent session completeness checks

- `2026-06-24`
  - `77` snapshots for the day
  - reevaluation persisted `411` total teacher rows:
    - `44 primary`
    - `367 secondary`
  - same-day `ml_option_chain_snapshots` count observed: `52052`
  - spot-check of first `25` snapshot rows:
    - `23` had primary candidate present
    - `23` had generated candidates present
    - `23` had rejected candidates present
    - `21` were `is_labelable = true`
- `2026-06-23`
  - snapshots: `85`
  - primary present: `53`
  - generated present: `53`
  - rejected present: `83`
  - labelable: `33`
  - persisted teacher rows:
    - `527` total
    - `53 primary`
    - `474 secondary`
  - same-day `ml_option_chain_snapshots`: `50490`
- `2026-06-22`
  - snapshots: `79`
  - primary present: `74`
  - generated present: `74`
  - rejected present: `76`
  - labelable: `66`
  - recommendation table still reflects older persistence shape:
    - `ml_recommendation_outcomes`: `74` rows, `primary` only
    - `ml_evaluation_outcomes`: `1000` rows with `61 primary`, `939 secondary`
  - same-day `ml_option_chain_snapshots`: `46332`
- `2026-06-19`
  - snapshots: `76`
  - primary present: `67`
  - generated present: `67`
  - rejected present: `74`
  - labelable: `39`
  - `ml_recommendation_outcomes`: `67` rows, `primary` only
  - `ml_evaluation_outcomes`: `0`

### Updated strategic conclusion from the live audit

- For recent saved live sessions, Supabase already contains enough for **Class A** teacher analysis without immediate Upstox backfill:
  - `ml_brain_snapshots`
  - `ml_recommendation_outcomes` / `ml_evaluation_outcomes`
  - `ml_option_chain_snapshots`
- Recent Class A saved-live days are therefore sufficient for:
  - correctness checks
  - artifact verification
  - saved-menu teacher measurement
- But they are **not enough** to honestly quantify forward strategy weights by bucket.
- The problem is not total candidate rows; the problem is insufficient **day / regime diversity**.
- Therefore:
  - recent Class A days are enough for Stage `0.2` correctness + artifact validation
  - they are **not enough** to claim a meaningful Stage `1.2` strategy-weight baseline by themselves

### Claude Stage 1 architecture reply - accepted direction with one correction

- Claude's 2026-06-25 reply was assessed against the current verified state.
- Accepted architecture direction:
  - evolve `historical_replay_harness.py`
  - do **not** build a separate emulator right now
  - separate the work into three lanes:
    1. correctness
    2. Class A measurement
    3. Class B reconstruction later
  - boundary between Class A and Class B is:
    - **saved menu exists** -> Class A
    - **menu must be regenerated** -> Class B
  - Upstox backfill should wait
- One correction to Claude's note:
  - he treated `historical_option_candles` OI presence as still unconfirmed
  - project knowledge had already confirmed `historical_option_candles.open_interest` exists
  - so the Class B blocker is not raw OI existence alone
  - the real Class B blocker is broader reconstruction fidelity of the live brain inputs / chain-dict / context contract

### Local Stage 1 harness preparation completed on 2026-06-25

- `historical_replay_harness.py` was extended locally to align with the 3-lane model:
  - explicit snapshot classification:
    - `class_a` = saved generated menu present
    - `class_b` = saved menu missing
  - new SQLite table:
    - `historical_snapshot_inventory`
  - `historical_outcomes` now stores `snapshot_class`
  - walk mode now supports:
    - `--walk-mode class_a`
    - `--walk-mode all`
  - default walk mode is `class_a`
  - aggregation now uses only `snapshot_class = 'class_a'`
  - walk / aggregate summaries now print:
    - class A vs class B counts
    - skipped snapshot counts
    - distinct Class A session count
- Local verification completed:
  - `python3 -m py_compile historical_replay_harness.py` passed
  - `python3 historical_replay_harness.py --help` passed with `--walk-mode {class_a,all}`
- This Stage 1 harness preparation is still **local only** and not pushed yet.

### Current working rule as of 2026-06-25

- Do **not** spend time on LLM integration / wiring yet.
- Priority order is now:
  1. validate `b293` post-close artifact baseline after auto evaluation
  2. close Stage `0.2` correctness gate
  3. evolve the harness into the real Class A measurement engine
  4. only then decide whether broader Class B reconstruction is worth extending
  5. teacher-fed ranking before any Stage 3 reasoner work

## 2026-06-24 Intraday Live Check + Stage 1 Scaffold

- Intraday validation at `09:54` on `v2.4.56 / b287` showed the live engine is healthy after `9/9` polls:
  - auto polling healthy
  - brain running and saving results
  - candidate generation healthy
  - unified notification contract visible in UI
  - no live crash or snapshot-save failure signal
- Fresh log export `marketapp-logs-2026-06-24T04-24-30-731Z.csv` confirmed:
  - repeated `BRAIN_COMPLETE`
  - repeated `ML_CHAIN_SAVE: rows=676 saved=true`
  - repeated `BRAIN_NOTIFICATION_MODE: mode=live dispatched=false notify=false type=TRADE`
  - repeated `BRAIN_NOTIFICATION_CONTRACT: ... reason=NO_ACTIONABLE_STATE_CHANGE`
- Operational interpretation:
  - the live path is behaving correctly
  - the brain is producing candidates but intentionally not notifying yet
  - this is not a live-engine failure
- The confusing part was UI semantics during market hours:
  - `Daily Teacher Research` and `Class A Correctness Gate` were showing zero-state / `FAIL`
  - yesterday's post-close persisted counts were leaking into today's still-pending session
- Local-only UI correction now exists in `MarketVivi-git/app.js`:
  - during market hours, if today's post-close evaluation has not run, post-close cards show as pending rather than failed
  - stale `Produced` / `Outcomes persisted` numbers from yesterday are hidden from today's pending session
  - research pending message explicitly says it waits for post-close evaluation
  - `Class A` status shows `PENDING` instead of `FAIL` while today's session is still live
- Local-only Stage `1.1 / 1.2` harness scaffold now exists in `Marketapp-git/historical_replay_harness.py`:
  - existing Stage `0.2` verify-day remains intact
  - new `--walk --from YYYY-MM-DD --to YYYY-MM-DD` walks stored sessions from Supabase
  - walker reuses Python's existing `_evaluate_snapshot_outcomes(...)` / teacher path instead of inventing a second evaluator
  - raw outcomes are persisted to local SQLite `historical_outcomes.sqlite`
  - local aggregation via `--aggregate` builds `strategy_weights_local`
  - aggregation buckets currently use:
    - `strategy_type`
    - `regime_bucket`
    - `vix_bucket`
    - `dte_bucket`
  - low-confidence buckets are flagged locally when `n < 30`
- Local harness DB tables now include:
  - `historical_outcomes`
  - `historical_walk_errors`
  - `historical_walk_runs`
  - `strategy_weights_local` (created by aggregate step)
- Verification completed locally:
  - `python3 -m py_compile historical_replay_harness.py` passed
  - `python3 historical_replay_harness.py --help` shows live `--walk` and `--aggregate`
  - `node --check MarketVivi-git/app.js` passed
- Push status:
  - none of the above 2026-06-24 changes are pushed yet
  - after-hours validation still comes first:
    - confirm today's completed session
    - then run Stage `0.2` replay parity for `2026-06-24`
    - only after that decide whether to push the UI semantics fix + Stage `1.1/1.2` scaffold batch

# Market Radar — Project Knowledge (updated through 2026-06-22 b281 exact-count fix)

## 2026-06-22 Historical Parity Input Audit - Supabase + Upstox + Claude Gate

- User requested a strict preflight before any historical replay work:
  - inspect what Supabase already has
  - identify what the laptop simulator still needs
  - avoid silent incompleteness
- Live anon-readable Supabase probe confirmed the current app key can read:
  - `ml_brain_snapshots`: `1329` rows
  - `ml_option_chain_snapshots`: `136,896` rows
  - `ml_evaluation_outcomes`: `6,804` rows
  - `ml_recommendation_outcomes`: `533` rows
- Live anon-readable probe also reconfirmed:
  - `historical_option_candles` returns empty / effectively `0` rows for the app key
  - project knowledge service-role count remains `874,325`
  - implication: historical option data exists, but current phone/anon access still cannot use it

### Saved Live Snapshot Context - Verified Richness

- A real `ml_brain_snapshots.context_json` row for `2026-06-19` was inspected live.
- Verified keys already present in saved live snapshots include:
  - `vix`
  - `vixHistory`
  - `yesterdayHistory`
  - `morning_input`
  - `bnfChain`
  - `nfChain`
  - `ivPercentile`
  - `gap`
  - `live`
  - `mins_since_open`
  - `tradeMode`
  - `bnfBreadth`
  - `nf50Breadth`
  - `fiiHistory`
  - `approvedProposals`
  - `snapshot_generated_candidates`
  - `snapshot_rejected_candidates`
  - `snapshot_market_profiles`
  - `teaching_snapshot_staging`
  - `significant_move`
  - `eveningClose`
- Important observed shapes:
  - `vixHistory`: list length `60`
  - `yesterdayHistory`: list length `60`
  - `morning_input` contains overnight / expiry / FII-DII context
  - `bnfChain` / `nfChain` already carry the full chain-dict shape the brain consumed live
- Consequence:
  - saved live days already contain much richer context than the earlier historical harness assumption of "minimal context"
  - this makes `Class A` replay (saved live days) a fundamentally easier and safer first target than `Class B` replay (old unsaved historical days)

### Upstox Historical VIX - Live Preflight Passed

- A live Upstox preflight was executed on 2026-06-22 using the current bearer access token.
- Verified:
  - endpoint family: Upstox V3 historical candle API
  - instrument: `NSE_INDEX|India VIX`
  - interval: `5` minutes
  - requested range: `2024-09-01` -> `2024-09-30`
  - result: success
  - returned candles: `1575`
  - oldest returned candle: `2024-09-02T09:15:00+05:30`
  - newest returned candle: `2024-09-30T15:25:00+05:30`
- Consequence:
  - historical `India VIX` is reachable at 5-minute granularity at least back to September 2024
  - this removes one previously suspected historical-input blocker

### brain.py Dependency Audit - Critical Framing Shift

- `brain.py` was re-audited directly from code by extracting the actual `ctx.get(...)` dependency surface.
- Important confirmed context dependencies include:
  - `vix`, `vixHistory`, `yesterdayHistory`
  - `morning_input`
  - `bnfChain`, `nfChain`
  - `ivPercentile`
  - `bnfDTE`, `nfDTE`
  - `bnfExpiry`, `nfExpiry`
  - `tradeMode`
  - `bnfBreadth`, `nf50Breadth`
  - `fiiHistory`
  - `gap`, `live`, `mins_since_open`
  - `approvedProposals`
- Working conclusion after this audit:
  - the real parity problem is not just "can we rebuild historical chains?"
  - the real parity problem is "can we reconstruct the seven `analyze()` inputs faithfully, especially `context_json`?"
  - any harness assumption that old-day replay needs only option candles + VIX + minimal context is unsafe until proven otherwise

### Claude Review Outcome - Accepted Direction

- Claude's 2026-06-22 parity reply was assessed against the verified Supabase and Upstox findings.
- Accepted core conclusion:
  - `Class A` correctness gate must come before any full historical walk
  - `Class A` = saved live days with rich `context_json`
  - `Class B` = unsaved old historical days requiring reconstruction
- Important accepted findings from Claude:
  - `minimal context` is unsafe
  - the first correctness gate should use saved live-day `context_json` directly
  - `snapshot_generated_candidates` and `snapshot_rejected_candidates` should both be parity targets
  - older `Class B` replay is still blocked until two data questions are answered:
    - whether `historical_option_candles` contains usable OI columns
    - whether some historical table such as `daily_data` contains FII/DII / short context by trade date
  - ranking parity may still depend on:
    - the exact point-in-time `ml_models` artifact
    - point-in-time closed-trade calibration

### Current Working Rule

- Do **not** start a full historical walk yet.
- Next priority is:
  1. prove `Class A` replay parity on `2026-06-19`
  2. inspect the remaining `Class B` blockers:
     - `historical_option_candles` schema for OI
     - historical FII/DII source such as `daily_data`
     - live producer rules for `bnfDTE` and `ivPercentile`
     - retrievability of the live `ml_models` artifact
- Important strategy change:
  - ingesting full historical `India VIX` is still useful
  - but it is no longer the first critical path item
  - the first critical path item is the saved-live-day correctness gate

### 2026-06-22 Follow-up Checks Completed After Claude Review

- Claude requested four concrete follow-up checks before trusting the parity plan.

#### 1. `historical_option_candles` schema

- Verified live with service-role access:
  - columns include:
    - `underlying`
    - `expiry_date`
    - `strike_price`
    - `option_type`
    - `interval_mins`
    - `bar_ts`
    - `open`
    - `high`
    - `low`
    - `close`
    - `volume`
    - `open_interest`
    - `lot_size`
    - `instrument_key`
- Important consequence:
  - the historical store **does** contain OI via `open_interest`
  - this removes one major `Class B` blocker that was still only a suspicion during the first parity discussion

#### 2. Historical FII/DII source

- `daily_data` was checked live with service-role access.
- Result:
  - table exists with columns such as:
    - `trade_date`
    - `fii_cash`
    - `dii_cash`
    - `fii_fut`
    - `fii_opt`
    - `india_vix`
  - but current probed rows were null-filled for those historical fields
  - a direct non-null probe returned no rows
- `premium_history` was then checked live:
  - total rows: `145`
  - contains usable fields:
    - `date`
    - `session`
    - `vix`
    - `fii_cash`
    - `fii_short_pct`
    - `bnf_spot`
    - `nf_spot`
  - many rows are populated, especially `morning` rows
- Current consequence:
  - `daily_data` is **not** the reliable historical FII/DII source at the moment
  - `premium_history` is the stronger candidate source for replaying the live bias inputs that Kotlin actually used

#### 3. Live producer rules for `bnfDTE` and `ivPercentile`

- Kotlin producer was verified in `MarketWatchService.kt`.
- `bnfDTE` / `nfDTE`:
  - computed as plain calendar-day difference:
    - `(expiryDate.time - todayDate.time) / (24 * 60 * 60 * 1000L)`
  - fallback default remains `3` if parsing fails
- `ivPercentile`:
  - computed from `premium_history`
  - logic:
    - if history length `< 10`, return `50`
    - otherwise count how many historical rows have `vix` below current `vix`
    - percentile = `lower * 100 / hist.length`
- Important consequence:
  - these two producer rules are now known exactly, not guessed
  - `ivPercentile` is simpler than previously feared and is tied directly to `premium_history`, not an opaque external feature store

#### 4. `ml_models` artifact availability

- Supabase `ml_models` was checked with service-role access.
- Result:
  - table exists but currently has `0` rows
  - `app_config` also showed no obvious model/calibration keys
- Repo/runtime check:
  - the app ships baseline model assets:
    - `app/src/main/assets/ml_model.json`
    - `app/src/main/assets/temporal_model.json`
  - `brain.py` loads runtime models from:
    - `/data/data/com.marketradar.app/files/ml_model.json`
    - `/data/data/com.marketradar.app/files/temporal_model.json`
  - `MainActivity` copies asset models into `filesDir` only when missing and preserves trained runtime models if they already exist
- Current consequence:
  - the exact point-in-time trained model that was active on the phone for `2026-06-19` is **not yet proven retrievable from Supabase**
  - but a baseline deployable model artifact **is** present in repo assets
  - therefore `p_ml` parity remains an open asterisk for the full correctness gate

### Refined Working Conclusion After the Four Checks

- `Class A` replay is now even stronger as the next step:
  - saved live snapshots already contain the actual context
  - teacher chain rows already exist
  - Kotlin producer rules for DTE and IV percentile are known
- `Class B` is no longer blocked by missing OI:
  - `historical_option_candles.open_interest` exists
- `Class B` is still partially blocked by historical bias context quality:
  - `premium_history` looks usable
  - `daily_data` does not currently look trustworthy for those fields
- Remaining parity asterisks before a full correctness claim:
  - exact point-in-time ML model artifact used on 2026-06-19
  - point-in-time calibration / closed-trade history as of that session

## 2026-06-21 Daily Teacher Research Report - v2.4.44 / b275

- User clarified that the desired ML teacher architecture must reach the same
  explanatory level as the manual Friday analysis:
  - not just label persisted outcomes
  - explain market behavior, generated candidate menu, chosen primary, best
    available alternative, rank inversion, and family-level expectancy
- Implemented a measurement-only daily research artifact:
  - Python `session_teacher_research_report(...)` now builds the session report
    from saved `ml_brain_snapshots` plus locally produced teacher outcomes
  - future evaluator rows now include:
    - `rank_in_snapshot`
    - `varsity_tier`
    - `premium_edge`
    - `credit_width_ratio`
    - `sigma_otm`
  - Android stores `teacher_research_<session>.json` after day evaluation and
    exposes it through `NativeBridge.getMLTeacherResearchReport()`
  - PWA ML tab now shows a `Daily Teacher Research` card with:
    - market summary
    - primary vs generated family counts
    - primary teacher expectancy
    - primary-vs-best comparison
    - best-family counts
    - top strategy outcome summary
- Local Friday verification using live Supabase data reproduced the manual
  baseline:
  - snapshots: `76`
  - chain rows: `45,144`
  - outcomes: `665`
  - primary rows: `67`
  - primary average `R = -0.1343`
  - primary was best: `0 / 67`
  - better candidate available: `67 / 67`
  - positive alternative available: `64 / 67`
  - average best-minus-primary uplift: `+0.2472R`
  - best family:
    - `BULL_PUT`: `57`
    - `BEAR_CALL`: `10`
- Release metadata shipped:
  - Android `versionName=2.4.44`, `versionCode=275`
  - `BRAIN_VERSION=2.4.44`
  - PWA visible label `v2.4.44 / b275`
  - PWA cache-buster `app.js?v=1215`
- GitHub push completed:
  - `Marketapp` commit `225e2e3` — `Release v2.4.44 daily teacher research report`
  - `MarketVivi` commit `8af8b5f` — `Release v2.4.44 daily teacher research report`
- No live brain selection logic was changed.

## Release Discipline - Mandatory Sync Rule

- Kotlin app repo (`Marketapp`) and PWA repo (`MarketVivi`) must be kept on the same visible version for every user-facing release.
- Do not push one side alone when the change affects runtime behavior, ML reporting, bridge contracts, cache-busting, or app labeling.
- The safe release order is:
  1. finish code changes in both repos
  2. bump Android `versionName` + `versionCode` in `Marketapp/app/build.gradle.kts`
  3. bump Python `BRAIN_VERSION` in `Marketapp/app/src/main/python/brain.py`
  4. update PWA-visible version label / cache-bust in `MarketVivi/app.js` if the PWA changed
  5. commit `Marketapp`
  6. commit `MarketVivi`
  7. push both repos
  8. confirm the Android signed release workflow completed successfully
  9. confirm the app update reached the phone
- Additional sync rule after the 2026-06-16 drift incident:
  - PWA-visible version is controlled in `MarketVivi/index.html`, not only by `app.js`
  - for every synced release, update all three PWA markers together:
    1. `<title>`
    2. header version label
    3. `app.js?v=...` cache-buster
- Verification rule after installation:
  - the header label, About dialog build version, and active PWA cache-buster must agree
  - if they disagree, treat that as a version-surface bug, not as proof that the release failed
- Important GitHub rule:
  - the signed Android release workflow triggers from changes to `Marketapp/app/build.gradle.kts`
  - a repo push alone is not enough; the Gradle version file must change for the signed release action to auto-run
- Current confirmed signed-release pattern:
  - `Marketapp` push with `app/build.gradle.kts` version bump -> GitHub Actions auto-runs signed release
  - release artifact is published under GitHub Releases as `app-release.apk`
- Future rule:
  - if user says both sides must stay aligned, treat that as a hard invariant, not a preference

## 2026-06-19 ML Day-End Evaluation Prep Crash Fix - v2.4.39 / b270

- User reported that after the market close on 2026-06-19, day-end ML evaluation failed again:
  - automatic evaluation entered `PREPARING`
  - app crashed / process stopped before any batch progress
  - manual retry also failed
  - UI later showed `RETRYABLE` with `Evaluation stalled during preparing at 0/0 snapshots`
- Uploaded log CSV did not include the actual crash stack:
  - it only captured app restart / WebView bridge startup after the crash
  - screenshots were the strongest evidence for failure phase and state
- Root cause diagnosis:
  - the previous `v2.4.38 / b269` batching fix batched Python evaluation, but still prepared inputs with a full-session chain fetch first
  - `ensureEvaluationInputFiles()` fetched and normalized the entire day of option-chain rows into one `JSONArray`
  - Python prepare then loaded the full snapshots file and full chain file before batches started
  - this could still cause memory pressure / app death during `PREPARING`, which matches the observed `0/0 snapshots` stalled state
- Implemented in `Marketapp`:
  - Android version bumped to `versionName=2.4.39`, `versionCode=270`
  - Python `BRAIN_VERSION` bumped to `2.4.39`
  - chain cache filename changed to `chain_filtered_v2_<sessionDate>.json` so old oversized `chain_<date>.json` files are ignored on retry
  - `MarketMLService` now extracts the exact candidate option legs from:
    - `primary_candidate_json`
    - `context_json.snapshot_generated_candidates`
    - fallback `top_candidates_json`
  - `SupabaseClient` now fetches day-end chain rows page-by-page and keeps only rows matching those candidate legs
  - option type matching is hardened so `CALL/PUT` and `CE/PE` forms do not silently drop valid rows
  - preparation now updates evaluation job state after each fetched page, so a long healthy prepare phase does not look stale
- Teacher-quality constraint:
  - this does **not** reduce the teacher’s evaluated candidate set
  - it removes irrelevant strikes from the chain input while preserving all timestamps for every candidate leg needed by `_build_candidate_path()`
- Implemented in `MarketVivi`:
  - visible app title/header bumped to `v2.4.39 / b270`
  - PWA cache-buster bumped to `app.js?v=1210`
- Validation completed locally:
  - `git diff --check` passed for both repos
  - `python3 -m py_compile` passed for `brain.py`
  - Android Gradle compile could not run locally because this environment has no Java / `JAVA_HOME`
- Release note:
  - push only after user confirmation
  - signed release should run because `Marketapp/app/build.gradle.kts` changed

### Claude Audit Follow-Up

- Claude's `GOD_MODE_AUDIT_b269_TEACHER_EVAL_20260619.md` agreed with the filtered-chain architecture but identified the first local patch as incomplete because it still accumulated filtered chain rows in a Kotlin `JSONArray`.
- The implementation was upgraded before push:
  - `SupabaseClient.writeEvaluationChainCandlesForLegs()` now streams page -> filter -> append JSON to temp file -> release page
  - the final chain file is atomically replaced only after a source attempt finishes
  - `MarketMLService` deletes stale partial chain files before rebuild
  - a `chain_filtered_v2_<date>.complete` sentinel is written only after the filtered chain is fully built
  - retries require snapshots file + chain file + complete sentinel before reusing prepared inputs
  - `EVAL_NO_LEGKEYS`, `EVAL_NO_CHAINROWS`, and `EVAL_CHAIN_TRUNCATED` fail loudly instead of producing a misleading done-with-zero state
  - per-page prepare heartbeat is wired into the streaming loop
  - Python `_load_json_file()` now uses `json.load()` instead of reading the whole file into a raw string before parsing
- The old accumulating filtered-chain method was removed so only the streaming path remains callable for day-end evaluation.
- First `v2.4.39 / b270` push failed Android CI because `SupabaseClient.writePagedFilteredChain()` referenced `rowBelongsToIstSessionDate()` before it existed at object scope.
- CI repair applied:
  - refactored `filterRowsByIstSessionDate()` to use an object-level `rowBelongsToIstSessionDate()` helper
  - touched `Marketapp/app/build.gradle.kts` with a no-version-change comment so the path-filtered signed-release workflow reruns

## 2026-06-19 Batched Day-End Evaluation Recovery - v2.4.38 / b269

- Both repos were moved to `v2.4.38 / b269`.
- GitHub push completed on `main`:
  - `Marketapp` commit `7d3bf44`
  - `MarketVivi` commit `fc9cdc4`
- Release metadata was synced correctly:
  - Android `versionName=2.4.38`, `versionCode=269`
  - Python `BRAIN_VERSION=2.4.38`
  - PWA `<title>` updated to `v2.4.38`
  - PWA header label updated to `v2.4.38 · b269`
  - PWA cache-buster updated to `app.js?v=1209`

### Root Cause Framing

- The active failure was no longer candidate generation.
- The post-close teacher pipeline was still fragile because:
  - full-session evaluation was handled as one large in-memory operation
  - a single malformed snapshot/candidate row could abort the whole batch
  - stale/interrupted evaluation state was too easy to create
  - manual recovery messaging was too vague after crashes or failed save steps

### Implemented in `Marketapp`

- `MarketMLService.kt`
  - day-end evaluation now runs as a resumable batch job instead of a single all-at-once `evening_evaluator` call
  - full-session inputs are materialized once to app-internal files under a dedicated `day_evaluation` directory
  - evaluation progress is persisted across phases:
    - `PREPARING`
    - `RUNNING`
    - `SAVING`
    - `AGGREGATING`
    - `DONE`
    - `FAILED`
    - `FAILED_SAVE`
    - `STALLED`
  - progress counters now persist:
    - total snapshots
    - completed snapshots
    - produced outcome count
    - persisted outcome count
  - automatic post-close evaluation behavior is preserved
  - `onDestroy()` no longer clears an active run unconditionally
  - final-save failure is now treated as retryable instead of looking like a generic crash
- `NativeBridge.kt`
  - service status now exposes:
    - evaluation phase
    - progress current/total
    - retryable state
    - last error
    - last job heartbeat/update time
  - stale-run detection is now heartbeat-based and uses a longer timeout
  - manual `triggerDayEvaluation()` now behaves as a recovery path:
    - resumes from the last completed batch when possible
    - or replays the final save step from local outputs
- `brain.py`
  - added evaluation job helpers:
    - `evaluation_job_prepare(...)`
    - `evaluation_job_run_batch(...)`
    - `evaluation_job_finalize(...)`
  - added `_evaluate_snapshot_outcomes(...)` to isolate row-level failures
  - malformed `primary_candidate_json`, `context_json`, or secondary candidate rows no longer kill the full day evaluation run

### Implemented in `MarketVivi`

- ML tab evaluation state now surfaces:
  - phase
  - snapshot progress
  - retryable recovery state
  - clearer button labels for:
    - active evaluation
    - retry
    - blocked/not-ready states
- ML auto-refresh key now includes evaluation phase/progress so the UI updates more honestly during long post-close runs

### Verification Status

- Verified locally:
  - Python syntax compile passed for `brain.py`
  - release markers were synced across both repos before push
  - both repos were pushed successfully to GitHub `main`
- Not verified locally:
  - Android Kotlin/Gradle compile was not run in this environment because `JAVA_HOME` / JDK was unavailable
- Required next live verification:
  1. confirm GitHub Actions produced the signed Android release from the Gradle version bump
  2. install the new APK and verify visible version surfaces all show `v2.4.38 / b269`
  3. let one real post-close evaluation run complete
  4. confirm:
     - progress moves batch-by-batch
     - retry appears only when genuinely needed
     - save/aggregation phases report clearly
     - teacher outcomes persist correctly after a full close cycle

### Follow-up CI Repair After Push

- The first `Marketapp` push for `v2.4.38 / b269` failed GitHub Actions in both:
  - `Market Radar Debug APK / Validation / Build Debug APK`
  - `Market Radar Signed Release / build`
- The failure was **not** a signing or workflow-secret problem.
- Root cause from Actions logs:
  - Kotlin syntax error in `NativeBridge.kt` at line `584`
  - error text: `Expecting an element`
- Local diagnosis confirmed one extra closing parenthesis in the `evaluationReady` expression inside `getServiceStatus()`.
- A narrow local fix has been prepared to remove that unmatched `)` and should be pushed as the next repair commit before trusting any `v2.4.38 / b269` release artifact.
- Repair sequence completed on `2026-06-19`:
  - `Marketapp` commit `4e9840d` fixed the Kotlin syntax error
  - `Marketapp` commit `a6b9b95` touched `app/build.gradle.kts` only to retrigger the path-filtered signed-release workflow without changing `versionName` / `versionCode`
- Final GitHub outcome:
  - `Market Radar Debug APK Validation` passed
  - `Market Radar Signed Release` passed
  - GitHub Release `v2.4.38` was published with `app-release.apk`
  - `releases/latest` now points to `v2.4.38`
- User impact:
  - phones still on `v2.4.37` should now see the update when `Check for update` is pressed, because updater logic compares `BuildConfig.VERSION_NAME` against the latest GitHub release tag

## 2026-06-19 Upstox Historical Ingestion Bootstrap

- Purpose:
  - start a separate offline-quality historical options-candle store for better teacher path reconstruction and later backfill work
  - keep this independent from live `ml_option_chain_snapshots`
- Upstox API status confirmed live on 2026-06-19:
  - the provided **analytics/read-only token** is **not** sufficient for expired-instruments history
  - a proper Upstox user access token with Plus access works for:
    - `expired-instruments/expiries`
    - `expired-instruments/option/contract`
    - `expired-instruments/historical-candle`
- Live probe findings:
  - `NSE_INDEX|Nifty 50` expiries returned successfully
  - returned range was much deeper than the original 6-month expectation:
    - from `2024-10-03` through `2026-06-16`
  - one sample NF contract fetch succeeded:
    - `NIFTY 23750 CE 16 JUN 26`
    - instrument key `NSE_FO|50605|16-06-2026`
    - `450` five-minute bars returned
  - Upstox returns candle rows newest-first, so ingestion must normalize sort order before downstream use

### Supabase Historical Table

- Created new table:
  - `historical_option_candles`
- Schema intent:
  - one row per `(underlying, expiry_date, strike_price, option_type, interval_mins, bar_ts)`
  - unique constraint enforced on that logical key
  - dedicated lookup index created
  - RLS disabled because this ingestion path writes via trusted service-role credentials
- Live verification:
  - service-role access to Supabase confirmed
  - sample rows were successfully inserted and read back from `historical_option_candles`

### Ingestion Script

- Added root utility:
  - `upstox_historical_ingest.py`
- Script design constraints:
  - resumable via checkpoint file
  - bounded, contract-by-contract processing
  - small Supabase upsert chunks
  - retry/backoff on request failures
  - explicit `rate_delay`
  - pilot controls:
    - `--max-expiries`
    - `--max-contracts`
    - `--from-expiry`
    - `--to-expiry`
    - `--dry-run`
- Stability fix applied during implementation:
  - Upstox/Cloudflare blocked Python's default request signature with `Error 1010`
  - resolved by sending a normal browser `User-Agent`
- Write-path fix applied during implementation:
  - Supabase `return=minimal` can return an empty body on successful POST
  - script was patched so empty-body success does not look like JSON failure

### Pilot Results

- Dry-run pilot succeeded:
  - `NF`
  - `1` expiry
  - `2` contracts
  - `900` bars processed
- First real write pilot succeeded:
  - `NF`
  - expiry `2026-06-16`
  - `4` contracts
  - `1798` rows written to `historical_option_candles`
  - Supabase readback confirmed persisted rows
- This proves:
  - Upstox fetch works
  - Supabase storage works
  - checkpointed batch ingestion works
  - the system can scale gradually without relying on a single giant run

### Operating Rule Going Forward

- User instruction accepted on 2026-06-19:
  - continue historical ingestion autonomously in careful batches
  - do **not** ask for confirmation on every batch
  - stop immediately and report if any issue or instability appears
- Working policy:
  - expand scope gradually
  - prefer `NF` first, then `BNF`
  - verify each pilot step before widening batch size or expiry span

### First Autonomous Batch Expansion Completed

- After the initial proof and 4-contract NF pilot, the next controlled expansions were completed on 2026-06-19 without manual intervention between batches.
- `NF` batch 1 completed:
  - expiries:
    - `2026-06-02`
    - `2026-06-09`
    - `2026-06-16`
  - `20` contracts per expiry
  - `60` contracts total
  - `24,318` rows written
- `BNF` batch 1 completed:
  - actual recent expiries exposed by Upstox were monthly, not weekly in the selected range
  - expiries:
    - `2026-03-30`
    - `2026-04-28`
    - `2026-05-26`
  - `20` contracts per expiry
  - `60` contracts total
  - `25,009` rows written
- Aggregate table state after these completed batches:
  - `historical_option_candles` total rows: `49,332`
- One non-failure adjustment was required during BNF expansion:
  - the first guessed BNF date window matched zero expiries
  - this was corrected by probing actual BNF expiries and rerunning with the proper monthly range
- No ingestion hang or write-path instability was observed in these completed batch runs.

### Second Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the same autonomous batch rule and the same cautious operating limits.
- `NF` batch 2 completed:
  - expiries:
    - `2026-05-05`
    - `2026-05-12`
    - `2026-05-19`
    - `2026-05-26`
  - `20` contracts per expiry
  - `80` contracts total
  - `31,407` rows written
- `BNF` batch 2 completed:
  - expiries:
    - `2025-12-30`
    - `2026-01-27`
    - `2026-02-24`
  - `20` contracts per expiry
  - `60` contracts total
  - `16,444` rows written
- Aggregate table state after the second expansion:
  - `historical_option_candles` total rows: `97,183`

### Historical Coverage Note Observed During Older BNF Batches

- Older BNF monthly expiries showed uneven CE-side historical density from Upstox:
  - some CE contracts had sparse bars
  - a few returned `0` bars
- Interpretation:
  - this was observed as source-data variability, not as a pipeline or write failure
  - matching PE contracts in the same filtered windows often had normal/full bar counts
- Working rule:
  - do not treat sparse/zero older-contract rows as ingestion breakage by default
  - preserve the raw outcome in the historical table and let later quality filters decide whether a contract path is usable for teacher/backfill work

### Third Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with one older NF weekly window and one older BNF monthly window.
- `NF` batch 3 completed:
  - expiries:
    - `2026-04-07`
    - `2026-04-13`
    - `2026-04-21`
    - `2026-04-28`
  - `20` contracts per expiry
  - `80` contracts total
  - `29,864` rows written
- `BNF` batch 3 completed:
  - expiries:
    - `2025-09-30`
    - `2025-10-28`
    - `2025-11-25`
  - `20` contracts per expiry
  - `60` contracts total
  - `18,967` rows written
- Aggregate table state after the third expansion:
  - `historical_option_candles` total rows: `146,014`

### Additional Coverage Observation

- Older NF weekly expiries can also show uneven CE-side density on some contracts:
  - example seen in `2026-04-21` filtered CE rows where some strikes had much lower bar counts than their matching PEs
- Interpretation remains the same as for older BNF:
  - source-data coverage varies by contract
  - this is not currently treated as ingestion failure

### Fourth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with one NF March window and one older BNF monthly window.
- `NF` batch 4 completed:
  - expiries:
    - `2026-03-02`
    - `2026-03-10`
    - `2026-03-17`
    - `2026-03-24`
    - `2026-03-30`
  - `20` contracts per expiry
  - `100` contracts total
  - `40,411` rows written
- `BNF` batch 4 completed:
  - expiries:
    - `2025-06-26`
    - `2025-07-31`
    - `2025-08-28`
  - `20` contracts per expiry
  - `60` contracts total
  - `17,451` rows written
- Aggregate table state after the fourth expansion:
  - `historical_option_candles` total rows: `203,876`

### Additional Source-Data Note

- In the `2025-06-26` BNF monthly window, one filtered strike pair returned `0` bars for both CE and PE.
- Current interpretation:
  - still treated as an Upstox historical coverage gap for that contract pair
  - not treated as an ingestion or checkpointing defect

### Fifth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with an NF February 2026 window and a BNF spring 2025 monthly window.
- `NF` batch 5 completed:
  - expiries:
    - `2026-02-03`
    - `2026-02-10`
    - `2026-02-17`
    - `2026-02-24`
  - `20` contracts per expiry
  - `80` contracts total
  - `34,168` rows written
- `BNF` batch 5 completed:
  - expiries:
    - `2025-03-27`
    - `2025-04-24`
    - `2025-05-29`
  - `20` contracts per expiry
  - `60` contracts total
  - `25,898` rows written
- Aggregate table state after the fifth expansion:
  - `historical_option_candles` total rows: `263,942`

### Stronger Historical Coverage Variability Note

- The `2025-03-27` / `2025-04-24` / `2025-05-29` BNF monthly windows showed clearly uneven contract availability from Upstox:
  - some filtered CE contracts were dense/full
  - some nearby CE contracts were sparse
  - a few filtered PE contracts were also zero or near-zero
- This strengthens the earlier conclusion:
  - older historical coverage is contract-specific and irregular in places
  - the ingestion pipeline should preserve raw availability rather than attempting to infer missing bars at ingest time

### Sixth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with an NF January 2026 window and the oldest currently exposed BNF window.
- `NF` batch 6 completed:
  - expiries:
    - `2026-01-06`
    - `2026-01-13`
    - `2026-01-20`
    - `2026-01-27`
  - `20` contracts per expiry
  - `80` contracts total
  - `30,795` rows written
- `BNF` batch 6 completed:
  - expiries:
    - `2024-10-01`
    - `2024-10-09`
    - `2024-10-16`
    - `2024-10-23`
    - `2024-10-30`
  - `20` contracts per expiry
  - `100` contracts total
  - `31,537` rows written
- Aggregate table state after the sixth expansion:
  - `historical_option_candles` total rows: `326,274`

### Oldest-Range Boundary Observation

- The oldest exposed BNF expiry tested so far, `2024-10-01`, returned `0` bars across the full sampled 20-contract window.
- Adjacent older BNF expiries such as `2024-10-09`, `2024-10-16`, `2024-10-23`, and `2024-10-30` returned substantial data.
- Working interpretation:
  - `2024-10-01` is likely a hard historical availability boundary or incomplete expiry in Upstox's expired-instruments store
  - this is treated as a source limit, not as an ingestion defect

### Seventh Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with an NF December 2025 window and the next older BNF late-2024 window.
- `NF` batch 7 completed:
  - expiries:
    - `2025-12-02`
    - `2025-12-09`
    - `2025-12-16`
    - `2025-12-23`
    - `2025-12-30`
  - `20` contracts per expiry
  - `100` contracts total
  - `37,348` rows written
- `BNF` batch 7 completed:
  - expiries:
    - `2024-11-06`
    - `2024-11-13`
    - `2024-11-27`
    - `2024-12-24`
  - `20` contracts per expiry
  - `80` contracts total
  - `20,738` rows written
- Aggregate table state after the seventh expansion:
  - `historical_option_candles` total rows: `384,360`

### Additional Boundary Observation

- `2024-12-24` BNF also returned `0` bars across the full sampled 20-contract filtered window.
- This now gives at least two clearly observed zero-coverage BNF monthly boundary points:
  - `2024-10-01`
  - `2024-12-24`
- Current interpretation:
  - some earliest/edge BNF expiries in Upstox's expired-instruments catalog exist as metadata/contract surfaces but do not carry usable historical candle payloads for the sampled window
  - these should be treated as source-side null coverage, not as ingestion corruption

### Eighth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with:
  - the final two remaining BNF expiries in the current capped 20-contract historical pass
  - the next oldest NF weekly block from October 2024
- `BNF` batch 8 completed:
  - expiries:
    - `2025-01-30`
    - `2025-02-27`
  - `20` contracts per expiry
  - `40` contracts total
  - `16,459` rows written
- `NF` batch 8 completed:
  - expiries:
    - `2024-10-03`
    - `2024-10-10`
    - `2024-10-17`
    - `2024-10-24`
    - `2024-10-31`
  - `20` contracts per expiry
  - `100` contracts total
  - `41,607` rows written
- Aggregate table state after the eighth expansion:
  - `historical_option_candles` total rows: `442,426`

### Current Coverage Position

- `BNF` capped-expiry pass is now complete across the currently exposed Upstox expiry list used in this ingestion workflow.
- `NF` historical coverage is still expanding backward through older weekly expiries.
- After this eighth expansion:
  - `BNF` remaining in the current pass: `0` expiries
  - `NF` remaining in the current pass: `56` expiries

### Fresh Data-Shape Observation

- `BNF` expiry `2025-01-30` returned a dense, clean 20-contract sample with `450` bars on every sampled contract.
- `BNF` expiry `2025-02-27` remained usable but showed some unevenness on a few sampled contracts, for example:
  - `47500 CE` returned `374` bars
  - `47600 CE` returned `336` bars
- Working interpretation:
  - some later BNF expiries are fully dense in the sampled window
  - other nearby expiries still show selective contract-level sparsity even when the expiry overall is usable
  - this remains a source-data characteristic, not an ingestion-path defect

### Ninth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next oldest NF weekly block after the October 2024 pass.
- `NF` batch 9 completed:
  - expiries:
    - `2024-11-07`
    - `2024-11-14`
    - `2024-11-21`
    - `2024-11-28`
    - `2024-12-05`
  - `20` contracts per expiry
  - `100` contracts total
  - `39,455` rows written
- Aggregate table state after the ninth expansion:
  - `historical_option_candles` total rows: `481,881`

### Additional NF Density Observation

- `NF` expiry `2024-11-28` returned a fully dense 20-contract sample with `450` bars on every sampled contract.
- Nearby older NF expiries remained usable but showed selective CE thinning, for example:
  - `2024-11-21` samples were mostly around `300` bars
  - `2024-12-05` included CE rows as low as `124`, `223`, and `263` bars while paired PE rows stayed near `449-450`
- Working interpretation:
  - older NF weekly coverage is still broadly usable
  - density is expiry-specific and often asymmetric between CE and PE in the sampled strike window
  - this is still treated as source-data variability, not a pipeline write defect

### Tenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next NF December 2024 to January 2025 block.
- `NF` batch 10 completed:
  - expiries:
    - `2024-12-12`
    - `2024-12-19`
    - `2024-12-26`
    - `2025-01-02`
    - `2025-01-09`
  - `20` contracts per expiry
  - `100` contracts total
  - `31,317` rows written
- Aggregate table state after the tenth expansion:
  - `historical_option_candles` total rows: `513,198`

### New NF Boundary Observation

- `NF` expiry `2024-12-26` returned `0` bars across the full sampled 20-contract filtered window.
- That creates a clear NF zero-coverage boundary point similar to earlier BNF edge expiries.
- Nearby NF expiries remained usable:
  - `2024-12-12` and `2024-12-19` showed heavy CE thinning but non-zero coverage
  - `2025-01-02` and `2025-01-09` returned strong overall coverage with selective CE sparsity
- Current interpretation:
  - `2024-12-26` appears to be a source-side null-coverage expiry in Upstox's expired-instruments history
  - the ingestion pipeline itself remained healthy because adjacent expiries in the same batch wrote normally

### Eleventh Autonomous Batch Expansion Completed

- Per the explicit stop-check rule, one more NF batch was run after the `2024-12-26` zero-coverage finding to test whether the next historical window also collapsed to zero.
- `NF` batch 11 completed:
  - expiries:
    - `2025-01-16`
    - `2025-01-23`
    - `2025-01-30`
    - `2025-02-06`
    - `2025-02-13`
  - `20` contracts per expiry
  - `100` contracts total
  - `43,886` rows written
- Aggregate table state after the eleventh expansion:
  - `historical_option_candles` total rows: `557,084`

### Post-Zero Check Outcome

- The follow-up batch did **not** reproduce the full zero-coverage pattern.
- Results by interpretation:
  - `2025-01-30` returned a fully dense sampled window with `450` bars on every sampled contract
  - `2025-02-06` returned even denser sampled rows, with multiple contracts in the `501-525` bar range
  - `2025-02-13` remained usable but again showed selective CE thinning while PE stayed near `450`
- Working conclusion after the stop-check batch:
  - `2024-12-26` currently looks like an isolated Upstox null-coverage expiry, not proof that the next historical region is broadly unusable
  - no repeated zero-expiry boundary was observed in the immediately following batch

### Twelfth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next NF late-February to March 2025 block.
- `NF` batch 12 completed:
  - expiries:
    - `2025-02-20`
    - `2025-02-27`
    - `2025-03-06`
    - `2025-03-13`
    - `2025-03-20`
  - `20` contracts per expiry
  - `100` contracts total
  - `40,772` rows written
- Aggregate table state after the twelfth expansion:
  - `historical_option_candles` total rows: `597,856`

### March 2025 Density Observation

- No new full zero-coverage expiry appeared in this block.
- Notable expiry shapes:
  - `2025-02-27` returned a shorter but internally consistent window with `375` bars across all sampled contracts
  - `2025-03-06` and `2025-03-13` were broadly dense with most sampled contracts near `446-450` bars
  - `2025-03-20` remained usable but again showed selective CE thinning, including CE rows as low as `50`, `78`, and `284` while paired PE rows stayed at `375`
- Current interpretation:
  - the source still provides strong usable coverage through this region
  - variation continues to appear mostly as expiry-specific CE truncation rather than whole-expiry failure

### Thirteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next NF late-March to late-April 2025 block.
- `NF` batch 13 completed:
  - expiries:
    - `2025-03-27`
    - `2025-04-03`
    - `2025-04-09`
    - `2025-04-17`
    - `2025-04-24`
  - `20` contracts per expiry
  - `100` contracts total
  - `45,309` rows written
- Aggregate table state after the thirteenth expansion:
  - `historical_option_candles` total rows: `643,165`

### April 2025 Mixed-Length Observation

- No whole-expiry zero-coverage failure appeared in this block.
- The source shape diversified further:
  - `2025-04-17` was short but internally consistent, clustering near `300` bars
  - `2025-04-03` mixed `755`, `375`, mid-range CE values, and one `0`-bar CE contract in the sampled window
  - `2025-04-24` was very dense, with many contracts in the `624-755` bar range
- Current interpretation:
  - April 2025 coverage is clearly usable but no longer follows a single consistent session-length pattern
  - the dominant issue remains contract-level asymmetry or variable bar depth, not whole-expiry collapse
  - transient Supabase readback instability was observed once as a `500` during post-batch count verification, but retry succeeded and ingestion writes themselves were unaffected

### Fourteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next NF May 2025 block.
- `NF` batch 14 completed:
  - expiries:
    - `2025-05-08`
    - `2025-05-15`
    - `2025-05-22`
    - `2025-05-29`
  - `20` contracts per expiry
  - `80` contracts total
  - `28,723` rows written
- Aggregate table state after the fourteenth expansion:
  - `historical_option_candles` total rows: `671,888`

### May 2025 Selective CE Collapse Observation

- No whole-expiry failure appeared in this block.
- The May 2025 pattern was consistent with strong PE continuity and heavy CE asymmetry:
  - `2025-05-08` included one sampled CE contract with `0` bars and several others under `200`
  - `2025-05-15`, `2025-05-22`, and `2025-05-29` remained broadly usable but repeatedly showed CE truncation in the `43-240` range while paired PE contracts stayed near `375-450`
- Additional execution note:
  - the requested date window exposed only `4` NF expiries, so this batch naturally completed at `80` contracts instead of `100`
- Current interpretation:
  - the source remains valuable through May 2025
  - CE-side degradation is becoming a recurring pattern in some weekly windows, but it is still not presenting as whole-expiry collapse

### Fifteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with the next NF June 2025 block.
- `NF` batch 15 completed:
  - expiries:
    - `2025-06-05`
    - `2025-06-12`
    - `2025-06-19`
    - `2025-06-26`
  - `20` contracts per expiry
  - `80` contracts total
  - `30,264` rows written
- Aggregate table state after the fifteenth expansion:
  - `historical_option_candles` total rows: `702,152`

### June 2025 Execution And Density Note

- The first launch of batch 15 failed immediately with `Supabase HTTP 401: Invalid API key`.
- Root cause:
  - operator-side malformed `SUPABASE_SERVICE_ROLE` value in the shell export
  - not a source-data problem
  - not an ingestion-script defect
- Recovery:
  - reran the same batch with the correct key
  - checkpointed flow resumed cleanly with no meaningful lost work
- Source-shape findings after the successful rerun:
  - no whole-expiry zero-coverage failure appeared
  - June 2025 continued the same CE-vs-PE asymmetry pattern
  - `2025-06-05`, `2025-06-12`, `2025-06-19`, and `2025-06-26` all remained usable
  - several CE contracts dropped into low-count ranges such as `52`, `56`, `98`, `116`, `118`, `141`, and `149` while paired PE rows remained near `450`
- Current interpretation:
  - June 2025 still adds useful teacher-path coverage
  - the dominant issue remains selective CE truncation, not expiry-level collapse or pipeline instability

### Sixteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with a deliberately wider NF July-August 2025 run.
- This was the first intentional speedup by expiry-count widening rather than contract-count widening.
- `NF` batch 16 completed:
  - expiries:
    - `2025-07-03`
    - `2025-07-10`
    - `2025-07-17`
    - `2025-07-24`
    - `2025-07-31`
    - `2025-08-07`
  - `20` contracts per expiry
  - `120` contracts total
  - `47,998` rows written
- Aggregate table state after the sixteenth expansion:
  - `historical_option_candles` total rows: `750,150`

### Wider-Run Stability Conclusion

- Increasing expiry count from the usual `4-5` range to `6` in a single run did **not** introduce instability.
- The run completed cleanly with:
  - no hang
  - no retry-worthy source failure
  - no whole-expiry zero-coverage collapse
- This strengthens the operating rule:
  - if faster progress is needed, widen by expiries per run before increasing contracts per expiry

### July-August 2025 Density Observation

- Source behavior remained broadly usable through this wider window:
  - PE contracts stayed very steady near `450`
  - CE contracts remained irregular but mostly non-zero
- Notable shapes:
  - July weekly expiries continued the familiar CE truncation pattern, with CE counts like `70`, `83`, `117`, `136`, `152`, `163`, `199`, `204`, and `230`
  - `2025-08-07` was notably stronger, with most sampled CE contracts in the `414-450` range and no zero-coverage contract in the sampled window
- Current interpretation:
  - the widened batch strategy is safe at this level
  - later 2025 NF coverage is still high-value and does not currently show expiry-level breakdown

### Seventeenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with another widened NF run covering late August into September 2025.
- `NF` batch 17 completed:
  - expiries:
    - `2025-08-14`
    - `2025-08-21`
    - `2025-08-28`
    - `2025-09-02`
    - `2025-09-09`
    - `2025-09-16`
  - `20` contracts per expiry
  - `120` contracts total
  - `44,545` rows written
- Aggregate table state after the seventeenth expansion:
  - `historical_option_candles` total rows: `794,695`

### Late-August / September 2025 Shape Observation

- The widened expiry-count approach remained stable again:
  - no hang
  - no expiry-level zero-coverage failure
  - no retry or recovery event required
- Source pattern stayed usable but heterogeneous:
  - `2025-08-14` looked relatively strong, with many CE contracts in the `416-450` range
  - `2025-08-21` and `2025-08-28` clustered closer to a `375`-bar PE regime with mid-range CE truncation
  - early September (`2025-09-02`, `2025-09-09`, `2025-09-16`) continued the same PE stability with CE counts often landing between roughly `59` and `386`
- Current interpretation:
  - widening expiry count to `6` is now validated across more than one run
  - later 2025 NF data still provides substantial teacher-path value even when CE depth remains uneven

### Eighteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with another widened NF run covering late September through late October 2025.
- `NF` batch 18 completed:
  - expiries:
    - `2025-09-23`
    - `2025-09-30`
    - `2025-10-07`
    - `2025-10-14`
    - `2025-10-20`
    - `2025-10-28`
  - `20` contracts per expiry
  - `120` contracts total
  - `41,162` rows written
- Aggregate table state after the eighteenth expansion:
  - `historical_option_candles` total rows: `835,857`

### Late-September / October 2025 New Regime Observation

- The widened run remained stable:
  - no hang
  - no retry event
  - no whole-expiry zero-coverage collapse
- New source-shape detail:
  - `2025-09-30` contained one isolated zero-bar CE/PE strike pair while surrounding strikes remained usable
  - `2025-10-07` returned a shorter but internally consistent `375`-bar style window
  - `2025-10-28` introduced another shorter but internally consistent PE regime around `312` bars, with CE rows scaled down alongside it
- Current interpretation:
  - later 2025 NF data still looks usable for teacher-path enrichment
  - source session length is no longer just a `450` vs `375` story; there are now additional internally consistent shorter regimes
  - isolated zero-strike gaps continue to look like contract-level source anomalies rather than expiry-level failure

### Nineteenth Autonomous Batch Expansion Completed

- Continued on 2026-06-19 with another widened NF run covering November through early December 2025.
- `NF` batch 19 completed:
  - expiries:
    - `2025-11-04`
    - `2025-11-11`
    - `2025-11-18`
    - `2025-11-25`
    - `2025-12-02`
    - `2025-12-09`
  - `20` contracts per expiry
  - `120` contracts total
  - `43,908` rows written
- Aggregate table state after the nineteenth expansion:
  - `historical_option_candles` total rows: `864,368`

### November / Early December 2025 Continuity Observation

- The widened expiry-count strategy remained stable again:
  - no hang
  - no retry event
  - no expiry-level zero-coverage collapse
- Source pattern remained consistent with prior late-2025 observations:
  - PE contracts stayed highly stable near `450`
  - CE contracts remained variable, with some deeper truncations such as `27`, `54`, `85`, `125`, `132`, `137`, `144`, `151`, `175`, `176`, `178`, and `198`
  - despite that CE asymmetry, every expiry in this run stayed usable at the aggregate level
- Current interpretation:
  - widened `6`-expiry runs are still operating safely
  - late-2025 NF remains valuable for teacher-path enrichment even though CE-side incompleteness is persistent
  - no new evidence of a hard historical boundary was observed in this block

### Coverage Audit And Overlap Finding

- After batch 19, a coverage audit was run against:
  - the live Upstox NF expired-expiry list
  - all local NF checkpoint files
- Audit result:
  - total NF expiries exposed by Upstox in this session: `90`
  - NF expiries already covered by checkpointed ingestion: `89`
  - true remaining NF expiry gaps: `1`
- The single remaining uncovered NF expiry identified by the audit is:
  - `2025-04-30`

### Twentieth Run Was Overlap, Not New Coverage

- A subsequent widened run was allowed to complete before the full audit was done.
- That run processed:
  - `2025-12-16`
  - `2025-12-23`
  - `2025-12-30`
  - `2026-01-06`
  - `2026-01-13`
  - `2026-01-20`
- Script-reported work:
  - `120` contracts
  - `45,313` rows processed/upserted
- But Supabase table total did **not** increase after that run:
  - remained `864,368`
- Audit confirmed why:
  - `2025-12-16`, `2025-12-23`, `2025-12-30` were already covered in `upstox_ingest_nf_batch7_state.json`
  - `2026-01-06`, `2026-01-13`, `2026-01-20` were already covered in `upstox_ingest_nf_batch6_state.json`
- Working conclusion:
  - the pipeline was healthy
  - the zero net growth was caused by duplicate upsert overlap, not by source failure or write failure
  - future continuation should use audited remaining-expiry selection instead of broad calendar windows

### Twenty-First Run Closed The Final NF Gap

- Continued on 2026-06-19 with the single audited remaining NF expiry only.
- `NF` batch 21 completed:
  - expiry:
    - `2025-04-30`
  - `20` contracts
  - `9,957` rows written
- Aggregate table state after the twenty-first expansion:
  - `historical_option_candles` total rows: `874,325`

### Final NF Coverage Result

- The final audited NF gap is now closed.
- Coverage audit outcome after batch 21:
  - total NF expiries exposed by Upstox in this session: `90`
  - NF expiries covered by checkpointed ingestion: `90`
  - remaining NF expiries: `0`
- Current interpretation:
  - NF historical ingestion is now complete for the full expiry list exposed in this session
  - no duplicate overlap remains in the NF pass
  - the only meaningful next work, if needed, is BNF re-audit for any future newly exposed expiries or a schema/use-case expansion, not more NF backfill

## 2026-06-16 Candidate-Flow / Teacher Diagnostics - v2.4.31 / b262 and v2.4.32 / b263

- Live market diagnosis on 2026-06-16 established:
  - `ml_brain_snapshots` was writing
  - `ml_generated_candidates` was `0`
  - `primary_candidate_json = {}`
  - `top_candidates_json = []`
  - `context_json` was large and contained chain/market context
  - `context_json.snapshot_generated_candidates = []`
  - `context_json.candidates = []`
- This ruled out:
  - Supabase as the primary fault
  - teacher evaluation as the root cause
  - Kotlin stripping candidate arrays from the saved snapshot contract
- Claude second-opinion conclusion accepted:
  - the candidate arrays were already empty when `take_poll_snapshot()` ran
  - most likely failure mode is generation skip before gates, especially `spot <= 0`
  - rich `context_json` only proves inbound `ctx` had market context; it does not prove candidate generation ran

### v2.4.31 / b262

- Both repos were moved to `v2.4.31 / b262`.
- Added `Candidate Pipeline Diagnostics` in the ML tab.
- Added zero-candidate logging on Android:
  - `ML_GENERATED_CANDIDATES_SKIP`
  - includes rejected count, trace accepted/rejected, top rejection stages, poll timestamp
- Purpose:
  - convert opaque zero-candidate days into diagnosable sessions
  - separate “nothing survived gates” from generic blank output

### v2.4.32 / b263

- Both repos were moved to `v2.4.32 / b263`.
- Accepted Claude A+B candidate-pipeline fix sequence:
  - persist structured generation skip reasons
  - persist rejected rows into `ml_generated_candidates` instead of dropping zero-accepted days
- Implemented in `Marketapp`:
  - `brain.py`
    - `generation_skip_reason`
    - `generation_skip_reasons`
    - skip reasons recorded for:
      - missing chain
      - missing strikes
      - missing atm
      - `spot_zero`
    - snapshot context now includes:
      - `snapshot_generation_skip_reason`
      - `snapshot_generation_skip_reasons`
    - elephant fact pack now carries:
      - rejected candidate stats
      - rejected candidate sample
      - generation skip reason(s)
  - `MarketWatchService.kt`
    - when accepted candidates are empty:
      - logs skip diagnostics
      - persists compact rejected rows to `ml_generated_candidates`
    - rejected rows use deterministic synthetic `candidate_id`s so the existing table schema remains valid
- Implemented in `MarketVivi`:
  - `Candidate Pipeline Diagnostics` now shows explicit skip reason and skip code
  - UI distinguishes:
    - skipped before generation
    - generated then rejected by gates
- Important schema choice:
  - no new Supabase columns were required for `ml_generated_candidates`
  - rejected rows are encoded through the existing compact table shape

### Current Architecture Reading After 2026-06-16

- Immediate blocker:
  - candidate flow must be restored first
- Current strongest hypothesis:
  - `spot` is resolving to `0` in live generation path for at least some sessions
- Required next verification on live `b263`:
  1. check whether `snapshot_generation_skip_reason` populates
  2. verify rejected rows reach `ml_generated_candidates` on zero-accepted polls
  3. determine whether the day is:
     - generation skip
     - gate rejection
     - or accepted-candidate persistence failure

## 2026-06-17 Live Verification - Candidate Store Root Cause Closed

- Installed app was confirmed on `v2.4.32 / b263`.
- Early live poll evidence on 2026-06-17 showed:
  - `ml_brain_snapshots > 0`
  - `ml_generated_candidates = 0`
  - ML UI diagnostics showed:
    - `Generated: 16`
    - `Watchlist: 7`
    - `Rejected: 318`
    - `Trace accepted: 16`
    - `Trace rejected: 318`
  - Live brain output was active, not skipped:
    - decision source `ML_UNSURE_FALLBACK`
    - action `SELL PREMIUM`
    - strategy `IRON_CONDOR`
- This proved:
  - candidate generation was working
  - ranking/watchlist selection was working
  - snapshot persistence was working
  - the remaining failure was specifically the `ml_generated_candidates` insert path

### 2026-06-17 Root Cause

- Exported app logs showed the exact insert failure:
  - `ML_GENERATED_CANDIDATES_HTTP`
  - HTTP `401`
  - Postgres body code `42501`
  - `new row violates row-level security policy for table "ml_generated_candidates"`
- Final diagnosis:
  - not a Python generation bug
  - not a teacher bug
  - not a snapshot-contract bug
  - not a Kotlin candidate-assembly bug
  - root cause was Supabase RLS on `ml_generated_candidates`

### 2026-06-17 Supabase Fix

- Supabase policy fix was applied live:
  - anon insert allowed on `public.ml_generated_candidates`
  - anon select allowed on `public.ml_generated_candidates`
- After one fresh poll:
  - `ml_generated_candidates` count moved from `16` to `51`
- This closed the persistence fault line.

### 2026-06-17 Post-Fix Verification Result

- Query of latest `ml_generated_candidates` rows showed all three row classes now persist:
  1. surfaced accepted candidates
  2. unsurfaced accepted candidates
  3. rejected-only rows with explicit rejection stages/reasons
- Example persisted accepted shape:
  - `candidate_id = BEAR_PUT_...` / `BEAR_CALL_...`
  - `execution_gate = READY`
  - `was_surfaced = true|false`
- Example persisted rejected shape:
  - `candidate_id = rej_...`
  - `execution_gate = rejected:sigma_otm_too_close` or `rejected:sigma_otm_too_far`
  - `entry_action` carries compact rejection reason text

### Current State After 2026-06-17

- Candidate-store path is now working.
- Rejected-row persistence is now working.
- Candidate generation is no longer the active blocker.
- Remaining live ML work is downstream:
  - post-close teacher evaluation production
  - teacher matrix population
  - old-vs-honest comparison population once evaluable rows exist

## 2026-06-16 Claude Logic Audits - Accepted Architectural Findings

### Candidate-to-Snapshot Contract Audit

- Accepted findings:
  - candidate arrays are written unconditionally by `take_poll_snapshot()`
  - therefore empty arrays in saved snapshots were empty at source
  - Kotlin is not stripping candidate arrays from `context_json`
  - the likely root issue is skip-before-generation, not snapshot corruption
- Accepted sequencing:
  - A. persist rejected candidates for offline analysis
  - B. persist structured generation skip reasons
  - C. only then fix the exact spot-key mismatch once identified

### God-Mode Logic Audit

- Accepted as roadmap-level findings, not immediate emergency patches:
  - live ranker is still optimizing on structurally weak truth inputs
  - raw EV is tail-blind
  - constant `0.85 * VIX` realized-vol proxy is too blunt and likely regime-wrong
  - calibration built from contaminated / optimistic trade outcomes is not trustworthy
  - teacher and ranker objectives are still inconsistent
  - teacher stop-loss path still has optimism leakage on gap-through stops
  - hard generation gates likely delete evidence the teacher should later judge
- Priority order currently adopted:
  0. fix candidate-flow skip path so data flows
  1. replace opaque zero-candidate days with structured skip/reject evidence
  2. then inspect/fix spot-key mismatch if confirmed
  3. then tighten teacher honesty:
     - stop-loss gap handling
     - granular path source
     - swing path coverage
  4. then rebuild truth inputs:
     - realized-vol proxy
     - calibration from teacher labels
  5. then rebuild ranking objective:
     - tail / ruin penalty
     - converge ranker objective to managed-exit expectancy
  6. only after that, revisit gate-to-prior conversion

## Current Ordered Execution Plan

1. Next live market-hours verification on `v2.4.32 / b263`
   - confirm installed build is really `b263`
   - inspect `Candidate Pipeline Diagnostics`
   - determine skip vs reject vs accept
   - if skip, capture exact skip reason
   - if reject, verify rejected rows persist to `ml_generated_candidates`
2. Spot-resolution root-cause fix
   - compare Kotlin live poll spot key(s) vs `_latest_spot_value()` read keys
   - patch only the confirmed mismatch
3. Teacher integrity repairs
   - remove stop-loss cap optimism on gap-through exits
   - verify granular chain-path source for intraday labels
   - verify swing path spans entry to expiry
4. Truth-input rebuild
   - realized-vol series instead of constant `0.85 * VIX`
   - calibration from teacher labels, not contaminated `trades_v2`
5. Ranker rebuild
   - risk-adjusted expectancy instead of raw tail-blind EV
   - converge ranker objective to teacher-managed exit objective

## Current Ordered Execution Plan

1. Monday live verification during market hours
   - verify one real candidate-producing poll
   - verify `ml_generated_candidates` write path
   - verify live teacher-shadow persistence
   - verify old-vs-honest teacher comparison is populated correctly
   - verify live decision output stays aligned with deterministic ranking + ML annotation
2. Teacher shadow backfill / comparison review
   - run historical relabel against stored snapshots and chain path
   - inspect lane-wise old win rate vs teacher success rate vs expectancy
   - keep legacy consumer unchanged until the comparison is accepted
3. Paper-trade realized P&L realism v2
   - correct the realized close path so persisted paper outcomes are not driven by `trade.current_pnl ?? 0`
   - apply slippage and transaction costs exactly once at close, not in live mark-to-market
   - keep this exit model aligned with the teacher friction/exit model
4. Economics-aware confidence correction
   - reduce overconfident scores on weak-payoff multi-leg setups
   - tie confidence more tightly to actual rupee reward, not only structural conviction
5. Full ranking rebuild
   - only after live verification and corrected P&L calibration
   - preserve EV / true-probability math until characterization work is ready
6. Stage 0 characterization harness
   - capture real chain-rich fixtures and freeze ranking/P&L baselines before deeper ranker changes
7. Oracle / LLM reliability follow-up
   - revisit Oracle VM and provider stability only after live market behavior is understood

## 2026-06-16 Teacher v1 Shadow Rollout - v2.4.30 / b261

- Both repos are now aligned at:
  - Android `versionName=2.4.30`, `versionCode=261`
  - Python `BRAIN_VERSION=2.4.30`
  - signed Android GitHub release `v2.4.30` published successfully
- Supabase schema was prepared before push for the new shadow-teacher fields in:
  - `ml_evaluation_outcomes`
  - `ml_recommendation_outcomes`
- Implemented Claude directive `DIRECTIVE_TEACHER_HONEST_LABELING_20260615.md` as a shadow rollout.
- Core architecture change:
  - fixed-H2 single-sample labeling is no longer the only truth path
  - `brain.py` now computes a managed-exit teacher label using path walk + friction + TP/SL/EOD semantics
- Managed teacher logic now records:
  - `managed_pnl`
  - `managed_gross_pnl`
  - `friction_cost`
  - `exit_reason`
  - `exit_step`
  - `exit_ts`
  - `r_multiple`
  - `captured_pct`
  - `is_success`
  - `risk_at_entry`
  - `regime_bucket`
  - `label_version='teacher_v1'`
  - `teacher_config_version`
  - `tp_threshold`
  - `sl_threshold`
  - `break_even_win_rate_pct`
- Legacy fields remain intentionally unchanged for shadow phase:
  - `sim_pnl_h2`
  - `canonical_won`
  - `outcome_h2`
  - `won`
- Important evaluation input repair:
  - `fetchEvaluationSnapshots()` now includes `context_json`
  - this restores access to stored generated candidates during post-close evaluation
- Path source used by the teacher:
  - evaluation now reads from `ml_option_chain_snapshots` path rows through `fetchEvaluationChainSlices(...)`
  - this is materially better than relying on the old H2-only late-window snapshot
- Shared friction/config rule now exists:
  - Kotlin `TeacherTruthConfig` is the source exported to JS
  - PWA cost estimation reads the same config via `NativeBridge.getTeacherTruthConfig()`
  - this reduces drift between teacher accounting and app-side display accounting
- ML UI/reporting changes:
  - added `Teacher v1 Shadow Review`
  - added `Old vs Honest Teacher`
  - `4-Lane Training Matrix` became `4-Lane Teacher Matrix`
  - reporting is now expectancy-first for teacher shadow metrics
  - paper-training card explicitly states the legacy consumer is still active until switch gate
- Added teacher comparison summary in native summary payload:
  - primary-only legacy win rate
  - primary-only teacher success rate
  - teacher expectancy in `R`
  - teacher break-even win rate
  - lane-level comparison table
- Verification completed locally:
  - `brain.py` AST parse passed
  - focused teacher tests passed
  - `app.js` parse passed
- Android local Gradle compile remained blocked by environment/build-system issue:
  - `Failed to transform R.jar ... Check failed`
  - signed GitHub release still succeeded, which is the user-facing source of truth for this version
- Current status:
  - code is shipped
  - schema is ready
  - signed release exists
  - live market-hours verification is still pending
  - historical backfill / comparison review is still pending before any switch from legacy labels

## 2026-06-14 Ranking Stage 1 - v2.4.23 / b254

- Implemented the only pre-Monday-safe part of `DIRECTIVE_RANKING_CORRECTION_20260614.md`.
- Changed `brain.py` `_get_strike_pairs(...)` so it no longer returns `pairs[:10]`.
- Result:
  - wall/in-band strike pairs are no longer discarded before sigma/probability gates
  - those pairs can now reach the existing deterministic ranker
- Explicitly unchanged:
  - `rank_candidates(...)`
  - EV / `true_prob` / probability math
  - gate thresholds and gate ordering
  - ML weighting and confidence logic
- Added focused regression:
  - [test_stage1_strike_pair_truncation.py](/root/.openclaw/Marketapp/app/src/main/python/tests/test_stage1_strike_pair_truncation.py)
- Added self-audit:
  - [RANKING_STAGE1_SELF_AUDIT_20260614.md](/root/.openclaw/Marketapp/RANKING_STAGE1_SELF_AUDIT_20260614.md)
- Monday live verification should now check candidate-producing polls for:
  - sane watchlist size
  - wall/in-band candidates appearing when market structure supports them
  - no unexpected expansion from the removed pre-ranking cap

## 2026-06-14 Paper P&L Realism Review (v2 directive accepted, not implemented yet)

- Reviewed the original paper-trade P&L directive and the revised
  `DIRECTIVE_PAPER_PNL_REALISM_20260614_v2.md` against current code and the
  exported workbook `MarketRadar_Export_2026-06-14.xlsx`.
- Current accepted implementation spec is **v2**. It supersedes the earlier
  directive because it correctly places `brain.py compute_position_live()` in scope.
- The Excel warning about `32 oversized cell(s)` is NOT the P&L issue:
  - truncation is confined to config audit sheets (`App Config Audit`, `app_config`)
  - no oversized-cell evidence was found in `trades_v2`, `ml_decisions`,
    `chain_snapshots`, or the flat poll sheets
  - therefore the workbook is still usable as evidence for the paper-trade P&L defect
- Confirmed the directive's core code finding in [app.js](/root/.openclaw/MarketVivi/app.js):
  - realized close path still writes paper outcomes from `trade.current_pnl ?? 0`
  - producer sites remain:
    - `closedWon = (trade.current_pnl ?? 0) > 0`
    - `actual_pnl: trade.current_pnl ?? 0` in `DB.updateTrade(...)`
    - `outcome_pct_of_max` derived from `trade.current_pnl ?? 0`
    - `actual_pnl: trade.current_pnl ?? 0` in ML outcome writeback
- Current `current_pnl` origin is now known and should be treated as the P2 recon finding:
  - Python `brain.py` `compute_position_live(...)` computes raw mark-to-market P&L
  - Kotlin `MarketWatchService.kt` writes that raw live value into local `open_trades`
  - `NativeBridge.getOpenTrades()` serves the local state to the PWA
  - no slippage or transaction cost is currently applied in this live mark path
- Existing realism constants are present in PWA and are reusable:
  - per-leg slippage constants are defined in `app.js`
  - cost estimation logic exists for display/summary use, but is not centralized into the
    realized close path yet
- Important analytical conclusion:
  - the paper-trade realized P&L problem is real and is a measurement issue, not only a UI/reporting issue
  - fix should apply cost/slippage exactly once at the realized close boundary, not in the live poll mark path
  - `RECORD == DISPLAY` is the correct target invariant at the realized close boundary
  - preferred implementation caution:
    - do not invent stale short-leg marks casually when LTP is missing
    - prefer explicit unpriceable-state handling unless a time-bounded cached-mark rule is made precise

### Upstox Reference Model Accepted on 2026-06-17

- Reviewed external file `UPSTOX_TRADING_PROJECT_COMPLETE_KNOWLEDGE.md` and accepted the following as the broker-reference model we should align to conceptually.
- Upstox `Get Positions` returns separate position fields including:
  - `pnl`
  - `unrealised`
  - `realised`
  - `buy_value`
  - `sell_value`
  - `average_price`
  - `last_price`
- Upstox also exposes dedicated charge surfaces:
  - `GET /v2/charges/brokerage`
  - returns:
    - `total`
    - `brokerage`
    - `taxes` (`gst`, `stt`, `stamp_duty`)
    - `other_charges` (`transaction`, `clearing`, `ipft`, `sebi_turnover`)
- For multi-leg structures, Upstox margin is checked using:
  - `POST /v2/charges/margin`
  - all four IC/IB legs should be passed together

### Project Interpretation of the Upstox Model

- The current app should not blur these states together:
  1. gross live mark-to-market
  2. estimated exit cost
  3. net-if-closed-now
  4. realized closed P&L
- Current code still mixes these concepts too loosely:
  - Python produces raw live `current_pnl`
  - PWA subtracts estimated round-trip cost for display
  - realized close path still persists from `trade.current_pnl ?? 0`
- This is now treated as an architecture mismatch with the broker-style reference model, not just a UI quirk.

### Required P&L Output Model Going Forward

- Open trades must expose:
  - `Gross MTM`
  - `Estimated exit cost`
  - `Net if closed now`
- Closed trades must expose:
  - `Realized closed P&L`
- Cost/slippage must be applied exactly once at the close boundary for realized results.
- The open-trade headline should not make `gross MTM` look like `realized net`.

## 2026-06-14 Confidence vs Economics Observation

- A user-observed case prompted direct code review:
  - high brain confidence (~90%) on a 4-leg trade
  - but only ~`₹231` peak profit
- Current code indicates this is NOT automatically an arithmetic bug:
  - candidate economics are computed from net credit/debit × lot size in `brain.py`
  - four-leg structures can legitimately have very small `maxProfit` if net credit is thin
- The more important issue is modeling:
  - confidence currently reflects structural/decision conviction
  - it is not tightly capped by absolute rupee reward
  - verdict alignment logic can floor/lift confidence even when the economic payload is weak
- Working conclusion:
  - the app may be computing that low absolute profit correctly
  - but the brain likely overstates conviction on weak-payout setups
  - this should later become an economics-aware confidence-cap / downgrade task

## 2026-06-14 Candidate Ranking Audit (Stage 1 implemented; full rebuild pending)

- Reviewed `DIRECTIVE_RANKING_CORRECTION_20260614.md` against current `brain.py`.
- Added local audit note:
  - [RANKING_AUDIT_20260614.txt](/root/.openclaw/RANKING_AUDIT_20260614.txt)
- Confirmed the directive's main ranker finding:
  - `rank_candidates()` uses a lexicographic tuple
  - after safety and tier gates, `premiumEdge` usually decides the ordering
  - later signals such as verdict alignment, win-rate, forces, context, gamma, wall score,
    probability, and ML mostly act only as rare exact-tie breakers
- Confirmed the safer immediate defect:
  - `_get_strike_pairs()` enumerates nearest-ATM pairs first
  - wall-anchored pairs are appended later
  - `return pairs[:10]` can discard wall/in-band candidates before ranking
- Synthetic proof captured:
  - NF `BULL_PUT`, ATM `23500`, width `150`, put wall `22800`
  - current function returned only 10 near-ATM pairs
  - wall sell `22800` did not reach ranking
- Accepted sequencing:
  - Stage 1 truncation fix was implemented in `v2.4.23 / b254`
  - full weighted-score rebuild is gated behind real fixtures, corrected P&L calibration, and Monday live review
  - EV / true-probability math must remain untouched until the planned rebuild

## Post-Monday TODO

- Monday market-hours verification remains the priority:
  - live branching / edge-case observation
  - real `ml_generated_candidates` write proof on a candidate-producing poll
  - clean post-close ML evaluation verification
- After Monday verification, next queued implementation topics are:
  1. paper-trade realized P&L realism directive v2 (`DIRECTIVE_PAPER_PNL_REALISM_20260614_v2.md`)
  2. economics-aware confidence governance for low-payout setups
  3. ranking post-Stage-1 review:
     - confirm live candidate volume remains sane
     - decide later weighted-score rebuild only after real fixtures and P&L calibration
  4. Stage 0 characterization harness with real chain-rich snapshots
  5. bounded observability / parity work already queued under Claude framework steps

## 2026-06-13 Reconciliation Batch - v2.4.22 / b253

- Bumped both repos to shared version `v2.4.22 / b253`.
- Applied the reconciliation directive against the `b252` Round 0 batch.
- Upgraded the observe-only qualitative schema to `qualitative_prompt_v2`.
- Replaced ungradeable Elephant enums with gradeable values:
  - `distribution_signal = genuine|hedging|ambiguous|unclear`
  - `coherence_read = aligned|conflicted|unclear`
- Removed `support` from `candidate_notes.stance`; the set is now:
  - `neutral|caution|ignore`
- Locked candidate notes as display/logging only, with no approval/ranking/confidence authority.
- Wired `signal_coherence()` into deterministic confidence as a subtract-only caution penalty.
- Added the tracked self-audit:
  - [RECONCILIATION_SCOPE_AUDIT_b252_20260613.md](/root/.openclaw/Marketapp/RECONCILIATION_SCOPE_AUDIT_b252_20260613.md)
- Required Claude framework checks still pass locally after the reconciliation patch.
- PWA label updated to `v2.4.22 · b253`.
- Cache-bust updated to `app.js?v=1194`.

## 2026-06-13 Claude Framework Prep - v2.4.21 / b252

- Bumped both repos to shared version `v2.4.21 / b252`.
- Implemented Claude Round 0 as an observe-only framework change:
  - Oracle `/elephant` prompt no longer asks for arithmetic approval/judgment
  - new qualitative schema:
    - `distribution_signal`
    - `coherence_read`
    - `anomaly_flag`
    - `anomaly_reason`
    - `brief`
    - `candidate_notes`
  - raw request/response persistence remains intact
  - Oracle now also stores `normalized_flags` as a stable qualitative block
- Updated native fact-pack generation:
  - `quality_tag` now reports `qualitative_prompt_v1`
  - `coherence_signal` is exported from `brain.py` into the Elephant handoff payload
- Added local Claude framework test infrastructure in `Marketapp`:
  - `test_round0_elephant_schema.py`
  - `test_candidate_parity_contract.py`
  - `capture_candidate_parity_fixture.py`
  - `run_claude_framework_checks.py`
  - `fixtures/candidate_parity_template.candidate_parity.json`
  - `fixtures/CANDIDATE_PARITY_FIXTURE_README.txt`
- Current framework result:
  - required Claude checks pass locally:
    - Gate 5 trace smoke
    - Round 0 Elephant qualitative schema
    - candidate parity contract currently cleanly skips until a real rich fixture is captured
  - older legacy fixture-baseline tests are now explicitly treated as stale:
    - `fixture_a/b/c` do not carry `bnfChain` / `nfChain`
    - they are still useful for legacy verdict-level drift awareness
    - they are not sufficient for top-1 / top-6 candidate parity
- Monday market-hours requirement:
  - capture one real chain-rich poll bundle
  - generate a `.candidate_parity.json` fixture and baseline
  - freeze exact top-1 and top-6 before any Round 1 / Round 2 gate reform
- Version alignment:
  - Android `versionName=2.4.21`, `versionCode=252`
  - `BRAIN_VERSION=2.4.21`
  - PWA label `v2.4.21 · b252`
  - cache-bust updated to `app.js?v=1193`

## 2026-06-12 Bridge Export Repair - v2.4.20 / b251

- Bumped both repos to shared version `v2.4.20 / b251`.
- Fixed the actual reason `b250` still showed the lane-backfill warning and zero matrix:
  - `NativeBridge.getMLEvaluationLaneSummary()` existed in Kotlin
  - but `MainActivity.injectNativeBridge()` did not expose it into the WebView `window.NativeBridge`
  - so the phone could not call the new native lane-summary path and fell back to the warning branch
- Added the missing WebView bridge export:
  - `getMLEvaluationLaneSummary(limit) { return AndroidBridge.getMLEvaluationLaneSummary(limit || 1000); }`
- Version alignment:
  - Android `versionName=2.4.20`, `versionCode=251`
  - `BRAIN_VERSION=2.4.20`
  - PWA label `v2.4.20 · b251`
  - cache-bust updated to `app.js?v=1192`
- Live verification after install confirmed the lane matrix finally renders from the
  repaired data contract:
  - `NF intraday`: `11 rows / 11 labeled / 4 wins / 36.4%`
  - `BNF intraday`: `6 rows / 6 labeled / 0 wins / 0.0%`
  - swing lanes remained `0`
- This closes the main ML evaluation/reporting defect for 2026-06-12:
  - evaluation executed
  - outcomes persisted
  - attribution backfill succeeded
  - on-device matrix rendered correctly after the bridge export fix
- Remaining minor defect after `b251`:
  - header/session badge correctly caps to `76/76`
  - footer status can still show uncapped raw poll count (`Polls: 77`)
  - this is a small reporting inconsistency, not an ML/evaluation failure

## 2026-06-12 Native Lane Summary Repair - v2.4.19 / b250

- Bumped both repos to shared version `v2.4.19 / b250`.
- Root cause of the zero 4-lane ML matrix after successful evaluation was narrowed to the
  app read/render contract, not evaluation execution:
  - Supabase `ml_evaluation_outcomes` rows were present and attributed after backfill.
  - The phone still rendered zeros because the PWA was reconstructing lane stats from raw
    rows/snapshots instead of consuming an explicit native summary.
- Added a native evaluation lane summary bridge:
  - `SupabaseClient.fetchEvaluationLaneSummary(sessionDate, limit)`
  - `NativeBridge.getMLEvaluationLaneSummary(limit)`
- `app.js` now prefers the native lane summary for the 4-lane matrix and refreshes it from
  the `↻ Refresh Status` action.
- Added schema-safe evaluation persistence fallback in Kotlin:
  - if `ml_evaluation_outcomes` / `ml_recommendation_outcomes` reject the richer attribution
    columns, persistence falls back to legacy rows rather than failing outright.
- Version alignment:
  - Android `versionName=2.4.19`, `versionCode=250`
  - `BRAIN_VERSION=2.4.19`
  - PWA label `v2.4.19 · b250`
  - cache-bust updated to `app.js?v=1191`

## Local Update - 2026-06-06 - Wave 1 Master Directive Implementation (not pushed yet)

- Continued the app-side build for `MASTER_DIRECTIVE_WAVE1_WAVE2_20260605.md`.
- Python `brain.py` now carries additive leg-first candidate metadata without removing compatibility fields:
  - `legs[]`
  - `legCount`
  - `lane`
  - `leg_schema_version = 1`
  - `candidate_schema_version = 1`
- Directional candidates and IC/IB candidates now all stamp the same leg/candidate schema metadata.
- Added signal-independence persistence:
  - verdict now includes `signal_independence_score`
  - snapshot context now stores `signal_independence`
- Added separate snapshot slices:
  - `top_5_nf`
  - `top_5_bnf`
- Added teacher staging payload in snapshot context:
  - `teaching_snapshot_staging.bnf`
  - `teaching_snapshot_staging.nf`
  - captures ATM±8 strike-band leg rows with greeks from in-memory chain data
- Added compact rejected-candidate trace persistence:
  - `candidate_generation_trace`
  - stores per-index accepted/rejected attempt summaries, stage, reason, width, premium-edge/IV-richness fields where available
- Rejected-candidate capture is now wired end-to-end in Python:
  - `generate_candidates(...)` returns `(accepted_candidates, rejected_records)`
  - `analyze(...)` stores `result['rejected_candidates']`
  - `candidate_stats.rejected` is populated
  - `candidate_stats.by_index`, `candidate_stats.rejected_by_index`, `candidate_stats.rejected_by_stage`, and `candidate_stats.by_lane` now give direct BNF/NF diagnostics in the brain payload
  - `take_poll_snapshot(...)` persists `snapshot_rejected_candidates`
  - IC/IB multi-leg gate failures no longer disappear silently for the main actionable branches:
    - sigma too close / too far
    - strike missing
    - leg data missing
    - non-positive credit
    - invalid economics / capital limit
    - probability floor
    - credit-ratio floor (IC)
    - IV-richness floor
- Normalized all remaining missing-VIX defaults in the Python brain/calibration path to `15` so F3 is consistent, including:
  - calibration regime bucketing from `entry_vix`
  - live VIX-change tracking against open trades
- PWA compatibility updated so candidate rendering no longer assumes numeric `legs` and now respects `legCount` / `legs[]`.
- Kotlin `MarketWatchService.kt` reliability hardening added locally:
  - market-hours session wake lock
  - gap warning if no successful poll for 12+ minutes during market hours
  - self-heal restart alarm if service dies unexpectedly while still marked running
- Verification completed locally:
  - `python3 -m py_compile Marketapp/app/src/main/python/brain.py` pass
  - `node --check MarketVivi/app.js` pass
- Current blocker for full Android verification:
  - no Java toolchain / `JAVA_HOME` in this container, so Kotlin changes remain static-reviewed until release build time

## Release Update - 2026-06-01 - v2.3.85 / b216

- Hybrid H2 evaluator batch prepared:
  - evening evaluator now reads all generated candidates from snapshot context
  - preferred pricing window is `15:15–15:25 IST`
  - final fallback pricing window is `15:26–15:30 IST`
  - snapshot context now includes `snapshot_evaluation_legs` per candidate
- This extends the earlier full-chain H2 safety net into a proper hybrid evaluation design.

## Release Update - 2026-06-01 - v2.3.84 / b215

- Pushed correction batch for post-market issues:
  - evening evaluation reminder timing hardened
  - poll loop aligned to 5-minute market slots
  - coverage header clarified as `polls X/Y slots`
  - swing rescan blank-state race fixed on display layer
  - `Position for Tomorrow` removed from Trade tab
  - ML refresh status now gives explicit feedback
  - H2 evaluation persistence widened to full BNF/NF chain capture during `15:15–15:30 IST`
- Still deferred for later discussion with Antigravity:
  - NF50 breadth constituent/update architecture
  - ML architecture split by `NF/BNF × intraday/swing`

## Local Update - 2026-06-01 - Hybrid H2 Evaluator Phase 1 (not pushed yet)

- Python evening evaluator now consumes the full `snapshot_generated_candidates` set from snapshot context instead of limiting secondary evaluation to the old top-5 slice.
- Evaluation window logic now prefers `15:15–15:25 IST` marks and falls back to the final near-close `15:26–15:30 IST` window.
- Native full-chain H2 persistence remains in place as the pricing safety net.
- This is local only until next push.

## Local Update - 2026-06-01 - Hybrid H2 Evaluator Phase 2 (not pushed yet)

- Snapshot context now stores `snapshot_evaluation_legs` for each generated candidate.
- Each ledger row carries:
  - candidate id
  - strategy type
  - index
  - expiry
  - trade mode
  - exact legs with strike, option type, and entry LTP where available
- This adds the recommendation-bound evaluation ledger on top of the existing full-chain H2 safety net.

## Local Update - 2026-06-01 - NF50 Remote Constituent Architecture Phase 1 (not pushed yet)

- Kotlin NF50 breadth now supports a remote-managed constituent source with bundled fallback.
- Remote lookup order:
  - `config_nf50_constituents`
  - `nf50_constituents`
  - `app_config.key = nf50_constituents`
  - bundled Kotlin fallback
- Added 12h local cache in `SharedPreferences`.
- NF50 breadth payload now includes:
  - `source`
  - `missingCount`
  - `missingKeys`
- Market tab now shows missing-count detail when NF50 coverage is partial.

## Local Update - 2026-06-01 - Reminder + Poll Slot Fixes (not pushed yet)

- Reminder notifications moved back under native evening-window control:
  - morning `Day Evaluation Ready` notifications are now blocked in Kotlin
  - stale alarms now reschedule instead of notifying outside the valid evaluation window
  - duplicate reminder while evaluation is already running is suppressed
- Polling logic improved on native side:
  - dispatch now de-dupes by market slot instead of raw elapsed time
  - next wake aligns to next 5-minute trading slot
  - daily reset clears new slot-dedup keys
- UI wording improved:
  - watch header now labels coverage as `polls X/Y slots`
  - expected coverage uses grace + first-poll anchoring to reduce false `missed` inflation
- Scope is local only until next push.

## Local Update - 2026-06-01 - Swing Rescan Blank Trade Tab (not pushed yet)

- Trade-tab blank state traced to PWA refresh behavior, not a Kotlin crash.
- During `SWING` mode switch or manual `Rescan`, the UI could overwrite the last valid trade view with an empty native brain payload before the new result arrived.
- Local display-layer hardening added:
  - preserve last good brain payload during transient empty refresh
  - mark `brainRefreshPending` on mode switch / rescan
  - show `Refreshing swing strategies from native brain...` while waiting
  - if refreshed payload is valid but has zero candidates, show `No swing strategies ready right now` with brain reasoning/conflicts instead of `Lock & Scan`
- Kotlin remains the functional owner; this patch only prevents misleading blank-state rendering in PWA.

## Local Update - 2026-06-01 - Trade Tab Cleanup + Evaluation Outcome Investigation (not pushed yet)

- `Position for Tomorrow` block removed locally from Trade tab.
- Evening evaluation issue investigated:
  - `Outcomes: 0` means evaluation finished but Python returned no evaluable outcome rows.
  - likely serious cause: H2 evaluator depends on exact option-leg chain slices in the 15:15–15:30 window.
  - native chain-slice persistence captures legs from the current poll’s generated candidates/watchlist, not a guaranteed replayable set for every earlier surfaced recommendation.
  - result: valid snapshots can exist while evening labeling still saves `0` outcomes.
- Kept in local evening fix bundle for architecture review before push.

## Local Update - 2026-06-01 - H2 Evaluation Capture + ML Refresh Feedback (not pushed yet)

- Native H2 evaluation persistence widened locally:
  - during `15:15–15:30 IST`, chain-slice storage now captures the full BNF and NF option chains, not just the current candidate/watchlist legs.
  - purpose: keep exact leg prices available for saved recommendations so evening evaluation can still label them even if they disappear from the active watchlist by close.
  - native diagnostics added:
    - `ML_CHAIN_SLICE_H2_FULL`
    - `EVAL_INPUTS: snapshots=X chainSlices=Y date=...`
- ML feedback improved locally:
  - `Outcomes` wording changed to `Evaluable outcomes saved`.
  - zero-label completion now explains that no evaluable H2 outcomes were produced from the day's recommendations.
  - `Refresh Status` now surfaces explicit no-change / done / running feedback instead of looking inert.
  - ML panel now shows the last refresh time.
- Scope is local only until next push.

## Release Update - 2026-05-31 - v2.3.83 / b214

- First AI-in-ML integration slice completed on app side.
- Boundary restored to intended architecture:
  - PWA = display/dispatch only
  - Kotlin = all evaluator functionality and persistence
- Native bridge now owns:
  - Oracle evaluator trigger/status/proposals
  - approved proposal refresh
  - approve/reject proposal writes
  - cached evaluator job state
- `MarketWatchService` injects approved proposals into `brain.py`.
- `brain.py` now supports guarded approved-branch overrides for strategy allow/block and sigma gates.
- Release versions aligned across both repos:
  - Android `2.3.83 / 214`
  - PWA `v2.3.83 · b214`
- Oracle transport warning:
  - `http://144.24.117.114:8443` is temporary evaluator-only transport.
  - Do not route Upstox auth or order relay traffic through Oracle until TLS is deployed.
- `Marketapp/GIVE_TO_ANTIGRAVITY.md` has been refreshed to the current `v2.3.83 / b214` architecture state.

## Update - 2026-05-31 - Gemini Evaluator Phase 1 App Wiring

- App-side Gemini evaluator integration has started locally.
- PWA side now includes:
  - evaluator job state card in ML tab
  - evaluator trigger button
  - evaluator proposal review UI
  - display-only evaluator shell
  - no direct evaluator Supabase writes in PWA
  - no evaluator local persistence in PWA
- Android side now includes:
  - Oracle HTTP bridge methods for evaluator trigger/status/proposals
  - native-owned default 30-day evaluator window
  - cached approved branch proposal storage in SharedPreferences
  - approved proposal refresh from Supabase during bootstrap and runtime
  - approved proposals injected into `brain.py` context as `approvedProposals`
- Brain side now supports guarded learned-branch overrides:
  - `strategy_allow`
  - `strategy_block`
  - `min_sigma_otm`
  - `max_sigma_otm`
- Important current dependency:
  - Oracle evaluator endpoint is plain HTTP at `http://144.24.117.114:8443`
  - Android manifest was opened for cleartext traffic because HTTPS is not yet available
- Local verification:
  - JavaScript syntax passed
  - Python syntax passed
  - full Gradle/Kotlin compile still depends on Java toolchain availability in the environment

## Project Overview
- **App:** Market Radar v2.1 — Premium-first PWA for NSE options trading decisions
- **User:** Vivek — part-time options trader, 1 lot at a time, NF primary (BNF secondary)
- **Live URL:** vivekashokan007-cloud.github.io/MarketVivi
- **Repo:** github.com/vivekashokan007-cloud/MarketVivi
- **Stack:** Static PWA + Android APK (Kotlin WebView shell), Upstox API (market data), Supabase (storage + config), GitHub Pages. Zero backend cost.
- **Upstox Analytics Token:** Hardcoded in api.js as fallback. 1-year expiry Mar 2027. Read-only.
- **Supabase URL:** fdynxkfxohbnlvayouje.supabase.co

---

## Dev Rules (STRICT — NON-NEGOTIABLE)
1. Discuss → Confirm → Implement. Never code on suggestion.
2. "study/analyse" = discuss only, no code.
3. Only deliver changed files (push all for clean sync).
4. Always `node --check` JS files before delivering.
5. Never touch DTE multipliers without new calibration data.
6. Never touch NSE holidays without official NSE circular.
7. No live data feeds, broker order placement, or paid backends.
8. BreakoutIQ is a separate app.
9. Before writing ANY new code: check if v1 already solved it.
10. Before changing existing code: read it, identify what works, add alongside not replacing.
11. Flag AFTER success, not before (2PM/3:15PM capture lesson).
12. inputmode="text" for all inputs (Samsung keyboard minus key fix).
13. **PREMIUM IS KING — every feature exists to answer: am I on the right side of the premium?**
14. **Varsity-first strategy selection — market condition → strategy type → then rank strikes.**
15. **Dynamic island — no hardcoded formulas. Everything computed from real LTPs.**
16. **Use `??` for numeric values, `||` only for strings — zero is valid data for calibration.**
17. **EVERY PUSH MUST HAVE NEW VERSION NUMBER.** Multiple updates on same v=N causes browser to serve cached old code.
18. **ADVERSARY MODE: Challenge every assumption, question every profit, only admire when genuinely earned. No sugarcoating.**

---

## Build State — v2.1 b70 (Apr 4 2026)

| File | Lines | Role |
|------|-------|------|
| app.js | 5678 | Full engine: 7 bias signals, 3 forces, Varsity filter, contextScore, paper trading, JSONB snapshots, per-strike poll data, Excel export, intraday chart, range detection, backtest-informed strike selection |
| api.js | 529 | Upstox API: spots, chains, expiries, OHLC, BNF breadth (5), NF50 breadth (50), near-ATM OI walls |
| db.js | 366 | Supabase CRUD: premium_history, trades_v2, chain_snapshots, app_config, signal accuracy |
| bs.js | 146 | Black-Scholes: IV, expected move, sigma scores, IV percentile |
| style.css | 1539 | Light-first Upstox theme, Upstox-style cards |
| index.html | 203 | 4-tab layout, morning inputs, paper trade CSS, SheetJS CDN, export button |
| sw.js | 6 | Self-destruct only |
| manifest.json | 17 | PWA manifest |
| **Total** | **~5678+529+366+146+1539+203=8461** | |

---

## b70 Changes (Apr 4 2026) — Backed by 8,372 trades across 552 days

### Change 1: MAX_SIGMA_OTM = 0.8 cap
- **Source:** Backtest Table 5 — credit sweet spot 0.5-0.8σ (66-84% win). CLIFF at 0.8σ → drops to 52%.
- **Implementation:** New constant `MAX_SIGMA_OTM: 0.8`. contextScore penalizes >0.8σ (-0.15) and >1.0σ (-0.3). Bonus for sweet spot 0.5-0.8σ (+0.2).
- **NOT a hard filter** — candidates beyond 0.8σ still generated but ranked lower.

### Change 2: Bull Put kill switch REMOVED
- **Source:** b68 killed Bull Put based on 0/6 paper losses. Backtest shows BP 54.7-65.5% across all presets.
- **Root cause of 0/6:** ATM narrow strikes — now prevented by MIN_SIGMA_OTM (0.5σ) + MIN_WIDTH (NF:150, BNF:400).
- **Implementation:** Kill switch code replaced with comment explaining why removed. BP returns to its natural Varsity position (PRIMARY for BULL+HIGH IV).

### Change 3: VERY_HIGH VIX → debit co-PRIMARY
- **Source:** Backtest Table 3 — VIX ≥24: debit 91.7% vs credit 86.4%.
- **Varsity alignment:** M5 Ch19 says buy options when expecting vol decrease. At VERY_HIGH, VIX mean-reverts.
- **Implementation:** When VIX ≥ C.IV_VERY_HIGH (24): BEAR bias adds BEAR_PUT to primary alongside BEAR_CALL; BULL bias adds BULL_CALL alongside BULL_PUT; NEUTRAL adds both debit to allowed.

### Change 4: IB/IC EXIT TODAY tag + 3PM alert
- **Source:** Backtest Table 6 — IB 0%, IC 0-4% overnight survival across 1,400+ swing trades.
- **Implementation:** Red "⏱ EXIT TODAY" badge on IC/IB candidate cards. At 2:45 PM (330 min after open), urgent notification fires for any open IC/IB position. Only triggers for IRON_BUTTERFLY and IRON_CONDOR (not DOUBLE_DEBIT).

### Change 5: Sigma sweet spot indicator on credit cards
- **Source:** Backtest Table 5 — 0.5-0.8σ confirmed as Varsity's OTM sweet zone.
- **Implementation:** New `sigmaOTM` field in evaluateCandidate return object. Card shows: green "● SWEET SPOT" for 0.5-0.8σ, yellow "● thin credit zone" for >0.8σ.

### Change 6: CALIBRATION updated with backtest sweep ranges
- **Source:** 3-preset sweep (conservative/moderate/aggressive), 8,372 trades each.
- **Implementation:** Each strategy in CALIBRATION now has `bt_range` and `bt_note` fields alongside paper trade data.

---

## NSE Bhavcopy Backtest — Complete Findings

### Data
- **552 trading days:** Jan 1 2024 → Mar 30 2026
- **21,200,295 rows** of option data (bhavcopy UDIFF format)
- **Supporting data:** 557 VIX days, 558 NF OHLC, 558 BNF OHLC
- **6 strategies:** Bear Call, Bull Put, Iron Condor, Iron Butterfly, Bear Put, Bull Call
- **2 modes:** Intraday (dampened option OHLC) and Swing (next-day spot data)

### Backtest Engine
- **Location:** `C:\Users\HP\OneDrive\Desktop\market_radar_backtest\market_radar_backtest\`
- **9 Python files:** config.py, run_backtest.py, verify_data.py, merge_data.py, engine/bs_model.py, engine/data_loader.py, engine/chain_builder.py, engine/trade_simulator.py, engine/deep_analysis.py
- **Features:** 3-preset sweep mode (`--sweep`), tweakable dampening constants, strategy × market condition tables, per-strategy CSV export
- **Dampening model:** Close-based P&L as anchor + dampened OHLC extremes. Prevents false target hits from uncorrelated leg extremes.

### 3-Preset Sweep Results (8,372 trades each)

| Metric | Conservative | Moderate | Aggressive |
|--------|-------------|----------|------------|
| Dampening (2-leg/IB/IC) | 0.35/0.25/0.30 | 0.50/0.35/0.45 | 0.65/0.50/0.60 |
| Swing theta/day | 12% | 18% | 22% |
| Win rate | 47.1% | 58.8% | 64.3% |
| Net P&L | Rs.8.9M | Rs.12.9M | Rs.16.1M |
| Avg/trade | Rs.1,058 | Rs.1,542 | Rs.1,929 |
| Costs % of paper | 42.6% | 33.8% | 29.0% |
| Max Drawdown | Rs.-51,107 | Rs.-14,166 | Rs.-1,749 |
| Losing days | 68/459 (15%) | 17/459 (4%) | 2/459 (0.4%) |

### Strategy Win Rates Across All 3 Presets

| Strategy | Conservative | Moderate | Aggressive | Range | Verdict |
|----------|-------------|----------|------------|-------|---------|
| **Bull Call** | **64.0%** | **69.6%** | **72.2%** | 8pt | 🔥 MOST ROBUST |
| **Bear Put** | **54.4%** | **62.8%** | **67.5%** | 13pt | 🔥 ROBUST |
| Bear Call | 44.7% | 66.8% | 77.1% | 32pt | ⚠️ Dampening-sensitive |
| Bull Put | 45.7% | 65.5% | 74.4% | 29pt | ⚠️ Dampening-sensitive |
| IB | 34.1% | 43.0% | 48.0% | 14pt | ❌ Never above 50% |
| IC | 37.5% | 46.0% | 49.1% | 12pt | ❌ Never above 50% |

**Key insight:** Debit strategies are ROBUST because their P&L comes from real spot movement. Credit strategies are dampening-sensitive because their P&L depends on simulated option OHLC assumptions. Reality is between conservative and moderate.

### Strategy × Mode (Intraday vs Swing at Moderate)

| Strategy | Intraday Win% | Intraday Avg | Swing Win% | Swing Avg |
|----------|--------------|--------------|------------|-----------|
| IB | 85.9% | 2,835 | **0.0%** | -1,744 |
| IC | 88.4% | 2,055 | **3.6%** | -1,901 |
| Bear Call | 81.4% | 2,771 | 52.2% | -122 |
| Bull Put | 91.1% | 2,556 | 39.8% | -363 |
| Bear Put | 71.7% | 1,918 | **53.9%** | 3,746 |
| Bull Call | 79.6% | 2,087 | **59.5%** | 4,039 |

**Finding: Intraday >> Swing for ALL strategies. IB/IC NEVER overnight.**

### Table 3: VIX Regime × Credit vs Debit (Intraday)

| VIX Regime | Credit Win% | Credit Avg | Debit Win% | Debit Avg | Winner |
|-----------|------------|------------|-----------|-----------|--------|
| LOW (<15) | 86.9% | 2,596 | 74.3% | 1,942 | CREDIT |
| NORMAL (15-20) | 86.5% | 2,538 | 76.0% | 2,019 | CREDIT |
| HIGH (20-25) | 89.5% | 2,455 | 78.8% | 2,054 | CREDIT |
| **VERY_HIGH (24+)** | 86.4% | 2,023 | **91.7%** | 2,871 | **DEBIT** |

**Confirms Varsity:** Sell premium in normal conditions. Buy premium only in extreme VIX.

### Table 5: Credit Strike Sweet Spot (Intraday, BC+BP only)

| Sigma | Trades | Win% | Avg P&L | Verdict |
|-------|--------|------|---------|---------|
| 0.3-0.5σ | 517 | 99.0% | 2,118 | SWEET (inflated — near ATM) |
| **0.5-0.6σ** | **316** | **94.9%** | **1,793** | **SWEET** |
| **0.6-0.7σ** | **72** | **83.3%** | **3,240** | **SWEET** |
| **0.7-0.8σ** | **32** | **84.4%** | **3,916** | **SWEET** |
| 0.8-1.0σ | 50 | 52.0% | 2,924 | **CLIFF — 32pt drop** |
| 1.0-1.5σ | 78 | 42.3% | 1,772 | AVOID |

**MIN_SIGMA_OTM = 0.5 (floor) and MAX_SIGMA_OTM = 0.8 (soft cap) are correct.**

### Table 6: Swing — What Survives Overnight (dampening-independent, MOST TRUSTWORTHY)

| Strategy | After UP | After DOWN | After FLAT | Overall |
|----------|---------|-----------|------------|---------|
| **Bull Call** | **76%** | 35% | 66% | **60%** |
| **Bear Put** | 25% | **70%** | 62% | **54%** |
| Bear Call | 56% | 42% | 55% | 52% |
| Bull Put | 28% | 48% | 39% | 40% |
| IC | 2% | 2% | 5% | 4% |
| IB | 0% | 0% | 0% | **0%** |

**These are the most trustworthy numbers in the entire backtest — no dampening, pure next-day spot data.**
- After UP day → Bull Call swing 76% (momentum continues)
- After DOWN day → Bear Put swing 70% (momentum continues)
- IB/IC 0% → NEVER hold overnight

---

## Update Note (May 22 2026) — Batch 2 IV Edge Calibration

- `brain.py` now applies bounded IV Edge calibration by blending internal `probProfit` toward Upstox POP.
- Added constants:
  - `IV_EDGE_MIN_POP = 35`
  - `IV_EDGE_MAX_POP = 95`
  - `IV_EDGE_BLEND = 0.35`
  - `IV_EDGE_MAX_SHIFT = 0.08`
- Added helpers:
  - `_normalize_pop_pct(pop_value)`
  - `_apply_iv_edge_boost(prob, upstox_pop)`
- Applied in:
  - `_build_candidate(...)` (2-leg spreads)
  - Iron Condor candidate generation
  - Iron Butterfly candidate generation
- Candidate payload now includes:
  - `probProfit` (calibrated)
  - `rawProbProfit` (original model value)
  - `ivEdgeBoost` (applied signed shift)
- UI can now consistently show `P(Range)` vs `P(Profit)` divergence using real calibrated values.
- Pending follow-up: live-day tuning of blend/clamp values and threshold validation against outcome labels.

## Update Note (May 22 2026) — Batch 3 OI Velocity Wiring

- Live poll payload now carries total OI fields required by `brain.py` OI velocity logic:
  - `bnfCOI`, `bnfPOI`
  - `nfCOI`, `nfPOI`
- ML poll snapshot persistence now records OI velocity telemetry inside `market_forces_json`:
  - BNF/NF total call and put OI
  - rolling poll-window OI velocity %
  - profile-level `oiVelocity` values
- This closes the end-to-end OI velocity data gap from Kotlin poll capture to Python brain to ML snapshot storage.

## Update Note (May 22 2026) — Batch 4 Export Retention Cleanup

- Added automatic retention cleanup for Supabase Storage bucket `EXPORTS` in `app.js` export workflow.
- Cleanup executes after successful upload and does not fail the export if cleanup encounters errors.
- Retention policy:
  - keep at most 30 recent export files
  - keep files not older than 14 days
  - never delete the file uploaded in the current export run
- Export success text now includes cleanup deletion count when applicable.

## Update Note (May 22 2026) — Batch 5 Timeout Hardening

- Added timeout protections on high-impact Python bridge paths:
  - `MarketWatchService.kt`
    - `take_poll_snapshot` guarded (4s)
    - `notification_agent_process` guarded (3s)
  - `MarketMLService.kt`
    - `evening_evaluator` guarded (45s)
  - `NativeBridge.kt`
    - `validate_model` guarded (8s)
    - `ml_score_bridge` guarded (2.5s)
- Added explicit timeout log markers for easier production diagnostics.
- Behavior now degrades safely on slow Python calls (timeouts + warning logs), reducing risk of service thread blockage.

## Update Note (May 22 2026) — Batch 6 ML Aggregation Loop

- Added post-evaluation aggregation pipeline in Android `MarketMLService`:
  - daily rollup from evaluator outcomes (primary + labelable)
  - weekly rollup on Saturday
  - monthly rollup on last Friday
- Daily summary writes to:
  - `ml_daily_accuracy` (fallback `ml_accuracy_daily`)
- Weekly summary writes to:
  - `ml_weekly_accuracy` (fallback `ml_accuracy_weekly`)
- Monthly summary writes to:
  - `ml_monthly_summary` (fallback `ml_accuracy_monthly`)
- Month-end hard gate:
  - sets `hard_gate_triggered` when labeled rows >= 500
  - triggers retrain-readiness check/notification when gate is hit
- Current implementation is H2-primary based because `evening_evaluator` currently labels H2 outcomes.

## Update Note (May 22 2026) — Push & Signed Release Procedure

- Mandatory for every `Marketapp` push:
  - bump `versionCode` and `versionName` in `app/build.gradle.kts`
  - commit bump before push
- Release workflow trigger:
  - `.github/workflows/release.yml` runs on push to `main` only when `app/build.gradle.kts` changed
- Update detection behavior:
  - app checks GitHub `releases/latest`, not raw commits
  - if signed release publish fails, app will still show “up to date”
- Failure triage sequence:
  1. Open failed Actions run
  2. Expand `Build Signed APK`
  3. Fix compile/signing issue
  4. Bump version again and push
- Known regression fixed:
  - `NativeBridge.kt` unresolved reference to `selectAppConfigLite`
  - fixed by restoring `selectAppConfigLite()` in `SupabaseClient.kt`
  - then version bumped and workflow re-triggered.

## Update Note (May 22 2026) — ML Tab Visibility Fix

- Problem: UI build `v2.1 · b169` had no visible ML tab even though ML render logic existed.
- Root cause: `index.html` tab bar/container did not include ML tab nodes.
- Fix:
  - Added `🧠 ML` tab button (`data-tab="ml"`)
  - Added `tab-ml` with `ml-content` container
  - Bumped visible web build label to `b170`
- Functional verification:
  - Tab reads real native bridge data (`getMLModelStatus`, `getMLDecisions`, `getSignalAccuracyStats`, `getBrainResult`, `getPollHistory`, `getServiceStatus`)
  - Retrain control triggers native ML retrain readiness flow.

### Findings That DON'T Matter (no edge found)

| Factor | Result |
|--------|--------|
| Shijumon Mon-Wed sell vs Thu-Fri buy | NO DIFFERENCE (39-60% across presets) |
| Day of week | Flat across all days (57-61%) |
| Chart patterns (inside day, uptrend, etc.) | NO edge (66% vs 66%) |
| VIX regime on overall win rate | Surprisingly flat (46-67% across LOW/NORMAL/HIGH) |
| Consecutive direction days | No consistent edge |
| DTE (days to expiry) | Flat (57-61%) |

### Backtest Limitations (Adversary Notes)

1. **OHLC dampening is a guess.** We use 35-65% dampening on option OHLC extremes. Real dampening depends on intraday option tick data we don't have.
2. **Intraday win rates are inflated.** The simulation can't tell WHEN during the day price extremes occurred. A day that gapped up then crashed shows both high and low — benefiting both bull and bear strategies simultaneously.
3. **Tables 1, 2, 4 are NOT directionally reliable.** Strategy × day direction shows credit strategies winning on DOWN days (should be opposite for Bull Put). This is the OHLC timing artifact.
4. **Table 3 (credit vs debit by VIX) and Table 6 (swing) ARE reliable.** Both use relative comparisons (same OHLC limitation affects both sides) or pure spot data (no OHLC involved).
5. **Only 248 trades in HIGH VIX.** Most of our 2026 paper trading was VIX 24+, which is barely represented.
6. **No FII/DII data in backtest.** Optional — doesn't affect strategy simulation.

---

## Completed Trades (39+ total)

### Real Trades (5)
| # | Strategy | Index | Date | P&L | Key Lesson |
|---|----------|-------|------|-----|-----------|
| 1 | BPS | BNF | Mar 13-16 | +₹933 | HDFC 28% weight masked by breadth |
| 2 | BPS | BNF | Mar 19 | ~₹0 | Buying puts after gap-down = inflated IV |
| 3 | BCS | BNF | Mar 20 | +₹1,130 | P&L Dropping alert worked |
| 4 | BCS | BNF | Mar 23 | +₹1,118 | 3/3 aligned, VIX 25.3 |
| 5 | BCS | NF | Mar 25 | -₹1,537 | ATM sell on 1.47σ gap-up. 9 lessons → b53 fixes |

**Running total: +₹1,643 from 5 trades, 3 winners. Kelly%=31%.**

### Paper Day 1 (Mar 27, b55) — 4 trades, all BULL_PUT, all lost
- Total: -₹4,026. Root cause: 3 stale BULL signals dominated despite bearish reality. Led to Phase 10 (Chain Validation).

### Paper Day 2 (Mar 30, b56-b58) — 5 trades: 4 BEAR_CALL + 1 IRON_CONDOR, all won
- Total: +₹9,834. Chain validation correctly showed STRONG BEAR.

### Paper Day 3 (Apr 2, b67-b68) — 6+ trades
- BNF IB +₹11,706, NF IB +₹7,865, NF IC +₹1,417, BNF BC -₹455. Total +₹20,533 paper.
- Upstox cross-verification: prices match within ₹3-9/leg. P(Profit) 4.2x overestimated.

---

## Architecture — Single Loop Design

### Morning Scan (Lock & Scan)
Enter FII Cash + Short% + optional fields → Lock & Scan → Heavy fetch → 7-signal bias → Varsity filter → candidates. Morning bias saved to Supabase (first scan only).

### Watch Loop (5 min)
Light fetch → bias recompute → drift detection → forces update → P&L update → CI update → journey tracking → poll history snapshot (28 market fields + per-strike ATM±10) → save to Supabase → notifications → render. **AUTO-STOPS when market closes (after 3:35 PM IST).**

### Afternoon Positioning (Phase 8)
2PM baseline → 3:15PM comparison → Tomorrow Signal → positioning candidates.

### Page Refresh Recovery
DOMContentLoaded → DB.getAllConfig() → restore morning/evening/polls → loadOpenTrade() → renderAll.

---

## Bias Engine — 7 Signals

| # | Signal | Source | Threshold |
|---|--------|--------|-----------|
| 1 | FII Cash | Manual | > ±500Cr |
| 2 | FII Short% | Manual vs yesterday | > 85% increasing = BEAR |
| 3 | Close Char | Auto OHLC | ≥ ±1 |
| 4 | PCR near-ATM | Auto chain (±10 strikes) | > 1.2 BULL, < 0.9 BEAR |
| 5 | VIX Direction | Auto vs yesterday | > ±0.3 |
| 6 | Futures Premium | Auto chain (synthetic) | > ±0.05% |
| 7 | DII Absorption | Manual + auto compare | Direction + level combined |

**Chain Validation (Phase 10):** Overnight delta (Dow, Crude, GIFT) + gap direction → CONFIRMED/LIKELY/UNCERTAIN → neutralize stale signals.

## 3 Forces on Every Trade

| Force | What | Credit | Debit |
|-------|------|--------|-------|
| F1 Direction | Bias alignment | +1 if matches | +1 if matches |
| F2 Theta | Time decay | Always +1 | Always -1 |
| F3 IV | VIX regime + IV%ile | +1 if HIGH/VERY_HIGH | +1 if LOW |

## Varsity Filter (b70 — updated with backtest findings)

### Base Filter (Zerodha Varsity Modules 5, 6)
| Bias + IV | PRIMARY | ALLOWED | BLOCKED |
|-----------|---------|---------|---------|
| BEAR + HIGH | Bear Call | Bull Put, IC | Bear Put, Bull Call, IB |
| BULL + HIGH | Bull Put | Bear Call, IC | Bull Call, Bear Put, IB |
| NEUTRAL + HIGH | IC | Bear Call, Bull Put | Others |
| BEAR + LOW | Bear Put | Bear Call | Bull Put, Bull Call, IC, IB |
| BULL + LOW | Bull Call | Bull Put | Bear Call, Bear Put, IC, IB |
| NEUTRAL + LOW | Double Debit | IC | Others |

### b70 Overrides
1. **Bull Put kill switch REMOVED** — BP stays in natural Varsity position. 0/6 paper failure was ATM narrow strikes, now prevented by MIN_SIGMA_OTM + MIN_WIDTH.
2. **VERY_HIGH VIX (≥24) → debit co-PRIMARY** — Bear Put joins BEAR_CALL as co-PRIMARY when BEAR+VERY_HIGH. Bull Call joins BULL_PUT when BULL+VERY_HIGH.
3. **Range detection → IB/IC PRIMARY** (b68, unchanged) — when range-bound + after 10:30 + high VIX.
4. **IB always blocked for real trades** (margin concern at ₹1.1L).
5. **Paper mode unlocks ALL strategies** when no real trades open.

---

## Strike Selection (b69 → b70)

### Hard Filters (reject candidates)
- `MIN_SIGMA_OTM: 0.5` — credit BC/BP must sell ≥0.5σ from ATM. IB/IC exempt.
- `MIN_WIDTH_NF: 150, MIN_WIDTH_BNF: 400` — narrow directional credit spreads rejected.
- `MIN_CREDIT_RATIO: 0.10` — credit/width must be ≥10%.
- `MIN_PROB: 0.50` — P(Profit) must be ≥50%.

### Soft Scoring (contextScore, affects ranking)
- **Sweet spot bonus (+0.2):** 0.5-0.8σ OTM — backtest confirmed
- **Cliff penalty (-0.15 to -0.3):** beyond 0.8σ — backtest Table 5 cliff
- **ATM penalty (-0.25 to -0.5):** below 0.5σ — calibration + backtest
- **Width bonus (+0.1):** width ≥ 2× minimum
- **VIX direction penalty (-0.1 to -0.3):** swing mode + falling VIX for credit
- **Gap conflict penalty (-0.4 to -0.7):** trading against >0.8σ gap

### Card Indicators
- **Sigma badge:** Green "● SWEET SPOT" for 0.5-0.8σ, Yellow "● thin credit zone" for >0.8σ
- **EXIT TODAY badge:** Red tag on IB/IC candidate cards
- **Track Record:** Paper + backtest range display

---

## Supabase Schema (4 tables + 1 storage bucket)

### premium_history
(date, session) unique. Sessions: 'morning', 'close'. Fields: nf_spot, bnf_spot, vix, nf_atm_iv, bnf_atm_iv, pcr, fii_cash, fii_short_pct, dii_cash, fii_idx_fut, fii_stk_fut, futures_premium_bnf, bias, bias_net.

### trades_v2
Full trade lifecycle: entry conditions (35+ fields), exit conditions (18 fields), journey timeline (JSONB), paper boolean, trade_mode.

### chain_snapshots
(date, session) unique for morning/2pm/315pm. Full OI structure + tomorrow_signal.

### app_config
Key-value store: evening_close, global_direction, morning_bias, morning_inputs, poll_history_YYYY-MM-DD, settings.

### Storage: EXPORTS bucket
Public bucket for Excel export files.

---

## Constants (SACRED — don't change without data)
- CAPITAL=110000, NF_LOT=65, BNF_LOT=30, MAX_RISK=10%
- NF_WIDTHS: [100,150,200,250,300,400], BNF_WIDTHS: [200,300,400,500,600,800,1000]
- IV regimes: LOW≤15, NORMAL 16-19, HIGH≥20, VERY_HIGH≥24
- PCR thresholds: >1.2 BULL, <0.9 BEAR (near-ATM, contrarian)
- **Strike: MIN_SIGMA_OTM=0.5, MAX_SIGMA_OTM=0.8** (b70, backtest-confirmed)
- **Strike: MIN_WIDTH_NF=150, MIN_WIDTH_BNF=400** (b69)
- Time gates: first 15min suppressed, 11:30-14:30 sweet spot
- Poll: 5min light, 30min routine notify. Auto-stop after market hours.
- NSE Holidays 2026 (15): Jan-26, Mar-03, Mar-26, Mar-31, Apr-03, Apr-14, May-01, May-28, Jun-26, Sep-14, Oct-02, Oct-20, Nov-10, Nov-24, Dec-25
- DTE multipliers, getVixMult, NF_PUT_SKEW=1.35, distFactor, winProb formula, Varsity tier multipliers (1.0/0.65/0.35) — CALIBRATED, do NOT change.

## Script Load Order
supabase CDN → SheetJS CDN → bs.js → db.js → api.js → app.js

---

## Premium Thesis (evolved Apr 4 2026)
"Premium direction is the ONLY thing that matters — BOTH sides. Credit SELL when premium will shrink (intraday, 0.5-0.8σ OTM). Debit BUY when premium will explode (VERY_HIGH VIX, momentum swings). App must recommend BEST side based on data, not default to selling."

**Backtest-validated rules:**
1. Credit sells: 0.5-0.8σ OTM sweet spot (66-84%). Below = too risky. Above = too thin.
2. VIX < 24: credit preferred (86-90% vs 74-79% debit). VIX ≥ 24: debit preferred (92% vs 86%).
3. IB/IC: intraday ONLY. 0% overnight survival. EXIT before 3:20 PM.
4. Swing momentum: After UP day → Bull Call 76%. After DOWN day → Bear Put 70%.
5. Day-of-week, chart patterns, consecutive days: NO EDGE. Don't trade on these signals.

---

## Known Issues (b70)

### CRITICAL
1. **Excel download doesn't work in APK WebView.** File uploads to Supabase Storage but WebView blocks all JS download triggers. Workaround: download from Supabase dashboard. Fix: add DownloadListener to APK Kotlin code.

### IMPORTANT
2. **api.js parseChain may not pass iv/delta/volume/pop** from Upstox greeks. Verify on next trading day.
3. **getAllConfig fetches ALL `app_config` rows** including poll_history. After 60 days (~15MB) will slow load. Fix: filter poll_history_* out.

### MINOR
4. Old export files accumulate in EXPORTS bucket — no cleanup.
5. P(Profit) 4.2x overestimated vs Upstox pop — IV Edge Boost disabled (b67), calibration pending.

---

## Phase 11 Remaining Scope
- [ ] OI velocity tracking (wall building/crumbling speed)
- [ ] Day-of-week buy/sell preference → CANCELLED (backtest: no edge)
- [ ] IV Edge Boost validation (compare P(Profit) vs Upstox pop vs actual)
- [ ] Dynamic strike distance: VIX>25 + DTE≤1 → min 0.5σ OTM → DONE (b69/b70)
- [ ] Fix APK WebView download (Kotlin DownloadListener)
- [ ] Fix api.js parseChain to pass through iv/delta/volume/pop
- [ ] Fix getAllConfig scaling — filter out poll_history_* keys

## Phase 12+ Roadmap
- [ ] **Swing momentum signal** (yesterday UP → suggest Bull Call next morning) — b71 candidate
- [ ] Calibration Engine Phase A after 50 trades
- [ ] Sigma-based widths
- [ ] Live Dow/Brent API
- [ ] High Conviction Mode after 50+ trades
- [ ] Compact waterfall visible on cards + morning bias drift detection
- [ ] Zerodha Kite Connect Personal API for order execution (Upstox=DATA, Zerodha=EXECUTION)

---

## Key Insights (31 total)
1-18: See v1 archive.
19. Don't sell ATM credit on gap-up against gap direction.
20. OI walls shift on gap-up >1σ.
21. Position forces show entry thesis, not live danger. CI is the live warning.
22. P(Profit) must use breakeven, not sell strike.
23. Swing mode should sell OTM near walls. Intraday can sell ATM for max theta.
24. 17 DTE is suboptimal for theta capture. Sweet spot: 3-7 DTE.
25. Stale data is #1 enemy. Phase 10 Chain Validation fixed Day 1 paper failure.
26. Android WebView blocks ALL file downloads.
27. **Debit strategies are most ROBUST in backtest** — Bull Call 64-72%, Bear Put 54-68% barely change across dampening presets. Credit strategies swing ±30pts depending on assumptions.
28. **0.5-0.8σ is the credit sell sweet spot** — Varsity's predicted 66% confirmed. Cliff at 0.8σ drops to 52%.
29. **IB/IC have 0% overnight survival** — NEVER hold 4-leg positions overnight. Intraday only.
30. **Swing momentum is real** — After UP: Bull Call 76%. After DOWN: Bear Put 70%. Most trustworthy backtest numbers.
31. **Day-of-week, chart patterns, consecutive days: NO statistical edge** across 8,372 trades. Don't trade on these signals.

---

## Revert References
v1: Phase 2(2740) → Phase 3(3841) → Phase 4(4383) → Phase 5(4762) → Phase 5.1(4934) → Phase 5.2(5339)
v2: b46(6234) → b50(3954) → b51(4033) → b52(4052) → b53(4106) → b53b(4119) → b54(~4238) → b55(4596) → b56(~4700) → b57(5173) → b58-b64(download fixes only) → b65(5221) → b66(5221) → b67(5305) → b68(5563) → b69(5641) → **b70(5678) CURRENT**

## Transcript References
- `/mnt/transcripts/2026-04-02-05-08-02-market-radar-b66-b67-phase12.txt` — Days 3-4 paper, calibration design
- `/mnt/transcripts/2026-04-03-03-42-06-market-radar-b66-b69-full-session.txt` — Day 4 paper, 25-trade calibration, b69 code
- `/mnt/transcripts/2026-04-03-13-37-24-market-radar-b68-b69-backtest-engine.txt` — Backtest engine creation, 552 days, Python setup, 3 runs
- Current session (Apr 4): Backtest fixes, dampening, sweep, conditional analysis, b70 implementation

## Next Trading Day
**April 7, 2026 (Monday)**
- Apr 3 = Mahavir Jayanti holiday (today)
- Apr 4 = Friday (today — session day, not trading)
- First live day with b70
- Watch: Bull Put candidates appearing (kill switch removed)
- Watch: VERY_HIGH VIX debit co-PRIMARY (if VIX stays elevated)
- Watch: Sigma sweet spot indicator on credit cards
- Watch: EXIT TODAY tags on IB/IC
- Continue paper trading to 50 trades (~11 more needed)

---

## Latest Fix Log

### 2026-05-22 — ML V2 Supabase and Directive Fixes
- Supabase schema gate confirmed complete:
  - `chain_slices`
  - `ml_brain_snapshots`
  - `ml_decisions`
  - `ml_evaluation_outcomes`
  - `ml_recommendation_outcomes`
  - `ml_option_chain_snapshots`
  - `ml_daily_accuracy`
  - `ml_weekly_accuracy`
  - `ml_monthly_summary`
- `ml_decisions.outcome_pct_of_max` confirmed present as `double precision`.
- RLS policies confirmed for the five new ML V2 tables:
  - `ml_daily_accuracy.allow_anon_ml_daily_accuracy`
  - `ml_monthly_summary.allow_anon_ml_monthly_summary`
  - `ml_option_chain_snapshots.allow_anon_ml_option_chain_snapshots`
  - `ml_recommendation_outcomes.allow_anon_ml_recommendation_outcomes`
  - `ml_weekly_accuracy.allow_anon_ml_weekly_accuracy`
- Each policy grants `ALL` to `{anon,authenticated}`.
- Important Supabase compatibility note:
  - `chain_slices` is a BASE TABLE in this project, not a view.
  - `ml_evaluation_outcomes` is also a BASE TABLE in this project, not a view.
  - Do not run `CREATE OR REPLACE VIEW` against either name.
- PWA `app.js`:
  - `closeTrade()` now writes `outcome_pct_of_max` for future ML training quality.
  - old manual `Retrain ML` behavior is retired; the UI now shows `ML Status` and does not call `NativeBridge.triggerMLRetrain()`.
  - visible web build label bumped to `v2.1 · b171`.
- Android `MarketMLService.kt`:
  - retrain readiness filter fixed from `outcome=not.is.null` to `won=not.is.null`.
  - Android version target for this directive is `versionName = "2.3.54"`, `versionCode = 185`.
- `brain.py` remains unchanged:
  - MD5 `4d3605e65eb1a279d6086a1a5dfb741b`
  - required functions still present: `_is_labelable`, `_bridge_json_obj`, `take_poll_snapshot`, `evening_evaluator`.
- Push / release result:
  - `MarketVivi` pushed to `main` through commit `7bf5231`.
  - `Marketapp` pushed to `main` through commit `b630b94`.
  - GitHub Actions signed release and debug validation both completed successfully.
  - Latest release is `v2.3.54` / `Market Radar v2.3.54`.
  - Release asset present: `app-release.apk`.

### 2026-05-22 — ML Model Status Regression Found After v2.3.54
- User observed ML tab showing:
  - `Model NOT READY`
  - `Error: too many values to unpack (expected 2)`
- Impact:
  - Affects ML model status / validation.
  - Does not affect live trading decisions because ML is downstream-only.
- Root cause:
  - `RegimeDetector.predict(...)` returns `(label, probs, confidence)`.
  - `MLEngine.predict(...)` still unpacked only `(regime, reg_probs)`.
  - `MLEngine.predict(...)` also referenced `strat` and `ddir` before defining them.
- Fix prepared in `Marketapp`:
  - unpack 3 regime values
  - define `strat` and `ddir` from candidate
  - include `regime_conf` in prediction detail
  - update `ml_engine.self_test()` unpack
  - bump Android version to `2.3.55 (186)`
- Verification:
  - Python compile check passed for `ml_engine.py`, `ml_train.py`, and `brain.py`.
  - `ml_engine.py` self-test passed.

### 2026-05-23 — God Mode Audit Follow-Up
- Reviewed `GOD_MODE_AUDIT_2026_05_21-1.md` against current source.
- Stale/already resolved:
  - candidate IDs exist in generated brain candidates
  - Supabase ML tables and RLS policies are confirmed
  - ML status unpack regression was fixed in `v2.3.55 (186)`
- Safe patch prepared:
  - `brain.py chain_profile()` now guards `step <= 0` to avoid division by zero from duplicate/malformed strike lists.
  - Android version bumped to `2.3.56 (187)`.
  - PWA visible version label updated to `v2.3.56 · b187`.
- Deferred:
  - NSE holiday/margin constants require official/source-confirmed values before changing.
  - `ml_decisions` guard needs an explicit architecture decision.
  - `takeTrade()` NativeBridge caching is performance cleanup.

### 2026-05-23 — Pending Issue Batch
- Issue 1: NSE holiday guard — DONE locally.
  - Official source checked: NSE F&O circular `NSE/FAOP/71777`, dated 2025-12-12.
  - Added 15 weekday F&O trading holidays for calendar year 2026 to `brain.py`.
  - `evening_evaluator()` now skips those dates by returning `[]`.
  - Claude audit holiday list was not used because several dates did not match the official circular.
- Issue 2: margin constants — DONE locally.
  - Mirrored existing PWA protected values into `brain.py`:
    - `BNF_SHORT_MARGIN = 75000`
    - `NF_SHORT_MARGIN = 50000`
  - No candidate-selection behavior changed; existing max-loss/capital risk gates remain authoritative.
- Issue 3: `ml_decisions` guard/architecture — DONE locally.
  - Decision: keep `ml_decisions` active as execution-quality tracking, separate from the V2 brain-snapshot training pipeline.
  - Removed the `cand.p_ml != null` requirement for insert.
  - New behavior: write `ml_decisions` for every saved trade when Supabase is available; ML score fields remain nullable until a model exists.
- Issue 4: `takeTrade()` NativeBridge caching — DONE locally.
  - `takeTradeImpl()` now caches `NativeBridge.getLatestPoll()` once as `latestPoll`.
  - `takeTradeImpl()` now caches `NativeBridge.getPollHistory()` once as `pollHistory` and refreshes that local cache if Kotlin returns a newer history.
  - Trade snapshot and `ml_decisions` insert path now use cached values for the audited hot path.
- Issue 5: market-hours validation checklist/instrumentation — DONE locally.
  - Added `supabase_ml_market_hours_validation.sql`.
  - Script checks current IST session counts for `ml_brain_snapshots`, `ml_option_chain_snapshots`, `ml_decisions`, `ml_recommendation_outcomes`, and `ml_daily_accuracy`.
  - Script also lists recent brain snapshots, chain rows, and daily accuracy rows.
  - Expected use: run after/during the next market session to confirm V2 collection and evening evaluation.
- Release bump for this batch — DONE locally.
  - Android target version: `2.3.57 (188)`.
  - PWA visible label target: `v2.3.57 · b188`.

### 2026-05-23 — God Mode Audit V2 Reply
- Reviewed `GOD_MODE_AUDIT_V2_2026_05_23.md`.
- Audit confirms the critical bug queue is resolved and ML pipeline is structurally ready for first market-hours paper run.
- Stale audit prerequisite:
  - Supabase ML tables/RLS policies are already created and verified.
  - GitHub Actions signed release/debug validation already provide compile evidence; local `compile_errors.txt` in `Marketapp` remains stale.
- Hygiene fixes prepared locally:
  - removed old `MARKET RADAR 05042026.js` snapshot from `MarketVivi`
  - added `.agents/` to `MarketVivi/.gitignore`
  - moved `Marketapp/app/src/main/python/v7_fixtures.json` into `app/src/main/python/tests/fixtures/`
  - replaced remaining render-path `NativeBridge.getPollHistory()` parses with `STATE.pollHistory`
  - bumped Android target to `2.3.58 (189)`
  - bumped PWA visible label to `v2.3.58 · b189`

### 2026-05-23 — Notification Agent Hardening
- Applied Claude directive `DIRECTIVE_NOTIFICATION_AGENT_HARDENING_V2359.md`.
- Android target bumped to `2.3.59 (190)`.
- PWA visible label bumped to `v2.3.59 · b190`.
- `NotificationAgent` now requires `confidence >= 55` before firing `New Setup Ready`.
- Choppy-market alerts now carry the current poll timestamp instead of `0`.
- Kotlin now maps `UPDATE` urgency to the important notification channel.
- Added rationale comment documenting action-level choppy detection.
- Full pytest suite could not run locally because `pytest` is not installed; Python compile and live smoke checks were used instead.

### 2026-05-23 — Notification Sound Architecture Decision
- Separate professional notification sounds are feasible in the Android app.
- Current implementation:
  - `NotificationHelper.kt` has three channels: `trade_urgent`, `trade_important`, `trade_routine`.
  - No custom sound assets exist under `app/src/main/res/raw`.
  - Current behavior uses Android/default channel sounds.
- Android constraint:
  - Android 8+ notification sounds are tied to `NotificationChannel`.
  - Once a channel ID is created on a user's phone, sound changes to that same channel ID may not apply.
  - Use new/versioned channel IDs for custom sounds.
- Recommended channel split:
  - `trade_perfect_v1`: perfect/high-confidence alignment.
  - `trade_entry_v1`: normal confirmed setup.
  - `trade_update_v1`: conviction update.
  - `trade_warning_v1`: choppy/important market warnings.
  - `trade_routine_v1`: routine info.
  - `trade_urgent_v1`: exit-risk, SL/target/book-profit/auth failure.
- Recommended office-suitable sound language:
  - Perfect alignment: short two-note soft chime.
  - Entry setup: single clean bell/pluck.
  - Conviction update: soft rising tick/chime.
  - Warning/choppy: muted low double-tap.
  - Routine: subtle tick or silent by default.
  - Urgent/exit-risk: firm two-pulse tone, not harsh.
- Routing policy:
  - `HIGH` + very strong confidence/perfect alignment -> `trade_perfect_v1`.
  - `HIGH` normal setup -> `trade_entry_v1`.
  - `UPDATE` -> `trade_update_v1`.
  - `WARNING` -> `trade_warning_v1`.
  - `INFO` -> `trade_routine_v1`.
  - `ERROR` and position-risk alerts -> `trade_urgent_v1`.
- Future implementation batch:
  - Add `res/raw/*.wav` or `*.ogg` assets.
  - Update `NotificationHelper.createChannels()` with `AudioAttributes` and `setSound(...)`.
  - Extend `NotificationHelper.send(...)` to route by richer alert type or optional sound class.
  - Keep old channel IDs as compatibility fallback.
  - Bump Android version before push.

### 2026-05-23 — Notification Sounds Implementation
- Applied Claude directive `DIRECTIVE_SOUNDS_IMPLEMENTATION_V2360.md`.
- Android target bumped to `2.3.60 (191)`.
- PWA visible label bumped to `v2.3.60 · b191`.
- Added six OGG sound assets under `Marketapp/app/src/main/res/raw/`:
  - `sound_perfect_alignment.ogg`
  - `sound_entry_setup.ogg`
  - `sound_conviction_update.ogg`
  - `sound_market_warning.ogg`
  - `sound_routine_tick.ogg`
  - `sound_urgent_risk.ogg`
- `NotificationAgent` now emits `sound_class` in alert JSON.
- Sound-class routing:
  - `perfect`: high-confidence setup, confidence `>= 75`
  - `entry`: normal setup, confidence `55-74`
  - `update`: conviction update
  - `warning`: choppy/whipsaw alert
  - `routine`: setup invalidated / low-priority info
  - `urgent`: risk/error alerts
- `NotificationHelper.kt` now creates six versioned Android notification channels:
  - `trade_perfect_v1`
  - `trade_entry_v1`
  - `trade_update_v1`
  - `trade_warning_v1`
  - `trade_routine_v1`
  - `trade_urgent_v1`
- Old channel IDs are intentionally not reused because Android locks channel sound settings once created on-device.
- Routine notifications are silent by default through `IMPORTANCE_LOW` and `setSound(null, null)`.
- Live trading decision logic, two-poll confirmation, confidence floor, choppy cooldown, and position-risk bypass remain unchanged.

### 2026-05-23 — Notification Sounds Release Status
- Push completed after user confirmation.
- Marketapp commit pushed:
  - `1e8d4d5 Add versioned notification sounds`
- MarketVivi commit pushed:
  - `8331cc9 Document notification sounds release`
- GitHub Actions validation for Marketapp commit `1e8d4d5`:
  - `Market Radar Signed Release`: success
  - run ID: `26325647308`
  - `Market Radar Debug APK Validation`: success
  - run ID: `26325647322`
- Latest GitHub release after workflow completion:
  - tag: `v2.3.60`
  - name: `Market Radar v2.3.60`
  - published: `2026-05-23T06:24:55Z`
  - asset: `app-release.apk`
- Expected app behavior after update:
  - update checker should offer `v2.3.60`
  - Android notification settings may show six new channels plus old legacy channels
  - old legacy channels are harmless and are no longer the intended route for new notification sounds
  - routine notifications are silent by default
  - perfect alignment uses a distinct high-confidence sound path
- Local validation performed before push:
  - `python3 -m py_compile` passed for `brain.py`, `ml_engine.py`, `ml_train.py`
  - six sound assets were present under `app/src/main/res/raw/`
  - smoke tests passed:
    - confidence `78` -> `sound_class = perfect`
    - confidence `65` -> `sound_class = entry`
    - confidence `32` -> no setup alert
    - conviction shift -> `sound_class = update`
    - choppy whipsaw -> `sound_class = warning` with non-zero timestamp
    - setup invalidated -> `sound_class = routine`
- Local Gradle build was not run because Java/JDK is not installed in this environment:
  - blocker: `JAVA_HOME is not set`
  - authoritative Android compile/sign validation came from GitHub Actions.

## Future Phase: Upstox Order Execution (Phase 12)

### Source Document And Verification
- Research document read:
  - `UPSTOX_API_ORDER_EXECUTION_RESEARCH_2026_05_21-1.md`
  - `UPSTOX_API_ORDER_EXECUTION_RESEARCH_2026_05_21-2.md`
  - `PHASE12_ORDER_EXECUTION_AND_BRAIN_CORRECTION_BLUEPRINT.md`
  - `DIRECTIVE_INFRASTRUCTURE_BUILD_PHASE12.md`
- Purpose:
  - future broker order execution architecture
  - sandbox testing
  - order placement
  - margin checks
  - position monitoring
  - kill switch
  - schema additions
- Claude's later blueprint splits the work into:
  - Phase 12A: execution engine
  - Phase 12B: brain calibration and correction
  - Phase 12C: trades_v2 schema expansion
- The infrastructure directive treats Phase 12 as a 5-sprint build:
  - Sprint 1: verify ML pipeline and instrument_key flow
  - Sprint 2: sandbox infra and order proxy settings
  - Sprint 3: execution UI and Supabase execution fields
  - later sprints: paper trading gate and live-readiness hardening
- Status:
  - NOT implemented in current app.
  - Current app remains decision/paper-tracking first; real trade button currently records a real-trade log in `trades_v2`, not broker execution.
- Official Upstox docs were rechecked on 2026-05-23 before saving this roadmap.
- Current official confirmations:
  - Place Order V3 exists at `https://api-hft.upstox.com/v3/order/place`.
  - Place Order V3 is sandbox-enabled.
  - Static IP restriction can block order APIs with error `UDAPI1154`.
  - Market orders may be blocked with `UDAPI1158`; limit order / market protection handling must be respected.
  - Get Funds and Margin V3 exists at `https://api.upstox.com/v3/user/get-funds-and-margin`.
  - Static IP management exists under `https://api.upstox.com/v2/user/ip`.
  - Sandbox-enabled APIs include Place Order, Place Order V3, Place Multi Order, Modify Order, Modify Order V3, Cancel Order, and Cancel Order V3.
- Correction recorded:
  - Research document references kill switch as `/v2/trading/kill-switch`.
  - Current Upstox docs show kill switch under `/v2/user/kill-switch`, with segment values such as `NSE_FO`.
  - Reconfirm endpoint from official docs immediately before implementation.

### Current App Gap
- Current `NativeBridge.kt` stores a manually pasted Upstox access token in SharedPreferences as `auth_token`.
- Current Kotlin polling uses Upstox for:
  - index quotes
  - VIX quote
  - option chain
  - option contracts / expiry discovery
  - market quote snapshots
- Current `MarketWatchService.kt` and `NativeBridge.kt` do not place, modify, cancel, or monitor broker orders.
- Current PWA `takeTradeImpl()` builds a `trades_v2` row from a candidate and saves it to Supabase.
- Current candidate/trade capture does not yet persist broker order fields:
  - `instrument_token` / `instrument_key` per leg
  - `order_id` per leg
  - fill status
  - average fill price
  - margin used
  - execution slippage
- The live option-chain payload already carries `instrument_key` per strike, but our Kotlin parser / candidate builder still does not reliably flow it through to the brain candidate payload.

### Phase 12 Must-Have Architecture
- Broker execution must be opt-in and gated behind sandbox first.
- Trading decision logic must remain separate from execution plumbing.
- Required modes:
  - paper-only
  - sandbox execution
  - live execution
- Required build split from Claude's blueprint:
  - 12A = execution engine
  - 12B = brain calibration / correction loop after fills
  - 12C = Supabase execution schema
- Required hard gates before any live order:
  - valid standard Upstox token
  - static IP/proxy path confirmed
  - fresh instrument keys for the current expiry/session
  - margin check passes
  - available funds check passes
  - explicit user confirmation
  - kill switch available
  - order tag generated
- For Phase 12, Kotlin/Android should own broker execution because it already owns Upstox token storage and network access.
- PWA should request execution through `NativeBridge`, not call broker APIs directly.
- The infrastructure directive adds a higher-confidence implementation order:
  - first add `instrument_key` to strike objects
  - then add `sellInstrumentKey` / `buyInstrumentKey` to `_build_candidate()`
  - then add `check_execution_readiness()` in `brain.py`
  - then add sandbox toggle, proxy URL, and order functions
- The ML tab should stop pretending that the model is "ready" during infra work and instead show the actual collection / execution pipeline state:
  - whether `instrument_key` is flowing
  - whether sandbox is enabled
  - whether execution proxy is configured
  - whether paper/sandbox/live readiness checks pass

### Instrument Key Plan
- Upstox order placement requires `instrument_token` such as `NSE_FO|XXXXX`.
- This is not the strike price.
- Preferred source for Market Radar:
  - extract `instrument_key` from the live option-chain response for each leg.
- Fallback sources:
  - Upstox BOD instruments file
  - official instrument search API if available/approved for the account
- Do not cache F&O instrument keys across sessions because weekly expiries create new keys.
- Candidate builder must eventually carry these fields:
  - `sellInstrumentKey`
  - `buyInstrumentKey`
  - `sellInstrumentKey2`
  - `buyInstrumentKey2`
  - trading symbols if available
  - lot size
- The upstream blueprint explicitly requires the Kotlin strike objects to expose the raw `instrument_key` from the live chain response before any execution work can proceed.

### Order Placement Strategy
- Single/two-leg spreads:
  - use limit orders only.
  - prefer hedge BUY first, then SELL leg, unless using a safe multi-order flow.
- Four-leg strategies such as Iron Condor / Iron Butterfly:
  - use Place Multi Order where possible.
  - all legs share one strategy tag.
  - all legs must return order IDs.
  - if any leg fails, cancel all successfully placed legs immediately.
- Tag format:
  - `MR_{STRATEGY}_{INDEX}_{YYYYMMDD}_{SEQ}`
  - example: `MR_BC_BNF_20260521_01`
- Limit order pricing policy must be explicitly designed:
  - SELL legs should not blindly use stale bid.
  - BUY legs should not blindly use stale ask.
  - define acceptable slippage and retry rules before live execution.

### Required NativeBridge / Kotlin Functions
- Future functions needed:
  - `getAvailableFunds()`
  - `checkMargin(legs)`
  - `placeOrder(...)`
  - `placeMultiOrder(legs)`
  - `getOrderStatus(orderId)`
  - `getOrderFillPrice(orderId)`
  - `cancelOrder(orderId)`
  - `getPositions()`
  - `killSwitchFO(...)`
  - `updateStaticIP(...)`
- These must not be mixed into the existing polling path without clear separation.
- Recommended implementation class:
  - `UpstoxOrderClient.kt`
  - keep `MarketWatchService.kt` focused on polling/brain orchestration.
- Claude's phase directive also adds:
  - `check_execution_readiness(candidate, current_result, ctx)`
  - sandbox toggle storage in prefs
  - order proxy URL storage in prefs
  - explicit execution confirmation UI before sending any broker order
- Sandbox/live transport should be different:
  - sandbox can use direct Upstox API calls
  - live orders may need an Oracle Cloud VM or other static-IP proxy path before Upstox will accept them

### Execution State Machine
- Future live execution should follow this sequence:
  1. Brain/PWA surfaces candidate.
  2. User taps execute.
  3. NativeBridge receives candidate execution payload.
  4. Validate fresh candidate age and current market hours.
  5. Resolve instrument keys for all legs.
  6. Check margin for the full spread.
  7. Check available funds.
  8. Generate strategy tag.
  9. Place orders.
  10. Poll order statuses every 3-5 seconds until terminal or timeout.
  11. Capture average fill price and filled quantity.
  12. Write execution details to Supabase `trades_v2`.
  13. If any leg rejects/fails/partially fills unsafely, cancel remaining open legs and alert user.
- The Claude infrastructure directive wants the user-facing flow to include:
  - a readiness check before execution
  - sandbox mode for request/response validation
  - a paper-trading gate dashboard before live use
  - explicit capture of execution mode on every trade row

### Critical Risk Rules
- Never allow naked short exposure from partial leg execution.
- All spread legs must fill to matching quantity, or the app must cancel/alert.
- Sandbox cannot prove real fill behavior; it mainly proves request/response and lifecycle plumbing.
- Real fill testing must start with tiny controlled exposure only after sandbox passes.
- Static IP requirement may force an Oracle VM/proxy execution path rather than direct phone-to-Upstox order placement.
- Standard access token expires daily; execution flow needs reliable token readiness before market open.
- Analytics/read-only token can be considered for market data later, but live order execution still needs standard access token.

### Supabase Phase 12 Schema Additions
- Future `trades_v2` fields needed:
  - `order_id_sell`
  - `order_id_buy`
  - `order_id_sell2`
  - `order_id_buy2`
  - `actual_sell_price`
  - `actual_buy_price`
  - `actual_net_premium`
  - `execution_slippage`
  - `legs_filled`
  - `all_legs_filled`
  - `margin_used`
  - `kill_switch_available`
- Infrastructure directive also calls for:
  - `execution_mode`
  - `execution_status`
  - `execution_error`
  - `order_tag`
- The blueprint treats `trades_v2` as the long-term source of truth for fill quality, slippage, and calibration data.
- Add explicit execution mode/status fields before coding live execution:
  - `execution_mode`: `paper`, `sandbox`, `live`
  - `execution_status`: `not_sent`, `sent`, `partial`, `filled`, `cancelled`, `rejected`, `unknown`
  - `execution_error`
  - `order_tag`

### Open Questions Before Implementation
- Does current Upstox option-chain payload in our Kotlin parser already preserve per-leg `instrument_key`?
- Should all broker order calls go through a static-IP Oracle VM/proxy, or can the phone connection satisfy static IP restrictions?
- What will be the production token-refresh flow:
  - manual daily paste
  - semi-automated OAuth
  - webhook/Supabase function notifier
- Should sandbox and live use fully separate app settings and tokens?
- What is the exact kill-switch endpoint and payload from official docs at implementation time?

### Future Research Notes: API Spectrum And Single-Leg
- Source: `API_SPECTRUM_SINGLE_LEG_RESEARCH_20260525.md` from Claude.
- Status: future-build research only; not an approved implementation plan.
- Highest-value near-term API additions appear to be the new Market Information APIs:
  - FII / DII data
  - PCR data
  - change-in-OI
  - max-pain
- Rationale:
  - these can reduce or remove fragile manual morning Force 1 entry
  - they may provide better institutional/context inputs than our current chain-derived approximations
  - this is a cleaner near-term upgrade than jumping straight into strategy redesign
- If implemented later, the likely first target is `MarketWatchService.kt`, with the goal of:
  - auto-prefilling Force 1 style morning institutional inputs
  - enriching 5-minute polls with official PCR / OI / max-pain data
- Analytics token remains a candidate for read-only GET flows later, but it is not a substitute for the standard OAuth token used in live authenticated execution flow.
- WebSocket V3 remains the long-term path for real-time option monitoring, but it is a later architecture upgrade and not part of the current app observation phase.
- Portfolio stream feed is execution-phase infrastructure, not needed before live order plumbing exists.

### Future Research Notes: Single-Leg Candidate Path
- Single-leg options should be treated as a paper-research branch only.
- Do not treat Claude's single-leg note as validated trading logic.
- No approval exists yet for:
  - `SHORT_CALL`
  - `SHORT_PUT`
  - `LONG_CALL`
  - `LONG_PUT`
  candidate generation in production use.
- The useful part of the note is the implementation framing:
  - candidate generation would need explicit new strategy types
  - naked margin must use a separate estimation path
  - per-leg monitoring logic is more important than combined P&L alone
- The strongest reusable idea is per-leg breach monitoring before full trade stop triggers:
  - sell-leg delta breach
  - premium multiple breach
  - intrinsic / ITM danger
  - sigma-distance danger zone
- If single-leg is explored later, keep this sequence:
  1. current app / spread engine observation first
  2. single-leg candidate generation in paper mode only
  3. collect at least 30-50 paper trades
  4. compare real paper outcomes vs assumptions
  5. only then consider broader implementation
- Important capital-risk note:
  - single-leg naked options are a different risk class from spreads
  - they must not be treated as a lightweight extension of the current engine

### Current Decision Boundary
- Nothing from the API spectrum / single-leg research should interrupt today's live app observation.
- If post-observation implementation work starts, the likely priority order is:
  1. Market Information API integration
  2. continued safe relay / execution validation
  3. single-leg paper-candidate research later

## 2026-05-26 App Runtime Investigation

### Observed app state from screenshots

- Version on device: `v2.3.60 / b191`
- Morning inputs were visible and saved.
- OI tab showed partial derived values such as:
  - PCR
  - max pain
  - call wall / put wall
  - breadth
- But the core live-monitoring state was inconsistent:
  - header still showed `BNF --  NF --  VIX --`
  - footer showed `Polls: 0`
  - ML tab showed:
    - `Service: STOPPED`
    - `Poll #0`
    - `Last poll Never`
    - `Watchlist: 0`
    - `Candidates: 0`
  - Trade tab still showed `Lock & Scan to generate strategies`
- Logs screen proved native activity was happening in the background:
  - `LEASE_HEARTBEAT_WRITTEN`
  - `EVALUATE_JS_CALLED`
  - `[SYNC] Triggered UI sync from native background data`

### Strongest confirmed bug

- After a successful `NativeBridge.setMorningInput(...)` call, the web layer in `MarketVivi/app.js` immediately called `NativeBridge.setBaseline(...)` again with the result of `collectBaselineFromForm()`.
- This second write could overwrite the richer native morning baseline that already contained:
  - current date
  - live BNF / NF / VIX quotes
  - discovered expiries
- This was a real session-state bug and has been fixed locally by removing that redundant overwrite.

### Export diagnostics issue

- TXT / CSV log export failure could not be diagnosed clearly before.
- Added explicit native export lifecycle logging in `NativeBridge.kt` for:
  - `beginExportFile`
  - `appendExportFileChunk`
  - `finishExportFile`
- This does not guarantee export success by itself, but it makes the next failure observable in the in-app log buffer.

### Files changed locally on 2026-05-26

- `MarketVivi/app.js`
  - removed post-lock baseline overwrite via `NativeBridge.setBaseline(...)`
- `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`
  - added export lifecycle success/failure logging

### Current status after this investigation

- One definite session-state bug is fixed locally.
- There may still be a second issue in watch-loop / service-state reporting, but it was not proven enough yet to patch safely in the same step.
- No push has been done.
- What is the retry policy for unfilled limit orders?
- Should live execution initially be limited to one-lot defined-risk spreads only?
- Should the ML tab become an infrastructure/control dashboard during Phase 12 instead of a pure model-status page?
- Should live order routing go through an Oracle VM proxy even if sandbox can run direct?
- Which settings page will own sandbox mode and proxy URL controls?

### Oracle Relay Progress (2026-05-24)

- Execution-relay architecture is now the working assumption for future mobile-only Upstox live execution:
  - phone stays the UI / brain / market-data client
  - relay owns only the fixed egress path
- Oracle Cloud Infrastructure setup was completed successfully for the relay proof-of-concept:
  - region: `India West (Mumbai)`
  - instance: `VM.Standard.E2.1.Micro`
  - OS: `Oracle Linux 9`
  - boot volume: default Always Free size
  - shielded instance: `OFF`
  - confidential computing: `OFF`
  - new VCN + new public subnet created
  - reserved public IPv4 attached to primary VNIC
  - static IP: `144.24.117.114`
  - estimated cost at creation: `$0.00`
- Relay bring-up status:
  - `mr-relay.service` is running as `opc`
  - external health check is live at:
    - `http://144.24.117.114:8080/health`
  - confirmed response:
    - `{"ok": true, "service": "market-radar-relay"}`
- HTTPS relay status:
  - self-signed certificate generated on the VM
  - relay updated to listen with TLS on `8443`
  - external HTTPS health check is live at:
    - `https://144.24.117.114:8443/health`
  - confirmed response via `curl -k`:
    - `{"ok": true, "service": "market-radar-relay"}`
- First protected upstream relay test status:
  - initial `/live/static-ip` attempt returned Cloudflare `1010` because Python's default upstream client signature was blocked
  - relay was updated to send a browser-style upstream `User-Agent`
  - relay was also updated to log each forwarded request with status and latency
  - retry result:
    - endpoint: `/live/static-ip`
    - transport: HTTPS via relay on `8443`
    - HTTP status: `200`
    - response body:
      - `{"status":"success","data":{}}`
  - this proves:
    - HTTPS relay path works
    - `X-Relay-Token` gate works
    - Bearer token forwarding works
    - Upstox accepts the authenticated request through the relay
    - Cloudflare no longer blocks the relay after the user-agent fix
- Current hard boundary:
  - HTTP on `8080` was used only for initial `/health` bring-up
  - HTTPS on `8443` is now the approved relay path for any future protected tests
  - relay IP has NOT been registered with Upstox yet
  - Android app has NOT been wired to the relay yet
- Deployment bundle prepared locally:
  - `oracle_relay_deploy_2026_05_24/`
  - `oracle_relay_https_phase_bundle.zip`
- Next approved step:
  - continue protected upstream endpoint testing over HTTPS only
  - next likely read-only endpoint: `/live/funds`
  - still no order routes yet
- Not approved yet:
  - `/live/margin`
  - `/live/order`
  - `/live/multi-order`
  - `/sandbox/order`
  - Upstox IP registration
  - app-side `order_proxy_url` integration

## Notification Agent (brain.py — NotificationAgent class)

### Two separate agent concepts

1. **Explanation/Audit Agent** (`build_explanation_audit_agent`)
   - Produces structured JSON inside the brain result for auditability.
   - Does NOT fire Android notifications.

2. **Live NotificationAgent** (`class NotificationAgent`)
   - Rule-based state machine. Not LLM-based.
   - Controls WHEN and WHETHER to send setup/market-state notifications.
   - Position-risk alerts (SL/target/book-profit) BYPASS this agent entirely.
   - Position-risk bypass is intentional because exits should not wait for setup-alert confirmation/cooldown logic.

### State tracked per poll

- `action`: last brain verdict action
- `strategy`: last strategy type
- `confidence`: last confidence value
- `timestamp`: epoch ms of last state update
- `cooldown_until`: epoch ms until alert suppression lifts
- `verdict_history`: last 6 action strings

### Alert types and conditions

**New Setup Ready** (`HIGH` -> important channel)
- Fires when:
  1. `action != 'WAIT'`
  2. `confidence >= 55`
  3. `entry_window_active == True`
  4. Same action appears in 2 consecutive polls
- Two-poll confirmation prevents single-poll false alerts.

**Conviction Update** (`UPDATE` -> important channel)
- Fires when action + strategy are unchanged but confidence shifts by at least 15 points.
- Example: Bear Call at 58% -> Bear Call at 73%.

**Setup Invalidated** (`INFO` -> routine channel)
- Fires when previous action was not WAIT and brain returns to WAIT.
- Requires 2 consecutive WAIT polls before firing.

**Market Whipsawing** (`WARNING` -> important channel)
- Fires when 3+ action-level flips are detected in `verdict_history`.
- Sets a 45-minute cooldown.
- Tracks action-level flips only. Strategy flips within the same action are naturally suppressed by two-poll confirmation.

### State persistence and Kotlin integration

- State is persisted to SharedPreferences after every poll via `notification_agent_state_json()`.
- State is restored on service restart via `reset_notification_agent(state_json)`.
- `MarketWatchService.kt` calls `notification_agent_process(result, ctx)` after every brain analysis with a 3-second timeout guard.
- Alerts are sent via `NotificationHelper.send()` when non-null.
- `NotificationHelper` applies 30-second same-title throttling.
- Channel mapping: `HIGH`/`UPDATE`/`WARNING` -> important, `INFO` -> routine, `ERROR` -> urgent.

### 2026-05-15 — Save Evening Close error (`getVarsityFilter is not defined`)
- Symptom:
  - On Market tab, after entering evening values and tapping **Save**, UI showed:
    - `Save failed: getVarsityFilter is not defined`
- Root cause:
  - `renderAll()` path used `getVarsityFilter(...)` in watchlist/positioning rendering.
  - Function definition was missing in `app.js`.
  - `saveEveningClose()` executes `renderAll()` post-save, so render exception appeared as save failure.
- Fix applied:
  - Added `getVarsityFilter(biasObj, vix)` helper in `/root/MarketVivi/app.js`.
  - Returns stable object with:
    - `primary` strategy order,
    - `allowed` strategies,
    - `rangeDetected` flag.
  - Includes range-aware fallback when `STATE.rangeSigma < 0.3`, plus bull/bear/neutral handling.
- Status:
  - Fixed locally, pending your confirmation before push.

### 2026-05-26 — Export fix not shipped + stale service status root cause

- User updated to `v2.3.61 / b192` and reported:
  - scanner clearly active (`BNF/NF/VIX` populated, `Scanned ... Poll #21`)
  - Logs tab showed live native poll activity
  - but:
    - TXT / CSV log export still appeared non-working
    - ML tab still showed `Service: STOPPED`
    - footer still showed `Polls: 0`
- Confirmed root cause #1:
  - export fix never reached the phone because `index.html` still loaded the stale log viewer bundle
  - release fix updates cache-busters to `app.js?v=1138` and `log-viewer.js?v=1139`
- Confirmed root cause #2:
  - native `getServiceStatus()` depends on `hasTodayBaseline()`
  - some restored baselines were written without `date`
  - `clearStaleSessionStateIfNeeded()` then treated the session as stale and cleared derived state while the service was still actively polling
  - evidence: `DAILY_RESET_BRIDGE: cleared stale session state for 2026-05-26` appeared during active watch mode
- Local fixes applied:
  - `Marketapp/.../NativeBridge.kt`
    - `setBaseline()` now injects `date=todayIstDate()` when missing
    - export success now triggers Android toast: `Saved to Downloads: <file>`
  - `app.js`
    - Supabase baseline restore now sends `{ ...baseline, date: _date }` into `NativeBridge.setBaseline(...)`
  - `log-viewer.js`
    - save success flash now includes destination when native save returns `location`
  - `index.html`
    - bumped `log-viewer.js` cache-buster so the export fix actually ships
- Release status:
  - prepared for `v2.3.62 / b193`
  - Android release bump: `versionName=2.3.62`, `versionCode=193`
  - Web release label: `v2.3.62 · b193`

### 2026-05-26 — Duplicate chain/ML data investigation

- User asked whether the app can create duplicate chain data and requested a code error check.
- Confirmed duplicate risk:
  - `Marketapp/SupabaseClient.kt::saveChainSnapshot()` used a plain `POST` to `chain_snapshots`.
  - Without a database-level unique constraint on `(date, session)`, repeated 2 PM / 3:15 PM captures can create duplicate rows.
  - `saveBrainSnapshot()` and `saveChainSlice()` also use insert-style writes; duplicate ML rows are possible if the same poll is re-dispatched after service restart or retry.
- Android hardening applied for release `v2.3.63 / b194`:
  - `saveChainSnapshot()` now checks for an existing `chain_snapshots` row by `date + session` and patches it before falling back to insert.
  - `MarketWatchService` now records a stable per-poll ML persistence key: `date | poll_count | poll_time | bnf | nf`.
  - If the same key appears again, ML brain snapshot + option-chain slice persistence is skipped.
  - 2 PM / 3:15 PM snapshot flags are now set before async persistence starts, and cleared only if persistence fails, reducing duplicate launches inside the capture window.
- Verification:
  - `git diff --check` passed.
  - Local Gradle compile could not run because this Codex container has no `java` binary and no `JAVA_HOME`.
- Remaining hardening recommended:
  - Add Supabase unique indexes for durable DB-level protection:
    - `chain_snapshots(date, session)`
    - ML option-chain rows need an agreed deterministic key or uniqueness policy before enforcing DB constraints.
- Release status:
  - prepared for push as `v2.3.63 / b194`.
  - Android release bump: `versionName=2.3.63`, `versionCode=194`.
  - Web release label: `v2.3.63 · b194`.

### 2026-05-27 — God-mode audit: Poll counter mismatch + missing strategy/watchlist fields

- User-reported symptoms on `v2.3.64 / b195`:
  - Footer showed `Polls: 0`.
  - ML status showed `STOPPED / Poll #0`.
  - Other sections showed live values and `Scanned ... Poll #20`, creating contradictory UI state.
  - Trade tab still showed `Lock & Scan to generate strategies` in the same session.
- Root cause confirmed:
  - `NativeBridge.getServiceStatus()` only treated the session as active when `hasTodayBaseline()` was true.
  - If baseline date validation failed but polls already existed for today (`last_poll_date=today`, `poll_count>0`), status returned `polls=0`, `running=false`.
  - JS footer trusted `serviceStatus.polls` first, so it displayed `0` even when `STATE.pollHistory` had real polls.
  - `clearStaleSessionStateIfNeeded()` could clear derived fields too aggressively when baseline date was invalid, even with same-day polls.
- Fixes applied:
  - `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`
    - Added `hasTodaySession()`:
      - true when baseline is today, OR when `last_poll_date == today` and `poll_count > 0`.
    - Updated gating for:
      - `getLatestPoll()`
      - `getPollHistory()`
      - `getBrainResult()`
      - `getCandidates()`
      - `getServiceStatus()`
      to use `hasTodaySession()` instead of strict baseline-only checks.
    - Tightened stale-derived-state cleanup:
      - now requires both `!baselineIsToday` and `last_poll_date != today`, preventing same-day active-session wipes.
  - `MarketVivi/app.js`
    - `pullNativeState()` now sets `STATE.pollCount` using max of:
      - native service poll count,
      - poll history length,
      - existing `STATE.pollCount`.
    - `renderFooter()` now shows max of native polls and `STATE.pollCount` to prevent regressions to zero during transient native status mismatch.

### 2026-05-27 — Release push completed (`v2.3.65 / b196`)

- Repositories pushed:
  - `Marketapp` commit: `320f738`
  - `MarketVivi` commit: `f62a1e9`
- Version bump:
  - Android: `versionName=2.3.65`, `versionCode=196`
  - Web label: `v2.3.65 · b196`
  - `index.html` cache-buster updated to `app.js?v=1140` and `log-viewer.js?v=1140`
- GitHub Actions status for `Marketapp` (`320f738`):
  - `Market Radar Signed Release`: success
  - `Market Radar Debug APK Validation`: success
- Latest published release confirmed:
  - tag: `v2.3.65`
  - name: `Market Radar v2.3.65`
  - asset: `app-release.apk`
  - published: `2026-05-27T07:35:30Z`

### 2026-05-27 — Post-release UI data integrity fix (DTE / σ / chart index)

- User observed on `v2.3.65 / b196`:
  - `DTE` displayed as `--T` even while expiry was present.
  - `Spotσ` / `VIXσ` chips were blank or unstable.
  - Intraday chart behavior felt stuck/confusing around BNF/NF view.
- Fixes applied in `MarketVivi/app.js`:
  - Added `dteFromExpiry()` fallback in `renderMarket()`:
    - if candidate `tDTE` is missing, DTE is derived from expiry date in IST.
  - Added sigma fallbacks in `renderMarket()`:
    - `spotSigma` falls back to derived `(spot - morningSpot) / daily1σ` for the current chart index.
    - `vixSigma` falls back to derived `(vix - morningVix) / 0.5`.
  - Hardened intraday chart poll parsing:
    - accepts both `nf/bnf` and `nfSpot/bnfSpot` payload keys.
    - accepts time from `t` / `pollTime` / `time`.
  - Improved chart toggle clarity + persistence:
    - explicit button text `View NF/BNF`.
    - persisted selection via `mr2_chart_index` in localStorage.

### 2026-05-27 — Claude brain + ML audit Step 1 fixes (`v2.3.67 / b198`)

- Scope applied:
  - Brain audit Step 1 mechanical fixes only.
  - ML architecture audit minimal safety fix only.
  - No `ivSkew`, temporal blend, or dead-signal activation was shipped in this pass.
- `Marketapp/app/src/main/python/brain.py`:
  - module import now includes `time`, so trace timestamps no longer fall back to `0`.
  - `_capital` default changed from `110000` to `250000`.
  - `analyze()` capital fallback changed from `110000` to `250000`.
  - `build_calibration()` now excludes paper trades.
  - `_get_varsity_filter()` NEUTRAL + low-IV `blocked` list no longer contradicts `allowed`.
  - `BRAIN_VERSION` updated to `2.3.67`.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketMLService.kt`:
  - retrain readiness default threshold changed from `20` to `300`.
  - manual/nightly training is blocked below `100` labeled trades.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketWatchService.kt`:
  - poll payload now includes `moveSigma`, `move_sigma`, `dayRangeSigma`, `day_range_sigma`, `dayDirection`, `day_direction`, `consecDays`, and `consec_days`.
  - `weekday` now uses ML convention `0=Mon ... 4=Fri` instead of Java `Calendar.DAY_OF_WEEK`.
- Version bump:
  - Android: `versionName=2.3.67`, `versionCode=198`.
  - Web label: `v2.3.67 · b198`.
  - cache-buster: `app.js?v=1142`, `log-viewer.js?v=1142`.
- Local verification:
  - `python -m py_compile` passed for `brain.py`, `ml_engine.py`, `ml_train.py`, `ml_temporal.py`.
  - `git diff --check` passed for both repos.
  - `pytest` could not run locally because this container has no `pytest` module installed.
  - Local Gradle compile could not run because this container has no `java` binary and no `JAVA_HOME`.

### 2026-05-27 — Remaining Claude brain audit pass (`v2.3.68 / b199`)

- Scope applied:
  - Completed the remaining brain-audit items that can be shipped in one deterministic pass.
  - ML temporal blending remains intentionally deferred.
  - EV `0.65` capture ratio remains intentionally unchanged until enough paper-trade/live outcome data exists for calibration.
- `Marketapp/app/src/main/python/brain.py`:
  - `detect_regime()` now evaluates both BNF and NF poll series.
  - Added `divergence` regime when BNF and NF direction votes separate strongly.
  - `_synthesize_market_phase()` now exposes `DIVERGENCE` phase.
  - Chain profiles are now computed before context-aware market insights and verdict synthesis.
  - `ctx["bnfProfile"]` / `ctx["nfProfile"]` are available before:
    - `nf_bnf_divergence()`
    - `day_range_position()`
    - `wall_freshness()`
    - `synthesize_verdict()` ivSkew / wall freshness contributions
  - `ctx["institutionalRegime"]` is now computed before `synthesize_verdict()`.
  - `ctx["marketPhase"]` is now wired before position verdict checks.
  - Position phase mismatch now treats `TREND_UP` / `TREND_DOWN` as trending phases.
  - IC generation is blocked after `mins_since_open >= 300` (2:15 PM IST) in both primary and fallback candidate generators.
  - Removed stale `DEAD UNTIL v2.2.9` comments after wiring was confirmed or corrected.
  - `BRAIN_VERSION` updated to `2.3.68`.
- Version bump:
  - Android: `versionName=2.3.68`, `versionCode=199`.
  - Web label: `v2.3.68 · b199`.
  - cache-buster: `app.js?v=1143`, `log-viewer.js?v=1143`.
- Local verification:
  - `python -m py_compile app/src/main/python/brain.py` passed.
  - `git diff --check` passed for both repos.
  - `pytest` still cannot run locally because this container has no `pytest` module installed.
  - Local Gradle compile still cannot run because this container has no `java` binary and no `JAVA_HOME`.

### 2026-05-27 — Remaining non-EV ML audit fixes (`v2.3.69 / b200`)

- Scope applied:
  - Completed remaining ML architecture findings except EV capture-ratio calibration.
  - EV `0.65` remains unchanged by design.
- `Marketapp/app/src/main/python/brain.py`:
  - Removed first-pass ML scoring from `_build_candidate()`.
  - Candidate build now leaves ML fields empty until SPLICE 4 has full live context.
  - Added temporal model loader for `temporal_model.json`.
  - Temporal blend is gated behind `trained == true` and `val_acc >= 0.60`.
  - Current temporal model (`~0.595` validation accuracy from audit) remains inactive automatically.
  - Temporal loader caches inactive/missing state so it does not check the filesystem once per candidate.
  - SPLICE 4 annotates candidates with `mlTemporalActive` and `mlTemporalValAcc` when the temporal gate is active.
  - `BRAIN_VERSION` updated to `2.3.69`.
- `Marketapp/.github/workflows/debug-apk.yml`:
  - Added Python gate checks before Android debug APK build:
    - `py_compile` for `brain.py` and `ml_temporal.py`.
    - `test_gate3_structural_counts.py` for forensic trace site counts.
    - `test_gate5_trace_smoke.py` for debug trace embedding.
  - `test_gate1_fixture_baselines.py` is not used in release validation because the historical fixtures lack current live option-chain context and now fail before proving a useful production invariant.
  - `test_gate5_trace_smoke.py` now validates against the live `BRAIN_VERSION` / `TRACE_SCHEMA_VERSION` constants instead of stale hard-coded `2.3.0`.
- Version bump:
  - Android: `versionName=2.3.69`, `versionCode=200`.
  - Web label: `v2.3.69 · b200`.
  - cache-buster: `app.js?v=1144`, `log-viewer.js?v=1144`.
- Local verification:
  - `python -m py_compile app/src/main/python/brain.py app/src/main/python/ml_temporal.py` passed.
  - `PYTHONPATH=app/src/main/python python app/src/main/python/tests/test_gate3_structural_counts.py` passed.
  - `PYTHONPATH=app/src/main/python python app/src/main/python/tests/test_gate5_trace_smoke.py` passed.
  - `git diff --check` passed for both repos.
  - GitHub signed release completed successfully for `v2.3.69`; latest release asset is `app-release.apk`.

### 2026-05-27 — Guardian audit follow-up (`v2.3.70 / b201`)

- Source audit:
  - Read `GUARDIAN_AUDIT_v2_3_69_20260527.md`.
  - Guardian confirmed primary architecture is intact: brain remains master, ML remains observer/advisory.
  - EV capture constant remains intentionally unchanged.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketWatchService.kt`:
  - `formatChainForBrain()` now propagates Upstox option-leg `instrument_key` into each CE/PE leg as both `instrument_key` and `instrumentKey`.
  - Also propagates `trading_symbol` as both `trading_symbol` and `symbol`.
  - This closes the execution-readiness data-flow gap where `brain.py` expected instrument keys but Kotlin omitted them from formatted chain data.
- `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`:
  - `getExecutionInfraStatus()` now checks `brain_result` candidates/watchlist for `sellInstrumentKey` / `buyInstrumentKey` fields.
  - Removed reliance on non-existent `latest_poll.bnfStrikes` / `latest_poll.nfStrikes` arrays for execution key stats.
- `Marketapp/GIVE_TO_ANTIGRAVITY.md`:
  - Replaced stale v2.2.11 handoff and old bug list with current `v2.3.70 / b201` architecture notes.
- `Marketapp/compile_errors.txt`:
  - Replaced stale UTF-16 `pollCount` compile failure with a clean UTF-8 current build-status note.
- Version bump:
  - Android: `versionName=2.3.70`, `versionCode=201`.
  - Brain: `BRAIN_VERSION=2.3.70`.
  - Web label: `v2.3.70 · b201`.
  - cache-buster: `app.js?v=1145`, `log-viewer.js?v=1145`.

### 2026-05-27 — Labelable snapshot fix (`v2.3.71 / b202`)

- Source audit:
  - Read `OPEN_CLAW_LABELABLE_FIX_20260527.md`.
  - Confirmed root cause: `_is_labelable()` used `entry_window_active`, so quiet premium-selling days could save `ml_brain_snapshots` with `is_labelable=false` even when the brain produced actionable recommendations.
- `Marketapp/app/src/main/python/brain.py`:
  - `_is_labelable()` no longer depends on `entry_window_active`.
  - Labelable now means:
    - verdict action is not `WAIT` / `STOP`;
    - confidence is at least `35`;
    - watchlist has at least one non-capital-blocked candidate with a type;
    - poll time is between 15 and 360 minutes after NSE open (`09:30` to `15:15` IST).
  - `entry_window_active` remains available for significant-move / alert logic and is not changed.
  - `BRAIN_VERSION` updated to `2.3.71`.
- `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`:
  - Added `triggerDayEvaluation()` to start `MarketMLService` with `ACTION_DAY_EVALUATION`.
- `Marketapp/app/src/main/java/com/marketradar/app/MainActivity.kt`:
  - Exposed `NativeBridge.triggerDayEvaluation()` to the PWA bridge wrapper.
- `MarketVivi/app.js`:
  - Added `triggerDayEvaluation()` helper.
  - Added `Evaluate Today` button in ML Controls beside refresh/status controls.
- Version bump:
  - Android: `versionName=2.3.71`, `versionCode=202`.
  - Web label: `v2.3.71 · b202`.
  - cache-buster: `app.js?v=1146`, `log-viewer.js?v=1146`.

### 2026-05-27 — Idempotent day evaluation UI (`v2.3.72 / b203`)

- User finding:
  - Pressing `Evaluate Today` only showed a generic started toast.
  - UI did not show whether today's evaluation was done.
  - Repeated presses could start duplicate evaluation attempts.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketMLService.kt`:
  - Day evaluation now records `evaluation_running_date`, `evaluation_done_date`, `last_evaluation_outcome_count`, and `last_evaluation_message`.
  - Successful evaluator completion marks the day done even when zero outcomes are produced, so repeated manual taps do not keep retrying a completed evaluation.
  - Timeout/failure clears running state and stores a retryable message.
- `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`:
  - `getServiceStatus()` now exposes evaluation done/running/message/outcome state to the PWA.
  - `triggerDayEvaluation()` is idempotent and returns JSON:
    - `done` when today's evaluation is already complete;
    - `running` when already in progress;
    - `started` when newly queued;
    - `failed` when service start fails.
- `MarketVivi/app.js`:
  - ML Evaluation Signals card now shows day evaluation state: `PENDING`, `RUNNING`, or `DONE`.
  - `Evaluate Today` button disables as `Evaluating...` while running and `Today Done` after completion.
  - Trigger toast now uses the native response message.
- Version bump:
  - Android: `versionName=2.3.72`, `versionCode=203`.
  - Brain: `BRAIN_VERSION=2.3.72`.
  - Web label: `v2.3.72 · b203`.
  - cache-buster: `app.js?v=1147`, `log-viewer.js?v=1147`.

### 2026-05-27 — Android lifecycle remediation (`v2.3.73 / b204`)

- Source audit:
  - Read `ML_INTEGRATION_REVIEW.md` and `OPEN_CLAW_REMEDIATION_PLAN.md`.
  - Classified stale finding: 11 PM daily retraining is already disabled by `MainActivity` startup cancellation and remains intentionally disabled.
  - Classified real findings: foreground-service starts from notification/alarm paths still needed Android API 26+/31+ hardening.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketMLService.kt`:
  - `MLAlarmReceiver` now ignores and cancels stale 11 PM alarms instead of starting nightly training.
  - `scheduleNightlyTraining()` is now a no-op that cancels any stale alarm and logs manual/monthly-gated retraining only.
  - Day evaluation notification uses `PendingIntent.getForegroundService()`.
  - ML retrain-ready notification uses `PendingIntent.getForegroundService()`.
- `Marketapp/app/src/main/java/com/marketradar/app/MarketWatchService.kt`:
  - Automatic day-evaluation launch now uses `startForegroundService()`.
  - Poll alarm PendingIntent now uses `PendingIntent.getForegroundService()`.
  - Poll alarm scheduling uses `setExactAndAllowWhileIdle()` when exact alarms are permitted, with logged inexact fallback when unavailable.
  - Empty poll-alarm cancel catch now logs a debug buffer message instead of swallowing silently.
- `Marketapp/app/src/main/AndroidManifest.xml`:
  - Added `SCHEDULE_EXACT_ALARM` permission for poll-resurrection exact alarm support.
- Version bump:
  - Android: `versionName=2.3.73`, `versionCode=204`.
  - Brain: `BRAIN_VERSION=2.3.73`.
  - Web label: `v2.3.73 · b204`.
  - cache-buster: `app.js?v=1148`, `log-viewer.js?v=1148`.
- Release verification:
  - `Marketapp` commit pushed: `eb6548f Harden background service lifecycle paths`.
  - `MarketVivi` commit pushed: `3f610a4 Document lifecycle remediation v2.3.73`.
  - GitHub Debug APK Validation completed successfully.
  - GitHub Signed Release completed successfully.
  - Latest release confirmed: `v2.3.73` / `Market Radar v2.3.73` with `app-release.apk`.

### 2026-05-28 — Safe ML transparency and fallback (`v2.3.74 / b205`)

- Scope:
  - User will investigate external AI integration separately.
  - This app-side step intentionally avoids Oracle/Ollama/new AI dependencies.
  - Brain remains deterministic owner; ML stays advisory.
- `Marketapp/app/src/main/python/ml_engine.py`:
  - Added explicit `UNSURE` action for weak ML conditions.
  - `UNSURE` triggers when probability sits near TAKE/WATCH thresholds, critical inference fields are missing, or OOD confidence is weak.
  - Strategy-blind scenarios still return `BLOCKED`.
  - Returned metadata now includes `ml_unsure`, `unsure_reason`, and `decision_source`.
- `Marketapp/app/src/main/python/brain.py`:
  - Candidate defaults now include `decisionSource=DEFAULT_BRAIN_MATH`.
  - SPLICE 4 sets `ML_ADVISORY` when ML annotates a candidate.
  - SPLICE 4 sets `ML_UNSURE_FALLBACK` when ML returns `UNSURE`.
  - ML `UNSURE` is neutralized in ranking, same as weak/OOD ML, so deterministic brain rules decide.
  - Result-level `decisionSource` / `decisionReason` mirrors the top watchlist candidate for UI visibility.
  - Early insufficient-history result emits `DEFAULT_BRAIN_MATH`.
- `MarketVivi/app.js`:
  - Candidate ML badge supports `UNSURE` with neutral grey styling.
  - Candidate cards show `Source: brain fallback` or `Source: brain + ML advisory`.
  - ML tab Live Brain Output shows result-level decision source and reason.
  - No new Supabase columns were inserted from PWA, avoiding schema-break risk.
- Version bump:
  - Android: `versionName=2.3.74`, `versionCode=205`.
  - Brain: `BRAIN_VERSION=2.3.74`.
  - Web label: `v2.3.74 · b205`.
  - cache-buster: `app.js?v=1149`, `log-viewer.js?v=1149`.
- Local verification:
  - `python -m py_compile app/src/main/python/brain.py app/src/main/python/ml_engine.py app/src/main/python/ml_temporal.py`: pass.
  - `node --check app.js`: pass.
  - `python app/src/main/python/tests/test_gate3_structural_counts.py`: pass.
  - `python app/src/main/python/tests/test_gate5_trace_smoke.py`: pass.
  - Targeted ML smoke: missing critical field and weak/OOD paths return `UNSURE` with `ML_UNSURE_FALLBACK`.
  - `git diff --check`: pass in both repos.
- Push/release verification:
  - `Marketapp` commit pushed: `76ddc6b Add ML unsure fallback transparency`.
  - `MarketVivi` commit pushed: `ae4806f Show ML decision source v2.3.74`.
  - GitHub Debug APK Validation #51 completed successfully for `76ddc6b`.
  - GitHub Signed Release #91 completed successfully for `76ddc6b`.
  - Latest release confirmed: `v2.3.74` / `Market Radar v2.3.74` with `app-release.apk`.
- Current limitation:
  - `pytest` is not installed in this Codex container.
  - Direct `test_gate6_replay.py` still fails fixture A baseline comparison (`BULL/69` expected vs current `NEUTRAL/14`) due existing replay-baseline drift with missing candidate chains; this is not introduced by the ML transparency patch.

### 2026-05-28 — Live API vs Standalone Agent Choice

- Reason for preferring a live API for the monthly Oracle evaluator:
  - hosted models keep improving without us repackaging the whole agent;
  - model quality and structured-output reliability are usually better than a tiny local model on a 1GB VM;
  - one monthly call is cheap and operationally simple;
  - the evaluator is batch-only, so network latency is not a blocker.
- Reason a standalone agent is still valuable later:
  - data stays on our own infrastructure;
  - behavior is more reproducible once the model/prompt version is pinned;
  - it avoids dependency on external quotas or API policy changes.
- Practical conclusion:
  - start with a live API for the evaluator;
  - keep the trading brain deterministic;
  - if privacy/control matters more later, migrate the evaluator to OCI A1 Flex or another pinned local runtime;
  - do not let the evaluator place trades directly, only propose rule updates for review.

### 2026-05-29 — Auto Polling Before Lock & Scan

- Implemented direction:
  - app-side data ingestion should begin from `09:15 IST` on trading days without waiting for `Lock & Scan`;
  - `Lock & Scan` remains for morning baseline lock and strategy-generation workflow only.
- Android/native changes:
  - added `MarketOpenScheduler.kt` with daily market-open scheduling;
  - added `MarketOpenAlarmReceiver` for market-open wake-up;
  - added `MarketLifecycleReceiver` to reschedule after reboot/package replace/time changes;
  - manifest now includes `RECEIVE_BOOT_COMPLETED`.
- Native startup behavior:
  - on app create, token update, or alarm/receiver trigger:
    - next market open is scheduled;
    - if market is already open and token exists, native ingestion can start immediately.
- Service-status contract expanded:
  - `getServiceStatus()` now returns:
    - `running`,
    - `sessionActive`,
    - `tokenReady`,
    - `marketDay`,
    - `marketOpen`,
    - `marketReason`,
    - `autoStartAt`,
    - existing evaluation fields.
- WebView/UI changes:
  - boot/resume now tries to auto-start ingestion when allowed by native status;
  - UI no longer throws away same-day poll state just because a same-day morning baseline is absent;
  - `watch-status` now surfaces:
    - active auto polling;
    - waiting for 9:15;
    - weekend;
    - NSE holiday;
    - missing token.
- Morning lock behavior:
  - after `Lock & Scan`, app requests an immediate native poll so the fresh morning baseline is reflected quickly.
- Notification-agent fix:
  - entry/setup alerts are no longer keyed off sigma alone;
  - they now require:
    - morning input to exist;
    - wall-clock trading window `11:00 IST` to `15:15 IST`.
  - this keeps:
    - data capture active from `09:15`;
    - setup alerts aligned to the actual trading window.
- Verification:
  - `node --check app.js`: pass.
  - `python -m py_compile app/src/main/python/brain.py`: pass.
  - `git diff --check`: pass.
- Remaining environment limitation:
  - full Kotlin compile not run in Codex shell because no `JAVA_HOME` / JDK is configured here.

### 2026-05-29 — Poll Coverage Audit + Auto-Ingestion Release (`v2.3.75 / b206`)

- Follow-up requirement clarified:
  - polling window is `09:15 AM` to `03:30 PM IST`;
  - trade-decision window starts at `11:00 AM IST`;
  - because full-day polling is automatic, app should be able to prove whether any 5-minute intervals were missed.
- Implemented release changes:
  - native service status now reports:
    - `expectedPollsByNow`
    - `expectedPollsFullDay`
    - `actualPollsToday`
    - `missedPollsToday`
    - `pollCoverageState`
  - full-day expected session count is treated as `76` polls for `09:15` to `15:30` inclusive.
  - watch badge now shows:
    - active auto polling with `actual/expected`;
    - missed-poll count when coverage is partial;
    - `Session complete` after market hours when full coverage exists;
    - holiday/weekend/waiting states otherwise.
- Version bump:
  - Android: `versionName=2.3.75`, `versionCode=206`
  - Brain: `BRAIN_VERSION=2.3.75`
  - Web label: `v2.3.75 · b206`
  - cache-buster: `app.js?v=1150`, `log-viewer.js?v=1150`
- Local verification:
  - `node --check app.js`: pass
  - `python -m py_compile app/src/main/python/brain.py`: pass
  - `git diff --check`: pass
- Push/release verification:
  - `Marketapp` commits pushed:
    - `7c77d8f Add auto polling coverage audit v2.3.75`
    - `c0249b7 Fix missing Calendar import`
    - `f02734f Retrigger signed release workflow`
  - `MarketVivi` commit pushed:
    - `d16c537 Show auto polling coverage status v2.3.75`
  - first release attempt failed because `NativeBridge.kt` was missing `import java.util.Calendar`
  - follow-up push fixed compile and retriggered release workflow
  - GitHub Debug APK Validation `#54`: success
  - GitHub Signed Release `#93`: success
  - latest release confirmed:
    - tag: `v2.3.75`
    - name: `Market Radar v2.3.75`
    - asset: `app-release.apk`

## Update: Paper Discipline Removal (`v2.3.82`)

- Decision:
  - remove `Paper Discipline Mix` from active workflow;
  - focus moves to:
    - complete market data capture,
    - complete candidate capture,
    - ML evaluation capture,
    - later constant calibration from real evidence.
- Implemented in `MarketVivi/app.js`:
  - `closeTrade()` no longer blocks paper exits with `collectPaperCloseChecklist()`;
  - closed paper trades now write:
    - `paper_close_reason_quality = null`
    - `paper_thesis_break_type = null`
    - `paper_rule_followed = null`
    - `paper_close_note = null`
    - `paper_discipline = null`
  - ML tab removed the `Paper Discipline Mix` status card.
  - open-position detail removed the paper-discipline summary block.
- Compatibility:
  - Supabase schema is not dropped; old columns stay for historic rows.
- Version sync:
  - Android: `versionName=2.3.82`, `versionCode=213`
  - Brain: `BRAIN_VERSION=2.3.82`
  - Web: `v2.3.82 · b213`
  - cache-bust: `app.js?v=1157`, `log-viewer.js?v=1157`
- 2026-06-01 night: Prepared Supabase NF50 seeding files after `config_nf50_constituents` table verification. Seed source is Taurus Mutual Fund PDF `nifty-index-constituent-as-on-12_05_2026.pdf`; every constituent was mapped to a valid Upstox `NSE_EQ|ISIN` key. Added root files `SUPABASE_NF50_STEP3_SEED_ROWS.sql.txt` and `SUPABASE_NF50_STEP4_VERIFY_SEED.sql.txt`.
- 2026-06-01 late night: tightened local NF50 remote-loader before push so app reads only `active=true` rows and only the latest `effective_date` snapshot from Supabase. This prevents future historical rows from being mixed into live breadth.
- 2026-06-01 late night: prepared NF50 remote-config push as shared release `v2.3.86 / b217`. This batch adds Supabase-backed constituent loading with bundled fallback, 12h cache, and missing-symbol diagnostics in breadth payload/UI.
- 2026-06-02: Began app-side ML 4-lane split. ML tab no longer treats recent decision history as a single mixed pool; it now pulls a wider decision sample (120 rows), computes separate lane stats for `NF intraday`, `NF swing`, `BNF intraday`, and `BNF swing`, and shows lane tags on recent decisions. This is UI/reporting separation only; Oracle/backend dataset splitting is still pending Antigravity-side work.
- 2026-06-02 follow-up: ML lane matrix now prefers native-bridged primary evaluated outcomes joined to recent brain snapshots, instead of relying only on recent `ml_decisions`. `ml_decisions` remains a fallback display source for cases where labeled outcome rows are unavailable.
- 2026-06-02 later: prepared shared release `v2.3.87 / b218` for app-side ML 4-lane split. This batch adds native bridges for recent evaluated outcomes and brain snapshots, and makes the ML tab prefer primary evaluated outcomes over mixed decision rows when computing lane stats.
- 2026-06-02 market-hours fix: auto-polling recovery hardened. `MarketOpenScheduler.maybeStartIngestionNow()` now starts `MarketWatchService` with `ACTION_FORCE_POLL` so market-open and resume paths fire an immediate first poll instead of waiting for the next loop slot. PWA `syncFromNative()` now refreshes the watch-status header after native poll pushes, and the header message for `marketReason=OPEN` was changed from misleading `Next tomorrow 9:15` idle text to explicit recovery/paused messaging.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.88 / b219` for the market-hours auto-polling recovery patch.
- 2026-06-02 pushed shared release `v2.3.88 / b219`.
  - `Marketapp` commit: `cbb99d4` (`Harden auto polling recovery v2.3.88`)
  - `MarketVivi` commit: `d540645` (`Update watch status recovery v2.3.88`)
  - Signed Android release workflow should trigger because `Marketapp/app/build.gradle.kts` changed and the GitHub release workflow is path-filtered on that file.
- 2026-06-02 Claude advanced audits reviewed in full:
  - `GOD_MODE_AUDIT_2_v2_3_87_20260602.md`
  - `ML_ARCHITECTURE_AUDIT_v2_3_87_20260602.md`
  - Highest-priority confirmed work order: `timezone/H2 outcome fix` -> `tradeMode/trade_mode snapshot mismatch` -> `ml_engine ood_score() 3-vs-4 return bug` -> `online_update safety gate` -> `canonical won-label unification`.
- 2026-06-02 audit remediation in progress, app-side fixes implemented locally:
  - H2 evaluator timezone fix: `MarketWatchService` now stamps `dateISO` and `pollTs` in IST, and `brain.py` now parses `poll_ts` as an offset-aware datetime before applying the 15:15-15:30 IST H2 window.
  - Snapshot naming fix: `brain.take_poll_snapshot()` now reads `tradeMode` first and falls back to legacy `trade_mode`.
  - ML tuple bug fix: `ml_engine.FeatureEngine.ood_score()` now always returns 4 values, matching `MLEngine.predict()` unpacking.
  - Online-update safety gate: `ml_train.online_update()` currently short-circuits with reason `online_update_disabled_pending_label_unification`; `MarketMLService` logs this as an intentional skip instead of a fake probability update.
  - App-side label cleanup: `ml_train` now resolves labels through `_resolve_training_won()` with priority `canonical_won -> outcome_h2 -> won -> pnl`; generic row parsing for holdout/training now prefers `canonical_won -> outcome_h2 -> won`; `MarketMLService.updateMLFeatureOutcome()` follows the same preference order when explicit label fields exist.
  - Retrain hard pause added: nightly/manual retraining is intentionally paused in both Kotlin and Python pending full canonical label unification. `MarketMLService.checkRetrainReadiness()` now shows a paused-state notification instead of a ready-state threshold message, `runNightlyTraining()` exits unless hidden pref `ml_retrain_force_enable=true`, and `ml_train.run()` returns `retrain_disabled_pending_canonical_won_unification`.
  - Remaining architecture work after this batch: full canonical `won` unification across historical backtest CSV, evening evaluator persistence schema, and any future re-enabled retrain/deploy path. No further app-side auto-mutation should happen until that cross-dataset contract is redesigned.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.89 / b220` for the first Claude-audit remediation batch. Scope of this batch: H2 timezone correctness, snapshot `tradeMode` fix, ML `ood_score()` tuple fix, online-update freeze, app-side label-priority cleanup, and retrain hard-pause until canonical label architecture is redesigned.
- 2026-06-02 follow-up local batch (not yet pushed): made the ML OOD path advisory-only in the PWA by removing the hard disable on `mlOodBlocked`, added `mlOodFlag` as an explicit warning field, and kept `mlOodBlocked` only as legacy metadata. Also aligned spot sourcing in `brain.py` so candidate generation and profile scoring now use the latest poll snapshot consistently instead of mixing latest-poll and baseline sources.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.90 / b221` after the advisory-OOD / spot-cleanup push. Also corrected a version-drift bug where `brain.py` still reported `BRAIN_VERSION=2.3.87`; it now matches the shipped release version `2.3.90`.
- 2026-06-02 canonical-label contract hardening in progress (local, not yet pushed):
  - `brain.evening_evaluator()` now emits `canonical_won`, mirrors it into legacy `won`, and keeps `outcome_h2` for compatibility.
  - `ml_engine.train_from_csv()` and `ml_temporal.fit_synthetic()` now read labels via unified priority `canonical_won -> outcome_h2 -> won` instead of reading only legacy `won`.
  - `ml_train._app_trade_to_row()` now exports `canonical_won` and mirrored `outcome_h2` on generated training rows.
  - `MarketMLService` aggregation now counts wins from `canonical_won` first, then `outcome_h2`, then legacy `won`; `updateMLFeatureOutcome()` now writes all three (`canonical_won`, `won`, `outcome_h2`) into `ml_features`.
  - `SupabaseClient.saveEvaluationOutcomes()` now retries with a legacy payload that strips `canonical_won` if older Supabase tables reject the new column.
  - `MarketVivi/app.js` now resolves decision labels via `canonical_won -> outcome_h2 -> won` in lane stats, fallback win-rate stats, and ML calibration checks. `ml_decisions` insert/update now writes `canonical_won` plus mirrored legacy fields, with a fallback retry that removes `canonical_won` for older schemas.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.91 / b222` so the canonical-label hardening batch is carried as a proper app release instead of a bare code push. Android `versionName=2.3.91`, `versionCode=222`, `BRAIN_VERSION=2.3.91`, web label `v2.3.91 · b222`, cache-bust `app.js?v=1164`.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.92 / b223` to carry the schema-aligned retrain/export contract work as a proper release. Android `versionName=2.3.92`, `versionCode=223`, `BRAIN_VERSION=2.3.92`, web label `v2.3.92 · b223`, cache-bust `app.js?v=1165`.
- 2026-06-02 canonical label schema + retrain contract:
  - Supabase schema was inspected first instead of patched blindly. Actual public tables include `ml_decisions`, `ml_evaluation_outcomes`, `ml_recommendation_outcomes`, `trades_v2`, but not `ml_features`.
  - Final Supabase patch was reduced to the real schema and executed successfully:
    - `ml_decisions.canonical_won` added and backfilled from `won`
    - `ml_evaluation_outcomes.canonical_won` added and backfilled from `outcome_h2`
    - `ml_recommendation_outcomes.canonical_won` added and backfilled from `outcome_h2`
    - `trades_v2.canonical_won` and `trades_v2.outcome_h2` added
  - `MarketMLService` now exports evaluator-backed training inputs:
    - `evaluation_outcomes.json`
    - `brain_snapshots.json`
  - `ml_train.run()` now accepts those two optional files and can reconstruct canonical rows from `primary` evaluated recommendations plus captured snapshot context.
  - New future retrain weighting contract:
    - backtest rows weight `1.0`
    - evaluator-backed canonical rows weight `4.0`
    - raw app-trade rows weight `3.0`
  - Retraining remains intentionally paused; this release only fixes the dataset contract and export path.
- 2026-06-02 release shipped to GitHub as `v2.3.92 / b223`:
  - `Marketapp` pushed at commit `a571bc9` (`Bump release to v2.3.92`)
  - `MarketVivi` pushed at commit `b2fb4be` (`Bump release to v2.3.92`)
  - Added Supabase schema patch files for native `canonical_won` support:
    - `supabase_canonical_won_schema_patch.sql`
    - `supabase_canonical_won_schema_patch.txt`
  - Final patch was reduced to the real Supabase schema before execution. Actual live DB did not have `ml_features`, and `ml_decisions` did not have `outcome_h2`, so the executed patch only touched the real tables/columns that existed.
  - Retrain architecture redesigned without re-enabling training:
    - `MarketMLService` now exports two future training inputs:
      - `evaluation_outcomes.json`
      - `brain_snapshots.json`
    - `ml_train.run()` now accepts optional evaluator input paths and can build canonical training rows from `primary` evaluated recommendations plus captured snapshot context.
    - New mixing contract is now:
      - backtest rows weight `1.0`
      - evaluator-backed canonical rows weight `4.0`
      - raw app-trade closes weight `3.0`
  - Retraining still remains intentionally paused; this change prepares the correct data contract for safe future re-enable.
- 2026-06-02 post-release ML evaluation audit:
  - App UI showed `748 outcomes saved`, but Supabase verification showed:
    - `ml_brain_snapshots`: 71 rows for the day
    - `ml_evaluation_outcomes`: 0 rows for the day
    - `ml_recommendation_outcomes`: 0 rows for the day
    - joined evaluation rows to snapshots: 0
  - Root cause: `MarketMLService` reported the number of rows produced by `brain.evening_evaluator()` as if they were persisted, while `SupabaseClient.saveEvaluationOutcomes()` was posting the raw mixed payload (including legacy `won`) to mismatched tables. That payload shape did not match `ml_evaluation_outcomes` / `ml_recommendation_outcomes`, so persistence could fail silently while the UI still claimed success.
  - Local fix prepared:
    - `SupabaseClient.saveEvaluationOutcomes(sessionDate, body)` now splits the payload into:
      - evaluation rows for `ml_evaluation_outcomes`
      - primary-only recommendation rows for `ml_recommendation_outcomes`
    - rows are whitelisted to real table columns only (`snapshot_id`, `candidate_id`, `role`, `sim_pnl_h2`, `outcome_h2`, `canonical_won`, `created_at`, plus `session_date` for recommendation rows)
    - service prefs now store:
      - `last_evaluation_outcome_count` = persisted count
      - `last_evaluation_produced_count` = produced count
    - ML UI text now says `Outcomes persisted` and separately shows `Produced`, so a future persistence failure cannot masquerade as a successful save.
- 2026-06-02 same-day evaluation rerun override prepared locally:
  - Added `NativeBridge.forceDayEvaluation()` and native service action `ACTION_DAY_EVALUATION_FORCE`.
  - ML button behavior now becomes:
    - normal state: `Evaluate Today`
    - after same-day completion: `Re-evaluate Today`
  - Forced rerun does not weaken the normal duplicate-run guard; it is an explicit separate path.
  - Forced rerun clears the session's existing `ml_recommendation_outcomes` and matching `ml_evaluation_outcomes` rows before re-saving, so a repair rerun replaces today's data instead of duplicating it.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.93 / b224` for the ML evaluation persistence repair release. Android `versionName=2.3.93`, `versionCode=224`, `BRAIN_VERSION=2.3.93`, web label `v2.3.93 · b224`, cache-bust `app.js?v=1166`.
- 2026-06-02 ML evaluation persistence repair release contents:
  - `SupabaseClient.saveEvaluationOutcomes(sessionDate, body)` now splits evaluator output into table-valid payloads:
    - all evaluable rows -> `ml_evaluation_outcomes`
    - primary-only rows -> `ml_recommendation_outcomes`
  - Payloads are now whitelisted to real target columns only, instead of posting the raw mixed evaluator JSON to multiple incompatible tables.
  - `MarketMLService` now records and reports:
    - produced row count
    - persisted row count
  - ML UI now distinguishes `Produced` vs `Outcomes persisted`, so Supabase write failures can no longer masquerade as successful saves.
  - Added explicit same-day repair path:
    - `NativeBridge.forceDayEvaluation()`
    - service action `ACTION_DAY_EVALUATION_FORCE`
    - button label changes to `Re-evaluate Today` once the day is already marked complete
  - Forced rerun clears today's prior recommendation/evaluation rows before saving replacement rows, preventing duplicate same-day outcomes during repair reruns.
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.94 / b225` for the native bridge wiring fix. Android `versionName=2.3.94`, `versionCode=225`, `BRAIN_VERSION=2.3.94`, web label `v2.3.94 · b225`, cache-bust `app.js?v=1167`.
- 2026-06-02 native bridge repair:
  - The app dialog correctly showed native `Build Version: 2.3.93`, so the rerun failure was not a version mismatch.
  - Root cause was in `MainActivity.injectNativeBridge()`: the JS wrapper exposed `triggerDayEvaluation()` but did not expose `forceDayEvaluation()`, even though `NativeBridge.forceDayEvaluation()` existed in Kotlin.
  - Fix: injected JS bridge now exports:
    - `triggerDayEvaluation()`
    - `forceDayEvaluation()`
  - This release is a narrow native bridge wiring correction so the `Re-evaluate Today` button can call the real Kotlin method.
- 2026-06-02 post-rerun Supabase verification:
  - Same-day repair rerun on `v2.3.94 / b225` completed successfully.
  - App reported:
    - `Produced: 748`
    - `Outcomes persisted: 814`
  - Supabase verification confirmed:
    - `ml_evaluation_outcomes`: `748` rows for the day
    - `ml_recommendation_outcomes`: `66` rows for the day
    - joined evaluation rows to snapshots: `748`
    - daily snapshots: `71`
  - The `814 persisted` total is correct and equals:
    - `748` evaluable outcome rows
    - `66` primary recommendation rows
  - Conclusion: the ML evaluation persistence bug is resolved. The remaining defect is reporting, not data capture.
- 2026-06-02 local cleanup batch prepared after persistence verification:
  - The temporary same-day repair path is now being removed to avoid future operator confusion:
    - removed `NativeBridge.forceDayEvaluation()`
    - removed `ACTION_DAY_EVALUATION_FORCE`
    - removed JS bridge exposure for `forceDayEvaluation()`
    - ML button returns to normal one-shot behavior:
      - before evaluation: `Evaluate Today`
      - after completion: disabled `Today Done`
  - Root cause of zeroed 4-lane matrix identified:
    - `SupabaseClient.fetchRecentEvaluationOutcomes()` used `fetchArrayFromTables(...)`, which returns the first non-empty table.
    - Once `ml_recommendation_outcomes` became non-empty, the app stopped reading the full evaluator dataset and only saw the smaller recommendation table.
  - Local fix prepared:
    - `fetchRecentEvaluationOutcomes()` now reads `ml_evaluation_outcomes` directly
    - falls back only to legacy `ml_decisions` if no evaluator rows exist
    - WebView outcome fetch limit increased from `200` to `1000` so the lane matrix can read the full day
  - Verification for this local cleanup batch:
    - `python -m py_compile` passed for Python ML files
    - `node --check MarketVivi/app.js` passed
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.95 / b226` for the post-repair cleanup batch. Android `versionName=2.3.95`, `versionCode=226`, `BRAIN_VERSION=2.3.95`, web label `v2.3.95 · b226`, cache-bust `app.js?v=1168`.

## Current State Snapshot (2026-06-02, after v2.3.95 / b226)

- Release state:
  - `Marketapp` pushed at commit `98f089f`
  - `MarketVivi` pushed at commit `d0efffd`
  - shipped version is `v2.3.95 / b226`
- What is confirmed fixed:
  - H2 day evaluation no longer silently fails due to timezone handling.
  - Supabase now stores real day-evaluation rows instead of only reporting local produced counts.
  - Canonical outcome labeling is active in code and schema:
    - `canonical_won`
    - `outcome_h2`
    - legacy `won` still mirrored for compatibility
  - Same-day repair rerun succeeded once and proved the persistence path works.
- Verified Supabase result from the successful rerun:
  - `ml_evaluation_outcomes`: `748` rows
  - `ml_recommendation_outcomes`: `66` rows
  - total persisted rows reported by app: `814`
  - joined evaluation rows to snapshots: `748`
  - brain snapshots for the day: `71`
- Why `814 persisted` was correct:
  - `748` evaluable rows were saved into `ml_evaluation_outcomes`
  - `66` primary recommendation rows were saved into `ml_recommendation_outcomes`
  - the app now distinguishes:
    - `Produced`
    - `Persisted`
- What was removed in `v2.3.95 / b226`:
  - temporary `Re-evaluate Today` repair path
  - native `forceDayEvaluation()` bridge method
  - `ACTION_DAY_EVALUATION_FORCE`
  - JS rerun button state and rerun prompt
- Why the rerun path was removed:
  - it was created only to recover one broken day of data after the persistence bug
  - after Supabase verification succeeded, keeping the rerun branch would add future operator confusion and risk
  - app is now back to the normal one-shot daily evaluation design
- Remaining reporting fix shipped in `v2.3.95 / b226`:
  - lane matrix had shown zeros because outcome fetch used first-non-empty table fallback
  - once `ml_recommendation_outcomes` became non-empty, the app stopped reading the full evaluator table
  - fix:
    - `fetchRecentEvaluationOutcomes()` now reads `ml_evaluation_outcomes` directly
    - falls back only to legacy `ml_decisions` if evaluator rows are absent
    - web fetch limit increased from `200` to `1000`
- Current expected ML button behavior:
  - before evaluation: `Evaluate Today`
  - while evaluation is running: `Evaluating...`
  - after evaluation is complete: disabled `Today Done`
- Retraining state:
  - still intentionally paused
  - dataset contract has been corrected for future safe re-enable
  - future training mix is designed as:
    - backtest rows weight `1.0`
    - evaluator-backed canonical rows weight `4.0`
    - raw app-trade rows weight `3.0`
- Next live checks:
  - confirm 4-lane matrix is no longer zero after the fetch-source fix
  - confirm auto polling starts cleanly at `9:15`
  - confirm header/footer/session poll counts remain aligned
  - confirm end-of-day service status does not remain stale after market close
- 2026-06-02 late-session UI + auto-start hardening prepared locally:
  - After-hours stale recommendation issue identified:
    - footer could still show `BUY PREMIUM` / `SELL PREMIUM` after market close
    - ML tab live output could also continue to show the last intraday verdict as if it were actionable
  - Root cause:
    - UI rendered cached `bd.verdict` without checking market state
    - service clock already knew market was out of hours, but UI did not gate recommendation display on `marketReason`
  - Local fix prepared:
    - added live-window gate based on `marketReason === OPEN`
    - footer now shows `🧠 closed` outside live market hours
    - ML live output now degrades to `WAIT / MARKET_CLOSED` outside the live window
    - market copilot section now shows a non-actionable `Market closed` archive message instead of surfacing the last intraday verdict as a live signal
  - Morning auto-polling recovery hardening:
    - `maybeAutoStartNativeIngestion()` previously started the native service but did not request an immediate poll
    - this could leave market-open recovery looking idle until the next 5-minute slot
    - fix: when UI auto-recovers native ingestion during open market hours, it now also calls `requestImmediatePoll()`
  - Verification:
    - `node --check MarketVivi/app.js` passed
- 2026-06-02 release prep: bumped both repos to shared version `v2.3.96 / b227` for after-hours recommendation gating and market-open recovery hardening.
- 2026-06-02 local pending batch: label-truth + premium-edge hardening prepared, not yet pushed:
  - `MarketVivi/app.js` `closeTrade()` now writes realized-truth fields directly into `trades_v2` alongside `status='CLOSED'` and `actual_pnl`:
    - `canonical_won`
    - `outcome_h2`
  - this closes the proven disconnect where `ml_decisions` had close labels but `trades_v2` stayed null for all closed rows
  - `ml_train._app_trade_to_row()` now reads `actual_pnl` first when converting `trades_v2` rows into training rows, so the new close-truth fields are not stranded in the database
  - `brain.py` directional credit candidates (`BULL_PUT`, `BEAR_CALL`) now have hard pre-ranking gates for:
    - minimum DTE (`MIN_CREDIT_DTE = 1`)
    - minimum credit/width ratio (`MIN_CREDIT_RATIO`)
    - IV-richness (`IV_RICH_MIN = 1.15`) using bootstrap realized-vol proxy `VIX * 0.85`
  - `brain.py` now emits additive decision fields on candidates:
    - `trueProb`
    - `premiumEdge`
    - `creditWidthRatio`
    - `ivRichness`
  - `rank_candidates()` now promotes `premiumEdge` ahead of win-rate after the existing safety/tier gates
  - `evaluate_candidate_risk()` no longer crashes on undefined `prob`, `forces`, `ctx_score`; R:R warning now executes deterministically
  - verification:
    - `python -m py_compile` passed for `brain.py`, `ml_train.py`, `ml_engine.py`, `ml_temporal.py`
    - `node --check MarketVivi/app.js` passed
- 2026-06-03 release prep: bumped both repos to shared version `v2.3.97 / b228` for the realized-label sync and premium-edge hardening release. Android `versionName=2.3.97`, `versionCode=228`, `BRAIN_VERSION=2.3.97`, web label `v2.3.97 · b228`, cache-bust `app.js?v=1170`.
- 2026-06-03 local NF50 breadth fallback correction prepared, not yet pushed:
  - Root cause of `NF50 coverage 47/50 · missing 3` was broader than three isolated quote failures.
  - The bundled Kotlin fallback list `NF50_CONSTITUENTS_BASE` in `MarketWatchService.kt` was stale versus the validated seed file `SUPABASE_NF50_STEP3_SEED_ROWS.sql.txt`.
  - The three surfaced missing keys were:
    - stale `SHRIRAMFIN` key `INE721A01013` instead of validated `INE721A01047`
    - stale `NESTLEIND` key `INE239A01016` instead of validated `INE239A01024`
    - one additional stale bundled constituent that surfaced in the same partial-coverage set
  - Fix applied locally:
    - replaced the entire 49-name bundled `NF50_CONSTITUENTS_BASE` with the validated seed-based fallback set (excluding Kotak, which is appended dynamically)
    - verified exact set match between Kotlin fallback and seed file
  - Impact:
    - when remote Supabase constituent loading is unavailable and the app falls back to bundled keys, NF50 breadth should now use the same current universe as the seeded remote config instead of the old stale list.
- 2026-06-03 release prep: bumped both repos to shared version `v2.3.98 / b229` for the NF50 bundled-fallback correction release. Android `versionName=2.3.98`, `versionCode=229`, `BRAIN_VERSION=2.3.98`, web label `v2.3.98 · b229`, cache-bust `app.js?v=1171`.
- 2026-06-03 Supabase integrity verification completed:
  - Historical `trades_v2` backfill verification now returns `null_closed_labels = 0` for `status = 'CLOSED' and canonical_won is null`.
  - One corrupt legacy row (`id = 4`) was identified as `CLOSED` with `actual_pnl = null`, `exit_date = null`, and `canonical_won = null`; it was normalized back to `OPEN` in Supabase rather than forcing a fake realized label.
  - Result: Claude Batch 1 label-integrity closure is now complete at the database level.
- 2026-06-03 release prep: bumped both repos to shared version `v2.3.99 / b230` for the frontend UI severity honesty release. Android `versionName=2.3.99`, `versionCode=230`, `BRAIN_VERSION=2.3.99`, web label `v2.3.99 · b230`, cache-bust `app.js?v=1172`.
  - Frontend UI severity honesty patch shipped:
  - `app.js` trade-card renderer now computes a weak-economics state for credit spreads using:
    - `premiumEdge <= 0`
    - or `maxProfit / maxLoss < 0.10`
  - Weak-economics credit candidates no longer present as fully approved trades:
    - `EXEC READY` becomes `EXEC MONITOR`
    - gate text becomes `MONITOR`
    - alignment label degrades from `ALIGNED — Entry Ready` to `STRUCTURE OK — Review Edge`
    - `SWEET SPOT` degrades to `structure ok, edge weak`
    - real-trade button is disabled and relabeled `REVIEW EDGE`
    - explicit warning text is shown with the weak economics reasons
  - Retrain / online-update status rechecked during the same pass:
    - `ml_train.run()` still returns `retrain_disabled_pending_canonical_won_unification`
    - `ml_train.online_update()` still returns `online_update_disabled_pending_label_unification`
    - `MarketMLService.runNightlyTraining()` still exits behind the retrain block unless hidden pref `ml_retrain_force_enable=true`
  - Verification:
    - `node --check app.js` passed
- 2026-06-03 audit follow-up completed locally: fallback brain removal.
  - Claude directive `DIRECTIVE_REMOVE_FALLBACK_BRAIN_20260603-1.md` was validated against code.
  - `brain.py` still had a live fallback branch in `analyze()` even though the surrounding helpers were marked as dead code.
  - The isolated fallback subtree has now been removed completely:
    - `_ltp`
    - `_delta_val`
    - `_oi_val`
    - `_forces_py`
    - `_varsity_py`
    - `_closest`
    - `_build_cand_py`
    - `generate_candidates_py`
  - The `analyze()` caller was replaced with an explicit no-trade path:
    - if no candidates survive the main generator and gate waterfall, the brain now returns `WAIT`
    - explanation is written into existing surfaced fields:
      - `verdict.reasoning`
      - `decisionReason`
      - `decision_reason`
      - `no_candidates_reason`
    - watchlist and generated candidates are forced to empty arrays in that path
  - This keeps the app philosophically honest:
    - if nothing is worth trading, the brain says `no trade`
    - it no longer manufactures backup candidates through the legacy Phase-3 fallback
  - Verification:
    - `python -m py_compile Marketapp/app/src/main/python/brain.py` passed
    - grep confirmed no remaining references to `generate_candidates_py` or the removed helper chain
  - Status:
    - local only, not yet pushed
    - next release should version-bump both repos again before push, per user rule
- 2026-06-03 BNF generation investigation completed locally: intraday-default migration.
  - User observation:
    - BNF strategies had been absent for 2–3 days, which predates the premium-edge hard gates added on 2026-06-02.
    - User requirement: default mode should always be `intraday`.
  - Root cause found:
    - the app was silently defaulting to `swing` in all three layers:
      - `app.js` default `STATE.tradeMode`
      - `NativeBridge.getTradeMode()` / `setContext()` fallback
      - `MarketWatchService.resolveTradeMode()` fallback
    - older installs also persisted this implicit `swing` state as if it were a user choice, which would suppress BNF more than NF because swing mode blocks IC/IB and leaves only stricter directional spread generation.
  - Fix applied locally:
    - `app.js`
      - default trade mode changed to `intraday`
      - added explicit-choice tracking via:
        - `mr2_trade_mode`
        - `mr2_trade_mode_explicit`
      - added settings merge helper so theme saves do not overwrite mode metadata
      - startup migration now converts legacy non-explicit `swing` to `intraday`
      - explicit user `swing` selections remain preserved
    - `NativeBridge.kt`
      - added `trade_mode_explicit` preference tracking
      - split trade-mode persistence into:
        - explicit user path: `setTradeMode(...)`
        - migration/default path: `setTradeModeDefault(...)`
      - `getTradeMode()` and `setContext()` now treat non-explicit legacy `swing` as migratable, not authoritative
    - `MarketWatchService.kt`
      - `resolveTradeMode()` now defaults to `intraday`
      - non-explicit legacy `swing` no longer wins the service resolution path
    - `MainActivity.kt`
      - JS bridge default changed from `"swing"` to `"intraday"`
      - exposed `setTradeModeDefault(...)` and `getTradeModeExplicit()` for the migration path
  - Expected impact:
    - fresh installs start in intraday mode
    - legacy installs stop inheriting silent swing mode
    - deliberate user swing choice still works
    - BNF strategy generation should no longer be suppressed by an unintended mode default
  - Verification:
    - `node --check app.js` passed
    - `python -m py_compile Marketapp/app/src/main/python/brain.py` still passed after this batch
    - local diffs are scoped to:
      - `app.js`
      - `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`
      - `Marketapp/app/src/main/java/com/marketradar/app/MarketWatchService.kt`
      - `Marketapp/app/src/main/java/com/marketradar/app/MainActivity.kt`
      - plus the already-local `brain.py` fallback-brain removal
  - Status:
    - local only, not yet pushed
    - should be released together with the fallback-brain removal in the next shared version bump
- 2026-06-03 release prep: bumped both repos to shared version `v2.4.00 / b231` for the fallback-brain removal + intraday-default migration release. Android `versionName=2.4.00`, `versionCode=231`, `BRAIN_VERSION=2.4.00`, web label `v2.4.00 · b231`, cache-bust `app.js?v=1173`.
  - Brain honesty hardening shipped:
    - removed the legacy fallback candidate generator subtree from `brain.py`
    - when no strategies survive the real generator + gates, the brain now returns explicit `WAIT`
    - surfaced reason fields now carry the no-candidate explanation instead of manufacturing backup trades
  - Trade-mode migration shipped:
    - default mode is now `intraday` in web, native bridge, and watch service
    - added explicit-choice tracking so old silent `swing` defaults migrate to `intraday`
    - deliberate user `swing` selections remain preserved
    - settings writes now merge instead of overwriting mode metadata
  - Expected effect:
    - BNF generation should no longer be suppressed by legacy swing defaults
    - no-trade days should remain honest instead of forcing fallback setups
- 2026-06-03 live ML matrix diagnosis:
  - Supabase evidence proved lane data exists:
    - `ml_evaluation_outcomes` for the day contained `primary = 85`, `secondary = 1513`
    - joined primary rows to `ml_brain_snapshots` also returned `85`
    - sample joined rows contained `primary_candidate_json.index = NF` and `context_json.tradeMode = intraday`
  - Conclusion:
    - the zeroed `4-Lane Training Matrix` is not a database persistence issue
    - it is an app-side parser/cache issue in `app.js`
  - Local fix applied:
    - `safeParseNB(...)` now returns arrays/objects directly instead of trying to `JSON.parse(...)` them again
    - this unblocks lane decoding when the native bridge already returns nested JSON objects for:
      - `primary_candidate_json`
      - `context_json`
    - `triggerDayEvaluation()` and `triggerRefreshMLStatus()` now force-refresh:
      - ML model status
      - evaluation outcomes cache
      - brain snapshots cache
    - this prevents the matrix from staying on stale cached rows immediately after evaluation completes
  - Status:
    - local only, not yet pushed
- 2026-06-03 release prep: bumped both repos to shared version `v2.4.01 / b232` for the 4-lane matrix parser/cache repair. Android `versionName=2.4.01`, `versionCode=232`, `BRAIN_VERSION=2.4.01`, web label `v2.4.01 · b232`, cache-bust `app.js?v=1174`.
  - Fixed app-side lane decoding:
    - `safeParseNB(...)` now returns arrays/objects directly instead of forcing `JSON.parse(...)`
    - this prevents `primary_candidate_json` and `context_json` from being flattened to `{}` when the native bridge already returns nested objects
  - Fixed stale ML cache refresh:
    - `triggerDayEvaluation()` now refreshes ML status, evaluation outcomes, and brain snapshots before render
    - `triggerRefreshMLStatus()` now refreshes the same caches
  - Expected effect:
    - `4-Lane Training Matrix` should now populate from real `primary` evaluation rows instead of staying at zero
- 2026-06-04 release prep: bumped both repos to shared version `v2.4.02 / b233` for the BNF expiry refresh fix, top-5 per-index display cap, and per-index candidate diagnostics. Android `versionName=2.4.02`, `versionCode=233`, `BRAIN_VERSION=2.4.02`, web label `v2.4.02 · b233`, cache-bust `app.js?v=1175`.
  - Fixed BNF expiry handling:
    - live Upstox expiry resolution now wins over stale stored expiry when the current session polls
    - `performPoll()` refreshes active expiries before building option-chain URLs
  - Added BNF/NF diagnostics:
    - brain result logs now split generated/watchlist counts per index
    - this should reveal whether BNF is missing at generation time or only missing from the curated watchlist
  - Tightened trade-tab display:
    - NF now shows only the best 5 watchlist candidates
    - BNF now shows only the best 5 watchlist candidates
- 2026-06-06 release prep: bumped both repos to shared version `v2.4.04 / b235` for the BNF observability / rejected-candidate capture batch. Android `versionName=2.4.04`, `versionCode=235`, `BRAIN_VERSION=2.4.04`, web label `v2.4.04 · b235`, cache-bust `app.js?v=1176`.
  - Preserved native architecture:
    - day evaluation still auto-runs after market close from `MarketWatchService`
    - manual `Evaluate Today` remains a fallback, not the primary trigger
  - Fixed app-side sync gap:
    - `app.js` now watches native ML evaluation status transitions
    - when native status flips to `RUNNING` or `DONE`, the app force-refreshes:
      - ML model status cache
      - evaluation outcomes cache
      - brain snapshots cache
    - `Status refreshed` timestamp is also updated automatically
  - Expected effect:
    - after native auto-evaluation completes, ML tab should reflect `Today Done` and final produced/persisted counts without requiring the user to press `Refresh Status`
- 2026-06-08 release prep: bumped both repos to shared version `v2.4.05 / b236` for Wave 3 observe-only Elephant wiring. Android `versionName=2.4.05`, `versionCode=236`, `BRAIN_VERSION=2.4.05`, web label `v2.4.05 · b236`, cache-bust `app.js?v=1177`.
  - Added additive Elephant fact-pack export in native Python brain output:
    - `result.elephant_fact_pack`
    - lane-aware candidate payloads
    - lane-scoped ML memory block from closed trades plus `signal_reliability`
    - stable poll timestamp derived from actual poll/session data instead of a fresh wall-clock fallback where possible
  - Added native Supabase support:
    - read `signal_reliability`
    - upsert opaque Elephant assessments keyed by `(poll_timestamp, lane)`
  - Added observe-only Oracle wiring in `MarketWatchService`:
    - monthly cache for `signal_reliability`
    - async POST to `/elephant`
    - per-lane candidate cap at 15
    - opaque request/response persistence to `elephant_assessments`
  - Isolation rule preserved:
    - Elephant response is not fed back into verdict, ranking, notifications, or live candidate selection
    - failures collapse to stored/logged `WAIT`, not runtime decision changes

## 2026-06-08 Hotfix - v2.4.06 / b237

- Bumped both repos to shared version `v2.4.06 / b237`.
- Root cause identified from device log:
  - `TransactionTooLargeException`
  - `POLL_TICK` Binder parcel size was about `1.1 MB`
  - Android service was trying to push full poll / brain / history / open-trade JSON through an intent extra
- User-visible impact:
  - app crash / restart loop
  - morning auto polling looked dead or unstable even though forced poll execution had started
- Fix shipped:
  - removed oversized `broadcastData` payload from `MarketWatchService`
  - `POLL_TICK` now acts only as a lightweight UI refresh signal
  - `app.js` now treats `syncFromNative(null)` as a native pull refresh and uses `pullNativeState()` to re-render
- Architectural note:
  - this did not change the agreed Claude architecture
  - it is a transport-layer sync fix only
  - no changes were made to brain decision logic, poll scheduling logic, candidate generation, ML evaluation flow, Elephant observe-only isolation, or verdict / ranking / notification pathways
  - the fix is more aligned with the architecture because UI state is now pulled from native truth instead of copied through large Binder payloads

## 2026-06-09 Async Elephant + ML Reporting - v2.4.07 / b238

- Bumped both repos to shared version `v2.4.07 / b238`.
- Implemented Claude's async Elephant directive:
  - Android app now performs a fast handoff to `/elephant` and does not wait for Gemini verdict completion inside the poll loop
  - Oracle `/elephant` now returns immediate `202 accepted`
  - live Gemini work runs in a background task on the server
  - server persists opaque `request` and `response` JSON directly to `elephant_assessments`
  - observe-only isolation remains intact:
    - no readback into brain verdict
    - no ranking change
    - no notification change
    - `quality_tag` remains `placeholder_prompt_era`
- Fixed app-side ML reporting defects:
  - `4-Lane Training Matrix` aggregation now joins UUID `snapshot_id` correctly as a string instead of coercing to number
  - lane derivation now prefers explicit lane on each outcome row, then row index/mode, then snapshot fallback
  - ML summary counts now separate:
    - evaluation rows produced/persisted
    - primary recommendation rows persisted separately
  - intended effect:
    - lane matrix should populate when evaluation outcomes exist
    - `persisted > produced` should no longer be shown as a misleading summary
- Validation completed locally:
  - `python3 -m py_compile` passed for `oracle_server/evaluator_app.py`
  - `node --check` passed for `app.js`

## 2026-06-10 Local Repo Recovery Alignment - v2.4.09 / b240

- Recreated full local working copies from the current uploaded repo archives:
  - `/root/.openclaw/Marketapp`
  - `/root/.openclaw/MarketVivi`
- Treated the current repo labels as canonical latest:
  - Android `versionName=2.4.09`, `versionCode=240`
  - PWA label `v2.4.09 · b240`
- Corrected stale release metadata after reinstall/recovery:
  - `BRAIN_VERSION` aligned to `2.4.09`
  - PWA `app.js` cache-buster advanced to `v=1181`
  - handoff/build-status notes updated to `v2.4.09 / b240`
- Push is intentionally deferred until local review/checks pass.

## 2026-06-10 ML Status Repair + Release Prep - v2.4.10 / b241

- Bumped both repos to shared version `v2.4.10 / b241`.
- Native ML day-evaluation fetch is now tolerant of rows whose `session_date` is
  missing or misaligned but whose `poll_ts` still belongs to the IST session day:
  - `SupabaseClient.fetchBrainSnapshots(...)` now falls back to recent rows and
    filters client-side by IST date using `session_date`, `poll_ts`, or legacy `date`
  - `fetchChainSlices(...)` applies the same fallback/date-normalization path
- PWA ML lane parsing is now broader so fallback decision rows classify into the
  `NF/BNF x intraday/swing` matrix even when index/mode live inside nested JSON:
  - lane derivation now inspects `primary_candidate_json`, `candidate_json`,
    `context_json`, `indexKey`, `tradeMode`, `strategy_type`, and embedded `lane`
- Intended effect from this release:
  - `Today's evaluation done: no brain snapshots found` should stop appearing for
    valid same-day rows that were only missing normalized `session_date`
  - the `4-Lane Training Matrix` should no longer stay all-zero when fallback
    labeled decisions already exist
- Release metadata aligned:
  - Android `versionName=2.4.10`, `versionCode=241`
  - PWA label `v2.4.10 · b241`
  - `BRAIN_VERSION=2.4.10`
  - cache-bust `app.js?v=1182`

## 2026-06-10 ML Status Retry Gate Repair - v2.4.11 / b242

- Bumped both repos to shared version `v2.4.11 / b242`.
- Fixed the post-update dead-end where the ML panel still showed the stale
  same-day message `Today's evaluation done: no brain snapshots found.` even
  after the snapshot fetch path had been repaired.
- Root cause:
  - native prefs had already marked `evaluation_done_date=today`
  - `Refresh Status` only reloads cached/native status; it does not rerun the
    day evaluation job
  - `triggerDayEvaluation()` therefore returned `already done` and kept the
    false-negative result frozen in place
- Native bridge behavior now self-heals this case:
  - if today's saved evaluation message says `no brain snapshots found`
  - and Supabase now does contain today's brain snapshots
  - the app marks the result as retryable instead of permanently done
  - `Evaluate Today` becomes available again and requeues the day evaluation
- Intended effect:
  - installing `v2.4.11 / b242` should let today's ML evaluation be rerun from
    the device instead of staying stuck on the stale `no brain snapshots found`
    result

## 2026-06-10 UI Thread Bridge Regression Fix - v2.4.12 / b243

- Bumped both repos to shared version `v2.4.12 / b243`.
- Fixed a regression introduced in `v2.4.11`:
  - `NativeBridge.getServiceStatus()` was calling the Supabase snapshot fetch
    path synchronously in order to decide whether the stale same-day
    `no brain snapshots found` result should be retryable
  - the WebView render path calls `getServiceStatus()` frequently, so this
    introduced a UI-thread network dependency and could leave the app sitting on
    the static placeholder screen after launch/update
- Retry gating is now local-only:
  - same-day stale `no brain snapshots found` result is considered retryable if
    local native session markers still exist (`last_poll_date=today` plus saved
    poll/latest-poll state)
  - no Supabase network call runs inside the synchronous bridge status method
- Intended effect:
  - the app should render normally again after installing `v2.4.12 / b243`
  - `Evaluate Today` should still become available for the stale same-day
    no-snapshot result without freezing the WebView UI

## 2026-06-10 Stale Evaluation Running Latch Fix - v2.4.13 / b244

- Bumped both repos to shared version `v2.4.13 / b244`.
- Fixed the post-close ML state where the UI could remain stuck on:
  - `Day evaluation: RUNNING`
  - disabled `Evaluating...` button
  - while service status already showed `STOPPED`
- Root cause:
  - `evaluation_running_date` was stored when day evaluation started
  - if `MarketMLService` was interrupted/destroyed before normal completion,
    timeout, or failure cleanup finished, that flag could remain stuck in prefs
  - the WebView trusted the stale flag and kept the ML controls latched
- Native repair:
  - `NativeBridge` now checks whether `MarketMLService` is actually running
  - if today's `evaluation_running_date` exists but the service is no longer
    alive, it clears the stale running flag and replaces the message with a
    retry prompt
  - `MarketMLService.onDestroy()` now also clears the running flag for the
    current day and marks evaluation as interrupted/retryable
- Intended effect:
  - stuck `RUNNING` / `Evaluating...` state should clear automatically
  - `Evaluate Today` should become tappable again after an interrupted ML run

## 2026-06-11 Repo Alignment + Oracle Deploy Hygiene - v2.4.14 / b245

- Bumped both repos to shared version `v2.4.14 / b245`.
- Android side:
  - added timestamp-based cleanup for interrupted ML evaluation runs
  - restored calibration read for `entry_snapshot.sigma_from_atm`
  - removed the dead app-side `elephant_assessments` writer so that table
    remains Oracle-owned
- Oracle repo side:
  - deployment scripts now carry `SUPABASE_URL` and `SUPABASE_ANON_KEY`
  - `evaluator_app.py` loads `.env` when present
  - deploy script now copies `evaluator_app.py` and `requirements.txt` into the
    runtime directory before starting `uvicorn`
- PWA alignment:
  - label updated to `v2.4.14 · b245`
  - cache-bust updated to `app.js?v=1186`

## 2026-06-11 Post-Close Evaluation Handoff Repair - v2.4.15 / b246

- Bumped both repos to shared version `v2.4.15 / b246`.
- Root cause addressed:
  - ML day evaluation had split ownership
  - `MarketWatchService` could remain alive after close while the app still
    offered manual `Evaluate Today`
  - this allowed evaluation to be launched against a still-active live watch
    service, causing repeated stuck-running / crash-prone behavior
- Android repair:
  - post-close evaluation is now handed off from `MarketWatchService` once the
    session has actually closed
  - the watch service schedules the next open and stops itself after the
    evaluation handoff instead of lingering in a fake-running closed state
  - manual `triggerDayEvaluation()` is now blocked while:
    - the watch service is still active
    - the market is still open
    - or no completed session exists yet
- PWA/UI repair:
  - ML controls now surface readiness more honestly
  - button states can show `⏳ Auto After Close` / `⛔ Not Ready` instead of
    exposing `Evaluate Today` prematurely
  - cache-bust updated to `app.js?v=1187`
- Oracle repo side also includes:
  - `diagnose_runtime.sh` helper for tonight's Oracle VM reconciliation work

## 2026-06-11 Day-Evaluation Crash Guard + Payload Slimming - v2.4.16 / b247

- Bumped both repos to shared version `v2.4.16 / b247`.
- Root cause addressed:
  - manual `Evaluate Today` could still be triggered on a partial session
    (`75/76`, missed close poll)
  - day evaluation was still fetching full snapshot rows including
    oversized `context_json` blobs
  - today’s saved evaluation input for `ml_brain_snapshots` was roughly
    47 MB with `context_json`, versus about 125 KB without it
- Android repair:
  - `triggerDayEvaluation()` now blocks partial-session runs unless the app is
    explicitly in a retry state
  - `getServiceStatus()` now exposes partial-session blocking so the UI does
    not present manual evaluation as ready
  - `runDayEvaluation()` now uses dedicated slim Supabase fetches with only the
    fields actually consumed by `brain.evening_evaluator()`
  - evaluation input logs now include byte sizes for snapshots and chain rows
- PWA/UI repair:
  - ML button can now show `⏳ Await Full Close Data` for partial sessions
  - cache-bust updated to `app.js?v=1188`

## 2026-06-11 Learning Control Plane Decisions (post-b247 architecture lock)

- The `v2.4.16 / b247` payload-slimming decision is now considered the correct
  emergency stability fix, not the final ML architecture.
- Verified evaluation tradeoff:
  - PRIMARY labels remain intact because `brain.evening_evaluator()` reads
    `primary_candidate_json` for the surfaced recommendation truth target
  - SECONDARY breadth is temporarily narrowed because removing `context_json`
    drops fallback access to full `snapshot_generated_candidates`
  - app stability takes precedence; the old same-day evaluation payload was
    roughly `47 MB` with `context_json` versus `~125 KB` without it
- Agreed long-term fix for secondary breadth:
  - do **not** restore giant `context_json` fetches
  - add a normalized compact Supabase table `ml_generated_candidates`
  - ownership: app-written at snapshot time because only the app computes the
    candidate set deterministically
  - intended purpose: restore evaluation and learning visibility for
    non-surfaced generated candidates without reintroducing large JSON blobs
- Learning control plane is now frozen to **committed release artifacts**, not
  runtime mutation:
  - learned judgment may affect live behavior only through reviewed,
    versioned, committed releases
  - no runtime-fetched calibration/config for live brain behavior
  - determinism, auditability, fixture replay, and Android stability all take
    precedence over fast remote parameter mutation
- Current intended long-term learned artifact:
  - a committed `calibration.json` carrying Class-J fitted values
  - shipped through APK/PWA release after review, not fetched live
- Classes are now explicitly separated:
  - Class F (facts): never learned, never runtime-configurable
  - Class M (math): deterministic, fixed
  - Class J (judgment): may evolve from evaluated data, but only after review
- What is allowed to influence live ranking later:
  - reviewed Class-J calibration values
  - subtract-only Branch/MATCH/JUDGE compression/veto behavior
  - subtract-only Gemini caution/veto behavior after earned authority
- What is forbidden:
  - any history-driven confidence addition
  - any LLM-produced ranking/confidence
  - any auto-applied parameter mutation
  - any same-poll feedback loop
- Monthly learning workflow agreed in principle:
  1. collect evaluated outcomes
  2. aggregate by lane/regime/strategy/bucket
  3. generate proposal artifact
  4. human review
  5. fixture replay / parity gate
  6. staged release
  7. next-cycle observation
- Immediate priority order after `b247`:
  1. keep slim evaluation payload in place
  2. reconcile live Oracle persistence / deployed-vs-repo drift
  3. verify stable automatic post-close evaluation across real close cycles
  4. add compact generated-candidate persistence (`ml_generated_candidates`)
  5. only then build the one-month review artifact pipeline

## 2026-06-11 Oracle VM Live Reconciliation (post-b247, direct VM access)

- Direct Oracle VM access details confirmed:
  - host: `144.24.117.114`
  - user: `opc`
  - port: `22`
  - auth: private key
  - runtime dir: `/home/opc/oracle_server/`
  - env file: `/home/opc/oracle_server/.env`
  - privilege: passwordless `sudo`
  - service management: **not** systemd; process is managed manually through
    `/home/opc/oracle_server/restart.sh`
- Live deployment findings:
  - VM is **not** operating as a normal git checkout (`git` not present)
  - deployment is file-copy / ad hoc runtime state, not controlled service
    management
  - live `evaluator_app.py` was stale relative to repo:
    - `/elephant` returned immediate `200` verdict JSON
    - OpenAPI described the older Wave 2 synchronous behavior
    - no live Supabase persistence path was active
  - live `restart.sh` was clobbering `.env` on every restart:
    - it rewrote `.env` with only `GEMINI_API_KEY`
    - it silently dropped `SUPABASE_URL` and `SUPABASE_ANON_KEY`
    - this explains why Supabase persistence could disappear after restarts
- Live remediation performed directly on the VM:
  - backed up `evaluator_app.py`, `.env`, and `restart.sh`
  - replaced live `evaluator_app.py` with the repo observe-only version
  - rewrote `.env` to include:
    - `GEMINI_API_KEY`
    - `SUPABASE_URL`
    - `SUPABASE_ANON_KEY`
  - rewrote `restart.sh` so it:
    - sources `.env`
    - does **not** overwrite `.env`
    - launches uvicorn with all three runtime env vars
  - restarted live uvicorn on `443` using existing trusted TLS certs
- Live verification after fix:
  - public `openapi.json` now matches the repo observe-only contract
  - `/elephant` now returns `202 Accepted`
  - a live probe for
    - `poll_timestamp = 2026-06-11T18:45:00+00:00`
    - `lane = NF_intraday`
    successfully created a new row in Supabase `elephant_assessments`
  - confirmed persisted row:
    - `poll_timestamp = 2026-06-11T18:45:00+00:00`
    - `lane = NF_intraday`
    - `assessments.status = ok`
- Operational caution:
  - the VM currently runs Python `3.9`, and the Google Gemini SDK emits
    deprecation / end-of-life warnings there
  - not an immediate blocker, but the Oracle runtime should later be upgraded
    and standardized
- Repo/handoff consequence:
  - Oracle persistence is **fixed live**
  - but the VM runtime remains operationally brittle because restart/deploy is
    still manual and not version-controlled on the host
  - next Oracle hygiene step should be to make the runtime restart contract
    explicit in repo-tracked scripts and reduce ad hoc drift

## 2026-06-11 Compact Generated-Candidate Persistence Prep - v2.4.17 / b248

- Bumped both repos to shared version `v2.4.17 / b248`.
- First Claude-aligned follow-up after `b247`:
  - added best-effort app-side persistence for compact generated-candidate rows
    destined for a new `ml_generated_candidates` table
- Safety constraints of the implementation:
  - write path is bounded to a hard cap of `50` rows per poll
  - surfaced/watchlist candidates are kept first
  - remaining non-surfaced candidates are sampled in a lane-balanced round-robin
  - persistence runs only after the normal brain snapshot save succeeds
  - if the table does not exist yet, writes fail closed and do not affect the
    live poll path
- New schema artifacts prepared in repo:
  - `supabase_ml_generated_candidates_schema_patch.sql`
  - `ML_GENERATED_CANDIDATES_RUN_STEPS.txt`
- Intended long-term role:
  - restore secondary/offline evaluation breadth without restoring giant
    `context_json` fetches
  - provide the durable compact source for later evaluator/learning work
- Release metadata aligned:
  - Android `versionName=2.4.17`, `versionCode=248`
  - `BRAIN_VERSION=2.4.17`
  - PWA label `v2.4.17 · b248`
  - cache-bust updated to `app.js?v=1189`

## 2026-06-12 Reporting Repair - v2.4.18 / b249

- Bumped both repos to shared version `v2.4.18 / b249`.
- Fixed post-close ML reporting defects found in live verification:
  - session status no longer displays poll counts above the expected full-day slot count
  - 4-lane ML matrix now reconstructs lane stats from persisted evaluation outcomes more defensibly, including candidate-id matching against saved snapshot candidates
- Forward fix also added for future evaluator rows:
  - Python/Kotlin evaluation persistence now carries `session_date`, `lane`,
    `index_key`, `trade_mode`, and `strategy_type`
  - this reduces dependence on brittle snapshot-only reconstruction
- Release metadata aligned:
  - Android `versionName=2.4.18`, `versionCode=249`
  - `BRAIN_VERSION=2.4.18`
  - PWA label `v2.4.18 · b249`
  - cache-bust updated to `app.js?v=1190`

## 2026-06-22 Class A Correctness Gate - Local Baseline

- The teacher architecture now has a dedicated `Class A Correctness Gate` on top of the saved live-day research report.
- The gate uses persisted Friday-style session data, not guessed inputs.
- It checks the saved live-session slice for:
  - `primary_snapshot_count`
  - `context_ready_count`
  - `primary_candidate_ready_count`
  - `generated_menu_ready_count`
  - `rejected_menu_ready_count`
  - `comparison_ready_count`
- The gate only passes when the evaluated primary slice has the full saved menu/context contract needed for tomorrow comparison.
- The PWA ML tab now shows a `Class A Correctness Gate` card alongside the `Daily Teacher Research` card.
- This is baseline work, not a brain-logic change. The goal is to make tomorrow's comparison explicit before any broader historical walk.

## 2026-06-22 Release Prep - v2.4.45 / b276

- The next synced release packages the `Class A` baseline gate together with the post-close service hardening.
- Android / brain version bumped to `v2.4.45 / b276`.
- `brain.py` now reports a `class_a_gate` alongside the daily teacher research report.
- `MarketMLService` now launches the teacher research report build asynchronously after aggregation so the completion path is not held hostage by report generation.
- PWA visible surfaces updated:
  - title `Market Radar v2.4.45`
  - header version `v2.4.45 · b276`
  - cache-bust `app.js?v=1216`
- The next action after confirmation is to rerun the post-close evaluation and verify that the crash is gone and the `Class A` gate remains green.

## 2026-06-22 Chosen vs Candidate Menu Visibility

- The `4-Lane Teacher Matrix` is the chosen-candidate view. It summarizes the candidates the brain actually selected for the session.
- Alternatives are equally important for research because they show what else was available at the same poll and whether the brain ranked the wrong lane or family.
- The ML tab now includes a separate `Chosen vs Candidate Menu` panel.
- The panel reads `ml_recommendation_outcomes` role splits for the evaluated session and shows:
  - total recommendation rows per lane
  - chosen rows per lane
  - alternative rows per lane
- This is the correct surface for generated-menu visibility on days where BNF existed in the candidate menu but was not chosen.
- The database still stores `role=primary/secondary` for compatibility, but user-facing language should be `chosen/alternatives`.
- Swing remains informational in this panel until multi-day replay evidence exists. Do not treat single-day swing counts as a validated swing signal.

## 2026-06-22 Live Post-Close Result - Local Eval Succeeded, Supabase Save Failed

- The `v2.4.45 / b276` post-close run did not fail in teacher evaluation itself.
- The live screen showed:
  - `Produced: 1334`
  - `Outcomes persisted: 0`
  - `Day evaluation: RETRYABLE`
  - session `22 Jun`
- This means the evaluator completed locally and wrote the retryable local output, but Supabase persistence failed after production.
- The visible downstream effects were:
  - `Daily Teacher Research` unavailable
  - `Class A Correctness Gate` showing `FAIL` with zero persisted rows
  - teacher/reporting panels reflecting incomplete persisted-state follow-through
- The attached log export from that run was not sufficient for root-cause error text. It only contained startup/sync noise and did not include the actual Supabase failure line.
- The engineering conclusion was that the high-risk segment had moved from evaluation to bulk persistence of the produced outcome rows.

## 2026-06-22 Release v2.4.46 / b277 - Chunked Outcome Persistence

- A synced follow-up release was prepared and pushed to harden the Supabase save path used after day evaluation.
- Android / brain version bumped to `v2.4.46 / b277`.
- PWA visible surfaces updated:
  - title `Market Radar v2.4.46`
  - header version `v2.4.46 · b277`
  - cache-bust `app.js?v=1217`
- Kotlin persistence change:
  - `SupabaseClient.saveEvaluationOutcomes()` no longer attempts one large monolithic POST for the full day result payload.
  - Evaluation rows and recommendation rows are now split into smaller JSON array chunks before POSTing.
  - Chunk posting is best-effort inside the existing schema-fallback chain, so a large payload is less likely to fail purely due to request size or body limits.
- This release does **not** change the evaluator math. It only hardens the post-evaluation save step.
- Pushed commits:
  - `Marketapp`: `2b631cf` - `Release v2.4.46 chunked outcome persistence`
  - `MarketVivi`: `50df584` - `Release v2.4.46 chunked outcome persistence`
- GitHub authentication note:
  - the PAT itself was valid; the successful push required using the GitHub username in the HTTPS remote form rather than the earlier failed auth format.
- Expected verification after install:
  - rerun `Retry Eval`
  - confirm `Produced` matches `Outcomes persisted`
  - confirm `Daily Teacher Research` appears
  - confirm `Class A Correctness Gate` reflects persisted data instead of the retryable zero-persist state

## 2026-06-22 b278-b280 Postmortem - Persistence Was Saved, App Verification Was Wrong

- Multiple follow-up releases were attempted after b277 because the app continued to show `Day evaluation: RETRYABLE` after retrying the 2026-06-22 post-close evaluation.
- The user screenshots showed the important contradiction:
  - app reported `Produced: 1334`
  - app reported `Outcomes persisted: 1000` or earlier partial counts
  - SQL in Supabase confirmed `ml_evaluation_outcomes` had `1334` rows for `session_date = '2026-06-22'`
- This proved the final failure was **not** missing produced rows and not a teacher-evaluator crash.
- The actual b280 bug was in Kotlin verification:
  - `SupabaseClient.countRows()` fetched rows from Supabase REST and counted the returned JSON array
  - Supabase/PostgREST was returning at most `1000` rows for that REST read
  - the app compared `1000 persisted < 1334 produced`
  - therefore it incorrectly kept the session in `RETRYABLE`
- Confirmed database state from Supabase:
  - `ml_evaluation_outcomes` count for `2026-06-22`: `1334`
  - `ml_recommendation_outcomes` count for `2026-06-22`: `74` initially, later chosen/candidate fallback showed broader menu visibility
  - `ml_recommendation_outcomes` role split initially only contained `primary`, confirming the old chosen/alternative persistence path was incomplete
- User-facing symptoms in b279/b280:
  - `Chosen vs Candidate Menu` started working after the fallback/read-path fixes
  - BNF alternatives became visible later, proving BNF was present in the candidate menu but not chosen
  - `Daily Teacher Research` stayed unavailable because the app still considered the day retryable
  - `Class A Correctness Gate` stayed `FAIL` with zero-ready fields because the completed-day status was not being finalized

## 2026-06-22 Release v2.4.50 / b281 - Exact Supabase Count Fix

- b281 is the focused fix for the false `RETRYABLE` state.
- Android / brain version bumped to `v2.4.50 / b281`.
- PWA visible surfaces updated:
  - title `Market Radar v2.4.50`
  - header version `v2.4.50 · b281`
  - cache-bust `app.js?v=1221`
- Kotlin fix:
  - `SupabaseClient.countRows()` now requests Supabase exact counts using:
    - `Prefer: count=exact`
    - `Range-Unit: items`
    - `Range: 0-0`
  - it parses the `Content-Range` total instead of counting the returned JSON array
  - this avoids the Supabase REST row-return cap and should report `1334` instead of `1000`
  - if `Content-Range` is missing, it logs a warning and falls back to body length rather than crashing
- Pushed commits:
  - `Marketapp`: `e449495` - `Fix Supabase exact evaluation counts`
  - `MarketVivi`: `8e81867` - `Bump web shell for b281`
- GitHub verification:
  - `Market Radar Signed Release`: success
  - `Market Radar Debug APK Validation`: success
  - `MarketVivi` Pages deployment: success
- Local verification limitation:
  - local Gradle compile could not run in the Codex environment because `JAVA_HOME` / `java` was unavailable
  - GitHub CI and signed release build passed, so the Kotlin compile/build was validated remotely
- Expected b281 behavior after install:
  - `Outcomes persisted` should read the exact full count for 2026-06-22 (`1334`) instead of capping at `1000`
  - `Day evaluation` should be able to leave `RETRYABLE` once exact verification sees produced and persisted counts match
  - `Daily Teacher Research` and `Class A Correctness Gate` can then proceed from completed persisted state

## 2026-06-22 Current ML Interpretation From Screenshots

- The 2026-06-22 teacher run is showing the brain-selected NF intraday lane performed poorly under honest managed-exit evaluation:
  - chosen rows around `61`
  - teacher success `0.0%`
  - expectancy around `-1.20R`
  - break-even win rate around `89.3%`
- Legacy/canonical win rate remains high in the UI, but this is explicitly the old label consumer and should not be treated as proof the strategy made money.
- The important research conclusion is that the app now needs to compare:
  - chosen candidates
  - same-session alternatives
  - full generated candidate menu
  - market context at each poll
- Do not change brain trading logic based only on legacy win rate. Use the honest teacher metrics and the chosen-vs-alternative menu evidence.
- For 2026-06-22 screenshots after b281:
  - `Chosen vs Candidate Menu` displayed `1000` rows due to the same REST read cap pattern on display pagination, but lane splits showed the menu exists:
    - NF intraday: `515` rows, `61` chosen, `454` alternatives
    - BNF intraday: `485` rows, `0` chosen, `485` alternatives
  - This display cap is a UI/data-fetch pagination issue separate from the exact count fix. It should be treated as future reporting polish unless it blocks research.

## 2026-06-23 Stage 0.2 Replay Parity - First Real Harness Run

- A local-only `historical_replay_harness.py` was added in `Marketapp-git` to test Stage `0.2` correctness-gate parity against saved live-day snapshots.
- The harness uses the shipped `brain.py` directly and does not reimplement brain logic.
- It fetches:
  - `ml_brain_snapshots` / `ml_poll_sequences`
  - `app_config` morning baseline
  - fallback `trades_v2` open/closed rows when exact trade-state capture is missing
- It replays each saved poll using cumulative `snapshot_latest_poll` history and compares:
  - `verdict_json`
  - `snapshot_generated_candidates`
  - `snapshot_rejected_candidates`
  - `snapshot_rejected_candidate_stats`
- First real verify run performed locally for `session_date = 2026-06-23`.
- Result summary:
  - `verdict = 2 / 85`
  - `generated = 54 / 85`
  - `rejected = 77 / 85`
- This is the current known parity baseline. Stage `0.2` is **not closed**.

## 2026-06-23 Replay Parity - What Was Proven And What Was Not

- The actual mismatch pattern on `2026-06-23` was structured, not random:
  - many early rows showed `generated=OK`, `rejected=OK`, `verdict=FAIL`
  - some later rows showed candidate-family divergence as well
- A conservative harness correction was applied locally:
  - reduced over-stripping of saved `context_json`
  - kept only clearly safe output/report fields stripped
- That rerun produced the **same** summary:
  - `verdict = 2 / 85`
  - `generated = 54 / 85`
  - `rejected = 77 / 85`
- Engineering conclusion:
  - over-stripping was a legitimate concern, but it was **not** the load-bearing cause of the current parity failure on this saved day
  - the main unresolved blocker remains incomplete replay input capture on the saved live day

## 2026-06-23 Direct Supabase Check - Today's Snapshots Exist But Are Pre-Patch

- Supabase was checked directly for `session_date = 2026-06-23`.
- Saved live-day rows are present and complete in the normal ML sense:
  - first rows start around `2026-06-23T03:45:02+00:00`
  - latest row observed:
    - `id = 1493`
    - `poll_ts = 2026-06-23T10:00:06+00:00`
  - latest snapshot contained:
    - `snapshot_generated_candidates = 14`
    - `snapshot_rejected_candidates` sample length `20`
    - `snapshot_rejected_candidate_stats.total = 301`
- But today's saved rows do **not** contain the new replay-capture fields:
  - `snapshot_open_trades_json` missing
  - `snapshot_closed_trades_json` missing
- Therefore today's saved day is "today" chronologically, but still **pre-patch data** for Stage `0.2` parity.
- This is because the trade-state snapshot patch existed only locally and had not yet been pushed/installed when today's market session ran.

## 2026-06-23 Direct Supabase Check - Important Context Presence

- Direct inspection of today's saved `context_json` confirmed:
  - `morning_input` present
  - `gap` present
  - `eveningClose` present
  - `globalDirection` absent in the latest inspected row
  - `prevVerdict` absent in the latest inspected row
- This means today's snapshots are valid for normal post-close ML/teacher research, but not sufficient for strict replay parity because exact live trade-state capture is missing.

## 2026-06-23 Local-Only Forward Fix Prepared

- A local Kotlin patch was added in `Marketapp-git` `MarketWatchService.kt` before the `brain.analyze()` / `take_poll_snapshot()` path.
- The patch injects the exact live trade state into the saved snapshot context:
  - `snapshot_open_trades_json`
  - `snapshot_closed_trades_json`
- Purpose:
  - future saved live days will carry the exact trade-state inputs used by the brain
  - future Stage `0.2` replay runs can then verify parity against a fully captured day instead of falling back to current `trades_v2`
- This patch is local only at this checkpoint and has **not** yet been pushed.

## 2026-06-23 Stage 0.2 Operational Conclusion

- Do **not** judge Stage `0.2` correctness-gate pass/fail from `2026-06-23`.
- `2026-06-23` is a useful diagnosis day, but not a fully instrumented parity day.
- Current correct sequence:
  1. keep the local trade-state snapshot patch
  2. push/install it in the next synced release batch
  3. let one fresh market day run with the new capture fields present
  4. rerun `historical_replay_harness.py --verify-day <fresh_date>`
  5. judge Stage `0.2` from that fresh fully captured day
## 2026-06-23 local batch after knowledge refresh

- Local-only pre-push Stage 0.2 capture expansion is now in place in `Marketapp-git`:
  - `MarketWatchService.kt` now persists `snapshot_strike_oi_json` before `brain.analyze(...)`.
  - Unified notification processing now runs before `take_poll_snapshot(...)`, so the saved snapshot can carry the exact contract emitted on that poll.
  - `brain.py` `take_poll_snapshot(...)` now persists `snapshot_brain_notification`.
- Local-only unified-notification transport instrumentation is now in place:
  - `MarketWatchService.kt` records `brain_notification_meta` into the live `brain_result`.
  - Meta contains `mode`, `dispatched`, `notify_user`, `decision_type`, `reason_code`, `updated_at_ms`.
  - Last contract + meta are also persisted in SharedPreferences for crash/reopen continuity.
  - A `brain_notification_transport_mode` pref now controls transport with values:
    - `live` = contract dispatches Android notification
    - `shadow` = contract is logged/persisted but user notification is suppressed
- Local-only bridge/UI support is now in place in `MarketVivi-git`:
  - `NativeBridge.kt` exposes `getNotificationTransportMode()` and `setNotificationTransportMode(mode)`.
  - `app.js` ML tab now shows:
    - `Brain Notification Contract`
    - `Notification Routing`
  - UI can switch routing between `Live ON` and `Shadow ONLY`.
- Replay harness (`historical_replay_harness.py`, still local/untracked) now does more than candidate parity:
  - reads `snapshot_strike_oi_json` when present
  - resets notification-agent state at verify start
  - reconstructs `brain_notification` via `brain_notification_process(...)`
  - compares saved vs replayed notification contract when `snapshot_brain_notification` is present
  - prints notification parity as `OK` / `FAIL` / `SKIP`
- Verification after this batch:
  - `python3 -m py_compile historical_replay_harness.py` passed
  - `python3 -m unittest tests.test_unified_brain_notification` passed (`8/8`)
  - `node --check MarketVivi-git/app.js` passed
- Push status:
  - none of the above has been pushed yet
  - tomorrow’s first valid strict Stage 0.2 day should be collected only after this batch is pushed and installed

## 2026-06-24 local scaffold - Supabase Gemini evaluator replacement

- A design-only Supabase replacement scaffold has now been created locally in `Marketapp-git/supabase/`.
- Important contract finding:
  - Android `NativeBridge.kt` already treats the evaluator as a job/proposal service with:
    - `POST /evaluation-jobs`
    - `GET /evaluation-jobs/{job_id}`
    - `GET /evaluation-jobs/{job_id}/proposals`
  - The checked-in `oracle_server/evaluator_app.py` does not expose that same contract.
  - Therefore the app-side evaluator job contract must be treated as canonical for the migration.
- Local scaffold contents:
  - `supabase/migrations/20260624_evaluator_jobs_schema.sql`
  - `supabase/functions/evaluator-jobs-create/index.ts`
  - `supabase/functions/evaluator-jobs-run/index.ts`
  - `supabase/functions/evaluator-jobs-status/index.ts`
  - `supabase/functions/evaluator-jobs-proposals/index.ts`
  - shared helpers under `supabase/functions/_shared/`
- Local schema shape:
  - `evaluator_jobs`
  - `evaluator_brief_artifacts`
  - `evaluator_verdict_artifacts`
  - `evaluator_proposals`
  - optional future `approved_branch_proposals`
- Guardrails locked into the design:
  - advisory only
  - no live brain/rank mutation
  - no notification authority
  - no trade execution authority
  - no automatic approval path
- Verification note:
  - `deno` is not installed in the current Codex environment, so `deno check` was not run here
  - this scaffold is for review and later deployment prep only
- Compatibility decision now recorded:
  - evaluator job output and live-approved branch rows stay separate for now
  - `evaluator_proposals` is the new advisory job-output table
  - `ai_branch_proposals` remains the live-approved table currently consumed by Android
  - a new local compatibility view `evaluator_proposals_app_view` reshapes advisory proposals into the exact card model expected by `normalizeProposalRow()`
  - later migration should copy approved evaluator rows into `ai_branch_proposals` on explicit approval, rather than forcing a live-reader table switch during the transport migration
- Payload contract now fixed locally:
  - new file `Marketapp-git/supabase/EVALUATOR_PAYLOAD_CONTRACT_20260624.md`
  - brief artifacts use top-level `brief_v1`
  - verdict artifacts use top-level `verdict_v1`
  - stub runner now persists schema-versioned structured payloads instead of free-text-only placeholders
  - later real Gemini integration should preserve those top-level shapes
- Approval-sync bridge now scaffolded locally:
  - new file `Marketapp-git/supabase/APPROVAL_SYNC_PLAN_20260624.md`
  - new function stub `supabase/functions/evaluator-proposals-review/index.ts`
  - explicit rule: evaluator output remains in `evaluator_proposals`; explicit approval copies normalized payload into `ai_branch_proposals`
  - local review stub only assumes the minimal live columns already proven by runtime usage:
    - `proposal_id`, `status`, `index_key`, `category`, `priority`, `validation_notes`, `approved_by`, `approved_at`, `proposal_json`
  - no runtime wiring has been changed yet

## 2026-06-24 position-tracking architecture clarification

- The positions tab is now treated as a separate layer from setup recommendations.
- Brain setup verdicts can remain `WAIT` without any notification.
- Open paper/real positions are still tracked independently and should surface
  through the per-trade brain data path.
- `brain.py` already emits:
  - `result["positions"][tradeId]` for per-trade monitoring
  - `brain_notification` with separate `POSITION_RISK` / `POSITION_EXIT` contracts when a position alert becomes actionable
- Local UI now shows a `Position Monitor` summary and a fallback tracking card even when there is no immediate exit/book/risk alert.
- This keeps the UX honest:
  - no entry notification for `WAIT`
  - visible tracking for open positions
  - notification only on a real state change
- Trade identity is stable through the open-trade path because persisted trades are keyed by `trade.id`, and the UI now looks up the current open trade before rendering the per-trade brain card.
- The remaining notification question is threshold-based, not structural:
  - `POSITION_*` alerts are only produced when `significant_move` is true and the open trade crosses a real risk/exit condition
  - if no alert is emitted, the fallback tracking card is the correct behavior
- Current working rule:
  - do not push partial fixes during market hours
  - wait for the after-hours validation run
  - then push all locked changes together with the same version number

## 2026-06-24 after-hours auto evaluation failure and local fixes

- Phone state after auto evaluation on `v2.4.56 / b287`:
  - app showed `Session complete` with `Polls: 77`
  - ML evaluation showed `RETRYABLE`
  - message said `Evaluation done for 2026-06-24: no brain snapshots found`
  - `Produced: 0`, `Outcomes persisted: 0`
  - app later reopened into a mostly blank WebView screen
- Direct Supabase verification from Codex showed the data was actually present:
  - `ml_brain_snapshots` has `77` rows for `2026-06-24`
  - latest snapshot observed: `id=1570`, `poll_ts=2026-06-24T10:00:07+00:00`
  - `ml_option_chain_snapshots` has `52052` rows for `2026-06-24`
  - `chain_slices` has `676` rows for `2026-06-24`
- Root cause assessment:
  - this was not a Supabase data absence
  - deployed evaluation likely reused a stale local prepared-input cache containing zero snapshots because the cache-validity check only tested file existence/length
  - a zero-snapshot evaluation was incorrectly allowed to mark the date as completed/retryable even though the app had a completed polling session
- Local Android fixes now prepared:
  - new `EvaluationLocalCache.kt` appends every brain snapshot to internal JSONL storage as a durable fallback
  - `MarketWatchService.kt` now appends snapshots locally and logs `ML_BRAIN_SNAPSHOT_SAVE`
  - `SupabaseClient.saveBrainSnapshot(...)` now logs explicit full/minimal save failure details instead of silently returning false
  - `MarketMLService.ensureEvaluationInputFiles(...)` now rejects a prepared cache when `snapshot_count <= 0`
  - if Supabase returns zero snapshots, evaluation now falls back to local cached snapshots before preparing
  - if `totalSnapshots == 0` but the same session has poll count > 0, evaluation now throws `EVAL_NO_SNAPSHOTS_AFTER_POLLING` instead of marking the day done
- Additional Stage 0.2 capture finding:
  - all `77` today snapshots contain `snapshot_open_trades_json`, `snapshot_closed_trades_json`, and `snapshot_strike_oi_json`
  - `snapshot_brain_notification` was empty in all rows because Kotlin called `take_poll_snapshot(...)` with the original pre-notification result string
  - local fix: `MarketWatchService.kt` now passes `resultObj.toString()` after `processUnifiedBrainNotifications(...)`
- Replay harness update:
  - full-day context fetch timed out when requesting all snapshot rows at once
  - `historical_replay_harness.py` now fetches snapshot rows in smaller pages and tolerates alternate table schema failures
- Stage 0.2 result for `2026-06-24` after harness paging:
  - `trade_state=snapshot:yes`
  - snapshots: `77`
  - verdict parity: `2/77`
  - generated candidate parity: `75/77`
  - rejected parity: `74/77`
  - notification parity: `0/0` because existing rows had empty `snapshot_brain_notification`
  - conclusion: capture is materially better than `2026-06-23`, but Stage 0.2 is not closed; verdict parity still has systematic drift, commonly bull-score differences of about `0.4`
- Verification completed locally:
  - `node --check MarketVivi-git/app.js` passed
  - `python3 -m py_compile Marketapp-git/historical_replay_harness.py` passed
  - Android Gradle/Kotlin compile was not run because this environment has no Java/JDK (`JAVA_HOME` not set)

## 2026-06-24 b288 retry result and b289 correction

- After installing `v2.4.57 / b288` and pressing `Retry Eval`, the app still showed:
  - `Day evaluation: RETRYABLE`
  - `Session rows: 0`
  - `Teacher v1 Shadow Review: Chosen rows: 0`
  - fallback `Paper Training Progress: 6/500`, source `recent decision fallback`
- Direct Supabase verification after the retry:
  - `ml_brain_snapshots` still has `77` rows for `2026-06-24`
  - `ml_evaluation_outcomes` still has `0` rows for `2026-06-24`
- New root cause found:
  - the Android evaluator used a single REST query for evaluation snapshots with large `context_json`
  - the same app-side projection reproduced Supabase error `57014: canceling statement due to statement timeout`
  - the replay harness had already been fixed to page this fetch, but Android `SupabaseClient.fetchEvaluationSnapshots(...)` had not
  - because today’s snapshots were created before local cache was introduced, `EvaluationLocalCache` could not rescue this historical retry
- b289 local fix:
  - `SupabaseClient.fetchEvaluationSnapshots(...)` now pages evaluation snapshot fetches with small pages
  - tested against `2026-06-24`: paged fetch returned all `77` rows without timeout
  - version bumped to `v2.4.58 / b289` in both repos

## 2026-06-25 release chain and current baseline

- Releases pushed in sync after the `b289` timeout fix:
  - `v2.4.60 / b291`
    - fixed evaluation input fetch/prep OOM by streaming snapshot/chain preparation instead of loading the entire response path into memory
  - `v2.4.61 / b292`
    - fixed the later aggregation/report OOM path by removing full snapshot-array reload during aggregation
  - `v2.4.62 / b293`
    - added teacher-research artifact rebuild on demand
    - stale negative report-cache bypass
    - historical snapshot diagnostics fallback to saved local snapshot file
    - PWA refresh now force-refreshes teacher report/lane summary/brain snapshots
- Repo sync state currently locked:
  - `Marketapp` commit `8beee0b`
  - `MarketVivi` commit `e46711e`
  - version `2.4.62 / b293`
- Important runtime milestone now confirmed from phone reevaluation:
  - on `v2.4.61 / b292`, historical reevaluation for `2026-06-24` reached:
    - `Day evaluation: DONE`
    - `Outcomes persisted: 411`
    - `Produced: 411`
    - `Progress: 77/77 snapshots`
    - `Session Done`
- Interpretation:
  - the main reevaluation crash / OOM baseline is materially fixed
  - the remaining issue is no longer "evaluation cannot finish"
  - the remaining issue is the post-evaluation artifact/publication layer:
    - `Daily Teacher Research`
    - `Class A Correctness Gate`
    - `Historical Snapshot Diagnostics`

## 2026-06-25 live Supabase audit for teacher-analysis readiness

- Direct service-role audit performed today to decide whether teacher analysis needs Upstox backfill now.
- Current row counts observed:
  - `ml_brain_snapshots`: `1594`
  - `ml_poll_sequences`: `0`
  - `ml_evaluation_outcomes`: `9076`
  - `ml_recommendation_outcomes`: `1545`
  - `historical_option_candles`: `874325`
- Recent session snapshot counts:
  - `2026-06-25`: `25`
  - `2026-06-24`: `77`
  - `2026-06-23`: `85`
  - `2026-06-22`: `79`
  - `2026-06-19`: `76`
  - `2026-06-18`: `58`
- Recent session completeness checks:
  - `2026-06-23`
    - primary present `53`
    - generated present `53`
    - rejected present `83`
    - labelable `33`
    - outcomes `527` with `53 primary` and `474 secondary`
  - `2026-06-22`
    - primary present `74`
    - generated present `74`
    - rejected present `76`
    - labelable `66`
    - recommendation table still reflects older persistence shape
  - `2026-06-19`
    - primary present `67`
    - generated present `67`
    - rejected present `74`
    - labelable `39`
  - `2026-06-24`
    - `77` snapshots total
    - spot check of first `25` rows showed `23` with primary/generated/rejected
    - outcomes `411` with `44 primary` and `367 secondary`
    - chain coverage `52052` in `ml_option_chain_snapshots`
- Working conclusion:
  - recent saved live sessions are enough for Class A teacher analysis without Upstox right now
  - they are enough for correctness/parity/artifact validation
  - they are not enough by themselves to justify a meaningful long-horizon teacher baseline or `strategy_weights`
  - therefore:
    - no immediate Upstox pull is required for current Class A work
    - Upstox backfill should wait until after Stage `0.2 / 1.x` measurement foundation is stable

## 2026-06-25 Class A / Class B interpretation and Stage 1 direction

- Current architectural understanding is now:
  - `Class A` = snapshot already has saved generated candidate menu
  - `Class B` = menu is missing and would need regeneration/reconstruction
- This is now treated as the real boundary, not simply "recent days vs old days".
- Claude’s Stage 1 direction was reviewed and accepted with one correction:
  - correct:
    - evolve `historical_replay_harness.py`
    - keep 3 lanes:
      - correctness
      - Class A measurement
      - Class B reconstruction later
    - do not build a separate emulator yet
    - do not pull Upstox history yet
  - correction:
    - `historical_option_candles.open_interest` was already verified earlier
    - so the Class B blocker is not raw OI existence alone
    - the real blocker is broader reconstruction fidelity
- Local-only harness preparation completed in `Marketapp-git/historical_replay_harness.py`:
  - explicit snapshot classification:
    - `class_a` = saved generated menu present
    - `class_b` = saved generated menu missing
  - new SQLite inventory table `historical_snapshot_inventory`
  - `historical_outcomes` now carries `snapshot_class`
  - walk mode now supports:
    - `--walk-mode class_a`
    - `--walk-mode all`
  - default walk restricted to Class A
  - local aggregation restricted to `snapshot_class = 'class_a'`
  - local validation passed:
    - `python3 -m py_compile historical_replay_harness.py`
    - `python3 historical_replay_harness.py --help`
- These harness changes are local only and not pushed yet.

## 2026-06-25 FII Short% trend check

- Code review performed for the `FII Short% Trend` section shown in the OI tab.
- Files traced:
  - `Marketapp-git/app/src/main/python/brain.py`
  - `MarketVivi-git/app.js`
  - `Marketapp-git/app/src/main/java/com/marketradar/app/MarketWatchService.kt`
  - `Marketapp-git/app/src/main/java/com/marketradar/app/SupabaseClient.kt`
- Current conclusion:
  - the trend formula itself is not wrong
  - example `81.0 -> 85.0` correctly becomes:
    - `BUILDING`
    - `bearish`
    - `AGGRESSIVE` because latest move is `>= 3`
- Real risk area identified:
  - the live brain uses generic `premium_history` as `yesterdayHistory`
  - so the weak point is historical-input contract quality/ordering, not the trend math
- Working note:
  - patch later if needed by normalizing the history input contract for FII/VIX/DII morning-context use
  - do this together with after-hours ML evaluation/artifact checks, not as a standalone market-hours patch

## 2026-06-25 detailed brain signal study and Claude consultation

- A full code-level study of the current brain signal architecture was completed.
- Study file created:
  - `BRAIN_SIGNAL_STUDY_20260625.md`
- Claude consultation file created:
  - `CONSULT_CLAUDE_BRAIN_SIGNAL_VALIDITY_20260625.md`
- Core findings from the study:
  - the app does not have one brain; it has layered deterministic stages:
    - thesis/context brain
    - intraday drift/effective bias layer
    - strategy-family selection
    - candidate generation
    - candidate ranking
    - verdict-to-execution alignment
    - notification contract
  - strongest components:
    - candidate generation
    - rejected-candidate capture
    - ranking waterfall
    - notification stability logic
    - effective bias architecture
  - weakest / most heuristic components:
    - the final confidence number
    - threshold-heavy morning/context heuristics
    - overloading generic `premium_history` for multiple signal families
    - thesis/execution blending without preserving both states separately
- Most important architectural insight now recorded:
  - there are at least two truths per poll:
    - pre-alignment thesis truth
    - post-alignment executable truth
  - if evaluation artifacts preserve only the final surfaced output, teacher analysis will mix thesis failure with execution/ranking substitution and we will not know what actually failed
- Current recommendation now recorded:
  - preserve both pre-alignment and post-alignment verdict states in future evaluation artifacts
  - treat current confidence as a policy-readiness score, not a probability
  - use the deterministic brain as a structured policy baseline and candidate generator
  - let teacher measurement quantify and reweight the system before any LLM/Edge reasoning layer is promoted
- Current working rule remains:
  - no LLM wiring yet
  - first stabilize:
    - post-evaluation artifact layer
    - Stage `0.2` correctness
    - Stage `1.x` measurement foundation

## 2026-06-25 Stage 1 harness implementation progress

- Local-only Stage 1 implementation files created:
  - `STAGE1_IMPLEMENTATION_CHECKLIST_20260625.md`
- `Marketapp-git/historical_replay_harness.py` was extended locally with the first real Stage 1 measurement layer.
- New local harness capabilities now include:
  - persistence of thesis vs execution fields from saved snapshots
    - `thesis_action`
    - `thesis_strategy`
    - `execution_action`
    - `execution_strategy`
    - `execution_candidate_id`
    - `execution_candidate_index`
    - `execution_aligned`
    - `dominant_lane`
    - `dominant_count`
    - `has_pre_alignment_fields`
    - `thesis_equals_execution`
  - automatic SQLite schema migration for existing local DBs via `ALTER TABLE`
  - `candidate_source` tagging in local outcome rows
    - `primary`
    - `generated`
    - `rejected_counterfactual`
  - Stage 1 aggregate tables:
    - `stage1_snapshot_metrics`
    - `stage1_metric_summary`
- Current Stage 1 aggregates are designed to separate:
  - chosen candidate vs best available candidate
  - chosen candidate vs best candidate inside execution family
  - thesis family vs best available family
  - whether thesis and execution agreed or diverged
- Validation completed locally:
  - `python3 -m py_compile historical_replay_harness.py`
  - `python3 historical_replay_harness.py --help`
- These harness changes are local only and not pushed yet.

## 2026-06-25 Stage 1 failure-mode classifier extension

- Claude’s `Candidate Failure-Mode Classifier` directive was accepted as a valid Stage 1 extension.
- Local-only harness work now includes:
  - per-snapshot failure classification into exactly one bin:
    - `NO_VIABLE`
    - `GATE_BLOCKED`
    - `RANK_WRONG`
    - `EXIT_DESTROYED`
  - new local table:
    - `stage1_failure_modes`
  - new aggregate tables:
    - `stage1_failure_mode_breakdown`
    - `stage1_rejection_reason_summary`
- Key implementation rules preserved:
  - no generator changes
  - no gate changes
  - no ranking changes
  - no exit changes
  - rejected candidate R is kept as a separate counterfactual / lower-confidence series
- Current local limitation before the next patch:
  - older snapshots only preserved a compact rejected-candidate sample, which was insufficient to reconstruct rejected 4-leg structures reliably

## 2026-06-25 full rejected 4-leg capture fix for future snapshots

- Root cause identified:
  - the live brain already had full rejected candidate data in memory, including 4-leg structures
  - but `take_poll_snapshot()` compacted rejected candidates into a reduced sample shape
  - that compact form dropped enough leg detail that historical replay could not reliably score rejected `IRON_CONDOR` / `IRON_BUTTERFLY` rows later
- Local fix implemented in `Marketapp-git/app/src/main/python/brain.py`:
  - existing compact field remains:
    - `snapshot_rejected_candidates`
  - new full-fidelity field added for future snapshots:
    - `snapshot_rejected_candidates_full`
  - this preserves:
    - `sellStrike2`
    - `buyStrike2`
    - `sellType2`
    - `buyType2`
    - full `legs`
    - rejection metadata and economics
- Local harness was updated to prefer `snapshot_rejected_candidates_full` when present.
- Result:
  - future saved Class A snapshots will preserve rejected 4-leg candidates properly for teacher replay
  - older already-saved snapshots remain limited by the older compact capture
- Validation completed locally:
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m py_compile historical_replay_harness.py`
- This rejected-4-leg capture fix is local only and not pushed yet.

## 2026-06-25 post-close UI state before day evaluation actually runs

- Phone screenshots at about `15:42` on `v2.4.62 / b293` show:
  - session complete
  - service stopped
  - `Day evaluation: RETRYABLE`
  - `Waiting for post-close evaluation for 25 Jun`
  - all teacher/artifact sections still zero or pending
  - `Daily Teacher Research` pending
  - `Class A Correctness Gate` pending
  - `Candidate Pipeline Diagnostics` all zero
  - live brain output `WAIT`
  - `All candidates rejected by the gate waterfall`
- Current interpretation:
  - this does **not** look like the earlier OOM/fetch-prep crash state
  - it looks like a pre-evaluation / not-yet-run post-close state
  - at this screenshot time, the app had not yet completed the post-close day evaluation for `2026-06-25`
- Log evidence from the attached CSV supports that interpretation:
  - latest poll completion shown around `15:15`
  - `Poll #76 complete, candidates=0`
  - `BRAIN_RESULT ... generated=0 watchlist=0`
  - `BRAIN_NOTIFICATION_CONTRACT: type=WAIT`
  - `ML_CHAIN_SAVE: rows=682 saved=true`
  - no OOM stack, no evaluation crash, no `DAY_EVAL_ACTION_FAIL` visible in the examined tail
- One UI inconsistency is visible:
  - top banner shows `polls 76/76`
  - bottom footer shows `Polls: 79`
  - this appears to be a display/state-sync discrepancy, not evidence of evaluation failure
- Working conclusion at this point:
  - wait for the actual post-close ML evaluation run / retry before calling today a failure
  - the screenshot state alone is not the same as the earlier broken `411/0/OOM` pattern

## 2026-06-25 confirmed post-close evaluation blocker on no-candidate day

- New log after manual `Refresh Status` / `Retry Eval` proved that the post-close handoff actually fired:
  - `15:31:12.629` `DAY_EVAL_HANDOFF: launched post-close evaluation for 2026-06-25`
- The real failure is now explicit and is not the old OOM:
  - `15:31:37.678` `EVAL_FAIL[PREPARING]: EVAL_NO_LEGKEYS: no candidate option legs found across 80 snapshots`
  - repeated again at `15:58:33.127`
- Meaning:
  - post-close evaluation started
  - evaluation preparation aborted because the day had effectively zero generated/watchlist candidates and therefore no evaluable option-leg keys
- This matches the live UI state for the day:
  - `Action: WAIT`
  - `Watchlist: 0`
  - `Candidates: 0`
  - `All candidates rejected by the gate waterfall`
- Current interpretation:
  - this is a new logic/contract failure mode, not the earlier fetch/prep/aggregation memory crash
  - on a no-candidate day, the evaluator currently throws and leaves the session `RETRYABLE`
  - instead, it should handle "no evaluable leg keys for the day" as a valid empty-result outcome and publish a clean zero-row / no-trade session state
- Important UI/state note:
  - top banner still shows `polls 76/76`
  - bottom footer shows `Polls: 79`
  - evaluator log refers to `80 snapshots`
  - this suggests separate counting domains (scheduled slots vs actual poll rows/snapshots), not necessarily a crash by itself

## 2026-06-25 local fix for no-candidate-day evaluation contract

- Local-only patch implemented in `Marketapp-git/app/src/main/java/com/marketradar/app/MarketMLService.kt`
- Root cause location:
  - `ensureEvaluationInputFiles()` previously threw `EVAL_NO_LEGKEYS` whenever snapshots existed but no candidate option-leg keys were present
  - this forced a valid no-candidate / all-rejected session into `RETRYABLE`
- Local fix:
  - introduced `EvaluationInputPreparation` return contract
  - prep now recognizes the case:
    - snapshots exist
    - leg-key count is `0`
  - instead of throwing, it:
    - writes the snapshots file
    - writes an empty chain file
    - writes prepare metadata with:
      - `snapshot_count`
      - `leg_key_count = 0`
      - `empty_reason = EVAL_NO_LEGKEYS...`
  - `runDayEvaluation()` now detects that empty-prep contract and completes cleanly without calling Python batch evaluation
- Intended runtime behavior after push:
  - no-candidate day should become:
    - `DONE`
    - zero produced outcomes
    - zero persisted outcomes
    - no fatal retry loop
    - clean message indicating no evaluable candidate legs were captured for the session
- Cache behavior also adjusted:
  - the prepare-cache path now accepts a cached zero-leg-key / empty-evaluation prep state
  - earlier logic required a non-empty chain file and would have invalidated this case
- Validation status:
  - source patch reviewed locally with diff/inspection
  - Android Gradle compile could not be run in this environment because `java` / `JAVA_HOME` is unavailable
- This fix is local only and not pushed yet.

## 2026-06-25 b294 validation result for no-candidate / all-rejected day

- Synced release pushed:
  - `Marketapp` `9128080`
  - `MarketVivi` `7675a5c`
  - shared version `v2.4.63 / b294`
- Phone validation on `b294` confirmed the runtime fix worked for the exact no-candidate-day failure mode.
- Verified UI state after retry / refresh:
  - `Day evaluation: DONE`
  - `Session: 25 Jun`
  - `Outcomes persisted: 0`
  - `Produced: 0`
  - `Progress: 80/80 snapshots`
  - message indicates:
    - no evaluable candidate legs were captured for the session
- Meaning:
  - the earlier `EVAL_NO_LEGKEYS` path is no longer fatal
  - no-candidate / all-rejected post-close sessions now complete cleanly
  - the previous bad state (`RETRYABLE` loop) is resolved
- Runtime baseline now considered fixed for:
  - post-close evaluation handoff
  - evaluation completion on empty-candidate days
  - zero-row persistence contract
- Remaining presentation / artifact issue:
  - `Class A Correctness Gate` still shows `FAIL`
  - `Daily Teacher Research` still shows not available
  - for a genuine zero-candidate day this should eventually become a clean `N/A` / empty-session semantic rather than a failure semantic
- Current interpretation:
  - core evaluation engine baseline is fixed
  - artifact/reporting semantics baseline still needs cleanup for empty sessions

## 2026-06-25 Stage 1 first measured evidence from local Class A harness walk

- Local-only Stage 1 work in `Marketapp-git/historical_replay_harness.py` is now operational against Supabase.
- This harness work is **not pushed yet** and remains intentionally local until the measurement direction is stable.
- Important local-only improvements made before the first successful walk:
  - per-day snapshot fetch instead of one broad date-range query
  - filtered same-day chain fetch using actual candidate leg keys
  - longer configurable HTTP timeout
  - explicit Class A vs Class B snapshot classification
  - thesis vs execution tracking
  - failure-mode classifier
  - session-level summary tables

### First measured Class A session set

- The first real measured Stage 1 walk was completed on these saved-menu sessions:
  - `2026-06-19`
  - `2026-06-22`
  - `2026-06-23`
  - `2026-06-24`
- Combined aggregate scope:
  - `238` Class A snapshots measured
  - `79` Class B snapshots inventoried separately but not used for this first Class A aggregate

### Dominant measured failure mode

- The strongest measured result so far is that failure is dominated by **ranking / wrong candidate choice**, not by a lack of viable setups and not mainly by gate blocking.
- Aggregate failure breakdown from the first four Class A sessions:
  - `RANK_WRONG`: `206 / 238` snapshots = `86.55%`
  - `NO_VIABLE`: `28 / 238` snapshots = `11.76%`
  - `GATE_BLOCKED`: `4 / 238` snapshots = `1.68%`
- Current interpretation:
  - the market is **not** mainly failing us by having no setups
  - the gate is **not** mainly blocking good setups
  - the strongest current evidence says the brain is usually selecting the wrong candidate among available evaluated choices

### Per-session Stage 1 findings

- `2026-06-19`
  - snapshots: `67`
  - labelable: `39`
  - chosen avg R: `-0.1343`
  - best available avg R: `0.1129`
  - best execution-family avg R: `-0.0247`
  - better-candidate count: `67`
  - ranking misses: `56`
  - thesis-family misses: `0`
- `2026-06-22`
  - snapshots: `74`
  - labelable: `66`
  - chosen avg R: `-1.2764`
  - best available avg R: `0.2405`
  - best execution-family avg R: `-0.2009`
  - better-candidate count: `71`
  - ranking misses: `67`
  - thesis-family misses: `41`
- `2026-06-23`
  - snapshots: `53`
  - labelable: `33`
  - chosen avg R: `-0.2779`
  - best available avg R: `0.0951`
  - best execution-family avg R: `-0.1447`
  - better-candidate count: `51`
  - ranking misses: `36`
  - thesis-family misses: `4`
- `2026-06-24`
  - snapshots: `44`
  - labelable: `36`
  - chosen avg R: `-1.0795`
  - best available avg R: `-0.1651`
  - best execution-family avg R: `-0.8993`
  - better-candidate count: `44`
  - ranking misses: `39`
  - thesis-family misses: `2`

### Rejection-reason evidence from the same first aggregate

- Rejected reason `sigma_otm < 0.5` is not cleanly safe to keep as-is:
  - positive-R counterfactual rate observed: `55.92%`
  - but average R if taken is still slightly negative: `-0.0852`
- Rejected reason `sigma_otm > max_sigma` remains clearly bad on average:
  - average R if taken: `-0.8556`
- Current interpretation:
  - some rejection rules may be over-constraining useful candidates
  - but the dominant measured problem is still ranking, not gate policy overall

### Current Stage 1 conclusion

- This is still only a recent Class A sample and is **not** enough to finalize strategy weights.
- But it is now measured evidence, not speculation.
- The most important directional conclusion is:
  - the next high-value architecture target is likely **ranking / candidate selection**, not broad gate loosening
- Immediate next use of this evidence:
  - inform Claude with the measured results
  - decide whether Stage `2` should begin with ranking-first teacher injection rather than gate-first changes

## 2026-06-25 Claude audit of RANK_WRONG finding and corrected classifier rerun

- Claude challenged the first `86.55% RANK_WRONG` finding and requested direct classifier-code verification.
- The challenge was valid.
- Local code review found three real issues in the first classifier:
  - `best_available` was selected by realized honest `r_multiple`, which is hindsight-only
  - `RANK_WRONG` had no meaningful margin, so tiny realized-R differences counted as failures
  - `EXIT_DESTROYED` was checked after better-candidate comparison, so some exit failures could be absorbed into the ranking bin

### Local classifier correction

- Local-only patch applied to `Marketapp-git/historical_replay_harness.py`.
- New harness constants:
  - `HARNESS_STAGE1_R_MARGIN`, default `0.10R`
  - `HARNESS_STAGE1_POSITIVE_R_FLOOR`, default `0.10R`
  - `HARNESS_STAGE1_EXIT_LOSS_FLOOR`, default `-0.10R`
- Corrected classifier behavior:
  - exit-policy failure is checked before hindsight-best comparison
  - tiny realized-R gaps below `0.10R` no longer count as meaningful failure
  - pure hindsight ranking result is renamed to `RANK_WRONG_HINDSIGHT`
  - the output no longer pretends that hindsight winner selection is entry-time proof
- Old SQLite DB was preserved as:
  - `Marketapp-git/historical_outcomes.pre_classifier_audit_20260625.sqlite`
- Corrected walk was rebuilt cleanly into:
  - `Marketapp-git/historical_outcomes.sqlite`

### Corrected aggregate after rerunning same four Class A sessions

- Same sessions rerun:
  - `2026-06-19`
  - `2026-06-22`
  - `2026-06-23`
  - `2026-06-24`
- Same total Class A snapshot count:
  - `238`
- Corrected failure breakdown:
  - `RANK_WRONG_HINDSIGHT`: `124 / 238` = `52.10%`
  - `NO_VIABLE`: `111 / 238` = `46.64%`
  - `GATE_BLOCKED`: `3 / 238` = `1.26%`
  - `EXIT_DESTROYED`: `0 / 238` with the current strict `premium_edge > 0` criterion

### Corrected interpretation

- The previous `86.55% RANK_WRONG` number should be retired.
- It was materially inflated by hindsight-best selection and missing margin.
- Ranking / candidate selection is still a serious issue:
  - `52.10%` of snapshots still had a better generated candidate by at least `0.10R` in hindsight
- But the corrected evidence is no longer enough to say ranking alone dominates all failure:
  - `NO_VIABLE` is now nearly as large at `46.64%`
- Gate blocking remains small in this sample:
  - `1.26%`
- Stage 2 should therefore **not** jump directly to ranking-only injection.
- Better next direction:
  - continue Stage 1 measurement
  - separate hindsight-best analysis from entry-actionable ranking evidence
  - improve exit-policy classification because `premium_edge` is currently too weak/sparse to identify `EXIT_DESTROYED` reliably
  - treat broad gate loosening as unsupported by current evidence

### Corrected per-session failure modes

- `2026-06-19`
  - `RANK_WRONG_HINDSIGHT`: `36`
  - `NO_VIABLE`: `31`
- `2026-06-22`
  - `RANK_WRONG_HINDSIGHT`: `58`
  - `NO_VIABLE`: `16`
- `2026-06-23`
  - `NO_VIABLE`: `45`
  - `RANK_WRONG_HINDSIGHT`: `5`
  - `GATE_BLOCKED`: `3`
- `2026-06-24`
  - `RANK_WRONG_HINDSIGHT`: `25`
  - `NO_VIABLE`: `19`

### Corrected Stage 1 conclusion

- Claude's audit improved the quality of the evidence.
- Current state:
  - ranking is still a major problem
  - no-viable-market/session state is also major
  - gate blocking is not the main problem in this sample
  - exit-policy failure is still under-instrumented
- Before Stage 2 live ranking changes, we need one more Stage 1 batch:
  - entry-actionable score reconstruction from saved candidate fields
  - cleaner exit-destroyed detection
  - wider Class A run if data allows

## 2026-06-25 Stage 1 entry-actionable ranking and exit marker batch

- Claude's verdict on the corrected classifier was accepted.
- Local-only harness was extended again in `Marketapp-git/historical_replay_harness.py`.
- New aggregate-stage logic:
  - builds `stage1_candidate_prior_scores`
  - computes prior-session bucket expectancy for every Class A primary/generated candidate
  - uses only sessions **before** the candidate's own session date
  - requires a minimum prior bucket count through `HARNESS_STAGE1_MIN_PRIOR_BUCKET_N`, default `5`
  - creates `stage1_entry_actionable_metrics`
  - creates `stage1_corrected_failure_modes`
  - creates corrected failure breakdown tables
- This implements Claude's contamination guard:
  - day D is not allowed to use day D's own realized outcomes to score day D candidates
- After inspecting the first `RANK_WRONG_ENTRY_ACTIONABLE` rows, the condition was tightened further:
  - an alternative must not only beat chosen by prior bucket score and realized R
  - it must also realize at least `+0.10R`
  - this prevents loss-reduction-only rows from being mislabeled as profitable/fixable ranking wins

### New corrected failure split after entry-actionable logic

- Same four Class A sessions:
  - `2026-06-19`
  - `2026-06-22`
  - `2026-06-23`
  - `2026-06-24`
- Same total snapshots:
  - `238`
- Corrected failure split:
  - `NO_VIABLE`: `110 / 238` = `46.22%`
  - `RANK_WRONG_HINDSIGHT`: `99 / 238` = `41.60%`
  - `EXIT_DESTROYED`: `26 / 238` = `10.92%`
  - `GATE_BLOCKED`: `3 / 238` = `1.26%`
  - `RANK_WRONG_ENTRY_ACTIONABLE`: `0 / 238` = `0.00%` under the stricter profitable-alternative definition

### Interpretation after entry-actionable batch

- The fixable ranking bin is much smaller than the hindsight ceiling:
  - hindsight ceiling: `41.60%`
  - profitable entry-actionable ranking miss: `0.00%`
- This means the current four-day sample does not prove that prior-bucket ranking would have created profitable alternatives.
- Some rejected intermediate rows showed loss reduction, but not profitable alternatives, so they were kept in `NO_VIABLE`.
- `EXIT_DESTROYED` is now non-zero:
  - `26` snapshots
  - all currently appear on `2026-06-24`
  - this is the first evidence that exit policy may be a real contributor, not merely ranking
- Current strongest practical conclusion:
  - do **not** move to ranking-only Stage 2
  - next direction is mixed:
    - continue measuring prior-bucket entry-actionable ranking
    - inspect `2026-06-24` exit-destroyed rows
    - improve exit-policy analysis before changing live ranking

### Caveats

- The prior bucket table is still tiny:
  - only four Class A sessions
  - first sessions naturally have little or no prior data
  - `RANK_WRONG_ENTRY_ACTIONABLE` may be undercounted until more sessions exist
- The `EXIT_DESTROYED` definition now uses positive prior bucket expectancy, which is better than sparse `premium_edge`, but still depends on small prior data.
- Current outputs are suitable for architecture direction, not final strategy weights.

## 2026-06-25 wider saved-menu Class A walk after Claude starvation verdict

- Claude reviewed the `RANK_WRONG_ENTRY_ACTIONABLE = 0` result and correctly identified it as prior-bucket starvation, not a real finding.
- Supabase saved-menu coverage was then sized locally through paged REST reads.
- Coverage found:
  - `1650` total `ml_brain_snapshots` rows
  - `23` dates
  - about `20` dates with some saved menu / primary candidate coverage
- Notable saved-menu dates:
  - `2026-05-29`: `61` snapshots, `59` menu rows, `44` labelable
  - `2026-06-01`: `61`, `56`, `39`
  - `2026-06-02`: `71`, `66`, `40`
  - `2026-06-03`: `87`, `85`, `56`
  - `2026-06-04`: `77`, `69`, `46`
  - `2026-06-05`: `73`, `63`, `52`
  - `2026-06-08`: `72`, `69`, `50`
  - `2026-06-15`: `82`, `80`, `57`
  - plus smaller saved-menu days from `2026-06-09` through `2026-06-18`
  - recent days `2026-06-19`, `2026-06-22`, `2026-06-23`, `2026-06-24`
- `2026-06-16` and `2026-06-25` had no saved menu rows and are not useful for Class A measurement.

### Wider walk execution

- Local harness was rerun cleanly across:
  - `2026-05-25` through `2026-06-24`
  - `--walk-mode class_a`
- Previous DBs were preserved locally:
  - `historical_outcomes.pre_classifier_audit_20260625.sqlite`
  - `historical_outcomes.4day_entry_actionable_20260625.sqlite`
- Current wider DB:
  - `Marketapp-git/historical_outcomes.sqlite`
- Wider aggregate scope:
  - `18` Class A sessions
  - `847` Class A snapshots
  - `723` Class B snapshots inventoried separately
  - `14240` outcome rows
  - `9544` walk error rows, mostly candidate/path evaluation misses from older/sparse snapshots

### Prior-bucket coverage after widening

- `stage1_candidate_prior_scores`:
  - total candidate rows: `11989`
  - rows with usable prior bucket score: `8909`
- `stage1_entry_actionable_metrics`:
  - snapshots: `847`
  - chosen rows with usable prior score: `522`
- This means the starvation problem is no longer total.
- The wider run is now the first usable Stage 1 measurement pass, though still not a final production strategy-weight table.

### Wider corrected failure split

- Corrected failure split after widening:
  - `NO_VIABLE`: `410 / 847` = `48.41%`
  - `RANK_WRONG_ENTRY_ACTIONABLE`: `234 / 847` = `27.63%`
  - `RANK_WRONG_HINDSIGHT`: `164 / 847` = `19.36%`
  - `EXIT_DESTROYED`: `36 / 847` = `4.25%`
  - `GATE_BLOCKED`: `3 / 847` = `0.35%`

### Wider-run interpretation

- The `RANK_WRONG_ENTRY_ACTIONABLE` bin is no longer zero.
- With enough saved-menu history, prior teacher bucket expectancy identifies a meaningful set of fixable ranking misses:
  - `234` snapshots
  - `27.63%` of measured Class A snapshots
- `NO_VIABLE` remains the largest bin:
  - `48.41%`
  - meaning many snapshots still had no candidate clearing the current profitable/meaningful threshold
- `RANK_WRONG_HINDSIGHT` remains a ceiling / irreducible-or-not-yet-knowable bucket:
  - `19.36%`
- `EXIT_DESTROYED` is now smaller and no longer only a single-day artifact:
  - `4.25%`
- `GATE_BLOCKED` remains negligible:
  - `0.35%`
- Current architecture implication:
  - broad gate loosening is not supported
  - ranking repair is now supported as a real Stage 2 candidate, but alongside `WAIT` discipline because `NO_VIABLE` remains the largest bin
  - exit-policy repair is secondary in the wider run, not primary

### Current decision state

- The Stage 1 instrument has now produced a non-starved first measurement.
- Suggested next consultation point for Claude:
  - confirm whether this wider split is sufficient to start Stage `2A` ranking repair design
  - preserve `NO_VIABLE` as a hard `WAIT` discipline
  - avoid gate loosening
  - keep exit-policy review as secondary

### Prior-floor sensitivity check

- User raised a valid question:
  - should we also check lower prior-count floors so we do not later wonder whether `n>=5` hid important evidence?
- Sensitivity check was run locally.
- Preserved DB copies:
  - `Marketapp-git/historical_outcomes.wide_n5_20260625.sqlite`
  - `Marketapp-git/historical_outcomes.wide_n3_20260625.sqlite`
  - `Marketapp-git/historical_outcomes.wide_n1_20260625.sqlite`
- Result:
  - lowering from `n>=5` to `n>=3` or `n>=1` did **not** change the corrected failure split on the wider dataset
- Corrected split remained:
  - `NO_VIABLE`: `410 / 847` = `48.41%`
  - `RANK_WRONG_ENTRY_ACTIONABLE`: `234 / 847` = `27.63%`
  - `RANK_WRONG_HINDSIGHT`: `164 / 847` = `19.36%`
  - `EXIT_DESTROYED`: `36 / 847` = `4.25%`
  - `GATE_BLOCKED`: `3 / 847` = `0.35%`
- Coverage context:
  - candidate rows with prior score at `n>=5`: `8909 / 11989`
  - candidate rows with prior score at `n>=3`: `8926 / 11989`
  - candidate rows with prior score at `n>=1`: `8992 / 11989`
- Interpretation:
  - after widening to 18 Class A sessions, prior-score coverage is already high
  - lowering the floor adds only a small number of candidate rows
  - the main architecture conclusion is stable across these thresholds
  - official evidence should still use `n>=5`, while `n>=3` / `n>=1` remain sensitivity checks only

## 2026-06-25 Claude Stage 2A verdict and verification

- Claude reviewed the wider 18-session Class A result and approved the Stage `2A` direction with caveats.
- Approved direction:
  - inject teacher prior-bucket expectancy into live ranking
  - preserve hard `WAIT` when candidates are negative or have insufficient prior expectancy
  - do not broadly loosen gates
  - keep exit-policy review as secondary Stage `2B`
  - keep measuring bucket coverage and outcomes daily
- Claude requested two confirmations before treating the result as stable:
  1. confirm that `n>=5`, `n>=3`, and `n>=1` sensitivity splits were truly recomputed
  2. quantify regime/VIX breadth of the wider walk

### Sensitivity recomputation confirmation

- Confirmed through separate DB files:
  - `historical_outcomes.wide_n5_20260625.sqlite`
  - `historical_outcomes.wide_n3_20260625.sqlite`
  - `historical_outcomes.wide_n1_20260625.sqlite`
- All three DBs have the same corrected failure counts:
  - `NO_VIABLE`: `410`
  - `RANK_WRONG_ENTRY_ACTIONABLE`: `234`
  - `RANK_WRONG_HINDSIGHT`: `164`
  - `EXIT_DESTROYED`: `36`
  - `GATE_BLOCKED`: `3`
- Chosen prior-score coverage check:
  - total snapshots: `847`
  - chosen rows with prior score: `536`
  - chosen rows with `n>=5`: `522`
  - chosen rows with `n>=3`: `527`
  - chosen rows with `n>=1`: `536`
- Interpretation:
  - the identical split is plausible and now verified
  - lowering the floor changes only a small number of chosen rows and does not flip failure assignments

### Regime/VIX breadth check

- Wider walk is broader than the original four sessions but still not a high-VIX/event-regime sample.
- VIX bucket coverage from walked Class A outcomes:
  - `VIX_16_18`: `8` sessions, `5508` outcome rows
  - `VIX_12_14`: `7` sessions, `5130` outcome rows
  - `VIX_14_16`: `12` sessions, `3602` outcome rows
- Regime bucket coverage:
  - `VIX_NORMAL`: `8` sessions, `5450` rows
  - `VIX_VERY_LOW`: `7` sessions, `5130` rows
  - `VIX_LOW`: `12` sessions, `3660` rows
- Interpretation:
  - evidence is not restricted to a single VIX bucket
  - however, it remains low-to-normal VIX only
  - Stage `2A` must abstain or use neutral scoring for unseen/high-VIX buckets
  - runtime must log teacher bucket coverage so new regimes can be measured as they arrive

### Stage 2A implementation boundary

- The next product-code batch should not be a blind ranking rewrite.
- It should implement a guarded teacher score:
  - load prior `strategy_weights` / local equivalent at session start or refresh
  - attach `teacher_r_score`, `teacher_bucket_n`, and coverage state to each candidate
  - rank with teacher score only when bucket coverage is adequate
  - force/allow `WAIT` when every candidate has negative or insufficient teacher expectancy
  - log score, bucket, and coverage into snapshots for continued OODA measurement
- Gate loosening is explicitly not supported by current evidence.

## 2026-06-25 older / high-VIX data check

- User asked whether the app's older runtime data, including the US/Iran conflict timeline, can be checked for higher-VIX behaviour before finalizing Stage `2A`.
- Result:
  - older/high-VIX data exists, but it is **not** the same evidence tier as current Class `A` saved-menu snapshots.

### Evidence tiers confirmed

- Current Class `A` saved snapshot coverage:
  - `ml_brain_snapshots`: starts around `2026-05-25`, runs through `2026-06-25`
  - `ml_option_chain_snapshots`: starts around `2026-05-25`, runs through `2026-06-25`
  - therefore current saved-menu teacher evidence is recent only
- Historical Class `B` reconstruction coverage:
  - `historical_option_candles` exists
  - earliest observed `bar_ts`: `2024-09-26T03:45:00+00:00`
  - latest observed `bar_ts`: `2026-06-16T09:55:00+00:00`
  - row count tracked earlier: about `874,325`
  - `open_interest` column exists
  - this can support future reconstructed historical replay, but only after Class `B` parity is proven
- Local training/backtest asset:
  - `Marketapp-git/app/src/main/assets/backtest_trades.csv`
  - `8372` rows
  - date range: `2024-01-01` to `2026-03-27`
  - VIX range: `10.195` to `24.6025`

### Backtest high-VIX distribution

- Unique-date VIX buckets from `backtest_trades.csv`:
  - `VIX_LT_12`: `11`
  - `VIX_12_14`: `82`
  - `VIX_14_16`: `86`
  - `VIX_16_18`: `14`
  - `VIX_18_20`: `4`
  - `VIX_20_24`: `258`
  - `VIX_24_PLUS`: `4`
- Caveat:
  - `4802` CSV rows have exactly `VIX = 20.0`
  - this looks like a placeholder / coarse default in part of the historical training asset
  - so it is useful for hypothesis generation, but not strong enough as final live-ranking evidence

### Decision boundary from the check

- Current Stage `2A` evidence remains Class `A`, low-to-normal VIX only:
  - `VIX_12_14`
  - `VIX_14_16`
  - `VIX_16_18`
- Stage `2A` must therefore:
  - use guarded teacher ranking only where bucket coverage is adequate
  - abstain / neutral-score unseen high-VIX buckets
  - preserve hard `WAIT`
  - avoid gate loosening
- Older/high-VIX work becomes a separate Class `B` replay/parity track:
  - reconstruct candidate menus from `historical_option_candles`
  - first prove parity on known Class `A` days
  - then walk event/high-VIX periods
  - only then allow high-VIX bucket weights to influence live ranking

- Claude handoff created:
  - `RESPONSE_CLAUDE_HIGH_VIX_DATA_CHECK_20260625.md`

## 2026-06-26 guarded Stage 2A implementation checkpoint

- Implemented the approved guarded Stage `2A` product-code batch locally.
- No push has been done yet.
- Scope remains Class `A` only:
  - current teacher ranking table is derived from recent saved-menu Class `A` evidence
  - high-VIX / older data remains separate Class `B` replay/parity research
  - live high-VIX buckets must abstain until Class `B` parity is proven

### Marketapp implementation

- Added packaged Stage `2A` teacher table:
  - `Marketapp-git/app/src/main/assets/teacher_table_stage2a.json`
  - generated from local `historical_outcomes.sqlite::strategy_weights_local`
  - row count: `46`
  - minimum prior bucket floor: `5`
- Android now copies `teacher_table_stage2a.json` from assets into app files on update.
- Runtime context passed into Python now includes:
  - `stage2a_mode`
  - `stage2a_min_prior_bucket_n`
  - `stage2a_teacher_table_path`
- Added native bridge controls:
  - `getStage2AGuardMode()`
  - `setStage2AGuardMode(mode)`
  - valid modes: `off`, `shadow`, `live`
  - default mode: `shadow`

### Python brain changes

- Added Stage `2A` teacher-table load/cache and candidate annotation.
- Every generated candidate can now receive:
  - `teacher_bucket_key`
  - `teacher_bucket_n`
  - `teacher_r_score`
  - `teacher_success_rate_pct`
  - `teacher_coverage`
  - `teacher_recommendable`
  - `deterministic_rank`
  - `teacher_shadow_rank`
  - `stage2a_live_rank`
- Coverage states distinguish:
  - covered positive bucket
  - covered negative bucket
  - thin bucket
  - unseen bucket
  - table unavailable
- `rank_candidates(...)` can optionally use teacher expectancy ranking.
- `shadow` mode:
  - computes teacher ranking
  - stamps shadow rank
  - logs top-candidate comparison
  - does not drive live decision
- `live` mode:
  - allows teacher expectancy ranking to drive ordering
  - preserves hard `WAIT`
  - forces `WAIT` if no candidate has positive covered teacher expectancy
  - uses `TEACHER_ONLY` decision source for the guarded teacher path
- Gate thresholds were not loosened.
- Confidence semantics were not changed.

### Snapshot and notification contract logging

- Saved snapshot context now includes `snapshot_stage2a`.
- Primary candidate and candidate views now preserve Stage `2A` rank/coverage metadata.
- Brain notification contract now includes:
  - `teacher_r_score`
  - `teacher_bucket_n`
  - `teacher_coverage`
- This is required so post-close review can compare deterministic ranking versus teacher shadow ranking.

### Daily teacher research artifact changes

- `session_teacher_research_report(...)` now aggregates Stage `2A` shadow evidence from saved snapshots:
  - snapshot count
  - mode counts
  - table-ready count
  - shadow compared count
  - shadow top-changed count and rate
  - live compared count
  - live top-changed count and rate
  - hard-WAIT count
  - covered / positive / thin / unseen snapshot counts
  - chosen candidate coverage mix
  - average chosen teacher bucket size
  - average chosen teacher R
- Added report-level audit status:
  - `READY_FOR_MANUAL_REVIEW`
  - `COLLECT_MORE_SHADOW`
  - `NO_EVIDENCE`
- Added explicit Stage `2A` `blocked_reasons` so the app can explain why the shadow audit is not review-ready.
- Genuine zero-candidate / no-evaluable-leg sessions now report Class `A` gate status as `N/A` instead of false `FAIL`.

### PWA implementation

- Added Stage `2A` mode control in ML controls:
  - `Off`
  - `Shadow`
  - `Live`
- Added live Stage `2A` runtime display:
  - table ready / unavailable
  - coverage counts
  - deterministic top versus shadow top when changed
  - hard-WAIT reason when triggered
- Added dedicated `Stage 2A Shadow Audit` card from the daily teacher research artifact:
  - audit status
  - blockers
  - table readiness
  - shadow top-change rate
  - coverage counts
  - hard-WAIT count
  - chosen coverage
  - average teacher bucket size and R
  - modes observed
- `Daily Teacher Research` also shows the summarized Stage `2A` shadow comparison.
- Class `A Correctness Gate` now treats genuine empty sessions as `N/A`.

### Tests and verification

- Added focused tests:
  - `Marketapp-git/app/src/main/python/tests/test_stage2a_guarded_ranking.py`
- Tests cover:
  - unseen high-VIX bucket abstains
  - live guard forces `WAIT` when all teacher buckets are non-positive
  - live ranking prefers a positive covered teacher bucket
  - teacher research report aggregates Stage `2A` shadow evidence
  - zero-evidence / no-candidate session reports `NO_EVIDENCE` and Class `A` `N/A`
- Verification run:
  - `python3 -m unittest app/src/main/python/tests/test_stage2a_guarded_ranking.py` -> `OK`
  - `python3 -m unittest app/src/main/python/tests/test_unified_brain_notification.py` -> `OK`
  - `python3 -m py_compile app/src/main/python/brain.py app/src/main/python/tests/test_stage2a_guarded_ranking.py` -> `OK`
  - `node --check app.js` -> `OK`

### Current boundary and next decision

- Stage `2A` is implemented locally but not pushed.
- The app should remain in `shadow` until the post-close artifact shows enough evidence for manual review.
- `live` mode exists as a guarded switch, but should not be treated as approved for real decision use until shadow evidence is reviewed.
- Next clean work options:
  1. push both repos with synchronized version bump and signed Android release when user confirms
  2. start separate Class `B` parity harness work
  3. continue rejected-candidate / failure-mode evidence preservation

## 2026-06-26 release prep for guarded Stage 2A checkpoint

- User chose to push the completed guarded Stage `2A` checkpoint before starting Class `B` parity work.
- Release target prepared:
  - Android / brain / PWA version: `v2.4.67`
  - build code: `b298`
- Version surfaces updated:
  - `Marketapp-git/app/build.gradle.kts`
  - `Marketapp-git/app/src/main/python/brain.py`
  - `MarketVivi-git/index.html`
- PWA cache-bust advanced:
  - `app.js?v=1223`
- Signed Android release should trigger after `Marketapp` push because `app/build.gradle.kts` changed.
- Local SQLite research artifacts remain uncommitted and should not be pushed:
  - `historical_outcomes.sqlite`
  - `historical_outcomes.pre_classifier_audit_20260625.sqlite`
  - `historical_outcomes.4day_entry_actionable_20260625.sqlite`
  - `historical_outcomes.wide_n1_20260625.sqlite`
  - `historical_outcomes.wide_n3_20260625.sqlite`
  - `historical_outcomes.wide_n5_20260625.sqlite`

### 2026-06-26 b298 CI failure and b299 retry

- Initial push completed:
  - `Marketapp`: `ebce89d`
  - `MarketVivi`: `d57d0e6`
- GitHub Debug APK Validation failed before APK build in the Python brain-mode validation step.
- Failure:
  - `brain.analyze()` returned `candidate_error = "Object of type set is not JSON serializable"`
  - generated candidates were `0`, causing the CI assertion to fail
- Root cause:
  - new Stage `2A` annotation used `json.dumps(ctx)` to resolve VIX
  - existing brain context may contain Python `set` values such as learned branch allow/block sets
  - serializing the full context was unsafe
- Fix:
  - Stage `2A` now reads VIX directly from known context keys instead of serializing the full context
- Retry release target:
  - Android / brain / PWA version: `v2.4.68`
  - build code: `b299`
  - PWA cache-bust: `app.js?v=1224`

## 2026-06-28 Class B historical replay / candle reingest status

- Class `B` objective is now defined as a structural historical validator, not an economic teacher:
  - expected to validate ATM, strike universe, walls, PCR, max pain, OI-derived structure, sigma gates, and candidate-family enumeration
  - not expected to reproduce exact bid/ask-derived credit, credit/width, R, or P&L from candle close data
  - every Class `B` economic number must remain labeled approximate because historical candles do not contain live bid/ask
- Supabase had transient `521` / timeout behavior during Class `B` probing after a Disk IO budget warning.
  - heavy Class `B` reads were paused
  - tiny health checks later recovered enough to continue bounded extraction
  - future historical pulls must stay bounded/checkpointed and newest-first

### Reingest and data coverage

- Created standalone local script:
  - `Marketapp-git/reingest_historical_candles.py`
- Script behavior:
  - uses Upstox option contract catalog
  - newest-first expiry order
  - phase-gated runs: `A`, `B`, `C`, `full`
  - checkpointed SQLite state in `reingest_checkpoint.db`
  - rate-limited Upstox fetches
  - small Supabase insert batches
  - dry-run / audit support
- Dry-run proof:
  - `BNF 2026-05-26`: about `44k` reachable candle rows
  - `NF 2026-05-26`: about `45k` reachable candle rows
  - filter audit confirmed `102` contracts = `51` strikes x `2` option types
- Phase `A` reingest completed through the `2026-05-01` boundary.
- A stale local checkpoint falsely marked `NF 2026-06-16` as done with zero rows.
  - cleared only that stale checkpoint state
  - re-ran `NF 2026-06-16`
  - inserted `43,278` rows
  - Supabase coverage for `2026-06-15` / `NF 2026-06-16` became:
    - rows: `7,710`
    - strike min: `22600`
    - strike max: `25150`
    - distinct strikes: `52`
- `BNF` is still blocked for the tested Class `B` day because local extracted BNF candle rows are absent.

### Class B parity harness changes

- `Marketapp-git/historical_replay_harness.py` now has Class `B` local extract/replay tooling:
  - local `parity_data/` artifacts
  - structural-only bid/ask approximation from candle close
  - menu divergence diagnostics
  - BNF absence classified as `BLOCKED`, not replay failure
  - skipped-expiry and data-coverage checks
- ATM anchor was tested after the skipped-expiry fix and is already correct on snapshot `937`:
  - saved `nfSpot`: `23964.15`
  - reconstructed `nfSpot`: `23964.15`
  - saved `nfChain.atm`: `23950`
  - reconstructed `nfChain.atm`: `23950`
- Menu divergence before bar fix:
  - snapshot: `2026-06-15T03:46:55+00:00`, id `937`
  - saved generated: `27`
  - replay generated: `23`
  - actual set delta was not merely four missing:
    - missing from replay: `10`
    - replay-only: `6`
  - five missing candidates were rejected by replay as `credit_ratio_below_floor`
  - five missing candidates were not in replay-generated or replay-rejected
- Claude then identified the bar-alignment issue:
  - Class `B` reconstruction was effectively using late-session / last candle prices for some strike rows
  - root local cause: Class `B` used `_outcome_poll_ts`, which can prefer `snapshot_latest_poll.t` values such as `09:16` instead of the database ISO `poll_ts`
- Bar-alignment fix implemented:
  - Class `B` reconstruction now anchors on snapshot row `poll_ts`
  - floors to the correct 5-minute bar
  - selects exact `bar_ts`
  - falls back only to the latest bar at or before poll time
  - never uses future bars
- Verification on snapshot `937`:
  - `NF 24100 CE`
  - poll: `2026-06-15T03:46:55+00:00`
  - target bar: `2026-06-15T03:45:00+00:00`
  - selected bar: `2026-06-15T03:45:00+00:00`
  - close: `39.6`
  - approximated bid/ask: `39.01 / 40.19`
- After bar fix:
  - saved generated: `27`
  - replay generated: `25`
  - missing from replay: `7`
  - replay-only: `5`
  - rejected sample still matched
  - remaining explicit economic reject:
    - `BEAR_CALL_NF_24100_24500_W400`
    - saved credit/width: `0.1031`
    - replay candle-close approximate credit/width: `0.0876`

### Current Class B boundary

- Bar-alignment bug is fixed locally.
- Class `B` parity is improved but not exact.
- Final feasibility decision on `2026-06-28`: exact Class `B` candidate-menu parity cannot be achieved from the current Upstox `historical_option_candles` dataset alone.
- Controlled proof:
  - saved live chain at `2026-06-15`, snapshot `959` generated `23` current-brain NF candidates
  - reconstructed Upstox candle chain generated `25`
  - forcing reconstructed `atmIv` from saved chain removed false Iron Butterfly passes but did not restore exact parity
  - degrading the saved live chain to synthetic candle-style bid/ask changed the menu even without reconstruction
- Root data boundary:
  - brain candidate generation uses live bid, ask, and `atmIv`
  - Upstox historical candle rows provide OHLC, volume, OI, and instrument key
  - historical bid/ask and IV are absent, so exact economic gates cannot be replayed
- Contract change:
  - old Upstox data can support structural / simulated Class `B` research only
  - it must not be used for exact live menu parity, exact teacher R calibration, or exact expectancy claims
  - future exact Class `B` replay requires persisting full live quote snapshots with bid/ask/IV at poll time
- Class `B` should not be used for real expectancy / teacher R calibration.
- Class `A` saved live bid/ask remains the source of truth for teacher training and economic scoring.
- Existing Class `B` artifacts for Claude:
  - `CLASS_B_MENU_DIVERGENCE_FOR_CLAUDE_20260628.md`
  - `CLASS_B_BAR_ALIGNMENT_AND_CEILING_FOR_CLAUDE_20260628.md`
  - `CLASS_B_RANGE_DETECTED_ROOTCAUSE_FOR_CLAUDE_20260628.md`
  - `CLASS_B_FINAL_FEASIBILITY_DECISION_20260628.md`

### 2026-06-28 Supabase live-data replay audit

- User asked whether the app's own live-collected Supabase data can be used instead of Upstox historical candles for parity / replay.
- Direct Supabase audit found:
  - `ml_brain_snapshots`: `1650` rows
    - first: `2026-05-25T07:44:31+00:00`
    - last: `2026-06-25T10:00:08+00:00`
  - `ml_option_chain_snapshots`: about `340k` rows
    - first: `2026-05-25T07:57:04+00:00`
    - last: `2026-06-25T10:00:07+00:00`
    - columns include real `ltp`, `bid`, `ask`
  - `chain_snapshots`: `56` rows
    - date span: `2026-03-20` to `2026-04-28`
    - summary-level only; no full per-strike bid/ask/IV chain dictionaries
- Replayability conclusion:
  - strong usable exact-replay window: `2026-06-01` through `2026-06-25`
  - partial usable day: `2026-05-29` from later chain-rich rows
  - weak / not exact replayable: `2026-05-25` through `2026-05-27` sampled rows had no full chain in `context_json`
  - older March/April `chain_snapshots` are summary-only and not enough for exact brain candidate replay
- Important distinction:
  - app-collected `ml_brain_snapshots.context_json` can replay the current brain on saved live market state because it preserves full `nfChain` / `bnfChain` with bid/ask/IV/greeks/OI/instrument keys
  - it does not guarantee old-code parity because the historical APK brain version may differ from current `brain.py`
- Recommended direction:
  - abandon Upstox candle data for exact parity
  - use saved app live snapshots for exact replay / current-brain counterfactuals in the usable window
  - keep Class `A` as economic truth source
  - ensure future snapshots persist full generated candidates and full rejected candidates (`snapshot_rejected_candidates_full`) so daily parity accumulates correctly
- Audit artifact:
  - `Marketapp-git/SUPABASE_LIVE_DATA_REPLAY_AUDIT_20260628.md`
- Local verification completed:
  - `python3 -m py_compile historical_replay_harness.py` -> OK
  - `git diff --check` -> OK
  - `python3 -m unittest app.src.main.python.tests.test_stage2a_guarded_ranking` -> OK
- No push has been done for these Class `B` local changes.

## 2026-07-08 Week-1 BUILD 3 verdict window / exit auditability ruling

### Current frozen production state

- Active app build:
  - `v2.5.0 / b331`
- Active Week-1 A/B verdict window:
  - Day 2: `2026-07-08`
  - Day 3: `2026-07-09`
  - Day 4: `2026-07-10`
  - Day 5: `2026-07-13`
  - Day 6: `2026-07-14`
- Freeze remains active through the verdict window:
  - no app code change
  - no build push
  - no threshold change
  - no EV-floor change
  - no calm-predicate change
  - no ML model or retrain change
  - no production Edge Function / LLM wiring change that can affect live app behavior
- Continue only the daily evidence loop unless a kill switch fires.

### Expected A/B row formula

- Kotlin persists an `ab_week1_decisions` row whenever `brain.analyze()` returns `result.build3_ab`.
- Python `brain.analyze()` returns before `build3_ab` exists while `len(polls) < 3`.
- Once poll count reaches `3`, `build3_ab` is emitted for both candidate-present and no-candidate paths.
- Therefore:

```text
expected_ab_rows = max(max(poll_number) - 2, 0)
```

- K3 fires only when actual distinct A/B poll numbers are lower than this expected count after poll `3`.

### Day-2 A/B integrity result

- Day-2 session date: `2026-07-08`
- A/B row integrity:
  - `n_ab_rows`: `74`
  - `distinct_poll_timestamps`: `74`
  - `distinct_poll_numbers`: `74`
  - `expected_ab_rows`: `74`
  - `rows_minus_expected`: `0`
  - first poll timestamp: `2026-07-08T09:25:00+0530`
  - last poll timestamp: `2026-07-08T15:30:00+0530`
  - first poll number: `3`
  - max poll number: `76`
- Day-2 K3 verdict:
  - clean.
- Day-2 A/B telemetry:
  - `n_differ`: `51`
  - `old_would_have_taken_count`: `74`
  - `old_pick_count`: `74`
  - `new_pick_count`: `23`
  - `k1_suspect_rows`: `0`
  - gate distribution: `{"NONE":23,"ALL_NEGATIVE_EV":51}`
  - new lanes: `{"NONE":51,"NF_intraday":1,"BNF_intraday":22}`
  - old lanes: `{"NF_intraday":1,"BNF_intraday":73}`
  - threshold payloads stayed stable: `[{"iv_high":20,"ev_floor_mult":1.1,"calm_range_sigma_max":0.3}]`

### Day-2 exit-parity investigation

- Two actual paper trades were recovered from `trades_v2`:

1. W1000 BNF Bear Put
   - trade id: `166`
   - candidate structure: `BEAR_PUT_BNF_56900_57900_W1000`
   - strikes: sell `56900`, buy `57900`
   - entry UTC: `2026-07-08T04:33:09.191+00:00`
   - exit UTC: `2026-07-08T08:08:19.119+00:00`
   - exit reason: `Stop loss`
   - max profit: `19056`
   - max loss: `10944`
   - actual / net-if-closed P&L: `-155`

2. W800 BNF Bear Put
   - trade id: `167`
   - candidate structure: `BEAR_PUT_BNF_57100_57900_W800`
   - strikes: sell `57100`, buy `57900`
   - entry UTC: `2026-07-08T04:33:15.164+00:00`
   - exit UTC: `2026-07-08T08:08:16.799+00:00`
   - exit reason: `Stop loss`
   - max profit: `14786`
   - max loss: `9214`
   - actual / net-if-closed P&L: `-504`

### Teacher-side recovery

- Direct join from `trades_v2.candidate_id` to `ml_evaluation_outcomes.candidate_id` failed because `trades_v2.candidate_id` appeared to contain trade row ids (`166` / `167`), not brain candidate ids.
- Teacher outcomes were recovered by searching `ml_evaluation_outcomes` with session date + `BNF` + `BEAR_PUT` + strike/width candidate tokens.

Exact teacher matches:

1. W1000 `BEAR_PUT_BNF_56900_57900_W1000`
   - teacher exit: `EOD`
   - teacher exit UTC: `2026-07-08T10:00:07+00:00`
   - teacher R: `0.4889`
   - teacher managed P&L: `5350.03`
   - role: `primary`
   - `snapshot_id`: `2218`
   - `sl_threshold`: `10944`
   - `tp_threshold`: `9450.69`

2. W800 `BEAR_PUT_BNF_57100_57900_W800`
   - primary teacher row:
     - teacher exit: `EOD`
     - teacher exit UTC: `2026-07-08T10:00:07+00:00`
     - teacher R: `0.4711`
     - teacher managed P&L: `4254.45`
     - role: `primary`
     - `snapshot_id`: `2217`
     - `sl_threshold`: `9031.5`
     - `tp_threshold`: `7405.2`
   - secondary teacher row:
     - teacher exit: `EOD`
     - teacher R: `0.4417`
     - teacher managed P&L: `4070.36`
     - role: `secondary`
     - `snapshot_id`: `2218`
     - `sl_threshold`: `9214.5`
     - `tp_threshold`: `7313.65`

### Tracker-side auditability gap

- Supabase search for live tracker Column A evidence did not recover a per-poll `BOOK` / `HOLD` / `EXIT` chronology.
- Snapshot search returned `86` rows, but the returned prefixes did not contain:
  - `position_live`
  - `positions`
  - `verdict`
  - `BOOK`
  - `HOLD`
  - `EXIT`
  - `danger`
  - `controlIndex`
  - `wallDrift`
  - `tracker`
  - `notification`
  - `position`
- `trades_v2.journey_stats.timeline` exists but is empty for both actual trades:
  - trade `166`: `timeline_len = 0`
  - trade `167`: `timeline_len = 0`
- Final Day-2 exit-parity classification:
  - Column C actual: database-native from `trades_v2`
  - Column B honest teacher: database-native / recoverable from `ml_evaluation_outcomes` by candidate token search
  - Column A tracker: not reconstructable from current Supabase data
- Material divergence observed:
  - actual trades exited stop-loss around `13:38 IST`
  - teacher exact-structure rows held to `EOD` around `15:30 IST` and were profitable
  - missing evidence is the live tracker advice at each poll between entry and stop exit

### Claude ruling on exit auditability

- Claude confirmed this is a valid architecture flaw.
- It does not break the current Week-1 A/B entry-gate experiment.
- It does weaken downstream exit-parity / BUILD 4 live-exit proof unless fixed after the freeze.
- Claude explicitly ruled:
  - do not change app code during Week-1
  - do not build or deploy the audit table during the frozen window
  - design it Saturday as part of BUILD 4
  - build it only after the Day-6 verdict

### BUILD 4 requirement 4.B.6

- `position_exit_audit` is mandatory for BUILD 4.
- It is not merely a logging table.
- It must be a paired exit-rule A/B instrument, structurally similar to `ab_week1_decisions` for entry.
- One row per open position per poll.
- The same row must capture both systems on the same mark:
  - live tracker verdict
  - honest-rule verdict
- `teacher_rule_*` fields are mandatory, not optional.
- Required teacher-rule group:
  - `teacher_rule_action`
  - `teacher_rule_exit_type`
  - `teacher_rule_reason`
  - `teacher_rule_net_r`
  - teacher-rule threshold / basis fields
- Reason:
  - if tracker and teacher are reconstructed separately, they may be compared on different marks
  - same-row, same-mark capture makes exit divergence falsifiable at the instant it happens

### Real-money rule

- Real money remains closed until all three are true:
  1. live-exit unification ships
  2. `position_exit_audit` ships
  3. paper audit rows prove near-100% tracker-vs-honest-rule exit-category agreement
- The audit table is the proof instrument for BUILD 4, not just a feature.

### Saturday study provenance

- Saturday exit-parity study must label evidence provenance explicitly:
  - Column B teacher: database-native
  - Column C actual: database-native
  - Column A tracker: event-sampled / reconstructed only, not poll-complete
- Absence of tracker divergence inside gaps must not be treated as proof of agreement.

### Supabase Edge Function / LLM architecture status

- Existing Supabase evaluator function scaffold is present:
  - `supabase/functions/evaluator-jobs-create/index.ts`
  - `supabase/functions/evaluator-jobs-run/index.ts`
  - `supabase/functions/evaluator-jobs-status/index.ts`
  - `supabase/functions/evaluator-jobs-proposals/index.ts`
  - shared helpers under `supabase/functions/_shared/`
- Current `evaluator-jobs-run` is still a stub:
  - writes `gemini_response_stub`
  - does not call Gemini / LLM
  - returns advisory-only zero-proposal output
- Freeze-safe before Saturday:
  - local prompt-bundle design
  - local one-day simulation packet
  - local-only report output
  - no production deployment
  - no writes to live decision / evaluation tables
- Not freeze-safe before Saturday:
  - deploying a production Edge Function used by the app
  - changing existing Edge Functions that can affect live measurement
  - adding DB triggers/jobs that write to live experiment tables
  - wiring any LLM output into app decisions, notifications, evaluation, or branch/ranking state
- Recommended path:
  - simulate one day locally first
  - validate prompt/output contract offline
  - convert the proven local flow into Supabase Edge Function architecture after the frozen verdict window

## Update - 2026-07-11 - Gemini / Oracle Historical Usage Audit and Replacement Architecture

### User observation

- User opened Google AI Studio usage for project `Market Radar NSE`.
- Screenshots showed:
  - Gemini API usage exists over the last 28 days
  - total Gemini API cost shown around `₹623.04`
  - model usage visible for `Gemini 2.5 Flash`
  - API errors visible:
    - `429 TooManyRequests`
    - `503 ServiceUnavailable`
    - `504 GatewayTimeout`
- User asked whether the app was actually using Gemini API.

### Code-path finding

- The phone app does not call Gemini directly.
- The app ecosystem had an indirect Gemini path:
  - Android app
  - `https://marketradar-oracle.online/elephant`
  - Oracle VM `oracle_server/evaluator_app.py`
  - Gemini API
  - Supabase `elephant_assessments`
- Evidence in Android:
  - `MarketWatchService.kt`
  - `ELEPHANT_BASE_URL = "https://marketradar-oracle.online"`
  - `handoffElephantObserveOnly(...)` posts to `/elephant`
  - `launchElephantObserveOnly(...)` sends lane-level candidate payloads when `elephant_fact_pack.observe_only` exists
- Evidence in Oracle server:
  - `oracle_server/evaluator_app.py`
  - reads `GEMINI_API_KEY`
  - initializes:
    - `gemini-2.5-flash`
    - `gemini-2.5-pro`
  - `/elephant` calls `flash_model.generate_content(...)`
  - `/monthly_eval` calls `pro_model.generate_content(...)`
  - persists results to Supabase `elephant_assessments`

### Supabase confirmation

- User ran the compact audit query:

```sql
select
  count(*) as rows,
  min(poll_timestamp) as first_poll,
  max(poll_timestamp) as last_poll
from public.elephant_assessments;
```

- Result:
  - rows: `655`
  - first_poll: `2026-06-08 07:25:28.282162+00`
  - last_poll: `2026-07-09 04:00:00+00`
- Interpretation:
  - historical app/oracle Gemini handoff was real
  - AI Studio cost/usage is consistent with the old Oracle Gemini path
  - this does not prove direct phone-to-Gemini usage
  - it proves app ecosystem usage through Oracle

### Local audit pull

- Codex pulled compact rows using Supabase REST pagination:
  - selected only `poll_timestamp,lane,assessments`
  - no heavy aggregation query
  - total rows fetched: `655`
- Local artifacts created outside repo commit scope:
  - `research_cache/elephant_audit_20260711/elephant_assessments_compact.json`
  - `research_cache/elephant_audit_20260711/elephant_audit_summary.json`
  - `O3_ELEPHANT_GEMINI_AUDIT_20260711.txt`

### Audit results

- Row count:
  - `655`
- Date range:
  - first persisted poll: `2026-06-08T07:25:28.282162+00:00`
  - last persisted poll: `2026-07-09T04:00:00+00:00`
- Lane distribution:
  - `BNF_intraday`: `452`
  - `NF_intraday`: `191`
  - `BNF_swing`: `12`
- Status distribution:
  - `WAIT`: `636`
  - `ok`: `19`
- Failure / wait reasons:
  - `elephant_timeout`: `396`
  - `internal_error`: `197`
  - `Read timed out`: `39`
  - `timeout`: `2`
  - DNS failure for `marketradar-oracle.online`: `1`
- Candidate count stats:
  - rows with candidate count: `655`
  - minimum candidates: `0`
  - maximum candidates: `27`
  - mean candidates: `8.84`
  - median candidates: `9`
  - zero-candidate rows: `2`
  - positive-candidate rows: `653`
- Current O3 normalized qualitative fields found:
  - `normalized_distribution_signal`: none
  - `normalized_coherence_read`: none
  - `normalized_anomaly_flag`: none

### Schema finding

- The `19` successful rows are not useful for the current O3 contract.
- Successful verdict key groups:
  - `NO_CANDIDATES`: `1`
  - `judgments`: `18`
- The old successful Gemini output used the earlier approval/judgment shape:
  - `approved`
  - `reasoning`
  - `confidence`
  - `sellStrike`
- This is materially different from the current O3 observe-only schema:
  - `distribution_signal`
  - `coherence_read`
  - `anomaly_flag`
  - `anomaly_reason`
  - `brief`
  - `candidate_notes`
- Conclusion:
  - old `elephant_assessments` can be used for architecture/cost/failure audit
  - old `elephant_assessments` should not be treated as a reliable current-contract LLM signal dataset

### Operational conclusion

- Gemini wiring is not new.
- The old path proved connectivity.
- The old path must not be reused as-is because it was:
  - too chatty
  - timeout-prone
  - mostly `WAIT`
  - schema-drifted
  - not ground-truth-scoreable under the current O3 contract
- Historical Gemini usage likely burned quota/cost without producing enough validated advisory value.

### Replacement architecture packet

- Codex created:
  - `O3_LLM_REPLACEMENT_ARCHITECTURE_20260711.txt`
- Purpose:
  - replace uncontrolled per-poll LLM usage with:
    - trigger-gated calls
    - packet hash caching
    - daily budgets
    - provider circuit breakers
    - strict schema validation
    - ground-truth-scoreable outputs
    - no live brain mutation
- Key design decision:
  - retire default per-poll lane-level Gemini calls
  - only call Gemini when a material trigger fires

### Proposed trigger policy

- Allow live Flash only when at least one trigger fires:
  - regime transition
  - strategy family flip
  - signal conflict
  - candidate-quality anomaly
  - manual user trigger
  - post-close research trigger
- Suppress calls when:
  - same market-state fingerprint already evaluated
  - daily budget exhausted
  - provider returned repeated `429`, `503`, or `504`
  - schema validation failed repeatedly
  - packet lacks enough context
  - call would change frozen app behavior

### Proposed new storage

- Prefer a new `llm_observations` table instead of reusing legacy `elephant_assessments`.
- Suggested columns include:
  - `session_date`
  - `poll_timestamp`
  - `lane`
  - `index_key`
  - `use_case`
  - `provider`
  - `model_name`
  - `schema_version`
  - `prompt_version`
  - `prompt_hash`
  - `packet_hash`
  - `request_payload`
  - `raw_response`
  - `normalized_response`
  - `validation_status`
  - `validation_errors`
  - `latency_ms`
  - `provider_status`
  - `provider_error`
  - `token_usage`
  - `downstream_use`
- Suggested companion table:
  - `llm_daily_budget`

### Freeze decision

- No app code changed.
- No repo code changed for this audit/design step.
- No deploy.
- No push.
- `Marketapp-main-worktree` status checked clean.
- `MarketVivi-git` was clean before this knowledge update.
- Week-1 freeze still stands:
  - do not alter live ranker
  - do not alter candidate generation
  - do not alter EV/calm gates
  - do not retrain
  - do not reactivate per-poll Gemini calls

### Forward decision

- Continue offline/backend design without asking Claude at every step.
- Ask Claude only when a post-freeze behavior/storage proposal is concrete.
- Suggested future Claude question:
  - old Oracle/Gemini path produced `655` rows but only `19 ok`, mostly old `judgments` schema and zero O3 normalized fields
  - propose replacing it with trigger-gated, cached, validator-enforced, budget-limited LLM observations stored in `llm_observations`
  - no ranker mutation
  - no live execution authority
  - approve Phase 1 schema/storage after Week-1 freeze?

### O3-G2 Gemini resume attempt

- User asked to proceed with the next step: resume O3-G2 Gemini scoring.
- Codex attempted to resume the existing local Gemini run:
  - input: `research_cache/o3g2_20260711/o3g2_packets_blind.jsonl`
  - output: `research_cache/o3g2_20260711/o3g2_gemini_flash_responses_20260711.jsonl`
  - mode: `--resume`
  - model: `gemini-2.5-flash`
- No app code changed.
- No Supabase writes.
- No push/deploy.
- Result:
  - existing responses before resume: `7`
  - remaining packets: `19`
  - responses after resume: `7`
  - resume blocked at packet `8`
- Error:
  - HTTP `429`
  - status: `RESOURCE_EXHAUSTED`
  - quota metric: `generativelanguage.googleapis.com/generate_content_free_tier_requests`
  - quota id: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`
  - model: `gemini-2.5-flash`
  - quota value: `20` requests/day/project/model
- Blocked packet:
  - packet_index: `8`
  - session_date: `2026-06-22`
  - snapshot_id: `1387`
- Current Gemini partial score remains:
  - completed: `7 / 26`
  - validator pass: `7`
  - validator fail: `0`
  - scored correct so far: `7`
  - high_on_zero_control: `0`
  - high_on_adversarial_null: `0`
- Important limitation:
  - only `ranking_jun22` stratum is represented so far
  - exit, zero-evaluable control, and adversarial/null strata remain untested by Gemini
- Local blocker note created:
  - `O3G2_GEMINI_RESUME_BLOCKED_20260711.txt`
- Decision:
  - stop further Gemini calls for now
  - do not mix other Gemini model outputs into the current `gemini-2.5-flash` result file
  - if another model is tested, label it as a separate experiment

### O3-G2 background baseline audit while Gemini is blocked

- Since Gemini quota remained blocked, Codex continued non-Gemini offline work.
- No Gemini calls.
- No app code changes.
- No Supabase writes.
- No push/deploy.
- Joined:
  - O3-G2 manifest with withheld labels
  - O3-G2 blind packets
  - Codex baseline responses
  - partial Gemini Flash responses
- Local artifacts created:
  - `research_cache/o3g2_20260711/o3g2_joined_audit_rows.json`
  - `research_cache/o3g2_20260711/o3g2_joined_audit_summary.json`
  - `O3G2_BACKGROUND_BASELINE_AUDIT_20260711.txt`
- Packet set:
  - total packets: `26`
  - `ranking_jun22`: `10`
  - `exit_jul08`: `10`
  - `zero_evaluable_control_jul09`: `5`
  - `adversarial_null_ranking`: `1`
- Codex baseline:
  - validator pass: `26`
  - validator fail: `0`
  - no high call on zero-evaluable controls
  - no high call on adversarial/null packet
- Codex baseline by stratum:
  - `adversarial_null_ranking`: ranking correct `1/1`, exit correct `1/1`
  - `exit_jul08`: ranking correct `8/10`, ranking over_call `2/10`, exit correct `10/10`
  - `ranking_jun22`: ranking correct `8/10`, ranking over_call `2/10`, exit correct `10/10`
  - `zero_evaluable_control_jul09`: ranking correct `5/5`, exit correct `5/5`
- Baseline weakness found:
  - Codex did not under-call high-severity cases
  - all errors were over-calls
  - two low-uplift ranking packets were over-called:
    - packet `9`, snapshot `1396`, expected `low`, actual_delta_r `0.0517`, Codex called `high`
    - packet `10`, snapshot `1406`, expected `low`, actual_delta_r `0.0672`, Codex called `medium`
  - two open-position exit packets over-called ranking suspicion when ranking should abstain:
    - packet `11`, snapshot `2219`, expected ranking `abstain`, expected exit `low`, Codex ranking `medium`, Codex exit `low`
    - packet `13`, snapshot `2228`, expected ranking `abstain`, expected exit `high`, Codex ranking `medium`, Codex exit `high`
- Interpretation:
  - Codex baseline is conservative rather than reckless
  - useful comparator for Gemini:
    - Gemini must pass schema
    - Gemini must catch true high ranking/exit cases
    - Gemini must avoid over-calling low-uplift and exit-only packets
- Gemini still untested on:
  - packet `8` and remaining ranking rows
  - low-uplift over-call challenge rows `9` and `10`
  - all exit rows `11-20`
  - all zero-evaluable controls `21-25`
  - adversarial/null packet `26`

## Update - 2026-07-11 - Sandbox Wiring Path Audit and Freeze-Safe Plan

### User question

- User asked whether we can move to wire the app to sandbox.
- Decision:
  - do not wire the running app during the Week-1 freeze
  - proceed with safe audit/design only

### Current code audit

- Current app already has execution-mode UI/preferences:
  - `Sandbox ON`
  - `Sandbox OFF`
  - order proxy URL input
  - execution infra status display
- PWA functions:
  - `setExecutionSandboxFromUI(enabled)`
  - `saveOrderProxyUrlFromUI()`
- Native bridge functions:
  - `setExecutionSandboxEnabled(enabled)`
  - `getExecutionSandboxEnabled()`
  - `setOrderProxyUrl(url)`
  - `getOrderProxyUrl()`
  - `getExecutionInfraStatus()`
- Native prefs:
  - `execution_sandbox_enabled`
  - `order_proxy_url`
  - derived `execution_mode`
- Current mode derivation:
  - sandbox if sandbox flag enabled
  - live if proxy URL starts with `https://`
  - paper otherwise
- Current infra status reports:
  - instrument key flow
  - token readiness
  - sandbox readiness
  - live readiness
  - proxy status
- `brain.py` has `check_execution_readiness(...)`:
  - verifies instrument keys
  - verifies token readiness
  - verifies sandbox flag for sandbox mode
  - verifies proxy for live mode
  - verifies NSE market hours for sandbox/live
- Candidate UI uses `executionReadiness`:
  - if sandbox/live and not ready, button shows `EXEC WAIT`
  - if ready, existing `REAL TRADE` button still calls `takeTrade(candidate_id, false)`
- Important finding:
  - current `REAL TRADE` does not place a broker order
  - it records/logs a real-trade row in `trades_v2`
  - no active code path currently places, modifies, cancels, or monitors Upstox orders
- Current broker API use is read/check only:
  - market quotes
  - option chain
  - option contracts / expiry
  - margin quote via `POST https://api.upstox.com/v2/charges/margin`

### Official Upstox docs rechecked on 2026-07-11

- Current official docs confirm:
  - sandbox environment supports place/modify/cancel order APIs
  - sandbox-enabled APIs include:
    - Place Order
    - Place Order V3
    - Place Multi Order
    - Modify Order
    - Modify Order V3
    - Cancel Order
    - Cancel Order V3
  - Place Order V3 endpoint exists:
    - `POST https://api-hft.upstox.com/v3/order/place`
  - Place Multi Order endpoint documented:
    - `POST https://api.upstox.com/v2/order/multi/place`
  - Multi Order docs state BUY orders execute before SELL orders
  - this aligns with the app's spread safety principle:
    - BUY protection before SELL credit
- Known broker risks remain:
  - static IP restriction can block order APIs
  - market orders may be blocked
  - limit order policy should be used for first implementation

### Sandbox wiring plan created

- Local design artifact:
  - `SANDBOX_WIRING_PLAN_20260711.txt`
- Scope:
  - freeze-safe design only
  - no app code change
  - no deploy
  - no push
  - no broker call

### Recommended architecture

- Add a separate execution adapter after freeze:
  - recommended class: `UpstoxOrderClient.kt`
- Do not mix order placement into:
  - `MarketWatchService` polling loop
  - `brain.py` ranker
  - candidate generation
  - ML/evaluator path
- PWA should request execution through `NativeBridge`.
- Android/Kotlin should own broker execution because it already owns:
  - Upstox token
  - network access
  - native lifecycle

### Proposed post-freeze NativeBridge methods

- `previewSandboxOrder(candidateJson)`
  - local validation only
  - no broker call
- `placeSandboxOrder(candidateJson, confirmationToken)`
  - sandbox broker call only
- `getSandboxOrderStatus(orderIdsJson)`
- `cancelSandboxOrder(orderIdsJson)`
- later only:
  - `placeLiveOrder(...)`

### Safety gates before any sandbox order call

- Manual user tap required.
- Confirmation modal required.
- Candidate freshness gate required.
- Mode must be `sandbox`.
- Sandbox flag must be enabled.
- Token must be present.
- All leg instrument keys must be present.
- Quantity must be a valid lot multiple.
- Defined-risk spread only.
- No naked SELL leg.
- Candidate must not be blocked by brain gate.
- Execution readiness must be `READY`.
- Margin quote should exist or explicit override must be shown.
- Confirmation nonce/token must be generated just before broker call.
- Response must persist with `execution_mode = sandbox`.

### Post-freeze implementation sequence

1. Schema/lifecycle storage prep.
2. Native dry-run payload builder.
3. UI preview modal only.
4. One explicitly approved sandbox API call.
5. Sandbox spread lifecycle test.
6. Live-readiness review only after:
   - sandbox passes
   - exit audit table exists
   - paper exit agreement is stable
   - static IP/proxy is confirmed
   - kill switch is verified
   - user explicitly approves

### Open questions before implementation

- Does the current Upstox account/API key have sandbox order permission?
- Does sandbox require a special header or environment selector for this account?
- Which product value is correct for NSE F&O option intraday sandbox orders?
- Does Place Multi Order return per-leg order IDs consistently in sandbox?
- Should sandbox route direct from Android or through Oracle relay for live parity?
- What exact order-status endpoint/version should be used for V3 lifecycle?
- Should first sandbox test be non-market-hours no-risk sandbox, or market-hours with live instrument keys?

### Current decision boundary

- Sandbox wiring is not a current live-app task.
- It is a post-freeze execution infrastructure task.
- Freeze-safe work completed:
  - code audit
  - official docs recheck
  - design packet
  - knowledge update

### Claude ruling on sandbox architecture

- Source:
  - `RULING_SANDBOX_ARCHITECTURE_20260711.md`
- Claude approved the architecture with corrections.
- Freeze remains binding:
  - no app code
  - no build
  - no broker call
  - no sandbox wiring before the Day-6 letter
- Codex recommendation accepted:
  - approve S1-S3 as post-freeze prep
  - no S4 until storage and preview exist
  - no live execution until BUILD 4 gates pass
- Critical finding must be preserved:
  - current `REAL TRADE` places no broker order
  - it only logs to `trades_v2`
  - every `real trade` row in `trades_v2` to date is a logged intention, not broker-confirmed execution
  - fill realism remains unmeasured

### Binding corrections from Claude

- `UpstoxOrderClient.kt` remains the right direction, but:
  - endpoint separation must be structural
  - sandbox and live must not be runtime branches of the same method
  - `placeSandboxOrder` must be physically incapable of constructing a live URL
  - sandbox and live base URLs must be separate constants
  - future live path must be a separate method behind separate gates
- Client must be stateless about strategy:
  - receives legs
  - validates structure
  - places
  - reports
  - never decides strategy
- `execution_order_events` is mandatory before first sandbox call.
- Expanded `trades_v2` alone is not enough because fill realism is a time-series per leg.
- Keep thin `trades_v2` summary fields for display, but events table is Tier-1 evidence.
- Every event row must include:
  - `app_version`
  - `execution_mode`
  - `order_tag`
  - local event timestamp
  - broker event timestamp where available
  - full raw broker response JSON
  - `teacher_config_version`
- `previewSandboxOrder(...)` is mandatory before `placeSandboxOrder(...)`.
- `placeSandboxOrder(...)` must require a confirmation token:
  - issued only by successful preview on same candidate
  - TTL <= 60 seconds
  - single use
- Sandbox transport:
  - direct Android -> Upstox HTTPS
  - Oracle relay is forbidden for order traffic until TLS is deployed
  - broker credentials must not pass over cleartext transport
- First sandbox test sequence:
  1. single BUY leg
  2. two-leg defined-risk spread with manual BUY protection -> SELL credit sequencing
  3. multi-order defined-risk spread to verify Upstox BUY-before-SELL behavior
  - do not compress stages into one approval/session

### Additional required gates

- Limit-price sanity band:
  - within ±2% or 5 ticks of current quoted mid, whichever is larger
- Candidate freshness:
  - quote age <= 2 poll cycles / <= 10 minutes
- Daily sandbox order cap:
  - proposed cap: 10 sandbox orders/day
- Idempotency:
  - every order has unique `order_tag`
  - before send, check no non-terminal row with same tag
  - `unknown` status = full stop on that tag
  - never resend on unknown
- Market-hours and trading-day check must exist inside `UpstoxOrderClient`, not only in readiness.
- Kill switch:
  - persisted flag `execution_kill_switch`
  - checked before every broker call
  - default ON/blocking after any unknown status or partial-failure branch
  - clearable manually from UI
- Static-IP empirical check is a named S4 deliverable:
  - record source-IP behavior and any IP-restriction-like 4xx in events table
- Token scope + expiry check must happen at preview time.
- Margin quote must come from live margin API:
  - no flat constants
  - no explicit override path in v1
  - if B2 margin fix has not shipped, S4 cannot honestly pass
- Write-ahead persistence:
  - insert `sending` event row before HTTP call
  - startup recovery resolves non-terminal rows before any new broker action
- Secrets discipline:
  - credentials only in env/secret storage
  - no token/key in chat, repo, event raw payload, or persisted order payload
  - redact token fields before persistence

### Sandbox sequencing ruling

- S1-S3 are app builds and must ship between measurement windows, not during one.
- Recommended sequence:
  1. Day-6 letter first.
  2. B1 repair fix + stamping.
  3. CHANGE-2 directive drafted.
  4. S1-S3 ship while CHANGE-2 is under review and no measurement window is running.
  5. CHANGE-2 ships and its measurement window runs.
  6. S4 first sandbox call may run during CHANGE-2 window only if S1-S3 already shipped and no new app build is needed.
  7. B2 margin fix in next window gap.
  8. S5 only after B2.
- Approved/deferred:
  - S0 audit/design: done, accepted
  - S1 events schema, S2 dry-run builder, S3 preview UI: approved post-freeze, between windows
  - S4 first sandbox call: conditional on S1-S3 complete, B2 shipped, kill switch live, all added gates present
  - S5 spread lifecycle: conditional on S4 pass
  - S6 live-readiness review: deferred
  - Oracle relay for order traffic: forbidden until TLS
  - live order placement: not on the table

### 2026-07-11 10:21 UTC - Sandbox ruling reconciled into local plan

- Uploaded ruling processed:
  - `RULING_SANDBOX_ARCHITECTURE_20260711.md`
- Local artifact reconciled:
  - `SANDBOX_WIRING_PLAN_20260711.txt`
- No app source code changed.
- No build files changed.
- No broker call made.
- No push/deploy performed.
- Corrections applied to the plan:
  - removed the old margin override path
  - clarified that B2 live-margin fix is prerequisite before S4 can honestly pass
  - changed candidate freshness to Claude's bound:
    - quote age <= 2 poll cycles
    - absolute cap <= 10 minutes
  - made `execution_order_events` mandatory before any sandbox call
  - kept `trades_v2` as thin display summary only
  - added write-ahead persistence requirement:
    - insert `sending` event before broker HTTP call
    - resolve non-terminal rows on startup before any new broker action
  - clarified sandbox transport:
    - direct Android -> Upstox HTTPS
    - Oracle relay forbidden until TLS
  - clarified live execution:
    - not on the table
    - requires separate S6 review and explicit written approval

### Current next step after sandbox ruling

- Wait for Day-6 verdict letter first.
- Until then, allowed work is freeze-safe only:
  - schema draft text
  - S1-S3 directive/checklist draft
  - O3/O3-G2 offline analysis
  - Gemini comparison only after quota/billing reset
- Do not implement sandbox code, create app builds, push releases, or make broker calls before the freeze lifts.

## Update - 2026-07-12 - O3/O3-G2 Offline Dynamic Branch Analysis

### Scope

- User selected Option 3:
  - continue offline O3/O3-G2 analysis while the app remains frozen
- Work performed:
  - local-only analysis
  - no app source code change
  - no build file change
  - no Gemini call
  - no Supabase call/write
  - no broker call
  - no push/deploy

### Local artifact created

- `O3G2_OFFLINE_DYNAMIC_BRANCH_ANALYSIS_20260712.txt`

### Source files used

- `research_cache/o3g2_20260711/o3g2_packets_blind.jsonl`
- `research_cache/o3g2_20260711/o3g2_manifest_with_ground_truth.csv`
- `research_cache/o3g2_20260711/o3g2_codex_baseline_responses.jsonl`
- `research_cache/o3g2_20260711/o3g2_gemini_flash_responses_20260711.jsonl`
- `research_cache/o3g2_20260711/o3g2_joined_audit_summary.json`
- `research_cache/profit_attribution_20260612_20260709/primary_vs_best_feature_matrix.csv`
- `research_cache/profit_attribution_20260612_20260709/full_menu_ranker_replay_summary.json`
- `research_cache/profit_attribution_20260612_20260709/cluster_analysis.json`

### O3-G2 current status

- Packet set:
  - total packets: `26`
  - `ranking_jun22`: `10`
  - `exit_jul08`: `10`
  - `zero_evaluable_control_jul09`: `5`
  - `adversarial_null_ranking`: `1`
- Codex baseline:
  - validator pass: `26/26`
  - validator fail: `0`
  - no high call on zero-evaluable controls
  - no high call on adversarial/null packet
- Gemini Flash:
  - completed: `7/26`
  - all completed packets are `ranking_jun22`
  - remaining hard strata are still untested by Gemini:
    - low-uplift over-call challenge rows
    - exit packets
    - zero-evaluable controls
    - adversarial/null packet
  - still blocked by Gemini quota/billing until reset or billing correction

### Codex baseline weaknesses

- Codex baseline errors are over-calls, not missed danger.
- Over-called packets:
  - packet `9`, snapshot `1396`, expected low, actual delta_R `0.0517`, Codex called high
  - packet `10`, snapshot `1406`, expected low, actual delta_R `0.0672`, Codex called medium
  - packet `11`, exit-only snapshot `2219`, ranking should abstain, Codex called medium, exit severity correct low
  - packet `13`, exit-only snapshot `2228`, ranking should abstain, Codex called medium, exit severity correct high
- Future validator rule:
  - exit-only packets should force ranking-suspicion abstain unless candidate-comparison evidence exists
  - actual delta_R below `0.10` should not be high severity unless a separate structural defect exists

### Dynamic branch finding

- Local evidence supports branching, not one universal ranker rule.
- Feature matrix rows where local best beat primary:
  - rows: `489`
  - average uplift: `Rs 1,321.99`
  - median uplift: `Rs 736.64`
  - p90 uplift: `Rs 2,672.82`
  - average delta_R: `0.3753`
  - median delta_R: `0.0414`
- Two different failure modes:
  - best generated but not watchlisted: `271`
  - best in watchlist but not top: `218`

### Branch 1 - strategy-family/admission gap

- Strategy-family gap:
  - rows: `249`
  - average uplift: `Rs 2,110.17`
  - median uplift: `Rs 1,452.70`
  - p90 uplift: `Rs 4,406.52`
  - average delta_R: `0.7133`
  - best generated but not watchlisted: `220`
- Interpretation:
  - largest profit pocket
  - mostly construction/admission failure, not just final sort failure
  - better family existed in generated candidates but often did not survive into watchlist/top display

### Branch 2 - width/ranking gap

- Width gap:
  - rows: `237`
  - average uplift: `Rs 506.45`
  - median uplift: `Rs 380.82`
  - p90 uplift: `Rs 1,036.46`
  - average delta_R: `0.0241`
  - best in watchlist but not top: `186`
- Interpretation:
  - mostly final ranking/top-selection problem
  - lower value than strategy-family gap
  - should be handled cautiously to avoid low-uplift churn

### Strategy pair pockets

- Largest pockets with at least 3 rows:
  - `BEAR_PUT -> BEAR_CALL`:
    - rows `31`
    - average uplift `Rs 6,843.78`
    - median uplift `Rs 6,983.31`
    - median delta_R `1.0848`
  - `IRON_CONDOR -> IRON_BUTTERFLY`:
    - rows `19`
    - average uplift `Rs 2,263.36`
    - median uplift `Rs 2,145.61`
    - median delta_R `1.8590`
  - `IRON_CONDOR -> BEAR_CALL`:
    - rows `65`
    - average uplift `Rs 1,487.49`
    - median uplift `Rs 1,577.06`
    - median delta_R `1.5101`
  - `BEAR_CALL -> BULL_PUT`:
    - rows `89`
    - average uplift `Rs 1,412.56`
    - median uplift `Rs 949.88`
    - median delta_R `0.0956`
- Interpretation:
  - these are regime/family pockets, not universal rules
  - do not hard-code strategy switches

### Width/risk findings

- Wider alternatives often explain hindsight improvement:
  - `>2.5x` wider:
    - rows `71`
    - average uplift `Rs 1,990.75`
    - median uplift `Rs 1,824.94`
    - median delta_R `0.3574`
  - `1.6x-2.5x` wider:
    - rows `276`
    - average uplift `Rs 1,195.80`
    - median uplift `Rs 764.11`
- Risk ratio evidence:
  - `1.25x-2.5x` risk:
    - rows `224`
    - average uplift `Rs 1,470.22`
  - `>2.5x` risk:
    - rows `215`
    - average uplift `Rs 1,311.12`
- Interpretation:
  - many profitable alternatives used more risk/capital
  - this reinforces B2 margin fix and sandbox fill-realism prerequisites
  - do not deploy a naive "choose wider" rule

### Market-regime finding

- VIX bucket behavior:
  - `VIX < 12.5`:
    - rows `107`
    - average uplift `Rs 471.47`
    - median uplift `Rs 359.81`
    - average delta_R `0.0237`
    - mostly watchlist/top-ranking issue
  - `12.5 <= VIX < 13.2`:
    - rows `135`
    - average uplift `Rs 1,155.14`
    - median uplift `Rs 1,237.72`
    - average delta_R `0.8115`
  - `13.2 <= VIX < 14`:
    - rows `235`
    - average uplift `Rs 1,803.48`
    - median uplift `Rs 895.50`
    - best generated but not watchlisted `162`
- Interpretation:
  - low VIX appears more like conservative width/ranking-churn terrain
  - mid-VIX/higher-IV regimes show larger family/admission errors
  - future branch selector must be regime-aware

### Current answer to special assignment

- Strategy-family/admission failures made the most money in the past window.
- Width/ranking refinements also made money, but usually less and with greater churn/slippage/risk sensitivity.
- Individual leg trading cannot be fairly concluded from the current dataset because evidence is candidate/strategy-outcome shaped, not broker-fill/leg-lifecycle shaped.
- The brain did not pick many winners because it either:
  - did not admit better generated candidates into watchlist
  - ranked a watchlisted alternate below primary
  - over-weighted one family/width under a regime where another branch was better

### Recommended next offline step

- Build a local branch-label dataset:
  - `FAMILY_ADMISSION_MISS`
  - `WIDTH_RANKING_MISS`
  - `LOW_UPLIFT_WIDTH_CHURN`
  - `HIGH_IV_FAMILY_ALTERNATE`
  - `HIGH_RISK_UPLIFT_NEEDS_MARGIN`
- Then score a shadow-only branch selector against:
  - uplift captured
  - risk increase
  - false switches
  - low-uplift churn avoided
  - generated-not-watchlist recovery
- This remains offline research only and must not touch frozen app behavior.

## Update - 2026-07-13 - Claude Directive: Agent Skill, Friction Constant, LLM/ML Rulings

### Source

- Uploaded directive:
  - `DIRECTIVE_OC_AGENT_SKILL_FRICTION_LLM_RULINGS_20260713.md`
- Date processed:
  - `2026-07-13 08:05 UTC`
- Scope:
  - offline research environment only
  - freeze holds
  - no app code
  - no build
  - no push
  - no live order
  - no Supabase live-table write
- Day-6 verdict letter remains the gate.
- Nothing in this directive opens Track B before the Day-6 letter.

### New confirmed brokerage constant

```text
BROKERAGE_PER_ORDER = ₹10   (flat, Upstox, valid through Sept 2026 — re-verify Oct 2026)
```

- Source per Claude directive:
  - Upstox email to Vivek received around `2026-07-10`
- Current modeling gap:
  - brain currently models zero transaction cost
  - A8 gate, teacher R, `premiumEdge`, `ev`, and branch/replay numbers to date are gross of friction
- Conservative model until measured:
  - 2-leg spread round trip:
    - 4 orders
    - brokerage = `₹40`
  - 4-leg IC/IB round trip:
    - 8 orders
    - brokerage = `₹80`
  - statutory charges remain unmodeled:
    - STT
    - exchange transaction charges
    - SEBI fees
    - GST
    - stamp duty
- Empirical open question:
  - Is `₹10` charged per order or per leg?
  - If multi-leg basket is billed under one order ID, actual cost may differ.
  - Must be measured from broker response/contract note during sandbox study.
  - Until measured, model conservative case:
    - `₹10 × legs × 2`

### Analytical consequence for branch research

- All branch/selector tables must report:
  - gross uplift
  - friction-adjusted uplift
  - assumed brokerage model
  - statutory-charge status:
    - estimated
    - measured
    - unavailable
- Prior O3-G2 branch finding:
  - width-gap branch median uplift was roughly `₹256-₹380`
  - against `₹40-₹80` brokerage plus statutory charges, a large part of width-churn may be economically weak or dead
  - strategy-family/admission branch median uplift around `₹1,197-₹1,453` survives friction more comfortably
- Practical priority update:
  - family/admission branch remains highest-value research path
  - width/ranking branch must include friction before it is treated as worth implementing
  - low-uplift width churn must be penalized or suppressed
- This strengthens first-real-trade staging:
  - 2-leg only first
  - 4-leg structures cost more, have more fill risk, and may partial-fill into unwanted positions

### Upstox Agent Skill ruling

- Claude authorized Upstox Agent Skill for offline fill-realism study only.
- It is not part of Market Radar app architecture.
- It must not be wired into the phone app.
- App sandbox architecture remains unchanged:
  - Kotlin `UpstoxOrderClient`
  - structural endpoint separation
  - preview-token coupling
  - `execution_order_events`
  - kill switch
  - direct Android -> Upstox HTTPS for app sandbox path
- Agent Skill purpose:
  - decouple fill-realism exploration from the app build train
  - run sandbox study from offline/laptop environment after Day-6 letter
  - produce Tier-1 raw broker lifecycle evidence without app builds

### Agent Skill safety boundaries

- Live token must never enter the environment.
- `UPSTOX_ACCESS_TOKEN` must be absent from:
  - machine
  - shell
  - config file
  - process environment
- Only sandbox token may be present:
  - `UPSTOX_SANDBOX_ACCESS_TOKEN`
- No `config.json` containing live token.
- No live order under any circumstance.
- Every sandbox order must be:
  - sandbox only
  - 1 lot
  - LIMIT
  - defined-risk when multi-leg
  - fully logged with raw broker response JSON
- Broker-side kill switch must be understood before first order:
  - SDK exposes `UserApi.update_kill_switch(...)`
- App-side kill switch from sandbox architecture still remains required later.
- Agent narration is Tier-2 evidence.
- Raw broker JSON is Tier-1 evidence.
- Secrets discipline:
  - no token in chat
  - no token in repo
  - no token in artifact
  - no token in persisted payload
  - redact before writing any order payload/response

### Agent Skill timing

- Authorized now:
  - prepare only
  - read docs / skill instructions
  - obtain sandbox-only token
  - write study plan
  - write capture schema
  - environment attestation plan
- Not authorized before Day-6 verdict letter:
  - first sandbox order
  - any broker-side execution experiment
- First sandbox order timing:
  - Wednesday `2026-07-15` or later
  - only after Day-6 verdict letter

### SANDBOX_FILL_REALISM_STUDY_v1 deliverable

- Required single artifact after execution:
  - environment attestation
  - proof live token absent
  - order-by-order log
  - intent
  - legs
  - limits
  - timestamps
  - raw responses
  - fills
  - rejections
  - charges
  - answer each empirical question or mark `UNANSWERED`
  - measured friction model
  - `SELF-AUDIT — DEVIATIONS FROM DIRECTIVE`

### Sandbox empirical questions to answer

1. 4-leg complete-fill rate for IC/IB at 1 lot.
2. Per-leg slippage versus assumed mid:
   - median
   - p90
3. Time-to-complete-fill distribution.
4. 2-leg versus 4-leg fill-reliability gap.
5. Whether broker actually enforces BUY-before-SELL in multi-leg basket.
6. Whether `₹10` is charged per order or per leg.
7. Whether static-IP restriction fires from non-static IP on sandbox order endpoints.
8. Whether BNF lot size is empirically `30` or `35`.

### Sandbox test order remains A -> B -> C

1. A:
   - single BUY leg
   - proves auth, request/response lifecycle, rejection shape
   - zero naked-sell risk
2. B:
   - 2-leg defined-risk
   - protection BUY first
   - credit SELL second
   - verifies sequencing/failure branches
3. C:
   - multi-leg basket
   - verifies broker-side BUY-before-SELL claim
   - verifies multi-leg fill and charge behavior
- No skipping.
- No compressing stages.

### Grok ruling

- Grok rejected as primary LLM.
- Reasons recorded by Claude:
  - volume assumption wrong by `10x-25x`
  - actual observer volume is about `75/day`, not `500-2,000/day`
  - cost difference is not the deciding axis at real volume
  - wrong axis:
    - observer fills strict schema/enums
    - schema enforcement is decisive, not broad reasoning depth
  - fabrication:
    - Grok referenced a Gemini path/history that does not match current O3-G2 evidence
- LLM stack remains:
  - Gemini 2.5 Flash paid Tier-1 primary with `responseSchema` mandatory
  - DeepSeek V4 Flash fallback, separate failure domain
  - Gemini 3.1 Pro month-end evaluator
- Grok can be considered only as a fallback candidate later.
- Settlement method if reopened:
  - run same 26 O3-G2 packets through each model
  - same validator
  - same ground-truth scoring
  - one output file per model
  - no vendor self-grading

### Google TabFM ruling

- TabFM approved only as a Track-R baseline learner.
- Role:
  - offline shadow branch-selector study
  - compare against simple rules
  - ex-ante features only
  - day-level train/test split
  - capture-ratio versus oracle
  - friction-adjusted scoring
- Not approved for:
  - phone runtime
  - live path
  - app component
  - model upgrade priority over measurement repair
- Limitations recorded:
  - project bottleneck is data pathology, not model capacity
  - small, biased, day-clustered labels can make a stronger model learn bias faster
  - rows are time-series/regime-drifted, not exchangeable
  - non-commercial license creates future product risk
- Sequencing unchanged:
  - Day-6 letter first
  - CHANGE-2 / A8 gate fix
  - B2 margin
  - exit audit
  - only then model-upgrade research can matter

### Still frozen

- No app source change.
- No build.
- No push.
- No deploy.
- No OTA.
- No live order.
- No live token on any machine.
- No Supabase live-table write.
- No ranker change.
- No gate change.
- No threshold change.
- No retrain.
- Day 6 runs untouched:
  - daily K3 check
  - kill switches K1-K4 only
- Tuesday evening sequence:
  - Antigravity independent recount from raw `ab_week1_decisions`
  - Claude Day-6 verdict letter
  - only then Track B may open

### Action list after this directive

- Now:
  - record brokerage constant in project knowledge
  - keep app frozen
- Next research pass:
  - add friction columns to branch/selector tables
  - report gross and friction-adjusted uplift
- Prep only before Day-6 letter:
  - read Agent Skills documentation
  - obtain sandbox-only token
  - draft study plan and capture schema
  - prepare environment attestation
- Tuesday `2026-07-14`:
  - Day-6 K3 check
  - escalate only K1-K4
  - Antigravity recount
  - Day-6 verdict letter
- Wednesday `2026-07-15` or later:
  - first sandbox order only if verdict allows:
    - single BUY leg first
- After billing enabled:
  - run all 26 O3-G2 packets using paid-tier Gemini with response schema
  - one file per model
  - no claims from partial runs

### Self-audit for this knowledge update

- App source changed:
  - no
- Build changed:
  - no
- Push/deploy:
  - no
- Supabase live-table write:
  - no
- Broker/Gemini call:
  - no
- Deviations:
  - Agent Skills docs were not yet independently fetched/read in this step because user requested analysis and project-knowledge update only; implementation/prep is deferred until after tomorrow unless explicitly requested within freeze-safe bounds.

## 2026-07-13 Day-5 post-close paper-trade reconciliation

### Trigger

- After market close, screenshots showed:
  - v2.5.0 / b331
  - session complete 76/76
  - latest ML/candidate views with 0 generated / 0 watchlist / 0 session rows
  - Day evaluation initially retryable, then Supabase evidence showed eval rows present after retry
- User corrected the interpretation:
  - two BNF paper trades were actually taken in the afternoon
  - therefore "no candidate existed" could not be accepted as a session-level conclusion

### Local read-only pull

- Supabase REST was used read-only because browser SQL was getting stuck.
- No Supabase writes were made.
- No app files were changed except this knowledge note.
- No push/deploy/OTA.
- Local evidence saved under:
  - `research_cache/day5_paper_recon_20260713/`
- Detailed handoff file:
  - `DAY5_PAPER_TRADE_RECONCILIATION_20260713.txt`

### Supabase slices pulled

- `trades_v2`
  - ids 168 and 169
- `ab_week1_decisions`
  - session_date `2026-07-13`
  - experiment `week1_a8_nf_calm_gate`
  - 73 rows
- `ml_brain_snapshots`
  - session_date `2026-07-13`
  - entry window `14:15-14:50 IST`
  - snapshot ids 2494-2501
  - 8 rows

### Reconciliation result

- The two paper trades were real and aligned with the 14:35 IST BNF Bear Call candidates.
- The later zero-candidate UI state is a latest-snapshot/state issue, not proof that candidates never existed during the session.
- At 14:35 IST:
  - snapshot id 2498
  - generated_count: 2
  - watchlist_count: 2
  - rejected_count: 293
  - top_candidate_type: `BEAR_CALL`
  - both BNF candidates had `executionGate: READY`
- At 14:40 IST onward:
  - the new path returned to WAIT because `CALM_NF_ONLY_WAIT` removed BNF intraday survivors

### Paper trades

- Trade 168:
  - BNF intraday `BEAR_CALL`
  - entry `14:36:13 IST`
  - exit `15:08:32 IST`
  - sell 58500 CE / buy 59000 CE
  - width 500
  - entry premium 219.05
  - exit premium 224.15
  - PnL `-317`
  - entry snapshot rank 1
  - `followed_app: true`
  - ML: `p_ml=0.8988`, `ml_edge=0.311`, `ml_ood=true`, `ml_action=TAKE`, `ml_regime=CHOPPY`
- Trade 169:
  - BNF intraday `BEAR_CALL`
  - entry `14:36:19 IST`
  - exit `15:08:34 IST`
  - sell 58500 CE / buy 58900 CE
  - width 400
  - entry premium 178.55
  - PnL `-165`
  - entry snapshot rank 2
  - `followed_app: false`
  - ML: `p_ml=0.8681`, `ml_edge=0.281`, `ml_ood=true`, `ml_action=TAKE`, `ml_regime=CHOPPY`

### 14:35 IST candidate match

- Candidate 1:
  - id `BEAR_CALL_BNF_58500_59000_W500`
  - lane `BNF_intraday`
  - sellStrike 58500
  - buyStrike 59000
  - width 500
  - netPremium 219.05
  - maxProfit 6571
  - maxLoss 8429
  - premiumEdge 396
  - sigmaOTM 0.7
  - executionReady true
  - matches trade 168
- Candidate 2:
  - id `BEAR_CALL_BNF_58500_58900_W400`
  - lane `BNF_intraday`
  - sellStrike 58500
  - buyStrike 58900
  - width 400
  - netPremium 178.55
  - maxProfit 5356
  - maxLoss 6644
  - premiumEdge 306
  - sigmaOTM 0.7
  - executionReady true
  - matches trade 169

### A/B gate behavior around entry

- 14:15-14:30 IST:
  - old actor repeatedly picked `BEAR_CALL_BNF_58500_59000_W500`
  - new actor picked none
  - gate reason `ALL_NEGATIVE_EV`
- 14:35 IST:
  - old pick `BEAR_CALL_BNF_58500_59000_W500`
  - new pick `BEAR_CALL_BNF_58500_59000_W500`
  - gate reason `NONE`
  - candidate counts pre/a8/lane: `25 / 2 / 2`
- 14:40-14:55 IST:
  - old actor kept picking `BEAR_CALL_BNF_58500_59000_W500`
  - new actor picked none
  - gate reason `CALM_NF_ONLY_WAIT`
  - A8 allowed candidates, but lane gate removed BNF intraday survivors

### Issues raised

- Attribution gap:
  - `trades_v2.candidate_id` appears to be the trade row id, not the brain candidate id
  - true candidate lineage currently has to be reconstructed from `entry_snapshot` and contemporaneous snapshot/A-B rows
- UI/state gap:
  - at 14:35, top-level snapshot action was `WAIT` and confidence `0`
  - but verdict urgency was `READY`, generated_count was 2, watchlist_count was 2, and execution-ready candidates existed
  - post-close/latest-snapshot views can therefore hide a brief actionable candidate window
- Freeze implication:
  - no fix before Day-6 verdict letter
  - after freeze, candidate lineage should be explicit in trade rows:
    - brain candidate id
    - source snapshot id
    - source poll number
    - app-followed vs user-selected alternative vs manual override

### Corrected interpretation

- Do not state that Day-5 had no candidates.
- Correct statement:
  - Day-5 latest/post-close state showed zero candidates, but the 14:35 IST entry window had two generated/watchlist BNF Bear Call candidates; both paper trades were tied to those candidates.
- Both paper trades lost money, so this is not a profit claim.
- The value of this finding is attribution correctness and UI/state clarity.

## 2026-07-14 Week-1 A/B final verdict letter

### Source artifact

- User supplied:
  - `WEEK1_AB_VERDICT_LETTER_CONSOLIDATED_V2_20260714.md`
- This supersedes prior Week-1 verdict drafts.
- It is the authoritative Week-1 ruling unless amended after Antigravity recount.

### Binding verdict

- Verdict: `VACUOUS`
- Window validity: `VALID`
- Valid window:
  - Day 2: `2026-07-08`
  - Day 3: `2026-07-09`
  - Day 4: `2026-07-10`
  - Day 5: `2026-07-13`
  - Day 6: `2026-07-14`
- Day 1 / `2026-07-07` remains excluded because build actor was mixed mid-session.
- Measurement was clean, but the result is uninformative because the new arm's coverage was structurally blocked.

### Window facts accepted

- A/B rows:
  - `368 / 368`
  - gap `0`
- Snapshots:
  - `377`
- Freeze integrity:
  - held throughout
  - BUILD 3 / v2.5.0 / b331 unchanged
- Day-6 retry:
  - first eval attempt failed with `EVAL_CHAIN_TRUNCATED`
  - retry succeeded
  - 29 eval rows and 29 reco rows persisted

### Week-1 behavior accepted

- New arm:
  - `ALL_NEGATIVE_EV`: `327 / 368`
  - `CALM_NF_ONLY_WAIT`: `11 / 368`
  - gate passed / pick existed: `30 / 368`
  - `new_actor_verdict == TRADE`: `0 / 368`
- Old arm:
  - would have traded `368 / 368`

### Root-cause ruling

- A8 gate was structurally closed.
- The gate used `probProfit`, derived from the implied-volatility/risk-neutral surface.
- It demanded:
  - `expected_win >= 1.10 * expected_loss`
- Because the probability source is the market's own pricing measure, fair spreads cannot show the required positive edge under that same measure.
- Therefore the new arm did not prove "no positive-EV trades existed."
- Correct interpretation:
  - the gate used the wrong probability measure for the project's variance-risk-premium thesis.

### Loss-model ruling

- There are three inconsistent loss models:
  - A8 gate:
    - full `maxLoss`, hold-to-expiry
  - teacher_v1 and display stopLoss:
    - `0.6 * maxLoss`
  - live tracker:
    - no hard stop-loss floor
    - exits only through compound danger score
- B6 live-exit unification remains mandatory before real-money eligibility.

### S1 critical blocker

- All `ml_evaluation_outcomes`, `ml_recommendation_outcomes`, `sim_pnl_h2`, `outcome_h2`, `canonical_won`, and the Week-1 `2/130` outcome number are flagged unverified.
- Reason:
  - recorded losses may exceed structural max loss for W400/W500 BNF credit spreads
  - suspected cause is `get_price` expiry-lenient matching when candidate expiry is missing/empty
- S1 verification is now first post-freeze task and blocks all builds / CHANGE-2 / sandbox wiring.
- Local S1 plan created:
  - `S1_VERIFICATION_PLAN_20260714.txt`

### Mandatory S1 checks

- Check 1:
  - for every eval row Days 2-6, recover later net credit and assert `0 <= later_net_credit <= width`
- Check 2:
  - verify whether `ml_option_chain_snapshots` contains multiple expiries per strike in the relevant windows
- Check 3:
  - sample generated candidates and confirm whether `expiry` is populated
- Check 4:
  - recompute Day-2 H2 restricted to correct weekly expiry and compare to recorded Day-2 loss

### Semantics ruling

- `new_pick_candidate_id` means:
  - gate survivor existed
- `new_actor_verdict` means:
  - final app/system action after downstream verdict logic
- Future grading rule:
  - `new_pick_rows` grades the gate
  - `new_actor_verdict` grades the full system
  - never collapse these fields

### Additional binding findings

- `capitalBlocked` is misnamed:
  - it is not a true capital/margin affordability check
  - it behaves like a gamma filter in limited cases
  - B2 scope expands to include real margin admission with Upstox margin API and field rename / real `margin_blocked`
- `EVAL_CHAIN_TRUNCATED` is fail-slow:
  - should fail by page 1-2 with filter params logged, not after 200 pages
  - add as B1 rider
- `trades_v2` candidate lineage defect is endorsed:
  - candidate id currently stores trade row id, not brain candidate id
  - S7 rider must store brain candidate id, source snapshot id, source poll number, and selection source

### Authorized post-freeze sequence

- Track B freeze is lifted, but only in this order:
  1. S1 verification, read-only
  2. S1 fix if confirmed:
     - expiry-strict `get_price`
     - arbitrage-bound guard
     - `price_integrity` flag
     - re-score Days 2-6
  3. B1:
     - repair-logic exemption for zero-evaluable
     - real `teacher_config_version` stamping
     - pagination rider
  4. CHANGE-2:
     - A8 gate rectification
     - honest probability/expectancy measure
     - exit-policy-consistent loss model
     - friction-aware
     - fail closed on missing inputs
     - EV quantity consolidation
     - own measurement window
  5. B2:
     - live Upstox margin API
     - true capital check
     - `capitalBlocked` rename / real margin field
  6. B3:
     - `position_exit_audit`
  7. B4:
     - sandbox wiring
     - offline fill-realism study allowed with sandbox token only
  8. B5:
     - LLM shadow observer
  9. B6:
     - live-exit unification
  10. S7 rider:
      - `trades_v2` candidate lineage

### Antigravity status

- Antigravity recount remains pending.
- If Antigravity counts disagree with the verdict letter, the letter must be amended before CHANGE-2 proceeds.

### Current next action

- Do not start app code changes.
- Do not start CHANGE-2.
- Do not wire sandbox yet.
- Start S1 verification using read-only local Supabase extraction.

## 2026-07-14 — S1 Blocker Resolution Ruling and Local Implementation

### Claude ruling received

- File:
  - `RULING_S1_BLOCKER_RESOLUTION_20260714.md`
- Status:
  - S1 remained merge-blocked until the live position valuation consumer boundary was fixed.
- Key ruling:
  - The producer-side fix in `compute_position_live()` was correct but incomplete.
  - Returning `None` for zero quoted legs is only safe if the caller and `position_verdict()` also fail closed.
  - Otherwise the system can silently continue with stale `current_pnl` or default missing P&L to zero.

### Standing project law adopted

- **NO SILENT DEFAULTS ON MISSING DATA**
- Missing data must be visibly missing.
- In decision, gate, valuation, and exit paths:
  - missing values must fail closed with a stamped reason, or
  - propagate as `None` and be explicitly checked.
- `.get(x, 0)`, `.get(x, True)`, and null-as-clean are forbidden where the value affects trading decisions, valuation, exits, gates, or teacher labels.
- Missing data must never be converted into a safe-looking value.

### S1 scope reclassification

- S1 is no longer evaluator-only.
- S1 is now explicitly:
  - legacy H2 evaluator ruler repair
  - live position-valuation fail-closed fix
- It touches the live position-tracking path because `compute_position_live()` feeds `position_verdict()`.
- Future build notes and merge notes must not describe S1 as evaluator-only.

### Local implementation completed

- `brain.py`
  - `compute_position_live()` still returns `None` when required legs exist but zero legs are quoted.
  - New `_stamp_unavailable_position_valuation(...)` helper stamps the failure explicitly:
    - `current_pnl = None`
    - `valuation_quality = 'unavailable'`
    - `positionDataDegraded = True`
    - `legs_quoted = 0`
    - `position_exit_audit.reason = DATA_UNAVAILABLE`
  - The caller now invokes this helper when `compute_position_live()` returns no live mark.
  - `position_verdict()` no longer defaults missing P&L to zero.
  - If `valuation_quality == 'unavailable'` or `current_pnl is None`:
    - no danger-score math is run
    - no `BOOK` is emitted
    - no `EXIT` is emitted
    - verdict is `HOLD / DATA_UNAVAILABLE`
    - `position_exit_audit` marks both `exit_allowed = False` and `book_allowed = False`
  - If `legs_intrinsic_fallback > 0`:
    - verdict is `HOLD / DATA_DEGRADED`
    - no `BOOK` / `EXIT`
    - `position_exit_audit.reason = PARTIAL_QUOTES_INTRINSIC_FALLBACK`

### Regression tests added

- `test_d1_23b_missing_chain_data_stamps_unavailable_and_blocks_exit`
- `test_d1_23c_position_verdict_unavailable_never_defaults_pnl_to_zero`
- `test_d1_23d_partial_quote_intrinsic_fallback_blocks_book_and_exit`

### Verification completed locally

- `python -m unittest app.src.main.python.tests.test_phase_d`
  - `85 tests OK`
- `python -m unittest app.src.main.python.tests.test_teacher_v1_shadow_labels`
  - `9 tests OK`
- `python -m unittest app.src.main.python.tests.test_explanation_agent`
  - `9 tests OK`
- `python -m unittest discover app/src/main/python/tests`
  - `159 tests OK`
  - non-failing warning remains:
    - `GEMINI_API_KEY environment variable not set.`
- `python -m py_compile app/src/main/python/brain.py`
  - passed
- Android/Kotlin compile:
  - not verified in this environment because `ANDROID_HOME` is unset and no `local.properties` SDK path is present.

### Still pending

- Historical backfill DML was approved by the user and applied to production on 2026-07-14.
- Actual Supabase project ref used from decoded service-role key:
  - `fdynxkfxohbnlvayouje`
- Backfill applied through Supabase REST with service-role authorization:
  - `public.ml_evaluation_outcomes`
    - patched `12061` rows
  - `public.ml_recommendation_outcomes`
    - patched `4155` rows
- Post-backfill verification:
  - `public.ml_evaluation_outcomes price_integrity IS NULL`
    - `0`
  - `public.ml_recommendation_outcomes price_integrity IS NULL`
    - `0`
  - `public.ml_evaluation_outcomes price_integrity = LEGACY_PRE_S1`
    - `12061`
  - `public.ml_recommendation_outcomes price_integrity = LEGACY_PRE_S1`
    - `4155`
- Note:
  - Supabase Management API link failed because the old access token/project-ref pair was rejected.
  - REST route was used only for the two approved targeted backfill updates and lightweight count checks.
- `mlAction=BLOCKED` and `mlOodBlocked` remain deliberately inert.
- Wiring either ML veto is a CHANGE-class modification after clean retrain and its own measurement window.

## 2026-07-14 — S1 release prep moved to synchronized `v2.5.1 / b332`

### Release target

- Android:
  - `versionName = "2.5.1"`
  - `versionCode = 332`
- Python brain:
  - `BRAIN_VERSION = "2.5.1"`
- PWA:
  - title `Market Radar v2.5.1`
  - visible label `v2.5.1 · b332`
  - `app.js?v=1250`
  - `log-viewer.js?v=1158`

### Release scope

- S1 price-integrity repair:
  - expiry-strict H2 price lookup
  - no non-positive H2 price acceptance
  - physically bounded H2 structure valuation
  - debit structures valued as long-minus-short instead of short-minus-long
  - new H2 price-integrity fields persisted to Supabase rows
- S1 live position valuation fail-closed:
  - zero quoted required legs no longer fabricate intrinsic-only full-profit marks
  - caller stamps unavailable valuation explicitly
  - `position_verdict()` refuses BOOK/EXIT when valuation is unavailable or partially intrinsic-substituted
- Historical backfill:
  - production historical rows stamped `LEGACY_PRE_S1`
  - post-backfill null `price_integrity` count verified as zero in both outcome tables

### Local validation before commit/push

- `python -m unittest discover app/src/main/python/tests`
  - `159 tests OK`
  - non-failing warning:
    - `GEMINI_API_KEY environment variable not set.`
- `python -m py_compile app/src/main/python/brain.py`
  - passed
- `node --check app.js`
  - passed
- `git diff --check`
  - passed in `Marketapp-main-worktree`
  - passed in `MarketVivi-git`

### Remaining release checks

- Android/Kotlin compile still must be verified by GitHub Actions because local environment has no Android SDK path.
- Signed Android release should trigger from `Marketapp` push because `app/build.gradle.kts` changed.
- Push must remain synchronized across `Marketapp` and `MarketVivi`.

## 2026-07-14 — Synchronized `v2.5.1 / b332` release pushed and signed

### Push result

- `Marketapp` pushed to `main`:
  - `2d2f9d308870ba728a9db505891adc65f3f87175`
  - commit message:
    - `Release v2.5.1 S1 price integrity`
- `MarketVivi` pushed to `main`:
  - `6aa9ad776498d1e95cdb8178fe79a1c527f1b1bb`
  - commit message:
    - `Release v2.5.1 S1 web sync`

### GitHub Actions result

- `Marketapp` debug APK validation:
  - run:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29342244875`
  - conclusion:
    - `success`
- `Marketapp` signed release:
  - run:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29342244846`
  - conclusion:
    - `success`

### GitHub release result

- Release:
  - `https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.5.1`
- Latest release now points to:
  - `v2.5.1`
- Asset:
  - `app-release.apk`
  - upload state:
    - `uploaded`
  - size:
    - `63359442`

### Post-release note

- The fresh GitHub PAT used for this push should be revoked/rotated after verification, per standing credential hygiene.

## 2026-07-15 — Label regeneration POC passed; full-regeneration design prepared, execution gated

### Ruling

- Source:
  - `/tmp/codex-web-uploads/f-bGgr5D/RULING_POC_PASS_FULL_REGEN_DESIGN_20260715.md`
- Claude verdict:
  - Jul 8 POC passes.
  - Full-regeneration design phase is authorized.
  - Execution remains gated until Vivek explicitly accepts the DDL.
- Claude independently verified:
  - `28/97` OLD Jul 8 rows exceeded structural maximum possible loss.
  - `0/97` NEW Jul 8 rows violated the arbitrage bound.
  - `54/97` rows flipped from old-negative to new-positive.

### Design artifacts created outside git root

- `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/SHADOW_REGEN_DDL_PROPOSAL_20260715.sql`
- `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/FULL_LABEL_REGEN_BATCH_PLAN_20260715.txt`
- `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_FULL_REGEN_DESIGN_PACKET_20260715.txt`

### Shadow DDL proposal

- Proposed tables:
  - `public.ml_evaluation_outcomes_s1`
  - `public.ml_recommendation_outcomes_s1`
- No DDL has been executed.
- No table has been created.
- Both proposed tables include:
  - `regen_batch_id`
  - `regen_code_version`
  - source table and source row id
  - `effective_session_date`
  - `session_date`
  - `date_source`
  - old label fields
  - new S1 label fields
  - raw-data / label-window status
  - `interpretation_guardrail`
  - `audit_json`
- RLS is enabled in the same DDL proposal.
- Explicit `anon` select/insert/update policies are included.
- Delete is intentionally not granted.
- Proposed first-run writer role:
  - `anon`
- Governance note:
  - `anon` write policy matches the current app/script operating path.
  - this is interim governance, not final security.
  - a later Edge/service-role writer can tighten policies after regeneration and verification.

### Batch plan

- Proposed `regen_batch_id`:
  - `S1_FULL_REGEN_20260715_DRAFT1`
- Phase-0 inventory basis:
  - eval rows: `12,061`
  - reco rows: `4,155`
  - dates: `22`
  - snapshot rows counted: `1,631`
  - raw chain rows counted: `555,602`
- Chunking:
  - reads: 500 row pages for chain/eval/reco metadata.
  - snapshots: 5 to 10 snapshots per request when payload-heavy.
  - writes: 250 preferred; 500 maximum only if Supabase remains responsive.
- Stop immediately on:
  - `429`
  - `503`
  - `504`
  - repeated timeout
  - Supabase dashboard/API timeout pattern
- Resume:
  - by `regen_batch_id` plus source row id uniqueness.
- Estimated controlled call envelope:
  - about `1,350` to `1,550` calls depending snapshot page size.

### Mandatory carve-outs

- `2026-07-09` BULL_CALL:
  - `4` rows must be reported individually old-vs-new.
- Date provenance:
  - every row must carry `date_source`.
  - current Phase-0 CSV totals `6,177` `created_at_fallback` eval rows across `2026-06-02`, `06-03`, `06-04`, `06-05`, `06-08`, `06-09`, and `06-21`.
  - final shadow counts must report actual inferred-date rows.
- Reco split:
  - June 12 onward 100%-match dates derive from eval shadow.
  - early 0%-match dates are not silently derived.
  - first full run marks early reco rows as `REQUIRES_INDEPENDENT_RECO_REGEN` unless independent reco regeneration is separately approved.
  - `2026-06-19` reco-only asymmetry is marked `RECO_ONLY_ASYMMETRY` and kept out of trusted reco training until resolved.
- Broken coverage:
  - `2026-06-02` must be refetched or fail-closed.
  - `2026-06-21` has `665` eval rows and must be stamped `FAIL / INSUFFICIENT_RAW_DATA`, not dropped.

### Interpretation guardrail

- Regenerated H2 labels are gross hold-to-close labels.
- They are not app fills.
- They are not managed exits.
- They are not slippage-adjusted.
- They are not brokerage-adjusted.
- They are not proof of profitability.
- Menu rows are not independent trade decisions.
- Use per-decision or candidate-day aggregation for trading conclusions.

### Still gated

- Running the DDL.
- Creating shadow tables.
- Full `12,061`-row eval regeneration.
- Full `4,155`-row reco shadow handling.
- Antigravity recount.
- `p_ml` retrain.
- Replay / O3-G2.
- CHANGE-2.

### Current local state

- `Marketapp-main-worktree` remains dirty with approved-but-unreleased post-S1 patches.
- This label-regeneration design step did not modify app code.
- `MarketVivi-git/PROJECT_KNOWLEDGE.md` was updated locally only.

## 2026-07-16 — Shadow DDL ruling received; three DDL fixes applied locally

### Ruling

- Source:
  - `/tmp/codex-web-uploads/f-jUiqUn/RULING_SHADOW_DDL_BATCH_PLAN_20260715.md`
- Claude verdict:
  - DDL/batch design approved conditional on three DDL fixes.
  - Batch plan is sound as written with two added emphases.
  - Everything downstream remains gated on Antigravity recount.

### DDL fixes applied to proposal only

- File updated:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/SHADOW_REGEN_DDL_PROPOSAL_20260715.sql`
- Fix 1:
  - removed `anon` UPDATE policies.
  - shadow tables are append-only audit records.
  - `anon` gets SELECT + INSERT only.
  - corrections require a new `regen_batch_id`, not in-place mutation.
- Fix 2:
  - defaulted `interpretation_guardrail` on both shadow tables.
  - inserts cannot omit the caveat.
- Fix 3:
  - verified null source-id collision risk with exact-count Supabase REST checks.
  - `public.ml_evaluation_outcomes` `LEGACY_PRE_S1` rows: `12,061`
  - eval rows with `id IS NULL`: `0`
  - `public.ml_recommendation_outcomes` `LEGACY_PRE_S1` rows: `4,155`
  - reco rows with `id IS NULL`: `0`
  - conclusion: `source_eval_id` / `source_reco_id` can be populated for every legacy row; null-source fallback indexes should not fire for this batch.

### Batch-plan emphases added

- File updated:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/FULL_LABEL_REGEN_BATCH_PLAN_20260715.txt`
- Mandatory per-date checkpoint:
  - each date must finish local manifest + shadow rows/fail-closed rows + date reconciliation before the next date begins.
  - throttle stop loses at most one date's progress.
- Jul 8 full-run value match:
  - full batch `new_sim_pnl_h2` values for Jul 8 must equal POC values, not merely match row shape.
  - any drift is STOP-and-investigate.

### Claude packet updated

- File updated:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_FULL_REGEN_DESIGN_PACKET_20260715.txt`
- Packet now states:
  - DDL fixes applied.
  - no DDL executed.
  - no shadow table created.
  - no full regeneration started.

### Still gated

- Vivek accepts corrected DDL.
- Create shadow tables.
- Full `12,061`-row eval regeneration.
- Full `4,155`-row reco shadow handling.
- Gates 1-7.
- Antigravity recount.
- `p_ml` retrain / replay / O3-G2 / CHANGE-2.

### Self-audit

- No Supabase DDL executed.
- No Supabase writes performed.
- Only a tiny exact-count null-id check was performed.
- No app code changed in this pass.

## 2026-07-16 — Corrected shadow DDL accepted, created, and verified

### Execution

- User instruction:
  - `K proceed`
- Interpreted as Vivek accepting the corrected DDL after Claude's conditional approval.
- DDL file executed:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/SHADOW_REGEN_DDL_PROPOSAL_20260715.sql`
- Execution report:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/SHADOW_DDL_EXECUTION_REPORT_20260716.txt`
- Execution path:
  - Supabase CLI linked to project ref `fdynxkfxohbnlvayouje`.

### CLI note

- SQL returned expected result payloads.
- CLI emitted a non-SQL telemetry shutdown timeout after results:
  - `Timeout while shutting down PostHog. Some events may not have been sent.`
- Verification queries confirmed schema state, so this is recorded as telemetry noise, not a DDL failure.

### Verified production schema state

- Tables exist:
  - `public.ml_evaluation_outcomes_s1`
  - `public.ml_recommendation_outcomes_s1`
- Row counts before regeneration:
  - `public.ml_evaluation_outcomes_s1`: `0`
  - `public.ml_recommendation_outcomes_s1`: `0`
- RLS:
  - `public.ml_evaluation_outcomes_s1`: enabled
  - `public.ml_recommendation_outcomes_s1`: enabled
- Policies:
  - `anon_select_ml_eval_s1`: SELECT for `anon`
  - `anon_insert_ml_eval_s1`: INSERT for `anon`
  - `anon_select_ml_reco_s1`: SELECT for `anon`
  - `anon_insert_ml_reco_s1`: INSERT for `anon`
- No `anon` UPDATE policy exists.
- No `anon` DELETE policy exists.
- Guardrail defaults:
  - eval shadow `interpretation_guardrail` default present.
  - reco shadow `interpretation_guardrail` default present.

### Authorization state

- Completed:
  - corrected DDL accepted.
  - shadow tables created.
  - RLS verified.
  - append-only anon INSERT/SELECT policy verified.
  - tables verified empty before regeneration.
- Still gated:
  - full `12,061`-row eval regeneration.
  - full `4,155`-row reco shadow handling.
  - Gates 1-7.
  - Antigravity recount.
  - `p_ml` retrain.
  - replay / O3-G2.
  - CHANGE-2.

### Self-audit

- No legacy table rows were mutated.
- No regenerated label rows were inserted yet.
- No app code changed in this pass.
- Supabase CLI temp link files were removed from the app repo after execution.

## 2026-07-16 — Gate 8 conditional pass and closure response

### Claude ruling received

- File:
  - `/tmp/codex-web-uploads/f-gN9pus/RULING_GATE8_CONDITIONAL_PASS_20260716.md`
- Verdict:
  - `CONDITIONAL PASS`
- Claude overrode Antigravity's mechanical FAIL because both FAIL triggers were non-substantive:
  - Check 4 could not run because the Jul-8 POC CSV was missing from Antigravity's environment.
  - Check 1's 49-row delta was caused by live post-close rows written after the regeneration run, not missing regenerated rows.

### Substantive Gate 8 state

- Antigravity's substantive checks passed:
  - full scan of 8,543 OK rows had zero arbitrage-bound violations.
  - independent Python tally matched OK/FAIL counts.
  - Jul-9 `BULL_CALL` phantom case collapsed correctly.
  - RLS append-only behavior was penetration-tested by blocked anon UPDATE/DELETE attempts.
  - 06-21 fail-closed rows were retained, not dropped.
  - `created_at_fallback` rows were segregated by `effective_session_date`.
- Gate 8 is therefore considered substantively passed, subject to two closures.

### Closure 1 — Jul-8 POC file

- Required by Claude:
  - deliver `poc_2026_07_08_old_vs_new_diff.csv` to Antigravity, or formally accept Claude's previous byte verification.
- Local file found:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/label_regen_poc_20260715/2026-07-08/poc_2026_07_08_old_vs_new_diff.csv`
- File facts:
  - 98 lines total.
  - 97 data rows.
- Closure state:
  - satisfiable by handing this file to Antigravity.

### Closure 2 — go-forward drift policy

- Code inspection:
  - `brain.py` live evaluator now computes S1-correct debit/credit H2 structure valuation and emits `price_integrity`, `h2_price_integrity_reason`, bound fields, and formula.
  - `SupabaseClient.kt` first tries to persist full S1-shaped rows to canonical live tables.
  - If the full insert fails, fallback stripping logs `S1_PRICE_INTEGRITY_FALLBACK_STRIPPED`.
- 2026-07-16 live evidence:
  - post-close REST check passed:
    - snapshots: 76
    - A/B rows: 74
    - generated rows: 1,389
    - eval rows: 49
    - reco rows: 49
    - eval OK: 49
    - eval FAIL: 0
    - reco OK: 49
    - reco FAIL: 0
    - eval/reco null `price_integrity`: 0
    - all-time eval/reco null `price_integrity`: 0
- Interpretation:
  - post-b332 live labels are S1-correct when full-row persistence succeeds.
  - `_s1` shadow tables are historical repair/audit tables for the regenerated base.
  - live canonical tables are the forward source only when S1 fields are populated and no stripped fallback occurred.

### Policy recorded

- Current clean retrain:
  - use only `_s1` OK rows from `S1_FULL_REGEN_20260715_DRAFT1`.
- Future model-base extension:
  - historical repaired base: `_s1` OK rows.
  - post-b332 live base: canonical rows with `price_integrity=OK` and required S1 fields populated.
  - exclude any fallback-stripped or null-integrity session.
- Recommended hardening:
  - add explicit future fields such as `label_engine_version=S1_LIVE`, `build_version`, and `price_integrity_required=true`.

### Closure reply artifact

- Created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_GATE8_CONDITIONAL_PASS_CLOSURE_REPLY_20260716.txt`

### Authorization state

- Trusted now:
  - S1 regenerated base after Closure 1 is accepted.
- Still constrained:
  - train OK-only.
  - use decision/day split, not row-level split.
  - document 17-day base profile.
  - re-examine `EVAL_OUTCOME_WEIGHT = 4`.
  - keep `p_ml` dead-last tie-break until separately validated.

### Self-audit

- No Supabase DDL executed.
- No Supabase writes performed.
- No app code changed.
- Closure 2 answer is based on local code inspection plus 2026-07-16 REST verification.
- This does not claim trading profitability; it only defines label-trust eligibility.

## 2026-07-16 — Clean p_ml retrain directive received

### Directive

- File:
  - `/tmp/codex-web-uploads/f-GruW3I/DIRECTIVE_OC_CLEAN_PML_RETRAIN_20260716.md`
- Gate state:
  - Gate 8 closed.
  - 8,543-row OK regenerated S1 base trusted.
  - clean `p_ml` retrain unblocked.

### Hard boundaries

- Retrain only.
- No live sort-key change.
- No `p_ml` promotion.
- No `mlAction=BLOCKED` / `mlOodBlocked` wiring.
- No live build.
- No OTA.
- No training on FAIL rows.
- No live legacy row append for this retrain.
- `p_ml` remains dead-last tie-break until a separate validation authorizes promotion.

### Required training source

- Table:
  - `public.ml_evaluation_outcomes_s1`
- Predicate:
  - `new_price_integrity = OK`
- Expected rows:
  - `8,543`
- True sample:
  - `17` days.
- Required split:
  - whole-day split only, never row-level.

### Existing trainer risk

- `ml_train.py` still defines:
  - `EVAL_OUTCOME_WEIGHT = 4`
  - `RETRAIN_DISABLED_REASON = retrain_disabled_pending_canonical_won_unification`
- `ml_train.run()` returns immediately with the disabled reason.
- The old trainer path is deploy-oriented and can overwrite model files.
- Therefore this directive must use a separate local shadow retrain path, not the live app trainer entrypoint.

### Planned retrain approach

- Create/run a local-only shadow trainer after review approval.
- Proposed primary weight:
  - `EVAL_OUTCOME_WEIGHT = 1`
- Reason:
  - this retrain uses only one homogeneous S1 evaluator-backed source, so 4x weighting no longer distinguishes source trust and may over-amplify repeated same-day candidates.
- Optional:
  - run weight 4 only as sensitivity audit.

### Required proof

- The key deliverable is not raw accuracy.
- The key deliverable is debit-spread phobia removal:
  - compare old frozen poisoned model vs clean retrained model on the same `BEAR_PUT` / `BULL_CALL` candidate set.
  - report probability distribution deltas.
  - report credit spreads as control.
- If debit probabilities do not materially change, retrain is considered suspect and must stop for investigation.

### Plan artifact

- Created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLEAN_PML_RETRAIN_PLAN_20260716.txt`

### Self-audit

- No retrain executed.
- No Supabase reads/writes executed for the plan.
- No DDL executed.
- No app code changed.
- No model asset changed.

## 2026-07-17 — Clean p_ml debit-phobia diagnostic executed

### Authorization source

- File:
  - `/tmp/codex-web-uploads/f-ILdD95/RETRAIN_SPEC_CLEAN_PML_20260717.md`
- Claude status:
  - pre-registered clean `p_ml` debit-phobia diagnostic.
  - shadow-only.
  - no promotion.
  - no app asset overwrite.
  - no live path change.
  - no Supabase writes or DDL.

### Execution boundary

- Script created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/clean_pml_debit_phobia_diagnostic_20260717.py`
- Output directory:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/clean_pml_debit_phobia_20260717/`
- Production model asset unchanged:
  - `Marketapp-main-worktree/app/src/main/assets/ml_model.json`
  - SHA-256 remains `795b333049dbab16715a907d172d612f9fe4f4d6156b76ada4a2c6eee21d5dfd`
- Supabase access:
  - read-only REST.
  - local per-day cache created under `clean_pml_debit_phobia_20260717/rest_cache/`.
  - no writes.

### Result

- Verdict:
  - `STOP`
- Important distinction:
  - the diagnostic did not prove debit-phobia cured or persistent.
  - strict feature-integrity filtering removed every debit row before training.

### Eligibility evidence

- Input S1 OK rows:
  - `8,543`
- Matched in `top_candidates_json` before feature filtering:
  - `BEAR_CALL`: `1,946`
  - `BULL_PUT`: `878`
  - `BEAR_PUT`: `510`
  - `BULL_CALL`: `4`
  - total: `3,338`
- Excluded for null/defaulted `sigmaOTM`:
  - `BEAR_CALL`: `288`
  - `BULL_PUT`: `227`
  - `BEAR_PUT`: `510`
  - `BULL_CALL`: `4`
  - total: `1,029`
- Final strict eligible set:
  - `2,309` rows.
  - `14` effective days.
  - `BEAR_CALL`: `1,658`
  - `BULL_PUT`: `651`
  - `BEAR_PUT`: `0`
  - `BULL_CALL`: `0`

### Model-card outputs

- Primary weight `1`:
  - verdict `STOP`
  - `BEAR_PUT` mean `p_new`: not computable.
  - `BEAR_PUT` clamp share: not computable.
  - credit controls survived:
    - `BEAR_CALL` mean `p_new`: `0.6353`, truth WR `0.5983`.
    - `BULL_PUT` mean `p_new`: `0.5048`, surviving-subset truth WR `0.3856`.
- Sensitivity weight `4`:
  - verdict `STOP`
  - `BEAR_PUT` mean `p_new`: not computable.
  - `BEAR_CALL` mean `p_new`: `0.6333`.
  - `BULL_PUT` mean `p_new`: `0.4643`.

### Artifacts

- Claude result packet:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_CLEAN_PML_DIAGNOSTIC_RESULT_20260717.txt`
- JSON model card:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/clean_pml_debit_phobia_20260717/model_card_clean_pml_debit_phobia_20260717.json`
  - SHA-256 `378a0c127dd58ba80da82d3fa8d6e08a4b597f897b136c9029fbe1b8a6a6e14d`
- Markdown model card:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/clean_pml_debit_phobia_20260717/MODEL_CARD_CLEAN_PML_DEBIT_PHOBIA_20260717.md`
- Eligible rows:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/clean_pml_debit_phobia_20260717/eligible_rows.csv`
  - SHA-256 `fbc7faf2b49bbacca5228080199e93fe0026e64f14fed50135ae52274cfd5d02`
- OOF prediction files:
  - `oof_predictions_weight1.csv`
  - SHA-256 `69df028358fa311862a3a7f50316bdb029fe76694be538e1daf1cc7a5459a88a`
  - `oof_predictions_weight4.csv`
  - SHA-256 `1aeab1cc7c2e352e1cc5b905685485fceff800893733b3da3d610e42436493b0`

### Required next ruling

- Claude needs to decide whether:
  - this is final STOP and future capture/schema must persist debit `sigmaOTM`, or
  - the spec may be amended to permit a generation-time derivation of `sigmaOTM` from captured candidate/leg/snapshot fields, or
  - a separate debit-only feature audit should identify a valid replacement feature.

### Self-audit

- No app production model overwritten.
- No app live path changed.
- No Supabase write or DDL.
- Shadow fold models only were written.
- This result must not be promoted or consumed by the app.

## 2026-07-17 — Today storage integrity audit confirms debit feature gap

### Reason

- A read-only audit was run because repeated downstream work found missing Supabase fields after the fact.
- Focus:
  - identify whether today’s live Supabase data already contains missing fields that would break future evaluation/retrain.

### Audit artifact

- Script:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/supabase_today_storage_integrity_audit_20260717.py`
- Output directory:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/storage_integrity_audit_20260717/`
- Markdown report:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/storage_integrity_audit_20260717/SUPABASE_TODAY_STORAGE_INTEGRITY_2026-07-17.md`
- JSON report:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/storage_integrity_audit_20260717/supabase_today_storage_integrity_2026-07-17.json`

### Supabase result

- `ml_brain_snapshots` rows for `2026-07-17`:
  - `61`
- Total `top_candidates_json` candidates:
  - `76`
- Strategy mix:
  - `BEAR_PUT`: `76`
- Missing candidate fields:
  - `BEAR_PUT.sigmaOTM`: `76 / 76`
- Snapshot context:
  - top-level context fields checked were present.
  - `snapshot_latest_poll.nfDTE` and `snapshot_latest_poll.bnfDTE` were missing on all snapshots, but `context_json.nfDTE` / `context_json.bnfDTE` were present, so DTE is recoverable from context.
- Outcomes:
  - `ml_evaluation_outcomes` rows for today at audit time: `0`
  - `ml_recommendation_outcomes` rows for today at audit time: `0`
  - this is not conclusive until post-close evaluation completes.

### Interpretation

- The debit `sigmaOTM` gap is live today, not only historical.
- If this persists, future clean `p_ml` retrain/evaluation will again exclude debit rows under Claude’s no-default/no-recompute rule.
- This is a storage-contract issue in candidate persistence:
  - debit candidates are generated and persisted,
  - but their required ML feature `sigmaOTM` is null/missing in `top_candidates_json`.

### Next required fix/ruling

- Before further debit-model work:
  - either persist `sigmaOTM` for debit candidates at generation time, or
  - obtain Claude/OpenClaw authorization for a strictly entry-time derivation/replacement feature.
- No app code fix has been made under this audit.
- No Supabase writes or DDL were performed.

## 2026-07-17 — Local unpushed patch after freeze: debit sigmaOTM storage fix

### Context

- The 6-day freeze ended with local app changes intentionally not pushed during the watch period.
- Before pushing, the unpushed app delta was listed and separated from the new storage-contract correction.
- Baseline app repo HEAD before this local patch:
  - `Marketapp-main-worktree/main`
  - `2d2f9d308870ba728a9db505891adc65f3f87175`
- Baseline knowledge repo HEAD:
  - `MarketVivi-git/main`
  - `3bf4409cb6119df1e2cff6f772de6d00596445`

### Existing unpushed freeze-era app changes

- `EvaluationLocalCache.kt`
  - increased per-session local snapshot cache cap from `5 MB` to `64 MB`.
  - reason: full-day brain snapshots carry large chain/context evidence; premature trim can falsely make post-close evaluation incomplete.
- `MarketMLService.kt`
  - normalized legacy coverage states:
    - `CLEAN` -> `COMPLETE`
    - `PARTIAL_COVERAGE` -> `PARTIAL`
- `MarketWatchService.kt`
  - poll count now uses slot ordinal from current poll slot key where available.
  - added dispatch de-duplication by last dispatched slot key.
  - session integrity now counts distinct slot ordinals from poll history.
  - introduced `COUNTER_DRIFT` handling and coverage states `COMPLETE`, `PARTIAL`, `COMPLETE_WITH_RETRIES`.
- `NativeBridge.kt`
  - aligned coverage-state vocabulary with `MarketWatchService`.
  - promotion eligibility now requires `coverageIntegrity == COMPLETE`.
  - added distinct-slot derivation from poll history to avoid false `POLL_OVERRUN` when raw counter drifts.
- `brain.py`
  - added session-date-aware freshness filtering for dated history rows.
  - stale FII/VIX history is ignored instead of being reused across old sessions.
  - addresses observed stale FII Short% trend display such as `81.0 -> 92.0` when `81.0` came from many days earlier.
- `test_phase_b.py`
  - added stale-history regression tests for FII Short%, VIX direction, and FII trend.

### New correction made on 2026-07-17

- Root cause:
  - `_build_candidate(...)` computed `sigmaOTM` only for credit directional candidates:
    - `BEAR_CALL`
    - `BULL_PUT`
  - debit candidates:
    - `BEAR_PUT`
    - `BULL_CALL`
  - therefore persisted `sigmaOTM = None`, which caused clean `p_ml` retrain to exclude all debit rows under the no-default/no-recompute rule.
- Fix:
  - debit spreads now persist `sigmaOTM` at generation time using long/buy-strike distance from spot:
    - `round(abs(pair['buy'] - spot) / daily_sigma, 2)`
  - this is storage/instrumentation only.
  - no debit sigma gate was added.
  - no ranking behavior was intentionally changed.
  - existing credit sigma gate remains unchanged.
- Files changed by this correction:
  - `app/src/main/python/brain.py`
  - `app/src/main/python/tests/test_phase_d.py`

### Verification

- Focused tests run locally:
  - `python3 app/src/main/python/tests/test_phase_d.py`
    - result: `86/86` passed.
  - `python3 app/src/main/python/tests/test_phase_b.py`
    - result: `50/50` passed.
- New regression coverage:
  - `test_d1_12e_debit_candidate_uses_buy_ask_and_sell_bid` now asserts debit `sigmaOTM` is not null.
  - `test_d1_12e2_debit_bear_put_persists_sigma_otm` verifies `BEAR_PUT` persists positive `sigmaOTM`.

### Current local push package status

- App repo currently has unpushed local modifications in 7 files:
  - `app/build.gradle.kts`
  - `app/src/main/java/com/marketradar/app/EvaluationLocalCache.kt`
  - `app/src/main/java/com/marketradar/app/MarketMLService.kt`
  - `app/src/main/java/com/marketradar/app/MarketWatchService.kt`
  - `app/src/main/java/com/marketradar/app/NativeBridge.kt`
  - `app/src/main/python/brain.py`
  - `app/src/main/python/tests/test_phase_b.py`
  - `app/src/main/python/tests/test_phase_d.py`
- App release version prepared:
  - Android `versionCode = 333`
  - Android `versionName = "2.5.2"`
  - Python `BRAIN_VERSION = "2.5.2"`
  - release note comment: `b333: post-freeze integrity/cache fixes and debit sigmaOTM storage repair`
- Web repo release sync prepared:
  - title `Market Radar v2.5.2`
  - visible label `v2.5.2 · b333`
  - `app.js` cache-buster `1250 -> 1251`
- App diff stat after release prep:
  - `8 files changed`
- Knowledge repo has unpushed `PROJECT_KNOWLEDGE.md` and `index.html` updates.
- No git push has been performed yet.
- No Supabase writes or DDL were performed by this code correction.

## 2026-07-17 — Synchronized `v2.5.2 / b333` release pushed and signed

### Push result

- `Marketapp` pushed to `main`:
  - commit `09920166ecb0268e6aa2c7a3a96173f2e6c7fee3`
  - message: `Release v2.5.2 post-freeze integrity fixes`
  - remote update: `2d2f9d3..0992016`
- `MarketVivi` pushed to `main`:
  - commit `0bbc48a70366c57f04c6c96440885dedb63506a5`
  - message: `Release v2.5.2 web sync and project knowledge`
  - remote update: `3bf4409..0bbc48a`

### Release artifacts and workflows

- `Marketapp` debug validation:
  - workflow: `Market Radar Debug APK Validation`
  - run: `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29570426881`
  - conclusion: `success`
- `Marketapp` signed release:
  - workflow: `Market Radar Signed Release`
  - run: `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29570426875`
  - conclusion: `success`
- GitHub release:
  - tag: `v2.5.2`
  - URL: `https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.5.2`
  - published: `2026-07-17T09:37:32Z`
- `MarketVivi` Pages deployment:
  - run: `https://github.com/vivekashokan007-cloud/MarketVivi/actions/runs/29570427241`
  - conclusion: `success`

### Verification before push

- `python3 app/src/main/python/tests/test_phase_d.py`
  - `86/86` passed.
- `python3 app/src/main/python/tests/test_phase_b.py`
  - `50/50` passed.

### Notes

- This release carries:
  - local cache cap increase to preserve full-day replay evidence,
  - poll-slot and coverage-integrity counter drift handling,
  - stale FII/VIX history filtering,
  - debit `sigmaOTM` persistence for clean `p_ml` retrain eligibility,
  - synchronized version labels `v2.5.2 / b333`.
- GitHub Actions emitted a non-blocking Node.js 20 deprecation annotation from third-party actions; workflow conclusion remained `success`.
- The PAT used for this push should be revoked/rotated after verification per credential hygiene.

## 2026-07-17 — Shadow `debitBreakevenSigma` backfill artifact generated locally

### Claude-authorized shadow diagnostic executed

- Directive used:
  - `/tmp/codex-web-uploads/f-A4XoWY/DIRECTIVE_OC_DEBIT_BREAKEVEN_SIGMA_BACKFILL_20260717.md`
- New local-only script created:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/debit_breakeven_sigma_backfill_20260717.py`
- This script is shadow-only:
  - no app live-path change,
  - no asset overwrite,
  - no Supabase writes,
  - no DDL,
  - imports `brain.py::_daily_sigma` directly.

### What the script does

- Loads cached `ml_evaluation_outcomes_s1 OK` + matched `ml_brain_snapshots`.
- Builds a debit-only backfill feature:
  - `debitBreakevenSigma = |breakeven - spot| / _daily_sigma(spot, vix)`
- Uses:
  - `BEAR_PUT`: `breakeven = buyStrike - netPremium`
  - `BULL_CALL`: `breakeven = buyStrike + netPremium`
- Reads entry-time context from stored snapshot `context_json`.
- Keeps credit rows unchanged in the 38-feature path.
- Appends a 39th shadow-only debit feature to the local diagnostic vector:
  - `debit_be_sigma_norm`

### Artifacts written

- Output directory:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/debit_breakeven_sigma_backfill_20260717`
- Files:
  - `debit_backfill_v1.csv`
  - `eligible_rows_with_debit_be_v1.csv`
  - `oof_debit_v1.csv`
  - `model_card_debit_breakeven_sigma_v1.json`
  - `MODEL_CARD_DEBIT_BREAKEVEN_SIGMA_V1.md`

### Realized result

- Matched debit scope found:
  - `514` rows total
  - `510` `BEAR_PUT`
  - `4` `BULL_CALL`
- Out-of-scope unmatched debit rows:
  - `54`
- Strict unit-identity gate outcome:
  - `402` debit rows passed
  - `112` matched debit rows failed `units_identity_failed`
- Current backfill rule is strict and fail-closed:
  - rows pass only when stored cost identity is accepted,
  - failed rows are excluded from the rerun.

### Important integrity finding

- The remaining blocker is not the formula.
- The formula matches Claude’s worked examples exactly, including:
  - `BEAR_PUT_NF_23150_23300_W150`
  - `BEAR_PUT_NF_23200_23300_W100`
- The unresolved issue is stored debit unit identity:
  - many failed rows have `estCost == maxLoss`,
  - but `netPremium * lotSize` differs from the stored integer by exactly `±0.5`,
  - therefore the strict identity gate excludes them.
- This means the shadow rerun is currently based on the recoverable debit subset, not the full `514`.

### Shadow rerun result on recoverable subset

- Eligible matched rows after backfill:
  - `2711`
- Strategy counts:
  - `BEAR_CALL = 1658`
  - `BULL_PUT = 651`
  - `BEAR_PUT = 398`
  - `BULL_CALL = 4`
- Shadow verdict from the generated model card:
  - `PASS`
- Key debit result:
  - `BEAR_PUT mean P_new = 0.3518560376884422`
  - `BEAR_PUT truth WR = 0.3391959798994975`
  - clamp share `< 0.10 = 0.007537688442211055`
- Ordering also passed:
  - `BEAR_PUT mean P_new < BEAR_CALL mean P_new`
  - `BEAR_PUT mean P_new < BULL_PUT mean P_new`
- BULL_CALL remains:
  - insufficient data, no cure claim.

### Hashes

- `debit_backfill_v1.csv`
  - `606559d4772af3ecf35bfd6e19d48ec06ffad947ac53e8f3b74fbd7d0e93a52a`
- `eligible_rows_with_debit_be_v1.csv`
  - `46d731b3418b83381875d07d121dbecd7bd89b31af9e56cfd8c57704a05a74cd`
- `oof_debit_v1.csv`
  - `5790fc3a3270e4f72bed157791ef8224ff82e43e104824b1e8471cb184c752c7`

### Interpretation

- The new shadow feature appears to cure debit phobia on the recoverable subset.
- However, the result is not yet clean enough to claim full matched-set completion because:
  - `112 / 514` matched debit rows still fail the strict stored-unit audit.
- This is a data-contract / rounding-identity issue that should be reviewed before any further Claude gate claim is treated as final.

## 2026-07-17 — Confirmatory shadow rerun passed on full matched set

### Claude confirmatory directive executed

- Directive used:
  - `/tmp/codex-web-uploads/f-3tEhim/DIRECTIVE_OC_DEBIT_DIAGNOSTIC_CONFIRM_20260717.md`
- This was still shadow-only:
  - no live-path change,
  - no app asset overwrite,
  - no Supabase writes,
  - no DDL,
  - no push.

### Confirmatory changes required by Claude

- Debit unit identity was widened from strict rounded equality to a tolerance audit:
  - accept when `abs(netPremium * lotSize - estCost) <= 1`
  - and `abs(estCost - maxLoss) <= 1`
- Early credit `sigmaOTM` gaps were backfilled for shadow training rows only using the same brain formula:
  - `sigmaOTM = |sellStrike - spot| / _daily_sigma(spot, vix)`
- The debit feature itself did **not** change:
  - `debitBreakevenSigma = |breakeven - spot| / _daily_sigma(spot, vix)`

### New / regenerated artifacts

- Output directory:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/debit_breakeven_sigma_backfill_20260717`
- Files now include:
  - `debit_backfill_v1.csv`
  - `credit_sigma_backfill_v1.csv`
  - `eligible_rows_with_debit_be_v1.csv`
  - `oof_debit_v1.csv`
  - `model_card_debit_breakeven_sigma_v1.json`
  - `MODEL_CARD_DEBIT_BREAKEVEN_SIGMA_V1.md`

### Confirmatory full-set result

- Debit backfill audit:
  - `matched_scope_rows = 514`
  - `ok_rows = 514`
  - `excluded_by_reason = {}`
  - `unmatched_out_of_scope = 54`
- Credit sigma shadow backfill:
  - `rows = 2824`
  - `live_rows = 2309`
  - `backfilled_rows = 515`
  - `excluded_by_reason = {}`
- Eligible matched rows in the confirmatory rerun:
  - `3338`
- Strategy counts:
  - `BEAR_CALL = 1946`
  - `BEAR_PUT = 510`
  - `BULL_PUT = 878`
  - `BULL_CALL = 4`

### Confirmatory verdict

- Final shadow verdict:
  - `PASS`
- BEAR_PUT result:
  - `mean P_new = 0.38757636470588236`
  - `truth WR = 0.34509803921568627`
  - clamp share `< 0.10 = 0.0`
- Global checks:
  - `calibration_to_truth = true`
  - `correct_ordering = true`
  - `overcorrection = false`
  - `phobia_persists = false`
- This is the first confirmatory rerun that passed on the **full matched debit set**, not only a recoverable subset.

### Strategy-level shadow calibration snapshot

- `BEAR_CALL`
  - `mean_p_new = 0.5973991793422404`
  - `truth = 0.5837615621788284`
- `BEAR_PUT`
  - `mean_p_new = 0.38757636470588236`
  - `truth = 0.34509803921568627`
- `BULL_PUT`
  - `mean_p_new = 0.5270542676537585`
  - `truth = 0.5056947608200456`
- `BULL_CALL`
  - `mean_p_new = 0.232902`
  - `truth = 0.0`
  - still insufficient data; no cure claim.

### Additional notes from the confirmatory model card

- Highest BEAR_PUT concentration days in the matched sample:
  - `2026-06-05 = 96`
  - `2026-06-24 = 94`
  - `2026-07-08 = 87`
  - `2026-06-04 = 62`
- Debit-absent days in the sampled window:
  - `2026-06-02`
  - `2026-06-22`
  - `2026-06-29`
  - `2026-07-01`
  - `2026-07-03`
  - `2026-07-07`
  - `2026-07-09`
  - `2026-07-13`

### Hashes from confirmatory rerun

- `debit_backfill_v1.csv`
  - `a988c73ea720148136642e95633db4831869df6e8371f6851d1313659acafca4`
- `credit_sigma_backfill_v1.csv`
  - `9f0b43ed2c7d6d449e2fc11ddae7e1701823472e2769625de8c7b7882ec09580`
- `eligible_rows_with_debit_be_v1.csv`
  - `2034a5bab8dff1717f4558e36b7c7027bb3d7e78bd61f9d327d041008551d9de`
- `oof_debit_v1.csv`
  - `e9b97ecb3e7ede31dd866c6b5d861a03dc559d73d910838d563eabf083c776f3`

### Interpretation

- Claude’s confirmatory widening resolved the earlier debit unit-identity blocker.
- The shadow rerun now supports the stronger statement:
  - the debit breakeven sigma feature cures the prior debit-phobia signal on the full matched debit sample under the approved confirmatory audit.
- This remains a shadow research result only.
- No production ranking, training, or live decision path has been changed from this confirmatory rerun.

## 2026-07-18 - Position Tracking P1 Capture-Only Implementation Started

### Claude directive accepted

- Directive file:
  - `DIRECTIVE_OC_POSITION_P1_CAPTURE_20260718.md`
- Scope:
  - Implement P1 capture-only position tick loop.
  - Additive telemetry only.
  - Do not change brain ranking, teacher labels, `position_verdict`, alerts, notifications, or 5-minute scan outputs.

### Locked P1 policy constants

- `SL = 0.60 * max_loss`
- `TP = 0.50 * max_profit`
- `EOD = 15:15 IST`
- Canonical mark basis:
  - executable-side mark
- Cadence:
  - 60 seconds with +/- 5 seconds jitter.
- These are shadow-only policy labels.
- P1 must not auto-close any trade.

### Local implementation status

- Android repo:
  - `Marketapp-main-worktree`
- Web repo:
  - `MarketVivi-git`
- New Android files:
  - `app/src/main/java/com/marketradar/app/PositionPolicyV1.kt`
  - `app/src/main/java/com/marketradar/app/PositionTickService.kt`
  - `supabase/migrations/20260718_position_ticks_p1.sql`
- Android modified files:
  - `app/src/main/AndroidManifest.xml`
  - `app/src/main/java/com/marketradar/app/MarketWatchService.kt`
  - `app/src/main/java/com/marketradar/app/NativeBridge.kt`
  - `app/src/main/java/com/marketradar/app/SupabaseClient.kt`
- Web modified file:
  - `app.js`

### P1 behavior implemented locally

- `PositionTickService` is a separate Android foreground data-sync service.
- It starts only when local `open_trades` exists and the current IST time is within 09:15-15:30.
- It self-stops if:
  - market session is inactive, or
  - no open trades are present.
- It uses a separate 60-second loop and does not alter the existing 5-minute market scan output.
- It reads open trades from local app state first to avoid additional Supabase reads.
- It fetches open-position leg quotes from Upstox using:
  - `GET /v2/market-quote/quotes?instrument_key=<comma-joined keys>`
- It does not infer missing instrument keys.
- Missing instrument key is stored as `KEY_MISSING`.
- Quote auth source is recorded:
  - `ANALYTICS` if a future analytics token flag/token is present and succeeds.
  - fallback to `DAILY`.
  - `NONE` when no token is available.

### P1 mark calculation implemented locally

- Per leg stores:
  - `instrument_key`
  - `side`
  - `option_type`
  - `strike`
  - `bid`
  - `ask`
  - `ltp`
  - `mid`
  - `executable_price`
  - `price_basis`
  - `quote_status`
- Executable side:
  - short legs: buy-to-close at ask.
  - long legs: sell-to-close at bid.
- Position marks:
  - `executable_mark`
  - `mid_mark`
  - `ltp_mark`
- Valuation quality:
  - `OK` only when every required leg has bid and ask.
  - `DEGRADED` when any required leg/key/depth is missing but some quote exists.
  - `UNAVAILABLE` when no leg has usable quote data.
- P&L is computed only from executable mark.
- `current_pnl` is null when valuation is degraded or unavailable.
- `running_mae` and `running_mfe` are tracked locally per trade id.

### P1 shadow policy labels implemented locally

- `SHADOW_SL`
  - `current_pnl <= -0.60 * max_loss`
- `SHADOW_TP`
  - `current_pnl >= 0.50 * max_profit`
- `SHADOW_EOD`
  - tick at or after 15:15 IST
- `SHADOW_DEGRADED`
  - valuation quality degraded or unavailable.
- `HOLD`
  - no shadow exit rule matched.
- Policy inputs are stored in `policy_trace_json`.

### Supabase additive schema prepared

- Migration creates:
  - `public.position_ticks`
- `position_ticks` includes:
  - `trade_id`
  - `session_date`
  - `tick_ts`
  - `source`
  - `auth_source`
  - `index_key`
  - `strategy_type`
  - `status`
  - `leg_count`
  - `valuation_quality`
  - `mark_basis`
  - `executable_mark`
  - `mid_mark`
  - `ltp_mark`
  - `current_pnl`
  - `current_pnl_r`
  - `running_mae`
  - `running_mfe`
  - `policy_action`
  - `policy_reason`
  - `policy_trace_json`
  - `legs_json`
  - `created_at`
- RLS posture follows existing shadow-table style:
  - anon/authenticated insert.
- No anon/authenticated select, update, or delete policy is created for `position_ticks`.
- RLS hardening remains a backlog item consistent with prior RLS Step 2-8 direction.

### Close trace handling

- `MarketVivi-git/app.js` now adds an additive `close_trace_json` summary when manually closing a trade.
- The manual close verdict/P&L path is unchanged.
- `DB.updateTrade` now retries without `close_trace_json` if Supabase rejects the additive column, so manual close is not blocked if the migration has not yet been applied.

### Verification status

- `git diff --check` passed in `Marketapp-main-worktree`.
- `brain.py` was not modified.
- Critical Python functions remain untouched:
  - `evaluate_alerts`
  - `compute_position_live`
  - `position_verdict`
  - `_managed_teacher_outcome`
- Android build attempt:
  - command: `ANDROID_HOME=/opt/android-sdk ./gradlew assembleDebug`
  - result: failed before Kotlin compilation at `:app:processDebugResources`.
  - failure cause: local AAPT2 daemon startup failure while transforming AndroidX resources.
  - interpretation: local environment/toolchain failure, not an application compile result.

### Current push status

- P1 capture-only implementation was pushed on 2026-07-18.
- Android repo:
  - `d2beffd2b31fdecd2c2e2f947dd590f8be9a1ae4`
  - version `2.5.4`, build `335`
- Web repo:
  - `5e8279f64c1e4b0fd9df230889eabfe850303888`
- Signed release workflow completed successfully:
  - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29639675946`
- Supabase migration was not applied by Codex during the push.

### Release bump for P1 push

- Android APK version bumped for P1 delivery:
  - `versionCode: 334 -> 335`
  - `versionName: 2.5.3 -> 2.5.4`
- `brain.py` `BRAIN_VERSION` remains `2.5.3` because P1 deliberately does not modify brain logic.

## 2026-07-19 - P1 Blocker Fix: position_ticks DDL and bounded queue

### Directive source

- `DIRECTIVE_OC_P1_BLOCKER_FIX_20260718.md`
- Claude finding:
  - P1 capture could not persist because `public.position_ticks` did not exist in Supabase.
  - On repeated insert failure, the Android pending tick queue could grow without a hard cap.

### Approved boundary

- Do not modify `brain.py`.
- Do not modify ranking, teacher labels, alerts, scan outputs, or P1 policy behavior.
- Do not alter `trades_v2`.
- Add only the `position_ticks` storage table and queue safety instrumentation.

### Local Android changes prepared

- Android version bumped for blocker-fix delivery:
  - `versionCode: 335 -> 336`
  - `versionName: 2.5.4 -> 2.5.5`
- `PositionTickService` now enforces:
  - `MAX_PENDING_TICKS = 1500`
  - oldest-row drop when the persisted pending queue exceeds the cap
  - persisted dropped-row counter: `position_tick_dropped_count`
  - persisted consecutive flush failure counter: `position_tick_flush_failure_count`
  - warning logs:
    - `POSITION_TICK_QUEUE_DROP`
    - `POSITION_TICK_FLUSH_FAIL`
- Successful flush clears the pending queue and resets consecutive failure count to zero.
- Failed flush keeps the bounded queue and increments consecutive failure count.

### Kotlin JSON to DDL reconciliation

- `PositionTickService` writes top-level JSON keys:
  - `trade_id`
  - `session_date`
  - `tick_ts`
  - `source`
  - `auth_source`
  - `index_key`
  - `strategy_type`
  - `status`
  - `leg_count`
  - `valuation_quality`
  - `mark_basis`
  - `executable_mark`
  - `mid_mark`
  - `ltp_mark`
  - `current_pnl`
  - `current_pnl_r`
  - `running_mae`
  - `running_mfe`
  - `policy_action`
  - `policy_reason`
  - `policy_trace_json`
  - `legs_json`
- `position_ticks` DDL includes every emitted top-level key.
- DDL also includes DB-owned:
  - `id`
  - `created_at`
- Leg-level details remain nested under `legs_json`; they are not separate table columns.

### Supabase DDL state

- Migration file now creates only `public.position_ticks`.
- Migration no longer alters `public.trades_v2`.
- RLS is enabled.
- Exact write policy:
  - policy name: `position_ticks_insert_anon`
  - command: `INSERT`
  - roles: `anon`, `authenticated`
  - `with check (true)`
- Migration explicitly drops any legacy/open:
  - `position_ticks_select_anon`
  - `position_ticks_update_anon`
  - `position_ticks_delete_anon`
- Codex attempted to apply the DDL through Supabase Management API.
- Supabase API response:
  - HTTP `403`
  - error code `1010`
- Result:
  - DDL must be run manually in Supabase SQL editor unless direct DB credentials or an alternate authorized API path is provided.
- Manual SQL handoff file:
  - `/tmp/position_ticks_p1_blocker_fix_20260719.sql`

## 2026-07-19 - G2 Friction Into Live Paper P&L Started

### Directive source

- `DIRECTIVE_OC_FRICTION_LIVE_PNL_20260718-1.md`
- Claude finding:
  - paper closes were cost-blind / gross-vs-net ambiguous.
  - teacher already computes managed outcomes net of brokerage/statutory/slippage friction.
  - live paper close must preserve gross labels and add honest net fields separately.

### Critical current-state correction

- Existing `MarketVivi/app.js` paper close path was writing net-if-closed-now into:
  - `trades_v2.actual_pnl`
  - `trades_v2.canonical_won`
  - `trades_v2.outcome_h2`
  - `ml_decisions.actual_pnl`
  - `ml_decisions.canonical_won`
- That violated the G2 directive because `actual_pnl` / `canonical_won` must remain gross semantics until a separate label switch gate.
- Local G2 fix changes paper close semantics to:
  - `actual_pnl = gross current_pnl`
  - `canonical_won = actual_pnl > 0`
  - `outcome_h2 = gross canonical_won`
  - `net_pnl = gross current_pnl - friction_cost`
  - `net_won = net_pnl > 0`

### Additive schema prepared

- New migration:
  - `Marketapp-main-worktree/supabase/migrations/20260719_g2_live_pnl_friction.sql`
- Adds to `public.trades_v2` only:
  - `friction_cost numeric`
  - `friction_breakdown_json jsonb`
  - `net_pnl numeric`
  - `net_won boolean`
  - `friction_version text`
- Adds advisory indexes:
  - `trades_v2_friction_version_idx`
  - `trades_v2_net_won_idx`
- Manual SQL handoff file:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/g2_live_pnl_friction_schema_20260719.txt`

### Live close friction implementation status

- `MarketVivi/app.js` now writes the additive G2 fields on every paper close.
- The UI close confirmation still shows:
  - gross MTM
  - estimated round-trip cost
  - net if closed now
- The close notification now states gross closed, net closed, and estimated friction cost.
- `DB.updateTrade()` fallback was widened:
  - if Supabase rejects additive G2 columns, it retries without the additive close fields so manual close is not blocked.
- This fallback is safety only; the schema must still be applied for G2 data collection.

### Friction basis limitation

- PWA cannot currently read `position_ticks` under the P1 insert-only RLS policy.
- Therefore manual close friction records:
  - `slippage_basis = FALLBACK`
  - reason: P1 bid/ask close tick not readable from PWA under insert-only RLS
- This is intentionally explicit; the app does not pretend to use live P1 bid/ask half-spread when unavailable.
- Future refinement:
  - expose latest local P1 tick through NativeBridge, or
  - add a tightly scoped server-side close-friction function that reads latest `position_ticks` with service-role authority.

### Release target

- Synchronized release was pushed:
  - Android `versionName = 2.5.6`
  - Android `versionCode = 337`
  - PWA visible label `v2.5.6 · b337`
  - PWA app cache-bust `app.js?v=1252`
- `brain.py` remains untouched; teacher behavior is unchanged by construction.

### Push and CI confirmation

- `Marketapp` pushed to `main`:
  - commit `6f881d87ee70e7da6530fb6c8265c985bb6ad4aa`
  - message `Add G2 friction schema`
- `MarketVivi` pushed to `main`:
  - commit `5adc11d45c262682e65daf9c08531cdd3a75f385`
  - message `Add gross-preserving paper close friction`
- GitHub Actions:
  - Signed release succeeded:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29673504269`
  - Debug validation succeeded:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29673504244`

### Supabase schema application confirmation

- User ran the G2 friction schema SQL manually in Supabase SQL editor on 2026-07-19.
- Screenshot `Screenshot_20260719_101111_Chrome.jpg` showed:
  - `Success. No rows returned`
- Therefore the following `public.trades_v2` additive columns are now expected to exist in Supabase:
  - `friction_cost`
  - `friction_breakdown_json`
  - `net_pnl`
  - `net_won`
  - `friction_version`
- Advisory indexes are also expected to exist:
  - `trades_v2_friction_version_idx`
  - `trades_v2_net_won_idx`

### Tomorrow check

- After installing/running `v2.5.6 / b337`, close a paper trade only if it is part of the normal test plan.
- Verify `trades_v2` close rows preserve:
  - gross `actual_pnl`
  - gross `canonical_won`
  - additive `net_pnl`
  - additive `net_won`
  - `friction_version = G2_v1`
- P1 `position_ticks` remains expected to collect only when there is an open tracked trade during market hours.

## 2026-07-19 - Claude Reply: G2 Before G1 Sandbox

### Directive source

- `CLAUDE_REPLY_TO_OPENCLAW_20260719.md`
- Claude ruling:
  - P1 blockers are considered fixed/verified.
  - G1 sandbox order layer is valid work but must wait behind G2.
  - G2 is not complete until code and backfill are implemented, not only the Supabase schema.
  - G2 must reuse the teacher cost model and must not duplicate the brokerage/statutory/slippage formula in JavaScript.
  - Teacher outputs must remain unchanged; gross labels stay gross and net labels are additive only.
  - Historical backfill must use `friction_version='G2_charges_only_backfill'` and `slippage_basis='UNKNOWN_HISTORICAL'`.
  - Historical slippage must not be estimated.
  - Rows without close evidence must be skipped and reported.

### G1 sandbox state

- User manually ran the `sandbox_orders` DDL in Supabase SQL editor.
- Screenshot `Screenshot_20260719_113210_Chrome.jpg` showed:
  - `Success. No rows returned`
- Therefore `public.sandbox_orders` is expected to exist in Supabase.
- Local G1 app changes were deliberately parked before G2 completion:
  - Android stash: `wip-g1-sandbox-order-layer-20260719`
  - PWA stash: `wip-g1-pwa-version-knowledge-20260719`
- G1 is not pushed and not on main yet.
- G1 must be re-applied only after G2 is committed/pushed, and then must receive the next synchronized version bump.

### G2 implementation now in local files

- Android:
  - Added native bridge method `computeLiveFriction(tradeJson)` in `NativeBridge.kt`.
  - Exposed `NativeBridge.computeLiveFriction()` to PWA JavaScript in `MainActivity.kt`.
  - Added additive Python adapter functions in `brain.py`:
    - `_trade_to_teacher_candidate`
    - `_trade_leg_entry_prices`
    - `_teacher_snap_from_trade_entry`
    - `_teacher_point_from_trade_close`
    - `compute_live_friction`
    - `compute_live_friction_bridge`
  - The adapter calls existing `_teacher_round_trip_cost`.
  - `_teacher_round_trip_cost` itself was not edited.
  - The adapter now fails closed if explicit lot size is missing; it does not silently use default BNF/NF lot sizes.
  - Added operator tool:
    - `tools/g2_charges_backfill.py`
- PWA:
  - Removed the duplicated JavaScript cost estimator from `app.js`.
  - `estimateTeacherRoundTripCostBreakdown()` now calls the native Python bridge.
  - Paper close continues to preserve:
    - gross `actual_pnl`
    - gross `canonical_won`
    - gross `outcome_h2`
  - Paper close writes additive fields:
    - `friction_cost`
    - `friction_breakdown_json`
    - `net_pnl`
    - `net_won`
    - `friction_version`
  - Paper close stores `close_leg_quotes` and the friction breakdown inside `exit_snapshot` for audit.
  - Paper UI now shows `unavailable` if native friction cannot be computed; it no longer coerces missing cost to zero.

### Backfill tool design

- `tools/g2_charges_backfill.py` is dry-run by default.
- Requires:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - optional `SUPABASE_URL` (defaults to the project URL)
- Supports:
  - `--apply`
  - `--session-date YYYY-MM-DD`
  - `--page-size`
  - `--max-rows`
  - `--sleep`
- Supabase throttling controls:
  - small page default: 50 rows
  - default sleep: 0.20 seconds per REST request
  - no bulk expensive SQL
- Evidence order for close-leg prices:
  - `trades_v2.exit_snapshot.close_leg_quotes`
  - latest matching `position_ticks.legs_json`
- Skip rules:
  - skip rows with null `exit_premium`
  - skip rows without per-leg close quotes
  - skip rows where teacher adapter returns no `friction_cost`
- Backfill writes only additive G2 fields:
  - `friction_cost`
  - `friction_breakdown_json`
  - `net_pnl`
  - `net_won`
  - `friction_version='G2_charges_only_backfill'`

### Version target

- Current local synchronized target:
  - Android `versionName = 2.5.7`
  - Android `versionCode = 338`
  - PWA visible label `v2.5.7 · b338`
  - PWA cache-bust `app.js?v=1253`
- This is not pushed yet.

### Verification

- Passed:
  - `python3 -m py_compile app/src/main/python/brain.py tools/g2_charges_backfill.py`
  - `node --check app.js`
  - `git diff --check` in both repos
  - `PYTHONPATH=app/src/main/python python3 -m unittest discover -s app/src/main/python/tests -p 'test_teacher*.py'`
    - 9 tests passed
  - direct Python bridge smoke test:
    - `compute_live_friction()` returned finite `friction_cost`
    - live basis: `LIVE_BID_ASK`
  - charges-only smoke test:
    - `friction_version = G2_charges_only_backfill`
    - `slippage_basis = UNKNOWN_HISTORICAL`
    - `breakdown.slippage = 0.0`
  - fail-closed smoke test:
    - missing explicit lot size returns `MISSING_LOT_SIZE_OR_LEGS`
  - backfill without credentials refuses to run:
    - `Missing SUPABASE_SERVICE_ROLE_KEY; refusing to run.`
- Blocked:
  - `./gradlew :app:compileDebugKotlin`
  - reason: local Android SDK path is not configured:
    - missing `ANDROID_HOME`
    - missing `local.properties` `sdk.dir`

### Important caveat

- Exact historical G2 backfill depends on per-leg close quotes.
- `position_ticks.legs_json` can provide these for trades that had P1 ticks captured.
- If a historical closed paper row has only aggregate `exit_premium` and no per-leg close quote evidence, the backfill must skip it rather than reconstruct a spread or turnover from insufficient data.

## 2026-07-19 - Sandbox order layer G1 re-applied after G2 local commit

### Directive source

- User provided Claude directive:
  - `/tmp/codex-web-uploads/f-foPIMa/DIRECTIVE_OC_SANDBOX_ORDER_LAYER_20260718-1.md`
- Directive stage:
  - Implement
- Scope:
  - Build first Upstox sandbox order payload/execution plumbing.
  - Sandbox validates payloads only.
  - Do not treat sandbox as evidence of fills, pricing, slippage, charges, or edge.

### Hard boundaries preserved

- `brain.py` must remain untouched.
- No verdict/notification auto-trigger is allowed.
- Order calls must be explicit dev/debug action only.
- Sandbox host only:
  - permitted base URL: `https://sandbox.upstox.com`
- Live order hosts are forbidden in the order path:
  - `api-hft.upstox.com`
  - `api.upstox.com/v2/order`
  - `api.upstox.com/v3/order`

### Official-doc confirmation

- Upstox sandbox documentation confirms:
  - sandbox is for API integration/payload testing without live risk
  - sandbox tokens are valid for sandbox order execution and cannot be used for live transactions
  - sandbox currently has no market-time restriction
- Upstox order documentation confirms relevant order payload fields:
  - `instrument_token`
  - `quantity`
  - `product`
  - `validity`
  - `price`
  - `tag`
  - `order_type`
  - `transaction_type`
  - `disclosed_quantity`
  - `trigger_price`
  - `is_amo`
  - `slice`
  - multi-order additionally uses `correlation_id`
- Upstox multi-order documentation states BUY orders are processed before SELL orders.

### Local implementation status

- Android repo has local unpushed G1 changes on top of local G2 commit `fdbeff9`.
- New Kotlin order layer:
  - `app/src/main/java/com/marketradar/app/OrderExecutionService.kt`
- Compile-time mode:
  - `EXECUTION_MODE = "SANDBOX"`
- Sandbox token preference name:
  - `SANDBOX_TOKEN`
- Runtime guard:
  - rejects dispatch unless mode and base URL are sandbox.
- Supported debug actions:
  - `build`
  - `place_sequential`
  - `place_multi`
  - `modify`
  - `cancel`
- The order builder validates before dispatch:
  - legs exist
  - instrument key/token exists
  - BUY/SELL side exists
  - lot size exists from payload/instrument metadata
  - quantity is positive and lot-size multiple
  - LIMIT price exists from explicit price or BUY ask / SELL bid quote
- Leg sequencing:
  - BUY legs are ordered before SELL legs for sequential dispatch.
- Persistence:
  - every sandbox request/response attempts insert into `sandbox_orders`.
  - failed network calls and bad token responses are also persisted where possible.

### Native bridge status

- `NativeBridge` now exposes:
  - `setSandboxToken(token)`
  - `getSandboxTokenReady()`
  - `runSandboxOrderDebugAction(payloadJson)`
- `MainActivity` exposes those bridge methods to WebView JavaScript.
- Sandbox readiness now depends on:
  - sandbox toggle enabled
  - dedicated `SANDBOX_TOKEN` present
- Normal daily/live token no longer makes sandbox readiness appear true.

### Supabase schema

- Android migration added:
  - `Marketapp-main-worktree/supabase/migrations/20260719_sandbox_orders.sql`
- Manual copy-paste SQL text file created for user:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/sandbox_orders_schema_20260719.txt`
- Table:
  - `public.sandbox_orders`
- Columns:
  - `id`
  - `ts`
  - `trade_ref`
  - `api`
  - `api_version`
  - `request_json`
  - `response_json`
  - `http_status`
  - `latency_ms`
  - `order_ids`
  - `error_code`
  - `error_message`
- RLS:
  - enabled
  - anon insert allowed
  - anon select allowed for export/verification

### Safety test

- Added unit test:
  - `app/src/test/java/com/marketradar/app/OrderExecutionSafetyTest.kt`
- Test verifies:
  - `OrderExecutionService.EXECUTION_MODE == "SANDBOX"`
  - order-layer source does not contain live Upstox order host/path strings.

### Version preparation

- Android prepared version:
  - `versionName = 2.5.8`
  - `versionCode = 339`
- PWA visible version synchronized locally:
  - title/header `v2.5.8 · b339`
  - cache-bust `app.js?v=1254`

### Verification status

- `git diff --check` passed in Android repo.
- `git diff --check` passed in MarketVivi repo.
- Live Upstox order host/path grep against order path returned no matches.
- Local Gradle unit test did not run because this workspace has no Android SDK configured:
  - missing `ANDROID_HOME`
  - missing `local.properties` `sdk.dir`
- This is an environment blocker, not a test failure.
- Build validation still needs Antigravity/GitHub Actions before device install.

### Not yet done

- Supabase `sandbox_orders` schema was manually applied by user before G1 re-apply.
- Sandbox token still needs to be generated/stored before real sandbox calls.
- Full Claude test matrix not yet run:
  - valid BULL_PUT / BEAR_CALL sequential and multi
  - valid BEAR_PUT debit pair
  - bad instrument key
  - bad/expired token
  - absurd price / zero quantity / wrong lot multiple
  - modify then cancel
  - off-market-hours call
- No `sandbox_orders` export/sha exists yet because matrix execution has not happened.

## 2026-07-19 - Claude G2 backfill, guard enforcement, and P1 tick diagnosis

### Directive source

- User provided Claude directive:
  - `/tmp/codex-web-uploads/f-eb9VB0/DIRECTIVE_OC_G2_BACKFILL_AND_GUARD_20260719.md`
- Directive scope:
  - Execute G2 charges-only backfill on closed paper `trades_v2`.
  - Make order safety guard enforce in CI.
  - Diagnose empty `position_ticks`.
  - Defer `BRAIN_VERSION` alignment to the next version bump; no `brain.py` behavior change.

### G2 backfill execution

- Backfill target:
  - `trades_v2` rows where `paper=true` and `status='CLOSED'`.
- Rows processed:
  - 167
- Supabase write mode:
  - apply
- Rows stamped:
  - 167 rows stamped with `friction_version='G2_charges_only_backfill'`.
- Historical slippage handling:
  - no slippage estimation was performed.
  - failure payloads stamp `slippage_basis='UNKNOWN_HISTORICAL'`.
- Additive-only rule preserved:
  - `actual_pnl` unchanged.
  - `canonical_won` unchanged.
  - post-backfill mismatch count against pre-snapshot: 0.

### G2 backfill result

- Computable charges-net rows:
  - 0 / 167
- Reason distribution:
  - `MISSING_CLOSE_LEG_QUOTES`: 143
  - `NULL_EXIT_PREMIUM`: 24
- Gross headline over all 167 rows:
  - gross win rate: 58.0838%
  - gross average P&L: 2278.25
  - gross total P&L: 380468.0
- 2026-07-19 quarantine note:
  - this gross headline is now retained only as a raw pre-provenance artifact.
  - it is not an accepted live performance or edge claim.
  - final replacement requires P&L engine classification and honest baseline filtering.
- Charges-net headline:
  - not computable from historical rows because no row had sufficient close-leg evidence.
- Important interpretation:
  - This is an evidence-completeness finding, not a G2 formula failure.
  - Reconstructing charges from aggregate `exit_premium` would violate Claude's boundary because per-leg close quote/turnover evidence is missing.

### G2 artifacts

- Android repo report artifacts:
  - `reports/g2_pre_backfill_labels_20260719.csv`
  - `reports/g2_backfill_results_20260719.csv`
  - `reports/g2_backfill_summary_20260719.json`
  - `reports/g2_post_backfill_labels_20260719.csv`
  - `reports/g2_post_backfill_verify_20260719.json`
- Hashes:
  - pre labels: `a64d13abd8ea2b232c90b95d3ed243e46e096ad479d4324c0bdf6b7a5aeb3597`
  - backfill CSV: `4b3d41bba13b32407e09e2eadd5899733daf761e8d7c763b1bfea6c0fcf93695`
  - summary JSON: `13e3db7af017828b05cbac433950a08f2f1724fc3f7a728106f371480f30f8cf`
  - post labels: `8431246afddfa6517606fc111f22568c72c3fe239b1b3d1f34525138fbf4c148`
  - post verify JSON: `accb7a9148ab4613925e7b961d1c6f254f35059be3c4ab726a415b20080c9a66`

### Local code/report changes

- `tools/g2_charges_backfill.py`
  - now exports per-trade CSV.
  - now writes summary JSON.
  - now fail-closes non-computable rows with explicit reason strings.
  - now reports all-row gross metrics separately from computable charges-net metrics.
- `app/src/test/java/com/marketradar/app/OrderExecutionSafetyTest.kt`
  - source lookup now supports both module working directory and repo-root working directory.
  - missing source file fails loudly with the working directory in the error message.
- `.github/workflows/debug-apk.yml`
  - added `./gradlew :app:testDebugUnitTest --stacktrace` before `assembleDebug`.
- `.github/workflows/release.yml`
  - added `./gradlew :app:testDebugUnitTest --stacktrace` before `assembleRelease`.

### Verification status

- `python3 -m py_compile tools/g2_charges_backfill.py app/src/main/python/brain.py` passed.
- `git diff --check` passed.
- Gradle dry-run confirms `:app:testDebugUnitTest` is in the task graph.
- Full local `:app:testDebugUnitTest` cannot run in this container:
  - host architecture: `aarch64`
  - installed AAPT2 binary: x86-64
  - direct AAPT2 execution fails with `cannot execute: required file not found`
  - Gradle fails at `:app:processDebugResources` with AAPT2 daemon startup failure before unit tests execute.
- Negative live-host proof is therefore not available locally.
- Expected next validation point:
  - GitHub Actions on x86 Ubuntu after push should execute the newly wired unit test before any APK build.

### P1 position tick diagnosis

- Supabase `position_ticks` remains empty.
- Latest DB evidence showed:
  - `position_ticks` row count: 0
  - `trades_v2` OPEN count: 0
  - latest trades were CLOSED historical/paper rows
  - no OPEN trade was observed after P1 capture deployment in the checked window.
- Code inspection of `PositionTickService.kt` showed current observability gap:
  - logs exist for `POSITION_TICK_FLUSH_FAIL`
  - logs exist for `POSITION_TICK_QUEUE_DROP`
  - no explicit lifecycle start/stop log was found.
  - no explicit "no open trades" log was found.
- Interpretation:
  - Empty `position_ticks` is most likely benign until an OPEN trade exists after P1.
  - However, current logging cannot fully distinguish "service ran and had no work" from "service did not start" without DB/open-trade evidence.
- Issue to raise:
  - Add lightweight lifecycle/no-open diagnostics to `PositionTickService` in a future Claude-approved patch if Claude wants stronger evidence.

### Not pushed yet

- These changes are local until user explicitly commands push.
- No version bump was done in this checkpoint.
- `BRAIN_VERSION` was not changed because Claude directed that it should align only with the next version bump.

## 2026-07-19 - Lot-size directive verification and P&L engine quarantine prep

### Directive source

- User provided Claude directive:
  - `/tmp/codex-web-uploads/f-Kz348P/DIRECTIVE_OC_LOTSIZE_AND_PNL_QUARANTINE_20260719.md`
- Directive requested:
  - verify lot sizes before changing constants;
  - quarantine historical fixed-multiplier P&L;
  - recompute honest baseline using only trusted P&L engine rows;
  - retract the prior live claim of `58.1% win rate / +₹2,278 avg`.

### Critical lot-size finding

- Claude's directive asserted:
  - NIFTY lot size should be 75.
  - BANKNIFTY lot size should be 35.
- Current app constants are:
  - `NF_LOT = 65`
  - `BNF_LOT = 30`
- Authoritative source checked:
  - Upstox complete instruments master: `https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz`
  - HTTP `Last-Modified`: `Sat, 18 Jul 2026 23:55:35 GMT`
  - checked on 2026-07-19.
- Verification method:
  - parsed current NSE_FO option contracts expiring within 90 days from 2026-07-19;
  - filtered instrument names `NIFTY` and `BANKNIFTY`;
  - inspected `lot_size`.
- Result:
  - NIFTY active option rows checked: 1334; all reported `lot_size = 65`.
  - BANKNIFTY active option rows checked: 970; all reported `lot_size = 30`.
  - sample NIFTY row: `NIFTY 21600 CE 21 JUL 26`, `NSE_FO|57240`, `lot_size=65`.
  - sample BANKNIFTY row: `BANKNIFTY 46000 CE 28 JUL 26`, `NSE_FO|61584`, `lot_size=30`.
- Decision:
  - Do not change lot-size constants to 75/35.
  - Do not bump version for Task 1 because no live lot-size behavior change was made.
  - Raise this to Claude as a directive/source conflict before changing production scaling.
- Evidence artifact:
  - Android repo: `reports/lot_size_verification_20260719.json`
  - sha256: `44307e5289eaa855029b111113ffd7c423d1fdf4abb58be3461e002b01df7cd8`

### P&L quarantine local work

- Added local additive-only migration:
  - `supabase/migrations/20260719_pnl_engine_quarantine.sql`
- Migration columns:
  - `pnl_engine text`
  - `structure_incomplete boolean`
  - `pnl_engine_reason text`
  - `implied_multiplier numeric`
  - `pnl_engine_classified_at timestamptz`
- Migration indexes:
  - `trades_v2_pnl_engine_idx`
  - `trades_v2_structure_incomplete_idx`
- Added local classifier:
  - `tools/pnl_engine_quarantine.py`
- Classifier behavior:
  - dry-run by default;
  - requires `--apply` before writing;
  - requires `SUPABASE_SERVICE_ROLE_KEY` in environment;
  - fetches closed paper `trades_v2`;
  - computes implied multiplier as `actual_pnl / ((entry_premium - exit_premium) * lots)`;
  - classifies legacy matches as `V0_FIXED_MULTIPLIER_UNTRUSTED`;
  - classifies non-legacy multiplier evidence as `V1_PER_LEG`;
  - leaves missing/invalid evidence as `UNKNOWN`;
  - flags incomplete 4-leg structures for `IRON_CONDOR` and `IRON_BUTTERFLY`;
  - never modifies `actual_pnl`, `canonical_won`, `entry_premium`, `exit_premium`, or labels.

### Current quarantine status

- Migration and script are local only.
- They have not been applied to Supabase yet in this checkpoint.
- The local shell does not have `SUPABASE_SERVICE_ROLE_KEY` set.
- Do not paste service keys into visible terminal commands; use environment injection or user-side SQL runner if execution is needed.
- Pending outputs after DB apply:
  - `reports/pnl_engine_classification_20260719.csv`
  - `reports/pnl_engine_classification_summary_20260719.json`
  - sha256 for both files.

### Retraction status

- The earlier G2 gross headline `58.1% win rate / +₹2,278 avg` is now quarantined as a raw pre-provenance figure, not an accepted live performance claim.
- It must not be used as a live edge claim.
- Final replacement requires Task 2 classification and Task 3 honest baseline.
- Required note for final docs after baseline:
  - `Pre-June P&L used a fixed-multiplier engine on incompletely recorded structures and is quarantined as untrusted; April accounted for 100.2% of previously reported profit.`

### Verification status

- `python3 -m py_compile tools/pnl_engine_quarantine.py tools/g2_charges_backfill.py app/src/main/python/brain.py` passed.
- `git diff --check` passed in Android repo.
- No code path, ranking logic, lot-size constant, P&L value, label, or app version was changed in response to the disputed lot-size claim.

## 2026-07-19 - REV2 quarantine correction and close-path investigation

### Directive source

- User provided Claude REV2 directive:
  - `/tmp/codex-web-uploads/f-r7IGPF/DIRECTIVE_OC_REV2_QUARANTINE_CORRECTED_20260719.md`
- REV2 supersedes:
  - `/tmp/codex-web-uploads/f-Kz348P/DIRECTIVE_OC_LOTSIZE_AND_PNL_QUARANTINE_20260719.md`

### REV2 ruling

- Claude withdrew Rev 1 Task 1 in full.
- Correct current lot sizes are:
  - `NF = 65`
  - `BNF = 30`
- Existing constants are correct and must not be changed.
- Claude also withdrew the multiplier-threshold classifier because exact 30/65 reconciliation is normal correct lot arithmetic, not evidence of a fabricated fixed-multiplier engine.
- New classification criterion is structural completeness plus reconciliation.

### Task A close-path investigation

- `MarketVivi/app.js` is the paper close persistence path.
- Close function:
  - `closeTrade(tradeId, exitReason)` starts at `MarketVivi/app.js:2855`.
- `actual_pnl` source:
  - `grossClosePnl = Number(trade.current_pnl ?? 0) || 0` at `MarketVivi/app.js:2863`.
  - `actual_pnl: grossClosePnl` at `MarketVivi/app.js:2897`.
  - `canonical_won` and `outcome_h2` are derived from `grossClosePnl` at `MarketVivi/app.js:2890-2899`.
  - ML outcome writeback also uses `actual_pnl: grossClosePnl` at `MarketVivi/app.js:3002-3009`.
- `exit_premium` source:
  - `exit_premium: trade.current_premium ?? null` at `MarketVivi/app.js:2905`.
  - close trace repeats the same value at `MarketVivi/app.js:2932`.
  - exit snapshot stores `premium: trade.current_premium ?? null` at `MarketVivi/app.js:2966`.
- `current_pnl` / `current_premium` source:
  - Python computes position live marks in `compute_position_live(...)`.
  - fallback lot sizes are correctly documented as BNF=30 / NF=65 at `Marketapp-main-worktree/app/src/main/python/brain.py:3280-3299`.
  - for credit trades, `pnl = (entry_premium - current_net) * lot_size` at `brain.py:3417-3418`.
  - for debit trades, `pnl = (current_net - entry_premium) * lot_size` at `brain.py:3419-3420`.
  - Python returns `current_pnl` and `current_net_premium` at `brain.py:3482` and `brain.py:3498`.
  - Android copies those into open trades as `current_pnl` and `current_premium` at `MarketWatchService.kt:2461-2463`.
- Interpretation:
  - In current code, `actual_pnl` is the authoritative realized gross close label because labels, `canonical_won`, `outcome_h2`, and ML writeback derive from it.
  - `exit_premium` is an auxiliary/audit premium mark copied from `current_premium`.
  - If both fields came from the same `position_live` update and the trade is a credit spread, they should reconcile through `(entry_premium - exit_premium) * lots * lot_size` within rounding.
  - Therefore June+ decoupling is not expected by the current source path; likely causes are stale/missing/semantic drift in `current_premium`, changed close timing, or historical schema/field drift.
  - Code alone does not prove the DB rows are correct; row-level DB inspection is still needed before declaring June+ rows trustworthy or defective.

### REV2 classifier update

- Updated local migration:
  - `supabase/migrations/20260719_pnl_engine_quarantine.sql`
- Migration now adds:
  - `pnl_engine`
  - `structure_incomplete`
  - `pnl_reconciles`
  - `pnl_engine_reason`
  - `implied_multiplier`
  - `recon_error`
  - `pnl_engine_classified_at`
- Updated local classifier:
  - `tools/pnl_engine_quarantine.py`
- Current classifier rule:
  - `UNTRUSTED_INCOMPLETE_STRUCTURE` for `IRON_CONDOR` / `IRON_BUTTERFLY` rows missing `buy_strike2` or `sell_strike2`.
  - `RECONCILED` for complete rows where `abs(actual_pnl - ((entry_premium - exit_premium) * lots * lot_size)) <= 5`.
  - `UNRECONCILED_PENDING_TASK_A` for complete rows that do not reconcile.
  - `UNKNOWN` where premiums, lots, index, or P&L evidence is missing.
- Audit fields:
  - `implied_multiplier` retained for audit only.
  - `recon_error` retained for row-level verification.
- Baseline output:
  - `honest_baseline_reconciled_only_gross_of_costs`
  - `honest_baseline_reconciled_plus_pending_task_a_gross_of_costs`
- Caveats:
  - gross of costs because G2 established historical charges-net is uncomputable;
  - no lot-size scaling caveat because 65/30 is verified correct;
  - no tuning/subset hunting.

### Current execution status

- Migration and classifier are local only.
- Supabase classification has not been applied yet in this checkpoint.
- Local shell does not have `SUPABASE_SERVICE_ROLE_KEY` set.
- Do not paste the service-role key into visible commands or files.

### Verification

- `python3 -m py_compile tools/pnl_engine_quarantine.py tools/g2_charges_backfill.py app/src/main/python/brain.py` passed.
- `git diff --check` passed in Android repo.
- `git diff --check` passed in MarketVivi repo.
- Current hashes:
  - migration: `c730d0b0d8991e4e1fe953e5cf7111102607f1d613dc3dc2c7207bc1ac7ae5b1`
  - classifier: `eb86cc7d72f67da9be0711d8a0643fb6e865134e3f458bc66ae8ab9c177a2c84`
  - lot-size evidence: `44307e5289eaa855029b111113ffd7c423d1fdf4abb58be3461e002b01df7cd8`

### Pending

- Apply additive Supabase migration.
- Run classifier dry-run first, then apply if dry-run counts match expectation.
- Export:
  - `reports/pnl_engine_classification_20260719.csv`
  - `reports/pnl_engine_classification_summary_20260719.json`
- Report whether expected incomplete count is exactly 55.
- Use Task C baselines to replace the quarantined old gross headline.
- Task E per-instrument lot-size lookup is accepted but separate after A-D.

## 2026-07-20 - REV2 amendment sign fix and close-path null-default directive

### Directive sources

- User provided Claude amendment:
  - `/tmp/codex-web-uploads/f-y6aiA8/AMENDMENT_REV2_SIGN_FIX_AND_AUTHORIZATION_20260719.md`
- User provided separate close-path directive:
  - `/tmp/codex-web-uploads/f-ZdzLqF/DIRECTIVE_OC_CLOSE_PATH_NULL_DEFAULT_20260719.md`

### Amendment accepted

- Claude accepted the Task A source-path investigation.
- Claude corrected the reconciliation formula for debit spreads.
- Correct formula:
  - credit strategies: `(entry_premium - exit_premium) * lots * lot_size`
  - debit strategies (`BEAR_PUT`, `BULL_CALL`): `-1 * (entry_premium - exit_premium) * lots * lot_size`
- Reason:
  - `brain.py` computes debit P&L as `(current_net - entry_premium) * lot_size`, opposite sign from credit.
- Local classifier updated:
  - `tools/pnl_engine_quarantine.py`
  - debit strategies now use `recon_sign = -1`.
  - credit strategies use `recon_sign = +1`.
  - CSV now includes `recon_sign`.

### Apply gate added

- Classifier now computes gate before any Supabase write.
- Default expected gates:
  - `structure_incomplete = 55`
  - `RECONCILED ~= 114`
  - reconciled tolerance: `3`
- If `--apply` is requested and the gate fails:
  - script exits before patching rows.
  - no Supabase rows are written.
- This protects against accidental mass misclassification.

### Current execution status

- Supabase run not executed yet.
- Local shell still has no `SUPABASE_SERVICE_ROLE_KEY`.
- Service-role key must not be pasted into shell commands or files.
- Pending safe run sequence remains:
  - apply migration;
  - dry-run classifier;
  - stop if gate fails;
  - apply classifier only if gate passes.

### Close-path null-default directive

- Claude identified live MarketVivi defect:
  - `app.js` close path silently coerces missing `current_pnl` to `0`.
  - this can write fake `actual_pnl=0`, `canonical_won=false`, `outcome_h2=0`.
  - exit reason can also become fake `Stop loss` when `current_pnl` is null.
- Claude boundary:
  - MarketVivi-only.
  - separate commit.
  - do not bundle with quarantine run.
  - do after quarantine work.
- Status:
  - not implemented yet in this checkpoint because amendment explicitly says close-path work is separate and after the quarantine run.
  - must be treated as high-priority next live fix once quarantine DB run is completed or explicitly waived.

### Verification

- `python3 -m py_compile tools/pnl_engine_quarantine.py tools/g2_charges_backfill.py app/src/main/python/brain.py` passed.
- `git diff --check` passed in Android repo.
- Current hashes:
  - classifier: `d40da71ba7c7456b4a76d1b7a275cb0265b0643430e88abf1307de5cc45c2f11`
  - migration: `c730d0b0d8991e4e1fe953e5cf7111102607f1d613dc3dc2c7207bc1ac7ae5b1`

## 2026-07-20 - REV2 quarantine dry-run completed, apply gate failed

### Execution boundary

- Ran local read-only dry-run only.
- No Supabase writes were performed.
- Additive migration was not applied by this run.
- `SUPABASE_SERVICE_ROLE_KEY` is still not present in local shell.
- Classifier was patched to allow anon read-only dry-run, while `--apply` still requires service role.
- Throttling used:
  - page size: `25`
  - sleep: `0.35s`

### Local classifier corrections

- `tools/pnl_engine_quarantine.py` now treats structural incompleteness first.
- This matches Claude REV2 rule:
  - structural completeness first;
  - then signed premium/P&L reconciliation.
- Before the correction, gate counted `55` incomplete rows but only `54` were classified as `UNTRUSTED_INCOMPLETE_STRUCTURE`.
- After correction, both gate and class summary agree:
  - `UNTRUSTED_INCOMPLETE_STRUCTURE = 55`
- CSV export now includes:
  - `entry_day`
  - `pnl_engine_reason`
  - `canonical_won`
  - `followed_app`
  - `recon_sign`

### Dry-run result

- Command:
  - `python3 tools/pnl_engine_quarantine.py --page-size 25 --sleep 0.35`
- Rows classified:
  - `167`
- Credential mode:
  - `anon_dry_run`
- Result:
  - read-only execution passed;
  - apply gate failed.

### Apply gate

- Expected:
  - `structure_incomplete = 55`
  - `RECONCILED ~= 114`
  - tolerance `3`
- Actual:
  - `structure_incomplete = 55`
  - `RECONCILED = 60`
- Gate status:
  - `incomplete_pass = true`
  - `reconciled_pass = false`
  - `pass = false`

### Classification summary

- `RECONCILED`
  - rows: `60`
  - win rate: `53.3333%`
  - avg gross P&L: `1335.05`
  - total gross P&L: `80103.0`
  - date range: `2026-03-30` to `2026-06-17`
- `UNTRUSTED_INCOMPLETE_STRUCTURE`
  - rows: `55`
  - win rate: `94.5455%`
  - avg gross P&L: `5803.49`
  - total gross P&L: `319192.0`
  - reason: `FOUR_LEG_STRUCTURE_MISSING_STRIKE2`
  - split: `IRON_BUTTERFLY 23`, `IRON_CONDOR 32`
- `UNRECONCILED_PENDING_TASK_A`
  - rows: `29`
  - win rate: `44.8276%`
  - avg gross P&L: `-251.31`
  - total gross P&L: `-7288.0`
  - reason: `ACTUAL_PNL_DOES_NOT_RECONCILE_WITH_STORED_PREMIUMS`
- `UNKNOWN`
  - rows: `23`
  - win rate: `0.0%`
  - avg gross P&L: `-501.70`
  - total gross P&L: `-11539.0`
  - reason: `MISSING_ENTRY_OR_EXIT_PREMIUM`

### Current artifact hashes

- `tools/pnl_engine_quarantine.py`
  - `47eac7001780cebcdb75befd8ea996627fb9b8a95d7e0b59c89571154f5b24aa`
- `supabase/migrations/20260719_pnl_engine_quarantine.sql`
  - `c730d0b0d8991e4e1fe953e5cf7111102607f1d613dc3dc2c7207bc1ac7ae5b1`
- `reports/pnl_engine_classification_20260719.csv`
  - `48fe85716302a6795eeec484eb3aaa5c26d5762e744d3d9fef36ee7201403345`
- `reports/pnl_engine_classification_summary_20260719.json`
  - `bb947f65ad9e349c7626fa17ae9a79cb5f5161602e0949d742d9190f15d5b058`

### Claude handoff file

- Created outside git:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_REV2_QUARANTINE_DRY_RUN_20260720.txt`

### Decision state

- Do not run `--apply` yet.
- Do not promote old gross P&L headline.
- The clean currently proven gross baseline is `RECONCILED` only:
  - `60` rows, total gross P&L `80103.0`, win rate `53.3333%`.
- `RECONCILED + UNRECONCILED_PENDING_TASK_A` gives `89` rows, total gross P&L `72815.0`, win rate `50.5618%`, but cannot be promoted until Task A provenance is explained.
- Need Claude ruling before DB apply:
  - revise expected reconciled gate from `114` to `60`;
  - or investigate the missing `54` expected reconciliations;
  - or apply structural quarantine only;
  - or proceed to close-path null-default fix first.

## 2026-07-20 - Claude god-mode audit checked, neutral rename implemented locally

### Input reviewed

- `/tmp/codex-web-uploads/f-x9V0wN/GOD_MODE_AUDIT_RECONCILIATION_20260720.md`
- `/tmp/codex-web-uploads/f-fFG7bu/CLAUDE_REPLY_TO_OPENCLAW_20260720.md`

### What was accepted

- Claude's original `RECONCILED ~= 114` gate was wrong.
- The 114 count double-counted structurally incomplete rows.
- Structural-first classification removes those rows before reconciliation.
- Revised gate is accepted:
  - `UNTRUSTED_INCOMPLETE_STRUCTURE = 55`
  - `RECONCILED = 60`
  - `PNL_BASIS_DIVERGENT = 29`
  - `UNKNOWN = 23`
  - total `167`

### What remains inferred

- Claude's claim that the 29 divergent rows are likely the most execution-realistic P&L is plausible but not fully proven.
- It remains an inference until Task A traces the trade-entry write path and proves which basis enters `trades_v2.entry_premium`.
- Source path verified so far:
  - `brain.py` live P&L uses `entry_premium` and `current_net`.
  - `MarketWatchService.kt` copies `current_pnl` and `current_net_premium` from the same `position_live` object.
  - `MarketVivi/app.js` close path writes `actual_pnl` from `current_pnl` and `exit_premium` from `current_premium`.
  - If stored entry, stored exit, lot size, and actual P&L do not reconcile, entry-basis provenance is the open degree of freedom.

### Local implementation

- `tools/pnl_engine_quarantine.py` updated locally:
  - `UNRECONCILED_PENDING_TASK_A` renamed to `PNL_BASIS_DIVERGENT`.
  - reason renamed to `ENTRY_BASIS_MISMATCH_EXECUTABLE_VS_STORED`.
  - default gate changed to `55 / 60 / 29 / 23`.
  - summary keys now explicitly caveat:
    - reconciled mid-priced baseline excludes spread and charges;
    - reconciled plus basis-divergent baseline excludes charges.
- No Supabase writes were performed.
- `--apply` was not run.

### Verification

- `python3 -m py_compile tools/pnl_engine_quarantine.py` passed.
- Dry-run command:
  - `python3 tools/pnl_engine_quarantine.py --page-size 25 --sleep 0.35`
- Dry-run result:
  - rows: `167`
  - credential mode: `anon_dry_run`
  - `UNTRUSTED_INCOMPLETE_STRUCTURE = 55`
  - `RECONCILED = 60`
  - `PNL_BASIS_DIVERGENT = 29`
  - `UNKNOWN = 23`
  - `apply_gate.pass = true`

### Artifact hashes

- `tools/pnl_engine_quarantine.py`
  - `231cd433fb82ec8e112715ed6ba45b25b9d3265f3867257d11d77c9a2229ac9d`
- `reports/pnl_engine_classification_20260719.csv`
  - `f84667baa8bd31aba8aa84a1e2d0f791ad7620e5402e8d9ae498f999955c5b13`
- `reports/pnl_engine_classification_summary_20260719.json`
  - `9a72e68048583ae2359665d47748cc6f115ff59e14bd4b76ac5b77fb0249600a`

### Claude handoff file

- Created outside git:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_GODMODE_AUDIT_CHECK_20260720.txt`

### Next state

- DB apply is now locally gate-pass after rename, but still requires safe service-role credentials.
- Do not paste service-role keys into shell history or files.
- If applying:
  - first apply additive migration;
  - then run classifier with service role and `--apply`;
  - preserve Supabase throttling;
  - export post-apply CSV, summary JSON, and hashes.
- Continue to present all baselines with caveats:
  - `RECONCILED` is mid-priced/reconciled sample, not current performance.
  - `PNL_BASIS_DIVERGENT` is neutral basis-divergent evidence, not automatically broken and not fully verified as execution-realistic until Task A completes.
  - `UNTRUSTED_INCOMPLETE_STRUCTURE` remains quarantined.
  - `UNKNOWN` remains degraded/missing-exit-premium evidence.

## 2026-07-20 - Live crash/recovery root cause: ML brain snapshot bridge OOM

### Trigger

- User reported the app was crashing and recovering during the live session.
- Log reviewed:
  - `/tmp/codex-web-uploads/f-L66kud/marketapp-logs-2026-07-20T04-59-28-292Z.csv`

### Finding

- The crash is not in strategy selection/ranking.
- It is an Android heap OOM in the UI bridge:
  - `NativeBridge.getMLBrainSnapshots(NativeBridge.kt:2346)`
  - `java.lang.OutOfMemoryError`
  - failed allocation around `46 MB`
  - heap max `256 MB`
- Repeated OOMs were visible around:
  - `10:25`
  - `10:28`
  - `10:29`
- WebView then recovered and restored the polling service:
  - `Restored active service: 15 polls restored`

### Root Cause

- `MarketVivi/app.js` requests `NativeBridge.getMLBrainSnapshots(200)`.
- The native bridge previously called `EvaluationLocalCache.readBrainSnapshots(...)`, which materializes the full local day snapshot cache.
- Local snapshot cache is intentionally large for post-close evaluation replay:
  - `MAX_ROWS_PER_SESSION = 90`
  - `MAX_BYTES_PER_SESSION = 64 MB`
- That full evidence cache is too large to serialize through WebView for the ML tab on a 256 MB heap.

### Local Fix

- Android repo local files changed:
  - `app/src/main/java/com/marketradar/app/EvaluationLocalCache.kt`
  - `app/src/main/java/com/marketradar/app/NativeBridge.kt`
- Added `EvaluationLocalCache.readRecentBrainSnapshots(...)`:
  - streams the JSONL cache;
  - keeps only bounded recent rows;
  - does not materialize the full day cache for the UI bridge;
  - returns newest-first for ML diagnostics.
- Changed `NativeBridge.getMLBrainSnapshots(...)`:
  - caps JS bridge rows to `30`;
  - caps recent-read byte budget to `8 MB`;
  - compacts each snapshot with `compactTeacherResearchSnapshot(...)` before returning to WebView.
- PWA mitigation added:
  - `MarketVivi/app.js` now requests `NativeBridge.getMLBrainSnapshots(30)` instead of `200`.
  - This reduces the crash trigger for devices still running the old native bridge after the web cache updates.
- Synchronized crash-fix release prep done locally:
  - Android `versionName = "2.5.9"`
  - Android `versionCode = 340`
  - PWA title/visible label `v2.5.9 / b340`
  - PWA cache-bust `app.js?v=1255`

### Scope Guard

- Post-close evaluation path is unchanged:
  - `MarketMLService` still uses `readBrainSnapshots(...)` for full replay evidence.
- Ranking, strategy generation, Supabase schema, and P&L logic are unchanged.
- This is a stability/memory guard only.

### Verification

- `git diff --check` passed in Android repo.
- `git diff --check` passed in PWA repo.
- `./gradlew :app:compileDebugKotlin --no-daemon` could not run because the local workspace has no Android SDK configured:
  - missing `ANDROID_HOME`
  - missing `local.properties` with `sdk.dir`

### Operational Note

- Until a signed release with this native fix reaches the device, avoid repeatedly opening/refreshing the ML tab during live polling if the local snapshot cache is large.
- Once PWA `app.js?v=1255` is shipped, the current installed app should be less likely to hit the old bridge OOM because the web layer asks for only 30 rows.
- The durable fix still requires the native `v2.5.9 / b340` APK because only the native change prevents full-cache materialization before serialization.

## 2026-07-20 - Post-v2.5.9 Jitter Follow-Up: Bridge Payload Still Too Heavy

### Observation

- Post-update log reviewed:
  - `/tmp/codex-web-uploads/f-hTeNPc/marketapp-logs-2026-07-20T05-52-14-928Z.csv`
- Result:
  - Pre-update/transition period still showed old OOM events while `app.js?v=1254` / early `v1255` boot was active.
  - After the new bridge path became active, no new crash loop was visible.
  - The bridge emitted:
    - `LOCAL_SNAPSHOT_READ_RECENT: rows=5 bytes=8083548 fileBytes=40850814 limit=30 byteCap=8388608`
    - `ML_BRAIN_SNAPSHOTS_BRIDGE: rows=5 requested=30 maxRows=30`
- Interpretation:
  - Crash risk was reduced, but the UI bridge was still moving roughly `8 MB` per ML sync.
  - The first recent-reader implementation still scanned the full JSONL snapshot cache before trimming.
  - This explains visible jitter without a hard crash.

### Local Follow-Up Patch Prepared

- Android:
  - `EvaluationLocalCache.readRecentBrainSnapshots(...)` now reads from the end of the JSONL file using `RandomAccessFile`.
  - It stops once enough recent rows/bytes are collected, instead of scanning the full day file.
  - Full post-close replay path remains unchanged; `readBrainSnapshots(...)` still loads the complete cache for evaluation.
- Android bridge cap tightened:
  - `ML_BRAIN_SNAPSHOT_JS_MAX_ROWS = 5`
  - `ML_BRAIN_SNAPSHOT_JS_MAX_BYTES = 2 MB`
- PWA:
  - `getMLBrainSnapshotsCached(...)` now asks native for `5` rows instead of `30`.
- Synchronized next-release prep:
  - Android `versionName = "2.5.10"`
  - Android `versionCode = 341`
  - PWA label `v2.5.10 / b341`
  - PWA cache-bust `app.js?v=1256`

### Scope Guard

- This does not change candidate ranking, teacher labels, P&L, G2, Supabase writes, or post-close evaluation.
- It only reduces ML-tab bridge work and UI jank during live data capture.

## 2026-07-20 - v2.5.11 Crash Fix: Cache Rewrite OOM + Foreground Service Quota

### Evidence

- Crash log reviewed:
  - `/tmp/codex-web-uploads/f-Ejg6bx/marketapp-logs-2026-07-20T07-25-13-439Z.csv`
- Fatal crash #1:
  - `OutOfMemoryError` on `DefaultDispatcher-worker-*`
  - stack:
    - `EvaluationLocalCache.rewriteCanonicalFile(EvaluationLocalCache.kt:115)`
    - `EvaluationLocalCache.appendBrainSnapshot(EvaluationLocalCache.kt:175)`
    - `MarketWatchService.runBrainAnalysis(...)`
  - cause:
    - cache file had reached roughly `61-67 MB`;
    - `rewriteCanonicalFile()` used `buildString(...)`, forcing a second very large in-memory copy during trim/compaction;
    - `appendBrainSnapshot()` caught `Exception`, not `Throwable`, so `OutOfMemoryError` escaped and killed the app.
- Fatal crash #2:
  - `ForegroundServiceStartNotAllowedException: Time limit already exhausted for foreground service type dataSync`
  - affected:
    - `MarketWatchService.onStartCommand(...)`
    - `PositionTickService.onCreate(...)`
  - cause:
    - Android foreground-service quota exhaustion during repeated recovery/restart cycles.

### Fix Prepared

- `EvaluationLocalCache.rewriteCanonicalFile(...)` now streams rows to a `.tmp` file with `bufferedWriter(...)`.
- It no longer builds a full cache-size string in memory.
- `appendBrainSnapshot(...)` now catches `Throwable` so OOM during local cache maintenance becomes a logged save failure instead of a process kill.
- `MarketWatchService.onStartCommand(...)` now wraps `startForeground(...)` and exits cleanly if Android blocks foreground promotion.
- `PositionTickService` now wraps:
  - `startForeground(...)`
  - `startForegroundService(...)` / `startService(...)`
- A blocked position tick service is logged and skipped instead of crashing the main app.

### Release Prep

- Android:
  - `versionName = "2.5.11"`
  - `versionCode = 342`
- PWA:
  - visible label `v2.5.11 / b342`
  - cache-bust `app.js?v=1257`

### Scope Guard

- No trading/ranking/teacher/P&L logic changed.
- Full-day cache retention policy remains unchanged.
- This is crash containment for local cache compaction and Android foreground-service quota exhaustion.

## 2026-07-20 - v2.5.12 Sandbox Build-Only Preview Wiring

### Scope

- Implemented the next safe sandbox step after the native sandbox order layer:
  - PWA candidate cards in `SANDBOX` execution mode now show `SANDBOX BUILD` instead of `REAL TRADE`.
  - The button calls `previewSandboxOrder(...)`, not `takeTrade(..., false)`.
  - The payload is sent to native with `action = "build"` only.
  - No broker dispatch path is invoked.
  - No real/paper trade row is created by this preview path.

### Payload Contract

- The PWA now builds a native-compatible order preview payload from the selected candidate:
  - `trade_ref`
  - `candidate_id`
  - `strategy_type`
  - `index_key`
  - `expiry`
  - `lot_size`
  - `lots`
  - `instrument_lot_sizes`
  - `legs[]`
- Each leg includes:
  - `correlation_id`
  - `action` (`BUY` / `SELL`)
  - `instrument_key`
  - `strike`
  - `option_type`
  - `lot_size`
  - `lots`
  - `ltp`
- The native `OrderExecutionService.buildOrders(...)` remains the validator and sequence authority:
  - validates instrument key
  - validates BUY/SELL side
  - validates lot-size multiple quantity
  - validates positive executable price
  - sorts BUY legs before SELL legs

### Safety Boundary

- This release does not enable `place_sequential`, `place_multi`, `modify`, or `cancel` from the PWA.
- The preview alert explicitly says no broker order was sent.
- Sandbox token is not required for `build` mode.
- Actual sandbox placement remains a future explicit step requiring confirmation and validation.

### Release Prep

- Android:
  - `versionName = "2.5.12"`
  - `versionCode = 343`
  - `BRAIN_VERSION = "2.5.12"` for attribution alignment only
- PWA:
  - visible label `v2.5.12 / b343`
  - cache-bust `app.js?v=1258`

### Scope Guard

- No candidate ranking, teacher label, G2/P&L, Supabase evaluation, or strategy-construction logic changed.
- This is UI-to-native sandbox order-build wiring only.

### Push Verification

- User explicitly authorized push after local checks.
- `Marketapp` pushed to `main`:
  - commit `1055806b82c80865a5efffa43ddc37942bf25027`
  - remote HEAD verified equal to local HEAD
  - debug workflow succeeded:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29737137615`
  - signed release workflow succeeded:
    - `https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/29737137692`
- `MarketVivi` pushed to `main`:
  - commit `ffa52778a37b2fb84279e8657615d4f2a5e4fc7e`
  - remote HEAD verified equal to local HEAD
- Both worktrees were clean after push.

### Current Sandbox State

- Sandbox is not yet fully end-to-end.
- Completed:
  - native sandbox order builder/validator exists
  - PWA can build and preview the sandbox payload from a candidate
  - sandbox preview is isolated from trade recording and broker dispatch
- Not completed:
  - UI path for `place_sequential`
  - explicit confirmation flow for real sandbox dispatch
  - Upstox sandbox response capture from live app flow
  - order-status / fill lifecycle tracking
  - sandbox order response comparison against brain values and later market movement
- Standing rule:
  - do not bypass the app by manually sending strategy orders from Codex unless explicitly authorized as an emergency diagnostic;
  - direct Codex dispatch would weaken the app audit trail and is not the preferred path.

### EV Gate Discussion

- User raised that the current `1.10` EV hard floor is causing no strategy generation.
- Current recommendation:
  - do not remove the `1.10` EV gate from live selection directly.
  - keep the hard live safety gate intact until evidence proves a lower/branch-specific EV floor is profitable after G2 friction.
- Reason:
  - no-candidate days may be caused by EV formula conservatism, probability calibration, debit spread rejection, calm-regime branching, candidate construction, or friction assumptions;
  - deleting the gate live could surface weak premium / negative-expectancy candidates just to force activity.
- Preferred experiment:
  - add `EV_RELAX_SHADOW` observe-only diagnostics.
  - For each poll, record the best candidate under:
    - current EV floor `1.10`
    - relaxed EV floor `1.00`
    - relaxed EV floor `0.90`
    - EV gate disabled while keeping structural/safety gates intact
  - Post-close compare realized outcomes after G2 friction.
- Important boundary:
  - the relaxed EV path must not affect live `WAIT` / trade decisions until post-close evidence supports promotion.

### Deferred Sandbox Operating Plan

1. Install/update to `v2.5.12 / b343`.
2. During live market hours, turn `Sandbox ON`.
3. If a valid candidate appears, press `SANDBOX BUILD`.
4. Verify the preview:
   - BUY legs appear before SELL legs
   - quantity equals lots times lot size
   - instrument keys are present
   - prices are positive and plausible
   - strategy/index/expiry match the card
5. If build preview is correct, next implementation step is guarded `SANDBOX PLACE`:
   - UI must ask explicit confirmation
   - action should be `place_sequential`
   - response should persist to `sandbox_orders`
   - no live broker endpoint is allowed
6. This plan is deferred. User clarified on 2026-07-20 that sandbox implementation must wait until brain logic is corrected.

## 2026-07-20 - Adaptive Brain Analysis Directive Review

Source directive: `DIRECTIVE_OC_ADAPTIVE_BRAIN_ANALYSIS_20260720-1.md`.

### Boundary

- Claude explicitly marked the document as analysis/challenge only.
- No code changes, no live-path modifications, and no Supabase writes are authorized by this directive.
- Treat the adaptive-brain discussion as a research track, separate from the current sandbox and crash-stability path.

### Verified Code Findings

- `BUILD3_EV_FLOOR_MULT = 1.10` is active in `brain.py`.
- A8 EV gate uses `probProfit`, `maxProfit`, and `maxLoss`:
  - `expected_win = probProfit * maxProfit`
  - `expected_loss = (1 - probProfit) * maxLoss`
  - pass requires `expected_win >= expected_loss * 1.10`
- `trueProb` is not decorative:
  - Credit candidates compute `trueProb` using `_realized_vol_proxy(vix)`.
  - `premiumEdge` is computed from `trueProb`.
  - Ranking uses `premiumEdge` before probability and ML tie-breakers.
- Important nuance:
  - `trueProb`/realized-vol proxy affects ranking through `premiumEdge`.
  - The 1.10 A8 hard gate itself uses `probProfit`, not `trueProb`.
  - Therefore EV-floor experiments and realized-vol-proxy fixes are related but not identical levers.
- `_realized_vol_proxy(vix)` is currently a constant bootstrap: `(vix * 0.85) / 100`.
- `MAX_SIGMA_OTM` live constant is `1.15`; `0.8` is only fallback/default in `_credit_sigma_limits`.
- `vix_velocity` and `breadth_skew` do not exist in `brain.py`, supporting rejection of Gemini's proposed spatial anomaly veto.
- Strategy constants include `DOUBLE_DEBIT` in debit/neutral lists, but code comments state `DOUBLE_DEBIT is not built by the live candidate generator`.

### Challenge To Claude/Gemini Claims

- Reject spatial anomaly veto for now:
  - required inputs are missing;
  - vector weights are hand-written;
  - mixed-scale Euclidean distance is not normalized;
  - threshold has no interpretable calibration.
- Hold fuzzy regime blending:
  - historical/live evidence is not enough for 19+ and 24+ VIX activation unless high-vol windows are refetched and tested.
- Hold adaptive sigma gates:
  - directionally plausible, but constants are not fitted and the cited `0.8` max-sigma claim is inaccurate for live code.
- Hold whipsaw siphon:
  - potentially testable from existing verdict-flip snapshots, but should be observe-only first.
- Strategy-universe statement needs precision:
  - live generated structures appear to omit pure long-vol neutral structures;
  - however `DOUBLE_DEBIT` exists in constants as a dormant/not-built type, so saying "exactly six structures" is too loose unless confirmed by generation-path evidence.
- RV/VIX analysis needs horizon discipline:
  - 20-day realized volatility vs same-day VIX is a horizon/basis mismatch;
  - VIX is forward/implied and closer to 30-day;
  - intraday strategy selection may need intraday RV, 1-day, 5-day, 10-day, and 20-day comparisons separately.
- Put-call-parity spot recovery is useful, but only if quotes are synchronized by timestamp/expiry and filtered for stale/zero/wide-spread artifacts.
- April 2026 artifact claim is plausible but must be date-aligned:
  - verify whether the 55 incomplete IC/IB winners actually coincide with high-RV dates, not just the same month.
- `IV_RICH_MIN` priority must be proven by rejection frequency:
  - recent app evidence often shows sigma, price, credit-positive, capital-limit, and EV-floor rejections dominating;
  - `iv_not_rich` should be quantified by date/regime before ranking it as top priority.

### Current Recommendation

- Do not implement adaptive brain changes yet.
- Keep live selection frozen except already-authorized stability tasks.
- Sandbox implementation is explicitly parked until brain logic/ranking correctness is resolved.
- Prepare evidence-only queries/analysis for:
  - VIX/RV band distribution;
  - generated strategy counts including whether `DOUBLE_DEBIT` ever appears;
  - rejection-stage distribution by date/regime, especially `iv_not_rich`;
  - A8 EV relax shadow candidates at `1.10`, `1.00`, `0.90`, and disabled EV while preserving structural/safety gates;
  - rank-order impact of `trueProb`/`premiumEdge` versus `probProfit`.
- Any promotion to live ranking must require explicit authorization after post-close evidence.

### Priority Correction

- User clarified that sandbox implementation should not continue before brain logic is corrected.
- New priority:
  - brain logic/ranking/rejection correctness first;
  - sandbox order placement second;
  - live broker execution last.
- Reason:
  - a working sandbox layer is not useful if the brain has no reliable candidate/ranking logic;
  - sandbox can only test execution mechanics, not fix selection quality.

## 2026-07-20 - Deterministic Brain / LLM Architecture Study Assessment

Source study: `STUDY_DETERMINISTIC_BRAIN_LLM_ARCHITECTURE_20260720.md`.

### Assessment Boundary

- Treat Claude's document as a design study, not implementation authorization.
- No live brain rewrite, no EV-gate removal, no sandbox continuation is implied by this study.
- Current program priority remains:
  - correct brain logic/ranking/rejection evidence first;
  - keep sandbox order-layer work parked;
  - keep LLM/Gemini outside the hot path.

### What Was Accepted

- Direction is valid:
  - the brain should become deterministic but richer, more adaptive, and more auditable;
  - LLM/Gemini should remain offline/advisory for retrospective review and proposal generation only.
- Strongest architecture target:
  - one expected-R currency after friction for all candidates;
  - shadow EV-floor comparisons before any live threshold change.
- `DOUBLE_DEBIT` issue is real but needs precise wording:
  - it exists in constants;
  - it is not built as a live candidate generator path;
  - low-IV neutral logic can effectively fall back to short-vol structures.

### Corrections To Claude Claims

- "Zero persistent state in brain.py" is too broad:
  - `NotificationAgent` persists candidate/verdict state and suppresses repeated alerts;
  - the accurate gap is no persistent market-belief posterior used by candidate scoring.
- "Brain lacks all six LLM-like properties" is too broad:
  - branch overrides, teacher artifacts, Stage 2A shadow, ML advisory, and notification memory already exist in partial form;
  - the problem is fragmentation, not total absence.
- "16 gates" should be audited before implementation:
  - create a gate registry before softening anything;
  - classify each rejection as SAFETY or EVIDENCE.
- B1 perception is only partially unblocked:
  - intraday RV from spot stream is feasible;
  - IV skew/term structure must first prove enough expiry/strike capture and quote quality.

### Corrected Implementation Sequence

1. Verify data-integrity prerequisites:
   - S1/G2 friction;
   - lot-size corrected PnL;
   - close-path null handling;
   - post-close evaluation completeness;
   - clean teacher labels.
2. Add B1a shadow intraday realized volatility from spot stream.
3. Add B1b historical RV context with horizon separation:
   - intraday, 1-day, 5-day, 10-day, 20-day.
4. Add B2 unified expected-R shadow scorer.
5. Add EV relaxation shadow:
   - `1.10`, `1.00`, `0.90`, and EV-disabled-with-safety-gates.
6. Build gate taxonomy:
   - SAFETY gates stay hard;
   - EVIDENCE gates may later become weighted log-odds.
7. Add limited structure composer shadow only after expected-R exists.
8. Add session belief posterior in shadow after perception is reliable.
9. Fit regime weights only after enough clean labelled outcomes exist.
10. Use LLM/Gemini only for monthly/offline proposal generation with human approval.

### Current Recommendation

- Do not remove the live `1.10` EV floor.
- Do not continue sandbox implementation until brain selection quality is corrected.
- Do not build a full composer before one expected-R scorer exists.
- Next useful coding track should be evidence-only:
  - RV perception;
  - expected-R shadow;
  - EV-band shadow;
  - gate taxonomy.

### Claude Handoff File

- Prepared assessment file:
  - `/tmp/DETERMINISTIC_BRAIN_LLM_ARCHITECTURE_ASSESSMENT_TO_CLAUDE_20260720.txt`

## 2026-07-20 - Claude Approval Of Staged Brain Plan

Source ruling: `CLAUDE_APPROVAL_STAGED_BRAIN_PLAN_20260720.md`.

### Ruling Accepted

- Claude approved OpenClaw's corrected staged plan.
- The corrected nine-phase order replaces Claude's original six-phase order.
- Canonical diagnosis is now:
  - the brain does not lack every adaptive piece;
  - the problem is fragmentation across perception, scoring, selection, teacher, ML advisory, and notification state.

### Accepted Corrections

- `NotificationAgent` persistence exists in `brain.py`; the true gap is no persistent market-belief posterior used in candidate scoring.
- Gate count must not be treated as fact until a registry exists.
- Intraday RV is authorized as B1a; IV skew/term is blocked until chain-coverage audit passes.
- Composer must wait until one expected-R currency exists.
- Live EV floor must not be relaxed directly.
- Supabase writes must remain capped/summarized.

### Authorization State

- Phase 0:
  - already in flight;
  - must close the four standing items before Phase 3-5 full-session shadow runs.
- Phases 1-2:
  - authorized shadow-only:
    - B1a intraday RV;
    - B1b historical multi-horizon RV from filtered data.
- Phases 3-5:
  - authorized to design and implement in shadow only after Phase 0 closes;
  - schema/sample rows must be prepared before first full-session run.
- Phases 6-9:
  - not authorized.

### Phase 0 Standing Items

- `pnl_engine --apply`:
  - local dry-run gate currently passes with revised classes `55 / 60 / 29 / 23`;
  - DB apply still requires safe service-role execution.
- Close-path null-default fix:
  - implemented locally in `MarketVivi/app.js`;
  - not pushed;
  - no version/cache bust performed yet.
- Task A entry-basis provenance:
  - remains an evidence/provenance item unless separately closed by Claude.
- G2 forward friction confirmation:
  - G2 live friction fields and bridge exist;
  - forward confirmation still depends on new clean closes with finite valuation.

### Local Close-Path Null-Default Fix

- Patched `MarketVivi/app.js` forward-only.
- Behavior:
  - if `trade.current_pnl` is null/undefined/blank/NaN, manual close is blocked;
  - no fake `actual_pnl = 0` is written;
  - no fake `canonical_won = false` / `outcome_h2 = 0` is written;
  - generic Exit button no longer infers `Stop loss` from coerced zero;
  - position card/ticker/totals show `unavailable` or exclude unvalued rows with visible counts.
- Helper correction:
  - `asFiniteNumber(null)` now returns `null`, not `0`.
- Verification:
  - `node --check app.js` passed.
  - grep check found no remaining `current_pnl ?? 0`, `current_pnl || 0`, or `Number(...current_pnl...)` write/display default pattern except the safe `currentPnlValue()` helper.

### Current Boundary

- No live ranking/selection changes.
- No brain logic changes.
- No sandbox continuation.
- No Supabase writes from this checkpoint.
- Before pushing this PWA fix:
  - decide synchronized version bump/cache bust with `Marketapp`;
  - keep both repos aligned per standing release discipline.

## 2026-07-20 - Phase 0 PnL Engine Dry-Run Refreshed

### Execution Boundary

- Ran throttled read-only dry-run:
  - `python3 tools/pnl_engine_quarantine.py --page-size 25 --sleep 0.35`
- Credential mode:
  - `anon_dry_run`
- No Supabase writes were performed.
- Service-role/access-token environment variables are not loaded locally:
  - `SUPABASE_SERVICE_ROLE_KEY` missing
  - `SUPABASE_ACCESS_TOKEN` missing
- Therefore `--apply` was not run.

### Updated Dry-Run Result

- Rows classified:
  - `170`
- Previous dry-run had `167`; the increase is from new UNKNOWN rows.
- Apply gate still passes because UNKNOWN tolerance is `3`.

### Current Class Counts

- `UNTRUSTED_INCOMPLETE_STRUCTURE = 55`
- `RECONCILED = 60`
- `PNL_BASIS_DIVERGENT = 29`
- `UNKNOWN = 26`

### Current Baselines

- Reconciled mid-priced baseline, gross excluding spread and charges:
  - rows `60`
  - win rate `53.3333%`
  - total P&L `80103.0`
  - avg P&L `1335.05`
- Reconciled plus basis-divergent baseline, gross excluding charges:
  - rows `89`
  - win rate `50.5618%`
  - total P&L `72815.0`
  - avg P&L `818.15`

### Updated Artifact Hashes

- `reports/pnl_engine_classification_20260719.csv`
  - `28324cbac002e15819d5dea1102c7df159ce7a1d73431896c9c9b32793b0b367`
- `reports/pnl_engine_classification_summary_20260719.json`
  - `d0efa7e48606e4c86c64c4c814c76b859e59955c1ea68422b35fcefca615e3f5`
- `tools/pnl_engine_quarantine.py`
  - `231cd433fb82ec8e112715ed6ba45b25b9d3265f3867257d11d77c9a2229ac9d`
- `supabase/migrations/20260719_pnl_engine_quarantine.sql`
  - `c730d0b0d8991e4e1fe953e5cf7111102607f1d613dc3dc2c7207bc1ac7ae5b1`

### DB Apply Status

- Completed on 2026-07-21 UTC through Supabase Management SQL endpoint.
- Throttling posture:
  - one management SQL health check;
  - one server-side DDL/update transaction;
  - one small anon REST verification read of 170 rows.
- Management API required a browser-like user agent; the default Python user agent was blocked by Cloudflare 1010.
- No secrets are stored in repo or project knowledge.

### Supabase Apply Result

- Applied classification columns/indexes to `public.trades_v2`.
- Updated closed paper rows with additive PnL quarantine fields only.
- Rows classified:
  - `170`
- Class counts:
  - `UNTRUSTED_INCOMPLETE_STRUCTURE = 55`
  - `RECONCILED = 60`
  - `PNL_BASIS_DIVERGENT = 29`
  - `UNKNOWN = 26`
- Returned aggregate actual P&L by class:
  - `RECONCILED`: rows `60`, avg actual P&L `1335.05`, total actual P&L `80103.00`
  - `PNL_BASIS_DIVERGENT`: rows `29`, avg actual P&L `-251.31`, total actual P&L `-7288.00`
  - `UNKNOWN`: rows `26`, avg actual P&L `-443.81`, total actual P&L `-11539.00`
  - `UNTRUSTED_INCOMPLETE_STRUCTURE`: rows `55`, avg actual P&L `5803.49`, total actual P&L `319192.00`

### Read-Back Verification

- Verified via anon REST after apply:
  - rows read `170`
  - counts matched the management SQL return exactly.

### Next Requirement

- Phase 0 DB classification is now complete.
- Next implementation work should follow Claude-approved staged brain plan:
  - Phase 0 standing queue closure/confirmation;
  - then Phase 1 shadow-only B1a intraday RV;
  - then Phase 2 shadow-only B1b historical multi-horizon RV.
- Do not proceed to Phases 6-9.
- Do not change live decision path, LLM hot path, or sandbox path until explicitly authorized.

## 2026-07-21 - Phase 1/B1a Shadow Intraday RV Implemented Locally

### Scope

- Implemented Claude-authorized Phase 1/B1a only.
- Purpose:
  - compute intraday realized volatility from the live spot poll stream;
  - persist it as shadow evidence for later brain/ranking research;
  - avoid all live decision, scoring, ranking, notification, sandbox, and LLM hot-path changes.
- This is diagnostic/shadow-only. It must not be interpreted as a production ranking rule.

### Android Repo Changes

- Repo: `Marketapp-main-worktree`
- Branch: `main`
- Files changed:
  - `app/src/main/python/brain.py`
  - `app/src/main/java/com/marketradar/app/MarketWatchService.kt`
  - `app/src/main/python/tests/test_b1a_intraday_rv_shadow.py`
  - `supabase/migrations/20260721_b1a_intraday_rv_shadow.sql`
  - refreshed PnL quarantine report artifacts:
    - `reports/pnl_engine_classification_20260719.csv`
    - `reports/pnl_engine_classification_summary_20260719.json`

### B1a Payload

- Added `_compute_b1a_intraday_rv(polls)` in `brain.py`.
- Source:
  - `spot_poll_stream`
- Schema version:
  - `b1a_intraday_rv_v1`
- Per-index output currently covers:
  - `BNF`
  - `NF`
- Computed fields include:
  - `spot_count`
  - `return_count`
  - `start_spot`
  - `last_spot`
  - `signed_move_pct`
  - `range_pct`
  - `rv_pct`
  - `abs_last_return_pct`
  - `abs_mean_return_pct`
  - `implied_daily_sigma_pct`
  - `rv_to_iv_daily_ratio`
- Fail-closed statuses:
  - `INSUFFICIENT_POLLS`
  - `INSUFFICIENT_RETURNS`
  - `OK`

### Snapshot Persistence

- `take_poll_snapshot` now attaches:
  - `b1a_intraday_rv_json`
  - `b1a_rv_status`
  - `b1a_bnf_rv_to_iv_daily_ratio`
  - `b1a_nf_rv_to_iv_daily_ratio`
- `market_forces.b1a_intraday_rv` also carries the full shadow payload.
- `poll_summary_json` includes compact B1a summary fields for quick inspection.
- Kotlin JSON handling was updated so `b1a_intraday_rv_json` is passed as a JSON object to Supabase, not as a string.

### Supabase DDL

- Migration added:
  - `supabase/migrations/20260721_b1a_intraday_rv_shadow.sql`
- Adds B1a columns to:
  - `public.ml_brain_snapshots`
  - `public.ml_poll_sequences`
- Columns:
  - `b1a_intraday_rv_json jsonb`
  - `b1a_rv_status text`
  - `b1a_bnf_rv_to_iv_daily_ratio double precision`
  - `b1a_nf_rv_to_iv_daily_ratio double precision`
- Index creation is guarded by table and column existence checks.

### Supabase Apply Status

- DDL applied on 2026-07-21 UTC through the Supabase Management SQL endpoint.
- First apply attempt found a real schema mismatch:
  - `public.ml_poll_sequences` did not have `session_date`, so an index using `session_date` failed.
- Migration was corrected to check `information_schema.columns` before creating each session-date index.
- Corrected apply succeeded:
  - `b1a_schema_apply = OK`
  - elapsed approximately `6.4s`
- Verification:
  - small anon REST read selected the new B1a columns successfully;
  - returned `1` row;
  - no broad Supabase read was used.

### Validation

- Passed:
  - `git diff --check` in `Marketapp-main-worktree`
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow`
  - `node --check app.js` in `MarketVivi-git`
- Expected test fixture warning:
  - `REPLAY_CAPTURE_WARN` appears because the B1a test fixture intentionally lacks chain payloads.
  - This warning is not a B1a failure.
- Android compile was attempted but could not run in the local workspace because Android SDK configuration is missing:
  - `SDK location not found. Define a valid SDK location with ANDROID_HOME or local.properties.`

### Current Status

- B1a shadow implementation is local and unpushed.
- Supabase schema side is already applied and verified.
- No live decision behavior has been intentionally changed by B1a.
- Next Claude-authorized phase is Phase 2/B1b historical multi-horizon RV, still shadow-only.
- Do not push until explicitly commanded.
- If pushing, maintain synchronized version/cache-bust discipline across both repos.

## 2026-07-21 - Phase 2/B1b Shadow Multi-Horizon RV Implemented Locally

### Scope

- Implemented Claude-authorized Phase 2/B1b only.
- Purpose:
  - compute historical/multi-horizon realized-volatility evidence from filtered intraday spot poll history;
  - preserve it for later offline analysis;
  - keep live strategy generation, ranking, notifications, sandbox, and LLM hot path unchanged.
- This is shadow-only and must not be used as a live decision input until a later explicit authorization.

### Storage Decision

- B1b is stored inside existing JSON payloads:
  - `market_forces_json.b1b_historical_multi_horizon_rv`
  - compact summary fields inside `poll_summary_json`
- No additional Supabase DDL was added for B1b in this step.
- Reason:
  - reduces schema/app deployment coupling;
  - avoids another Supabase DDL/apply cycle during a throttling-sensitive period;
  - keeps B1b evidence available for offline extraction from already persisted snapshot JSON.

### B1b Payload

- Added `_compute_b1b_historical_multi_horizon_rv(polls)` in `brain.py`.
- Source:
  - `filtered_spot_poll_history`
- Schema version:
  - `b1b_historical_multi_horizon_rv_v1`
- Per-index output currently covers:
  - `BNF`
  - `NF`
- Filters:
  - positive finite spot values only;
  - bad spot rows are counted and excluded;
  - no non-monotonic timestamp rejection yet.
- Horizons:
  - `15m` = last 3 polls
  - `30m` = last 6 polls
  - `60m` = last 12 polls
  - `120m` = last 24 polls
  - `full_session` = all valid intraday polls supplied to the snapshot
- Per-horizon fields include:
  - `spot_count`
  - `return_count`
  - `start_time`
  - `last_time`
  - `start_spot`
  - `last_spot`
  - `signed_move_pct`
  - `range_pct`
  - `rv_pct`
  - `abs_last_return_pct`
  - `abs_mean_return_pct`
  - `rv_to_iv_daily_ratio`

### Summary Fields

- `poll_summary_json` now includes:
  - `b1b_rv_status`
  - `b1b_bnf_max_rv_to_iv_daily_ratio`
  - `b1b_nf_max_rv_to_iv_daily_ratio`

### Validation

- Passed:
  - `git diff --check` in `Marketapp-main-worktree`
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow app.src.main.python.tests.test_b1b_historical_rv_shadow`
- Unit test result:
  - `Ran 6 tests`
  - `OK`
- Expected fixture warnings:
  - `REPLAY_CAPTURE_WARN` appears because the test fixtures intentionally lack chain payloads.
  - These warnings are not B1a/B1b failures.

### Current Status

- Phase 1/B1a and Phase 2/B1b are implemented locally and unpushed.
- No live decision behavior has been intentionally changed by either phase.
- Next authorized work, after confirming Phase 0 closure remains intact, is Phase 3 expected-R shadow design/implementation.
- Per Claude, before a first full-session run of Phases 3-5, deliver schema plus sample rows for review.
- Do not proceed to Phases 6-9.
- Do not push until explicitly commanded.

## 2026-07-21 - Phase 3 Expected-R Shadow Implemented Locally

### Scope

- Implemented Claude-authorized Phase 3 as shadow-only.
- Purpose:
  - compute expected-R evidence for generated candidates;
  - stamp every row with its probability source;
  - expose A8-rejected expected-R rows separately;
  - avoid changing live ranking, A8 behavior, notification, sandbox, LLM, or trade execution.

### Key Guardrail

- Sources are intentionally not blended.
- Each expected-R row is source-stamped, and the payload explicitly states:
  - `sources_are_not_like_for_like = true`
- This follows Claude amendment A2:
  - interim probability sources are allowed;
  - cross-source comparisons must not be treated as equivalent probability models.

### Phase 3 Payload

- Added `_compute_phase3_expected_r_shadow(candidates, rejected_candidates)` in `brain.py`.
- Schema version:
  - `phase3_expected_r_shadow_v1`
- Formula:
  - `expected_r = (p * maxProfit - (1 - p) * maxLoss) / maxLoss`
- Candidate probability sources:
  - `probProfit_gate_model_interim`
  - `trueProb_realized_vol_proxy_interim`
  - `p_ml_advisory_interim`
- A8-rejected source:
  - `probProfit_a8_rejected_interim`
- Per-row fields include:
  - `candidate_id`
  - `deterministic_rank`
  - `index`
  - `lane`
  - `strategy_type`
  - `is_credit`
  - `width`
  - `expiry`
  - `probability_source`
  - `probability`
  - `max_profit`
  - `max_loss`
  - `expected_win`
  - `expected_loss`
  - `expected_net`
  - `expected_r`
  - `ev_floor_mult_reference`
  - `passes_1_10_reference`
  - teacher bucket fields if available

### Storage

- Phase 3 is stored inside existing JSON payloads:
  - `market_forces_json.phase3_expected_r_shadow`
  - `context_json.snapshot_phase3_expected_r_shadow`
  - compact counts inside `poll_summary_json`
- No new Supabase DDL was added for Phase 3.
- Reason:
  - avoids another schema dependency;
  - stays safe under Supabase throttling constraints;
  - keeps the data extractable for Claude/sample-row review.

### Summary Fields

- `poll_summary_json` now includes:
  - `phase3_expected_r_status`
  - `phase3_expected_r_rows`
  - `phase3_expected_r_a8_rows`

### Tests

- Added:
  - `app/src/main/python/tests/test_phase3_expected_r_shadow.py`
- Test coverage:
  - separate expected-R rows by probability source;
  - A8-rejected row capture;
  - snapshot carry-through without changing verdict.

### Validation

- Passed:
  - `git diff --check` in `Marketapp-main-worktree`
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow app.src.main.python.tests.test_b1b_historical_rv_shadow app.src.main.python.tests.test_phase3_expected_r_shadow`
- Unit test result:
  - `Ran 9 tests`
  - `OK`
- Expected fixture warnings:
  - `REPLAY_CAPTURE_WARN` appears because fixtures intentionally omit chain payloads.
  - Not a Phase 3 failure.

### Current Status

- Phases 1, 2, and 3 are implemented locally and unpushed.
- Supabase DDL was needed only for B1a and is already applied.
- B1b and Phase 3 use existing JSON columns.
- Next authorized work is Phase 4 EV ladder shadow, then Phase 5 gate registry.
- Before a first full-session run of Phases 3-5, prepare schema plus sample rows for Claude review.
- Do not proceed to Phases 6-9.
- Do not push until explicitly commanded.

## 2026-07-21 - Phase 4 EV Ladder Shadow Implemented Locally

### Scope

- Implemented Claude-authorized Phase 4 as shadow-only.
- Purpose:
  - measure how many candidates would pass at alternate EV floor multipliers;
  - preserve A8 killed-candidate evidence;
  - log the `prob` versus `trueProb` disagreement pair requested by Claude amendment A3;
  - keep the live `BUILD3_EV_FLOOR_MULT = 1.10` behavior unchanged.

### Key Guardrail

- No live gate softening was made.
- No ranking, candidate selection, notification, sandbox, LLM, or execution path was changed.
- The EV ladder answers “what would have happened if the floor were different” only.

### Phase 4 Payload

- Added `_compute_phase4_ev_ladder_shadow(candidates, rejected_candidates)` in `brain.py`.
- Schema version:
  - `phase4_ev_ladder_shadow_v1`
- Multipliers measured:
  - `0.80`
  - `0.90`
  - `1.00`
  - `1.10`
  - `1.20`
  - `1.50`
- Payload fields include:
  - `current_live_ev_floor_mult`
  - `multipliers`
  - `probability_source`
  - `pass_counts_by_multiplier`
  - `rows`
  - `top_by_highest_passing_multiplier`
  - `a8_killed_rows`
  - `a8_disagreement_pair_logged`
- Per-candidate rows include:
  - `candidate_id`
  - `deterministic_rank`
  - `index`
  - `lane`
  - `strategy_type`
  - `is_credit`
  - `prob`
  - `trueProb`
  - `prob_trueProb_delta`
  - `max_profit`
  - `max_loss`
  - `expected_win`
  - `expected_loss`
  - `expected_r`
  - `pass_by_multiplier`
  - `highest_passing_multiplier`
  - `passes_current_1_10`

### A8 Pair Logging

- `_build3_rejection_from_candidate` now carries:
  - `prob`
  - `probProfit`
  - `trueProb`
- Compact and full rejected-candidate snapshot views also preserve these fields.
- This is diagnostic attribution only.

### Storage

- Phase 4 is stored inside existing JSON payloads:
  - `market_forces_json.phase4_ev_ladder_shadow`
  - `context_json.snapshot_phase4_ev_ladder_shadow`
  - compact counts inside `poll_summary_json`
- No new Supabase DDL was added for Phase 4.

### Summary Fields

- `poll_summary_json` now includes:
  - `phase4_ev_ladder_status`
  - `phase4_ev_ladder_rows`
  - `phase4_ev_ladder_a8_rows`

### Tests

- Added:
  - `app/src/main/python/tests/test_phase4_ev_ladder_shadow.py`
- Test coverage:
  - pass/fail counts across alternate EV floor multipliers;
  - live `1.10` reference remains unchanged;
  - A8 killed row carries `prob`/`trueProb` disagreement pair;
  - snapshot carry-through without changing verdict.

### Validation

- Passed:
  - `git diff --check` in `Marketapp-main-worktree`
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow app.src.main.python.tests.test_b1b_historical_rv_shadow app.src.main.python.tests.test_phase3_expected_r_shadow app.src.main.python.tests.test_phase4_ev_ladder_shadow`
- Unit test result:
  - `Ran 12 tests`
  - `OK`
- Expected fixture warnings:
  - `REPLAY_CAPTURE_WARN` appears because fixtures intentionally omit chain payloads.
  - Not a Phase 4 failure.

### Current Status

- Phases 1-4 are implemented locally and unpushed.
- Next authorized work is Phase 5 gate registry.
- After Phase 5, prepare schema plus sample rows for Claude review before any first full-session run of Phases 3-5.
- Do not proceed to Phases 6-9.
- Do not push until explicitly commanded.

## 2026-07-21 - Phase 5 Gate Registry Shadow Implemented Locally

### Scope

- Implemented Claude-authorized Phase 5 as shadow-only.
- Purpose:
  - inventory all rejection gates observed in `rejected_candidates`;
  - classify each gate as `SAFETY`, `EVIDENCE`, or `UNCLASSIFIED`;
  - explicitly mark whether a gate is ever eligible for softening;
  - preserve the evidence bar required before any future gate change.

### Guardrail

- No live gate was softened.
- No ranking, selection, notification, sandbox, LLM, or execution path was changed.
- This is an attribution and governance artifact only.

### Phase 5 Payload

- Added `_compute_phase5_gate_registry(rejected_candidates)` in `brain.py`.
- Schema version:
  - `phase5_gate_registry_v1`
- Static registry version:
  - `20260721_static_v1`
- Payload fields include:
  - `status`
  - `shadow_only`
  - `live_gate_changes`
  - `observed_rejection_rows`
  - `registered_gate_count`
  - `registry_complete_for_observed_stages`
  - `unknown_stages`
  - `class_counts`
  - `softening_candidate_count`
  - `softening_candidates`
  - `rows`

### Gate Classification Policy

- `SAFETY` gates are not softening-eligible:
  - missing strike/leg/quote data;
  - zero price;
  - non-positive credit/debit/economics;
  - max-loss/capital limit;
  - missing sigma data;
  - construction minimums treated as executable-integrity guards.
- `EVIDENCE` gates are softening-eligible only after proof:
  - sigma too close/far;
  - credit ratio below floor;
  - IV not rich;
  - probability below floor;
  - EV below floor.
- Unknown future gates become `UNCLASSIFIED`, `needs_review=true`, and `softening_eligible=false`.

### Storage

- Phase 5 is stored inside existing JSON payloads:
  - `market_forces_json.phase5_gate_registry`
  - `context_json.snapshot_phase5_gate_registry`
  - compact fields inside `poll_summary_json`
- No new Supabase DDL was added for Phase 5.

### Summary Fields

- `poll_summary_json` now includes:
  - `phase5_gate_registry_status`
  - `phase5_gate_registry_rows`
  - `phase5_gate_registry_softening_candidates`
  - `phase5_gate_registry_complete`

### Tests

- Added:
  - `app/src/main/python/tests/test_phase5_gate_registry.py`
- Test coverage:
  - capital-limit gate remains `SAFETY` and not softening-eligible;
  - EV floor gate is `EVIDENCE` and softening-eligible only as future research;
  - unknown gates require review and are not softening-eligible;
  - snapshot carries Phase 5 registry without changing verdict.

### Validation

- Passed:
  - `git diff --check` in `Marketapp-main-worktree`
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow app.src.main.python.tests.test_b1b_historical_rv_shadow app.src.main.python.tests.test_phase3_expected_r_shadow app.src.main.python.tests.test_phase4_ev_ladder_shadow app.src.main.python.tests.test_phase5_gate_registry`
  - `node --check app.js` in `MarketVivi-git`
  - `git diff --check` in `MarketVivi-git`
- Unit test result:
  - `Ran 15 tests`
  - `OK`
- Expected fixture warnings:
  - `REPLAY_CAPTURE_WARN` appears because minimal unit-test fixtures intentionally omit chain payloads.
  - Not a Phase 5 failure.

### Current Status

- Phases 1-5 are implemented locally and unpushed.
- Claude-approved scope is complete up to the gate registry.
- Next required step before any first full-session run of Phases 3-5:
  - prepare schema plus sample rows for Claude review.
- Do not proceed to Phases 6-9.
- Do not push until explicitly commanded.

## 2026-07-21 - Claude Phase 3/4/5 Addendum Processed Locally

### Claude Ruling

- Uploaded ruling:
  - `CLAUDE_RULING_PHASE345_ADDENDUM_VERIFIED_20260721.md`
- Verdict:
  - `CONDITIONAL HOLD`
- Meaning:
  - Do not run a full Phase 3-5 live session yet.
  - P0 close-path/G2 confirmation remains blocking at the program level.
  - Phases 3-5 local shadow implementation can be corrected, but not treated as session-run authorized.

### Items Confirmed Against Local Files

- Claude checked GitHub `main`, not this local working tree.
- Local `MarketVivi-git/app.js` already contains the close-path null fix:
  - `asFiniteNumber(null)` returns `null`, not `0`.
  - `closeTrade()` blocks if `current_pnl` is unavailable.
  - missing valuation no longer writes fake `actual_pnl=0`, `canonical_won=false`, or `outcome_h2=0`.
  - default exit reason for missing P&L is `Manual`, not `Stop loss`.
- This local PWA fix is still unpushed.

### Addendum Fixes Applied In Marketapp

- B3 rejection evidence preservation:
  - `_build3_rejection_from_candidate()` now carries:
    - `prob`
    - `probProfit`
    - `trueProb`
    - `premiumEdge`
    - `expected_win`
    - `expected_loss`
    - `ev_floor`
    - `ev_floor_mult`
  - Compact and full rejected-candidate snapshot views also preserve:
    - `prob`
    - `probProfit`
    - `trueProb`
    - `premiumEdge`
    - `expected_win`
    - `expected_loss`
    - `ev_floor`
    - `ev_floor_mult`
- Phase 5 registry correction:
  - corrected A8 source function from non-existent `_apply_build3_ev_gate` to actual `_build3_apply_a8_ev_gate`.
  - added `source_ref` field to registered gate rows.
- N1 pseudo-stage added:
  - `a8_bypassed_missing_inputs`
  - class: `POLICY_REVIEW`
  - softening eligible: `false`
  - counts generated candidates where A8 currently passes with missing expected-win/loss/floor inputs.
  - does not change fail-open behavior; it only measures and exposes it for Vivek/Claude policy ruling.
- Automated registry completeness test added:
  - parses `brain.py` for `record_rejection(...)`, `stage='...'`, the literal A8 gate, and the pseudo-stage.
  - fails if source stages and `PHASE5_GATE_REGISTRY_META` diverge.

### Validation

- Passed in `Marketapp-main-worktree`:
  - `python3 -m py_compile app/src/main/python/brain.py`
  - `git diff --check`
  - `python3 -m unittest app.src.main.python.tests.test_b1a_intraday_rv_shadow app.src.main.python.tests.test_b1b_historical_rv_shadow app.src.main.python.tests.test_phase3_expected_r_shadow app.src.main.python.tests.test_phase4_ev_ladder_shadow app.src.main.python.tests.test_phase5_gate_registry`
- Unit test result:
  - `Ran 18 tests`
  - `OK`
- Passed in `MarketVivi-git`:
  - `node --check app.js`
  - `git diff --check`

### Remaining Holds

- Do not run the Phase 3-5 full-session shadow until Claude/Vivek clears the conditional hold.
- Need one clean G2 forward close with real non-fabricated gross P&L after the close-path fix is delivered.
- Need policy ruling on `a8_bypassed_missing_inputs`:
  - should A8 missing inputs continue to fail open, or should it become fail closed?
- Need later response packet to Claude covering:
  - B1 with friction and `slippage_basis`;
  - B2 signed delta;
  - B4 caps/truncation discipline;
  - A1, A2, A5, A6;
  - A3 source references;
  - A4 automated registry check;
  - self-audit deviations.

## 2026-07-21 - Release Prep: Synchronized v2.5.13 / b344

### Release Purpose

- Deliver the local PWA close-path null fix so manual paper closes cannot fabricate zero-P&L labels when valuation is unavailable.
- Deliver Marketapp Phase 1-5 shadow telemetry and Claude addendum fixes:
  - B1a intraday realized-vol shadow.
  - B1b historical/multi-horizon realized-vol shadow.
  - Phase 3 expected-R shadow.
  - Phase 4 EV ladder shadow with A8 `prob`/`trueProb` evidence.
  - Phase 5 gate registry with source references and N1 pseudo-stage.
- Preserve Claude hold:
  - no live ranking change.
  - no EV softening.
  - no sandbox live path change.
  - no Phase 6-9 work.

### Version Sync

- Android:
  - `versionName = 2.5.13`
  - `versionCode = 344`
  - `BRAIN_VERSION = 2.5.13`
- PWA:
  - title/visible label `v2.5.13 / b344`
  - cache-bust `app.js?v=1259`

### Post-Install Verification Needed

- Confirm installed app shows `v2.5.13 / b344`.
- Take/track one paper trade only in normal test flow.
- Close only when current P&L is available.
- Verify Supabase writes real non-null gross `actual_pnl`, valid G2 `friction_cost`, `net_pnl`, and `net_won`.
- If current P&L is unavailable, close should block instead of writing `actual_pnl=0`.

## 2026-07-21 - Intraday Incident: One Position Exit Button Did Not Close

### Observed State

- User updated to `v2.5.13 / b344` during a live session after opening three morning paper trades.
- Two paper trades closed from the Position tab.
- One remaining paper trade card did not close when the red Exit button was used.
- Screenshot evidence:
  - app visible version `v2.5.13 / b344`;
  - remaining trade: `BNF Bear Put`, intraday, `57900/58100 W:200`;
  - card showed `Gross MTM: ₹0`, estimated round-trip cost `₹218.86`, `Net If Closed Now: ₹-218.86`;
  - mark quality showed `FULL`, quotes `2/2`, CI signals `45%`;
  - brain showed `EXIT · SOON`.

### Risk Interpretation

- Because the trade showed a gross value of `0`, the `b344` null-P&L guard did not block the close path.
- The failure therefore likely came from a UI/runtime close-path issue rather than the intentional null-valuation block.
- Mixed-version trade caveat remains: these trades were opened before the `b344` update and closed after the update, so they are useful for live smoke testing but not clean promotion evidence.

### Hotfix Prepared: v2.5.14 / b345

- Hardened close button invocation:
  - trade ids are passed through JSON-safe string encoding instead of inline raw interpolation.
  - this prevents a malformed/special trade id from breaking the `onclick` JavaScript.
- Hardened close state removal:
  - local removal now reads native open-trade state directly and returns the remaining count.
  - this reduces risk of stale `STATE.openTrades` preventing local card removal.
- Hardened close-path parsing:
  - replaced raw `JSON.parse(NativeBridge...)` calls in close path with safe bridge JSON helpers.
  - latest poll and chain snapshots are captured once for the close patch.
- Hardened close sync:
  - Supabase `trades_v2` close update is now awaited.
  - if Supabase close sync fails after local close, the app emits a visible notification-log warning instead of silently swallowing the failure.
- Version sync:
  - Android `versionName = 2.5.14`;
  - Android `versionCode = 345`;
  - Python `BRAIN_VERSION = 2.5.14`;
  - PWA visible label `v2.5.14 / b345`;
  - PWA cache-bust `app.js?v=1260`.

### Next Verification After b345 Install

- Confirm app displays `v2.5.14 / b345`.
- Open or keep one paper position.
- Wait for at least one poll with visible current valuation.
- Press Exit once.
- Expected:
  - confirmation dialog appears;
  - after confirming, the card disappears immediately;
  - notification log records the close;
  - Supabase `trades_v2` row changes to `CLOSED`;
  - `actual_pnl`, `friction_cost`, `net_pnl`, and `net_won` are written when available.
- If the close still fails, export logs immediately and inspect for `closeTrade error`, `Trade Close Sync Failed`, or `NativeBridge.setOpenTrades` failures.

## 2026-07-21 - Hotfix Correction: b345 Close Button Quoting Regression

### Observed After b345

- User installed `v2.5.14 / b345`.
- Both `Book Profit` and `Exit` buttons still did not work on the remaining paper trade.
- App had noticeable UI jitters but did not crash.
- Screenshot state:
  - app visible version `v2.5.14 / b345`;
  - poll status `40/40`;
  - open paper trade `BNF Bear Put 57900/58100 W:200`;
  - `Gross MTM: ₹145`;
  - estimated round-trip cost `₹220.09`;
  - `Net If Closed Now: ₹-75.09`;
  - mark quality `FULL`, quotes `2/2`, CI signals `45%`.

### Log Root Cause

- Exported log showed repeated WebView errors:
  - `Uncaught SyntaxError: Unexpected end of input @ https://vivekashokan007-cloud.github.io/MarketVivi/:1:12`
- This is consistent with the inline click handler being parsed as only:
  - `closeTrade(`
- Root cause was introduced in `b345`:
  - trade id was made JSON-safe using `JSON.stringify`;
  - but it was inserted inside a double-quoted HTML `onclick` attribute;
  - the inner JSON double quote terminated the attribute early;
  - browser saw a truncated handler and neither button could execute.

### Fix Prepared: v2.5.15 / b346

- Close buttons now render using single-quoted HTML attributes:
  - `onclick='closeTrade("id", "reason")'`
- Both trade id and close reason are JSON-safe JavaScript arguments.
- This preserves the safety goal from `b345` without breaking HTML attribute parsing.
- Native ML snapshot bridge now caches identical `getMLBrainSnapshots()` payloads for 60 seconds.
- Cache key includes evaluation date, requested row cap, local file size, and last-modified timestamp.
- This prevents repeated UI refreshes from rereading and compacting the same ~MB-scale local teacher snapshot payload.
- Version sync:
  - Android `versionName = 2.5.15`;
  - Android `versionCode = 346`;
  - Python `BRAIN_VERSION = 2.5.15`;
  - PWA visible label `v2.5.15 / b346`;
  - PWA cache-bust `app.js?v=1261`.

### Jitter Observation

- Log shows repeated large local snapshot reads:
  - `LOCAL_SNAPSHOT_READ_RECENT` around `1.8 MB` rows from a local file around `66.7 MB`;
  - frequent `ML_BRAIN_SNAPSHOTS_BRIDGE` reads while UI is active.
- Polling did not crash, but UI jitter likely remains tied to large bridge/local-cache payload movement during active rendering.
- `b346` addresses the first safe layer by throttling duplicate native bridge reads.
- This does not delete or alter stored teacher evidence, rejected candidates, generated candidates, brain ranking, exit logic, or Supabase writes.
- If jitter continues after `b346`, next investigation should profile payload size reduction in the ML tab only; that would need more design caution because it may reduce visible evidence detail.

## 2026-07-21 - Paper Close Valuation Integrity Fix Prepared

### Evidence After b346

- Supabase verification on 2026-07-21 showed that close-button execution was repaired, but close persistence was still only partially clean.
- Healthy closed rows existed:
  - `id 179` (`NF BEAR_PUT`) with non-null `actual_pnl`, `exit_premium`, `net_pnl`, `net_won`;
  - `id 182` (`BNF BEAR_PUT`) with non-null `actual_pnl`, `exit_premium`, `net_pnl`, `net_won`.
- Dirty closed rows also existed on the same session:
  - `id 180` closed with `actual_pnl = 0`, `exit_premium = null`, `net_pnl = -186.79`;
  - `id 181` closed with `actual_pnl = 0`, `exit_premium = null`, `net_pnl = -185.64`.

### Root Cause

- Python position valuation already emits explicit unavailable state when it cannot produce a valid live mark:
  - `_stamp_unavailable_position_valuation(...)` sets `current_pnl = None`;
  - position valuation is marked `unavailable`.
- Android native sync in `MarketWatchService.kt` was then overwriting those nullable fields with:
  - `live.optDouble("current_pnl")`
  - `live.optDouble("current_net_premium")`
- `JSONObject.optDouble(...)` returns `0.0` when the key is absent or null.
- Result:
  - unavailable valuation got silently converted into fake zero P&L and fake zero/blank premium state in `open_trades`;
  - PWA close guard only blocked `null`, not fake zero;
  - closing a paper trade in that state persisted dirty labels to Supabase.

### Fix Prepared: v2.5.16 / b347

- Native sync now preserves nullable live valuation fields instead of coercing them to `0.0`.
- `MarketWatchService.kt` now writes:
  - `current_pnl`
  - `current_spot`
  - `current_premium`
  - `peak_pnl`
  - `trough_pnl`
  - `peak_erosion`
  - `vix_change`
  using nullable finite-number helpers.
- `journey` is only overwritten if it is present in the live payload.
- PWA close guard is hardened:
  - paper close is blocked if `current_premium` is unavailable;
  - paper close is blocked if `valuation_quality` is `degraded` or `unavailable`.
- Version sync:
  - Android `versionName = 2.5.16`;
  - Android `versionCode = 347`;
  - Python `BRAIN_VERSION = 2.5.16`;
  - PWA visible label `v2.5.16 / b347`;
  - PWA cache-bust `app.js?v=1262`.

### Scope / Non-Scope

- This fix does not alter:
  - candidate generation,
  - the `1.10 EV` gate,
  - teacher ranking,
  - friction formula,
  - Supabase schema.
- It only prevents invalid close-state persistence when live valuation is unavailable or degraded.

## 2026-07-21 - Post-Close ML Evaluation Chain Fetch Fixes

### Failure After Market Close

- Post-close ML evaluation failed on 2026-07-21 after the app had otherwise collected the day.
- Log evidence showed:
  - `ML_BRAIN_SNAPSHOTS_BRIDGE: date=2026-07-21 rows=1 requested=5 maxRows=5 payloadBytes=280828`
  - `LOCAL_SNAPSHOT_READ_RECENT: date=2026-07-21 rows=1 bytes=1753618 fileBytes=65727357 limit=5 byteCap=2097152`
  - `EVAL_FAIL[PREPARING]: EVAL_CHAIN_TRUNCATED`
- First failure mode:
  - `ml_option_chain_snapshots.filtered_recent.filtered_stream hit page cap after 200 pages and 0 filtered rows`
- Root cause:
  - exact `session_date` chain lookup returned no rows;
  - fallback used broad recent scans without a bounded session window;
  - Supabase pagination reached page cap before relevant rows were found.
- This was classified as an implementation/data-fetch architecture issue, not a Claude/brain-design issue.

### Fix Released: v2.5.17 / b348

- Native `SupabaseClient.kt` chain fetch was changed to:
  - keep exact `session_date` sources first;
  - make recent fallback newest-first;
  - cap broad recent fallback at 30 pages instead of 200;
  - continue to the next chain source when fallback is capped with zero filtered rows;
  - preserve chronological output by reversing buffered newest-first fallback rows.
- Version sync:
  - Android `versionName = 2.5.17`;
  - Android `versionCode = 348`;
  - Python `BRAIN_VERSION = 2.5.17`;
  - PWA visible label `v2.5.17 / b348`.
- Pushed synchronized:
  - `Marketapp` HEAD `a4c9f599d1496432d4d94edb1c457097067e54ab`;
  - `MarketVivi` HEAD `389ba6734abb006724ad12bf60ed2fb00685f5f0`.

### Second Failure After b348

- User reported ML evaluation failed again after b348.
- New log evidence showed a different failure:
  - `EVAL_CHAIN_TRUNCATED: ml_option_chain_snapshots.filtered_recent.filtered_stream hit page cap after 30 pages and 560 filtered rows`
- Interpretation:
  - b348 fixed the empty broad-scan failure;
  - but broad recent fallback was still not the correct primary recovery path;
  - it found relevant rows, but still declared truncation because fallback could not prove complete coverage.
- Decision:
  - do not ask Claude yet;
  - add a precise bounded `poll_ts` session-window fallback before the broad recent fallback.

### Fix Released: v2.5.18 / b349

- Native `SupabaseClient.kt` now computes the IST session date as a UTC window:
  - example for `2026-07-21` IST:
  - start `2026-07-20T18:30:00Z`;
  - end `2026-07-21T18:30:00Z`.
- Chain source order is now:
  - exact `ml_option_chain_snapshots?session_date=eq.<date>`;
  - exact `chain_slices?session_date=eq.<date>`;
  - bounded `ml_option_chain_snapshots?poll_ts=gte.<startUtc>&poll_ts=lt.<endUtc>`;
  - bounded `chain_slices?poll_ts=gte.<startUtc>&poll_ts=lt.<endUtc>`;
  - broad newest-first recent fallback only as last resort.
- Both full-chain fetch and leg-filtered streaming use this bounded window path.
- Purpose:
  - avoid Supabase-throttling-prone broad scans;
  - avoid page-cap truncation when `session_date` is missing but `poll_ts` is valid;
  - preserve teacher/post-close ML evaluation input integrity.
- Version sync:
  - Android `versionName = 2.5.18`;
  - Android `versionCode = 349`;
  - Python `BRAIN_VERSION = 2.5.18`;
  - PWA visible label `v2.5.18 / b349`.
- Pushed synchronized:
  - `Marketapp` HEAD `d79e0589d84e964feb32507f271b1f50337cdef3`;
  - `MarketVivi` HEAD `87163e98e1c222641a17e635db080e5069c6154a`.

### Verification Result

- User confirmed after installing/running the latest update:
  - ML evaluation succeeded.
- Current conclusion:
  - the post-close evaluation failure was caused by unbounded/imprecise chain fallback selection;
  - the bounded `poll_ts` UTC-window fallback in `b349` is the working fix.

### Important Follow-Up

- This does not change:
  - brain ranking;
  - `1.10 EV` gate;
  - candidate construction;
  - teacher labels;
  - paper/sandbox order behavior.
- If ML evaluation fails again, first inspect whether the selected chain source is:
  - exact `session_date`;
  - bounded `poll_window`;
  - or broad `filtered_recent`.
- Broad `filtered_recent` should now be considered an emergency fallback only; repeated use means the Supabase schema/write path still lacks reliable `session_date` on chain rows.

## 2026-07-22 - D3A/D4/D7 Brain Probability Work, Claude Consultation, Local Push Gate

### Current Native Branch

- Native repo:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/Marketapp-main-worktree`
- Active branch:
  - `d4-d7-payload-semantics-cleanup`
- Branch is local and not pushed yet.
- Native working tree is clean after the latest local commits.

### Local Commit Chain

- `eff3a46` - `D7 add precision parity guards`
- `806615f` - `D7 unify probability semantics`
- `7df1f43` - `D4 clarify EV payload semantics`
- `5f2de86` - `D3A aggregate blocked candidate replay`
- `957a23a` - `D3 add blocked candidate replay report`
- `5b90c9c` - `D3 preregister blocked candidate replay`

### D3A Completed Locally

- Tool:
  - `Marketapp-main-worktree/tools/d3_blocked_candidate_replay.py`
- Report:
  - `Marketapp-main-worktree/reports/d3a_full_replay_report_20260707_20260721.md`
- CSV:
  - `Marketapp-main-worktree/reports/d3a_full_replay_rows_20260707_20260721.csv`
- Main result:
  - A8 is broadly protective, but false negatives are meaningful.
  - This supports adaptive branch design, not a flat removal of the `1.10 EV` floor.
- D3A is local commit `5f2de86`.

### D4 Implemented Locally

- Commit:
  - `7df1f43 D4 clarify EV payload semantics`
- Main changes:
  - Replaced vague `ALL_NEGATIVE_EV` with explicit floor reason:
    - `ALL_BELOW_EV_RATIO_FLOOR_1_1`
  - Added A8 diagnostic/evidence fields:
    - `ev_ratio`
    - `a8_expected_win`
    - `a8_expected_loss`
    - `a8_ev_floor`
    - `a8_ev_ratio`
    - `a8_pass`
    - `build3EvRatio`
  - Added named display constant:
    - `DISPLAY_EV_PROFIT_HAIRCUT = 0.65`
  - Fixed ranking fallback:
    - missing `premiumEdge` no longer falls back to `ev`;
    - missing edge candidates rank below edge-carrying candidates;
    - `premium_edge_status = MISSING` is stamped.
- D4 does not change:
  - A8 floor;
  - ranking sort-key structure;
  - teacher outcomes;
  - lot handling;
  - tick service;
  - sandbox.

### D7 Implemented Locally

- Commit:
  - `806615f D7 unify probability semantics`
- Main changes:
  - `probProfit` is now the canonical runtime probability field.
  - `trueProb` is retained only as a deprecated compatibility alias.
  - `trueProb` is emitted equal to `probProfit` in payloads.
  - Added probability metadata:
    - `prob_source = CHAIN_DELTA_IV` when chain/interpolated delta exists;
    - `prob_source = BS_FALLBACK_IV` when Black-Scholes fallback is used;
    - `prob_status = OK` when probability is present;
    - `prob_status = DEFAULT_0_5` when risk evaluation must use the explicit 0.5 fallback.
  - Removed realized-vol `trueProb` divergence.
  - `premiumEdge` now uses raw probability and the unhaircuted formula:
    - `round(prob * maxProfit - (1 - prob) * maxLoss)`
  - Display `ev` remains separate and still uses `DISPLAY_EV_PROFIT_HAIRCUT = 0.65`.
  - Removed Phase 3 fake source:
    - `trueProb_realized_vol_proxy_interim`
  - Removed Phase 4/D3 signed probability-disagreement fields:
    - `prob_trueProb_delta`
    - `a8_disagreement_pair_logged`
    - `signed_disagreement`
    - `signed_disagreement_bucket`
    - `avg_signed_disagreement`
- D7 does not change:
  - A8 floor;
  - ranking sort-key structure;
  - thresholds;
  - teacher outcomes;
  - lot handling;
  - tick service;
  - sandbox.

### Claude D7 Consultation

- Consultation file created for Claude:
  - `/root/Documents/Codex/2026-07-04/this-my-project-read-and-understand/CLAUDE_D7_CONSULTATION_PROOF_20260722.txt`
- Claude ruling file:
  - `/tmp/codex-web-uploads/f-F58sxh/CLAUDE_RULING_D7_CONSULTATION_20260722.md`
- Issue raised:
  - OpenClaw flagged a conflict between the D7 directive asking for AB-676 `premiumEdge = 892` and A8 rounded expected values:
    - `expected_win = 4704.11`
    - `expected_loss = 3820.11`
    - hand difference = `884.00`
- Claude ruling:
  - `892` is not a typo.
  - `884` is not the correct `premiumEdge`.
  - Both are valid numbers from different precision boundaries:
    - `premiumEdge = 892` comes from raw probability before payload rounding;
    - A8 `4704.11 - 3820.11 = 884` comes from rounded payload `probProfit`.
  - The precision split is a known wart and must be documented, not harmonized now.

### D7 Precision Guard Follow-Up

- Commit:
  - `eff3a46 D7 add precision parity guards`
- Added comment at A8 read site:
  - A8 consumes payload-rounded `probProfit` at 3 decimals.
  - `premiumEdge` uses raw probability.
  - Do not harmonize without a measured decision.
- Corrected AB-676 test:
  - raw-prob path gives `premiumEdge = 892`;
  - rounded payload `probProfit = 0.407`;
  - A8 rounded values still give:
    - `a8_expected_win = 4704.11`
    - `a8_expected_loss = 3820.11`
    - `a8_ev_floor = 4202.12`
    - `a8_ev_ratio = 1.2314`
- Added D3 replay guard:
  - D3 replay reads stored `premiumEdge`;
  - it does not recompute `premiumEdge` from rounded `probProfit`;
  - this prevents an `892 -> 884` class drift in analysis outputs.
- New test:
  - `app/src/main/python/tests/test_d7_probability_semantics.py`

### Verification Passed After D7 Follow-Up

- Commands run from native repo:
  - `python app/src/main/python/tests/test_gate3_structural_counts.py`
  - `python app/src/main/python/tests/test_gate5_trace_smoke.py`
  - `python app/src/main/python/tests/test_build3_a8_nf_ab.py`
  - `python -m unittest app/src/main/python/tests/test_d7_probability_semantics.py`
  - `python -m unittest app/src/main/python/tests/test_phase3_expected_r_shadow.py app/src/main/python/tests/test_phase4_ev_ladder_shadow.py app/src/main/python/tests/test_stage2a_guarded_ranking.py app/src/main/python/tests/test_phase_d.py app/src/main/python/tests/test_d7_probability_semantics.py`
  - `python -m py_compile app/src/main/python/brain.py tools/d3_blocked_candidate_replay.py`
- Results:
  - Gate 3 structural audit passed.
  - Gate 5 trace smoke passed.
  - Build 3 A8/NF/AB tests passed.
  - D7 probability semantics test passed.
  - Broader unittest set passed:
    - `99 tests OK`
  - `py_compile` passed.
- Cleanup scan:
  - banned live fields removed.
  - only remaining `prob_trueProb_delta` hit is a test assertion verifying absence:
    - `self.assertNotIn("prob_trueProb_delta", row)`

### Current Push Gate

- Claude has ruled the D7 precision issue and requested the extra guard/test.
- OpenClaw implemented the extra guard/test and verified it locally.
- Next decision belongs to Vivek:
  - push the local branch only on explicit user command.
- If pushing, remember project rule:
  - both repos must be pushed in sync with versioning when a release path is intended.
- Current D4/D7 work is brain/tool/test only and has not yet triggered OTA.

## 2026-07-22 - Forward Path Ruling After D7 Merge

### D7 Merge State

- Claude ruling received:
  - `/tmp/codex-web-uploads/f-H7Q4NN/CLAUDE_RULING_D7_PUSHED_BRANCH_20260722.md`
- Claude verdict:
  - D4/D7 pushed branch at `eff3a46013ab03f39f83fa707c5a92b986ad60ed` passed verification.
  - Branch was correct, zero-behavior on live decisions, and ready for Vivek merge/release decision.
- Action taken after Vivek command:
  - native `main` fast-forwarded to `eff3a46013ab03f39f83fa707c5a92b986ad60ed`.
  - native `main` pushed to GitHub.
- Current native state:
  - `Marketapp-main-worktree` on `main`.
  - `main` is clean and matches `origin/main`.
  - latest native HEAD:
    - `eff3a46013ab03f39f83fa707c5a92b986ad60ed`
- No OTA/version bump was triggered by this D7 merge.
- No MarketVivi push was performed in the D7 merge step.

### Forward Path Ruling

- Claude ruling received:
  - `/tmp/codex-web-uploads/f-iPDSdD/CLAUDE_RULING_FORWARD_PATH_20260722.md`
- Claude says the older D1-D6 / Phase-number / P6-P9 framing is superseded as the active schedule.
- New authoritative queue:
  1. Chapter A - close Phase 0 integrity.
  2. Chapter B - evidence engine: Class B parity plus E1.
  3. Chapter C - dynamic brain, built only on evidence.
  4. Chapter D - forward validation to real money.
- D1-D6 is not discarded, but it now maps into Chapter A / early Chapter B task detail.
- Old P6-P9 schedule is superseded-as-scheduled.

### What Claude Now Considers Complete

- D4/D7 payload/probability cleanup:
  - merged native `main` at `eff3a46`.
- D3A blocked-candidate replay:
  - tool/report/CSV shipped.
- D1 tick-units code:
  - shipped in b350 per Claude's prior verification.
  - D1 report package remains owed, but code is not the next implementation target.
- `pnl_engine --apply`:
  - marked done by Claude, classified `2026-07-21`, with `60/29/85` live.
- Close-path null fix:
  - code considered done by Claude.
  - remaining issue is device/forward evidence confirmation.

### What Is Still Open

- A-1:
  - one clean G2 forward friction close on a b350+ device.
  - Supabase must show:
    - `actual_pnl`
    - `friction_cost`
    - `net_pnl`
    - `net_won`
  - arithmetic must show:
    - `net_pnl = actual_pnl - friction_cost`
  - this proves close-path, friction path, and honest label writing end to end.
- A-2:
  - confirm device is b350 or later.
- A-3:
  - Task A entry-basis provenance remains open but is non-blocking for starting Chapter B prep.
  - It must be resolved before trusting historical Class B outcomes for the edge map.

### E1 Pre-Registration

- File received:
  - `/tmp/codex-web-uploads/f-ZQeuDW/E1_PREREGISTRATION_INCONTEXT_MODEL_BAKEOFF_20260722-1.md`
- E1 is a pre-registered offline in-context tabular model bake-off.
- Candidate models:
  - TabICL
  - TabPFN v2
  - TabFM 1.0.0 as ceiling reference only, not deployable if non-commercial licensing applies.
  - frozen deployed model as baseline.
  - base rate/regime prior as baseline.
- E1 is offline only:
  - no phone code.
  - no live decision path.
  - no LLM hot path.
  - no ranking authority.
- E1 runs after Phase 0's closing-release push lands.
- A qualifying model earns only active-shadow eligibility, not live authority.

### Current Next Step

- Single next target per Claude:
  - A-1 - capture and verify one clean G2 forward friction close on a b350+ device.
- While waiting for live market conditions:
  - E1 prep may begin because it is offline and does not touch the live path.
  - Class B parity harness prep may also begin.
- Do not work on yet:
  - dynamic-brain code.
  - composer.
  - session belief-state.
  - fitted regime weights.
  - LLM hot path.
  - sandbox.
  - live A8 floor change.
  - real-money path.
  - ranking sort-key change.

### Local Repo Nuance

- `MarketVivi-git` currently has:
  - local `main` ahead of `origin/main` by one commit:
    - `5c39718 Release v2.5.19 web sync`
  - the ahead commit changes only `index.html` version labels.
  - `PROJECT_KNOWLEDGE.md` is modified locally and uncommitted.
- This does not block A-1 because Claude's forward ruling treats the web/docs state as non-blocking, but it should be kept visible before any synchronized release decision.

## 2026-07-22 - A-1 G2 Forward Friction Close Evidence

### Bounded Supabase Check

- Purpose:
  - verify Claude's A-1 gate using today's closed paper trades.
- Query scope:
  - table `public.trades_v2`
  - `status = CLOSED`
  - `paper = true`
  - IST trading-day UTC window:
    - `exit_date >= 2026-07-21T18:30:00Z`
    - `exit_date < 2026-07-22T18:30:00Z`
  - selected only close/friction fields.
- Rows found:
  - `2`

### Trade Rows Verified

- Trade `id = 184`
  - strategy: `NF BEAR_PUT`
  - entry: `2026-07-22T07:25:05.445Z`
  - exit: `2026-07-22T09:28:14.712Z`
  - `actual_pnl = 244`
  - `friction_cost = 153.07`
  - `net_pnl = 90.93`
  - `net_won = true`
  - arithmetic:
    - `244 - 153.07 = 90.93`
  - `friction_version = G2_v1`
  - close trace:
    - `source = manual_close`
    - `capture_phase = POSITION_P1`
    - `policy_version = POSITION_POLICY_V1`
    - `position_tick_capture.mark_basis = EXECUTABLE_SIDE`

- Trade `id = 183`
  - strategy: `BNF BEAR_PUT`
  - entry: `2026-07-22T04:05:24.684Z`
  - exit: `2026-07-22T06:38:01.409Z`
  - `actual_pnl = 891`
  - `friction_cost = 183.13`
  - `net_pnl = 707.87`
  - `net_won = true`
  - arithmetic:
    - `891 - 183.13 = 707.87`
  - `friction_version = G2_v1`
  - close trace:
    - `source = manual_close`
    - `capture_phase = POSITION_P1`
    - `policy_version = POSITION_POLICY_V1`
    - `position_tick_capture.mark_basis = EXECUTABLE_SIDE`

### A-1 Interpretation

- The required A-1 database evidence is present:
  - non-null `actual_pnl`
  - non-null `friction_cost`
  - non-null `net_pnl`
  - non-null `net_won`
  - net arithmetic reconciles exactly to 2 decimals.
- This is enough for the G2 forward-friction close data check if the device build is confirmed as `b350+`.
- Remaining A-1/A-2 closure caveat:
  - explicitly confirm installed app build was `b350` or later during these closes.

## 2026-07-22 - Claude Ruling: Chapter A Closed

### Source

- File received:
  - `/tmp/codex-web-uploads/f-98K6Kk/CLAUDE_RULING_A1_CHAPTER_A_CLOSED_20260722.md`

### Final Chapter A Verdict

- Claude independently verified the A-1 evidence against live Supabase data.
- Final ruling:
  - `A-1 PASSED`
  - `A-2 PASSED`
  - `A-3 carried non-blocking`
  - `CHAPTER A (INTEGRITY) CLOSED`

### Claude's Additional Independent Checks

- OC's original packet verified field presence and arithmetic:
  - trade `183`: `891 - 183.13 = 707.87`
  - trade `184`: `244 - 153.07 = 90.93`
- Claude added deeper anti-fabrication checks:
  - gross P&L reconciles to real price movement:
    - trade `183`: `(219.4 - 189.7) * 30 = 891.00`
    - trade `184`: `(97 - 93.25) * 65 = 243.75`, rounded to `244`
  - `position_ticks` independently corroborate both trades:
    - trade `183`: 148 ticks
    - trade `184`: 121 ticks
  - tick units are confirmed as rupees, proving the b350 D1 lot-size fix is live:
    - trade `183` mark reconstruction matched executable mark.
    - lot sizes resolved as `30` for BNF and `65` for NF.
  - friction is real and itemized:
    - `slippage_basis = LIVE_BID_ASK`
    - `missing_spread_labels = []`
    - `rates_version = tc_2026_07_A`
    - brokerage, STT, GST, exchange, SEBI, stamp, and slippage all present.

### What Chapter A Closure Means

- The following integrity defects are now considered fixed on live evidence:
  - close-path null-to-zero fabrication.
  - tick lot-unit corruption.
  - fabricated stop-loss auto-labels.
  - missing or placeholder friction accounting.
  - P&L engine classification path.
- Forward labels are now trusted for downstream evidence work.
- Historical entry-basis provenance remains open as `A-3`, but it is non-blocking for Chapter B start.

### New Authorized Phase

- Chapter B is now GO.
- Authorized parallel tracks:
  - Track 1: Class B parity gate, Tier 1, 5 reference-day harness proof.
  - Track 2: E1 in-context model bake-off, per preregistration.
- Still forbidden until later directive:
  - live dynamic-brain authority.
  - live ranking sort-key change.
  - fitted weights in production.
  - LLM hot path.
  - sandbox/live order authority.
  - real-money path.

### Owed Non-Blocking Debts To Attach To Next Artifact

- D1 report package, now with 2026-07-22 live working proof.
- `629 -> 620` replay-row accounting.
- corrected `MarketVivi` SHA.
- D5 `a8_bypassed` count.

## 2026-07-22 - Chapter B Start Audit

### Native Report Created

- File:
  - `Marketapp-main-worktree/reports/CHAPTER_B_START_AUDIT_20260722.md`

### Harness Safety Patch

- File modified:
  - `Marketapp-main-worktree/historical_replay_harness.py`
- Reason:
  - the first Class B audit attempt hit a Supabase statement timeout on an unbounded ordered `historical_option_candles` span query.
- Patch:
  - `_fetch_historical_option_sample(...)` now accepts optional `date_from` / `date_to`.
  - `_fetch_historical_option_span(...)` now accepts optional `date_from` / `date_to`.
  - `class_b_audit(...)` passes the requested date window into both helpers.
- Effect:
  - Class B audit no longer needs a global historical-candle table scan just to establish sample/span context.

### Verification

- Syntax check passed:
  - `python3 -m py_compile historical_replay_harness.py`

### Bounded Class B Audit Result

- Command shape:
  - `python3 historical_replay_harness.py --class-b-audit --from 2026-07-07 --to 2026-07-22 --sample-days 10`
- Result:
  - original global timeout removed.
  - Supabase then returned Cloudflare origin errors:
    - HTTP `525` SSL handshake failed.
    - HTTP `521` origin down.
  - no aggressive retry loop was run because of the standing Supabase throttling discipline.
- Partial data before Supabase failures:
  - `2026-07-07`: 75 snapshots, 74 Class A, 510 generated candidates.
  - `2026-07-08`: 76 snapshots, 75 Class A, 99 generated candidates.
- Current Chapter B parity status:
  - `BLOCKED_BY_SUPABASE_ORIGIN`
  - not a brain failure.
  - not a parity-harness failure.

### Owed Debt Resolution Notes

- `629 -> 620` replay-row accounting:
  - original single-day D3 artifact has 646 total rows.
  - 26 rows are `teacher_eval_match`.
  - 620 rows are `simulated_trace`.
  - therefore `620` is the simulated subset, not the total replay population.
- Wider D3A retained artifact:
  - 10,676 rows total.
  - 831 `teacher_eval_match`.
  - 9,378 `simulated_trace`.
  - 467 `pricing_failed`.
- D5 `a8_bypassed`:
  - not present in retained D3/D3A CSV columns.
  - cannot be honestly reconstructed from current artifacts.
  - must locate original D5 artifact or rerun D5 generator if needed.

### Next Safe Chapter B Step

- Wait for Supabase stability.
- Then run one-day Class B audit/extract/local-parity first.
- Expand to five reference days only after the one-day local parity result is understood.
- Continue to avoid live phone code, A8 floor changes, sandbox authority, and ranking changes until explicitly authorized.

### 2026-07-22 - One-Day Chapter B Micro-Probe Clarification

- After the bounded harness patch, a one-day-only Class B check was run for `2026-07-07`.
- One-day audit output:
  - `75` snapshots.
  - `74` Class A snapshots.
  - `510` generated candidates.
  - `historical_option_candles_sample_rows = 0`.
  - `daily_data_probe.rows_sampled = 0`.
- Direct REST micro-probes then confirmed:
  - `historical_option_candles` is populated globally.
  - a global existence probe returned a real row from `2024-09-26`.
  - bounded probe for `2026-07-07` returned `[]`.
  - `daily_data` probe for `2026-07-07` returned `[]`.
- Correct interpretation:
  - this is not currently a brain logic failure.
  - this is not currently a Class B harness defect.
  - this is not currently a one-day Supabase outage.
  - the blocker is missing reference-day data coverage for `2026-07-07` through the current historical data path.
- Therefore the next Class B parity attempt must use a day that has:
  - saved Class A snapshots, and
  - matching `historical_option_candles` rows, and
  - matching `daily_data` rows.

### 2026-07-23 - Chapter B Reference Window Coverage Check

- Additional direct REST micro-probes were run for:
  - `2026-07-08`
  - `2026-07-09`
  - `2026-07-10`
- Result for `daily_data`:
  - all three dates returned `HTTP 200` with `[]`
- Result for `historical_option_candles`:
  - all three dates returned `HTTP 200` with `[]`
- Combined with the earlier `2026-07-07` result, the tested July 2026 reference window `2026-07-07` through `2026-07-10` currently has:
  - saved brain snapshots present
  - but no matching `daily_data`
  - and no matching `historical_option_candles`
- Correct interpretation:
  - the current blocker is not Supabase throttling for these tiny reads.
  - the current blocker is not the Class B harness.
  - the current blocker is missing historical backing coverage for the tested July 2026 Chapter B days through the current Supabase path.
- Implication:
  - Class B parity on July 2026 reference days cannot proceed until we either populate those historical tables or identify the correct alternate historical source/path.
