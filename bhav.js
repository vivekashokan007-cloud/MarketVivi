/* ============================================================
   bhav.js — Bhav Copy Engine for Market Radar v5.0
   GitHub storage of NSE option chain data
   ============================================================ */

const BHAV_SPREAD = 1000; // Only store strikes within ±1000 of spot

// ── GitHub credential management ──
let _ghConfig = null;

async function bhavLoadConfig() {
  // Try localStorage first
  const cached = localStorage.getItem('mr_gh_config');
  if (cached) {
    try { _ghConfig = JSON.parse(cached); return _ghConfig; }
    catch(e) { /* fall through */ }
  }
  // Fetch from login.json
  try {
    const resp = await fetch('https://raw.githubusercontent.com/vivekashokan007-cloud/MarketVivi/main/login.json');
    if (!resp.ok) throw new Error('login.json fetch failed');
    _ghConfig = await resp.json();
    localStorage.setItem('mr_gh_config', JSON.stringify(_ghConfig));
    return _ghConfig;
  } catch(e) {
    console.error('[bhav] Config load failed:', e);
    return null;
  }
}

function bhavGetConfig() { return _ghConfig; }

// ── GitHub API helpers ──
const BHAV_REPO = 'vivekashokan007-cloud/Market-Radar';
const DATA_DIR = 'data';

async function _ghGet(path) {
  if (!_ghConfig) return null;
  const url = `https://api.github.com/repos/${BHAV_REPO}/contents/${path}`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `token ${_ghConfig.token}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function _ghPut(path, content, message, sha) {
  if (!_ghConfig) return null;
  const url = `https://api.github.com/repos/${BHAV_REPO}/contents/${path}`;
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
  };
  if (sha) body.sha = sha;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${_ghConfig.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return resp.json();
}

// ── Date index management ──
function bhavGetDates() {
  try { return JSON.parse(localStorage.getItem('mr_bhav_dates') || '[]'); }
  catch(e) { return []; }
}

function bhavSaveDates(dates) {
  localStorage.setItem('mr_bhav_dates', JSON.stringify(dates));
}

// ── Local storage for bhav data ──
function bhavGetDay(dateStr) {
  // dateStr format: YYYYMMDD
  try { return JSON.parse(localStorage.getItem(`mr_bhav_${dateStr}`)); }
  catch(e) { return null; }
}

function bhavSaveDay(dateStr, data) {
  localStorage.setItem(`mr_bhav_${dateStr}`, JSON.stringify(data));
  const dates = bhavGetDates();
  if (!dates.includes(dateStr)) {
    dates.push(dateStr);
    dates.sort();
    bhavSaveDates(dates);
  }
}

function bhavGetLatest() {
  const dates = bhavGetDates();
  if (!dates.length) return null;
  return bhavGetDay(dates[dates.length - 1]);
}

