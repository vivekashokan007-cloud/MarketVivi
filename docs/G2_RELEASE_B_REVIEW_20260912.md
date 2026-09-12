# G2 Release B review — 2026-09-12

**Status:** ready for review (local implementation + Python suite green)  
**Release class:** recording/calibration integrity (Release B). Not a strategy change, auth cutover, or live-trading enablement.  
**Publishing:** allowed on main for this package. Training and live orders remain frozen. `p_ml` entry gate **unchanged**.

## 1. Why

Closed-trade calibration previously learned from dirty gross outcomes: missing costs were treated as zero, `actual_pnl` win counters ignored friction, `pnl_engine` flags were not applied as an eligibility contract, paper/live could mix, time buckets used raw UTC hour fragments, and the cache key `count + sum(gross)` missed net/quality/bucket edits. That contaminated streaks, strategy rates, and history-derived risk helpers without proving a causal link to the reported `p_ml` correlation.

G2 introduces **one trustworthy input adapter** so every calibration consumer admits the same eligible net series — or explicitly reports unavailable support.

## 2. What

### Bases at implementation start

| Repo | `origin/main` SHA | Version before |
|---|---|---|
| Marketapp | `526c559` (G1 Release A) | 2.6.36 / 467 |
| MarketVivi | `e9a8d4b` (G1 docs/labels) | labels 2.6.36 · b467 |

Tip includes G1 `526c559` (2.6.36/b467) as required.

### This change set

| Area | Files |
|---|---|
| Shared adapter | `Marketapp/app/src/main/python/calibration_input.py` |
| Consumers | `Marketapp/app/src/main/python/brain.py` (`build_calibration`, kelly/streak/exit/factor/pattern-match, ml_memory) |
| Fetch-boundary helper | `CalibrationInputGate.kt` (+ unit test); `getClosedTradesOrNull` docs — **display still sees dirty rows** |
| Acceptance tests | `tests/test_g2_calibration_input.py` (20 fixtures from plan §6) |
| Version | APK `2.6.37` / `468`, `BRAIN_VERSION=2.6.37`, PWA `v2.6.37 · b468` |
| This review | `MarketVivi/docs/G2_RELEASE_B_REVIEW_20260912.md` |

Contract version: `calibration_input_v1_net_eligible_20260912`.

### Eligibility (explicit validator — not RECONCILED-only)

- CLOSED + stable trade id + coherent paper/live mode + instrument/leg/lot identity
- Exclude `UNTRUSTED_INCOMPLETE_STRUCTURE`, `PNL_BASIS_DIVERGENT`, `UNKNOWN` from learning (accounting untouched)
- Finite net + cost provenance; derive `gross − costs` when possible; reject inconsistent nets; **missing costs ≠ zero**
- `RECONCILED` without validated net/costs → ineligible
- Null `pnl_engine`: validate evidence; record reason; no auto-pass / no permanent reject solely for null
- Paper vs live populations remain separate (default learning cohort: paper)
- Availability-time filter: best-effort / **partial** — uses `availability_time` / `pnl_engine_classified_at` / `updated_at` / `exit_date`; documented on calibration payload

### Caching, buckets, capture, insufficient support

- Cache signature = SHA-256 over contract version, cohort, and sorted `(id, revision, net, quality/engine, cohort, IST hour, cost provenance)` — quality/net/bucket changes invalidate even when count and gross sum are unchanged
- Time-of-day buckets: **Asia/Kolkata** via IST conversion
- Capture statistic vs gross peak: **disabled for learning**; retained as `exit_gross_diagnostic` until G3 net extrema
- Support &lt; 5 eligible → explicit `unavailable` calibration + deterministic neutral fallback; never reuses stale populated cache; no “Edge confirmed” on thin samples (support/uncertainty shown)

### Out of scope (unchanged)

G3 peak repair, Auth cutover / enabling bearer, removing `p_ml`, strategy/scoring formula changes beyond calibration input eligibility, G4+.

## 3. Evidence

### Tests

```bash
python3 -m unittest discover -s app/src/main/python/tests -q
# Ran 625 tests in ~3.3s — OK  (includes 20 new G2 fixtures)
python3 -m unittest discover -s app/src/main/python/tests -p 'test_g2_calibration_input.py' -v
python3 -m py_compile app/src/main/python/calibration_input.py app/src/main/python/brain.py
```

Kotlin `CalibrationInputGateTest` added; local Gradle blocked (`JAVA_HOME` unset in this environment) — run on CI / developer machine:

```bash
./gradlew :app:testDebugUnitTest --tests com.marketradar.app.CalibrationInputGateTest
```

### Acceptance fixtures covered

gross +100 / cost 200 / net −100 = loss; flagged positives excluded; absent costs not zero; valid negative/zero retained; dup IDs deduped; nonfinite fail; RECONCILED/missing-net rejected; null-engine evidence rules; paper/live separate; late outcomes excluded from prior replay; cache invalidates on net/quality/bucket change; empty support never reuses stale cal; IST time buckets; exit capture diagnostic-only; no “Edge confirmed”; shared admitted IDs.

## 4. Behavior impact (which decisions change when corrected cal is admitted)

**Does not change:** `p_ml` construction or entry gate; PC2 primary selector formulas; hard safety/daily STOP accounting (daily risk still prefers recorded net for session PnL); UI closed-trade display (dirty rows still fetched).

**Does change when eligible net calibration has support ≥ 5:**

| Path | Before (contaminated) | After (G2) |
|---|---|---|
| Strategy win rate / multi-factor buckets | Gross `actual_pnl` > 0 | Eligible **net** > 0 |
| Calibration veto (&lt;15% on n≥5) / penalty / bonus | Could fire on gross-inflated wins | Uses net-eligible paper cohort only |
| `candidate_pattern_match` copy | Could say “Edge confirmed” | Support `n=` + uncertainty; no Edge confirmed |
| Kelly headroom / loss streak / force importance | Raw closed list / gross | Admitted nets; unavailable → no insight |
| Time-of-day buckets | Raw hour from timestamp string (UTC skew) | Asia/Kolkata hour |
| Exit capture risk insight | Net exit vs gross peak | Disabled (diagnostic only) until G3 |

Admitting the corrected paper net cohort (historically ~92 null-engine net-labelled rows with costs, excluding UNKNOWN/incomplete/divergent) can flip individual strategy rates enough to add/remove a calibration penalty, bonus, or hard veto, and will change pattern-match / streak messaging. That is an intentional correctness fix, not a claimed profitability improvement. Start a new experiment identity when treating G2 calibration as the measured baseline (per plan rollout).

## 5. Status

- Implementation complete on tip of G1.
- Python: **625 passed**.
- Kotlin unit test authored; local JVM run blocked in this sandbox.
- Ready to publish Marketapp `2.6.37/b468` + MarketVivi label sync + this review when Vivek accepts Release B.
