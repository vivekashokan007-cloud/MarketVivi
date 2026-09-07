# Ranking audit addendum — Market Radar — 2026-09-07

## Assessment

The active paper selector consistently prioritizes its programmed objective in the checks run here. That does **not** establish that its chosen strategy has the best achievable net outcome.

The new concrete findings are a corrupted comparator diagnostic, a GO-banner/verdict mismatch, mixed ranking/EV displays, and insufficient persisted alternative-candidate economics for a faithful full-menu replay. These should be corrected before drawing conclusions about which ranking policy wins.

Scope: Marketapp `1f928d7`, MarketVivi baseline `54af42c`, synchronized app version 2.6.16/build 447/cache 1323. Runtime code was not changed. This supplements [the profitability audit](AUDIT_PROFITABILITY_20260907.md).

## 1. What actually selects the paper strategy

Source: Marketapp `brain.py`, `rank_candidates`, `_pc2_paper_primary_sort_key`, `select_pc2_paper_primary`, and the final eligibility/reselection pass in `analyze`.

| Stage | Meaning / authority |
|---|---|
| Generation | Construct candidate structures subject to generation rules; existence is not approval |
| Deterministic ranking | Preliminary safety/economics ordering with additional tie-breakers |
| Entry eligibility | Capital/direction/readiness, economics, OOD and confidence checks |
| Paper entry ordering | Eligible candidates precede monitor candidates |
| Primary sort key | Highest **net edge after sigma adjustment**, in absolute rupees |
| Tie-breakers | Higher context-percentile score, then probability from the rank-economics contract, then candidate ID |
| Final verdict | Separate WAIT/STOP constraints can still prohibit action |
| Watchlist/PWA | A selected subset, displayed separately for NF and BNF |

This is lexicographic sorting: the next key matters only when the preceding keys tie. A direct test confirmed that ₹1 more effective edge wins despite much worse context and a lower ML probability, when both candidates are already eligible.

The following computed fields are **not direct ordering keys in the final paper sort**: composite score, teacher modifier, economics percentile, adjusted edge/risk, soft-gate failure count, and ML probability. Some inputs can matter upstream or through eligibility; this finding is specifically about final paper ordering.

The helper docstring describes a bounded combined economics/context score, but its implemented tuple is edge-first. The PWA's teacher panel also describes a bounded ranking modifier, although that modifier is diagnostic under the current paper selector. These descriptions need updating.

The earlier historical rejection of blindly promoting edge/risk or percentile-first sorting remains relevant. This audit provides no new evidence that those alternatives outperform.

## 2. Concrete production example: snapshot 5391, September 4

| Field | Stored value |
|---|---|
| Ranked candidate count | 663 |
| Entry-eligible count | 4 |
| Paper-selected candidate | `IB_NF_23900_W200` |
| Research-leading candidate | `IB_BNF_57400_W1200` |
| Selected candidate's paper rank | 1 |
| Selected candidate's deterministic/research rank | 7 |
| Selected effective net edge | ₹581 |
| Selected gross premium edge | ₹935 |
| Selected legacy `ev` field | −₹315 |
| Recorded eligible random control | `IB_NF_23900_W100` |

Choosing research rank 7 is not, by itself, a sorting failure. Research ranking includes monitor candidates. The valid entry comparison is among the four eligible candidates, while the final verdict must also authorize entry.

No realized outcome claim for this specific snapshot is made here.

## 3. Confirmed defect: the deterministic comparator can become PC2 itself

The selector begins with:

```python
deterministic_top = ranked[0] if ranked else None
```

The production pipeline invokes it again after eligibility refresh, potentially passing a list already reordered by PC2. Its second call then records PC2's prior winner as the “deterministic” comparator.

Direct reproduction using the actual selector:

| Call | Paper winner | Recorded deterministic comparator | changed_from_deterministic |
|---|---|---|---|
| First: deterministic input order | pc2-winner | legacy-first | true |
| Second: previous PC2 output order | pc2-winner | pc2-winner | false |

The winner still carries `deterministic_rank=2`.

