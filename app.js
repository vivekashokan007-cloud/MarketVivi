/* ============================================================
   app.js — Market Radar v5.0 — Main Engine
   Real-data strategy engine using live chain LTPs + greeks
   Evaluates all 7 strategies × all expiries × both indices
   ============================================================ */

// ── Constants ──
const CAPITAL           = 110000;
const NF_LOT_SIZE       = 65;
const BNF_LOT           = 30;
const NF_MARGIN_PER_LOT = 97000;
const BNF_MARGIN_PER_LOT= 28000;
const MAX_RISK_PCT      = 0.05;
const NF_IC_WIDTH       = 200;
const BNF_IC_WIDTH      = 500;

const r50  = x => Math.round(x / 50) * 50;
const r100 = x => Math.round(x / 100) * 100;
const r5   = x => Math.round(x / 5) * 5;

// NSE Holidays 2026 — Source: NSE/CMTR/71775
const NSE_HOLIDAYS_2026 = [
  '2026-01-26','2026-03-03','2026-03-26','2026-03-31',
  '2026-04-03','2026-04-14','2026-05-01','2026-05-28',
  '2026-06-26','2026-09-14','2026-10-02','2026-10-20',
  '2026-11-10','2026-11-24','2026-12-25'
];

// ── State ──
let SCORE = null, DIRECTION = '', STRAT_AUTO = '';
let RECOMMENDED_INDEX = 'NF';
let RADAR_LOCKED = false, BREADTH_LOCKED = false, EVENING_LOCKED = false;
let ANALYSIS_VIX = null;
let SELECTED_INDEX = 'NF';

// All evaluated setups, sorted by score
let _RANKED_SETUPS = [];

// ── Score Weights — 10 live signals, sum = 1.00 ──
const W = {
  india_vix: 0.22, pcr_nf: 0.16, fii: 0.15, gift_gap: 0.15,
  close_char: 0.10, max_pain: 0.08, gift_trend: 0.05,
  n50adv: 0.04, bnfadv: 0.03, n50dma: 0.02
};

// ── Helpers ──
function gv(id)   { const el = document.getElementById(id); if (!el) return null; const v = parseFloat(el.value); return isNaN(v) ? null : v; }
function gvi(id)  { const el = document.getElementById(id); if (!el) return null; const v = parseInt(el.value); return isNaN(v) ? null : v; }
function gs(id)   { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function valid(v) { return v !== null && v !== undefined && !isNaN(v) && v !== 0; }

function isTradingDay(d) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !NSE_HOLIDAYS_2026.includes(d.toISOString().slice(0, 10));
}
function prevTradingDay(d) {
  const p = new Date(d);
  do { p.setDate(p.getDate() - 1); } while (!isTradingDay(p));
  return p;
}
function actualExpiry(raw) {
  const d = new Date(raw);
  while (!isTradingDay(d)) d.setDate(d.getDate() - 1);
  return d;
}
function dateFmt(d) { return d.toISOString().slice(0, 10); }
function daysTo(target) {
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(target); t.setHours(0,0,0,0);
  return Math.max(1, Math.round((t - now) / 86400000));
}

