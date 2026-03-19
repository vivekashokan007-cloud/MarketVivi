/* ═══════════════════════════════════════════════════════════════
   Market Radar v2 — Database (Supabase)
   Tables: premium_history, trades_v2
   Free tier: 500MB, 50K reads/month — we use <0.1% of this
   ═══════════════════════════════════════════════════════════════ */

const DB = (() => {
    const SUPABASE_URL = 'https://fdynxkfxohbnlvayouje.supabase.co';
    // Anon key — safe to expose (RLS controls access)
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeW54a2Z4b2hibmx2YXlvanVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE2MDE1ODIsImV4cCI6MjA1NzE3NzU4Mn0.mFLBB2_dWgS-9cvVMsEZMT3gyX6J0jbwOZ3I0zYoGIc';

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
            if (error) { console.warn('DB insertTrade:', error.message); return null; }
            return data?.[0] || null;
        } catch (e) {
            console.warn('DB insertTrade error:', e);
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

    return {
        init, savePremiumSnapshot, getPremiumHistory, getMorningSnapshot,
        insertTrade, updateTrade, getOpenTrades, getClosedTrades
    };
})();
