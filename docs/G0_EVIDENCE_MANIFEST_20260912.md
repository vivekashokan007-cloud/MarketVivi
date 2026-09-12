# G0 Evidence Manifest — 2026-09-12

**Package:** G0 (read-only foundation)  
**Plan:** `docs/PLAN_final_implementation_20260912.md`  
**Executor:** Grok Bot  
**Boundaries honored:** no trading/security behavior changes; training remains frozen; live orders remain disabled; no secrets in this artifact.

## 1. Source SHAs vs plan pin

| Repository | Plan pin (when plan written) | Fetched `origin/main` at G0 start | Drift |
|---|---|---|---|
| Marketapp | `1d6b7f7504cc92e1157448489dad816d7790443e` | `1d6b7f7504cc92e1157448489dad816d7790443e` | **None** — tip still `1d6b7f7` (*docs: sync CLAUDE.md markers to v2.6.35 / b466 (F5)*) |
| MarketVivi | `6533917d8833905f5b5a890654c76684791d0efd` | `1c79e836a0e3eeab68f9f33ef99a76eb52ff3329` | **Docs-only drift** — `6533917..1c79e83` = one commit: *Add final implementation plan for Grok (2026-09-12)* |

Worktree for this package: `/workspace/g0-manifest/{Marketapp,MarketVivi}`.

## 2. App / brain / PWA versions

| Surface | Value | Source |
|---|---|---|
| Android `versionName` | `2.6.35` | `Marketapp/app/build.gradle.kts` |
| Android `versionCode` | `466` | same |
| Python `BRAIN_VERSION` | `2.6.35` | `Marketapp/app/src/main/python/brain.py` |
| Python `TRACE_SCHEMA_VERSION` | `1.1` | same |
| PWA label | `v2.6.35 · b466` | `MarketVivi/index.html` title + version span |

**Note:** Latest `ml_brain_snapshots` recorded decision versions observed in DB top out at **2.6.27** (2026-09-11). No 2.6.28–2.6.35 snapshot rows were present at probe time — device/runtime may not have uploaded post-b466 polls yet. Do not conflate shipped label with observed decision telemetry.

## 3. Model / teacher asset hashes (repo-bundled)

Paths under `Marketapp/app/src/main/assets/`. SHA-256 of file bytes:

| Asset | Bytes | SHA-256 | Embedded metadata |
|---|---:|---|---|
| `ml_model.json` | 167595 | `795b333049dbab16715a907d172d612f9fe4f4d6156b76ada4a2c6eee21d5dfd` | `version=2.1.1`, `trained=true`, `n_train=8372`, `base_wr≈0.5876` |
| `temporal_model.json` | 7874 | `92e8f0df1628daa1610cd606706dbfaa20ddae26eda5310683846322024217fd` | `ver=1.0`, `trained=true`, `n_train=8372` |
| `teacher_table_stage2a.json` | 12014 | `9ed5bdf3909062ecbb6201cfd2ea4125ab21131bc6d05cbccb9ac8fc78bde655` | `schema=stage2a_teacher_table_v1`, scope `2026-06-01..2026-06-25`, `generated_at_utc=2026-06-28T15:12:46Z`, 46 rows |

`ml_models` DB table was not used as the hash source (historically empty / device-local models may differ). No additional `.pkl`/`.onnx` brain artifacts found in-repo. Device-local overrides: **unavailable in this checkout**.

## 4. Schema / migration notes

### Key public tables (inventory sample)

Outcome / learning path: `ml_recommendation_outcomes`, `ml_recommendation_outcomes_archive`, `ml_evaluation_outcomes`, `ml_recommendation_outcomes_s1`, `ml_evaluation_outcomes_s1`, `ml_rejected_candidate_outcomes`, `ml_brain_snapshots`, `ml_generated_candidates`, `ml_context_percentile_history`, `ml_performance`, `ml_models`, `ml_decisions`, `ml_pc2_authority_decisions`.

Trades / ticks: `trades`, `trades_v2`, `trade_log`, `position_ticks`, `sandbox_orders`, `app_config`.

### `ml_recommendation_outcomes.snapshot_id NOT NULL` — already applied

Confirmed via `information_schema`:

- `ml_recommendation_outcomes.snapshot_id` → `bigint`, **`is_nullable = NO`**
- Live null count at probe: **0 / 304881**
- Applied remote migration: `20260912082710_ml_recommendation_outcomes_snapshot_id_not_null`
- Preceding archive move: `20260912050330_archive_null_snapshot_reco_20260910`
- Archive retains nullable `snapshot_id`; archive rows with null snapshot: **8296 / 8296** (quarantine cohort)

### Remote migration tip (Supabase project `fdynxkfxohbnlvayouje`)

