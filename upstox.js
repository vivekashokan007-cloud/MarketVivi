/* ============================================================
   upstox.js — Upstox API Integration for Market Radar v5.0
   Full chain fetch for ALL expiries, real LTPs + greeks
   Fixed: max pain algorithm, PCR calculation
   ============================================================ */

const UPSTOX_API = 'https://api.upstox.com/v2';
const UPSTOX_API_KEY = 'ec42e3bc-566b-4438-8edf-861db047dc16';

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
  return { 'Authorization': `Bearer ${upstoxGetToken()}`, 'Accept': 'application/json', 'Api-Version': '2.0' };
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
    const total = results.length;
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fails = results.filter(r => r.status === 'rejected');

    localStorage.setItem('upstox_last_fetch', new Date().toISOString());
    if (statusEl) statusEl.textContent = `✅ ${ok}/${total} fetched`;

    // Log any failures for debugging
    fails.forEach((f, i) => console.warn(`[upstox] Fetch #${i} failed:`, f.reason));

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
// FULL CHAIN FETCH — real LTPs + greeks + CORRECT MAX PAIN
// ═══════════════════════════════════════════════════

async function upstoxFetchFullChain(instrument, expiry, indexKey) {
  if (!expiry) return;

  const resp = await fetch(`${UPSTOX_API}/option/chain?instrument_key=${encodeURIComponent(instrument)}&expiry_date=${expiry}`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data) throw new Error(`Chain failed: ${indexKey} ${expiry}`);

  // Store raw sample for debug inspection
  if (!window._RAW_CHAIN_SAMPLE) window._RAW_CHAIN_SAMPLE = {};
  const rawItems = Array.isArray(data.data) ? data.data : [];
  window._RAW_CHAIN_SAMPLE[`${indexKey}_${expiry}`] = {
    isArray: Array.isArray(data.data),
    type: typeof data.data,
    length: rawItems.length,
    topKeys: Array.isArray(data.data) ? null : Object.keys(data.data).slice(0, 10),
    firstItem: rawItems.length > 0 ? JSON.parse(JSON.stringify(rawItems[0])) : data.data,
    sampleKeys: rawItems.length > 0 ? Object.keys(rawItems[0]) : []
  };

  const isNF = indexKey === 'NF';
  const spot = gv(isNF ? 'nf_price' : 'bn_price') || 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const expDate = new Date(expiry); expDate.setHours(0,0,0,0);
  const dte = Math.max(1, Math.round((expDate - today) / 86400000));
  // Trading days (excludes weekends + NSE holidays) — for VIX-based expected move
  const tdte = typeof tradingDaysTo === 'function' ? tradingDaysTo(expiry) : dte;

  const strikes = {};
  let putOI = 0, callOI = 0;
  let maxCallOI = 0, maxCallStrike = 0, maxPutOI = 0, maxPutStrike = 0;
  let atmIV = null;

  // Collect all OI data for max pain calculation
  const callOIMap = {}; // strike → OI
  const putOIMap  = {}; // strike → OI

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
      const thisOI = md.oi || 0;
      callOI += thisOI;
      callOIMap[strike] = thisOI;
      if (thisOI > maxCallOI) { maxCallOI = thisOI; maxCallStrike = strike; }
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
      const thisOI = md.oi || 0;
      putOI += thisOI;
      putOIMap[strike] = thisOI;
      if (thisOI > maxPutOI) { maxPutOI = thisOI; maxPutStrike = strike; }
    }

    if (sd.CE || sd.PE) strikes[strike] = sd;
  }

  // ── PCR ──
  const pcr = callOI > 0 ? +(putOI / callOI).toFixed(2) : 0;

  // ── MAX PAIN — correct algorithm ──
  // For each candidate settlement price, sum total loss to ALL option buyers
  // Max pain = strike where buyers lose the most (minimum payout to buyers)
  const allStrikes = Object.keys(strikes).map(Number).sort((a, b) => a - b);
  let mpStrike = 0;

  if (allStrikes.length > 0) {
    let minTotalPain = Infinity;

    for (const candidate of allStrikes) {
      let totalPain = 0;

      // For each call: if candidate > call_strike, call holder gains (candidate - strike) × OI
      // We want to find where total gains to buyers are MINIMIZED
      for (const ks in callOIMap) {
        const k = Number(ks);
        const oi = callOIMap[k];
        if (oi > 0 && candidate > k) {
          totalPain += (candidate - k) * oi;
        }
      }

      // For each put: if candidate < put_strike, put holder gains (strike - candidate) × OI
      for (const ks in putOIMap) {
        const k = Number(ks);
        const oi = putOIMap[k];
        if (oi > 0 && candidate < k) {
          totalPain += (k - candidate) * oi;
        }
      }

      if (totalPain < minTotalPain) {
        minTotalPain = totalPain;
        mpStrike = candidate;
      }
    }
  }

  // ── Store chain ──
  window._CHAINS[indexKey][expiry] = {
    strikes, spot, dte, tradingDte: tdte, pcr, callOI, putOI,
    callWall: maxCallStrike, putWall: maxPutStrike,
    maxPain: mpStrike, atmIV
  };

  // Set hidden fields for nearest expiry
  const allExps = Object.keys(window._CHAINS[indexKey]).sort();
  if (expiry === allExps[0]) {
    _set(`pcr_${isNF ? 'nf' : 'bn'}`, pcr);
    _set(`${isNF ? 'nf' : 'bn'}_oi_call`, maxCallStrike);
    _set(`${isNF ? 'nf' : 'bn'}_oi_put`, maxPutStrike);
    _set(`${isNF ? 'nf' : 'bn'}_maxpain`, mpStrike);
    if (isNF) { _set('max_pain_nf', mpStrike); window._NF_ATM_IV = atmIV; }
    else window._BNF_ATM_IV = atmIV;
  }

  console.log(`[upstox] Chain: ${indexKey} ${expiry} — ${allStrikes.length} strikes, PCR=${pcr}, MaxPain=${mpStrike}, CallOI=${callOI}, PutOI=${putOI}, DTE=${dte}`);
}

