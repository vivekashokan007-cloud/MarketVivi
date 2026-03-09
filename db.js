// ══════════════════════════════════════════════════════════════
// MARKET RADAR v3.1 — db.js
// Supabase layer — all read/write operations
// Tables: daily_data, bhav_options, trades, straddle_ratios
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://fdynxkfxohbnlvayouje.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZQNND9OdKGrdBt55hmdm0Q_sKp6p2C6';

let _db = null;
function getDB() {
  if (!_db) {
    try { _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
    catch(e) { console.warn('[db] Supabase not ready:', e.message); }
  }
  return _db;
}

// IST date helpers
function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 19800000);
  return `${ist.getFullYear()}-${String(ist.getMonth()+1).padStart(2,'0')}-${String(ist.getDate()).padStart(2,'0')}`;
}
function yesterdayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + now.getTimezoneOffset()*60000 + 19800000);
  ist.setDate(ist.getDate() - 1);
  return `${ist.getFullYear()}-${String(ist.getMonth()+1).padStart(2,'0')}-${String(ist.getDate()).padStart(2,'0')}`;
}

// ──────────────────────────────────────────────────────────────
// DAILY DATA — full day state, auto-synced across all devices
// ──────────────────────────────────────────────────────────────

// Upsert any subset of fields for today
async function dbSaveDailyData(fields) {
  const db = getDB();
  if (!db) return { ok: false };
  const row = { trade_date: todayIST(), updated_at: new Date().toISOString(), ...fields };
  const { error } = await db.from('daily_data').upsert(row, { onConflict: 'trade_date' });
  if (error) { console.warn('[db] saveDailyData:', error.message); return { ok: false }; }
  return { ok: true };
}

// Load one date's full row
async function dbLoadDailyData(date) {
  const db = getDB();
  if (!db) return null;
  try {
    const { data, error } = await db.from('daily_data').select('*').eq('trade_date', date).single();
    return (error || !data) ? null : data;
  } catch(e) { return null; }
}

// Auto-sync on app load: fetch today + yesterday, populate everything
async function dbAutoSync() {
  const badge = document.getElementById('db-sync-badge');
  if (badge) { badge.textContent = '⟳ sync'; badge.style.color = 'var(--am)'; }

  const [todayRow, yesterdayRow] = await Promise.all([
    dbLoadDailyData(todayIST()),
    dbLoadDailyData(yesterdayIST()),
  ]);

  if (yesterdayRow) _storeYesterdayLocally(yesterdayRow);

  if (todayRow) {
    _populateFromDB(todayRow);
    if (badge) { badge.textContent = '✅ synced'; badge.style.color = 'var(--gn)'; }
    setTimeout(() => { if (badge) badge.textContent = ''; }, 4000);
  } else {
    if (badge) badge.textContent = '';
  }

  dbShowStatus();
}

// Yesterday's evening data → localStorage (powers delta in Verdict tab)
function _storeYesterdayLocally(d) {
  try {
    const ev = {};
    const M = {
      ev_sp500:'ev_sp500', ev_dow:'ev_dow', ev_usvix:'ev_usvix',
      ev_nk:'ev_nk', ev_hsi:'ev_hsi', ev_crude:'ev_crude',
      ev_gold:'ev_gold', ev_inr:'ev_inr', ev_india_vix:'ev_indiavix',
      ev_fii:'ev_fii', ev_fii_opt:'ev_fii_opt',
      ev_pcr_nf:'ev_pcr_nf', ev_pcr_bn:'ev_pcr_bn',
      ev_nifty:'ev_nifty', ev_bnf:'ev_bnf',
      ev_n50adv:'ev_n50adv', ev_bnfadv:'ev_bnfadv',
      ev_mpnf:'ev_mpnf', ev_mpbn:'ev_mpbn',
    };
    for (const [k,lk] of Object.entries(M)) {
      if (d[k] != null) ev[lk] = String(d[k]);
    }
    if (Object.keys(ev).length) localStorage.setItem('mr140-evening', JSON.stringify(ev));
    // Auto close character
    if (d.ev_n50adv != null) {
      const adv = parseFloat(d.ev_n50adv), fii = parseFloat(d.ev_fii)||0;
      const advScore = adv>=38?2:adv>=28?1:adv>=20?0:adv>=12?-1:-2;
      const fiiAdj   = fii>=1000?0.5:fii>=200?0.25:fii<=-1000?-0.5:fii<=-200?-0.25:0;
      localStorage.setItem('mr140-autoclosechar', JSON.stringify({
        val: Math.round(Math.max(-2,Math.min(2,advScore+fiiAdj))), adv, fii, lockedAt:Date.now()
      }));
    }
  } catch(e) { console.warn('[db] storeYesterday:', e.message); }
}

