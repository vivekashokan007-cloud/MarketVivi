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