Latest listed versions include RLS enablement (`20260816132620`), PC2 authority, generated-candidate versions, then the 2026-09-12 archive + NOT NULL migrations above. Repo `Marketapp/supabase/migrations/` still ends at 2026-08-18 locally — remote is ahead for the null-snapshot work (already applied in production).

## 5. Python unittest baseline

Command (Marketapp repo root):

```bash
python3 -m unittest discover -s app/src/main/python/tests -q
```

**Actual result (G0 run, checkout `1d6b7f7`):**

- Exit code: **0**
- Summary line: **`Ran 605 tests in 3.429s` → `OK`**
- Matches the plan’s historical pinned baseline of 605; Claude’s unprovided 627-test patch was **not** present and was **not** counted.

Android/Gradle and full PWA CI were **not** executed in this package (no device/JDK gate claimed). Do not treat unrun checks as passed.

## 6. Pre-fix defect probes (read-only)

Project: Supabase `fdynxkfxohbnlvayouje` (ap-south-1). Queries are reproducible; no writes performed.

### 6.1 Peak / trough zeros on closed paper (`trades_v2`)

```sql
WITH closed_paper AS (
  SELECT id, peak_pnl, trough_pnl, actual_pnl, net_pnl, friction_cost, pnl_engine,
         NULLIF(close_trace_json->>'peak_pnl','')::numeric AS trace_peak
  FROM trades_v2
  WHERE UPPER(COALESCE(status,'')) IN ('CLOSED','CLOSE','EXITED')
    AND (paper IS TRUE
         OR LOWER(COALESCE(trade_mode,'')) LIKE '%paper%'
         OR LOWER(COALESCE(execution_mode,'')) LIKE '%paper%')
), netlab AS (
  SELECT * FROM closed_paper WHERE net_pnl IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM closed_paper) AS closed_paper_n,
  (SELECT COUNT(*) FROM closed_paper WHERE COALESCE(peak_pnl,0)=0) AS all_top_peak_zero,
  (SELECT COUNT(*) FROM closed_paper WHERE COALESCE(peak_pnl,0)<>0) AS all_top_peak_nonzero,
  (SELECT COUNT(*) FROM netlab) AS net_labelled_n,
  (SELECT COUNT(*) FROM netlab WHERE COALESCE(peak_pnl,0)=0) AS netlab_top_peak_zero,
  (SELECT COUNT(*) FROM netlab WHERE COALESCE(peak_pnl,0)=0 AND COALESCE(trace_peak,0)>0)
    AS netlab_zero_top_positive_trace_peak,
  (SELECT COUNT(*) FROM netlab WHERE pnl_engine IS NULL) AS netlab_engine_null,
  (SELECT COUNT(*) FROM netlab WHERE pnl_engine='UNKNOWN') AS netlab_engine_unknown,
  (SELECT COUNT(*) FROM closed_paper WHERE pnl_engine='RECONCILED') AS reconciled_n,
  (SELECT COUNT(*) FROM closed_paper WHERE pnl_engine='RECONCILED' AND net_pnl IS NOT NULL)
    AS reconciled_with_net,
  (SELECT ROUND(SUM(actual_pnl)::numeric,2) FROM netlab WHERE pnl_engine IS NULL) AS gross_engine_null,
  (SELECT ROUND(SUM(friction_cost)::numeric,2) FROM netlab WHERE pnl_engine IS NULL) AS friction_engine_null,
  (SELECT ROUND(SUM(net_pnl)::numeric,2) FROM netlab WHERE pnl_engine IS NULL) AS net_engine_null,
  (SELECT ROUND(SUM(net_pnl)::numeric,2) FROM netlab WHERE pnl_engine='UNKNOWN') AS net_unknown;
```

**Result (2026-09-12 probe):**

| Metric | Value |
|---|---:|
| Closed paper trades | 268 |
| Top-level `peak_pnl` nonzero | 98 |
| Top-level `peak_pnl` zero/null | 170 |
| Net-labelled | 97 |
| Net-labelled with top peak 0 | **97** |
| Of those, positive `close_trace_json.peak_pnl` | **64** |
| Net-labelled, `pnl_engine` null | 92 (gross 22025.00 / friction 20791.88 / **net 1233.12**) |
| Net-labelled, `pnl_engine='UNKNOWN'` | 5 (net **-994.29**) |
| `RECONCILED` rows | 60 |
| `RECONCILED` with net label | **0** |

Reproduces the plan’s peak and cohort figures. Journey peak lives under `close_trace_json.peak_pnl`, not top-level.

### 6.2 Archive RLS / grants

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='ml_recommendation_outcomes_archive';

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name='ml_recommendation_outcomes_archive'
  AND grantee IN ('anon','authenticated','service_role','postgres')
