-- Market Radar ML V2 market-hours validation
-- Run in Supabase SQL Editor after a live/paper market session.
-- Uses the current IST date as the session_date.

WITH session AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS session_date
)
SELECT 'ml_brain_snapshots' AS check_name, COUNT(*)::text AS value
FROM ml_brain_snapshots, session
WHERE ml_brain_snapshots.session_date = session.session_date
UNION ALL
SELECT 'ml_option_chain_snapshots', COUNT(*)::text
FROM ml_option_chain_snapshots, session
WHERE ml_option_chain_snapshots.session_date = session.session_date
UNION ALL
SELECT 'ml_decisions', COUNT(*)::text
FROM ml_decisions, session
WHERE ml_decisions.date = session.session_date::text
UNION ALL
SELECT 'ml_recommendation_outcomes', COUNT(*)::text
FROM ml_recommendation_outcomes, session
WHERE ml_recommendation_outcomes.session_date = session.session_date
UNION ALL
SELECT 'ml_daily_accuracy', COUNT(*)::text
FROM ml_daily_accuracy, session
WHERE ml_daily_accuracy.session_date = session.session_date
ORDER BY check_name;

-- Expected during market hours:
-- ml_brain_snapshots should increase every poll.
-- ml_option_chain_snapshots should increase with chain slices.
-- ml_decisions increases only when a paper/real trade is opened.
-- ml_recommendation_outcomes and ml_daily_accuracy appear after day evaluation.

WITH session AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS session_date
)
SELECT poll_ts, action, strategy, confidence, is_labelable, recommendation_id
FROM ml_brain_snapshots, session
WHERE ml_brain_snapshots.session_date = session.session_date
ORDER BY poll_ts DESC
LIMIT 10;

WITH session AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS session_date
)
SELECT poll_ts, index_key, strike, option_type, ltp, bid, ask
FROM ml_option_chain_snapshots, session
WHERE ml_option_chain_snapshots.session_date = session.session_date
ORDER BY poll_ts DESC
LIMIT 20;

WITH session AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS session_date
)
SELECT session_date, labeled_rows, wins, accuracy_pct, method, updated_at
FROM ml_daily_accuracy, session
WHERE ml_daily_accuracy.session_date = session.session_date;
