/* ============================================================
   upstox.js — Upstox API Integration for Market Radar v5.0
   Fetches available expiries from Upstox, then full chains
   ============================================================ */

const UPSTOX_API = 'https://api.upstox.com/v2';
const UPSTOX_API_KEY = '21504576-c556-46be-8b25-cee6cbfe79e6';

window._CHAINS = { NF: {}, BNF: {} };
window._LIVE_VIX = null;
window._NF_HIST = [];
window._BNF_HIST = [];
window._NF_ATM_IV = null;
window._BNF_ATM_IV = null;
window._NF_FUTURES_LTP = null;   // Synthetic from put-call parity
window._BNF_FUTURES_LTP = null;
window._NF_FUTURES_PREMIUM = null;
window._BNF_FUTURES_PREMIUM = null;
window._NF_ACTUAL_FUTURES = null;  // Actual from Upstox futures contract
window._BNF_ACTUAL_FUTURES = null;

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
  return { 'Authorization': `Bearer ${upstoxGetToken()}`, 'Accept': 'application/json', 'Api-Version': '2.0', 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' };
}
function _bust(url) {
  // Cache-buster: append timestamp to prevent browser caching
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_t=${Date.now()}`;
}
function _set(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ═══════════════════════════════════════════════════
// FETCH AVAILABLE EXPIRIES FROM UPSTOX
// ═══════════════════════════════════════════════════

async function upstoxFetchExpiries(instrument) {
  const resp = await fetch(_bust(`${UPSTOX_API}/option/contract?instrument_key=${encodeURIComponent(instrument)}`), { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data) throw new Error(`Expiry fetch failed: ${instrument}`);

  // data.data is an array of contract objects — extract unique expiry dates
  const expiries = new Set();
  for (const contract of data.data) {
    if (contract.expiry) expiries.add(contract.expiry);
    if (contract.expiry_date) expiries.add(contract.expiry_date);
  }

  // Sort ascending and return
  const sorted = [...expiries].sort();
  console.log(`[upstox] Expiries for ${instrument}: ${sorted.slice(0, 5).join(', ')} (${sorted.length} total)`);
  return sorted;
}

// ═══════════════════════════════════════════════════
// MASTER FETCH
// ═══════════════════════════════════════════════════

async function upstoxAutoFill() {
  const token = upstoxGetToken();
  if (!token) { upstoxShowTokenModal(); return; }

  const statusEl = document.getElementById('upstox-status');
  if (statusEl) statusEl.textContent = 'Fetching...';

  window._CHAINS = { NF: {}, BNF: {} };
  if (!window._RAW_CHAIN_SAMPLE) window._RAW_CHAIN_SAMPLE = {};

  try {
    // Step 1: Fetch spots first (needed for chain filtering)
    await upstoxFetchSpots();

    // Step 1b: Fetch actual futures LTP (needed for risk center in chains)
    await upstoxFetchFutures();

    // Step 2: Fetch available expiries from Upstox
    let nfExps = [], bnfExps = [];
    try {
      const nfAll = await upstoxFetchExpiries('NSE_INDEX|Nifty 50');
      nfExps = nfAll.slice(0, 2); // nearest 2
    } catch(e) {
      console.warn('[upstox] NF expiry fetch failed:', e.message);
    }
    try {
      const bnfAll = await upstoxFetchExpiries('NSE_INDEX|Nifty Bank');
      bnfExps = bnfAll.slice(0, 2); // nearest 2
    } catch(e) {
      console.warn('[upstox] BNF expiry fetch failed:', e.message);
    }

    console.log(`[upstox] Using NF expiries: ${nfExps.join(', ')}`);
    console.log(`[upstox] Using BNF expiries: ${bnfExps.join(', ')}`);

    // Step 3: Build remaining fetches (SIGNAL data only — no positions/tradebook)
    const fetches = [
      upstoxFetchHistorical('NSE_INDEX|Nifty 50', true),
      upstoxFetchHistorical('NSE_INDEX|Nifty Bank', false),
      upstoxFetchMargins()
    ];
    for (const exp of nfExps)  fetches.push(upstoxFetchFullChain('NSE_INDEX|Nifty 50', exp, 'NF'));
    for (const exp of bnfExps) fetches.push(upstoxFetchFullChain('NSE_INDEX|Nifty Bank', exp, 'BNF'));

    const results = await Promise.allSettled(fetches);
    const total = 1 + 2 + results.length; // spots + expiry lookups + rest
    const ok = results.filter(r => r.status === 'fulfilled').length + 3; // +3 for spots + 2 expiry fetches
    const fails = results.filter(r => r.status === 'rejected');

    localStorage.setItem('upstox_last_fetch', new Date().toISOString());
    if (statusEl) statusEl.textContent = `✅ ${ok}/${total} fetched`;

    fails.forEach(f => console.warn('[upstox] Fetch failed:', f.reason));
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
  const resp = await fetch(_bust(`${UPSTOX_API}/market-quote/quotes?instrument_key=NSE_INDEX|Nifty 50,NSE_INDEX|Nifty Bank,NSE_INDEX|India VIX`), { headers: _headers() });
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
// ACTUAL FUTURES LTP
// ═══════════════════════════════════════════════════

function _futuresKey(index) {
  // Construct current month futures instrument key
  // Format: NSE_FO|NIFTY{YY}{MON}FUT or NSE_FO|BANKNIFTY{YY}{MON}FUT
  const now = new Date();
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const yy = String(now.getFullYear()).slice(-2);
  const mon = months[now.getMonth()];
  const sym = index === 'NF' ? 'NIFTY' : 'BANKNIFTY';
  return `NSE_FO|${sym}${yy}${mon}FUT`;
}

async function upstoxFetchFutures() {
  try {
    const nfKey = _futuresKey('NF');
    const bnfKey = _futuresKey('BNF');
    const resp = await fetch(_bust(`${UPSTOX_API}/market-quote/quotes?instrument_key=${encodeURIComponent(nfKey)},${encodeURIComponent(bnfKey)}`), { headers: _headers() });
    const data = await resp.json();
    if (data.status !== 'success' || !data.data) {
      console.warn('[upstox] Futures fetch failed — will use synthetic');
      return;
    }
    for (const key in data.data) {
      const q = data.data[key];
      const ltp = q.last_price || (q.ohlc && q.ohlc.close);
      if (!ltp) continue;
      if (key.includes('BANKNIFTY')) {
        window._BNF_ACTUAL_FUTURES = ltp;
        console.log(`[upstox] BNF Actual Futures: ${ltp}`);
      } else if (key.includes('NIFTY')) {
        window._NF_ACTUAL_FUTURES = ltp;
        console.log(`[upstox] NF Actual Futures: ${ltp}`);
      }
    }
  } catch(e) {
    console.warn('[upstox] Futures fetch error (will use synthetic):', e.message);
  }
}

// ═══════════════════════════════════════════════════
// FULL CHAIN FETCH
// ═══════════════════════════════════════════════════

async function upstoxFetchFullChain(instrument, expiry, indexKey) {
  if (!expiry) return;

  const resp = await fetch(_bust(`${UPSTOX_API}/option/chain?instrument_key=${encodeURIComponent(instrument)}&expiry_date=${expiry}`), { headers: _headers() });
  const data = await resp.json();

  // Store raw sample for debug
  const rawItems = Array.isArray(data.data) ? data.data : [];
  window._RAW_CHAIN_SAMPLE[`${indexKey}_${expiry}`] = {
    status: data.status,
    isArray: Array.isArray(data.data),
    type: typeof data.data,
    length: rawItems.length,
    topKeys: Array.isArray(data.data) ? null : (data.data ? Object.keys(data.data).slice(0, 10) : []),
    firstItem: rawItems.length > 0 ? JSON.parse(JSON.stringify(rawItems[0])) : (data.data || null),
    sampleKeys: rawItems.length > 0 ? Object.keys(rawItems[0]) : []
  };

  if (data.status !== 'success' || !data.data) throw new Error(`Chain failed: ${indexKey} ${expiry}`);

  const isNF = indexKey === 'NF';
  const spot = gv(isNF ? 'nf_price' : 'bn_price') || 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const expDate = new Date(expiry); expDate.setHours(0,0,0,0);
  const dte = Math.max(1, Math.round((expDate - today) / 86400000));
  const tdte = typeof tradingDaysTo === 'function' ? tradingDaysTo(expiry) : dte;

  const strikes = {};
  let putOI = 0, callOI = 0;
  let maxCallOI = 0, maxCallStrike = 0, maxPutOI = 0, maxPutStrike = 0;
  let atmIV = null;
  const callOIMap = {};
  const putOIMap = {};

  for (const item of rawItems) {
    // Try multiple possible field names for strike price
    const strike = item.strike_price || item.strikePrice || item.strike;
    if (!strike) continue;
    if (spot > 0 && Math.abs(strike - spot) > (isNF ? 1500 : 4000)) continue;

    const sd = {};

    // Call options — try multiple field name patterns
    const callData = item.call_options || item.callOptions || item.CE || item.ce;
    if (callData) {
      const md = callData.market_data || callData.marketData || callData;
      const gr = callData.greeks || callData.option_greeks || callData;
      sd.CE = {
        ltp:   md.ltp || md.last_price || md.lastPrice || 0,
        bid:   md.bid_price || md.bidPrice || md.best_bid_price || md.ltp || 0,
        ask:   md.ask_price || md.askPrice || md.best_ask_price || md.ltp || 0,
        oi:    md.oi || md.open_interest || md.openInterest || 0,
        vol:   md.volume || md.traded_volume || 0,
        delta: gr.delta, theta: gr.theta, gamma: gr.gamma, vega: gr.vega,
        iv:    gr.iv || gr.implied_volatility || gr.impliedVolatility || null,
        instrument_key: callData.instrument_key || null
      };
      const thisOI = sd.CE.oi;
      callOI += thisOI;
      callOIMap[strike] = thisOI;
      if (thisOI > maxCallOI) { maxCallOI = thisOI; maxCallStrike = strike; }
      if (spot > 0 && Math.abs(strike - spot) < (isNF ? 50 : 100) && sd.CE.iv) atmIV = sd.CE.iv;
    }

    // Put options
    const putData = item.put_options || item.putOptions || item.PE || item.pe;
    if (putData) {
      const md = putData.market_data || putData.marketData || putData;
      const gr = putData.greeks || putData.option_greeks || putData;
      sd.PE = {
        ltp:   md.ltp || md.last_price || md.lastPrice || 0,
        bid:   md.bid_price || md.bidPrice || md.best_bid_price || md.ltp || 0,
        ask:   md.ask_price || md.askPrice || md.best_ask_price || md.ltp || 0,
        oi:    md.oi || md.open_interest || md.openInterest || 0,
        vol:   md.volume || md.traded_volume || 0,
        delta: gr.delta, theta: gr.theta, gamma: gr.gamma, vega: gr.vega,
        iv:    gr.iv || gr.implied_volatility || gr.impliedVolatility || null,
        instrument_key: putData.instrument_key || null
      };
      const thisOI = sd.PE.oi;
      putOI += thisOI;
      putOIMap[strike] = thisOI;
      if (thisOI > maxPutOI) { maxPutOI = thisOI; maxPutStrike = strike; }
    }

    if (sd.CE || sd.PE) strikes[strike] = sd;
  }

  // PCR
  const pcr = callOI > 0 ? +(putOI / callOI).toFixed(2) : 0;

  // Max Pain — correct algorithm
  const allStrikes = Object.keys(strikes).map(Number).sort((a, b) => a - b);
  let mpStrike = 0;
  if (allStrikes.length > 0) {
    let minTotalPain = Infinity;
    for (const candidate of allStrikes) {
      let totalPain = 0;
      for (const ks in callOIMap) {
        const k = Number(ks), oi = callOIMap[k];
        if (oi > 0 && candidate > k) totalPain += (candidate - k) * oi;
      }
      for (const ks in putOIMap) {
        const k = Number(ks), oi = putOIMap[k];
        if (oi > 0 && candidate < k) totalPain += (k - candidate) * oi;
      }
      if (totalPain < minTotalPain) { minTotalPain = totalPain; mpStrike = candidate; }
    }
  }

  // Risk center: actual futures if available, else spot
  const actualFut = isNF ? window._NF_ACTUAL_FUTURES : window._BNF_ACTUAL_FUTURES;
  const riskCenter = actualFut || spot;

  // Store chain
  window._CHAINS[indexKey][expiry] = {
    strikes, spot, riskCenter, dte, tradingDte: tdte, pcr, callOI, putOI,
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

    // Calculate synthetic futures premium from ATM put-call parity
    const atmStrike = allStrikes.reduce((best, s) => Math.abs(s - spot) < Math.abs(best - spot) ? s : best, allStrikes[0]);
    const atmData = strikes[atmStrike];
    if (atmData && atmData.CE && atmData.PE && atmData.CE.ltp > 0 && atmData.PE.ltp > 0) {
      const synthFutures = atmStrike + (atmData.CE.ltp - atmData.PE.ltp);
      const futPremium = spot > 0 ? +((synthFutures - spot) / spot * 100).toFixed(3) : 0;
      if (isNF) { window._NF_FUTURES_LTP = +synthFutures.toFixed(2); window._NF_FUTURES_PREMIUM = futPremium; _set('nf_fut_premium', futPremium); }
      else { window._BNF_FUTURES_LTP = +synthFutures.toFixed(2); window._BNF_FUTURES_PREMIUM = futPremium; _set('bnf_fut_premium', futPremium); }
      console.log(`[upstox] ${indexKey} Synth Futures: ${synthFutures.toFixed(2)} (${futPremium > 0 ? '+' : ''}${futPremium}% premium)`);
    }
  }

  console.log(`[upstox] Chain: ${indexKey} ${expiry} — ${allStrikes.length} strikes, PCR=${pcr}, MaxPain=${mpStrike}, CallOI=${callOI}, PutOI=${putOI}, DTE=${dte}/${tdte}T`);
}

// ═══════════════════════════════════════════════════
// HISTORICAL OHLC → ATR14 + CLOSE CHAR
// ═══════════════════════════════════════════════════

async function upstoxFetchHistorical(instrument, isNF) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);

  const resp = await fetch(_bust(`${UPSTOX_API}/historical-candle/${encodeURIComponent(instrument)}/day/${to}/${from}`), { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success' || !data.data || !data.data.candles) throw new Error('Historical failed');

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
  // Try positions API — may return empty for strategy-placed trades
  try {
    const resp = await fetch(_bust(`${UPSTOX_API}/portfolio/short-term-positions`), { headers: _headers() });
    const data = await resp.json();
    const positions = (data.status === 'success' && Array.isArray(data.data)) ? data.data : [];
    window._UPSTOX_POSITIONS = positions;
    console.log(`[upstox] Positions API: ${positions.length} positions`);
  } catch(e) {
    window._UPSTOX_POSITIONS = [];
    console.warn('[upstox] Positions fetch failed:', e.message);
  }
}

async function upstoxFetchMargins() {
  const resp = await fetch(_bust(`${UPSTOX_API}/user/get-funds-and-margin`), { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Margins failed');
  const m = data.data;
  const el = document.getElementById('upstox-margin');
  if (!el || !m) return;
  let avail = 0, used = 0;
  if (m.equity) { avail = m.equity.available_margin || m.equity.net || 0; used = m.equity.used_margin || m.equity.blocked_margin || 0; }
  if (avail === 0 && m.available_margin) avail = m.available_margin;
  if (used === 0 && m.used_margin) used = m.used_margin;
  // Store globally for strategy filtering
  window._AVAILABLE_MARGIN = avail;
  console.log('[upstox] Margin:', avail, 'used:', used);
  el.innerHTML = `<div class="margin-info"><span>Available: ₹${avail.toLocaleString('en-IN')}</span><span> | Used: ₹${used.toLocaleString('en-IN')}</span></div>`;
}

// ═══════════════════════════════════════════════════
// MARGIN CALCULATOR API — check if strategy fits capital
// ═══════════════════════════════════════════════════

async function upstoxCheckMargin(legs, lotSize) {
  // Build instruments array for Upstox margin API
  try {
    const qty = lotSize || 1;
    const instruments = legs.map(l => ({
      instrument_key: l.data.instrument_key || '',
      quantity: qty,
      transaction_type: l.action === 'SELL' ? 'SELL' : 'BUY',
      product: 'D'
    })).filter(i => i.instrument_key);

    if (!instruments.length) {
      console.warn('[upstox] Margin check skipped — no instrument_keys on legs');
      return null;
    }

    const resp = await fetch(_bust(`${UPSTOX_API}/charges/margin`), {
      method: 'POST',
      headers: { ..._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruments })
    });
    const data = await resp.json();
    console.log('[upstox] Margin API response:', JSON.stringify(data).substring(0, 500));
    if (data.status === 'success' && data.data) {
      const required = data.data.required_margin || data.data.total_margin || data.data.margin || 0;
      console.log('[upstox] Margin check:', required);
      return { ok: true, required: required };
    }
    console.warn('[upstox] Margin API non-success:', data.status, data.message || '');
    return null;
  } catch(e) {
    console.warn('[upstox] Margin API failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// TRADE BOOK — Actual fills for exit detection
// ═══════════════════════════════════════════════════

async function upstoxFetchTradeBook() {
  const resp = await fetch(_bust(`${UPSTOX_API}/order/trades/get-trades-for-day`), { headers: _headers() });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error('Trade book failed');
  const trades = data.data || [];

  // Store globally — reconstruction happens AFTER chains are loaded
  window._UPSTOX_TRADE_BOOK = trades;
  console.log(`[upstox] Trade book: ${trades.length} fills today`);
}

function reconstructPositionsFromTrades(trades) {
  // Group fills by tradingsymbol → calculate net qty and avg price
  const bySymbol = {};
  for (const t of trades) {
    const sym = t.tradingsymbol || t.trading_symbol || '';
    if (!sym) continue;
    if (!bySymbol[sym]) bySymbol[sym] = { buys: [], sells: [], raw: t };
    const qty = Math.abs(t.quantity || 0);
    const price = t.price || t.average_price || 0;
    if (t.transaction_type === 'BUY') {
      bySymbol[sym].buys.push({ qty, price });
    } else {
      bySymbol[sym].sells.push({ qty, price });
    }
  }

  const positions = [];
  for (const sym in bySymbol) {
    const { buys, sells, raw } = bySymbol[sym];
    const totalBuyQty = buys.reduce((s, b) => s + b.qty, 0);
    const totalSellQty = sells.reduce((s, b) => s + b.qty, 0);
    const netQty = totalBuyQty - totalSellQty;

    if (netQty === 0) continue; // Fully closed

    const avgPrice = netQty > 0
      ? buys.reduce((s, b) => s + b.qty * b.price, 0) / totalBuyQty
      : sells.reduce((s, b) => s + b.qty * b.price, 0) / totalSellQty;

    positions.push({
      tradingsymbol: sym,
      trading_symbol: sym,
      quantity: netQty,
      net_quantity: netQty,
      average_price: +avgPrice.toFixed(2),
      buy_price: netQty > 0 ? +avgPrice.toFixed(2) : 0,
      sell_price: netQty < 0 ? +avgPrice.toFixed(2) : 0,
      pnl: 0,
      // Pass through expiry + instrument_key from raw trade data
      expiry: raw.expiry || raw.expiry_date || null,
      instrument_key: raw.instrument_key || raw.instrument_token || null,
      exchange: raw.exchange || 'NSE_FO'
    });
  }

  console.log(`[upstox] Reconstructed ${positions.length} positions from trade book`);
  return positions;
}

// ═══════════════════════════════════════════════════
// POSITIONS SYNC — Separate from SIGNAL fetch
// Detects trades, matches exits, starts auto-tracking
// ═══════════════════════════════════════════════════

async function upstoxSyncPositions() {
  const token = upstoxGetToken();
  if (!token) { upstoxShowTokenModal(); return; }

  const statusEl = document.getElementById('sync-status');
  if (statusEl) statusEl.textContent = '🔄 Syncing with Upstox...';

  try {
    // Step 1: Fresh spot prices
    await upstoxFetchSpots();

    // Step 2: Fetch positions API + trade book
    await upstoxFetchPositions();
    await upstoxFetchTradeBook();

    // Step 3: Fetch chains for open trade expiries (needed for live P&L + thesis)
    const openTrades = typeof dbGetOpenTrades === 'function' ? await dbGetOpenTrades() : [];
    const neededExpiries = new Set();
    for (const t of openTrades) {
      if (t.index_key && t.expiry) neededExpiries.add(`${t.index_key}|${t.expiry}`);
    }
    // Also parse trade book symbols for any new trades
    const trades = window._UPSTOX_TRADE_BOOK || [];
    for (const t of trades) {
      const sym = t.tradingsymbol || t.trading_symbol || '';
      const parsed = typeof parseUpstoxSymbol === 'function' ? parseUpstoxSymbol(sym) : null;
      if (parsed) neededExpiries.add(`${parsed.indexKey}|${parsed.expiry}`);
    }

    for (const key of neededExpiries) {
      const [indexKey, expiry] = key.split('|');
      const instrument = indexKey === 'NF' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
      try {
        await upstoxFetchFullChain(instrument, expiry, indexKey);
      } catch(e) {
        console.warn(`[sync] Chain fetch failed for ${key}:`, e.message);
      }
    }

    // Step 4: Reconstruct positions from trade book if positions API empty
    let positions = window._UPSTOX_POSITIONS || [];
    if (positions.length === 0 && trades.length > 0) {
      console.log('[sync] Positions API empty — reconstructing from trade book');
      positions = reconstructPositionsFromTrades(trades);
      window._UPSTOX_POSITIONS = positions;
    }

    // Step 5: Detect and log new/updated positions
    if (positions.length > 0 && typeof detectAndLogPositions === 'function') {
      await detectAndLogPositions(positions);
    }

    // Step 6: Match trade book exits against open trades
    if (trades.length > 0 && typeof matchTradeBookExits === 'function') {
      await matchTradeBookExits(trades);
    }

    // Step 7: Start auto-fetch for live P&L tracking during market hours
    if (isMarketHours()) startAutoFetch();

    // Step 8: Re-render positions tab
    if (typeof renderPositionsTab === 'function') await renderPositionsTab();

    // Update sync status
    const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (statusEl) {
      statusEl.textContent = isMarketHours()
        ? `🔒 Synced · Auto-tracking (${ts})`
        : `✅ Synced (${ts}) · Market closed`;
    }
    console.log('[sync] Position sync complete');

  } catch(e) {
    console.error('[sync] Error:', e);
    if (statusEl) statusEl.textContent = `❌ Sync failed: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════
// LIGHTWEIGHT AUTO-FETCH — Positions only, no SIGNAL/COMMAND update
// Runs every 5 mins during market hours (9:15-15:30 IST)
// ═══════════════════════════════════════════════════

let _autoFetchInterval = null;

function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.getTime() + (now.getTimezoneOffset() * 60000 + 19800000));
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930; // 9:15 to 15:30
}

