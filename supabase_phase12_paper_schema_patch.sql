-- Market Radar: Phase 12 + Paper-Discipline schema patch
-- Safe to run multiple times (uses IF NOT EXISTS).
-- Run in Supabase SQL Editor.

-- =========================
-- trades_v2 additions
-- =========================
ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS execution_mode text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS execution_status text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS execution_error text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS order_tag text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS sell_instrument_key text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS buy_instrument_key text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS sell_instrument_key2 text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS buy_instrument_key2 text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS paper_close_reason_quality text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS paper_thesis_break_type text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS paper_rule_followed text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS paper_close_note text;

ALTER TABLE trades_v2
ADD COLUMN IF NOT EXISTS paper_discipline jsonb;

-- =========================
-- ml_decisions additions
-- =========================
ALTER TABLE ml_decisions
ADD COLUMN IF NOT EXISTS paper_reason_quality text;

ALTER TABLE ml_decisions
ADD COLUMN IF NOT EXISTS paper_thesis_break_type text;

ALTER TABLE ml_decisions
ADD COLUMN IF NOT EXISTS paper_rule_followed text;

-- =========================
-- Optional defaults (safe)
-- =========================
UPDATE trades_v2
SET execution_mode = COALESCE(execution_mode, 'paper'),
    execution_status = COALESCE(execution_status, 'not_sent')
WHERE execution_mode IS NULL
   OR execution_status IS NULL;

-- =========================
-- Verification queries
-- =========================
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('trades_v2', 'ml_decisions')
  AND column_name IN (
    'execution_mode',
    'execution_status',
    'execution_error',
    'order_tag',
    'sell_instrument_key',
    'buy_instrument_key',
    'sell_instrument_key2',
    'buy_instrument_key2',
    'paper_close_reason_quality',
    'paper_thesis_break_type',
    'paper_rule_followed',
    'paper_close_note',
    'paper_discipline',
    'paper_reason_quality'
  )
ORDER BY table_name, column_name;

SELECT
  COUNT(*) FILTER (WHERE execution_mode IS NOT NULL) AS trades_with_execution_mode,
  COUNT(*) FILTER (WHERE execution_status IS NOT NULL) AS trades_with_execution_status,
  COUNT(*) FILTER (WHERE sell_instrument_key IS NOT NULL OR buy_instrument_key IS NOT NULL) AS trades_with_leg_keys,
  COUNT(*) FILTER (WHERE paper_close_reason_quality IS NOT NULL) AS trades_with_paper_quality
FROM trades_v2;

SELECT
  COUNT(*) FILTER (WHERE paper_reason_quality IS NOT NULL) AS decisions_with_quality,
  COUNT(*) FILTER (WHERE paper_rule_followed IS NOT NULL) AS decisions_with_rule_flag
FROM ml_decisions;
