-- Ranking audit: pending read-only queries, 2026-09-07.
-- These were blocked by automatic approval review's account usage limit.
-- No result is claimed. Run only when tool capacity is restored.
-- Historical cohort, fixed cutoff; candidates overlap in time.
-- Pair uniqueness was separately verified for this label/config/date cohort.

-- Paired comparison with pre-entry recorded eligible random control.
with s as (
  select id,session_date,context_json->'snapshot_pc2_paper_primary' as pc
  from ml_brain_snapshots
  where session_date between '2026-08-27' and '2026-09-04'
    and action in ('SELL PREMIUM','BUY PREMIUM')
)
select s.session_date,count(*) n,
  round(avg(p.managed_pnl)::numeric,2) primary_net,
  round(avg(r.managed_pnl)::numeric,2) control_net,
  round(avg(p.managed_pnl-r.managed_pnl)::numeric,2) paired_delta,
  round(avg(p.r_multiple)::numeric,4) primary_r,
  round(avg(r.r_multiple)::numeric,4) control_r,
  count(*) filter(where p.managed_pnl>r.managed_pnl) primary_beats_control,
  count(*) filter(where p.candidate_id=r.candidate_id) same_pick
from s
join ml_evaluation_outcomes p on p.snapshot_id=s.id
  and p.candidate_id=s.pc->>'pc2_primary_candidate_id'
join ml_evaluation_outcomes r on r.snapshot_id=s.id
  and r.candidate_id=s.pc->'random_control'->>'candidate_id'
where p.label_version='teacher_v1' and r.label_version=p.label_version
  and p.teacher_config_version='tc_2026_07_A'
  and r.teacher_config_version=p.teacher_config_version
  and p.price_integrity='OK' and r.price_integrity='OK'
  and s.pc->>'active'='true'
group by 1 order by 1;

-- Diagnostic consistency; a flag/rank disagreement needs provenance review.
with s as (
  select *,context_json->'snapshot_pc2_paper_primary' as pc
  from ml_brain_snapshots
  where session_date between '2026-08-27' and '2026-09-04'
)
select action,count(*) snapshots,
  count(*) filter(where pc->>'active'='true') pc2_active,
  count(*) filter(where pc->>'pc2_primary_candidate_id' is not null) chosen,
  count(*) filter(where pc->>'pc2_primary_candidate_id' is not null
    and pc->>'pc2_primary_candidate_id' <> primary_candidate_json->>'id') primary_id_mismatch,
  count(*) filter(where pc->>'changed_from_deterministic'='false'
    and (primary_candidate_json->>'deterministic_rank')::int>1) deterministic_flag_vs_rank_conflict,
  count(*) filter(where pc->>'pc2_primary_candidate_id'=pc->>'deterministic_shadow_candidate_id') same_shadow_id
from s group by 1 order by 1;

-- Top-candidate eligibility/edge-field availability (not full-menu coverage).
with c as (
  select s.id,s.action,x.c
  from ml_brain_snapshots s
  cross join lateral jsonb_array_elements(s.top_candidates_json) x(c)
  where s.session_date between '2026-08-27' and '2026-09-04'
)
select c.action,count(*) rows,
  count(*) filter(where c.c->>'entryEligible'='true') eligible_rows,
  count(*) filter(where c.c->>'entryEligible'='true'
    and c.c->'pc2PaperSortComponents'->>'rank_edge_effective' is not null) eligible_with_edge,
  count(distinct c.id) snapshots
from c group by 1;

