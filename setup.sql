-- Market Radar v2 — Supabase Table Setup
-- Run this in your Supabase SQL Editor (fdynxkfxohbnlvayouje.supabase.co)

-- Premium History: one row per trading day, for IV percentile calculation
CREATE TABLE IF NOT EXISTS premium_history (
    id BIGSERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    nf_spot DECIMAL,
    bnf_spot DECIMAL,
    vix DECIMAL,
    nf_atm_iv DECIMAL,
    bnf_atm_iv DECIMAL,
    pcr DECIMAL,
    fii_cash DECIMAL,
    fii_short_pct DECIMAL,
    futures_premium_bnf DECIMAL,
    bias TEXT,
    bias_net INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trades v2: premium-first trade log with force alignment
CREATE TABLE IF NOT EXISTS trades_v2 (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Strategy
    strategy_type TEXT NOT NULL,     -- BEAR_CALL, BULL_PUT, BEAR_PUT, BULL_CALL
    index_key TEXT NOT NULL,         -- NF or BNF
    expiry DATE,
    width INTEGER,
    is_credit BOOLEAN,
    
    -- Entry
    entry_date TIMESTAMPTZ,
    entry_spot DECIMAL,
    entry_vix DECIMAL,
    entry_atm_iv DECIMAL,
    entry_premium DECIMAL,           -- net credit or debit per share
    sell_strike DECIMAL,
    sell_type TEXT,
    sell_ltp DECIMAL,
    buy_strike DECIMAL,
    buy_type TEXT,
    buy_ltp DECIMAL,
    
    -- Limits
    max_profit DECIMAL,
    max_loss DECIMAL,
    lots INTEGER DEFAULT 1,
    prob_profit DECIMAL,
    
    -- Force alignment at entry
    force_alignment INTEGER,         -- 3, 2, 1, or 0
    force_f1 INTEGER,                -- -1, 0, or 1
    force_f2 INTEGER,
    force_f3 INTEGER,
    
    -- Market context at entry
    entry_pcr DECIMAL,
    entry_futures_premium DECIMAL,
    entry_bias TEXT,
    entry_bias_net INTEGER,
    
    -- Live tracking
    status TEXT DEFAULT 'OPEN',      -- OPEN or CLOSED
    current_pnl DECIMAL DEFAULT 0,
    current_spot DECIMAL,
    current_premium DECIMAL,
    peak_pnl DECIMAL DEFAULT 0,
    
    -- Exit
    exit_date TIMESTAMPTZ,
    actual_pnl DECIMAL,
    exit_premium DECIMAL,
    exit_reason TEXT,
    exit_vix DECIMAL,
    exit_atm_iv DECIMAL,
    exit_force_alignment INTEGER
);

-- RLS: Allow all (personal project, anon key)
ALTER TABLE premium_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all premium_history" ON premium_history FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE trades_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all trades_v2" ON trades_v2 FOR ALL USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_history_date ON premium_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_v2_status ON trades_v2(status);
