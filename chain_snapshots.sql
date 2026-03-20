-- Chain Snapshots table for afternoon positioning detection
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS chain_snapshots (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    session TEXT NOT NULL CHECK (session IN ('morning', '2pm', '315pm')),
    bnf_spot DECIMAL,
    nf_spot DECIMAL,
    vix DECIMAL,
    bnf_pcr DECIMAL,
    bnf_near_atm_pcr DECIMAL,
    nf_pcr DECIMAL,
    bnf_max_pain INTEGER,
    nf_max_pain INTEGER,
    bnf_call_wall INTEGER,
    bnf_call_wall_oi BIGINT,
    bnf_put_wall INTEGER,
    bnf_put_wall_oi BIGINT,
    bnf_total_call_oi BIGINT,
    bnf_total_put_oi BIGINT,
    nf_total_call_oi BIGINT,
    nf_total_put_oi BIGINT,
    bnf_atm_iv DECIMAL,
    bnf_futures_prem DECIMAL,
    bnf_breadth_pct DECIMAL,
    nf50_advancing INTEGER,
    tomorrow_signal TEXT,
    signal_strength INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, session)
);

-- Enable RLS with allow all (same as other tables)
ALTER TABLE chain_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON chain_snapshots FOR ALL USING (true) WITH CHECK (true);
