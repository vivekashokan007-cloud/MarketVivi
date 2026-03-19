-- Market Radar v2 — Add morning/close dual snapshots
-- Run in Supabase SQL Editor BEFORE pushing new code

-- 1. Add session column
ALTER TABLE premium_history ADD COLUMN IF NOT EXISTS session TEXT DEFAULT 'close';

-- 2. Drop old unique constraint on date alone
ALTER TABLE premium_history DROP CONSTRAINT IF EXISTS premium_history_date_key;

-- 3. Create new unique constraint on (date, session)
ALTER TABLE premium_history ADD CONSTRAINT premium_history_date_session_key UNIQUE (date, session);

-- 4. Existing 102 VIX rows become 'close' by default (correct — they ARE closing VIX values)
-- No data migration needed.

-- 5. Update index
DROP INDEX IF EXISTS idx_premium_history_date;
CREATE INDEX idx_premium_history_date_session ON premium_history(date DESC, session);
