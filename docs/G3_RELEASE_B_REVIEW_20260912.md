# G3 Release B review — 2026-09-12

**Status:** ready for review (local implementation + Python suite green; production repair write **NOT** run)  
**Release class:** recording integrity (Release B). Not a strategy change, auth cutover, training enablement, or live-trading enablement.  
**Publishing:** allowed on main for this package. Training and live orders remain frozen. Do not auto-activate exit learning from repaired gross peaks.

## 1. Why

Confirmed defect: MarketVivi PWA `closePatch` wrote top-level `trough_pnl` but **omitted top-level `peak_pnl`**. Peak lived only in nested `journey_stats` / `close_trace_json`. A separate ML outcome update that included peak did not fix the `trades_v2` omission.

Fresh read-only SQL (project `fdynxkfxohbnlvayouje`, 2026-09-12):

| Metric | Value |
|---|---:|
| Closed paper trades | 268 |
| Top-level `peak_pnl` nonzero | 98 |
| Top-level `peak_pnl` exact 0 | 170 |
| Top-level `peak_pnl` null | 0 |
| Net-labelled | 97 |
| Net-labelled with top peak 0 | **97** |
| Of those, positive journey peak | **64** |
| Of those, positive close_trace peak | **64** |
| Zero top + positive journey/trace (all closed paper) | **110** |
| Among those 110: no `position_ticks` | 46 |
| Among those 110: ticks present & conflict vs journey (>₹1) | **64** |
| Among those 110: ticks agree with journey | 0 |
| Journey vs trace agreement (where both present) | 64 / 0 conflict |
| `pnl_engine` in {UNTRUSTED_*, DIVERGENT, UNKNOWN} | 112 |

These are diagnostic counts, **not** an automatically approved backfill list. Tick vs journey conflicts go to a review queue.

## 2. What

### Bases at implementation start

| Repo | `origin/main` SHA | Version before |
|---|---|---|
| Marketapp | `882af66` (G2) | 2.6.37 / 468 |
| MarketVivi | `3786181` (G2 docs/labels) | labels 2.6.37 · b468 |

Tip includes G2 `882af66` (2.6.37/b468) as required.

### Gross extrema contract (preserved top-level basis = **GROSS**)

Documented in `gross_extrema.py` module docstring + PWA `app.js` comments:

| Field | Definition |
|---|---|
| Unit | INR (₹) **total** for recorded lots × lot_size (same as `current_pnl` / `actual_pnl`) |
| Lot quantity | `lot_size × lots` (or resolved lot used by position valuation) |
| Price basis | **GROSS_MTM** from option-chain quotes (brain `position_live` / `position_ticks.current_pnl`) — **not** net-of-friction |
| Source (live) | brain → native `open_trades` → PWA trade fields |
| Observation interval | `entry_date` → `exit_date` (marks while OPEN) |
| Validity | `null`/`unknown` = unobserved (**never fabricate 0**); `0` = observed zero; finite = observed extremum |
| Contract | `g3_gross_extrema_v1_20260912` |

Do **not** overwrite top-level gross fields with net extrema. Do **not** change `actual_pnl` / `net_pnl`. Copying a peak into an untrusted row does **not** relabel `pnl_engine` as trustworthy.

### This change set

| Area | Files |
|---|---|
| Shared contract + repair proposals | `Marketapp/app/src/main/python/gross_extrema.py` |
| Dry-run repair tool | `Marketapp/tools/g3_peak_trough_repair.py` (default dry-run; `--apply` + expected-old check) |
| PWA close path | `MarketVivi/app.js` — normalized close extrema payload includes **both** peak and trough; native pending journal retains them; open-trade merge null-safe |
| Native audit | `ClosedTradeLedger.kt` docs + test: opaque JSON preserves peak/trough across reload; **no Kotlin `trades_v2` CLOSE writer omits peak** (PWA owns remote close) |
| Brain comment | live open-trade peak tracking labelled gross; close/repair must not fabricate historical zeros |
| Tests | `tests/test_g3_peak_trough_repair.py` (12); `MarketVivi/tests/test_close_extrema.mjs` |
| Version | APK `2.6.38` / `469`, `BRAIN_VERSION=2.6.38`, PWA `v2.6.38 · b469` |
| This review | `MarketVivi/docs/G3_RELEASE_B_REVIEW_20260912.md` |

### Forward-path fix

Every close destination now goes through one normalized extrema payload:

- Top-level `trades_v2.peak_pnl` **and** `trough_pnl` (gross)
- Nested `close_trace_json` + `journey_stats` carry the same values + validity metadata
- `recordClosedTradeToNative` stores peak/trough/validity so reload/pending-close journals do not drop extrema
- Remote write strips non-column meta keys (validity lives in JSONB), keeping `peak_pnl`/`trough_pnl` columns

### Dry-run repair tool