async function upstoxLightFetch() {
  const token = upstoxGetToken();
  if (!token || !isMarketHours()) return;

  try {
    // Step 1: Fresh spot prices only
    await upstoxFetchSpots();

    // Step 2: Get open trades from Supabase (already detected from manual fetch)
    if (typeof dbGetOpenTrades !== 'function') return;
    const openTrades = await dbGetOpenTrades();
    if (!openTrades.length) {
      console.log('[upstox] Light fetch: no open trades');
      return;
    }

    // Step 3: Fetch position chains for open trade expiries (strikeLTPs for live P&L)
    const needed = new Set();
    for (const t of openTrades) {
      if (t.index_key && t.expiry) needed.add(`${t.index_key}|${t.expiry}`);
    }

    if (!window._POSITION_CHAINS) window._POSITION_CHAINS = {};

    for (const key of needed) {
      const [indexKey, expiry] = key.split('|');
      const instrument = indexKey === 'NF' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
      try {
        const resp = await fetch(_bust(`${UPSTOX_API}/option/chain?instrument_key=${encodeURIComponent(instrument)}&expiry_date=${expiry}`), { headers: _headers() });
        const data = await resp.json();
        if (data.status === 'success' && Array.isArray(data.data)) {
          const spot = gv(indexKey === 'NF' ? 'nf_price' : 'bn_price') || 0;
          let putOI = 0, callOI = 0;
          const sellStrikeOI = {}, strikeLTPs = {};

          for (const item of data.data) {
            const strike = item.strike_price || item.strikePrice || item.strike;
            if (!strike) continue;
            const callData = item.call_options || item.callOptions || item.CE;
            const putData = item.put_options || item.putOptions || item.PE;
            if (callData) {
              const md = callData.market_data || callData;
              callOI += md.oi || md.open_interest || 0;
              sellStrikeOI[`${strike}_CE`] = md.oi || md.open_interest || 0;
              strikeLTPs[`${strike}_CE`] = md.ltp || md.last_price || 0;
            }
            if (putData) {
              const md = putData.market_data || putData;
              putOI += md.oi || md.open_interest || 0;
              sellStrikeOI[`${strike}_PE`] = md.oi || md.open_interest || 0;
              strikeLTPs[`${strike}_PE`] = md.ltp || md.last_price || 0;
            }
          }

          const pcr = callOI > 0 ? +(putOI / callOI).toFixed(2) : 0;

          // Max Pain
          const allStrikes = [...new Set(data.data.map(d => d.strike_price || d.strikePrice || d.strike))].filter(Boolean).sort((a,b) => a - b);
          let mpStrike = 0, minPain = Infinity;
          const coiMap = {}, poiMap = {};
          for (const item of data.data) {
            const s = item.strike_price || item.strikePrice || item.strike;
            if (!s) continue;
            const cd = item.call_options || item.callOptions || item.CE;
            const pd = item.put_options || item.putOptions || item.PE;
            if (cd) coiMap[s] = (cd.market_data || cd).oi || (cd.market_data || cd).open_interest || 0;
            if (pd) poiMap[s] = (pd.market_data || pd).oi || (pd.market_data || pd).open_interest || 0;
          }
          for (const c of allStrikes) {
            let pain = 0;
            for (const k in coiMap) { if (coiMap[k] > 0 && c > +k) pain += (c - +k) * coiMap[k]; }
            for (const k in poiMap) { if (poiMap[k] > 0 && c < +k) pain += (+k - c) * poiMap[k]; }
            if (pain < minPain) { minPain = pain; mpStrike = c; }
          }

          window._POSITION_CHAINS[key] = { pcr, maxPain: mpStrike, callOI, putOI, sellStrikeOI, strikeLTPs, spot };
          console.log(`[auto] Position chain: ${key} — PCR=${pcr}, LTPs=${Object.keys(strikeLTPs).length}`);
        }
      } catch(e) {
        console.warn(`[auto] Chain fetch failed for ${key}:`, e.message);
      }
    }

    // Step 4: Thesis check + P&L update + Supabase update + notifications
    if (typeof checkThesisAndNotify === 'function') checkThesisAndNotify(openTrades);

    // Step 5: Re-render positions tab (updates card + banner with fresh P&L)
    if (typeof renderPositionsTab === 'function') renderPositionsTab();

    // Step 6: Show auto-fetch timestamp
    const tsEl = document.getElementById('sync-status');
    if (tsEl) {
      const ts = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      tsEl.textContent = `🔒 Auto-tracking · Updated ${ts}`;
    }

    console.log('[auto] Light fetch complete');
  } catch(e) {
    console.warn('[auto] Light fetch error:', e.message);
  }
}

