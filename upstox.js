/* ============================================================
   upstox.js — Upstox API Integration for Market Radar v5.0
   Full chain fetch for ALL expiries, real LTPs + greeks
   ============================================================ */

const UPSTOX_API = 'https://api.upstox.com/v2';
const UPSTOX_API_KEY = 'ec42e3bc-566b-4438-8edf-861db047dc16';

// ── Global chain storage ──
window._CHAINS = { NF: {}, BNF: {} };
window._LIVE_VIX = null;
window._NF_HIST = [];
window._BNF_HIST = [];
window._NF_ATM_IV = null;
window._BNF_ATM_IV = null;

// ── Token Management ──
function upstoxGetToken() {
  const token = localStorage.getItem('upstox_access_token');
  const tokenDate = localStorage.getItem('upstox_token_date');
  const today = new Date().toISOString().slice(0, 10);
  if (!token || tokenDate !== today) return null;
  return token;
}

function upstoxSaveToken(token) {
  localStorage.setItem('upstox_access_token', token);
  localStorage.setItem('upstox_token_date', new Date().toISOString().slice(0, 10));
}

function upstoxShowTokenModal() {
  const modal = document.getElementById('token-modal');
  if (modal) modal.style.display = 'flex';
}

function upstoxHideTokenModal() {
  const modal = document.getElementById('token-modal');
  if (modal) modal.style.display = 'none';
}

function upstoxSaveAndFetch() {
  const input = document.getElementById('token-input');
  if (!input || !input.value.trim()) return;
  upstoxSaveToken(input.value.trim());
  upstoxHideTokenModal();
  upstoxAutoFill();
}

function _headers() {
  return {
    'Authorization': `Bearer ${upstoxGetToken()}`,
    'Accept': 'application/json',
    'Api-Version': '2.0'
  };
}

