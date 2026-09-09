-- Handoff review, 2026-09-09. Read-only. Intraday counts grow after the recorded cutoff.
-- For reproduction of the reported September 9 counts, freeze snapshots at 05:25:59 UTC.

select session_date,market_forces_json->>'brain_version' v,count(*) n,max(poll_ts) latest,count(*) filter(where context_json?'snapshot_daily_risk_state') risk,count(*) filter(where context_json->'snapshot_pc2_paper_primary'->>'deterministic_reference_source'='preserved_deterministic_rank') preserved,count(*) filter(where verdict_json->'decision_gate'->>'state'='ACTIONABLE') actionable,count(*) filter(where (context_json->'snapshot_pc2_paper_primary'->>'eligible_candidate_count')::numeric>0) eligible from ml_brain_snapshots where session_date>='2026-09-08' and poll_ts <= '2026-09-09 05:25:59+00' group by 1,2 order by 1,2;

select session_date,primary_candidate_json->>'type' strategy,primary_candidate_json->'entryEligibility'->'reasons' reasons,count(*) n,round(avg((primary_candidate_json->'entryEligibility'->>'net_premium_edge')::numeric),2) net_edge from ml_brain_snapshots where session_date>='2026-09-08' and poll_ts <= '2026-09-09 05:25:59+00' group by 1,2,3 order by 1,n desc;

select id,poll_ts,primary_candidate_json->>'id' candidate_id,primary_candidate_json->>'index' index_key,primary_candidate_json->>'entryEligible' entry_eligible,primary_candidate_json->'entryEligibility' eligibility,verdict_json->>'action' action,verdict_json->>'execution_candidate_id' execution_candidate_id,verdict_json->'decision_gate' gate,context_json->'snapshot_pc2_paper_primary'->>'pc2_primary_candidate_id' pc2_primary from ml_brain_snapshots where session_date='2026-09-09' and verdict_json->'decision_gate'->>'state'='ACTIONABLE' order by poll_ts limit 2;



-- Generated supply, frozen to the initial audit cutoff; prices are estimates.
select session_date,index_key,brain_version,count(*) n,
 count(*) filter(where ml_ood_flag is true) ood,
 count(*) filter(where premium_edge>0) positive_gross,
 count(*) filter(where premium_edge>0 and ml_ood_flag is not true) positive_non_ood,
 round(avg(premium_edge)::numeric,2) avg_gross,max(snapshot_poll_ts) latest
from ml_generated_candidates
where session_date in ('2026-09-08','2026-09-09')
 and snapshot_poll_ts <= '2026-09-09 05:25:00+00'
group by 1,2,3 order by 1,2,3;
