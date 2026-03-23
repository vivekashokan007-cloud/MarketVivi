/* ═══════════════════════════════════════════════════════════════
   Market Radar v2 — Database (Supabase)
   Tables: premium_history, trades_v2
   Free tier: 500MB, 50K reads/month — we use <0.1% of this
   ═══════════════════════════════════════════════════════════════ */

const DB = (() => {
    const SUPABASE_URL = 'https://fdynxkfxohbnlvayouje.supabase.co';
    // Anon key — safe to expose (RLS controls access)
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeW54a2Z4b2hibmx2YXlvdWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTc0NjQsImV4cCI6MjA4ODU5MzQ2NH0.1KbzYXtpuzUIDABCz9jKz4VjcuGeuyYOQAHkNLlndRE';

    let sb = null;

    function init() {
        if (window.supabase && !sb) {
            sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            console.log('[DB] Supabase client initialized');
            if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_INIT', status: 'OK' });
        }
        if (!window.supabase) {
            console.warn('[DB] window.supabase not available!');
            if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_INIT', status: 'FAILED — supabase CDN not loaded' });
        }
        return sb;
    }

    // ═══ PREMIUM HISTORY ═══

    // session: 'morning' or 'close'
    async function savePremiumSnapshot(data, session = 'close') {
        if (!init()) { console.warn('[DB] savePremiumSnapshot: no client'); return null; }
        try {
            const row = {
                date: data.date,
                session: session,
                nf_spot: data.nfSpot,
                bnf_spot: data.bnfSpot,
                vix: data.vix,
                nf_atm_iv: data.nfAtmIv,
                bnf_atm_iv: data.bnfAtmIv,
                pcr: data.pcr,
                fii_cash: data.fiiCash,
                fii_short_pct: data.fiiShortPct,
                dii_cash: data.diiCash || null,
                fii_idx_fut: data.fiiIdxFut || null,
                fii_stk_fut: data.fiiStkFut || null,
                futures_premium_bnf: data.futuresPremBnf,
                bias: data.bias,
                bias_net: data.biasNet
            };
            const { data: result, error } = await sb
                .from('premium_history')
                .upsert(row, { onConflict: 'date,session' });
            if (error) console.warn('[DB] savePremiumSnapshot error:', error.message, error.details, error.hint);
            else console.log(`[DB] savePremiumSnapshot OK: ${data.date} ${session}`);
            return result;
        } catch (e) {
            console.warn('[DB] savePremiumSnapshot exception:', e);
            return null;
        }
    }

    // Returns closing snapshots for IV percentile + yesterday comparison
    async function getPremiumHistory(days = 60) {
        if (!init()) { console.warn('[DB] getPremiumHistory: no client'); return []; }
        try {
            const { data, error } = await sb
                .from('premium_history')
                .select('*')
                .eq('session', 'close')
                .order('date', { ascending: false })
                .limit(days);
            if (error) {
                console.warn('[DB] getPremiumHistory error:', error.message, error.details, error.hint, error.code);
                if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_HISTORY_ERROR', message: error.message, code: error.code, hint: error.hint || '' });
                return [];
            }
            console.log('[DB] getPremiumHistory OK:', data?.length, 'rows', data?.[0]?.date, data?.[0]?.vix);
            if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_HISTORY_OK', rows: data?.length || 0, latest: data?.[0]?.date || 'none', latestVix: data?.[0]?.vix || 'none' });
            return data || [];
        } catch (e) {
            console.warn('[DB] getPremiumHistory exception:', e);
            return [];
        }
    }

    // Get today's morning snapshot for intraday comparison
    async function getMorningSnapshot(date) {
        if (!init()) return null;
        try {
            const { data, error } = await sb
                .from('premium_history')
                .select('*')
                .eq('date', date)
                .eq('session', 'morning')
                .single();
            if (error) return null;
            return data;
        } catch (e) { return null; }
    }

    // ═══ TRADES ═══

    async function insertTrade(trade) {
        if (!init()) return null;
        try {
            const { data, error } = await sb
                .from('trades_v2')
                .insert(trade)
                .select();
            if (error) {
                console.warn('DB insertTrade:', error.message, error.details, error.hint, error.code);
                if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_INSERT_TRADE_ERROR', message: error.message, details: error.details, hint: error.hint, code: error.code });
                return null;
            }
            return data?.[0] || null;
        } catch (e) {
            console.warn('DB insertTrade error:', e);
            if (window._API_DEBUG) window._API_DEBUG.push({ time: '', label: 'DB_INSERT_TRADE_EXCEPTION', message: e.message });
            return null;
        }
    }

    async function updateTrade(id, updates) {
        if (!init()) return null;
        try {
            const { data, error } = await sb
                .from('trades_v2')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select();
            if (error) { console.warn('DB updateTrade:', error.message); return null; }
            return data?.[0] || null;
        } catch (e) {
            console.warn('DB updateTrade error:', e);
            return null;
        }
    }

    async function getOpenTrades() {
        if (!init()) return [];
        try {
            const { data, error } = await sb
                .from('trades_v2')
                .select('*')
                .eq('status', 'OPEN')
                .order('created_at', { ascending: false });
            if (error) { console.warn('DB getOpenTrades:', error.message); return []; }
            return data || [];
        } catch (e) {
            console.warn('DB getOpenTrades error:', e);
            return [];
        }
    }

    async function getClosedTrades(limit = 20) {
        if (!init()) return [];
        try {
            const { data, error } = await sb
                .from('trades_v2')
                .select('*')
                .eq('status', 'CLOSED')
                .order('exit_date', { ascending: false })
                .limit(limit);
            if (error) { console.warn('DB getClosedTrades:', error.message); return []; }
            return data || [];
        } catch (e) {
            console.warn('DB getClosedTrades error:', e);
            return [];
        }
    }

    // ═══ CHAIN SNAPSHOTS — Afternoon Positioning System ═══

    async function saveChainSnapshot(data, session) {
        if (!init()) return null;
        try {
            const row = {
                date: data.date,
                session,
                bnf_spot: data.bnfSpot,
                nf_spot: data.nfSpot,
                vix: data.vix,
                bnf_pcr: data.bnfPcr,
                bnf_near_atm_pcr: data.bnfNearAtmPcr,
                nf_pcr: data.nfPcr,
                bnf_max_pain: data.bnfMaxPain,
                nf_max_pain: data.nfMaxPain,
                bnf_call_wall: data.bnfCallWall,
                bnf_call_wall_oi: data.bnfCallWallOi,
                bnf_put_wall: data.bnfPutWall,
                bnf_put_wall_oi: data.bnfPutWallOi,
                bnf_total_call_oi: data.bnfTotalCallOi,
                bnf_total_put_oi: data.bnfTotalPutOi,
                nf_total_call_oi: data.nfTotalCallOi,
                nf_total_put_oi: data.nfTotalPutOi,
                bnf_atm_iv: data.bnfAtmIv,
                bnf_futures_prem: data.bnfFuturesPrem,
                bnf_breadth_pct: data.bnfBreadthPct,
                nf50_advancing: data.nf50Advancing,
                tomorrow_signal: data.tomorrowSignal || null,
                signal_strength: data.signalStrength || null
            };
            const { data: result, error } = await sb
                .from('chain_snapshots')
                .upsert(row, { onConflict: 'date,session' })
                .select();
            if (error) { console.warn('DB saveChainSnapshot:', error.message); return null; }
            console.log(`[DB] Chain snapshot saved: ${data.date} ${session}`);
            return result?.[0] || null;
        } catch (e) {
            console.warn('DB saveChainSnapshot error:', e);
            return null;
        }
    }

    async function getChainSnapshot(date, session) {
        if (!init()) return null;
        try {
            const { data, error } = await sb
                .from('chain_snapshots')
                .select('*')
                .eq('date', date)
                .eq('session', session)
                .single();
            if (error) return null;
            return data;
        } catch (e) { return null; }
    }

    async function getRecentSignals(limit = 20) {
        if (!init()) return [];
        try {
            const { data, error } = await sb
                .from('chain_snapshots')
                .select('date, tomorrow_signal, signal_strength, bnf_spot, vix')
                .eq('session', '315pm')
                .not('tomorrow_signal', 'is', null)
                .order('date', { ascending: false })
                .limit(limit);
            if (error) return [];
            return data || [];
        } catch (e) { return []; }
    }

    // ═══ SIGNAL ACCURACY — stored on chain_snapshots 315pm rows ═══

    async function updateSignalResult(date, correct, actualGap) {
        if (!init()) return null;
        try {
            const { data, error } = await sb
                .from('chain_snapshots')
                .update({ signal_correct: correct, signal_actual_gap: actualGap })
                .eq('date', date)
                .eq('session', '315pm')
                .select();
            if (error) { console.warn('DB updateSignalResult:', error.message); return null; }
            console.log(`[DB] Signal result saved: ${date} correct=${correct} gap=${actualGap}`);
            return data?.[0] || null;
        } catch (e) { return null; }
    }

    async function getSignalAccuracyStats() {
        if (!init()) return { correct: 0, total: 0, pct: 0 };
        try {
            const { data, error } = await sb
                .from('chain_snapshots')
                .select('date, tomorrow_signal, signal_strength, signal_correct, signal_actual_gap')
                .eq('session', '315pm')
                .not('signal_correct', 'is', null)
                .order('date', { ascending: false })
                .limit(30);
            if (error) return { correct: 0, total: 0, pct: 0 };
            const total = data?.length || 0;
            const correct = (data || []).filter(d => d.signal_correct).length;
            return { correct, total, pct: total > 0 ? Math.round(correct / total * 100) : 0, history: data || [] };
        } catch (e) { return { correct: 0, total: 0, pct: 0 }; }
    }

    return {
        init, savePremiumSnapshot, getPremiumHistory, getMorningSnapshot,
        insertTrade, updateTrade, getOpenTrades, getClosedTrades,
        saveChainSnapshot, getChainSnapshot, getRecentSignals,
        updateSignalResult, getSignalAccuracyStats
    };
})();
