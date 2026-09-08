-- Read-only evidence for guards v3 review; project fdynxkfxohbnlvayouje.

-- joinSQL
with e as (select e.id eval_id,e.candidate_id,e.session_date,s.poll_ts from ml_evaluation_outcomes e join ml_brain_snapshots s on s.id=e.snapshot_id where e.session_date>='2026-08-25'), g as (select id gen_id,candidate_id,session_date,snapshot_poll_ts from ml_generated_candidates where session_date>='2026-08-25'), pairs as (select g.session_date,g.gen_id,e.eval_id,abs(extract(epoch from(g.snapshot_poll_ts-e.poll_ts))) delta from g join e on e.session_date=g.session_date and e.candidate_id=g.candidate_id and g.snapshot_poll_ts between e.poll_ts-interval '300 seconds' and e.poll_ts+interval '300 seconds'), totals as(select session_date,count(*) total from g group by 1) select t.session_date,t.total,w.seconds,count(p.gen_id) pairs,count(distinct p.gen_id) matched_gen,count(distinct p.eval_id) matched_eval,round(avg(p.delta),2) mean_delta,max(p.delta) max_delta from totals t cross join (values (60),(150),(300)) w(seconds) left join pairs p on p.session_date=t.session_date and p.delta<=w.seconds group by 1,2,3 order by 1,3;

-- tickSQL
with matched as (select t.id,t.strategy_type,t.actual_pnl,t.net_pnl,pt.* from trades_v2 t join lateral (select pt.current_pnl,pt.tick_ts,pt.leg_count,pt.legs_json,pt.policy_trace_json,pt.valuation_quality from position_ticks pt where pt.trade_id=t.id::text and pt.tick_ts<=t.exit_date and pt.tick_ts>=t.exit_date-interval '10 minutes' order by pt.tick_ts desc limit 1) pt on true where t.status='CLOSED') select strategy_type,count(*) n,count(current_pnl) pnl_n,round(avg(actual_pnl),2) close_all,round(avg(actual_pnl) filter(where current_pnl is not null),2) close_paired,round(avg(current_pnl),2) tick,round(avg(current_pnl-actual_pnl),2) signed_gap,round(avg(abs(current_pnl-actual_pnl)),2) abs_gap,count(*) filter(where current_pnl*actual_pnl<0) opposite,count(*) filter(where leg_count=2 and jsonb_array_length(legs_json)=2) two_legs,count(*) filter(where policy_trace_json ? 'position_tick_guards_version') guarded from matched group by 1 order by 1;

-- grossSQL
select role,count(*) n,count(managed_gross_pnl) gross_n,round(avg(managed_gross_pnl)::numeric,2) gross,round(avg(managed_pnl)::numeric,2) net,round(avg(friction_cost)::numeric,2) friction from ml_evaluation_outcomes where label_version='teacher_v1' and price_integrity='OK' and managed_pnl is not null group by role;

-- identitySQL
with pairs as (select g.id gen_id,e.id eval_id,g.session_date,g.strategy_type gs,e.strategy_type es,g.index_key gi,e.index_key ei,g.trade_mode gm,e.trade_mode em,e.label_version,e.price_integrity,e.managed_pnl,g.premium_edge,abs(extract(epoch from(g.snapshot_poll_ts-s.poll_ts))) delta from ml_evaluation_outcomes e join ml_brain_snapshots s on s.id=e.snapshot_id join ml_generated_candidates g on g.session_date=e.session_date and g.candidate_id=e.candidate_id and g.snapshot_poll_ts between s.poll_ts-interval '150 seconds' and s.poll_ts+interval '150 seconds' where e.session_date>='2026-08-25') select count(*) pairs,count(*) filter(where gs is distinct from es) strategy_mismatch,count(*) filter(where gi is distinct from ei) index_mismatch,count(*) filter(where gm is distinct from em) mode_mismatch,count(*) filter(where label_version='teacher_v1' and price_integrity='OK' and managed_pnl is not null) usable_teacher,count(*) filter(where delta=0) exact,count(*) filter(where delta=0 and label_version='teacher_v1' and price_integrity='OK' and managed_pnl is not null and premium_edge is not null) exact_usable from pairs;


-- Explain nine unrestricted exact matches versus zero clean matches.
select e.label_version,e.price_integrity,e.role,count(*) n,
       count(e.managed_pnl) net_n,count(g.premium_edge) edge_n
from ml_evaluation_outcomes e
join ml_brain_snapshots s on e.snapshot_id=s.id
join ml_generated_candidates g
  on g.candidate_id=e.candidate_id and g.snapshot_poll_ts=s.poll_ts
group by 1,2,3;

-- Latest observed versions by timestamp, not lexicographic version ordering.
select market_forces_json->>'brain_version' as brain_version,
       count(*) n,max(poll_ts) latest,
       count(*) filter(where context_json ? 'snapshot_daily_risk_state') daily_state
from ml_brain_snapshots group by 1 order by max(poll_ts) desc limit 3;
