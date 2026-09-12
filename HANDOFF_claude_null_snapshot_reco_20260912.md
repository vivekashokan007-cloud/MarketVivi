# HANDOFF for Claude — null `snapshot_id` recommendation rows (2026-09-10)

**From:** Chief of Staff / Codex path (Market Radar ops)  
**To:** Claude  
**Date:** 2026-09-12  
**Repos:** `vivekashokan007-cloud/Marketapp` (runtime) · `vivekashokan007-cloud/MarketVivi` (docs)  
**Supabase project:** `fdynxkfxohbnlvayouje`  
**Session in scope:** `2026-09-10` only  

---

## Ask (need your ruling)

For `session_date = 2026-09-10`, `ml_recommendation_outcomes` still contains **8,296** rows with **null / empty `snapshot_id`**, left over from the failed phone-side evaluation path.

We have now completed a server-side backfill that wrote **canonical** evaluation rows with valid `snapshot_id`s.

**Please rule:**

1. Should those **8,296 null-`snapshot_id` recommendation rows be deleted**, archived, left as evidence, or otherwise handled?
2. If delete/archive: exact SQL / safety gates (idempotent, scoped to `2026-09-10` only, no touch to `ml_evaluation_outcomes` / rejected unless you say so).
3. Do any dashboards / teacher / accuracy jobs **count** `ml_recommendation_outcomes` without requiring `snapshot_id`, such that leaving the nulls would **double-count or corrupt** metrics now that 15,050 valid reco rows exist?
4. Any need to recompute `ml_daily_accuracy` (or similar) after cleanup?

Do **not** invent promotion of null-`snapshot_id` rows into `ml_evaluation_outcomes`. Prior Codex/project knowledge already forbade that.

---

## Context (verified)

### What went wrong originally
Phone ML eval for 2026-09-10 hit identity / snapshot-replay issues (see PROJECT_KNOWLEDGE and RELEASE notes around v2.6.26–v2.6.28). Recommendation uploads landed with `snapshot_id = NULL`; canonical `ml_evaluation_outcomes` stayed at **0**.

### What we did (2026-09-12)
Used Marketapp tool:

```bash
python3 tools/backfill_ml_evaluation.py --date 2026-09-10          # dry-run
python3 tools/backfill_ml_evaluation.py --date 2026-09-10 --write   # commit
```

Dry-run then write against live Supabase (service role). Scope proof passed. No other dates written.

### Final post-write counts (`session_date = 2026-09-10`)

| Table | Count | Notes |
|---|---:|---|
| `ml_brain_snapshots` | 71 | input |
| `ml_option_chain_snapshots` | 34,928 | input |
| `ml_evaluation_outcomes` | **15,050** | all valid snapshot_id; roles primary 69 / secondary 14,981 |
| `ml_rejected_candidate_outcomes` | **308** | all valid snapshot_id |
| `ml_recommendation_outcomes` (total) | **23,346** | = 15,050 valid + **8,296 null snapshot_id** |
| `ml_recommendation_outcomes` valid snapshot_id | **15,050** | from backfill upsert |
| `ml_recommendation_outcomes` null snapshot_id | **8,296** | legacy phone path |

Null-snapshot reco role split: primary **35** · secondary **8,261**.

Created_at span on reco for that date: `2026-09-10 16:51:05+00` → `2026-09-12 04:07:52+00` (covers both legacy upload and backfill).

### Idempotency
Second `--write` for the same date left `ml_evaluation_outcomes` at **15,050** (no duplicate growth). Upsert keys match app: `(snapshot_id, candidate_id, role)` for eval/reco; rejected uses `id`.

### Quality gates already checked (eval + rejected)
- `session_date = 2026-09-10` only for those writes  
- **0** cross-date  
- **0** null/empty `snapshot_id` on eval + rejected  
- **0** bad candidate_id / role on eval + rejected  

Reco table still fails the snapshot_id gate on the legacy cohort only.

### Project stance already on record (PROJECT_KNOWLEDGE)
- Null-`snapshot_id` recommendation rows are **invalid for identity recovery** and must **not** be promoted into canonical evaluation by inference.  
- They were retained as evidence; no destructive cleanup was performed during the Sept 10 investigation.  
- v2.6.28 / b459 shipped snapshot replay readback retries for future phone recovery; this handoff is about **DB residue**, not another APK change.

---

## Suggested decision options (pick one)

**A — Leave as evidence**  
Keep the 8,296 null rows; document that completion evidence is only `ml_evaluation_outcomes` (+ rejected). Filter `snapshot_id IS NOT NULL` in any reco-based reads.

**B — Soft archive**  
Move/copy null rows to an archive table or mark with a tombstone column, then delete from live reco.

**C — Hard delete (scoped)**  
`DELETE FROM ml_recommendation_outcomes WHERE session_date = '2026-09-10' AND (snapshot_id IS NULL OR btrim(snapshot_id::text) = '');`  
Only after you confirm no consumer requires them and Vivek approves.

**D — Other**  
Your alternative with exact steps.

---

## Constraints for whoever executes next
- Date filter **must** be exactly `2026-09-10`.  
- Do not clear app data on devices.  
- Do not paste service keys into git/docs/chat.  
- Prefer read-only verification SQL before any DELETE.  
- If you approve cleanup, return: ruling + exact SQL + expected before/after counts.

---

## Repro / verification SQL (safe, read-only)

```sql
-- Cohort split
select
  count(*)::int as n,
  count(*) filter (where snapshot_id is null or nullif(btrim(snapshot_id::text),'') is null)::int as null_snapshot,
  count(*) filter (where snapshot_id is not null and nullif(btrim(snapshot_id::text),'') is not null)::int as valid_snapshot
from ml_recommendation_outcomes
where session_date = '2026-09-10';

-- Null cohort roles
select coalesce(role,'(null)') as role, count(*)::int as n
from ml_recommendation_outcomes
where session_date = '2026-09-10'
  and (snapshot_id is null or nullif(btrim(snapshot_id::text),'') is null)
group by 1 order by 1;

-- Canonical completion evidence
select count(*)::int as eval_n from ml_evaluation_outcomes where session_date = '2026-09-10';
select count(*)::int as rejected_n from ml_rejected_candidate_outcomes where session_date = '2026-09-10';
```

---

## Related artifacts
- `Marketapp/tools/backfill_ml_evaluation.py`  
- `Marketapp/RELEASE_2.6.28_20260911.md`  
- `MarketVivi/PROJECT_KNOWLEDGE.md` (2026-09-11 entries on missing snapshot replay / null snapshot_id)  
- Signed release: https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.6.28  

End of handoff.