// Populate all HTML form fields from a daily_data DB row
function _populateFromDB(d) {
  if (!d) return;

  // setField: only if empty (respect live input)
  const set  = (id, v) => { if (v==null) return; const e=document.getElementById(id); if(e&&e.value==='') e.value=String(v); };
  // forceField: always write (locked sections being restored)
  const force = (id, v) => { if (v==null) return; const e=document.getElementById(id); if(e) e.value=String(v); };

  // Field maps: DB column → HTML element id
  const RADAR_MAP = {
    sp500:'sp500', dow:'dow', us_vix:'usvix', nikkei:'nk', hang_seng:'hsi',
    crude:'crude', gold:'gold', usd_inr:'inr', us_10y_yield:'yld',
    gift_now:'gift_now', gift_6am:'gift_6am', nifty_prev:'nifty_prev',
    india_vix:'india_vix', fii_cash:'fii', fii_fut:'fii_fut', fii_opt:'fii_opt',
    dii_cash:'dii', max_pain_nf:'max_pain_nf', max_pain_bn:'max_pain_bn',
    close_char:'close_char',
  };
  const BREADTH_MAP = { n50_advances:'n50adv', n50_dma_pct:'n50dma', bnf_advances:'bnfadv' };
  const STRAT_MAP = {
    nf_spot:'nf_price', nf_atr:'nf_atr', nf_pcr:'pcr_nf',
    nf_oi_call:'nf_oi_call', nf_oi_put:'nf_oi_put', nf_maxpain:'nf_maxpain',
    bn_spot:'bn_price', bn_atr:'bn_atr', bn_pcr:'pcr_bn',
    bn_oi_call:'bn_oi_call', bn_oi_put:'bn_oi_put', bn_maxpain:'bn_maxpain',
  };
  const EV_MAP = {
    ev_sp500:'ev_sp500', ev_dow:'ev_dow', ev_usvix:'ev_usvix',
    ev_nk:'ev_nk', ev_hsi:'ev_hsi', ev_crude:'ev_crude',
    ev_gold:'ev_gold', ev_inr:'ev_inr', ev_india_vix:'ev_indiavix',
    ev_fii:'ev_fii', ev_fii_opt:'ev_fii_opt',
    ev_pcr_nf:'ev_pcr_nf', ev_pcr_bn:'ev_pcr_bn',
    ev_nifty:'ev_nifty', ev_bnf:'ev_bnf',
    ev_n50adv:'ev_n50adv', ev_bnfadv:'ev_bnfadv',
    ev_mpnf:'ev_mpnf', ev_mpbn:'ev_mpbn',
  };

  // RADAR
  if (d.radar_locked_at) {
    for (const [k,id] of Object.entries(RADAR_MAP)) force(id, d[k]);
    const stored = {};
    for (const [k,id] of Object.entries(RADAR_MAP)) if (d[k]!=null) stored[id]=String(d[k]);
    stored._savedDate = new Date().toDateString();
    localStorage.setItem('mr140-radar', JSON.stringify(stored));
    window.RADAR_LOCKED = true;
    if (typeof setDisabled==='function') setDisabled(Object.values(RADAR_MAP), true);
    const s = document.getElementById('btn-save-radar'); if(s) s.style.display='none';
    const e = document.getElementById('btn-edit-radar'); if(e) e.style.display='inline-flex';
    const t = document.getElementById('radar-status');   if(t) t.textContent='✅ Restored from cloud';
  } else {
    for (const [k,id] of Object.entries(RADAR_MAP)) set(id, d[k]);
  }

  // BREADTH
  if (d.breadth_locked_at) {
    for (const [k,id] of Object.entries(BREADTH_MAP)) force(id, d[k]);
    window.BREADTH_LOCKED = true;
    if (typeof setDisabled==='function') setDisabled(Object.values(BREADTH_MAP), true);
    const s = document.getElementById('btn-save-breadth'); if(s) s.style.display='none';
    const e = document.getElementById('btn-edit-breadth'); if(e) e.style.display='inline-flex';
  } else {
    for (const [k,id] of Object.entries(BREADTH_MAP)) set(id, d[k]);
  }

  // CHECKLIST (radio buttons)
  for (const [field, opts] of [
    ['rbi_stance', ['hawkish','neutral','dovish']],
    ['liquidity',  ['deficit','neutral','surplus']],
    ['news_event', ['none','hdfc','icici','both']],
  ]) {
    if (!d[field]) continue;
    const names = {rbi_stance:'rbi', liquidity:'liq', news_event:'news'};
    const pfxs  = {rbi_stance:'rbi-', liquidity:'liq-', news_event:'news-'};
    const el = document.querySelector(`input[name="${names[field]}"][value="${d[field]}"]`);
    if (el) el.checked = true;
    opts.forEach(v => document.getElementById(pfxs[field]+v)?.classList.toggle('checked', v===d[field]));
  }

  // STRATEGY INPUTS (always soft-set)
  for (const [k,id] of Object.entries(STRAT_MAP)) set(id, d[k]);

  // EVENING
  if (d.evening_locked_at) {
    for (const [k,id] of Object.entries(EV_MAP)) force(id, d[k]);
    window.EVENING_LOCKED = true;
    if (typeof setDisabled==='function') setDisabled(Object.values(EV_MAP), true);
    const s = document.getElementById('btn-save-evening'); if(s) s.style.display='none';
    const e = document.getElementById('btn-edit-evening'); if(e) e.style.display='inline-flex';
    const b = document.getElementById('btn-lock-bottom');  if(b) b.style.display='none';
  } else {
    for (const [k,id] of Object.entries(EV_MAP)) set(id, d[k]);
  }

  // Re-compute all derived outputs
  setTimeout(() => {
    if (typeof calcScore==='function')    calcScore();
    if (typeof renderBreadth==='function') renderBreadth();
    if (typeof onFIIFO==='function')      onFIIFO();
    if (typeof buildCommand==='function') buildCommand();
  }, 150);
}