function _set(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ═══════════════════════════════════════════════════
// MASTER FETCH
// ═══════════════════════════════════════════════════

async function upstoxAutoFill() {
  const token = upstoxGetToken();
  if (!token) { upstoxShowTokenModal(); return; }

  const statusEl = document.getElementById('upstox-status');
  if (statusEl) statusEl.textContent = 'Fetching...';

  const nfExps  = getExpiries('NF').slice(0, 2);
  const bnfExps = getExpiries('BNF').slice(0, 2);

  window._CHAINS = { NF: {}, BNF: {} };

  try {
    const fetches = [
      upstoxFetchSpots(),
      upstoxFetchHistorical('NSE_INDEX|Nifty 50', true),
      upstoxFetchHistorical('NSE_INDEX|Nifty Bank', false),
      upstoxFetchPositions(),
      upstoxFetchMargins()
    ];
    for (const exp of nfExps)  fetches.push(upstoxFetchFullChain('NSE_INDEX|Nifty 50', exp, 'NF'));
    for (const exp of bnfExps) fetches.push(upstoxFetchFullChain('NSE_INDEX|Nifty Bank', exp, 'BNF'));

    const results = await Promise.allSettled(fetches);
    const total   = results.length;
    const ok      = results.filter(r => r.status === 'fulfilled').length;

    localStorage.setItem('upstox_last_fetch', new Date().toISOString());
    if (statusEl) statusEl.textContent = `✅ ${ok}/${total} fetched`;

    console.log(`[upstox] Chains: NF=${Object.keys(window._CHAINS.NF).length}, BNF=${Object.keys(window._CHAINS.BNF).length}`);

    calcScore();
    buildCommand();
  } catch(e) {
    console.error('[upstox] AutoFill error:', e);
    if (statusEl) statusEl.textContent = `❌ ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════
// SPOTS + VIX
// ═══════════════════════════════════════════════════

async function upstoxFetchSpots() {
  const resp = await fetch(`${UPSTOX_API}/market-quote/quotes?instrument_key=NSE_INDEX|Nifty 50,NSE_INDEX|Nifty Bank,NSE_INDEX|India VIX`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Spots fetch failed');

  for (const key in data.data) {
    const q = data.data[key];
    const ltp = q.last_price || (q.ohlc && q.ohlc.close);
    if (key.includes('Nifty 50') && !key.includes('Bank')) _set('nf_price', ltp);
    if (key.includes('Nifty Bank')) _set('bn_price', ltp);
    if (key.includes('India VIX')) { _set('india_vix', ltp); _set('strat_vix', ltp); window._LIVE_VIX = ltp; }
  }
}

// ═══════════════════════════════════════════════════
// FULL CHAIN FETCH — real LTPs + greeks per strike
// ═══════════════════════════════════════════════════

async function upstoxFetchFullChain(instrument, expiry, indexKey) {
  if (!expiry) return;

  const resp = await fetch(`${UPSTOX_API}/option/chain?instrument_key=${encodeURIComponent(instrument)}&expiry_date=${expiry}`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data) throw new Error(`Chain failed: ${indexKey} ${expiry}`);

  const isNF = indexKey === 'NF';
  const spot = gv(isNF ? 'nf_price' : 'bn_price') || 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const expDate = new Date(expiry); expDate.setHours(0,0,0,0);
  const dte = Math.max(1, Math.round((expDate - today) / 86400000));

  const strikes = {};
  let putOI = 0, callOI = 0;
  let maxCallOI = 0, maxCallStrike = 0, maxPutOI = 0, maxPutStrike = 0;
  let maxPainMap = {};
  let atmIV = null;

  for (const item of data.data) {
    const strike = item.strike_price;
    if (!strike) continue;
    if (spot > 0 && Math.abs(strike - spot) > (isNF ? 1500 : 4000)) continue;

    const sd = {};

    if (item.call_options) {
      const md = item.call_options.market_data || {};
      const gr = item.call_options.greeks || {};
      sd.CE = {
        ltp: md.ltp || 0, bid: md.bid_price || md.ltp || 0, ask: md.ask_price || md.ltp || 0,
        oi: md.oi || 0, vol: md.volume || 0,
        delta: gr.delta, theta: gr.theta, gamma: gr.gamma, vega: gr.vega, iv: gr.iv
      };
      callOI += (md.oi || 0);
      if ((md.oi || 0) > maxCallOI) { maxCallOI = md.oi; maxCallStrike = strike; }
      if (!maxPainMap[strike]) maxPainMap[strike] = 0;
      maxPainMap[strike] += (md.oi || 0) * Math.max(0, spot - strike);
      if (spot > 0 && Math.abs(strike - spot) < (isNF ? 50 : 100) && gr.iv) atmIV = gr.iv;
    }

    if (item.put_options) {
      const md = item.put_options.market_data || {};
      const gr = item.put_options.greeks || {};
      sd.PE = {
        ltp: md.ltp || 0, bid: md.bid_price || md.ltp || 0, ask: md.ask_price || md.ltp || 0,
        oi: md.oi || 0, vol: md.volume || 0,
        delta: gr.delta, theta: gr.theta, gamma: gr.gamma, vega: gr.vega, iv: gr.iv
      };
      putOI += (md.oi || 0);
      if ((md.oi || 0) > maxPutOI) { maxPutOI = md.oi; maxPutStrike = strike; }
      if (!maxPainMap[strike]) maxPainMap[strike] = 0;
      maxPainMap[strike] += (md.oi || 0) * Math.max(0, strike - spot);
    }

    if (sd.CE || sd.PE) strikes[strike] = sd;
  }

  const pcr = callOI > 0 ? +(putOI / callOI).toFixed(2) : 0;
  let minPain = Infinity, mpStrike = 0;
  for (const s in maxPainMap) { if (maxPainMap[s] < minPain) { minPain = maxPainMap[s]; mpStrike = +s; } }

  window._CHAINS[indexKey][expiry] = { strikes, spot, dte, pcr, callOI, putOI, callWall: maxCallStrike, putWall: maxPutStrike, maxPain: mpStrike, atmIV };

  // Set hidden fields for nearest expiry (scoring compat)
  const allExps = Object.keys(window._CHAINS[indexKey]).sort();
  if (expiry === allExps[0]) {
    _set(`pcr_${isNF ? 'nf' : 'bn'}`, pcr);
    _set(`${isNF ? 'nf' : 'bn'}_oi_call`, maxCallStrike);
    _set(`${isNF ? 'nf' : 'bn'}_oi_put`, maxPutStrike);
    _set(`${isNF ? 'nf' : 'bn'}_maxpain`, mpStrike);
    if (isNF) { _set('max_pain_nf', mpStrike); window._NF_ATM_IV = atmIV; }
    else window._BNF_ATM_IV = atmIV;
  }
}

// ═══════════════════════════════════════════════════
// HISTORICAL OHLC → ATR14 + CLOSE CHAR
// ═══════════════════════════════════════════════════

async function upstoxFetchHistorical(instrument, isNF) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);

  const resp = await fetch(`${UPSTOX_API}/historical-candle/${encodeURIComponent(instrument)}/day/${to}/${from}`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data || !data.data.candles) throw new Error(`Historical failed`);

  const candles = data.data.candles;
  if (candles.length < 2) return;
  candles.sort((a, b) => new Date(a[0]) - new Date(b[0]));

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2], l = candles[i][3], pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const period = Math.min(14, trs.length);
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;

  _set(isNF ? 'nf_atr' : 'bn_atr', +atr.toFixed(2));

  const latest = candles[candles.length - 1];
  const prevClose = candles[candles.length - 2][4];
  if (isNF) {
    _set('nifty_prev', prevClose);
    const pct = ((latest[4] - prevClose) / prevClose) * 100;
    _set('close_char', pct >= 0.8 ? 2 : pct >= 0.3 ? 1 : pct >= -0.3 ? 0 : pct >= -0.8 ? -1 : -2);
  }
  if (isNF) window._NF_HIST = candles.map(c => c[4]);
  else window._BNF_HIST = candles.map(c => c[4]);
}

// ═══════════════════════════════════════════════════
// POSITIONS + MARGINS
// ═══════════════════════════════════════════════════

async function upstoxFetchPositions() {
  const resp = await fetch(`${UPSTOX_API}/portfolio/short-term-positions`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Positions failed');
  const positions = data.data || [];
  const el = document.getElementById('upstox-positions');
  if (!el) return;
  if (!positions.length) { el.innerHTML = '<div class="pos-empty">No open positions</div>'; return; }
  el.innerHTML = '<div class="pos-title">Open Positions</div>' + positions.map(p => {
    const pnl = p.pnl || 0;
    return `<div class="pos-row"><span class="pos-symbol">${p.tradingsymbol||'—'}</span><span class="pos-qty">${p.quantity||0}</span><span class="pos-avg">₹${(p.average_price||0).toFixed(2)}</span><span class="${pnl>=0?'pnl-profit':'pnl-loss'}">₹${pnl.toFixed(2)}</span></div>`;
  }).join('');
}

async function upstoxFetchMargins() {
  const resp = await fetch(`${UPSTOX_API}/user/get-funds-and-margin`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Margins failed');
  const m = data.data;
  const el = document.getElementById('upstox-margin');
  if (!el || !m) return;
  const avail = m.equity ? (m.equity.available_margin || 0) : 0;
  const used = m.equity ? (m.equity.used_margin || 0) : 0;
  el.innerHTML = `<div class="margin-info"><span>Available: ₹${avail.toLocaleString('en-IN')}</span><span>Used: ₹${used.toLocaleString('en-IN')}</span></div>`;
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('btn-save-token');
  if (saveBtn) saveBtn.addEventListener('click', upstoxSaveAndFetch);
  const fetchBtn = document.getElementById('btn-fetch-upstox');
  if (fetchBtn) fetchBtn.addEventListener('click', upstoxAutoFill);
  if (upstoxGetToken()) setTimeout(upstoxAutoFill, 500);
  console.log('[upstox.js] v5.0 — full chain mode');
});