// ── Upload to GitHub ──
async function bhavUploadToGitHub(dateStr, data) {
  if (!_ghConfig) {
    await bhavLoadConfig();
    if (!_ghConfig) return { ok: false, error: 'No GitHub config' };
  }
  const path = `${DATA_DIR}/bhav_${dateStr}.json`;
  try {
    // Check if file exists (get sha for update)
    const existing = await _ghGet(path);
    const sha = existing ? existing.sha : undefined;
    const result = await _ghPut(path, data, `Bhav data ${dateStr}`, sha);
    if (result.content) return { ok: true, sha: result.content.sha };
    return { ok: false, error: result.message || 'Upload failed' };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── CSV Parsing ──
function bhavParseCSV(csvText, spot, symbol = 'NIFTY') {
  const lines = csvText.split('\n');
  if (lines.length < 2) return null;

  const header = lines[0].split(',').map(h => h.trim().toUpperCase());
  const result = { spot, opts: {}, pcr: {} };

  // Detect format
  const isUDiFF = header.includes('TckrSymb') || header.includes('TCKRSYMB');

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(c => c.trim());
    if (row.length < 5) continue;

    let sym, type, strike, expiry, close, oi;

    if (isUDiFF) {
      // New UDiFF format
      const idx = {};
      header.forEach((h, j) => idx[h] = j);
      sym    = row[idx['TCKRSYMB'] || idx['TckrSymb']] || '';
      type   = row[idx['OPTNTP']] || '';
      strike = parseFloat(row[idx['STRKPRIC'] || idx['StrkPric']] || '0');
      expiry = row[idx['XPRYDT'] || idx['XpryDt']] || '';
      close  = parseFloat(row[idx['CLSPRIC'] || idx['ClsPric']] || '0');
      oi     = parseFloat(row[idx['OPNINT'] || idx['OpnInt']] || '0');
    } else {
      // Old per-symbol format: assume standard order
      sym    = row[0] || '';
      type   = row[1] || '';
      strike = parseFloat(row[2] || '0');
      expiry = row[3] || '';
      close  = parseFloat(row[4] || '0');
      oi     = parseFloat(row[5] || '0');
    }

    // Filter to target symbol
    if (!sym.includes(symbol)) continue;
    if (type !== 'CE' && type !== 'PE') continue;
    if (!strike || !close) continue;

    // Only store strikes within BHAV_SPREAD of spot
    if (Math.abs(strike - spot) > BHAV_SPREAD) continue;

    // Normalise expiry to YYYY-MM-DD
    const expNorm = _normaliseExpiry(expiry);
    if (!expNorm) continue;

    // Store option price
    const key = `${type}_${strike}_${expNorm}`;
    result.opts[key] = close;

    // Accumulate OI for PCR
    if (!result.pcr[expNorm]) result.pcr[expNorm] = { putOI: 0, callOI: 0 };
    if (type === 'PE') result.pcr[expNorm].putOI += oi;
    else result.pcr[expNorm].callOI += oi;
  }

  // Compute PCR ratios
  for (const exp in result.pcr) {
    const { putOI, callOI } = result.pcr[exp];
    result.pcr[exp] = callOI > 0 ? +(putOI / callOI).toFixed(2) : 0;
  }

  result.uploaded_at = new Date().toISOString();
  return result;
}

function _normaliseExpiry(raw) {
  if (!raw) return null;
  // Try YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Try DD-MMM-YYYY (e.g., 14-Mar-2026)
  const m = raw.match(/^(\d{1,2})-(\w{3})-(\d{4})$/);
  if (m) {
    const months = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                     JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
    const mon = months[m[2].toUpperCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }
  // Try YYYYMMDD
  const m2 = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

// ── Bhav data accessors (used by app.js) ──

function bhavAutoFill() {
  const data = bhavGetLatest();
  if (!data) return;
  // Auto-fill is handled by the engine — data is accessed via bhavPrice, bhavPCR, etc.
  console.log('[bhav] Latest data available, spot:', data.spot);
}

function bhavATR() {
  // Vol proxy: stddev × 1.5 from stored daily closes
  // Note: This is NOT true ATR (no H/L in bhav data). True ATR comes from Upstox OHLC.
  const dates = bhavGetDates();
  if (dates.length < 5) return null;
  const closes = [];
  for (let i = Math.max(0, dates.length - 14); i < dates.length; i++) {
    const day = bhavGetDay(dates[i]);
    if (day && day.spot) closes.push(day.spot);
  }
  if (closes.length < 3) return null;
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length;
  return Math.sqrt(variance) * 1.5;
}

function bhavPCR(expiryDate) {
  const data = bhavGetLatest();
  if (!data || !data.pcr) return null;
  return data.pcr[expiryDate] || null;
}

function bhavOIWalls(expiryDate) {
  const data = bhavGetLatest();
  if (!data || !data.opts) return { callWall: null, putWall: null };

  const callOI = {}, putOI = {};
  for (const key in data.opts) {
    const parts = key.split('_');
    if (parts.length < 3) continue;
    const [type, strikeStr, exp] = parts;
    if (exp !== expiryDate) continue;
    const strike = parseFloat(strikeStr);
    // We need OI data, not just prices — this uses stored OI if available
    // For now, proxy: higher price = more interest
    if (type === 'CE') callOI[strike] = (callOI[strike] || 0) + data.opts[key];
    if (type === 'PE') putOI[strike]  = (putOI[strike] || 0) + data.opts[key];
  }

  let maxCallStrike = null, maxCallVal = 0;
  let maxPutStrike = null, maxPutVal = 0;
  for (const s in callOI) { if (callOI[s] > maxCallVal) { maxCallVal = callOI[s]; maxCallStrike = +s; } }
  for (const s in putOI) { if (putOI[s] > maxPutVal) { maxPutVal = putOI[s]; maxPutStrike = +s; } }

  return { callWall: maxCallStrike, putWall: maxPutStrike };
}

function bhavPrice(type, strike, expiryDate) {
  const data = bhavGetLatest();
  if (!data || !data.opts) return null;
  return data.opts[`${type}_${strike}_${expiryDate}`] || null;
}

function bhavDriftScore(liveSpot, liveCallWall, livePutWall) {
  const data = bhavGetLatest();
  if (!data || !data.spot) return null;
  const prevSpot = data.spot;
  const drift = liveSpot - prevSpot;
  const range = (liveCallWall && livePutWall) ? liveCallWall - livePutWall : 1;
  if (range === 0) return 0;
  return +(drift / range).toFixed(3);
}

// ── Bhav file upload handler (for CLOSE tab UI) ──
async function bhavHandleUpload(files, spotInput) {
  const spot = parseFloat(spotInput);
  if (!spot || isNaN(spot)) return { ok: false, error: 'Enter spot price first' };

  let csvText = '';
  for (const file of files) {
    const text = await file.text();
    csvText += text + '\n';
  }

  const data = bhavParseCSV(csvText, spot);
  if (!data || Object.keys(data.opts).length === 0) {
    return { ok: false, error: 'No NIFTY options found in CSV' };
  }

  // Date from filename or today
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Save locally
  bhavSaveDay(dateStr, data);

  // Upload to GitHub
  const ghResult = await bhavUploadToGitHub(dateStr, data);

  return {
    ok: true,
    local: true,
    github: ghResult.ok,
    contracts: Object.keys(data.opts).length,
    expiries: Object.keys(data.pcr),
    error: ghResult.ok ? null : ghResult.error
  };
}

// ── Initialize ──
bhavLoadConfig().then(() => {
  console.log('[bhav.js] Bhav engine loaded — v5.0, config:', _ghConfig ? 'OK' : 'missing');
});
