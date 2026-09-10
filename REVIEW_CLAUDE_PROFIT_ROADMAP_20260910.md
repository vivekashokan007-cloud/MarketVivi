# Review — Claude's profit-roadmap reply, September 10, 2026

**Reviewed attachment:** `REPLY_to_codex_roadmap_20260910.md`  
**Code baseline inspected:** Marketapp `c826b26`, MarketVivi `20acf16`, v2.6.19/b450.  
**Scope:** source review and roadmap correction only. No database query, policy, schema, model, order, or release change was made.

## Decision

Adopt the central correction. The next ranking study must distinguish:

1. **Ordering:** within the policy's retained shortlist, do higher ranks produce better managed-net outcomes than lower ranks?
2. **Coverage:** does the shortlist contain better opportunities than the candidates the policy placed below its retention cap?

The current data can support the first question, not the second. Do not call a top-200 result proof that the ranker found the best available opportunities.

Paper remains the only operator-facing experimental mode. The required extra measurement is internal, deterministic telemetry—not a third trading mode or a new user-facing workflow.

## Findings confirmed from source

| Finding | Source conclusion |
|---|---|
| Retained ranked evidence is rank-selected | `BUILD3_RANKED_EVIDENCE_CAP` is 200. `_build3_ranked_candidate_evidence` serializes `ranked[:cap]`, and this list is retained as `snapshot_ranked_candidates_full`. |
| Evaluation reads that retained menu first | `_snapshot_candidate_menu_for_evaluation` prefers `snapshot_ranked_candidates_full`; secondary outcomes therefore come from the rank-selected top-200 evidence when it exists. |
| Rejected outcomes do not repair the bias | Rejected candidates are separately labelled with role `rejected` and represent gate rejections, not a probability sample from rank positions 201 onward. |
| Existing supply-quality sample is not the solution | The cap-16 sample is selected from directional/supply-quality flagged generated rows (and may include rejected rows), before final ranking. It lacks a below-cap frame, final rank and inclusion probability. |
| Paper has a real-mode authority lock | The PWA calls `finalEntryAuthorization` before considering `isPaper`, and renders `PAPER LOCKED` when that authority rejects. |
| Paper capacity wording has drift | Code enforces five active paper positions per index, while one comment and one alert say two. The Paper unlock must show and enforce one truthful capacity rule. |

Claude's reported September 9 database counts are **attributed read-only evidence**, not independently re-queried here. A daily average near 200 is consistent with the cap but does not prove every snapshot contained or completed exactly 200 usable outcomes.

## Roadmap changes adopted

### P0 — Paper TEST and measurement truth

Unlock **PAPER TEST** for structurally recordable candidates while keeping real and sandbox authority unchanged. Store operator selection provenance, policy version, current rank, vetoes, executable quote facts, friction and managed-net outcome. Retain the active-paper capacity limit as operational capacity, not a selection-policy lock. Standardize the displayed/enforced cap and add `evidence_source`; the latter describes a research cohort and never authorizes a trade.

E5 (one valued point for managed P&L, friction, timestamp and quote identity) and E3 (atomic, bounded/streaming finalization) remain ahead of ranking research.

### P1 — Design lock and unbiased coverage telemetry

Before a strong ranking claim, define and version a deterministic sample from candidates below the final top-200 retention cap. Persist at least `evidence_source`, final rank, total ranked population, retention cap, sampling rule/version and inclusion facts, plus the same candidate, quote, friction and outcome contract as the top-cap cohort. The sampling implementation follows E3 bounded streaming so it cannot worsen the current evaluator memory/output risk.

Before outcomes are viewed, freeze a research protocol with a session/event unit of analysis (not individual candidates as independent observations), minimum distinct-session coverage, managed-net effect measure, drawdown ceiling, missing-data treatment and promotion rule. Choose sample size after a baseline precision/capacity read, then freeze it.

### P2 — Two evidence roles

- **Simulated evaluator:** primary ranking instrument. Phase A tests ordering inside the retained shortlist; Phase B tests shortlist coverage against the deterministic below-cap sample.
- **PAPER TEST:** calibration and operational evidence. It checks whether a managed simulated outcome is credible against the corresponding paper-trade path, fills, friction and lifecycle. Operator-selected alternatives are valuable but are not an unbiased ranking arm.

No policy promotion to Real follows from gross P&L, a model score, a top-200-only result, a single session, or a small correlated set of Paper positions.

### P1 maintenance item

Keep the agreed `QUOTE_CONTRACT` text correction with the next runtime change. The v4 code requires a strictly positive finite executable side **and** both sides present, finite and uncrossed, independent of LTP; the current string only states the first part.

## Next implementation order

1. PAPER TEST unlock, provenance and one truthful capacity message (Paper only).
2. E5 then E3, followed by failure/recovery tests.
3. Research protocol/data-contract design lock and bounded below-cap sampling.
4. E6–E8, notification work, and the `QUOTE_CONTRACT` wording correction.
5. Start P2 with separate ordering, coverage and Paper-calibration analyses; promote nothing to Real until the pre-registered multi-session evidence passes.