// ──────────────────────────────────────────────────────────────
// BHAV OPTIONS — batch upsert from bhav.js upload
// ──────────────────────────────────────────────────────────────
async function dbSaveBhav(rows) {
  const db = getDB();
  if (!db || !rows?.length) return { ok: false, inserted: 0 };
  const enriched = rows.map(r => ({
    symbol:      'NIFTY',
    trade_date:  r.trade_date,
    option_type: r.option_type,
    strike:      r.strike,
    expiry_date: r.expiry_date,
    close_price: r.close_price,
    spot:        r.spot,
    dte:         r.dte,
    otm_pct:     r.otm_pct ?? (r.strike&&r.spot ? +((r.strike-r.spot)/r.spot).toFixed(5) : null),
    ann_vol:     r.ann_vol ?? null,
  }));
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < enriched.length; i += CHUNK) {
    const { error } = await db.from('bhav_options')
      .upsert(enriched.slice(i,i+CHUNK), { onConflict:'trade_date,symbol,option_type,strike,expiry_date' });
    if (!error) inserted += Math.min(CHUNK, enriched.length-i);
  }
  return { ok: true, inserted };
}

// ──────────────────────────────────────────────────────────────
// TRADES
// ──────────────────────────────────────────────────────────────
async function dbLogTrade(t) {
  const db = getDB();
  if (!db) return { ok: false, error: 'DB not ready' };
  const { data, error } = await db.from('trades').insert({
    trade_date:t.trade_date||todayIST(), symbol:t.symbol||'NIFTY', strategy:t.strategy,
    expiry_date:t.expiry_date,
    leg1_type:t.leg1_type||null, leg1_action:t.leg1_action||null,
    leg1_strike:t.leg1_strike||null, leg1_entry:t.leg1_entry||null,
    leg2_type:t.leg2_type||null, leg2_action:t.leg2_action||null,
    leg2_strike:t.leg2_strike||null, leg2_entry:t.leg2_entry||null,
    leg3_type:t.leg3_type||null, leg3_action:t.leg3_action||null,
    leg3_strike:t.leg3_strike||null, leg3_entry:t.leg3_entry||null,
    leg4_type:t.leg4_type||null, leg4_action:t.leg4_action||null,
    leg4_strike:t.leg4_strike||null, leg4_entry:t.leg4_entry||null,
    lots:t.lots||1, lot_size:t.lot_size||65, net_credit:t.net_credit||null,
    status:'OPEN', spot_at_entry:t.spot_at_entry||null,
    vix_at_entry:t.vix_at_entry||null, score_at_entry:t.score_at_entry||null,
    notes:t.notes||null,
  }).select('id').single();
  if (error) return { ok:false, error:error.message };
  return { ok:true, id:data.id };
}