```bash
# Offline fixture dry-run (no secrets / no production)
python3 tools/g3_peak_trough_repair.py --fixture trades.json \
  --out g3_peak_trough_repair_manifest.csv \
  --summary-out g3_peak_trough_repair_summary.json

# Live dry-run (requires SUPABASE_SERVICE_ROLE_KEY) — lists IDs, old/new, source/basis, exclusions
python3 tools/g3_peak_trough_repair.py --out manifest.csv --summary-out summary.json

# Write mode ONLY behind explicit flag + idempotent expected-old match
python3 tools/g3_peak_trough_repair.py --apply   # NOT run in this package
```

Evidence preference: `position_ticks.current_pnl` extrema → verified `journey_stats` / `close_trace_json`. Conflicts → `action=review`. Second pass on repaired rows → no further effect.

**Production repair write was NOT run in this task** (expected). Historical backfill waits for Vivek after reviewing the manifest; forward-path fix ships now.

### Documenting read-only SQL (no secrets)

```sql
WITH closed_paper AS (
  SELECT id, peak_pnl, trough_pnl, net_pnl, pnl_engine,
         CASE WHEN jsonb_typeof(journey_stats->'peak_pnl') = 'number'
              THEN (journey_stats->>'peak_pnl')::numeric END AS journey_peak,
         CASE WHEN jsonb_typeof(close_trace_json->'peak_pnl') = 'number'
              THEN (close_trace_json->>'peak_pnl')::numeric END AS trace_peak
  FROM trades_v2
  WHERE UPPER(COALESCE(status,'')) IN ('CLOSED','CLOSE','EXITED')
    AND (paper IS TRUE OR LOWER(COALESCE(trade_mode,'')) LIKE '%paper%'
         OR LOWER(COALESCE(execution_mode,'')) LIKE '%paper%')
)
SELECT
  COUNT(*) AS closed_paper_n,
  COUNT(*) FILTER (WHERE peak_pnl = 0) AS top_peak_exact_zero_n,
  COUNT(*) FILTER (WHERE COALESCE(peak_pnl,0) <> 0) AS top_peak_nonzero,
  COUNT(*) FILTER (WHERE net_pnl IS NOT NULL) AS net_labelled_n,
  COUNT(*) FILTER (WHERE net_pnl IS NOT NULL AND COALESCE(peak_pnl,0)=0) AS netlab_top_peak_zero,
  COUNT(*) FILTER (
    WHERE net_pnl IS NOT NULL AND COALESCE(peak_pnl,0)=0 AND COALESCE(journey_peak,0) > 0
  ) AS netlab_zero_top_positive_journey;
```

Dry-run sample implications from the companion join (see §1): ~46 no-tick journey/trace candidates are auto-repairable under the verified-nested rule; ~64 tick-vs-journey conflicts are **review-only**.

## 3. Evidence

### Tests

```bash
python3 -m unittest discover -s app/src/main/python/tests -q
# Ran 637 tests in ~3.4s — OK  (includes 12 new G3 fixtures; prior G2 tip was 625)

python3 -m unittest discover -s app/src/main/python/tests -p 'test_g3_peak_trough_repair.py' -v
node MarketVivi/tests/test_close_extrema.mjs
```

Kotlin `ClosedTradeLedgerTest.pendingClosePreservesGrossExtremaAcrossReloadJournal` added; local Gradle blocked (`JAVA_HOME` unset) — run on CI / developer machine:

```bash
./gradlew :app:testDebugUnitTest --tests com.marketradar.app.ClosedTradeLedgerTest
```

### Acceptance coverage

| Requirement | Coverage |
|---|---|
| Positive peak survives close payload construction | Python + Node |
| Valid zero remains zero; unknown stays null | Python + Node |
| Repair dry-run idempotent / second pass no further effect | Python tool fixture |
| Untrusted structures not relabelled trustworthy when peak copied | Python (`trust_label_changed=False`, exclusion noted) |
| Conflicting tick vs journey → review | Python |
| Preserve better existing nonzero peak | Python |

## 4. Behavior impact

**Does not change:** `actual_pnl` / `net_pnl` / friction; `p_ml` entry gate; training; live orders; calibration eligibility from G2; exit-learning activation from gross peaks (still not auto-enabled).

**Does change:**

| Path | Before | After (G3) |
|---|---|---|
| PWA manual close → `trades_v2` | Top-level trough only; peak omitted (stored as 0 historically) | Top-level **peak + trough** (gross) with validity in JSONB |
| Native pending close journal | id / pnl only | Also retains peak/trough/validity across reload/retry |
| Open-trade UI sync | `Math.max(..., 0)` fabricated zeros | Null-safe merge of gross extrema |
| Historical rows | 170 zero top peaks | Unchanged until authorized `--apply` after manifest review |

## 5. Status

- Implementation complete on tip of G2.
- Python: **637 passed**.
- Node close-extrema harness: **OK**.
- Kotlin unit test authored; local JVM run blocked in this sandbox.
- **Production repair write was NOT run** (expected). Ship tool + forward-path fix; backfill waits for Vivek.
- Ready to publish Marketapp `2.6.38/b469` + MarketVivi label sync + this review when Vivek accepts Release B (G3).

### Out of scope (unchanged)

G4+, Auth cutover, changing `net_pnl`, enabling training, enabling exit learning from repaired gross peaks.