// ═══════════════════════════════════════════════════
// HISTORICAL OHLC → ATR14 + CLOSE CHAR
// ═══════════════════════════════════════════════════

async function upstoxFetchHistorical(instrument, isNF) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);

  const resp = await fetch(`${UPSTOX_API}/historical-candle/${encodeURIComponent(instrument)}/day/${to}/${from}`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data || !data.data.candles) throw new Error('Historical failed');

  const candles = data.data.candles;
  if (candles.length < 2) return;
  candles.sort((a, b) => new Date(a[0]) - new Date(b[0]));

  // ATR14 — Wilder's smoothing
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2], l = candles[i][3], pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const period = Math.min(14, trs.length);
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;

  _set(isNF ? 'nf_atr' : 'bn_atr', +atr.toFixed(2));

  // Close character
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
// POSITIONS
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

// ═══════════════════════════════════════════════════
// MARGINS — handle multiple response structures
// ═══════════════════════════════════════════════════

async function upstoxFetchMargins() {
  const resp = await fetch(`${UPSTOX_API}/user/get-funds-and-margin`, { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Margins failed');

  const m = data.data;
  const el = document.getElementById('upstox-margin');
  if (!el || !m) return;

  // Upstox may return margin under different keys depending on segment
  let avail = 0, used = 0;

  if (m.equity) {
    avail = m.equity.available_margin || m.equity.net || 0;
    used  = m.equity.used_margin || m.equity.blocked_margin || 0;
  } else if (m.commodity) {
    avail = m.commodity.available_margin || 0;
    used  = m.commodity.used_margin || 0;
  }

  // Also check top-level keys (some API versions)
  if (avail === 0 && m.available_margin) avail = m.available_margin;
  if (used === 0 && m.used_margin) used = m.used_margin;

  // Log full margin response for debugging
  console.log('[upstox] Margin response:', JSON.stringify(m));

  el.innerHTML = `<div class="margin-info">
    <span>Available: ₹${avail.toLocaleString('en-IN')}</span>
    <span> | Used: ₹${used.toLocaleString('en-IN')}</span>
  </div>`;
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