ORDER BY 1,2;
```

**Result:** `relrowsecurity=false`, `relforcerowsecurity=false`.  
`anon` and `authenticated` retain broad grants including **SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER**. Sibling tables (`ml_recommendation_outcomes`, `trades_v2`, etc.) have `relrowsecurity=true` but permissive policies remain a G1 concern — archive is the confirmed RLS-off outlier.

### 6.3 Calibration contamination → reported `p_ml` correlation −0.29

**Status: UNPROVEN causal hypothesis** (per plan adjudication).

- Closed-trade calibration can influence other decision paths.
- `p_ml` is produced by `engine.predict` (optional temporal blend).
- No direct causal chain from contaminated calibration to the reported raw-model correlation was demonstrated in G0.
- Version mixing and trade-selection bias remain alternate explanations.
- Retraining stays frozen; do not change the live `p_ml` entry gate on this evidence alone (G2/G6/G9 territory).

## 7. Recorded decision versions vs re-eval versions

These identities must stay separate in all later packages:

| Identity | Where it lives | Observed at G0 |
|---|---|---|
| **Recorded decision / brain version** | `ml_brain_snapshots.context_json.snapshot_brain_version` (fallback `brain_version` / `app_version`) at poll time | Recent tops: 2.6.27 … down through 2.5.x; **not** yet 2.6.35 in DB |
| **Shipped / current code version** | APK `2.6.35` / b466 / `BRAIN_VERSION` | Checkout tip |
| **Outcome label version** | `ml_recommendation_outcomes.label_version` | Distinct value: `teacher_v1` |
| **Re-eval / regen code version** | `ml_*_outcomes_s1.regen_code_version` + `regen_source` | `S1_v2.5.28_b359` (387 rows, `EVAL_S1_FOURLEG_FIX_20260727`); `S1_v2.5.1_b332` (3923 rows, derived/shadow regen) |
| **Replay mismatch flag** | `brain` Gate-6 `version_mismatch` vs baseline `meta.brain_version` | Code path present; used when replaying older baselines under newer BRAIN_VERSION |

**Rule for G1+:** never overwrite recorded decision provenance with a later re-eval version; attach regen identity as a separate column/cohort.

## 8. Unrelated / unpublished work to preserve

| Item | Status at G0 |
|---|---|
| Plan citation `Marketapp` commit `11353cb` | **Not found** on `origin/main`, full history fetch, GitHub commit API, or local sibling checkouts (`Marketapp-am`, `docs-pass/Marketapp`, `f5-fix`). Preserve the plan note; do **not** invent or cherry-pick a substitute SHA. |
| Notification pack already on main | Multiple merged `fix(notif):` / `feat(notif):` commits through b465/b466 (e.g. `ce1ed7a`, `0457698`, `4fd12e4`, …). Treat as landed product surface, not G0 scope. |
| Local agent WIP under `/workspace/notif-fix/` | Scratch tree with Kotlin/Python extracts, audits `AUDIT_notifications_20260912.md` (+ log addendum), and `commit_sha.txt` = `4fd12e4a21704831ae23bcee5ecd87916b1f3709`. **Preserve; do not fold into G1–G3 strategy/security patches.** |
| Claude sizing / 627-test / +38,633 backtest patch | **Unavailable** in either repo at G0 — mark G9 evidence pending. |

## 9. Freeze / safety status

- Predictive training: **frozen** (unchanged by G0).
- Live broker orders: **disabled** (unchanged by G0).
- G0 commits: documentation/manifest only; no Kotlin/Python trading or security behavior edits.

## 10. G0 acceptance checklist

| Criterion | Met? |
|---|---|
| Current SHAs + drift documented | Yes |
| App/brain/PWA versions + asset hashes recorded | Yes |
| Schema note: `snapshot_id NOT NULL` already applied | Yes |
| Unittest command + actual 605 OK result | Yes |
| Peak-zero / archive RLS / calibration hypothesis probes | Yes (last marked UNPROVEN) |
| Decision vs re-eval versions separated | Yes |
| Unrelated notification WIP noted / preserved | Yes (`11353cb` missing; local notif-fix preserved) |
| No secrets in manifest | Yes |

## 11. Ready for G1?

**Yes — G0 gate satisfied.** Proceed to G1 (authenticated access + staged DB permission migration) without changing strategy gates. Known non-blockers for G1 start:

- MarketVivi docs-only SHA drift past plan pin (this manifest will advance tip further).
- Missing `11353cb` object (document-only gap).
- No post-2.6.27 brain snapshot telemetry yet for the labelled 2.6.35 build.
- G9 sizing patch still pending supply.

**Source-data cutoff for probes:** queries run 2026-09-12 against live project `fdynxkfxohbnlvayouje`; reco max `created_at` observed `2026-09-12 04:07:52+00`, max `session_date` `2026-09-11`.