// Count actual trading days between now and target (excludes weekends + NSE holidays)
function tradingDaysTo(target) {
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(target); t.setHours(0,0,0,0);
  let count = 0;
  const d = new Date(now);
  d.setDate(d.getDate() + 1); // start from tomorrow
  while (d <= t) {
    if (isTradingDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

function directionCategory(score) {
  if (score >= 1.2) return 'STRONG_BULL';
  if (score >= 0.4) return 'MILD_BULL';
  if (score > -0.4) return 'NEUTRAL';
  if (score > -1.2) return 'MILD_BEAR';
  return 'STRONG_BEAR';
}
function directionLabel(score) {
  return { STRONG_BULL:'STRONGLY BULLISH', MILD_BULL:'MILDLY BULLISH', NEUTRAL:'NEUTRAL', MILD_BEAR:'MILDLY BEARISH', STRONG_BEAR:'STRONGLY BEARISH' }[directionCategory(score)];
}

function dteConviction(dte) {
  if (dte >= 11 && dte <= 21) return 'SWEET SPOT';
  if (dte >= 6 && dte <= 35)  return 'ACCEPTABLE';
  if (dte < 6) return 'SHORT';
  return 'LONG';
}

// ── Timestamp / Freshness ──
function getTS() { try { return JSON.parse(localStorage.getItem('mr140-ts') || '{}'); } catch(e) { return {}; } }
function stampField(id) {
  const ts = getTS(); ts[id] = Date.now();
  localStorage.setItem('mr140-ts', JSON.stringify(ts));
  renderTS(id, ts[id]);
}
function renderTS(id, timestamp) {
  const el = document.getElementById(`ts-${id}`);
  if (!el) return;
  const age = (Date.now() - timestamp) / 60000;
  const label = age < 15 ? 'fresh' : age < 60 ? 'stale' : 'old';
  el.textContent = label;
  el.className = `ts-badge ts-${label}`;
}
function restoreAllTS() { const ts = getTS(); for (const id in ts) renderTS(id, ts[id]); }

// ═══════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════

function calcScore() {
  const signals = {};

  const gift_gap = gv('gift_gap'), gift_trend = gv('gift_trend');
  const india_vix = gv('india_vix'), fii = gv('fii'), pcr_nf = gv('pcr_nf');
  const close_char = gv('close_char'), max_pain = gv('max_pain_nf'), nf_spot = gv('nf_price');
  const n50adv = gv('n50adv'), n50dma = gv('n50dma'), bnfadv = gv('bnfadv');

  if (valid(gift_gap))   signals.gift_gap   = Math.max(-1, Math.min(1, gift_gap / 1.5));
  if (valid(gift_trend)) signals.gift_trend = Math.max(-1, Math.min(1, gift_trend / 0.5));
  if (valid(india_vix))  { signals.india_vix = Math.max(-1, Math.min(1, -(india_vix - 14) / 6)); ANALYSIS_VIX = india_vix; }
  if (valid(fii))        signals.fii        = Math.max(-1, Math.min(1, fii / 2000));
  if (valid(pcr_nf))     signals.pcr_nf     = Math.max(-1, Math.min(1, (pcr_nf - 1.0) / 0.5));
  if (valid(close_char)) signals.close_char = Math.max(-1, Math.min(1, close_char / 2));
  if (valid(max_pain) && valid(nf_spot) && nf_spot > 0) {
    signals.max_pain = Math.max(-1, Math.min(1, (max_pain - nf_spot) / nf_spot * 100));
  }
  if (valid(n50adv)) signals.n50adv = Math.max(-1, Math.min(1, (n50adv - 25) / 15));
  if (valid(n50dma)) signals.n50dma = Math.max(-1, Math.min(1, n50dma / 5));
  if (valid(bnfadv)) signals.bnfadv = Math.max(-1, Math.min(1, (bnfadv - 6) / 4));

  let wSum = 0, wTotal = 0;
  for (const key in W) { if (signals[key] !== undefined) { wSum += signals[key] * W[key]; wTotal += W[key]; } }

  if (wTotal === 0) { SCORE = null; DIRECTION = ''; STRAT_AUTO = ''; renderVerdict(); return; }

  SCORE = +(wSum / wTotal).toFixed(4);
  DIRECTION = directionLabel(SCORE);
  renderVerdict();
  buildCommand();
}

function renderVerdict() {
  const el = document.getElementById('verdict');
  if (!el) return;
  if (SCORE === null) { el.innerHTML = '<div class="verdict-box neutral">Enter signals to see direction</div>'; return; }
  const cat = directionCategory(SCORE);
  const cls = { STRONG_BULL:'bull', MILD_BULL:'bull-mild', NEUTRAL:'neutral', MILD_BEAR:'bear-mild', STRONG_BEAR:'bear' }[cat];
  el.innerHTML = `<div class="verdict-box ${cls}">
    <div class="verdict-direction">${DIRECTION}</div>
    <div class="verdict-score">Score: ${SCORE.toFixed(2)}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// EXPIRY CALENDAR
// ═══════════════════════════════════════════════════

function getExpiries(index) {
  const results = [];
  const today = new Date(); today.setHours(0,0,0,0);

  if (index === 'NF') {
    let d = new Date(today);
    while (results.length < 3) {
      const dow = d.getDay();
      const skip = (4 - dow + 7) % 7 || 7;
      if (dow !== 4 || d <= today) d.setDate(d.getDate() + (dow === 4 && d >= today ? 0 : skip));
      if (d.getDay() === 4 && d.getTime() === today.getTime() && new Date().getHours() < 16) {
        // Today is Thursday before market close — include it
      }
      const exp = actualExpiry(new Date(d));
      const s = dateFmt(exp);
      if (!results.includes(s) && exp >= today) results.push(s);
      d.setDate(d.getDate() + 1);
    }
  } else {
    // BNF: Monthly only — last Thursday of each month
    let d = new Date(today);
    while (results.length < 3) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const lt = new Date(lastDay);
      while (lt.getDay() !== 4) lt.setDate(lt.getDate() - 1);
      const exp = actualExpiry(new Date(lt));
      const s = dateFmt(exp);
      if (exp >= today && !results.includes(s)) results.push(s);
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════
// Q1: DIRECTIONAL BIAS (6 independent signals)
// ═══════════════════════════════════════════════════

function computeDirectionalBias() {
  let bullCount = 0, bearCount = 0;
  const signals = [];

  const fii = gv('fii');
  if (valid(fii)) {
    if (fii > 500)       { bullCount++; signals.push({ name:'FII Cash', vote:'BULL', val:`₹${fii} Cr` }); }
    else if (fii < -500) { bearCount++; signals.push({ name:'FII Cash', vote:'BEAR', val:`₹${fii} Cr` }); }
    else signals.push({ name:'FII Cash', vote:'NEUTRAL', val:`₹${fii} Cr` });
  }

  const fiiFut = gv('fii_fut'), fiiOpt = gv('fii_opt');
  if (valid(fiiFut) || valid(fiiOpt)) {
    const net = (fiiFut||0) + (fiiOpt||0);
    if (net > 0)      { bullCount++; signals.push({ name:'FII Deriv', vote:'BULL', val:`₹${net.toFixed(0)} Cr` }); }
    else if (net < 0) { bearCount++; signals.push({ name:'FII Deriv', vote:'BEAR', val:`₹${net.toFixed(0)} Cr` }); }
    else signals.push({ name:'FII Deriv', vote:'NEUTRAL', val:`₹${net.toFixed(0)} Cr` });
  }

  const pcr = gv('pcr_nf');
  if (valid(pcr)) {
    if (pcr > 1.2)      { bullCount++; signals.push({ name:'PCR', vote:'BULL', val:pcr.toFixed(2) }); }
    else if (pcr < 0.9) { bearCount++; signals.push({ name:'PCR', vote:'BEAR', val:pcr.toFixed(2) }); }
    else signals.push({ name:'PCR', vote:'NEUTRAL', val:pcr.toFixed(2) });
  }

  const spot = gv('nf_price'), mp = gv('max_pain_nf');
  if (valid(spot) && valid(mp)) {
    const diff = spot - mp;
    if (diff < -100)     { bullCount++; signals.push({ name:'Max Pain', vote:'BULL', val:`${diff.toFixed(0)}` }); }
    else if (diff > 100) { bearCount++; signals.push({ name:'Max Pain', vote:'BEAR', val:`+${diff.toFixed(0)}` }); }
    else signals.push({ name:'Max Pain', vote:'NEUTRAL', val:`${diff > 0 ? '+' : ''}${diff.toFixed(0)}` });
  }

  const cc = gv('close_char');
  if (valid(cc)) {
    if (cc >= 1)       { bullCount++; signals.push({ name:'Close Char', vote:'BULL', val:`+${cc}` }); }
    else if (cc <= -1) { bearCount++; signals.push({ name:'Close Char', vote:'BEAR', val:`${cc}` }); }
    else signals.push({ name:'Close Char', vote:'NEUTRAL', val:`${cc}` });
  }

  const vix = gv('india_vix');
  const yVix = parseFloat(localStorage.getItem('mr_ev_indiavix') || '0');
  if (valid(vix) && yVix > 0) {
    const vc = vix - yVix;
    if (vc < -0.3)     { bullCount++; signals.push({ name:'VIX Dir', vote:'BULL', val:`${vc.toFixed(2)}` }); }
    else if (vc > 0.3) { bearCount++; signals.push({ name:'VIX Dir', vote:'BEAR', val:`+${vc.toFixed(2)}` }); }
    else signals.push({ name:'VIX Dir', vote:'NEUTRAL', val:`${vc > 0 ? '+' : ''}${vc.toFixed(2)}` });
  }

  const net = bullCount - bearCount;
  let bias, biasConf;
  if (net >= 3)      { bias = 'BULL'; biasConf = 'Strong'; }
  else if (net >= 1) { bias = 'BULL'; biasConf = 'Mild'; }
  else if (net <= -3){ bias = 'BEAR'; biasConf = 'Strong'; }
  else if (net <= -1){ bias = 'BEAR'; biasConf = 'Mild'; }
  else               { bias = 'NEUTRAL'; biasConf = 'Neutral'; }

  return { bias, biasConf, bullCount, bearCount, net, signals };
}

// ═══════════════════════════════════════════════════
// STRATEGY EVALUATOR — REAL DATA ENGINE
// Uses live LTPs + greeks from window._CHAINS
// ═══════════════════════════════════════════════════

const STRATEGY_TYPES = [
  'BULL_PUT', 'BEAR_CALL', 'IRON_CONDOR',
  'BULL_CALL', 'BEAR_PUT',
  'LONG_STRADDLE', 'LONG_STRANGLE'
];

const STRAT_LABELS = {
  BULL_PUT: 'Bull Put Spread', BEAR_CALL: 'Bear Call Spread', IRON_CONDOR: 'Iron Condor',
  BULL_CALL: 'Bull Call Spread', BEAR_PUT: 'Bear Put Spread',
  LONG_STRADDLE: 'Long Straddle', LONG_STRANGLE: 'Long Strangle'
};

function evaluateAllStrategies(bias, vix) {
  const setups = [];

  for (const indexKey of ['NF', 'BNF']) {
    const chains = window._CHAINS[indexKey];
    if (!chains || !Object.keys(chains).length) continue;

    const isNF = indexKey === 'NF';
    const lotSize = isNF ? NF_LOT_SIZE : BNF_LOT;
    const width = isNF ? NF_IC_WIDTH : BNF_IC_WIDTH;
    const marginPerLot = isNF ? NF_MARGIN_PER_LOT : BNF_MARGIN_PER_LOT;
    const step = isNF ? 50 : 100;

    for (const expiry in chains) {
      const chain = chains[expiry];
      if (!chain.strikes || !chain.spot) continue;

      const spot = chain.spot;
      const dte = chain.dte;
      const tradingDte = chain.tradingDte || dte;
      const strikeKeys = Object.keys(chain.strikes).map(Number).sort((a,b) => a - b);
      if (strikeKeys.length < 4) continue;

      // Find ATM strike
      const atm = strikeKeys.reduce((best, s) => Math.abs(s - spot) < Math.abs(best - spot) ? s : best, strikeKeys[0]);

      for (const stratType of STRATEGY_TYPES) {
        // Filter by bias
        if (!isStrategyAllowed(stratType, bias, vix)) continue;

        const candidates = buildCandidates(stratType, chain, atm, spot, width, step, strikeKeys, isNF);

        for (const cand of candidates) {
          const setup = evaluateSetup(cand, stratType, indexKey, expiry, spot, dte, tradingDte, lotSize, marginPerLot, width, chain, vix);
          if (setup && setup.viable) {
            setup.compositeScore = scoreSetup(setup, bias, vix);
            setups.push(setup);
          }
        }
      }
    }
  }

  // Sort by composite score descending
  setups.sort((a, b) => b.compositeScore - a.compositeScore);
  return setups;
}

function isStrategyAllowed(stratType, bias, vix) {
  if (valid(vix) && vix >= 28) return false; // AVOID ALL

  // High VIX favors credit strategies
  const isCreditStrat = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(stratType);
  const isDebitStrat  = ['BULL_CALL','BEAR_PUT'].includes(stratType);
  const isVolStrat    = ['LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);

  if (bias === 'BULL') {
    return ['BULL_PUT','BULL_CALL','IRON_CONDOR','LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);
  }
  if (bias === 'BEAR') {
    return ['BEAR_CALL','BEAR_PUT','IRON_CONDOR','LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);
  }
  // NEUTRAL — allow all
  return true;
}

function buildCandidates(stratType, chain, atm, spot, width, step, strikeKeys, isNF) {
  const s = chain.strikes;
  const candidates = [];

  switch(stratType) {
    case 'BULL_PUT': {
      // Sell OTM put, buy further OTM put
      const otmPuts = strikeKeys.filter(k => k < spot && k >= spot - (isNF ? 1000 : 3000) && s[k] && s[k].PE && s[k].PE.ltp > 0);
      for (const sellK of otmPuts) {
        const buyK = sellK - width;
        if (s[buyK] && s[buyK].PE && s[buyK].PE.ltp >= 0) {
          candidates.push({ legs: [
            { type:'PE', strike: sellK, action:'SELL', data: s[sellK].PE },
            { type:'PE', strike: buyK,  action:'BUY',  data: s[buyK].PE }
          ]});
        }
      }
      break;
    }
    case 'BEAR_CALL': {
      const otmCalls = strikeKeys.filter(k => k > spot && k <= spot + (isNF ? 1000 : 3000) && s[k] && s[k].CE && s[k].CE.ltp > 0);
      for (const sellK of otmCalls) {
        const buyK = sellK + width;
        if (s[buyK] && s[buyK].CE && s[buyK].CE.ltp >= 0) {
          candidates.push({ legs: [
            { type:'CE', strike: sellK, action:'SELL', data: s[sellK].CE },
            { type:'CE', strike: buyK,  action:'BUY',  data: s[buyK].CE }
          ]});
        }
      }
      break;
    }
    case 'IRON_CONDOR': {
      // Combine best bull put + best bear call
      const putSells = strikeKeys.filter(k => k < spot - (isNF ? 100 : 300) && k >= spot - (isNF ? 800 : 2500) && s[k] && s[k].PE && s[k].PE.ltp > 0);
      const callSells = strikeKeys.filter(k => k > spot + (isNF ? 100 : 300) && k <= spot + (isNF ? 800 : 2500) && s[k] && s[k].CE && s[k].CE.ltp > 0);
      for (const pk of putSells.slice(-3)) { // closest 3 OTM puts
        for (const ck of callSells.slice(0, 3)) { // closest 3 OTM calls
          const putBuy = pk - width, callBuy = ck + width;
          if (s[putBuy] && s[putBuy].PE && s[callBuy] && s[callBuy].CE) {
            candidates.push({ legs: [
              { type:'CE', strike: ck,      action:'SELL', data: s[ck].CE },
              { type:'CE', strike: callBuy, action:'BUY',  data: s[callBuy].CE },
              { type:'PE', strike: pk,      action:'SELL', data: s[pk].PE },
              { type:'PE', strike: putBuy,  action:'BUY',  data: s[putBuy].PE }
            ]});
          }
        }
      }
      break;
    }
    case 'BULL_CALL': {
      // Buy near-ATM call, sell further OTM call
      const buyCalls = strikeKeys.filter(k => Math.abs(k - spot) <= (isNF ? 200 : 600) && s[k] && s[k].CE && s[k].CE.ltp > 0);
      for (const buyK of buyCalls) {
        const sellK = buyK + width;
        if (s[sellK] && s[sellK].CE && s[sellK].CE.ltp >= 0) {
          candidates.push({ legs: [
            { type:'CE', strike: buyK,  action:'BUY',  data: s[buyK].CE },
            { type:'CE', strike: sellK, action:'SELL', data: s[sellK].CE }
          ]});
        }
      }
      break;
    }
    case 'BEAR_PUT': {
      const buyPuts = strikeKeys.filter(k => Math.abs(k - spot) <= (isNF ? 200 : 600) && s[k] && s[k].PE && s[k].PE.ltp > 0);
      for (const buyK of buyPuts) {
        const sellK = buyK - width;
        if (s[sellK] && s[sellK].PE && s[sellK].PE.ltp >= 0) {
          candidates.push({ legs: [
            { type:'PE', strike: buyK,  action:'BUY',  data: s[buyK].PE },
            { type:'PE', strike: sellK, action:'SELL', data: s[sellK].PE }
          ]});
        }
      }
      break;
    }
    case 'LONG_STRADDLE': {
      if (s[atm] && s[atm].CE && s[atm].PE && s[atm].CE.ltp > 0 && s[atm].PE.ltp > 0) {
        candidates.push({ legs: [
          { type:'CE', strike: atm, action:'BUY', data: s[atm].CE },
          { type:'PE', strike: atm, action:'BUY', data: s[atm].PE }
        ]});
      }
      // Also try 1 strike above/below ATM
      const atmUp = atm + step, atmDn = atm - step;
      if (s[atmUp] && s[atmUp].CE && s[atm] && s[atm].PE) {
        candidates.push({ legs: [
          { type:'CE', strike: atmUp, action:'BUY', data: s[atmUp].CE },
          { type:'PE', strike: atm,   action:'BUY', data: s[atm].PE }
        ]});
      }
      break;
    }
    case 'LONG_STRANGLE': {
      const otmCallK = strikeKeys.filter(k => k > spot + (isNF ? 100 : 300) && k <= spot + (isNF ? 500 : 1500) && s[k] && s[k].CE && s[k].CE.ltp > 0);
      const otmPutK  = strikeKeys.filter(k => k < spot - (isNF ? 100 : 300) && k >= spot - (isNF ? 500 : 1500) && s[k] && s[k].PE && s[k].PE.ltp > 0);
      for (const ck of otmCallK.slice(0, 2)) {
        for (const pk of otmPutK.slice(-2)) {
          candidates.push({ legs: [
            { type:'CE', strike: ck, action:'BUY', data: s[ck].CE },
            { type:'PE', strike: pk, action:'BUY', data: s[pk].PE }
          ]});
        }
      }
      break;
    }
  }
  return candidates.slice(0, 5); // Cap at 5 candidates per strategy type
}

function evaluateSetup(cand, stratType, indexKey, expiry, spot, dte, tradingDte, lotSize, marginPerLot, width, chain, vix) {
  const legs = cand.legs;
  const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(stratType);
  const isNF = indexKey === 'NF';

  // Calculate net credit/debit from real LTPs
  let netPremium = 0; // positive = credit received
  let netDelta = 0, netTheta = 0, netGamma = 0, netVega = 0;

  for (const leg of legs) {
    const mult = leg.action === 'SELL' ? 1 : -1;
    netPremium += mult * leg.data.ltp;
    if (leg.data.delta != null) netDelta += mult * leg.data.delta;
    if (leg.data.theta != null) netTheta += mult * leg.data.theta;
    if (leg.data.gamma != null) netGamma += mult * leg.data.gamma;
    if (leg.data.vega  != null) netVega  += mult * leg.data.vega;
  }

  // Viability checks
  if (isCredit && netPremium <= 0) return null; // No credit
  if (!isCredit && netPremium >= 0) return null; // Should be debit

  const absPremium = Math.abs(netPremium);
  let maxProfit, maxLoss, breakevens = [];
  const safeLots = Math.max(1, Math.floor(CAPITAL / marginPerLot));

  if (stratType === 'BULL_PUT') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    breakevens = [legs[0].strike - netPremium];
  }
  else if (stratType === 'BEAR_CALL') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    breakevens = [legs[0].strike + netPremium];
  }
  else if (stratType === 'IRON_CONDOR') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    const callSell = legs.find(l => l.type === 'CE' && l.action === 'SELL');
    const putSell = legs.find(l => l.type === 'PE' && l.action === 'SELL');
    breakevens = [putSell.strike - netPremium, callSell.strike + netPremium];
  }
  else if (stratType === 'BULL_CALL') {
    const debit = absPremium;
    maxProfit = (width - debit) * lotSize * safeLots;
    maxLoss = debit * lotSize * safeLots;
    breakevens = [legs[0].strike + debit];
  }
  else if (stratType === 'BEAR_PUT') {
    const debit = absPremium;
    maxProfit = (width - debit) * lotSize * safeLots;
    maxLoss = debit * lotSize * safeLots;
    breakevens = [legs[0].strike - debit];
  }
  else if (stratType === 'LONG_STRADDLE' || stratType === 'LONG_STRANGLE') {
    const cost = absPremium;
    maxLoss = cost * lotSize * safeLots;
    maxProfit = Infinity; // Unlimited
    if (stratType === 'LONG_STRADDLE') {
      breakevens = [legs[0].strike - cost, legs[0].strike + cost];
    } else {
      const putK = legs.find(l => l.type === 'PE').strike;
      const callK = legs.find(l => l.type === 'CE').strike;
      breakevens = [putK - cost, callK + cost];
    }
  }

  // R:R ratio
  const rr = maxProfit === Infinity ? 999 : maxProfit / Math.max(maxLoss, 1);

  // Probability of profit (from delta of sold strike for credit, simplified for debit)
  let probProfit = 0.50;
  if (isCredit) {
    const soldLeg = legs.find(l => l.action === 'SELL');
    if (soldLeg && soldLeg.data.delta != null) {
      probProfit = 1 - Math.abs(soldLeg.data.delta); // delta ≈ prob of ITM
    }
  } else if (stratType === 'LONG_STRADDLE' || stratType === 'LONG_STRANGLE') {
    // Need big move — lower base probability
    const em = bsExpectedMove(spot, vix || 14, tradingDte);
    const beDist = Math.abs(breakevens[1] - spot);
    probProfit = beDist < em.one_sigma ? 0.40 : 0.25;
  } else {
    // Debit spread
    const buyLeg = legs.find(l => l.action === 'BUY');
    if (buyLeg && buyLeg.data.delta != null) {
      probProfit = Math.abs(buyLeg.data.delta);
    }
  }

  // Liquidity check: average bid-ask spread
  let totalSpread = 0, spreadLegs = 0;
  for (const leg of legs) {
    if (leg.data.bid && leg.data.ask && leg.data.ask > 0) {
      totalSpread += (leg.data.ask - leg.data.bid) / leg.data.ask;
      spreadLegs++;
    }
  }
  const avgSpreadPct = spreadLegs > 0 ? totalSpread / spreadLegs : 0.05;

  // Credit/width ratio for credit strategies
  const creditRatio = isCredit ? netPremium / width : null;

  // Minimum viability
  if (isCredit && creditRatio < 0.05) return null; // < 5% of width
  if (!isCredit && stratType !== 'LONG_STRADDLE' && stratType !== 'LONG_STRANGLE' && absPremium > width * 0.85) return null;

  return {
    stratType,
    stratLabel: STRAT_LABELS[stratType],
    indexKey,
    isNF,
    expiry,
    dte,
    tradingDte,
    spot,
    legs,
    netPremium: +netPremium.toFixed(2),
    isCredit,
    maxProfit: maxProfit === Infinity ? Infinity : +maxProfit.toFixed(0),
    maxLoss: +maxLoss.toFixed(0),
    rr: rr === 999 ? '∞' : +rr.toFixed(2),
    probProfit: +(probProfit * 100).toFixed(1),
    breakevens: breakevens.map(b => +b.toFixed(0)),
    netDelta: +netDelta.toFixed(4),
    netTheta: +netTheta.toFixed(2),
    netGamma: +netGamma.toFixed(4),
    netVega: +netVega.toFixed(2),
    lots: safeLots,
    lotSize,
    width,
    creditRatio,
    avgSpreadPct: +(avgSpreadPct * 100).toFixed(1),
    viable: true
  };
}

// ═══════════════════════════════════════════════════
// COMPOSITE SCORING — ranks setups
// ═══════════════════════════════════════════════════

function scoreSetup(setup, bias, vix) {
  let score = 0;

  // 1. R:R ratio (0-25 pts) — higher is better
  const rrNum = setup.rr === '∞' ? 5 : Math.min(setup.rr, 5);
  score += (rrNum / 5) * 25;

  // 2. Probability of profit (0-25 pts)
  score += (setup.probProfit / 100) * 25;

  // 3. Bias alignment (0-20 pts)
  const biasScore = getBiasAlignment(setup.stratType, bias);
  score += biasScore * 20;

  // 4. Theta advantage (0-15 pts) — positive theta is good for credit
  if (setup.isCredit) {
    score += Math.min(setup.netTheta, 15);
  } else {
    // Debit strategies — less negative theta is better
    score += Math.max(0, 15 + setup.netTheta);
  }

  // 5. Vega risk (0-10 pts) — lower vega exposure is safer
  const vegaRisk = Math.abs(setup.netVega);
  score += Math.max(0, 10 - vegaRisk * 2);

  // 6. Liquidity (0-5 pts) — tighter spread is better
  score += Math.max(0, 5 - setup.avgSpreadPct);

  // 7. DTE bonus — sweet spot gets extra points
  const dteLabel = dteConviction(setup.dte);
  if (dteLabel === 'SWEET SPOT') score += 5;
  else if (dteLabel === 'ACCEPTABLE') score += 2;

  // 8. VIX context bonus
  if (valid(vix)) {
    if (vix > 18 && setup.isCredit) score += 5; // High VIX favors selling
    if (vix < 14 && !setup.isCredit) score += 5; // Low VIX favors buying
  }

  return +score.toFixed(2);
}

function getBiasAlignment(stratType, bias) {
  const map = {
    BULL:    { BULL_PUT:1.0, BULL_CALL:1.0, IRON_CONDOR:0.5, LONG_STRADDLE:0.3, LONG_STRANGLE:0.3, BEAR_CALL:0.0, BEAR_PUT:0.0 },
    BEAR:    { BEAR_CALL:1.0, BEAR_PUT:1.0, IRON_CONDOR:0.5, LONG_STRADDLE:0.3, LONG_STRANGLE:0.3, BULL_PUT:0.0, BULL_CALL:0.0 },
    NEUTRAL: { IRON_CONDOR:1.0, LONG_STRADDLE:0.8, LONG_STRANGLE:0.8, BULL_PUT:0.5, BEAR_CALL:0.5, BULL_CALL:0.4, BEAR_PUT:0.4 }
  };
  return (map[bias] && map[bias][stratType]) || 0.3;
}

// ═══════════════════════════════════════════════════
// COMMAND TAB — MASTER RENDER
// ═══════════════════════════════════════════════════

function buildCommand() {
  const panel = document.getElementById('command-output');
  if (!panel) return;

  const vix = gv('india_vix') || gv('strat_vix');
  const nfSpot = gv('nf_price');
  const bnfSpot = gv('bn_price');

  // Check if we have chain data
  const hasChains = (Object.keys(window._CHAINS.NF).length + Object.keys(window._CHAINS.BNF).length) > 0;

  if (!hasChains || (!valid(nfSpot) && !valid(bnfSpot))) {
    panel.innerHTML = '<div class="cmd-placeholder">Fetch Upstox data to see strategy recommendations</div>';
    return;
  }

  // Q1: Directional bias
  const q1 = computeDirectionalBias();

  // Evaluate all strategies across all indices × expiries
  const ranked = evaluateAllStrategies(q1.bias, vix);
  _RANKED_SETUPS = ranked;

  // VIX ≥ 28 gate
  if (valid(vix) && vix >= 28) {
    panel.innerHTML = `
      <div class="gonogo nogo">
        <div class="gonogo-label">🚫 AVOID ALL TRADES</div>
        <div class="gonogo-reason">VIX ≥ 28 — Extreme volatility</div>
      </div>
      ${renderQ1Card(q1)}
    `;
    return;
  }

  let html = '';

  // GO/NO-GO
  const isGo = ranked.length > 0;
  html += `<div class="gonogo ${isGo ? 'go' : 'nogo'}">
    <div class="gonogo-label">${isGo ? '✅ GO' : '🚫 NO-GO'}</div>
    <div class="gonogo-strategy">${isGo ? `${ranked.length} viable setups found` : 'No viable setups'}</div>
    <div class="gonogo-meta">VIX: ${vix || '—'} | Bias: ${q1.biasConf} ${q1.bias}</div>
  </div>`;

  // Q1 Card
  html += renderQ1Card(q1);

  // Top strategies (up to 5)
  if (ranked.length > 0) {
    html += '<div class="section-title">TOP STRATEGIES — Real-Time</div>';
    const topN = ranked.slice(0, 5);
    topN.forEach((setup, i) => {
      html += renderStrategyCard(setup, i);
    });
  }

  panel.innerHTML = html;

  // Attach tap handlers for drawer
  document.querySelectorAll('.strat-card').forEach((card, i) => {
    card.addEventListener('click', () => openDrawer(_RANKED_SETUPS[i]));
  });
}

function renderQ1Card(q1) {
  return `<div class="q-card">
    <div class="q-title">Q1: Directional Bias → <span class="bias-${q1.bias.toLowerCase()}">${q1.biasConf} ${q1.bias}</span></div>
    <div class="q-signals">
      ${q1.signals.map(s => `<div class="signal-row">
        <span class="signal-name">${s.name}</span>
        <span class="signal-vote vote-${s.vote.toLowerCase()}">${s.vote}</span>
        <span class="signal-val">${s.val}</span>
      </div>`).join('')}
    </div>
    <div class="q-summary">Bull: ${q1.bullCount} | Bear: ${q1.bearCount} | Net: ${q1.net > 0 ? '+' : ''}${q1.net}</div>
  </div>`;
}

function renderStrategyCard(setup, index) {
  const premium = setup.isCredit ? `Credit ₹${setup.netPremium.toFixed(2)}` : `Debit ₹${Math.abs(setup.netPremium).toFixed(2)}`;
  const profitStr = setup.maxProfit === Infinity ? 'Unlimited' : `₹${setup.maxProfit.toLocaleString('en-IN')}`;

  // Build leg summary
  let legStr = setup.legs.map(l => `${l.action} ${l.strike} ${l.type}`).join(' | ');

  return `<div class="strat-card" data-idx="${index}">
    <div class="sc-rank">#${index + 1}</div>
    <div class="sc-header">
      <div class="sc-name">${setup.stratLabel}</div>
      <div class="sc-index">${setup.indexKey} · ${setup.expiry} · DTE ${setup.dte} (${setup.tradingDte}T)</div>
    </div>
    <div class="sc-legs">${legStr}</div>
    <div class="sc-metrics">
      <div class="sc-metric"><span class="sc-label">Max Profit</span><span class="sc-val profit">${profitStr}</span></div>
      <div class="sc-metric"><span class="sc-label">Max Loss</span><span class="sc-val loss">₹${setup.maxLoss.toLocaleString('en-IN')}</span></div>
      <div class="sc-metric"><span class="sc-label">R:R</span><span class="sc-val">1:${setup.rr}</span></div>
      <div class="sc-metric"><span class="sc-label">P(Profit)</span><span class="sc-val">${setup.probProfit}%</span></div>
    </div>
    <div class="sc-greeks">
      Δ ${setup.netDelta} · θ ${setup.netTheta} · γ ${setup.netGamma} · ν ${setup.netVega}
    </div>
    <div class="sc-score">Score: ${setup.compositeScore}</div>
    <div class="sc-tap">Tap for payoff chart ▾</div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// BOTTOM DRAWER — PAYOFF CHART
// ═══════════════════════════════════════════════════

let _drawerOpen = false;

function openDrawer(setup) {
  if (!setup) return;
  _drawerOpen = true;

  const drawer = document.getElementById('payoff-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer || !backdrop) return;

  // Populate drawer content
  document.getElementById('drawer-title').textContent = `${setup.stratLabel} — ${setup.indexKey} ${setup.expiry}`;

  // Draw payoff chart
  drawPayoffChart(setup);

  // Fill metrics
  const profitStr = setup.maxProfit === Infinity ? 'Unlimited' : `₹${setup.maxProfit.toLocaleString('en-IN')}`;
  document.getElementById('drawer-metrics').innerHTML = `
    <div class="dm-row"><span>Delta</span><span>${setup.netDelta}</span></div>
    <div class="dm-row"><span>Theta</span><span>${setup.netTheta}</span></div>
    <div class="dm-row"><span>Gamma</span><span>${setup.netGamma}</span></div>
    <div class="dm-row"><span>Vega</span><span>${setup.netVega}</span></div>
    <div class="dm-divider"></div>
    <div class="dm-row"><span>Max Profit</span><span class="profit">${profitStr}</span></div>
    <div class="dm-row"><span>Max Loss</span><span class="loss">₹${setup.maxLoss.toLocaleString('en-IN')}</span></div>
    <div class="dm-row"><span>P(Profit)</span><span>${setup.probProfit}%</span></div>
    <div class="dm-row"><span>R:R Ratio</span><span>1:${setup.rr}</span></div>
    <div class="dm-row"><span>Breakeven${setup.breakevens.length > 1 ? 's' : ''}</span><span>${setup.breakevens.join(' / ')}</span></div>
    <div class="dm-row"><span>DTE</span><span>${setup.dte} cal / ${setup.tradingDte} trading (${dteConviction(setup.dte)})</span></div>
    <div class="dm-row"><span>Lots</span><span>${setup.lots}</span></div>
    <div class="dm-row"><span>${setup.isCredit ? 'Net Credit' : 'Net Debit'}</span><span>₹${Math.abs(setup.netPremium).toFixed(2)}</span></div>
    <div class="dm-row"><span>Spread %</span><span>${setup.avgSpreadPct}%</span></div>
    <div class="dm-divider"></div>
    <div class="dm-legs-title">Legs</div>
    ${setup.legs.map(l => `<div class="dm-leg">${l.action} ${setup.indexKey} ${setup.expiry} ${l.strike} ${l.type} @ ₹${l.data.ltp.toFixed(2)}</div>`).join('')}
  `;

  // Show
  backdrop.classList.add('show');
  drawer.classList.add('show');
}

function closeDrawer() {
  _drawerOpen = false;
  const drawer = document.getElementById('payoff-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (drawer) drawer.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
}

// ═══════════════════════════════════════════════════
// PAYOFF CHART — HTML Canvas
// ═══════════════════════════════════════════════════

function drawPayoffChart(setup) {
  const canvas = document.getElementById('payoff-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Responsive sizing
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 280 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '280px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = 280;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Determine x-range (spot prices)
  const spot = setup.spot;
  const allStrikes = setup.legs.map(l => l.strike);
  const minStrike = Math.min(...allStrikes);
  const maxStrike = Math.max(...allStrikes);
  const range = Math.max(maxStrike - minStrike, setup.width) * 2;
  const xMin = spot - range, xMax = spot + range;

  // Calculate payoff at expiry for range of spots
  const points = [];
  const step = (xMax - xMin) / 200;
  let yMin = Infinity, yMax = -Infinity;

  for (let s = xMin; s <= xMax; s += step) {
    let pnl = 0;
    for (const leg of setup.legs) {
      const mult = leg.action === 'SELL' ? -1 : 1;
      let intrinsic;
      if (leg.type === 'CE') intrinsic = Math.max(s - leg.strike, 0);
      else intrinsic = Math.max(leg.strike - s, 0);
      pnl += mult * intrinsic;
    }
    // Add premium received/paid
    pnl += setup.netPremium;
    pnl *= setup.lotSize * setup.lots;

    points.push({ x: s, y: pnl });
    if (pnl < yMin) yMin = pnl;
    if (pnl > yMax) yMax = pnl;
  }

  // Add margin to y-axis
  const yPad = Math.max(Math.abs(yMax), Math.abs(yMin)) * 0.15;
  yMin -= yPad; yMax += yPad;
  if (yMin === yMax) { yMin -= 1000; yMax += 1000; }

  // Transform functions
  const tx = x => pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const ty = y => pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#3d352c';
  ctx.lineWidth = 0.5;

  // Y grid + labels
  const yTicks = 5;
  ctx.fillStyle = '#8a7d6f';
  ctx.font = '11px Courier New';
  ctx.textAlign = 'right';
  for (let i = 0; i <= yTicks; i++) {
    const yVal = yMin + (yMax - yMin) * i / yTicks;
    const py = ty(yVal);
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(W - pad.right, py); ctx.stroke();
    const label = yVal >= 1000 || yVal <= -1000 ? (yVal / 1000).toFixed(1) + 'K' : yVal.toFixed(0);
    ctx.fillText(label, pad.left - 5, py + 4);
  }

  // X grid + labels
  ctx.textAlign = 'center';
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const xVal = xMin + (xMax - xMin) * i / xTicks;
    const px = tx(xVal);
    ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, H - pad.bottom); ctx.stroke();
    ctx.fillText(xVal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','), px, H - pad.bottom + 15);
  }

  // Zero line
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const zy = ty(0);
    ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(W - pad.right, zy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Fill profit/loss regions
  ctx.beginPath();
  ctx.moveTo(tx(points[0].x), ty(0));
  for (const p of points) ctx.lineTo(tx(p.x), ty(p.y));
  ctx.lineTo(tx(points[points.length - 1].x), ty(0));
  ctx.closePath();

  // Use gradient — green above zero, red below
  for (const p of points) {
    if (p.y > 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(92, 184, 92, 0.25)';
      ctx.fillRect(pad.left, pad.top, plotW, plotH);
      ctx.restore();
      break;
    }
  }

  // Re-fill loss region
  ctx.beginPath();
  ctx.moveTo(tx(points[0].x), ty(0));
  for (const p of points) ctx.lineTo(tx(p.x), ty(Math.min(p.y, 0)));
  ctx.lineTo(tx(points[points.length - 1].x), ty(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(217, 83, 79, 0.20)';
  ctx.fill();

  // Profit region
  ctx.beginPath();
  ctx.moveTo(tx(points[0].x), ty(0));
  for (const p of points) ctx.lineTo(tx(p.x), ty(Math.max(p.y, 0)));
  ctx.lineTo(tx(points[points.length - 1].x), ty(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(92, 184, 92, 0.20)';
  ctx.fill();

  // Payoff line (at expiry)
  ctx.strokeStyle = '#d4a853';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = tx(points[i].x), py = ty(points[i].y);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Current P&L curve (using BS pricing with remaining time)
  if (setup.dte > 1) {
    const vix = window._LIVE_VIX || 14;
    const T = setup.dte / 365;
    const r = 0.065;
    const sigma = vix / 100;
    const currentPoints = [];

    for (let s = xMin; s <= xMax; s += step) {
      let pnl = 0;
      for (const leg of setup.legs) {
        const mult = leg.action === 'SELL' ? -1 : 1;
        const iv = (leg.data.iv || vix) / 100;
        let theoPrice;
        if (leg.type === 'CE') theoPrice = bsCall(s, leg.strike, r, iv, T);
        else theoPrice = bsPut(s, leg.strike, r, iv, T);
        pnl += mult * (theoPrice - leg.data.ltp * (leg.action === 'SELL' ? -1 : 1));
      }
      // Correct: pnl = current value of position - initial cost
      let posValue = 0;
      for (const leg of setup.legs) {
        const mult = leg.action === 'SELL' ? -1 : 1;
        const iv = (leg.data.iv || vix) / 100;
        let theoPrice;
        if (leg.type === 'CE') theoPrice = bsCall(s, leg.strike, r, iv, T);
        else theoPrice = bsPut(s, leg.strike, r, iv, T);
        posValue += mult * theoPrice;
      }
      const entryValue = setup.netPremium; // positive for credit
      pnl = (posValue + entryValue) * setup.lotSize * setup.lots * -1;
      // For credit: we received premium. Current cost to close = posValue (negative = profit)
      pnl = (entryValue - (-posValue)) * setup.lotSize * setup.lots;

      currentPoints.push({ x: s, y: pnl });
    }

    ctx.strokeStyle = '#f0ad4e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    for (let i = 0; i < currentPoints.length; i++) {
      const px = tx(currentPoints[i].x);
      const py = ty(Math.max(yMin, Math.min(yMax, currentPoints[i].y)));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Spot marker
  const spotX = tx(spot);
  ctx.strokeStyle = '#5bc0de';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(spotX, pad.top); ctx.lineTo(spotX, H - pad.bottom); ctx.stroke();
  ctx.setLineDash([]);

  // Spot dot
  const spotPnl = points.reduce((best, p) => Math.abs(p.x - spot) < Math.abs(best.x - spot) ? p : best, points[0]);
  ctx.fillStyle = '#5bc0de';
  ctx.beginPath(); ctx.arc(spotX, ty(spotPnl.y), 5, 0, Math.PI * 2); ctx.fill();

  // Breakeven markers
  ctx.fillStyle = '#8a7d6f';
  ctx.font = '10px Courier New';
  ctx.textAlign = 'center';
  for (const be of setup.breakevens) {
    const bx = tx(be);
    if (bx > pad.left && bx < W - pad.right) {
      ctx.beginPath();
      ctx.moveTo(bx, H - pad.bottom - 5);
      ctx.lineTo(bx - 4, H - pad.bottom + 3);
      ctx.lineTo(bx + 4, H - pad.bottom + 3);
      ctx.closePath();
      ctx.fillStyle = '#f0ad4e';
      ctx.fill();
      ctx.fillStyle = '#8a7d6f';
      ctx.fillText(be.toString(), bx, H - pad.bottom + 28);
    }
  }

  // Legend
  ctx.font = '10px Courier New';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d4a853'; ctx.fillText('— At expiry', pad.left + 5, pad.top + 12);
  if (setup.dte > 1) { ctx.fillStyle = '#f0ad4e'; ctx.fillText('--- Current', pad.left + 100, pad.top + 12); }
  ctx.fillStyle = '#5bc0de'; ctx.fillText('● Spot', pad.left + 190, pad.top + 12);
}

// ═══════════════════════════════════════════════════
// DRAWER TOUCH HANDLING
// ═══════════════════════════════════════════════════

function initDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  const drawer = document.getElementById('payoff-drawer');
  const handle = document.getElementById('drawer-handle');

  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  if (handle) {
    let startY = 0, dragging = false;
    handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; dragging = true; });
    handle.addEventListener('touchmove', e => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 80) { closeDrawer(); dragging = false; }
    });
    handle.addEventListener('touchend', () => { dragging = false; });
    // Mouse fallback
    handle.addEventListener('mousedown', e => { startY = e.clientY; dragging = true; });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      if (e.clientY - startY > 80) { closeDrawer(); dragging = false; }
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }
}

// ═══════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════

function go(n) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.getElementById(`t${n}`);
  const panel = document.getElementById(`p${n}`);
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
}

function selectIndex(idx) {
  SELECTED_INDEX = idx;
  document.querySelectorAll('.idx-btn').forEach(b => b.classList.toggle('active', b.dataset.idx === idx));
  buildCommand();
}

// ═══════════════════════════════════════════════════
// DATA LOCKING
// ═══════════════════════════════════════════════════

function lockRadar() {
  const data = {};
  ['gift_gap','gift_trend','india_vix','fii','close_char','max_pain_nf','nf_price','bn_price'].forEach(id => { data[id] = gv(id); });
  localStorage.setItem('mr140-radar', JSON.stringify(data));
  RADAR_LOCKED = true; renderLockState();
}

function lockBreadth() {
  const data = {};
  ['n50adv','n50dma','bnfadv'].forEach(id => { data[id] = gv(id); });
  const checklist = {};
  document.querySelectorAll('input[type="radio"][name^="bnf"]').forEach(r => { if (r.checked) checklist[r.name] = r.value; });
  data._checklist = checklist;
  localStorage.setItem('mr140-breadth', JSON.stringify(data));
  localStorage.setItem('mr140-checklist', JSON.stringify(checklist));
  BREADTH_LOCKED = true; renderLockState();
}

function lockEvening() {
  const data = {};
  ['ev_fii','ev_nf_close','ev_bnf_close','ev_indiavix'].forEach(id => { data[id] = gv(id); });
  data._lock_date = new Date().toISOString().slice(0, 10);
  localStorage.setItem('mr140-evening', JSON.stringify(data));
  const evVix = gv('ev_indiavix');
  if (valid(evVix)) localStorage.setItem('mr_ev_indiavix', evVix);
  EVENING_LOCKED = true; renderLockState();
}

function renderLockState() {
  const btns = [
    ['btn-lock-radar',   RADAR_LOCKED,   '🔒 Locked', '🔓 Lock Morning Data'],
    ['btn-lock-breadth', BREADTH_LOCKED, '🔒 Locked', '🔓 Lock Breadth'],
    ['btn-lock-evening', EVENING_LOCKED, '🔒 Locked', '🔓 Lock Evening']
  ];
  for (const [id, locked, lockTxt, unlockTxt] of btns) {
    const el = document.getElementById(id);
    if (el) { el.textContent = locked ? lockTxt : unlockTxt; el.disabled = locked; }
  }
}

// ═══════════════════════════════════════════════════
// RESTORE STATE
// ═══════════════════════════════════════════════════

function restoreSavedState() {
  try {
    const radar = JSON.parse(localStorage.getItem('mr140-radar') || 'null');
    if (radar) { RADAR_LOCKED = true; for (const id in radar) { const el = document.getElementById(id); if (el && radar[id] !== null) el.value = radar[id]; } }
  } catch(e) {}

  try {
    const breadth = JSON.parse(localStorage.getItem('mr140-breadth') || 'null');
    if (breadth) { BREADTH_LOCKED = true; for (const id in breadth) { if (id === '_checklist') continue; const el = document.getElementById(id); if (el && breadth[id] !== null) el.value = breadth[id]; } }
    const cl = JSON.parse(localStorage.getItem('mr140-checklist') || 'null');
    if (cl) { for (const n in cl) { const r = document.querySelector(`input[name="${n}"][value="${cl[n]}"]`); if (r) r.checked = true; } }
  } catch(e) {}

  const today = new Date().toISOString().slice(0, 10);
  const lastLock = localStorage.getItem('mr_lock_date');
  if (lastLock !== today) {
    RADAR_LOCKED = false;
    BREADTH_LOCKED = false;
    EVENING_LOCKED = false;
    localStorage.setItem('mr_lock_date', today);
    // Yesterday's VIX baseline is preserved in mr_ev_indiavix — not cleared
  }

  renderLockState();
  restoreAllTS();
}

// ═══════════════════════════════════════════════════
// INPUT HANDLERS
// ═══════════════════════════════════════════════════

function onInput(e) { if (e.target && e.target.id) stampField(e.target.id); calcScore(); }

function initInputListeners() {
  document.querySelectorAll('input[type="number"], select').forEach(el => {
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
  });
}

// ═══════════════════════════════════════════════════
// BHAV UPLOAD (CLOSE TAB)
// ═══════════════════════════════════════════════════

async function handleBhavUpload() {
  const fileInput = document.getElementById('bhav-file');
  const spotInput = document.getElementById('bhav-spot');
  const statusEl  = document.getElementById('bhav-status');
  if (!fileInput || !fileInput.files.length) { if (statusEl) statusEl.textContent = 'Select a CSV file'; return; }
  if (statusEl) statusEl.textContent = 'Uploading...';
  const result = await bhavHandleUpload(fileInput.files, spotInput ? spotInput.value : '');
  if (statusEl) {
    statusEl.textContent = result.ok
      ? `✅ ${result.contracts} contracts. GitHub: ${result.github ? '✅' : '❌ ' + result.error}`
      : `❌ ${result.error}`;
  }
}

// ═══════════════════════════════════════════════════
// EVENING SECTION
// ═══════════════════════════════════════════════════

function renderEveningSection() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const evening = JSON.parse(localStorage.getItem('mr140-evening') || 'null');
    if (evening) {
      // Restore values into fields
      for (const id in evening) {
        if (id.startsWith('_')) continue; // skip metadata
        const el = document.getElementById(id);
        if (el && evening[id] !== null) el.value = evening[id];
      }
      // Only re-lock if it was locked TODAY (new day = fresh evening entry)
      if (evening._lock_date === today) {
        EVENING_LOCKED = true;
      }
    }
  } catch(e) {}
  renderLockState();
}

// ═══════════════════════════════════════════════════
// DEBUG — visible chain inspection
// ═══════════════════════════════════════════════════

function showDebug() {
  const el = document.getElementById('debug-output');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  if (el.style.display === 'none') return;

  let out = '=== CHAIN DEBUG ===\n\n';

  for (const idx of ['NF', 'BNF']) {
    const chains = window._CHAINS[idx];
    out += `--- ${idx} ---\n`;
    out += `Expiries: ${JSON.stringify(Object.keys(chains))}\n`;

    for (const exp in chains) {
      const c = chains[exp];
      const strikeKeys = Object.keys(c.strikes || {});
      out += `\n[${exp}] DTE=${c.dte} TradingDTE=${c.tradingDte || '?'} Spot=${c.spot}\n`;
      out += `  PCR=${c.pcr} MaxPain=${c.maxPain}\n`;
      out += `  CallOI=${c.callOI} PutOI=${c.putOI}\n`;
      out += `  CallWall=${c.callWall} PutWall=${c.putWall}\n`;
      out += `  Strikes loaded: ${strikeKeys.length}\n`;

      // Show first 3 strikes with full data
      const sample = strikeKeys.slice(0, 3);
      for (const sk of sample) {
        const s = c.strikes[sk];
        if (s.CE) out += `  ${sk} CE: LTP=${s.CE.ltp} OI=${s.CE.oi} Δ=${s.CE.delta} θ=${s.CE.theta} IV=${s.CE.iv}\n`;
        if (s.PE) out += `  ${sk} PE: LTP=${s.PE.ltp} OI=${s.PE.oi} Δ=${s.PE.delta} θ=${s.PE.theta} IV=${s.PE.iv}\n`;
      }

      // Show ATM area (closest to spot)
      if (c.spot && strikeKeys.length > 0) {
        const atm = strikeKeys.reduce((b, s) => Math.abs(+s - c.spot) < Math.abs(+b - c.spot) ? s : b);
        const atmData = c.strikes[atm];
        out += `  ATM(${atm}):\n`;
        if (atmData.CE) out += `    CE: LTP=${atmData.CE.ltp} OI=${atmData.CE.oi} Δ=${atmData.CE.delta}\n`;
        if (atmData.PE) out += `    PE: LTP=${atmData.PE.ltp} OI=${atmData.PE.oi} Δ=${atmData.PE.delta}\n`;
      }
    }
    out += '\n';
  }

  // Also show raw hidden field values
  out += '--- HIDDEN FIELDS ---\n';
  ['nf_price','bn_price','india_vix','nf_atr','bn_atr','pcr_nf','pcr_bn',
   'max_pain_nf','nf_oi_call','nf_oi_put','nf_maxpain','bn_maxpain'].forEach(id => {
    out += `  ${id} = ${gv(id)}\n`;
  });

  el.textContent = out;
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => go(parseInt(tab.id.replace('t', ''))));
  });
  document.querySelectorAll('.idx-btn').forEach(btn => {
    btn.addEventListener('click', () => selectIndex(btn.dataset.idx));
  });

  const lockRadarBtn = document.getElementById('btn-lock-radar');
  if (lockRadarBtn) lockRadarBtn.addEventListener('click', lockRadar);
  const lockBreadthBtn = document.getElementById('btn-lock-breadth');
  if (lockBreadthBtn) lockBreadthBtn.addEventListener('click', lockBreadth);
  const lockEveningBtn = document.getElementById('btn-lock-evening');
  if (lockEveningBtn) lockEveningBtn.addEventListener('click', lockEvening);

  const bhavBtn = document.getElementById('btn-bhav-upload');
  if (bhavBtn) bhavBtn.addEventListener('click', handleBhavUpload);

  const debugBtn = document.getElementById('btn-debug');
  if (debugBtn) debugBtn.addEventListener('click', showDebug);

  initInputListeners();
  initDrawer();
  restoreSavedState();
  renderEveningSection();
  calcScore();
  go(0);

  console.log('[app.js] Market Radar v5.0 — real-data engine loaded');
});