The retrieved production snapshot similarly stores the selected candidate with `deterministic_rank=7`, yet records that same candidate as `deterministic_shadow_candidate_id` and sets `changed_from_deterministic=false`.

**Impact:** this can invalidate PC2-versus-deterministic agreement/performance analysis. It does not prove that the selected candidate is wrong.

**Proposed correction:** preserve comparator identity from the actual deterministic pass, rather than infer it from the mutable list's first element. Store both the unconstrained deterministic leader and the best deterministic-ranked candidate under the *same final entry eligibility*. Otherwise an apparent ranking improvement can merely reflect comparing an eligible candidate against a prohibited one.

Test repeated selection, changed eligibility, and identical versus differing winners. Do not rewrite historical comparator fields silently; mark affected comparisons uncertain.

## 4. Confirmed UI defect: GO can disagree with WAIT or STOP

Executed the actual `renderWatchlist` function from app.js inside Node with a stub DOM and a minimal supplied state. When one watchlist candidate remains `entryEligible=true`, both these inputs render “✅ GO”:

- Brain verdict WAIT / hard-wait gate.
- Brain verdict STOP / stop gate.

The banner derives GO from the count of eligible watchlist candidates, without checking the final verdict. It also does not use full execution readiness for that count.

**Impact:** the Trade tab can imply permission to act when the final brain verdict prohibits action. This is a renderer-level reproduction, not proof of a broker-order bypass or proof that the exact STOP state occurred on the user's device.

**Proposed correction:** derive global GO from the final authoritative verdict/gate and fresh selected-candidate readiness. Continue displaying research candidates, but label them consistently with that decision.

## 5. Rank and economics displays can mislead comparison

The PWA preserves brain watchlist order within each index, but displays NF first and restarts visible numbering for BNF. A reproduced example with a global BNF winner and an NF monitor displayed:

- NF monitor: card #1, displayed first.
- BNF global winner: card #1, in the BNF section.

The smaller Research/Entry labels provide additional context, but the large #1 does not mean global best. A watchlist also includes diversity picks, so it is not a complete globally ordered candidate menu.

Further, the card's EV/₹1K display uses legacy `cand.ev`, while ranking uses net effective edge. In snapshot 5391 those values have opposite signs: legacy EV −₹315 versus rank edge +₹581. Its gross premiumEdge is a third value, ₹935. These are different contracts, not interchangeable estimates.

**Proposed display:** show a clearly identified global selected candidate, index-local display position, research rank and entry rank; distinguish “gross premium edge,” “net edge used for ranking,” “sigma adjustment,” and any legacy metric. Explain why a higher-research-ranked candidate was ineligible. Do not imply that every displayed score contributes to selection.

## 6. Missing sigma changes relative ranking

The sigma-adjustment helper returns factor 1 when sigma is missing. The existing tests explicitly encode that policy.

Direct selector test:

| Candidate | Raw net edge | Sigma | Effective edge |
|---|---:|---:|---:|
| Supported candidate | ₹1,000 | 0.65 | ₹1,000 |
| Far candidate, sigma supplied | ₹1,400 | 2.65 | ₹175 |
| Same far candidate, sigma removed | ₹1,400 | missing | ₹1,400 |

Removing sigma flips the winner. Snapshot 5391's butterfly has `sigma_penalty_reason=missing_sigma` and factor 1.

This is an intentional missing-data policy with a possible comparability consequence, not proof that butterflies should receive a credit-spread penalty. An ATM neutral structure needs structure-appropriate geometry; assigning zero sigma or applying directional thresholds indiscriminately could create another bias.

**Experiment:** report sigma availability and structure-specific distance measures by family, then test matched alternatives under equal risk. Do not change the penalty until the effect is measured.

## 7. The stored menu is not enough for faithful full-menu replay

For snapshot 5391:

- 663 ranked candidates existed.
- 200 ranked records were retained.
- The first retained ranked record's `pc2PaperSortComponents` keeps score scope, composite score, teacher modifier and economics percentile, but drops active effective-edge fields.
- The primary candidate and the inspected top-candidate record retain richer net-edge evidence.