function startAutoFetch() {
  if (_autoFetchInterval) return; // Already running
  _autoFetchInterval = setInterval(() => {
    if (isMarketHours()) {
      upstoxLightFetch();
    } else {
      stopAutoFetch();
    }
  }, 5 * 60 * 1000); // 5 minutes
  console.log('[upstox] Auto-fetch started (5 min interval, market hours only)');
}

function stopAutoFetch() {
  if (_autoFetchInterval) {
    clearInterval(_autoFetchInterval);
    _autoFetchInterval = null;
    console.log('[upstox] Auto-fetch stopped');
  }
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('btn-save-token');
  if (saveBtn) saveBtn.addEventListener('click', upstoxSaveAndFetch);
  const fetchBtn = document.getElementById('btn-fetch-upstox');
  if (fetchBtn) fetchBtn.addEventListener('click', () => upstoxAutoFill());
  const syncBtn = document.getElementById('btn-sync-positions');
  if (syncBtn) syncBtn.addEventListener('click', () => upstoxSyncPositions());
  // Auto-prompt token if expired or missing
  if (upstoxGetToken()) {
    setTimeout(() => upstoxAutoFill(), 500);
  } else {
    setTimeout(upstoxShowTokenModal, 300);
  }
  console.log('[upstox.js] v5.0 — Phase 3.1: SIGNAL/POSITIONS separation');
});