async function dbCloseTrade(id, c) {
  const db = getDB();
  if (!db) return { ok:false };
  const { error } = await db.from('trades').update({
    exit_date:c.exit_date||todayIST(), pnl_pts:c.pnl_pts||null, pnl_rs:c.pnl_rs||null,
    leg1_exit:c.leg1_exit||null, leg2_exit:c.leg2_exit||null,
    leg3_exit:c.leg3_exit||null, leg4_exit:c.leg4_exit||null,
    status:c.status||'CLOSED', exit_reason:c.exit_reason||'MANUAL',
    notes:c.notes||null, updated_at:new Date().toISOString(),
  }).eq('id', id);
  return error ? { ok:false, error:error.message } : { ok:true };
}

async function dbGetTrades(limit=30) {
  const db = getDB();
  if (!db) return { ok:false, trades:[] };
  const { data, error } = await db.from('trades').select('*')
    .order('trade_date',{ascending:false}).limit(limit);
  if (error) return { ok:false, error:error.message, trades:[] };
  return { ok:true, trades:data||[] };
}

// ──────────────────────────────────────────────────────────────
// STRADDLE RATIOS — IDW lookup
// ──────────────────────────────────────────────────────────────
async function dbGetStraddleRatio(optType, dteBkt, otmBkt, annVol) {
  const db = getDB();
  if (!db) return null;
  const { data, error } = await db.from('straddle_ratios').select('ratio,ann_vol')
    .eq('option_type',optType).eq('dte_bucket',dteBkt).eq('otm_bucket',otmBkt)
    .order('ann_vol').limit(20);
  if (error||!data?.length) return null;
  const target = annVol||15;
  let wSum=0, rSum=0;
  for (const r of data) {
    const w = 1/(Math.abs(r.ann_vol-target)+0.1)**2;
    wSum+=w; rSum+=w*r.ratio;
  }
  return wSum>0 ? rSum/wSum : null;
}

function dteBucket(dte) {
  if (dte<=4) return '1-4'; if (dte<=8) return '5-8';
  if (dte<=12) return '9-12'; if (dte<=21) return '13-21'; return '22+';
}
function otmBucket(otmPct) {
  const d=Math.abs(otmPct||0)*100;
  if (d<=0.2) return 'ATM'; if (d<=0.8) return 'OTM1';
  if (d<=1.5) return 'OTM2'; if (d<=2.5) return 'OTM3'; return 'OTM4';
}

// ──────────────────────────────────────────────────────────────
// STATUS
// ──────────────────────────────────────────────────────────────
async function dbShowStatus() {
  const badge = document.getElementById('db-status-badge');
  if (!badge) return;
  badge.textContent='⏳ Connecting...'; badge.style.color='var(--am)';
  const db = getDB();
  if (!db) { badge.textContent='⚠️ DB unavailable'; badge.style.color='var(--rd)'; return; }
  try {
    const { error } = await db.from('daily_data').select('trade_date').limit(1);
    if (error) throw new Error(error.message);
    const { data:bData } = await db.from('bhav_options').select('trade_date').limit(5000);
    const days = bData ? new Set(bData.map(r=>r.trade_date)).size : 0;
    const rows = bData?.length || 0;
    badge.textContent=`✅ DB · ${days} bhav days · ${rows.toLocaleString('en-IN')} rows`;
    badge.style.color='var(--gn)';
  } catch(e) {
    badge.textContent=`⚠️ DB: ${e.message}`; badge.style.color='var(--am)';
  }
}
