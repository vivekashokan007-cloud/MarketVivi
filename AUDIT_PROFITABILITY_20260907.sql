-- Profitability audit, 2026-09-07. READ-ONLY queries.
-- Results reflect query-time state, not a frozen database transaction.
-- Labels/classification flags are evidence, not proof of fills or reconciliation.

-- trade_summary
select coalesce(execution_mode,'NULL') execution_mode, paper, status, count(*) n, min(entry_date)::date first_entry, max(entry_date)::date last_entry, count(actual_pnl) gross_labeled, count(net_pnl) net_labeled, round(sum(actual_pnl),2) gross_pnl, round(sum(net_pnl),2) net_pnl, round(sum(friction_cost),2) recorded_cost, count(*) filter(where net_pnl>0) net_wins, count(*) filter(where actual_pnl>0 and net_pnl<=0) gross_wins_lost_after_cost, count(*) filter(where structure_incomplete) incomplete, count(*) filter(where pnl_reconciles=false) not_reconciled from public.trades_v2 group by 1,2,3 order by 1,2,3;

-- trade_cohort
select strategy_type,coalesce(pnl_engine,'NULL') pnl_engine,pnl_reconciles,structure_incomplete,count(*) n,min(entry_date)::date first_entry,max(entry_date)::date last_entry,round(sum(actual_pnl),2) gross,round(sum(friction_cost),2) cost,round(sum(net_pnl),2) net,round(avg(net_pnl),2) avg_net,count(*) filter(where net_pnl>0) wins,round(sum(net_pnl) filter(where net_pnl>0)/nullif(-sum(net_pnl) filter(where net_pnl<0),0),3) profit_factor,round(max(abs(net_pnl-(actual_pnl-friction_cost))),2) max_net_recon_error from public.trades_v2 where status='CLOSED' and net_pnl is not null group by 1,2,3,4 order by 1,2;

-- outcome_coverage
select label_version,teacher_config_version,price_integrity,role,count(*) n,count(distinct session_date) sessions,min(session_date) first_date,max(session_date) last_date,count(managed_pnl) managed_net_labeled,count(friction_cost) cost_labeled,count(*) filter(where friction_cost>0) positive_cost,round(avg(managed_pnl)::numeric,2) avg_managed_net,round(avg(r_multiple)::numeric,4) avg_r from public.ml_evaluation_outcomes where session_date >= date '2026-08-01' group by 1,2,3,4 order by n desc limit 30;

-- supply_by_day
select session_date,brain_version,index_key,count(*) n,count(*) filter(where was_surfaced) surfaced,count(*) filter(where premium_edge>0) positive_premium_edge,count(*) filter(where ml_ood_flag) ood,count(*) filter(where ml_action='TAKE') ml_take,round(avg(p_ml)::numeric,3) avg_p_ml from public.ml_generated_candidates where session_date >= date '2026-08-24' group by 1,2,3 order by 1,2,3;

-- primary_action
select s.action, coalesce(s.primary_candidate_json->>'entryEligible',s.primary_candidate_json->'entryEligibility'->>'eligible','MISSING') as entry_eligible, count(*) n, count(distinct o.session_date) sessions, round(avg(o.managed_pnl)::numeric,2) mean_net, round(avg(o.managed_gross_pnl)::numeric,2) mean_gross, round(avg(o.friction_cost)::numeric,2) mean_cost, count(*) filter(where o.managed_pnl>0) net_wins from ml_evaluation_outcomes o join ml_brain_snapshots s on s.id=o.snapshot_id where o.role='primary' and o.session_date>='2026-08-01' and o.label_version='teacher_v1' and o.teacher_config_version='tc_2026_07_A' and o.price_integrity='OK' group by 1,2 order by n desc;

-- eligible_daily
select o.session_date,count(*) n,round(avg(o.managed_pnl)::numeric,2) mean_net,round(avg(o.r_multiple)::numeric,4) mean_r,count(*) filter(where o.managed_pnl>0) net_wins from ml_evaluation_outcomes o join ml_brain_snapshots s on s.id=o.snapshot_id where o.role='primary' and o.session_date>='2026-08-01' and o.label_version='teacher_v1' and o.teacher_config_version='tc_2026_07_A' and o.price_integrity='OK' and s.action='SELL PREMIUM' and coalesce(s.primary_candidate_json->>'entryEligible',s.primary_candidate_json->'entryEligibility'->>'eligible')='true' group by 1 order by 1;

-- risk_context
select id,poll_ts,context_json ? 'dailyPnl' as daily_pnl_present,context_json->'dailyPnl' as daily_pnl,context_json ? 'dailyTradeCount' as daily_count_present,context_json->'dailyTradeCount' as daily_count,context_json->'snapshot_open_trades_json' is not null as open_state_present,context_json->'snapshot_closed_trades_json' is not null as closed_state_present from ml_brain_snapshots where session_date='2026-09-07' order by poll_ts desc limit 3;