Thus even retaining a candidate does not guarantee retaining the fields that caused its rank. Recomputing missing net edges from gross fields or today's code would not reproduce the historical decision faithfully.

**Proposed minimal per-candidate evidence:** stable poll/candidate/expiry identity; final eligible flag and reasons; raw net edge; effective edge; sigma factor/source; context/probability tie-breakers; net loss and friction; final entry/research ranks; model/selector/cost versions; and inclusion/truncation metadata. Preserve selected and comparator candidates explicitly. Keep payloads compact.

## 8. How to test whether selection is actually better

Evaluate three different questions separately:

1. **Implementation correctness:** did the selector choose the highest-ranked candidate under its declared rules among final eligible candidates? A violation here is a code/data defect.
2. **Predictive usefulness:** does that ordering predict better managed net outcomes than predeclared alternatives on the *same* eligible menus? Failure here is an objective/model issue.
3. **Attainable profitability:** can the resulting policy earn net profit with real position capacity, timing, costs and risk limits? Candidate-level averages alone cannot answer this.

The preferred comparison set is current PC2, deterministic ordering restricted to the same eligibility, the already-recorded eligible random control, and at most a small number of predeclared challengers.

For each same-poll comparison, preserve candidate identity and outcome horizon/configuration. Report match/label coverage before performance; retain WAIT as a valid decision. Compare paired net-P&L differences, risk, costs, and family/width composition, with session-level uncertainty.

Hindsight-best *eligible* outcome can measure opportunity headroom, but is not a deployable selector. “Best among everything generated” additionally includes prohibited candidates and is an unfair benchmark.

Freeze challengers before an untouched chronological evaluation. Respect overlapping position constraints and purge overlapping outcome horizons. Do not infer independence from many nearby strikes or repeated five-minute polls.

## 9. Validation completed and quantitative work blocked

Completed:

- Read exact sort keys, final eligibility/reselection call path, PWA ranking/rendering, and compaction evidence.
- Retrieved the production snapshot and comparator metadata above.
- Verified that the queried recent teacher cohort had 89,219 rows and 89,219 distinct (snapshot_id, candidate_id) pairs, including 508 primary rows. This establishes pair uniqueness only for that filtered cohort, not statistical independence.
- Ran **45 existing ranking, eligibility and net-economics tests: passed**.
- Executed diagnostic calls for repeated comparator selection, edge/context priority, research versus entry leader, and missing sigma.
- Executed the actual PWA watchlist renderer for WAIT/STOP and per-index numbering.

Blocked:

The same-poll random-control outcome comparison, cohort-wide comparator consistency count and ranking-field coverage aggregate were rejected by automatic approval review because the account's usage limit was reached. They returned no analytical results. No alternate database route was attempted. The pending read-only queries are saved in [AUDIT_RANKING_20260907.sql](AUDIT_RANKING_20260907.sql).

Consequently **this addendum does not establish that the chosen strategy outperforms, or underperforms, its same-poll eligible alternatives**. That quantitative test remains outstanding until tool capacity is available.

## Recommended order

1. Correct comparator provenance and GO/final-verdict consistency.
2. Make displayed ranking metrics and persisted active sort fields agree with the actual selector.
3. Complete matched eligible-menu comparisons and coverage checks.
4. Only then experiment with the payoff objective, family geometry, risk/capital constraints or exit-policy changes.

These are proposals only. Audit documentation and project knowledge were updated; runtime code, release identities, database state, and GitHub branches were unchanged.

## Follow-up review of Claude's reply

See [REVIEW_CLAUDE_DUAL_AUDITS_20260907.md](REVIEW_CLAUDE_DUAL_AUDITS_20260907.md).
Current primary/top/ranked candidate fields retain true eligibility even when
the retired snapshot_watchlist context field is absent. The evaluator is
coverage-limited, not blocked by universally false eligibility. The comparator
defect remains confirmed; Claude's reported 239/735 discrepancy fraction must
be stratified by active/non-null selected primary before being described as
a corruption rate. Actual historical on-screen GO incidence remains unmeasured.
