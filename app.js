/* ============================================================
   app.js — Market Radar v5.0 — Phase 5
   EV-based scoring, Varsity multiplier, split display
   Expandable Q1 card, weighted BNF breadth, futures premium bias
   All 7 strategies × all expiries × both indices
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

const NSE_HOLIDAYS_2026 = [
  '2026-01-26','2026-03-03','2026-03-26','2026-03-31',
  '2026-04-03','2026-04-14','2026-05-01','2026-05-28',
  '2026-06-26','2026-09-14','2026-10-02','2026-10-20',
  '2026-11-10','2026-11-24','2026-12-25'
];

// ── BNF Top-5 Constituent Weights (sum ≈ 79%) ──
const BNF_CONSTITUENTS = [
  { id: 'bnf_hdfc',  name: 'HDFC Bank', weight: 0.28, instrument: 'NSE_EQ|HDFCBANK' },
  { id: 'bnf_icici', name: 'ICICI Bank', weight: 0.22, instrument: 'NSE_EQ|ICICIBANK' },
  { id: 'bnf_kotak', name: 'Kotak Mah', weight: 0.12, instrument: 'NSE_EQ|KOTAKBANK' },
  { id: 'bnf_sbi',   name: 'SBI',        weight: 0.09, instrument: 'NSE_EQ|SBIN' },
  { id: 'bnf_axis',  name: 'Axis Bank',  weight: 0.08, instrument: 'NSE_EQ|AXISBANK' }
];

// ── State ──
let SCORE = null, DIRECTION = '';
let RADAR_LOCKED = false, BREADTH_LOCKED = false, EVENING_LOCKED = false;
let ANALYSIS_VIX = null;
let _RANKED_SETUPS = [];
let _CALC_SCORE_DETAILS = null; // Stores per-signal breakdown for Q1 expanded view
let _Q1_EXPANDED = false;

const W = {
  india_vix: 0.25, pcr_nf: 0.18, fii: 0.15, gift_gap: 0.15,
  close_char: 0.10, max_pain: 0.08,
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
function prevTradingDay(d) { const p = new Date(d); do { p.setDate(p.getDate() - 1); } while (!isTradingDay(p)); return p; }
function actualExpiry(raw) { const d = new Date(raw); while (!isTradingDay(d)) d.setDate(d.getDate() - 1); return d; }
function dateFmt(d) { return d.toISOString().slice(0, 10); }
function daysTo(target) {
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(target); t.setHours(0,0,0,0);
  return Math.max(1, Math.round((t - now) / 86400000));
}
function tradingDaysTo(target) {
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(target); t.setHours(0,0,0,0);
  let count = 0; const d = new Date(now); d.setDate(d.getDate() + 1);
  while (d <= t) { if (isTradingDay(d)) count++; d.setDate(d.getDate() + 1); }
  return Math.max(1, count);
}
function directionCategory(score) {
  if (score >= 1.2) return 'STRONG_BULL'; if (score >= 0.4) return 'MILD_BULL';
  if (score > -0.4) return 'NEUTRAL'; if (score > -1.2) return 'MILD_BEAR'; return 'STRONG_BEAR';
}
function directionLabel(score) {
  return { STRONG_BULL:'STRONGLY BULLISH', MILD_BULL:'MILDLY BULLISH', NEUTRAL:'NEUTRAL', MILD_BEAR:'MILDLY BEARISH', STRONG_BEAR:'STRONGLY BEARISH' }[directionCategory(score)];
}
function dteConviction(dte) {
  if (dte >= 11 && dte <= 21) return 'SWEET SPOT'; if (dte >= 6 && dte <= 35) return 'ACCEPTABLE';
  if (dte < 6) return 'SHORT'; return 'LONG';
}

// ── Moneyness Label ──
function moneyLabel(strike, spot, type) {
  const pct = ((strike - spot) / spot) * 100;
  if (type === 'CE') {
    if (pct < -2) return 'Deep ITM'; if (pct < 0) return 'ITM';
    if (Math.abs(pct) <= 0.5) return 'ATM';
    if (pct <= 3) return 'OTM'; if (pct <= 6) return 'Far OTM'; return 'Deep OTM';
  } else {
    // PE: ITM when strike > spot
    if (pct > 2) return 'Deep ITM'; if (pct > 0) return 'ITM';
    if (Math.abs(pct) <= 0.5) return 'ATM';
    if (pct >= -3) return 'OTM'; if (pct >= -6) return 'Far OTM'; return 'Deep OTM';
  }
}

// ── Timestamp / Freshness ──
function getTS() { try { return JSON.parse(localStorage.getItem('mr140-ts') || '{}'); } catch(e) { return {}; } }
function stampField(id) { const ts = getTS(); ts[id] = Date.now(); localStorage.setItem('mr140-ts', JSON.stringify(ts)); renderTS(id, ts[id]); }
function renderTS(id, timestamp) {
  const el = document.getElementById(`ts-${id}`); if (!el) return;
  const age = (Date.now() - timestamp) / 60000;
  const label = age < 15 ? 'fresh' : age < 60 ? 'stale' : 'old';
  el.textContent = label; el.className = `ts-badge ts-${label}`;
}
function restoreAllTS() { const ts = getTS(); for (const id in ts) renderTS(id, ts[id]); }

// ═══════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════

function calcScore() {
  const signals = {};
  const rawVals = {}; // Store raw values for display
  const india_vix = gv('india_vix'), fii = gv('fii'), pcr_nf = gv('pcr_nf');
  const close_char = gv('close_char'), max_pain = gv('max_pain_nf'), nf_spot = gv('nf_price');
  const n50adv = gv('n50adv'), n50dma = gv('n50dma');
  const nifty_prev = gv('nifty_prev');

  // Auto-calculate gap from spot vs previous close
  if (valid(nf_spot) && valid(nifty_prev) && nifty_prev > 0) {
    const gap = ((nf_spot - nifty_prev) / nifty_prev) * 100;
    signals.gift_gap = Math.max(-1, Math.min(1, gap / 1.5));
    rawVals.gift_gap = `${gap > 0 ? '+' : ''}${gap.toFixed(2)}%`;
  }

  if (valid(india_vix))  { signals.india_vix = Math.max(-1, Math.min(1, -(india_vix - 14) / 6)); ANALYSIS_VIX = india_vix; rawVals.india_vix = india_vix.toFixed(2); }
  if (valid(fii)) {
    // ── FII 2D Signal: cash flow + positioning ──
    const fiiShortPct = gv('fii_short_pct');
    const prevShortPct = parseFloat(localStorage.getItem('mr_fii_short_prev') || '0');
    let fiiSignal = Math.max(-1, Math.min(1, fii / 2000)); // Base: cash flow direction
    rawVals.fii = `₹${fii} Cr`;

    if (valid(fiiShortPct) && fiiShortPct > 0) {
      // Enhance with positioning context
      if (fiiShortPct > 85 && prevShortPct > 0 && fiiShortPct >= prevShortPct) {
        // Extreme short + adding → strong bear conviction
        fiiSignal = Math.min(fiiSignal, -0.8);
        rawVals.fii += ` · ${fiiShortPct}% short ↑`;
      } else if (fiiShortPct > 85 && prevShortPct > 0 && fiiShortPct < prevShortPct) {
        // Extreme short BUT covering → bear weakening
        fiiSignal = Math.max(fiiSignal, fiiSignal + 0.3);
        rawVals.fii += ` · ${fiiShortPct}% short ↓ covering`;
      } else if (fiiShortPct < 70) {
        // Low short = bullish positioning
        fiiSignal = Math.max(fiiSignal, 0.3);
        rawVals.fii += ` · ${fiiShortPct}% short (low)`;
      } else {
        rawVals.fii += ` · ${fiiShortPct}% short`;
      }
      fiiSignal = Math.max(-1, Math.min(1, fiiSignal));
    }
    signals.fii = fiiSignal;
  }
  if (valid(pcr_nf))     { signals.pcr_nf = Math.max(-1, Math.min(1, (pcr_nf - 1.0) / 0.5)); rawVals.pcr_nf = pcr_nf.toFixed(2); }
  if (valid(close_char)) { signals.close_char = Math.max(-1, Math.min(1, close_char / 2)); rawVals.close_char = close_char; }
  if (valid(max_pain) && valid(nf_spot) && nf_spot > 0) {
    signals.max_pain = Math.max(-1, Math.min(1, (max_pain - nf_spot) / nf_spot * 100));
    rawVals.max_pain = `${max_pain} (${(max_pain - nf_spot) > 0 ? '+' : ''}${(max_pain - nf_spot).toFixed(0)})`;
  }
  if (valid(n50adv)) { signals.n50adv = Math.max(-1, Math.min(1, (n50adv - 25) / 15)); rawVals.n50adv = `${n50adv}/50`; }
  if (valid(n50dma)) { signals.n50dma = Math.max(-1, Math.min(1, n50dma / 5)); rawVals.n50dma = `${n50dma}%`; }

  // BNF Weighted Breadth — from constituent checkboxes
  const bnfWB = computeBnfWeightedBreadth();
  if (bnfWB !== null) {
    signals.bnfadv = Math.max(-1, Math.min(1, (bnfWB - 40) / 40));
    rawVals.bnfadv = `${bnfWB.toFixed(0)}% weighted`;
  }

  let wSum = 0, wTotal = 0;
  const details = [];
  for (const key in W) {
    if (signals[key] !== undefined) {
      const contrib = signals[key] * W[key];
      wSum += contrib; wTotal += W[key];
      details.push({ key, label: SIGNAL_LABELS[key] || key, raw: rawVals[key] || '—', weight: W[key], signal: +signals[key].toFixed(3), contrib: +contrib.toFixed(4) });
    }
  }
  if (wTotal === 0) { SCORE = null; DIRECTION = ''; _CALC_SCORE_DETAILS = null; renderVerdict(); return; }
  SCORE = +(wSum / wTotal).toFixed(4);
  DIRECTION = directionLabel(SCORE);
  _CALC_SCORE_DETAILS = { details, wSum, wTotal, score: SCORE };
  renderVerdict(); buildCommand();
}

// Signal labels for display
const SIGNAL_LABELS = {
  india_vix: 'India VIX', pcr_nf: 'PCR (NF)', fii: 'FII Cash', gift_gap: 'Gap %',
  close_char: 'Close Char', max_pain: 'Max Pain', n50adv: 'NF Breadth', bnfadv: 'BNF Breadth', n50dma: 'NF % > 200DMA'
};

// Compute weighted BNF breadth from constituent checkboxes
function computeBnfWeightedBreadth() {
  let total = 0;
  for (const c of BNF_CONSTITUENTS) {
    const el = document.getElementById(c.id);
    if (el && el.checked) total += c.weight * 100;
  }
  const firstEl = document.getElementById(BNF_CONSTITUENTS[0].id);
  if (!firstEl) return null;
  return total;
}

function updateBnfReadout() {
  const el = document.getElementById('bnf-weighted-readout');
  if (!el) return;
  const wb = computeBnfWeightedBreadth();
  if (wb === null) { el.textContent = '0%'; return; }
  const cls = wb >= 50 ? 'profit' : wb <= 20 ? 'loss' : '';
  el.innerHTML = `<span class="${cls}">${wb.toFixed(0)}%</span>`;
}

function renderVerdict() {
  const el = document.getElementById('verdict'); if (!el) return;
  if (SCORE === null) { el.innerHTML = '<div class="verdict-box neutral">Enter signals to see direction</div>'; return; }
  const cls = { STRONG_BULL:'bull', MILD_BULL:'bull-mild', NEUTRAL:'neutral', MILD_BEAR:'bear-mild', STRONG_BEAR:'bear' }[directionCategory(SCORE)];
  el.innerHTML = `<div class="verdict-box ${cls}"><div class="verdict-direction">${DIRECTION}</div><div class="verdict-score">Score: ${SCORE.toFixed(2)}</div></div>`;
}

// ═══════════════════════════════════════════════════
// EXPIRY CALENDAR
// ═══════════════════════════════════════════════════

function getExpiries(index) {
  const results = [], today = new Date(); today.setHours(0,0,0,0);
  if (index === 'NF') {
    let d = new Date(today);
    while (results.length < 3) {
      const dow = d.getDay(); const skip = (4 - dow + 7) % 7 || 7;
      if (dow !== 4 || d <= today) d.setDate(d.getDate() + (dow === 4 && d >= today ? 0 : skip));
      const exp = actualExpiry(new Date(d)); const s = dateFmt(exp);
      if (!results.includes(s) && exp >= today) results.push(s); d.setDate(d.getDate() + 1);
    }
  } else {
    let d = new Date(today);
    while (results.length < 3) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const lt = new Date(lastDay); while (lt.getDay() !== 4) lt.setDate(lt.getDate() - 1);
      const exp = actualExpiry(new Date(lt)); const s = dateFmt(exp);
      if (exp >= today && !results.includes(s)) results.push(s);
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════
// Q1: DIRECTIONAL BIAS
// ═══════════════════════════════════════════════════

function computeDirectionalBias() {
  let bullCount = 0, bearCount = 0; const signals = [];
  const fii = gv('fii');
  if (valid(fii)) { if (fii > 500) { bullCount++; signals.push({name:'FII Cash',vote:'BULL',val:`₹${fii} Cr`}); } else if (fii < -500) { bearCount++; signals.push({name:'FII Cash',vote:'BEAR',val:`₹${fii} Cr`}); } else signals.push({name:'FII Cash',vote:'NEUTRAL',val:`₹${fii} Cr`}); }
  const fiiFut = gv('fii_fut'), fiiOpt = gv('fii_opt');
  if (valid(fiiFut) || valid(fiiOpt)) { const net = (fiiFut||0)+(fiiOpt||0); if (net > 0) { bullCount++; signals.push({name:'FII Deriv',vote:'BULL',val:`₹${net.toFixed(0)} Cr`}); } else if (net < 0) { bearCount++; signals.push({name:'FII Deriv',vote:'BEAR',val:`₹${net.toFixed(0)} Cr`}); } else signals.push({name:'FII Deriv',vote:'NEUTRAL',val:`₹${net.toFixed(0)} Cr`}); }
  const pcr = gv('pcr_nf');
  if (valid(pcr)) { if (pcr > 1.2) { bullCount++; signals.push({name:'PCR',vote:'BULL',val:pcr.toFixed(2)}); } else if (pcr < 0.9) { bearCount++; signals.push({name:'PCR',vote:'BEAR',val:pcr.toFixed(2)}); } else signals.push({name:'PCR',vote:'NEUTRAL',val:pcr.toFixed(2)}); }
  const spot = gv('nf_price'), mp = gv('max_pain_nf');
  if (valid(spot) && valid(mp)) { const diff = spot - mp; if (diff < -100) { bullCount++; signals.push({name:'Max Pain',vote:'BULL',val:`${diff.toFixed(0)}`}); } else if (diff > 100) { bearCount++; signals.push({name:'Max Pain',vote:'BEAR',val:`+${diff.toFixed(0)}`}); } else signals.push({name:'Max Pain',vote:'NEUTRAL',val:`${diff>0?'+':''}${diff.toFixed(0)}`}); }
  const cc = gv('close_char');
  if (valid(cc)) { if (cc >= 1) { bullCount++; signals.push({name:'Close Char',vote:'BULL',val:`+${cc}`}); } else if (cc <= -1) { bearCount++; signals.push({name:'Close Char',vote:'BEAR',val:`${cc}`}); } else signals.push({name:'Close Char',vote:'NEUTRAL',val:`${cc}`}); }
  const vix = gv('india_vix'), yVix = parseFloat(localStorage.getItem('mr_ev_indiavix') || '0');
  if (valid(vix) && yVix > 0) { const vc = vix - yVix; if (vc < -0.3) { bullCount++; signals.push({name:'VIX Dir',vote:'BULL',val:`${vc.toFixed(2)}`}); } else if (vc > 0.3) { bearCount++; signals.push({name:'VIX Dir',vote:'BEAR',val:`+${vc.toFixed(2)}`}); } else signals.push({name:'VIX Dir',vote:'NEUTRAL',val:`${vc>0?'+':''}${vc.toFixed(2)}`}); }

  // Futures premium signal — prefer actual, fallback to synthetic
  const nfSpotQ1 = gv('nf_price') || 0;
  let nfFP = null;
  if (window._NF_ACTUAL_FUTURES && nfSpotQ1 > 0) {
    nfFP = ((window._NF_ACTUAL_FUTURES - nfSpotQ1) / nfSpotQ1) * 100;
  } else {
    nfFP = window._NF_FUTURES_PREMIUM;
  }
  if (nfFP !== null && nfFP !== undefined) {
    if (nfFP > 0.05) { bullCount++; signals.push({name:'Fut Premium',vote:'BULL',val:`+${nfFP.toFixed(3)}%`}); }
    else if (nfFP < -0.05) { bearCount++; signals.push({name:'Fut Premium',vote:'BEAR',val:`${nfFP.toFixed(3)}%`}); }
    else signals.push({name:'Fut Premium',vote:'NEUTRAL',val:`${nfFP > 0 ? '+' : ''}${nfFP.toFixed(3)}%`});
  }

  const net = bullCount - bearCount; let bias, biasConf;
  if (net >= 3) { bias='BULL'; biasConf='Strong'; } else if (net >= 1) { bias='BULL'; biasConf='Mild'; }
  else if (net <= -3) { bias='BEAR'; biasConf='Strong'; } else if (net <= -1) { bias='BEAR'; biasConf='Mild'; }
  else { bias='NEUTRAL'; biasConf='Neutral'; }
  return { bias, biasConf, bullCount, bearCount, net, signals };
}

// ═══════════════════════════════════════════════════
// STRATEGY EVALUATOR
// ═══════════════════════════════════════════════════

const STRATEGY_TYPES = ['BULL_PUT','BEAR_CALL','IRON_CONDOR','BULL_CALL','BEAR_PUT','LONG_STRADDLE','LONG_STRANGLE'];
const STRAT_LABELS = { BULL_PUT:'Bull Put Spread', BEAR_CALL:'Bear Call Spread', IRON_CONDOR:'Iron Condor', BULL_CALL:'Bull Call Spread', BEAR_PUT:'Bear Put Spread', LONG_STRADDLE:'Long Straddle', LONG_STRANGLE:'Long Strangle' };

function evaluateAllStrategies(bias, vix, biasConf) {
  const setups = [];
  // Track nearest expiry DTE for range budget multi-day display
  let nfMinDte = 99, bnfMinDte = 99;
  for (const indexKey of ['NF','BNF']) {
    const chains = window._CHAINS[indexKey]; if (!chains || !Object.keys(chains).length) continue;
    const isNF = indexKey === 'NF';
    const lotSize = isNF ? NF_LOT_SIZE : BNF_LOT;
    const marginPerLot = isNF ? NF_MARGIN_PER_LOT : BNF_MARGIN_PER_LOT, step = isNF ? 50 : 100;
    for (const expiry in chains) {
      const chain = chains[expiry]; if (!chain.strikes || !chain.spot) continue;
      const spot = chain.spot, dte = chain.dte, tradingDte = chain.tradingDte || dte;
      if (isNF && tradingDte < nfMinDte && tradingDte > 0) nfMinDte = tradingDte;
      if (!isNF && tradingDte < bnfMinDte && tradingDte > 0) bnfMinDte = tradingDte;
      const rc = chain.riskCenter || spot; // Actual futures price or spot fallback
      const strikeKeys = Object.keys(chain.strikes).map(Number).sort((a,b) => a - b);
      if (strikeKeys.length < 4) continue;
      // ATM from risk center (futures), not spot — better reflects market pricing
      const atm = strikeKeys.reduce((best, s) => Math.abs(s - rc) < Math.abs(best - rc) ? s : best, strikeKeys[0]);
      for (const stratType of STRATEGY_TYPES) {
        if (!isStrategyAllowed(stratType, bias, vix)) continue;
        const candidates = buildCandidates(stratType, chain, atm, rc, step, strikeKeys, isNF);
        for (const cand of candidates) {
          const setup = evaluateSetup(cand, stratType, indexKey, expiry, spot, dte, tradingDte, lotSize, marginPerLot, cand.width || 0, chain, vix);
          if (setup) {
            setup.riskCenter = rc; // Store for display
            const baseScore = scoreSetup(setup, bias, vix, chain);
            let varsityMult = getVarsityMultiplier(stratType, biasConf || 'Neutral', bias, vix);

            // ── Upstox consensus penalty: when Upstox disagrees, reduce confidence ──
            const upBias = (document.getElementById('upstox_bias') || {}).value || '';
            if (upBias) {
              const upDir = upBias === 'BULLISH' ? 'BULL' : upBias === 'BEARISH' ? 'BEAR' : 'NEUTRAL';
              if (bias !== 'NEUTRAL' && upDir !== 'NEUTRAL' && bias !== upDir) {
                varsityMult = Math.max(0.20, varsityMult - 0.10);
              }
            }
            setup.baseScore = baseScore;
            setup.varsityMult = varsityMult;
            setup.varsityTier = getVarsityTierLabel(varsityMult);
            setup.compositeScore = +(baseScore * varsityMult).toFixed(2);
            if (varsityMult > 0) setups.push(setup);
          }
        }
      }
    }
  }
  setups.sort((a, b) => b.compositeScore - a.compositeScore);
  // Store nearest expiry DTE for range budget multi-day display
  if (nfMinDte < 99) window._NF_NEAREST_TRADING_DTE = nfMinDte;
  if (bnfMinDte < 99) window._BNF_NEAREST_TRADING_DTE = bnfMinDte;
  return setups;
}

function isStrategyAllowed(stratType, bias, vix) {
  if (valid(vix) && vix >= 28) return false;
  if (bias === 'BULL') return ['BULL_PUT','BULL_CALL','IRON_CONDOR','LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);
  if (bias === 'BEAR') return ['BEAR_CALL','BEAR_PUT','IRON_CONDOR','LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);
  return true;
}

function buildCandidates(stratType, chain, atm, spot, step, strikeKeys, isNF) {
  const s = chain.strikes, candidates = [];
  // ── Dynamic widths: let scoring engine find the optimal width ──
  const widths = isNF
    ? [100, 150, 200, 250, 300, 400]          // NF: 2-8 strike gaps (step=50)
    : [200, 300, 400, 500, 600, 800, 1000];   // BNF: 2-10 strike gaps (step=100)

  switch(stratType) {
    case 'BULL_PUT': {
      const otm = strikeKeys.filter(k => k < spot && k >= spot-(isNF?1000:3000) && s[k]&&s[k].PE&&s[k].PE.ltp>0);
      for (const sk of otm) { for (const w of widths) { const bk=sk-w; if (s[bk]&&s[bk].PE) candidates.push({width:w, legs:[{type:'PE',strike:sk,action:'SELL',data:s[sk].PE},{type:'PE',strike:bk,action:'BUY',data:s[bk].PE}]}); } }
      break;
    }
    case 'BEAR_CALL': {
      const otm = strikeKeys.filter(k => k > spot && k <= spot+(isNF?1000:3000) && s[k]&&s[k].CE&&s[k].CE.ltp>0);
      for (const sk of otm) { for (const w of widths) { const bk=sk+w; if (s[bk]&&s[bk].CE) candidates.push({width:w, legs:[{type:'CE',strike:sk,action:'SELL',data:s[sk].CE},{type:'CE',strike:bk,action:'BUY',data:s[bk].CE}]}); } }
      break;
    }
    case 'IRON_CONDOR': {
      const ps = strikeKeys.filter(k => k<spot-(isNF?100:300) && k>=spot-(isNF?800:2500) && s[k]&&s[k].PE&&s[k].PE.ltp>0);
      const cs = strikeKeys.filter(k => k>spot+(isNF?100:300) && k<=spot+(isNF?800:2500) && s[k]&&s[k].CE&&s[k].CE.ltp>0);
      for (const pk of ps.slice(-3)) { for (const ck of cs.slice(0,3)) { for (const w of widths) { const pb=pk-w, cb=ck+w; if (s[pb]&&s[pb].PE&&s[cb]&&s[cb].CE) candidates.push({width:w, legs:[{type:'CE',strike:ck,action:'SELL',data:s[ck].CE},{type:'CE',strike:cb,action:'BUY',data:s[cb].CE},{type:'PE',strike:pk,action:'SELL',data:s[pk].PE},{type:'PE',strike:pb,action:'BUY',data:s[pb].PE}]}); } } }
      break;
    }
    case 'BULL_CALL': {
      const bc = strikeKeys.filter(k => Math.abs(k-spot)<=(isNF?300:800) && s[k]&&s[k].CE&&s[k].CE.ltp>0);
      for (const bk of bc) { for (const w of widths) { const sk=bk+w; if (s[sk]&&s[sk].CE) candidates.push({width:w, legs:[{type:'CE',strike:bk,action:'BUY',data:s[bk].CE},{type:'CE',strike:sk,action:'SELL',data:s[sk].CE}]}); } }
      break;
    }
    case 'BEAR_PUT': {
      const bp = strikeKeys.filter(k => Math.abs(k-spot)<=(isNF?300:800) && s[k]&&s[k].PE&&s[k].PE.ltp>0);
      for (const bk of bp) { for (const w of widths) { const sk=bk-w; if (s[sk]&&s[sk].PE) candidates.push({width:w, legs:[{type:'PE',strike:bk,action:'BUY',data:s[bk].PE},{type:'PE',strike:sk,action:'SELL',data:s[sk].PE}]}); } }
      break;
    }
    case 'LONG_STRADDLE': {
      if (s[atm]&&s[atm].CE&&s[atm].PE&&s[atm].CE.ltp>0&&s[atm].PE.ltp>0) candidates.push({width:0, legs:[{type:'CE',strike:atm,action:'BUY',data:s[atm].CE},{type:'PE',strike:atm,action:'BUY',data:s[atm].PE}]});
      const au=atm+step; if (s[au]&&s[au].CE&&s[atm]&&s[atm].PE) candidates.push({width:0, legs:[{type:'CE',strike:au,action:'BUY',data:s[au].CE},{type:'PE',strike:atm,action:'BUY',data:s[atm].PE}]});
      break;
    }
    case 'LONG_STRANGLE': {
      const oc = strikeKeys.filter(k => k>spot+(isNF?100:300) && k<=spot+(isNF?500:1500) && s[k]&&s[k].CE&&s[k].CE.ltp>0);
      const op = strikeKeys.filter(k => k<spot-(isNF?100:300) && k>=spot-(isNF?500:1500) && s[k]&&s[k].PE&&s[k].PE.ltp>0);
      for (const ck of oc.slice(0,2)) { for (const pk of op.slice(-2)) candidates.push({width:0, legs:[{type:'CE',strike:ck,action:'BUY',data:s[ck].CE},{type:'PE',strike:pk,action:'BUY',data:s[pk].PE}]}); }
      break;
    }
  }
  return candidates.slice(0, 30);
}

function evaluateSetup(cand, stratType, indexKey, expiry, spot, dte, tradingDte, lotSize, marginPerLot, width, chain, vix) {
  const legs = cand.legs;
  const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(stratType);

  // Reject legs with ₹0 LTP — can't execute at zero
  for (const leg of legs) { if (leg.data.ltp <= 0 && leg.action === 'BUY') return null; }

  let netPremium = 0, netDelta = 0, netTheta = 0, netGamma = 0, netVega = 0;

  for (const leg of legs) {
    // Use bid for SELL (what you'll actually get), ask for BUY (what you'll actually pay)
    const execPrice = leg.action === 'SELL' ? (leg.data.bid || leg.data.ltp) : (leg.data.ask || leg.data.ltp);
    const premMult = leg.action === 'SELL' ? 1 : -1;
    netPremium += premMult * execPrice;
    const gMult = leg.action === 'SELL' ? -1 : 1;
    if (leg.data.delta != null) netDelta += gMult * leg.data.delta;
    if (leg.data.theta != null) netTheta += gMult * leg.data.theta;
    if (leg.data.gamma != null) netGamma += gMult * leg.data.gamma;
    if (leg.data.vega  != null) netVega  += gMult * leg.data.vega;
  }

  if (isCredit && netPremium <= 0) return null;
  if (!isCredit && netPremium >= 0) return null;

  const absPremium = Math.abs(netPremium);
  let maxProfit, maxLoss, breakevens = [];
  const safeLots = 1; // Fixed 1 lot until confidence grows

  if (stratType === 'BULL_PUT') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    breakevens = [legs[0].strike - netPremium];
  } else if (stratType === 'BEAR_CALL') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    breakevens = [legs[0].strike + netPremium];
  } else if (stratType === 'IRON_CONDOR') {
    maxProfit = netPremium * lotSize * safeLots;
    maxLoss = (width - netPremium) * lotSize * safeLots;
    const callSell = legs.find(l => l.type === 'CE' && l.action === 'SELL');
    const putSell = legs.find(l => l.type === 'PE' && l.action === 'SELL');
    breakevens = [putSell.strike - netPremium, callSell.strike + netPremium];
  } else if (stratType === 'BULL_CALL') {
    maxProfit = (width - absPremium) * lotSize * safeLots;
    maxLoss = absPremium * lotSize * safeLots;
    breakevens = [legs[0].strike + absPremium];
  } else if (stratType === 'BEAR_PUT') {
    maxProfit = (width - absPremium) * lotSize * safeLots;
    maxLoss = absPremium * lotSize * safeLots;
    breakevens = [legs[0].strike - absPremium];
  } else if (stratType === 'LONG_STRADDLE' || stratType === 'LONG_STRANGLE') {
    maxLoss = absPremium * lotSize * safeLots;
    const em = bsExpectedMove(spot, vix || 14, tradingDte);
    maxProfit = Math.max(0, (em.two_sigma - absPremium) * lotSize * safeLots);
    if (stratType === 'LONG_STRADDLE') {
      breakevens = [legs[0].strike - absPremium, legs[0].strike + absPremium];
    } else {
      const putK = legs.find(l => l.type === 'PE').strike;
      const callK = legs.find(l => l.type === 'CE').strike;
      breakevens = [putK - absPremium, callK + absPremium];
    }
  }

  // ── REJECT: credit > width (negative max loss = impossible) ──
  if (maxLoss <= 0) return null;

  // ── REJECT: max loss > CAPITAL ──
  if (maxLoss > CAPITAL) return null;

  const rr = maxProfit / Math.max(maxLoss, 1);

  // ── Probability calculation (needed before filter) ──
  let probProfit = 0.50;
  if (isCredit) {
    const soldLeg = legs.find(l => l.action === 'SELL');
    if (soldLeg && soldLeg.data.delta != null) probProfit = 1 - Math.abs(soldLeg.data.delta);
  } else if (stratType === 'LONG_STRADDLE' || stratType === 'LONG_STRANGLE') {
    const em = bsExpectedMove(spot, vix || 14, tradingDte);
    const beDist = Math.abs(breakevens[1] - spot);
    const beRatio = beDist / em.one_sigma;
    probProfit = beRatio < 0.8 ? 0.50 : beRatio < 1.0 ? 0.38 : beRatio < 1.2 ? 0.28 : 0.18;
  } else {
    const buyLeg = legs.find(l => l.action === 'BUY');
    if (buyLeg && buyLeg.data.delta != null) probProfit = Math.abs(buyLeg.data.delta);
  }

  // ── IV EDGE: when VIX is elevated, options are overpriced ──
  // Delta-based probability uses IMPLIED vol (elevated).
  // REALIZED vol is typically lower → actual P(Profit) for credit sellers is HIGHER.
  // This is the structural edge Varsity teaches: sell expensive premium.
  const safeVix = vix || 14;
  if (isCredit && safeVix >= 18) {
    const ivEdge = Math.min(0.10, (safeVix - 16) * 0.015); // 1.5% per VIX point above 16, max 10%
    probProfit = Math.min(0.95, probProfit + ivEdge);
  }

  // ── EV calculation (needed before filter) ──
  const ev = (probProfit * maxProfit) - ((1 - probProfit) * maxLoss);

  // ── SPLIT FILTER: credit vs debit ──
  if (isCredit) {
    // Credit spreads: small profit, large risk — high probability is the edge.
    // Delta-based EV underestimates true win rate when IV is elevated
    // (options are overpriced → realized vol < implied vol → more profits expire OTM).
    // Filter by probability + minimum EV threshold (not strict EV>0).
    if (probProfit < 0.50) return null;   // Need >50% win rate — must be better than coin flip
    if (ev < -(maxProfit * 0.5)) return null; // Allow slightly negative mathematical EV — theta/IV crush compensate
  } else {
    // Debit spreads/straddles/strangles: R:R must justify the premium spent
    if (rr < 1.5) return null;
  }

  // ── RANGE BUDGET FILTER: debit spreads only ──
  // Width must not exceed remaining 1σ move in trade direction
  // This prevents recommending W:400 Bull Call when only 139 pts of upside remain
  if ((stratType === 'BULL_CALL' || stratType === 'BEAR_PUT') && width > 0) {
    const dailyEM = bsExpectedMove(spot, vix || 14, Math.max(1, tradingDte));
    const sigma1 = dailyEM.one_sigma;
    const isNFIdx = indexKey === 'NF';
    const prevClose = isNFIdx ? (gv('nifty_prev') || window._NF_PREV_CLOSE || spot) : (window._BNF_PREV_CLOSE || spot);
    const moveFromClose = spot - prevClose; // Positive = up, negative = down

    let remainingRange;
    if (stratType === 'BULL_CALL') {
      // Bull needs upside: 1σ ceiling minus what's already consumed upward
      remainingRange = Math.max(0, sigma1 - Math.max(0, moveFromClose));
    } else {
      // Bear needs downside: 1σ floor minus what's already consumed downward
      remainingRange = Math.max(0, sigma1 - Math.max(0, -moveFromClose));
    }

    if (width > remainingRange * 1.2) return null; // 20% tolerance buffer
  }

  // ── Target / Stop Loss ──
  let targetProfit, stopLoss;
  if (isCredit) {
    // Credit: target = 50% of max profit (exit early, don't hold to expiry)
    // SL = 1× credit received (risk the same as you collected)
    targetProfit = maxProfit * 0.50;
    stopLoss = maxProfit * 1.0;
  } else {
    // Debit: target = 50% of max profit, SL = 50% of max loss
    targetProfit = maxProfit * 0.50;
    stopLoss = maxLoss * 0.50;
  }

  let totalSpread = 0, spreadLegs = 0;
  for (const leg of legs) { if (leg.data.bid && leg.data.ask && leg.data.ask > 0) { totalSpread += (leg.data.ask - leg.data.bid) / leg.data.ask; spreadLegs++; } }
  const avgSpreadPct = spreadLegs > 0 ? totalSpread / spreadLegs : 0.05;
  const creditRatio = isCredit ? netPremium / width : null;
  if (isCredit && creditRatio < 0.05) return null;
  if (!isCredit && stratType !== 'LONG_STRADDLE' && stratType !== 'LONG_STRANGLE' && absPremium > width * 0.85) return null;

  const marginUsed = marginPerLot * safeLots;
  // EV per rupee of ACTUAL RISK, not margin.
  // Credit spreads use high margin (SPAN) for small profit — margin ≠ risk.
  // Debit spreads margin ≈ maxLoss anyway (premium paid).
  // Using maxLoss normalizes both to "EV per rupee you can actually lose."
  const evPerRupee = ev / Math.max(maxLoss, 1);

  return {
    stratType, stratLabel: STRAT_LABELS[stratType], indexKey, isNF: indexKey === 'NF', expiry, dte, tradingDte, spot, legs,
    netPremium: +netPremium.toFixed(2), isCredit,
    maxProfit: +maxProfit.toFixed(0), maxLoss: +maxLoss.toFixed(0),
    rr: +rr.toFixed(2), probProfit: +(probProfit * 100).toFixed(1),
    breakevens: breakevens.map(b => +b.toFixed(0)),
    netDelta: +netDelta.toFixed(4), netTheta: +netTheta.toFixed(2), netGamma: +netGamma.toFixed(4), netVega: +netVega.toFixed(2),
    lots: safeLots, lotSize, width, creditRatio,
    avgSpreadPct: +(avgSpreadPct * 100).toFixed(1),
    ev: +ev.toFixed(0), evPerRupee: +evPerRupee.toFixed(4), marginUsed,
    targetProfit: +targetProfit.toFixed(0), stopLoss: +stopLoss.toFixed(0),
    viable: true
  };
}

// ═══════════════════════════════════════════════════
// PROBABILITY-FIRST SCORING (Varsity principle)
// With ₹1.1L capital, survivability > maximum EV.
// 75% win rate × ₹1,500 beats 40% win rate × ₹12,000
// because you can't survive 12 losses out of 20.
// ═══════════════════════════════════════════════════

function scoreSetup(setup, bias, vix, chain) {
  // Probability: max 35 pts (was 20). THE dominant factor.
  // 78% credit spread scores 27.3. 42% debit spread scores 14.7. Gap = 12.6 pts.
  const probScore = (setup.probProfit / 100) * 35;

  // EV per rupee of risk: max 25 pts (was 40). Still important but not dominant.
  const evScore = Math.max(0, Math.min(25, setup.evPerRupee * 250));

  // Capital efficiency: profit potential per rupee of actual risk
  const capEff = setup.maxProfit / Math.max(setup.maxLoss, 1);
  const capScore = Math.min(10, capEff * 50);
  const liqScore = Math.max(0, 5 - setup.avgSpreadPct);
  const pcr = chain.pcr || 0;
  const dirScore = Math.min(5, Math.abs(pcr - 1.0) * 5);
  const atmIV = chain.atmIV || 0, liveVix = vix || 14;
  let ivScore = 0;
  if (atmIV > 0 && setup.isCredit && atmIV > liveVix * 1.05) ivScore = 3;
  else if (atmIV > 0 && !setup.isCredit && atmIV < liveVix * 0.95) ivScore = 3;
  const dteScore = dteConviction(setup.dte) === 'SWEET SPOT' ? 2 : dteConviction(setup.dte) === 'ACCEPTABLE' ? 1 : 0;
  return +(evScore + probScore + capScore + liqScore + dirScore + ivScore + dteScore).toFixed(2);
}

// ═══════════════════════════════════════════════════
// VARSITY FRAMEWORK — Strategy-Bias Multiplier
// Zerodha Varsity: bias determines which strategies
// are PRIMARY, SECONDARY, or MARGINAL. EV only ranks
// within the appropriate tier.
// ═══════════════════════════════════════════════════

function getVarsityMultiplier(stratType, biasConf, bias, vix) {
  // Build outlook from bias + confidence
  const outlook = bias === 'NEUTRAL' ? 'NEUTRAL' :
    (biasConf === 'Strong' ? 'STRONG_' : 'MILD_') + bias;

  // Tier multipliers: 1.0 = primary, 0.65 = secondary, 0.35 = marginal
  const tiers = {
    STRONG_BULL: { BULL_CALL:1.0, BULL_PUT:0.65, IRON_CONDOR:0.35, LONG_STRADDLE:0.35, LONG_STRANGLE:0.35 },
    MILD_BULL:   { BULL_PUT:1.0,  BULL_CALL:0.65, IRON_CONDOR:0.65, LONG_STRADDLE:0.35, LONG_STRANGLE:0.35 },
    NEUTRAL:     { IRON_CONDOR:1.0, LONG_STRADDLE:0.70, LONG_STRANGLE:0.70, BULL_PUT:0.50, BEAR_CALL:0.50, BULL_CALL:0.45, BEAR_PUT:0.45 },
    MILD_BEAR:   { BEAR_CALL:1.0, BEAR_PUT:0.65, IRON_CONDOR:0.65, LONG_STRADDLE:0.35, LONG_STRANGLE:0.35 },
    STRONG_BEAR: { BEAR_PUT:1.0,  BEAR_CALL:0.65, IRON_CONDOR:0.35, LONG_STRADDLE:0.35, LONG_STRANGLE:0.35 }
  };

  const tierMap = tiers[outlook] || tiers.NEUTRAL;
  let mult = tierMap[stratType] !== undefined ? tierMap[stratType] : 0.35;

  // ── IV-AWARE TIER ADJUSTMENT (Varsity principle) ──
  // Core: HIGH IV → premium expensive → SELL it (credit preferred)
  //       LOW IV  → premium cheap    → BUY it (debit preferred for directional)
  // This is NOT a small nudge — it's a tier-changing force.
  const safeVix = vix || 14;
  const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(stratType);
  const isDebit = ['BULL_CALL','BEAR_PUT'].includes(stratType);
  const isLong = ['LONG_STRADDLE','LONG_STRANGLE'].includes(stratType);

  // HIGH VIX (≥20): Selling premium is the edge. Buying premium is expensive + IV crush risk.
  if (safeVix >= 20) {
    if (isCredit) mult = Math.min(1.0, mult + 0.15);
    if (isDebit) mult = Math.max(0.20, mult - 0.25);
  }
  // VERY HIGH VIX (≥24): Even stronger shift to credit
  if (safeVix >= 24) {
    if (isCredit) mult = Math.min(1.0, mult + 0.10);
    if (isDebit) mult = Math.max(0.20, mult - 0.10);
  }

  // LOW VIX (≤15): Premiums are cheap — debit directional trades get boosted
  if (safeVix <= 15 && isDebit) {
    mult = Math.min(1.0, mult + 0.15);
  }

  // Long straddle/strangle: cheap = good, expensive = bad
  if (safeVix <= 13 && isLong) mult = Math.min(1.0, mult + 0.10);
  if (safeVix >= 20 && isLong) mult = Math.max(0.20, mult - 0.10);

  return mult;
}

function getVarsityTierLabel(mult) {
  if (mult >= 0.95) return '★ Primary';
  if (mult >= 0.60) return '◆ Secondary';
  return '○ Marginal';
}

// ═══════════════════════════════════════════════════
// FUTURES PREMIUM DISPLAY
// ═══════════════════════════════════════════════════

function renderFuturesPremium() {
  const el = document.getElementById('futures-premium-display');
  if (!el) return;
  const nfP = window._NF_FUTURES_PREMIUM;
  const bnfP = window._BNF_FUTURES_PREMIUM;
  const nfSynth = window._NF_FUTURES_LTP;
  const bnfSynth = window._BNF_FUTURES_LTP;
  const nfActual = window._NF_ACTUAL_FUTURES;
  const bnfActual = window._BNF_ACTUAL_FUTURES;
  if (nfP === null && bnfP === null && !nfActual && !bnfActual) { el.textContent = 'Fetch data to see futures premium'; return; }

  const nfSpot = gv('nf_price') || 0;
  const bnfSpot = gv('bn_price') || 0;
  const fmtP = (p) => p > 0 ? `+${p.toFixed(3)}%` : `${p.toFixed(3)}%`;
  const clsP = (p) => p > 0.05 ? 'profit' : p < -0.05 ? 'loss' : '';
  const signal = (p) => p > 0.05 ? '↑ Bull' : p < -0.05 ? '↓ Bear' : '→ Neutral';

  let html = '';
  // NF futures
  if (nfActual && nfSpot > 0) {
    const actPrem = ((nfActual - nfSpot) / nfSpot * 100);
    html += `<div>NF: <b>${nfActual.toLocaleString('en-IN')}</b> <span class="${clsP(actPrem)}" style="font-weight:700">(${fmtP(actPrem)})</span> <span style="opacity:0.6">${signal(actPrem)}</span></div>`;
    if (nfSynth) html += `<div style="font-size:10px;opacity:0.5;margin:-2px 0 2px">Synth: ${nfSynth.toLocaleString('en-IN')} (${nfP !== null ? fmtP(nfP) : '—'})</div>`;
  } else if (nfP !== null) {
    html += `<div>NF: ${nfSynth ? nfSynth.toLocaleString('en-IN') : '—'} <span class="${clsP(nfP)}" style="font-weight:700">(${fmtP(nfP)})</span> <span style="opacity:0.6">${signal(nfP)} · synth</span></div>`;
  }
  // BNF futures
  if (bnfActual && bnfSpot > 0) {
    const actPrem = ((bnfActual - bnfSpot) / bnfSpot * 100);
    html += `<div>BNF: <b>${bnfActual.toLocaleString('en-IN')}</b> <span class="${clsP(actPrem)}" style="font-weight:700">(${fmtP(actPrem)})</span> <span style="opacity:0.6">${signal(actPrem)}</span></div>`;
    if (bnfSynth) html += `<div style="font-size:10px;opacity:0.5;margin:-2px 0 2px">Synth: ${bnfSynth.toLocaleString('en-IN')} (${bnfP !== null ? fmtP(bnfP) : '—'})</div>`;
  } else if (bnfP !== null) {
    html += `<div>BNF: ${bnfSynth ? bnfSynth.toLocaleString('en-IN') : '—'} <span class="${clsP(bnfP)}" style="font-weight:700">(${fmtP(bnfP)})</span> <span style="opacity:0.6">${signal(bnfP)} · synth</span></div>`;
  }
  el.innerHTML = html;
}

function renderRangeBudget() {
  const el = document.getElementById('range-budget-display');
  if (!el) return;

  const nfSpot = gv('nf_price'), bnfSpot = gv('bn_price'), vix = gv('india_vix') || 14;
  const nfPrev = gv('nifty_prev');
  if (!nfSpot || !vix) { el.textContent = 'Fetch data to see range budget'; return; }

  let html = '';

  // NF range budget
  if (nfSpot && nfPrev) {
    const nfEM = bsExpectedMove(nfSpot, vix, 1); // 1 trading day
    const sigma1 = nfEM.one_sigma;
    const sigma2 = nfEM.two_sigma;
    const moveUp = Math.max(0, nfSpot - nfPrev);
    const moveDown = Math.max(0, nfPrev - nfSpot);
    const upRemain = Math.max(0, sigma1 - moveUp);
    const downRemain = Math.max(0, sigma1 - moveDown);
    const up2Remain = Math.max(0, sigma2 - moveUp);
    const dn2Remain = Math.max(0, sigma2 - moveDown);
    const consumedPct = Math.round(Math.max(moveUp, moveDown) / sigma1 * 100);
    const upColor = upRemain < 100 ? 'loss' : upRemain < 200 ? '' : 'profit';
    const dnColor = downRemain < 100 ? 'loss' : downRemain < 200 ? '' : 'profit';
    html += `<div>NF 1σ: ${Math.round(sigma1)} pts · ↑<span class="${upColor}">${Math.round(upRemain)}</span> / ↓<span class="${dnColor}">${Math.round(downRemain)}</span> remaining`;
    html += ` <span style="opacity:0.5">(${consumedPct}% consumed ${moveUp > moveDown ? 'up' : 'down'})</span></div>`;
    html += `<div style="font-size:10px;opacity:0.6">NF 2σ: ${Math.round(sigma2)} pts · ↑${Math.round(up2Remain)} / ↓${Math.round(dn2Remain)} — 95% ceiling</div>`;
    // Multi-day context: show trade-duration expected move
    const nearExpDte = window._NF_NEAREST_TRADING_DTE || 5;
    if (nearExpDte > 1) {
      const multiEM = bsExpectedMove(nfSpot, vix, nearExpDte);
      const multiUpRemain = Math.max(0, multiEM.one_sigma - moveUp);
      const multiDnRemain = Math.max(0, multiEM.one_sigma - moveDown);
      html += `<div style="font-size:10px;color:#8b5cf6">NF ${nearExpDte}-day 1σ: ${Math.round(multiEM.one_sigma)} pts · ↑${Math.round(multiUpRemain)} / ↓${Math.round(multiDnRemain)} remaining — trade-duration view</div>`;
    }
  }

  // BNF range budget
  if (bnfSpot) {
    const bnfEM = bsExpectedMove(bnfSpot, vix, 1);
    const sigma1 = bnfEM.one_sigma;
    const sigma2 = bnfEM.two_sigma;
    // BNF prev close from chain or estimate
    const bnfPrev = window._BNF_PREV_CLOSE || 0;
    if (bnfPrev > 0) {
      const moveUp = Math.max(0, bnfSpot - bnfPrev);
      const moveDown = Math.max(0, bnfPrev - bnfSpot);
      const upRemain = Math.max(0, sigma1 - moveUp);
      const downRemain = Math.max(0, sigma1 - moveDown);
      const up2Remain = Math.max(0, sigma2 - moveUp);
      const dn2Remain = Math.max(0, sigma2 - moveDown);
      const consumedPct = Math.round(Math.max(moveUp, moveDown) / sigma1 * 100);
      const upColor = upRemain < 300 ? 'loss' : upRemain < 500 ? '' : 'profit';
      const dnColor = downRemain < 300 ? 'loss' : downRemain < 500 ? '' : 'profit';
      html += `<div>BNF 1σ: ${Math.round(sigma1)} pts · ↑<span class="${upColor}">${Math.round(upRemain)}</span> / ↓<span class="${dnColor}">${Math.round(downRemain)}</span> remaining`;
      html += ` <span style="opacity:0.5">(${consumedPct}% consumed ${moveUp > moveDown ? 'up' : 'down'})</span></div>`;
      html += `<div style="font-size:10px;opacity:0.6">BNF 2σ: ${Math.round(sigma2)} pts · ↑${Math.round(up2Remain)} / ↓${Math.round(dn2Remain)} — 95% ceiling</div>`;
      // Multi-day context
      const nearExpDte = window._BNF_NEAREST_TRADING_DTE || 5;
      if (nearExpDte > 1) {
        const multiEM = bsExpectedMove(bnfSpot, vix, nearExpDte);
        const multiUpRemain = Math.max(0, multiEM.one_sigma - moveUp);
        const multiDnRemain = Math.max(0, multiEM.one_sigma - moveDown);
        html += `<div style="font-size:10px;color:#8b5cf6">BNF ${nearExpDte}-day 1σ: ${Math.round(multiEM.one_sigma)} pts · ↑${Math.round(multiUpRemain)} / ↓${Math.round(multiDnRemain)} remaining — trade-duration view</div>`;
      }
    } else {
      html += `<div>BNF 1σ: ${Math.round(sigma1)} pts <span style="opacity:0.5">(no prev close for budget)</span></div>`;
    }
  }

  el.innerHTML = html || 'Fetch data to see range budget';
}

// ═══════════════════════════════════════════════════
// COMMAND TAB RENDER
// ═══════════════════════════════════════════════════

async function buildCommand() {
  const panel = document.getElementById('command-output'); if (!panel) return;
  renderFuturesPremium();
  renderRangeBudget();
  const vix = gv('india_vix') || gv('strat_vix');
  const hasChains = (Object.keys(window._CHAINS.NF).length + Object.keys(window._CHAINS.BNF).length) > 0;
  if (!hasChains) { panel.innerHTML = '<div class="cmd-placeholder">Fetch Upstox data to see strategy recommendations</div>'; return; }
  const q1 = computeDirectionalBias();
  const ranked = evaluateAllStrategies(q1.bias, vix, q1.biasConf);
  _RANKED_SETUPS = ranked;
  if (valid(vix) && vix >= 28) { panel.innerHTML = `<div class="gonogo nogo"><div class="gonogo-label">🚫 AVOID ALL</div><div class="gonogo-reason">VIX ≥ 28</div></div>${renderQ1Card(q1)}`; return; }

  // Show loading while checking margins
  panel.innerHTML = '<div class="cmd-placeholder">Checking margins for top strategies...</div>';

  // Split by index: top 10 NF + top 10 BNF for margin checks
  const availMargin = window._AVAILABLE_MARGIN || CAPITAL;
  const nfRanked = ranked.filter(s => s.indexKey === 'NF').slice(0, 10);
  const bnfRanked = ranked.filter(s => s.indexKey === 'BNF').slice(0, 10);
  const toCheck = [...nfRanked, ...bnfRanked];

  for (const setup of toCheck) {
    const marginResult = typeof upstoxCheckMargin === 'function' ? await upstoxCheckMargin(setup.legs, setup.lotSize) : null;
    if (marginResult && marginResult.ok && marginResult.required > 0) {
      setup.requiredMargin = marginResult.required;
      setup.marginOk = marginResult.required <= availMargin;
    } else {
      // Conservative fallback when API fails (SPAN ≈ width × lotSize × multiplier)
      const isIC = setup.stratType === 'IRON_CONDOR';
      const isCredit = setup.isCredit;
      if (isIC) {
        setup.requiredMargin = setup.width * setup.lotSize * 9;
      } else if (isCredit) {
        setup.requiredMargin = setup.width * setup.lotSize * 6;
      } else {
        // Debit strategies: margin = premium paid + buffer
        setup.requiredMargin = setup.maxLoss * 1.5;
      }
      setup.marginOk = setup.requiredMargin <= availMargin;
    }
  }

  // Pick top 5 per index (max 3 same strategy type)
  function pickTop5(arr) {
    const shown = [], typeCounts = {};
    for (const s of arr) {
      if (shown.length >= 5) break;
      typeCounts[s.stratType] = (typeCounts[s.stratType] || 0) + 1;
      if (typeCounts[s.stratType] > 3) continue;
      shown.push(s);
    }
    return shown;
  }

  const nfAffordable = pickTop5(nfRanked.filter(s => s.marginOk));
  const bnfAffordable = pickTop5(bnfRanked.filter(s => s.marginOk));
  const totalAffordable = nfAffordable.length + bnfAffordable.length;

  let html = '';
  const isGo = totalAffordable > 0;
  html += `<div class="gonogo ${isGo?'go':'nogo'}"><div class="gonogo-label">${isGo?'✅ GO':'🚫 NO-GO'}</div><div class="gonogo-strategy">${isGo?`${totalAffordable} executable (of ${ranked.length} viable)`:'No setups fit margin ₹'+availMargin.toLocaleString('en-IN')}</div><div class="gonogo-meta">VIX: ${vix||'—'} | Bias: ${q1.biasConf} ${q1.bias}</div></div>`;
  html += renderQ1Card(q1);

  // Collect all shown setups in order for drawer click binding
  const allShown = [];

  // ── NIFTY 50 section ──
  if (nfAffordable.length > 0) {
    html += '<div class="section-title">NIFTY 50 — Top 5</div>';
    nfAffordable.forEach((s, i) => { html += renderStrategyCard(s, i); allShown.push(s); });
  } else if (Object.keys(window._CHAINS.NF).length > 0) {
    html += '<div class="section-title">NIFTY 50 — Top 5</div>';
    html += '<div class="cmd-placeholder">No NF setups pass margin / R:R filters</div>';
  }

  // ── BANK NIFTY section ──
  if (bnfAffordable.length > 0) {
    html += '<div class="section-title">BANK NIFTY — Top 5</div>';
    bnfAffordable.forEach((s, i) => { html += renderStrategyCard(s, i); allShown.push(s); });
  } else if (Object.keys(window._CHAINS.BNF).length > 0) {
    html += '<div class="section-title">BANK NIFTY — Top 5</div>';
    html += '<div class="cmd-placeholder">No BNF setups pass margin / R:R filters</div>';
  }

  _RANKED_SETUPS = allShown;
  panel.innerHTML = html;
  document.querySelectorAll('.strat-card').forEach((card, i) => { card.addEventListener('click', () => openDrawer(_RANKED_SETUPS[i])); });
  // Q1 card expand/collapse toggle
  const q1Toggle = document.getElementById('q1-toggle');
  if (q1Toggle) q1Toggle.addEventListener('click', () => {
    _Q1_EXPANDED = !_Q1_EXPANDED;
    const body = document.getElementById('q1-body');
    const expand = q1Toggle.querySelector('.q-expand');
    if (body) body.style.display = _Q1_EXPANDED ? 'block' : 'none';
    if (expand) expand.textContent = _Q1_EXPANDED ? '▲' : '▼';
  });
}

function renderQ1Card(q1) {
  const arrow = _Q1_EXPANDED ? '▲' : '▼';
  const biasClass = q1.bias.toLowerCase();

  let html = `<div class="q-card" id="q1-card">`;
  // Collapsed header — always visible
  html += `<div class="q-header" id="q1-toggle">`;
  html += `<div class="q-title">Q1: Directional Bias → <span class="bias-${biasClass}">${q1.biasConf} ${q1.bias}</span></div>`;
  html += `<div class="q-summary-inline">Bull: ${q1.bullCount} | Bear: ${q1.bearCount} | Net: ${q1.net > 0 ? '+' : ''}${q1.net} <span class="q-expand">${arrow}</span></div>`;

  // ── Upstox Consensus Badge ──
  const upstoxBias = (document.getElementById('upstox_bias') || {}).value || '';
  if (upstoxBias) {
    const ourDir = q1.bias; // BULL, BEAR, NEUTRAL
    const upDir = upstoxBias === 'BULLISH' ? 'BULL' : upstoxBias === 'BEARISH' ? 'BEAR' : 'NEUTRAL';
    const agrees = (ourDir === upDir) || (ourDir === 'NEUTRAL') || (upDir === 'NEUTRAL');
    const badge = agrees
      ? `<span style="color:#22c55e;font-size:11px">✅ Upstox: Agrees (${upstoxBias.toLowerCase()})</span>`
      : `<span style="color:#ef4444;font-size:11px">⚠️ Upstox: ${upstoxBias} — DISAGREES</span>`;
    html += `<div style="padding:2px 0 0">${badge}</div>`;
  }

  // ── Key Support OI display ──
  const keySupportOI = (document.getElementById('key_support_oi') || {}).value || '';
  if (keySupportOI) {
    html += `<div style="padding:2px 0;font-size:11px;color:var(--text-dim)">🛡️ Key Support: ${keySupportOI}</div>`;
  }

  html += `</div>`;

  // Expandable body
  html += `<div class="q-body" style="display:${_Q1_EXPANDED ? 'block' : 'none'}" id="q1-body">`;

  // Bias signals (Q1)
  html += `<div class="q-section-label">Bias Signals (${q1.signals.length})</div>`;
  html += `<div class="q-signals">`;
  for (const s of q1.signals) {
    html += `<div class="signal-row"><span class="signal-name">${s.name}</span><span class="signal-vote vote-${s.vote.toLowerCase()}">${s.vote}</span><span class="signal-val">${s.val}</span></div>`;
  }
  html += `</div>`;

  // CalcScore breakdown (weighted signals)
  if (_CALC_SCORE_DETAILS && _CALC_SCORE_DETAILS.details.length > 0) {
    html += `<div class="q-section-label" style="margin-top:10px">Weighted Score Breakdown</div>`;
    html += `<div class="q-score-table">`;
    html += `<div class="q-score-hdr"><span>Signal</span><span>Raw</span><span>Wt</span><span>S</span><span>Contrib</span></div>`;
    for (const d of _CALC_SCORE_DETAILS.details) {
      const contribCls = d.contrib > 0 ? 'profit' : d.contrib < 0 ? 'loss' : '';
      html += `<div class="q-score-row"><span>${d.label}</span><span>${d.raw}</span><span>${(d.weight * 100).toFixed(0)}%</span><span>${d.signal > 0 ? '+' : ''}${d.signal}</span><span class="${contribCls}">${d.contrib > 0 ? '+' : ''}${d.contrib.toFixed(4)}</span></div>`;
    }
    html += `<div class="q-score-total"><span>Composite</span><span colspan="3"></span><span>${SCORE > 0 ? '+' : ''}${SCORE.toFixed(4)}</span></div>`;
    html += `</div>`;
  }

  // Session trajectory (institutional memory)
  html += renderTrajectory();

  html += `</div>`; // q-body
  html += `</div>`; // q-card
  return html;
}

function renderStrategyCard(setup, index) {
  const legStr = setup.legs.map(l => {
    const price = l.action === 'SELL' ? (l.data.bid || l.data.ltp) : (l.data.ask || l.data.ltp);
    return `${l.action} ${l.strike} ${l.type} (${moneyLabel(l.strike, setup.spot, l.type)}) @₹${price.toFixed(0)}`;
  }).join(' | ');
  const tierColor = setup.varsityMult >= 0.95 ? '#22c55e' : setup.varsityMult >= 0.60 ? '#8b5cf6' : '#8a8a9a';
  return `<div class="strat-card" data-idx="${index}">
    <div class="sc-rank">#${index+1}</div>
    <div class="sc-header"><div class="sc-name">${setup.stratLabel} <span style="font-size:10px;color:${tierColor};margin-left:6px">${setup.varsityTier || ''}</span></div><div class="sc-index">${setup.indexKey} · ${setup.expiry} · DTE ${setup.dte} (${setup.tradingDte}T)</div></div>
    <div class="sc-legs">${legStr}</div>
    <div class="sc-metrics">
      <div class="sc-metric"><span class="sc-label">Max Profit</span><span class="sc-val profit">₹${setup.maxProfit.toLocaleString('en-IN')}</span></div>
      <div class="sc-metric"><span class="sc-label">Max Loss</span><span class="sc-val loss">₹${setup.maxLoss.toLocaleString('en-IN')}</span></div>
      <div class="sc-metric"><span class="sc-label">R:R</span><span class="sc-val">1:${setup.rr}</span></div>
      <div class="sc-metric"><span class="sc-label">P(Profit)</span><span class="sc-val">${setup.probProfit}%</span></div>
    </div>
    <div class="sc-targets">🎯 Target: ₹${setup.targetProfit.toLocaleString('en-IN')} | 🛑 SL: ₹${setup.stopLoss.toLocaleString('en-IN')}</div>
    <div class="sc-greeks">Δ ${setup.netDelta.toFixed(4)} · θ ${setup.netTheta.toFixed(2)} · γ ${setup.netGamma.toFixed(4)} · ν ${setup.netVega.toFixed(2)}</div>
    <div class="sc-score">EV: ₹${setup.ev.toLocaleString('en-IN')} | Score: ${setup.compositeScore}${setup.width ? ' | W:'+setup.width : ''}${setup.requiredMargin ? ' | Margin: ₹'+Math.round(setup.requiredMargin).toLocaleString('en-IN') : ''}</div>
    <div class="sc-tap">Tap for payoff chart ▾</div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// BOTTOM DRAWER
// ═══════════════════════════════════════════════════

let _drawerOpen = false, _drawerSetup = null;
function openDrawer(setup) {
  if (!setup) return; _drawerOpen = true; _drawerSetup = setup;
  const drawer = document.getElementById('payoff-drawer'), backdrop = document.getElementById('drawer-backdrop');
  if (!drawer || !backdrop) return;
  document.getElementById('drawer-title').textContent = `${setup.stratLabel} — ${setup.indexKey} ${setup.expiry}`;
  drawPayoffChart(setup);
  document.getElementById('drawer-metrics').innerHTML = `
    <div class="dm-row"><span>Delta</span><span>${setup.netDelta.toFixed(4)}</span></div>
    <div class="dm-row"><span>Theta</span><span>${setup.netTheta.toFixed(2)}</span></div>
    <div class="dm-row"><span>Gamma</span><span>${setup.netGamma.toFixed(4)}</span></div>
    <div class="dm-row"><span>Vega</span><span>${setup.netVega.toFixed(2)}</span></div>
    <div class="dm-divider"></div>
    <div class="dm-row"><span>Max Profit</span><span class="profit">₹${setup.maxProfit.toLocaleString('en-IN')}</span></div>
    <div class="dm-row"><span>Max Loss</span><span class="loss">₹${setup.maxLoss.toLocaleString('en-IN')}</span></div>
    <div class="dm-row"><span>🎯 Target Profit</span><span class="profit">₹${setup.targetProfit.toLocaleString('en-IN')}</span></div>
    <div class="dm-row"><span>🛑 Stop Loss</span><span class="loss">₹${setup.stopLoss.toLocaleString('en-IN')}</span></div>
    <div class="dm-divider"></div>
    <div class="dm-row"><span>P(Profit)</span><span>${setup.probProfit}%</span></div>
    <div class="dm-row"><span>R:R Ratio</span><span>1:${setup.rr}</span></div>
    <div class="dm-row"><span>Expected Value</span><span>${setup.ev>=0?'+':''}₹${setup.ev.toLocaleString('en-IN')}</span></div>
    <div class="dm-row"><span>Breakeven${setup.breakevens.length>1?'s':''}</span><span>${setup.breakevens.join(' / ')}</span></div>
    <div class="dm-row"><span>DTE</span><span>${setup.dte} cal / ${setup.tradingDte} trading (${dteConviction(setup.dte)})</span></div>
    <div class="dm-row"><span>Lots</span><span>${setup.lots}</span></div>
    ${setup.width ? `<div class="dm-row"><span>Spread Width</span><span>${setup.width} pts</span></div>` : ''}
    <div class="dm-row"><span>${setup.isCredit?'Net Credit':'Net Debit'}</span><span>₹${Math.abs(setup.netPremium).toFixed(2)}</span></div>
    <div class="dm-row"><span>Spread %</span><span>${setup.avgSpreadPct}%</span></div>
    <div class="dm-row"><span>Varsity Tier</span><span>${setup.varsityTier || '—'} (×${(setup.varsityMult||0).toFixed(2)})</span></div>
    ${setup.requiredMargin ? `<div class="dm-row"><span>Required Margin</span><span>₹${Math.round(setup.requiredMargin).toLocaleString('en-IN')}</span></div>` : ''}
    <div class="dm-divider"></div>
    <div class="dm-legs-title">Legs (execution prices)</div>
    ${setup.legs.map(l => {
      const price = l.action === 'SELL' ? (l.data.bid || l.data.ltp) : (l.data.ask || l.data.ltp);
      const tag = l.action === 'SELL' ? 'bid' : 'ask';
      return `<div class="dm-leg">${l.action} ${setup.indexKey} ${setup.expiry} ${l.strike} ${l.type} <span style="opacity:0.6">(${moneyLabel(l.strike, setup.spot, l.type)})</span> @ ₹${price.toFixed(2)} <span style="opacity:0.4">${tag}</span></div>`;
    }).join('')}
    <div class="dm-divider"></div>
    <button class="btn btn-execute-uplink" id="btn-execute-uplink">🚀 EXECUTE IN UPSTOX</button>
    <button class="btn btn-log-trade" id="btn-log-trade">📌 I TOOK THIS TRADE</button>
    <div id="log-trade-status" class="log-trade-status"></div>
  `;
  // Bind buttons
  const uplinkBtn = document.getElementById('btn-execute-uplink');
  if (uplinkBtn) uplinkBtn.addEventListener('click', () => executeViaUplink(_drawerSetup));
  const logBtn = document.getElementById('btn-log-trade');
  if (logBtn) logBtn.addEventListener('click', () => logTradeFromCommand(_drawerSetup));
  backdrop.classList.add('show'); drawer.classList.add('show');
}
function closeDrawer() { _drawerOpen = false; _drawerSetup = null; const d = document.getElementById('payoff-drawer'), b = document.getElementById('drawer-backdrop'); if (d) d.classList.remove('show'); if (b) b.classList.remove('show'); }

// ═══════════════════════════════════════════════════
// UPLINK BUSINESS — Execute in Upstox
// Builds order from strategy legs, POSTs to UpLink.
// User reviews and places order in Upstox.
// NO auto-placement — user must confirm in Upstox.
// ═══════════════════════════════════════════════════

function executeViaUplink(setup) {
  if (!setup || !setup.legs || !setup.legs.length) return;
  const statusEl = document.getElementById('log-trade-status');

  // Validate instrument keys exist on all legs
  const missingKeys = setup.legs.filter(l => !l.data || !l.data.instrument_key);
  if (missingKeys.length > 0) {
    if (statusEl) statusEl.textContent = '❌ Missing instrument keys — fetch fresh chain data first';
    return;
  }

  // Get access token
  const token = localStorage.getItem('upstox_access_token');
  if (!token) {
    if (statusEl) statusEl.textContent = '❌ No Upstox token — login first';
    return;
  }

  // Build order array for UpLink
  const lotSize = setup.lotSize || (setup.indexKey === 'NF' ? NF_LOT_SIZE : BNF_LOT);
  const orders = setup.legs.map(leg => ({
    quantity: lotSize,
    product: 'D',  // NRML (delivery) for F&O spreads
    validity: 'DAY',
    price: 0,
    instrument_token: leg.data.instrument_key,
    order_type: 'MARKET',
    transaction_type: leg.action, // BUY or SELL
    disclosed_quantity: 0,
    is_amo: false
  }));

  // Confirmation
  const stratName = setup.stratLabel || setup.stratType;
  const legStr = setup.legs.map(l => {
    const price = l.action === 'SELL' ? (l.data.bid || l.data.ltp) : (l.data.ask || l.data.ltp);
    return `${l.action} ${l.strike} ${l.type} @₹${price.toFixed(0)}`;
  }).join('\n');
  const marginStr = setup.requiredMargin ? `\nMargin: ₹${Math.round(setup.requiredMargin).toLocaleString('en-IN')}` : '';

  if (!confirm(`Execute in Upstox?\n\n${stratName} — ${setup.indexKey} ${setup.expiry}\n${legStr}\nQty: ${lotSize} per leg${marginStr}\n\nUpstox will open for your review before placing.`)) return;

  if (statusEl) statusEl.textContent = 'Opening Upstox...';

  // Create hidden form and POST to UpLink
  const redirectUrl = 'https://vivekashokan007-cloud.github.io/MarketVivi/';

  // Remove existing form if any
  const existing = document.getElementById('uplink-form');
  if (existing) existing.remove();

  const form = document.createElement('form');
  form.id = 'uplink-form';
  form.method = 'POST';
  form.action = 'https://api.upstox.com/v2/uplink/order/place';
  form.target = '_blank'; // Open in new tab so Market Radar stays open

  const tokenInput = document.createElement('input');
  tokenInput.type = 'hidden'; tokenInput.name = 'access_token'; tokenInput.value = token;
  form.appendChild(tokenInput);

  const redirectInput = document.createElement('input');
  redirectInput.type = 'hidden'; redirectInput.name = 'redirect_url'; redirectInput.value = redirectUrl;
  form.appendChild(redirectInput);

  const dataInput = document.createElement('input');
  dataInput.type = 'hidden'; dataInput.name = 'data'; dataInput.value = JSON.stringify(orders);
  form.appendChild(dataInput);

  // Allow editing in Upstox (user can review/modify before placing)
  const editInput = document.createElement('input');
  editInput.type = 'hidden'; editInput.name = 'is_editable'; editInput.value = 'true';
  form.appendChild(editInput);

  document.body.appendChild(form);
  form.submit();

  // Clean up form after submission
  setTimeout(() => { const f = document.getElementById('uplink-form'); if (f) f.remove(); }, 2000);

  if (statusEl) statusEl.textContent = '✅ Upstox opened — review and place order there. Then come back and tap "I Took This Trade" to log.';
}

// ═══════════════════════════════════════════════════
// LOG TRADE FROM COMMAND — "I Took This Trade"
// Captures full market snapshot at entry time
// ═══════════════════════════════════════════════════

async function logTradeFromCommand(setup) {
  if (!setup) return;
  const statusEl = document.getElementById('log-trade-status');

  // Confirmation
  const stratName = setup.stratLabel || setup.stratType;
  const legStr = setup.legs.map(l => `${l.action} ${l.strike} ${l.type}`).join(' | ');
  if (!confirm(`Log trade?\n\n${stratName} — ${setup.indexKey} ${setup.expiry}\n${legStr}\n\nThis will start position tracking.`)) return;

  if (statusEl) statusEl.textContent = 'Logging trade...';

  try {
    // Build trade object with FULL snapshot
    const trade = {
      strategy_type: setup.stratType,
      index_key: setup.indexKey,
      expiry: setup.expiry,
      entry_spot: setup.spot,
      entry_vix: gv('india_vix') || window._LIVE_VIX || null,
      entry_premium: +Math.abs(setup.netPremium).toFixed(2),
      max_profit: setup.maxProfit,
      max_loss: setup.maxLoss,
      target_profit: setup.targetProfit,
      stop_loss: setup.stopLoss,
      lots: setup.lots || 1,

      // ── Legs ──
      leg1: null, leg2: null, leg3: null, leg4: null,

      // ── Rich entry snapshot ──
      entry_pcr: null,
      entry_max_pain: null,
      entry_sell_oi: null,
      entry_buy_oi: null,
      entry_call_wall: null,
      entry_put_wall: null,
      entry_total_call_oi: null,
      entry_total_put_oi: null,
      entry_atm_iv: null,
      entry_fii_cash: gv('fii') || null,
      entry_close_char: gv('close_char') || null,
      entry_futures_premium: (() => {
        const isBNF = setup.indexKey === 'BNF';
        const actFut = isBNF ? window._BNF_ACTUAL_FUTURES : window._NF_ACTUAL_FUTURES;
        const sp = setup.spot;
        if (actFut && sp > 0) return +((actFut - sp) / sp * 100).toFixed(3);
        return (isBNF ? window._BNF_FUTURES_PREMIUM : window._NF_FUTURES_PREMIUM) || null;
      })(),

      // ── Bias + Score snapshot ──
      entry_bias: null,
      entry_bias_net: null,
      entry_score: setup.compositeScore || null,
      entry_varsity_tier: setup.varsityTier || null
    };

    // Populate legs from setup
    for (let i = 0; i < Math.min(setup.legs.length, 4); i++) {
      const l = setup.legs[i];
      const price = l.action === 'SELL' ? (l.data.bid || l.data.ltp) : (l.data.ask || l.data.ltp);
      trade[`leg${i + 1}`] = {
        strike: l.strike,
        type: l.type,
        action: l.action,
        entry_ltp: +price.toFixed(2),
        qty: setup.lotSize || (setup.indexKey === 'NF' ? NF_LOT_SIZE : BNF_LOT)
      };
    }

    // Populate chain snapshot from _CHAINS
    const chain = window._CHAINS && window._CHAINS[setup.indexKey] && window._CHAINS[setup.indexKey][setup.expiry];
    if (chain) {
      trade.entry_pcr = chain.pcr || null;
      trade.entry_max_pain = chain.maxPain || null;
      trade.entry_call_wall = chain.callWall || null;
      trade.entry_put_wall = chain.putWall || null;
      trade.entry_total_call_oi = chain.callOI || null;
      trade.entry_total_put_oi = chain.putOI || null;
      trade.entry_atm_iv = chain.atmIV || null;

      // OI at sell strike(s)
      const sellLegs = setup.legs.filter(l => l.action === 'SELL');
      if (sellLegs.length > 0 && chain.strikes) {
        let totalSellOI = 0;
        for (const sl of sellLegs) {
          const sd = chain.strikes[sl.strike];
          if (sd && sd[sl.type]) totalSellOI += sd[sl.type].oi || 0;
        }
        trade.entry_sell_oi = totalSellOI;
      }

      // OI at buy strike(s) — for adversarial Control Index
      const buyLegs = setup.legs.filter(l => l.action === 'BUY');
      if (buyLegs.length > 0 && chain.strikes) {
        let totalBuyOI = 0;
        for (const bl of buyLegs) {
          const sd = chain.strikes[bl.strike];
          if (sd && sd[bl.type]) totalBuyOI += sd[bl.type].oi || 0;
        }
        trade.entry_buy_oi = totalBuyOI;
      }
    }

    // Populate bias snapshot
    const q1 = computeDirectionalBias();
    if (q1) {
      trade.entry_bias = `${q1.biasConf} ${q1.bias}`;
      trade.entry_bias_net = q1.net;
    }

    // Insert to Supabase
    const result = await dbInsertTrade(trade);
    if (result.ok) {
      console.log(`[trade] Logged: ${setup.stratType} ${setup.indexKey} ${setup.expiry} — Score: ${setup.compositeScore}`);
      if (statusEl) statusEl.textContent = '✅ Trade logged! Switching to POSITIONS...';

      // Close drawer, switch to POSITIONS tab, render, start auto-fetch
      setTimeout(async () => {
        closeDrawer();
        go(2); // POSITIONS tab
        await renderPositionsTab();
        if (typeof isMarketHours === 'function' && isMarketHours() && typeof startAutoFetch === 'function') {
          startAutoFetch();
        }
      }, 800);
    } else {
      if (statusEl) statusEl.textContent = `❌ Failed: ${result.error}`;
      console.error('[trade] Insert failed:', result.error);
    }
  } catch (e) {
    console.error('[trade] Error:', e);
    if (statusEl) statusEl.textContent = `❌ Error: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════
// PAYOFF CHART
// ═══════════════════════════════════════════════════

function drawPayoffChart(setup) {
  const canvas = document.getElementById('payoff-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = 280 * dpr;
  canvas.style.width = rect.width + 'px'; canvas.style.height = '280px';
  ctx.scale(dpr, dpr);
  const CW = rect.width, CH = 280, pad = {top:20,right:20,bottom:40,left:60};
  const plotW = CW - pad.left - pad.right, plotH = CH - pad.top - pad.bottom;
  const spot = setup.spot;
  const allPts = [...setup.legs.map(l=>l.strike), ...setup.breakevens, spot];
  const dMin = Math.min(...allPts), dMax = Math.max(...allPts), dRange = dMax - dMin;
  const xPad = Math.max(dRange * 0.3, setup.width * 1.5);
  const xMin = dMin - xPad, xMax = dMax + xPad;
  const points = [], step = (xMax - xMin) / 200;
  let yMin = Infinity, yMax = -Infinity;
  for (let s = xMin; s <= xMax; s += step) {
    let pnl = 0;
    for (const leg of setup.legs) { const m = leg.action==='SELL'?-1:1; pnl += m * (leg.type==='CE'?Math.max(s-leg.strike,0):Math.max(leg.strike-s,0)); }
    pnl += setup.netPremium; pnl *= setup.lotSize * setup.lots;
    points.push({x:s,y:pnl}); if (pnl < yMin) yMin = pnl; if (pnl > yMax) yMax = pnl;
  }
  // Ensure zero line is visible and target/SL lines are within range
  if (yMin > 0) yMin = -Math.abs(yMax)*0.2; if (yMax < 0) yMax = Math.abs(yMin)*0.2;
  // Extend to include target and SL lines
  if (setup.targetProfit && setup.targetProfit > yMax) yMax = setup.targetProfit * 1.15;
  if (setup.stopLoss && -setup.stopLoss < yMin) yMin = -setup.stopLoss * 1.15;
  const yP = Math.max(Math.abs(yMax),Math.abs(yMin))*0.1; yMin -= yP; yMax += yP;
  const tx = x => pad.left + ((x-xMin)/(xMax-xMin))*plotW;
  const ty = y => pad.top + plotH - ((y-yMin)/(yMax-yMin))*plotH;
  ctx.clearRect(0, 0, CW, CH);
  // Grid
  ctx.strokeStyle='#2e2e42'; ctx.lineWidth=0.5; ctx.fillStyle='#8a8a9a'; ctx.font='11px system-ui, sans-serif';
  ctx.textAlign='right';
  for (let i=0;i<=5;i++) { const yV=yMin+(yMax-yMin)*i/5, py=ty(yV); ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(CW-pad.right,py);ctx.stroke(); ctx.fillText(Math.abs(yV)>=1000?(yV/1000).toFixed(1)+'K':yV.toFixed(0),pad.left-5,py+4); }
  ctx.textAlign='center';
  for (let i=0;i<=5;i++) { const xV=xMin+(xMax-xMin)*i/5, px=tx(xV); ctx.beginPath();ctx.moveTo(px,pad.top);ctx.lineTo(px,CH-pad.bottom);ctx.stroke(); ctx.fillText(xV.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,','),px,CH-pad.bottom+15); }
  // Zero line
  if (yMin<0 && yMax>0) { ctx.strokeStyle='#3a3a50';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad.left,ty(0));ctx.lineTo(CW-pad.right,ty(0));ctx.stroke();ctx.setLineDash([]); }
  // Target/SL horizontal lines
  if (setup.targetProfit && yMin < setup.targetProfit && yMax > setup.targetProfit) {
    ctx.strokeStyle='#22c55e'; ctx.lineWidth=1; ctx.setLineDash([6,3]);
    ctx.beginPath(); ctx.moveTo(pad.left,ty(setup.targetProfit)); ctx.lineTo(CW-pad.right,ty(setup.targetProfit)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#22c55e'; ctx.font='9px system-ui, sans-serif'; ctx.textAlign='right';
    ctx.fillText('TARGET',CW-pad.right-2,ty(setup.targetProfit)-3);
  }
  if (setup.stopLoss && yMin < -setup.stopLoss && yMax > -setup.stopLoss) {
    ctx.strokeStyle='#ef4444'; ctx.lineWidth=1; ctx.setLineDash([6,3]);
    ctx.beginPath(); ctx.moveTo(pad.left,ty(-setup.stopLoss)); ctx.lineTo(CW-pad.right,ty(-setup.stopLoss)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#ef4444'; ctx.font='9px system-ui, sans-serif'; ctx.textAlign='right';
    ctx.fillText('STOP LOSS',CW-pad.right-2,ty(-setup.stopLoss)-3);
  }
  // Loss region
  ctx.beginPath(); ctx.moveTo(tx(points[0].x),ty(0)); for (const p of points) ctx.lineTo(tx(p.x),ty(Math.min(p.y,0))); ctx.lineTo(tx(points[points.length-1].x),ty(0)); ctx.closePath(); ctx.fillStyle='rgba(239,68,68,0.18)'; ctx.fill();
  // Profit region
  ctx.beginPath(); ctx.moveTo(tx(points[0].x),ty(0)); for (const p of points) ctx.lineTo(tx(p.x),ty(Math.max(p.y,0))); ctx.lineTo(tx(points[points.length-1].x),ty(0)); ctx.closePath(); ctx.fillStyle='rgba(34,197,94,0.18)'; ctx.fill();
  // Payoff line (at expiry — orange like Upstox)
  ctx.strokeStyle='#ef6c00'; ctx.lineWidth=2; ctx.beginPath(); for (let i=0;i<points.length;i++) { if(i===0) ctx.moveTo(tx(points[i].x),ty(points[i].y)); else ctx.lineTo(tx(points[i].x),ty(points[i].y)); } ctx.stroke();
  // Current P&L curve (green like Upstox)
  if (setup.dte > 1) {
    const lV = window._LIVE_VIX||14, T=setup.dte/365, r=0.065, cp=[];
    for (let s=xMin;s<=xMax;s+=step) { let pv=0; for (const leg of setup.legs) { const gM=leg.action==='SELL'?-1:1; const iv=(leg.data.iv||lV)/100; pv+=gM*(leg.type==='CE'?bsCall(s,leg.strike,r,iv,T):bsPut(s,leg.strike,r,iv,T)); } cp.push({x:s,y:(setup.netPremium+pv)*setup.lotSize*setup.lots}); }
    ctx.strokeStyle='#22c55e';ctx.lineWidth=1.5;ctx.setLineDash([6,3]);ctx.beginPath();for(let i=0;i<cp.length;i++){const py=ty(Math.max(yMin,Math.min(yMax,cp[i].y)));if(i===0)ctx.moveTo(tx(cp[i].x),py);else ctx.lineTo(tx(cp[i].x),py);}ctx.stroke();ctx.setLineDash([]);
  }
  // Spot marker (grey like Upstox)
  ctx.strokeStyle='#8a8a9a';ctx.lineWidth=1.5;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(tx(spot),pad.top);ctx.lineTo(tx(spot),CH-pad.bottom);ctx.stroke();ctx.setLineDash([]);
  const sp=points.reduce((b,p)=>Math.abs(p.x-spot)<Math.abs(b.x-spot)?p:b,points[0]);
  ctx.fillStyle='#8a8a9a';ctx.beginPath();ctx.arc(tx(spot),ty(sp.y),5,0,Math.PI*2);ctx.fill();
  // Breakeven markers
  for (const be of setup.breakevens) { const bx=tx(be); if(bx>pad.left&&bx<CW-pad.right){ctx.fillStyle='#f59e0b';ctx.beginPath();ctx.moveTo(bx,CH-pad.bottom-5);ctx.lineTo(bx-4,CH-pad.bottom+3);ctx.lineTo(bx+4,CH-pad.bottom+3);ctx.closePath();ctx.fill();ctx.fillStyle='#8a8a9a';ctx.font='10px system-ui, sans-serif';ctx.textAlign='center';ctx.fillText(be.toString(),bx,CH-pad.bottom+28);} }
  // Legend
  ctx.font='10px system-ui, sans-serif';ctx.textAlign='left';ctx.fillStyle='#ef6c00';ctx.fillText('— At expiry',pad.left+5,pad.top+12);
  if(setup.dte>1){ctx.fillStyle='#22c55e';ctx.fillText('--- Current',pad.left+100,pad.top+12);}
  ctx.fillStyle='#8a8a9a';ctx.fillText('● Spot',pad.left+190,pad.top+12);
}

// ═══════════════════════════════════════════════════
// DRAWER TOUCH + TABS
// ═══════════════════════════════════════════════════

function initDrawer() {
  const b = document.getElementById('drawer-backdrop'), h = document.getElementById('drawer-handle');
  if (b) b.addEventListener('click', closeDrawer);
  if (h) { let sY=0,dr=false; h.addEventListener('touchstart',e=>{sY=e.touches[0].clientY;dr=true;}); h.addEventListener('touchmove',e=>{if(dr&&e.touches[0].clientY-sY>80){closeDrawer();dr=false;}}); h.addEventListener('touchend',()=>{dr=false;}); h.addEventListener('mousedown',e=>{sY=e.clientY;dr=true;}); document.addEventListener('mousemove',e=>{if(dr&&e.clientY-sY>80){closeDrawer();dr=false;}}); document.addEventListener('mouseup',()=>{dr=false;}); }
}
function go(n) { document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active')); const t=document.getElementById(`t${n}`),p=document.getElementById(`p${n}`); if(t)t.classList.add('active'); if(p)p.classList.add('active'); }

// ═══════════════════════════════════════════════════
// SOFT TOGGLE LOCKS
// ═══════════════════════════════════════════════════

function toggleRadar() { if (RADAR_LOCKED) { RADAR_LOCKED = false; } else { const d={}; ['india_vix','fii','fii_fut','fii_opt','fii_short_pct','close_char','max_pain_nf','nf_price','bn_price','nifty_prev','upstox_bias','key_support_oi'].forEach(id=>{d[id]=gv(id)||document.getElementById(id)?.value||null;}); localStorage.setItem('mr140-radar',JSON.stringify(d)); const sp=gv('fii_short_pct'); if(valid(sp)) localStorage.setItem('mr_fii_short_prev',sp); saveSessionSnapshot(); RADAR_LOCKED=true; } renderLockState(); }

// ═══════════════════════════════════════════════════
// SESSION SNAPSHOT — Institutional Memory
// Stores daily snapshots on radar lock. Rolling 10 sessions.
// This is the FOUNDATION for institutional pattern detection.
// Phase 1: collect + display trajectory.
// Phase 2 (after 10-15 sessions): analyse reversal patterns.
// Phase 3 (after 2-3 months): auto-detection.
// DO NOT skip this or replace with hardcoded thresholds.
// ═══════════════════════════════════════════════════

function saveSessionSnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = {
    date: today,
    nf_spot: gv('nf_price'),
    bnf_spot: gv('bn_price'),
    vix: gv('india_vix'),
    pcr: gv('pcr_nf'),
    max_pain: gv('max_pain_nf'),
    fii_cash: gv('fii'),
    fii_short_pct: gv('fii_short_pct'),
    breadth_nf: gv('n50adv'),
    breadth_bnf: computeBnfWeightedBreadth(),
    fut_premium: window._NF_FUTURES_PREMIUM || null,
    close_char: gv('close_char'),
    upstox_bias: (document.getElementById('upstox_bias') || {}).value || null
  };

  // Load existing history
  let history = [];
  try { history = JSON.parse(localStorage.getItem('mr_session_history') || '[]'); } catch(e) {}

  // Prevent duplicate for same date — overwrite if exists
  history = history.filter(s => s.date !== today);
  history.push(snapshot);

  // Keep last 10 sessions only
  if (history.length > 10) history = history.slice(-10);

  localStorage.setItem('mr_session_history', JSON.stringify(history));
  console.log(`[session] Snapshot saved for ${today}. Total: ${history.length} sessions`);
}

function getSessionHistory() {
  try { return JSON.parse(localStorage.getItem('mr_session_history') || '[]'); } catch(e) { return []; }
}

function renderTrajectory() {
  const history = getSessionHistory();
  if (history.length < 2) return ''; // Need at least 2 sessions to show trajectory

  // Build trajectory arrows for key signals
  const signals = [
    { key: 'fii_short_pct', label: 'FII Short%', fmt: v => v ? v + '%' : '—' },
    { key: 'pcr', label: 'PCR', fmt: v => v ? v.toFixed(2) : '—' },
    { key: 'vix', label: 'VIX', fmt: v => v ? v.toFixed(1) : '—' },
    { key: 'breadth_nf', label: 'NF Breadth', fmt: v => v !== null ? v + '/50' : '—' },
    { key: 'fii_cash', label: 'FII ₹Cr', fmt: v => v ? (v > 0 ? '+' : '') + v : '—' },
    { key: 'fut_premium', label: 'Fut Prem', fmt: v => v !== null ? (v > 0 ? '+' : '') + v.toFixed(3) + '%' : '—' }
  ];

  // Show last 5 sessions max
  const recent = history.slice(-5);

  let html = '<div class="q-section-label" style="margin-top:10px">Session Trajectory (' + recent.length + ' sessions)</div>';
  html += '<div class="trajectory-grid">';

  // Header row: dates
  html += '<div class="traj-row traj-header"><span class="traj-label"></span>';
  for (const s of recent) {
    const d = s.date.slice(5); // MM-DD
    html += `<span class="traj-cell">${d}</span>`;
  }
  html += '</div>';

  // Signal rows
  for (const sig of signals) {
    html += `<div class="traj-row"><span class="traj-label">${sig.label}</span>`;
    let prevVal = null;
    for (const s of recent) {
      const val = s[sig.key];
      let arrow = '', cls = '';
      if (prevVal !== null && val !== null && prevVal !== undefined && val !== undefined) {
        if (val > prevVal) { arrow = '↑'; cls = 'traj-up'; }
        else if (val < prevVal) { arrow = '↓'; cls = 'traj-down'; }
        else { arrow = '→'; cls = 'traj-flat'; }
      }
      html += `<span class="traj-cell ${cls}">${sig.fmt(val)} ${arrow}</span>`;
      prevVal = val;
    }
    html += '</div>';
  }

  // Detect multi-signal reversals
  if (recent.length >= 3) {
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];
    const prev2 = recent[recent.length - 3];

    let reversals = 0, reversalNames = [];
    for (const sig of signals) {
      const v0 = prev2[sig.key], v1 = prev[sig.key], v2 = last[sig.key];
      if (v0 === null || v1 === null || v2 === null || v0 === undefined || v1 === undefined || v2 === undefined) continue;
      const dir1 = v1 - v0; // previous move direction
      const dir2 = v2 - v1; // latest move direction
      if (dir1 !== 0 && dir2 !== 0 && Math.sign(dir1) !== Math.sign(dir2)) {
        reversals++;
        reversalNames.push(sig.label);
      }
    }

    if (reversals >= 3) {
      html += `<div class="traj-alert traj-alert-high">🔥 ${reversals} signals reversed: ${reversalNames.join(', ')} — Possible institutional shift</div>`;
    } else if (reversals >= 2) {
      html += `<div class="traj-alert traj-alert-mid">⚠️ ${reversals} signals reversed: ${reversalNames.join(', ')} — Watch closely</div>`;
    }

    // Detect alignment (3+ signals moving same direction)
    let bearAlign = 0, bullAlign = 0;
    if (last.fii_short_pct > prev.fii_short_pct) bearAlign++; else if (last.fii_short_pct < prev.fii_short_pct) bullAlign++;
    if (last.pcr < prev.pcr) bearAlign++; else if (last.pcr > prev.pcr) bullAlign++;
    if (last.vix > prev.vix) bearAlign++; else if (last.vix < prev.vix) bullAlign++;
    if (last.breadth_nf !== null && prev.breadth_nf !== null) {
      if (last.breadth_nf < prev.breadth_nf) bearAlign++; else if (last.breadth_nf > prev.breadth_nf) bullAlign++;
    }
    if (last.fii_cash !== null && prev.fii_cash !== null) {
      if (last.fii_cash < prev.fii_cash) bearAlign++; else if (last.fii_cash > prev.fii_cash) bullAlign++;
    }

    if (bearAlign >= 4) {
      html += `<div class="traj-alert traj-alert-high">🔴 ${bearAlign} signals bearish-aligned — Institutional selling pressure</div>`;
    } else if (bullAlign >= 4) {
      html += `<div class="traj-alert traj-alert-high">🟢 ${bullAlign} signals bullish-aligned — Institutional accumulation</div>`;
    }
  }

  // ── Contrarian PCR Flag — forward-looking warning from extreme readings ──
  const currentPCR = gv('pcr_nf');
  if (valid(currentPCR)) {
    if (currentPCR < 0.6) {
      html += `<div class="traj-alert traj-alert-high">⚡ PCR ${currentPCR.toFixed(2)} — EXTREME put buying. Contrarian bounce likely 1-3 sessions. Institutions buying cheap calls here.</div>`;
    } else if (currentPCR < 0.8 && recent.length >= 2 && recent[recent.length - 2].pcr && recent[recent.length - 2].pcr < 0.8) {
      html += `<div class="traj-alert traj-alert-mid">📉 PCR below 0.8 for 2+ sessions — sustained bearish, but watch for snap reversal</div>`;
    } else if (currentPCR > 1.5) {
      html += `<div class="traj-alert traj-alert-high">⚡ PCR ${currentPCR.toFixed(2)} — EXTREME call selling. Contrarian drop likely 1-3 sessions. Institutions buying cheap puts here.</div>`;
    } else if (currentPCR > 1.3 && recent.length >= 2 && recent[recent.length - 2].pcr && recent[recent.length - 2].pcr > 1.3) {
      html += `<div class="traj-alert traj-alert-mid">📈 PCR above 1.3 for 2+ sessions — sustained bullish, but watch for reversal</div>`;
    }
  }

  // ── FII Short% 3-Session Trend Tracker ──
  const shortHistory = recent.map(s => s.fii_short_pct).filter(v => v !== null && v !== undefined && v > 0);
  if (shortHistory.length >= 3) {
    const last3 = shortHistory.slice(-3);
    const trend1 = last3[1] - last3[0]; // session N-2 to N-1
    const trend2 = last3[2] - last3[1]; // session N-1 to N

    let trendLabel = '', trendClass = '';
    if (trend1 < 0 && trend2 < 0) {
      // Dropping for 2+ sessions = covering
      const acceleration = Math.abs(trend2) > Math.abs(trend1) ? 'ACCELERATING' : 'steady';
      trendLabel = `↓ FII covering ${acceleration}: ${last3.join('→')}%`;
      trendClass = 'traj-alert-mid';
      if (Math.abs(trend2) >= 3) {
        trendLabel = `↓↓ FII AGGRESSIVE covering: ${last3.join('→')}% — aircraft carrier turning`;
        trendClass = 'traj-alert-high';
      }
      html += `<div class="traj-alert ${trendClass}" style="color:#22c55e;border-color:rgba(34,197,94,0.3);background:rgba(34,197,94,0.08)">🟢 ${trendLabel}</div>`;
    } else if (trend1 > 0 && trend2 > 0) {
      // Rising for 2+ sessions = building shorts
      const acceleration = Math.abs(trend2) > Math.abs(trend1) ? 'ACCELERATING' : 'steady';
      trendLabel = `↑ FII shorts building ${acceleration}: ${last3.join('→')}%`;
      trendClass = 'traj-alert-mid';
      if (Math.abs(trend2) >= 3) {
        trendLabel = `↑↑ FII AGGRESSIVE shorting: ${last3.join('→')}% — heavy conviction`;
        trendClass = 'traj-alert-high';
      }
      html += `<div class="traj-alert ${trendClass}">🔴 ${trendLabel}</div>`;
    } else if (trend1 !== 0 && trend2 !== 0 && Math.sign(trend1) !== Math.sign(trend2)) {
      // Direction changed = inflection point
      html += `<div class="traj-alert traj-alert-mid">🔄 FII short% direction changed: ${last3.join('→')}% — possible inflection</div>`;
    }
  } else if (shortHistory.length >= 2) {
    const diff = shortHistory[shortHistory.length - 1] - shortHistory[shortHistory.length - 2];
    if (Math.abs(diff) >= 2) {
      const dir = diff < 0 ? '↓ covering' : '↑ building';
      html += `<div class="traj-alert traj-alert-mid">${diff < 0 ? '🟢' : '🔴'} FII short% ${dir}: ${shortHistory.slice(-2).join('→')}% (need 1 more session for trend)</div>`;
    }
  }

  html += '</div>';
  return html;
}
function toggleBreadth() { if (BREADTH_LOCKED) { BREADTH_LOCKED = false; } else { const d={}; ['n50adv','n50dma'].forEach(id=>{d[id]=gv(id);}); BNF_CONSTITUENTS.forEach(c=>{const el=document.getElementById(c.id);if(el)d[c.id]=el.checked;}); localStorage.setItem('mr140-breadth',JSON.stringify(d)); BREADTH_LOCKED=true; } renderLockState(); }
function toggleEvening() { if (EVENING_LOCKED) { EVENING_LOCKED = false; } else { const d={}; ['ev_fii','ev_nf_close','ev_bnf_close','ev_indiavix'].forEach(id=>{d[id]=gv(id);}); localStorage.setItem('mr140-evening',JSON.stringify(d)); const v=gv('ev_indiavix'); if(valid(v)) localStorage.setItem('mr_ev_indiavix',v); EVENING_LOCKED=true; } renderLockState(); }
function renderLockState() { [['btn-lock-radar',RADAR_LOCKED,'🔒 Locked','🔓 Lock Morning Data'],['btn-lock-breadth',BREADTH_LOCKED,'🔒 Locked','🔓 Lock Breadth'],['btn-lock-evening',EVENING_LOCKED,'🔒 Locked','🔓 Lock Evening']].forEach(([id,locked,lt,ut])=>{ const el=document.getElementById(id); if(el) el.textContent=locked?lt:ut; }); }

function restoreSavedState() {
  try { const r=JSON.parse(localStorage.getItem('mr140-radar')||'null'); if(r){RADAR_LOCKED=true;for(const id in r){const el=document.getElementById(id);if(el&&r[id]!==null)el.value=r[id];}} } catch(e){}
  try { const b=JSON.parse(localStorage.getItem('mr140-breadth')||'null'); if(b){BREADTH_LOCKED=true;for(const id in b){if(id.startsWith('_'))continue;const el=document.getElementById(id);if(!el||b[id]===null)continue;if(el.type==='checkbox')el.checked=!!b[id];else el.value=b[id];}} } catch(e){}
  try { const e=JSON.parse(localStorage.getItem('mr140-evening')||'null'); if(e){EVENING_LOCKED=true;for(const id in e){if(id.startsWith('_'))continue;const el=document.getElementById(id);if(el&&e[id]!==null)el.value=e[id];}} } catch(e){}
  renderLockState(); restoreAllTS();
}

function onInput(e) { if(e.target&&e.target.id) stampField(e.target.id); calcScore(); }
function initInputListeners() {
  document.querySelectorAll('input[type="number"],select').forEach(el=>{el.addEventListener('input',onInput);el.addEventListener('change',onInput);});
  // BNF constituent checkboxes trigger calcScore + readout on change
  document.querySelectorAll('.bnf-chk').forEach(el=>{el.addEventListener('change',()=>{updateBnfReadout();calcScore();});});
}

async function handleBhavUpload() { const f=document.getElementById('bhav-file'),s=document.getElementById('bhav-spot'),st=document.getElementById('bhav-status'); if(!f||!f.files.length){if(st)st.textContent='Select CSV';return;} if(st)st.textContent='Uploading...'; const r=await bhavHandleUpload(f.files,s?s.value:''); if(st)st.textContent=r.ok?`✅ ${r.contracts} contracts. GH: ${r.github?'✅':'❌ '+r.error}`:`❌ ${r.error}`; }
function renderEveningSection() { try { const e=JSON.parse(localStorage.getItem('mr140-evening')||'null'); if(e){for(const id in e){if(id.startsWith('_'))continue;const el=document.getElementById(id);if(el&&e[id]!==null)el.value=e[id];}} } catch(e){} }

// ═══════════════════════════════════════════════════
// DEBUG
// ═══════════════════════════════════════════════════

function showDebug() {
  const el=document.getElementById('debug-output'); if(!el) return;
  el.style.display=el.style.display==='none'?'block':'none'; if(el.style.display==='none') return;
  let out='=== CHAIN DEBUG ===\n\n';
  for (const idx of ['NF','BNF']) { const chains=window._CHAINS[idx]; out+=`--- ${idx} ---\nExpiries: ${JSON.stringify(Object.keys(chains))}\n`; for (const exp in chains) { const c=chains[exp],sk=Object.keys(c.strikes||{}); out+=`\n[${exp}] DTE=${c.dte} TradingDTE=${c.tradingDte||'?'} Spot=${c.spot}\n  PCR=${c.pcr} MaxPain=${c.maxPain}\n  CallOI=${c.callOI} PutOI=${c.putOI}\n  CallWall=${c.callWall} PutWall=${c.putWall}\n  Strikes loaded: ${sk.length}\n`; const sample=sk.slice(0,3); for(const s of sample){const d=c.strikes[s];if(d.CE)out+=`  ${s} CE: LTP=${d.CE.ltp} OI=${d.CE.oi} Δ=${d.CE.delta} θ=${d.CE.theta} IV=${d.CE.iv}\n`;if(d.PE)out+=`  ${s} PE: LTP=${d.PE.ltp} OI=${d.PE.oi} Δ=${d.PE.delta} θ=${d.PE.theta} IV=${d.PE.iv}\n`;} if(c.spot&&sk.length>0){const atm=sk.reduce((b,s)=>Math.abs(+s-c.spot)<Math.abs(+b-c.spot)?s:b);const ad=c.strikes[atm];out+=`  ATM(${atm}):\n`;if(ad.CE)out+=`    CE: LTP=${ad.CE.ltp} OI=${ad.CE.oi} Δ=${ad.CE.delta}\n`;if(ad.PE)out+=`    PE: LTP=${ad.PE.ltp} OI=${ad.PE.oi} Δ=${ad.PE.delta}\n`;} } out+='\n'; }
  out+='--- HIDDEN FIELDS ---\n'; ['nf_price','bn_price','india_vix','nf_atr','bn_atr','pcr_nf','pcr_bn','max_pain_nf','nf_oi_call','nf_oi_put','nf_maxpain','bn_maxpain'].forEach(id=>{out+=`  ${id} = ${gv(id)}\n`;});
  if(window._RAW_CHAIN_SAMPLE){out+='\n--- RAW API RESPONSE ---\n';for(const key in window._RAW_CHAIN_SAMPLE){const s=window._RAW_CHAIN_SAMPLE[key];out+=`\n[${key}]\n  isArray=${s.isArray} type=${s.type} length=${s.length}\n`;if(s.topKeys)out+=`  topKeys: ${JSON.stringify(s.topKeys)}\n`;out+=`  sampleKeys: ${JSON.stringify(s.sampleKeys)}\n  firstItem: ${JSON.stringify(s.firstItem).substring(0,500)}\n`;}}
  // BNF breadth debug
  if(window._BNF_BREADTH_DEBUG){out+='\n--- BNF BREADTH ---\n';out+=JSON.stringify(window._BNF_BREADTH_DEBUG,null,2)+'\n';}
  el.textContent=out;
}

// ═══════════════════════════════════════════════════
// PHASE 2: POSITION DETECTION + SUPABASE LOGGING
// ═══════════════════════════════════════════════════

function parseUpstoxSymbol(sym) {
  // Parse tradingsymbol like "NIFTY2630656300CE" or "BANKNIFTY26MAR54200PE"
  if (!sym) return null;
  const s = sym.toUpperCase();
  let indexKey, rest;
  if (s.startsWith('BANKNIFTY')) { indexKey = 'BNF'; rest = s.slice(9); }
  else if (s.startsWith('NIFTY')) { indexKey = 'NF'; rest = s.slice(5); }
  else return null;
  const type = rest.slice(-2); // CE or PE
  if (type !== 'CE' && type !== 'PE') return null;
  const numPart = rest.slice(0, -2);

  const MONTHS = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};

  // Try format: YY + MonthName + Strike (e.g., "26MAR54200")
  const monthMatch = numPart.match(/^(\d{2})([A-Z]{3})(\d+)$/);
  if (monthMatch) {
    const yy = parseInt(monthMatch[1]);
    const mm = MONTHS[monthMatch[2]];
    const strike = parseFloat(monthMatch[3]);
    if (!mm || isNaN(strike)) return null;
    const year = 2000 + yy;

    // Match against known chain expiries instead of calculating
    const chainExps = Object.keys((window._CHAINS && window._CHAINS[indexKey]) || {}).sort();
    let expiry = null;
    for (const exp of chainExps) {
      const d = new Date(exp);
      if (d.getFullYear() === year && (d.getMonth() + 1) === mm) { expiry = exp; break; }
    }
    // If no chain match, try a reasonable guess but mark it for correction
    if (!expiry) {
      // Use last day of month as placeholder — will be corrected on next fetch
      const lastDay = new Date(year, mm, 0);
      expiry = `${year}-${String(mm).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    }
    return { indexKey, expiry, strike, type };
  }

  // Try format: YYMDD or YYMMDD + Strike (e.g., "2633054200" or "26D1754200")
  if (numPart.length >= 7) {
    // Try month name embedded: YY + single letter month code + DD
    const dayMatch = numPart.match(/^(\d{2})(\d)(\d{2})(\d+)$/);
    if (dayMatch) {
      const yy = parseInt(dayMatch[1]);
      const mm = parseInt(dayMatch[2]);
      const dd = parseInt(dayMatch[3]);
      const strike = parseFloat(dayMatch[4]);
      if (!isNaN(mm) && !isNaN(dd) && !isNaN(strike) && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const expiry = `20${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        return { indexKey, expiry, strike, type };
      }
    }
    // Try YYMMDD format
    const expStr = numPart.slice(0, numPart.length <= 9 ? 5 : 6);
    const strikeStr = numPart.slice(expStr.length);
    const strike = parseFloat(strikeStr);
    if (isNaN(strike)) return null;
    const yy = parseInt(expStr.slice(0, 2));
    const remaining = expStr.slice(2);
    let mm, dd;
    if (remaining.length === 3) { mm = parseInt(remaining.slice(0, 1)); dd = parseInt(remaining.slice(1)); }
    else if (remaining.length === 4) { mm = parseInt(remaining.slice(0, 2)); dd = parseInt(remaining.slice(2)); }
    else return null;
    if (isNaN(mm) || isNaN(dd)) return null;
    const expiry = `20${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    return { indexKey, expiry, strike, type };
  }

  return null;
}

function detectStrategy(legs) {
  if (!legs || legs.length === 0) return null;
  const ceLegs = legs.filter(l => l.type === 'CE');
  const peLegs = legs.filter(l => l.type === 'PE');
  const ceBuy = ceLegs.filter(l => l.action === 'BUY');
  const ceSell = ceLegs.filter(l => l.action === 'SELL');
  const peBuy = peLegs.filter(l => l.action === 'BUY');
  const peSell = peLegs.filter(l => l.action === 'SELL');

  // Iron Condor: 1 CE SELL + 1 CE BUY + 1 PE SELL + 1 PE BUY
  if (ceSell.length === 1 && ceBuy.length === 1 && peSell.length === 1 && peBuy.length === 1)
    return 'IRON_CONDOR';
  // Bull Put Spread: 1 PE SELL (higher) + 1 PE BUY (lower)
  if (peSell.length === 1 && peBuy.length === 1 && ceLegs.length === 0 && peSell[0].strike > peBuy[0].strike)
    return 'BULL_PUT';
  // Bear Call Spread: 1 CE SELL (lower) + 1 CE BUY (higher)
  if (ceSell.length === 1 && ceBuy.length === 1 && peLegs.length === 0 && ceSell[0].strike < ceBuy[0].strike)
    return 'BEAR_CALL';
  // Bull Call Spread: 1 CE BUY (lower) + 1 CE SELL (higher)
  if (ceBuy.length === 1 && ceSell.length === 1 && peLegs.length === 0 && ceBuy[0].strike < ceSell[0].strike)
    return 'BULL_CALL';
  // Bear Put Spread: 1 PE BUY (higher) + 1 PE SELL (lower)
  if (peBuy.length === 1 && peSell.length === 1 && ceLegs.length === 0 && peBuy[0].strike > peSell[0].strike)
    return 'BEAR_PUT';
  // Long Straddle: 1 CE BUY + 1 PE BUY, same strike
  if (ceBuy.length === 1 && peBuy.length === 1 && ceSell.length === 0 && peSell.length === 0 && ceBuy[0].strike === peBuy[0].strike)
    return 'LONG_STRADDLE';
  // Long Strangle: 1 CE BUY + 1 PE BUY, different strikes
  if (ceBuy.length === 1 && peBuy.length === 1 && ceSell.length === 0 && peSell.length === 0)
    return 'LONG_STRANGLE';

  return 'UNKNOWN';
}

async function detectAndLogPositions(rawPositions) {
  if (!rawPositions || !rawPositions.length) {
    // No positions — check if any OPEN trades in Supabase should be auto-closed
    await autoCloseGonePositions([]);
    renderPositionsTab();
    return;
  }

  // Parse and group legs by index + expiry
  const groups = {};
  for (const pos of rawPositions) {
    const qty = pos.quantity || pos.net_quantity || 0;
    if (qty === 0) continue; // Closed position
    const sym = pos.tradingsymbol || pos.trading_symbol || '';
    const parsed = parseUpstoxSymbol(sym);
    if (!parsed) continue;

    // Use expiry from API if available, else from parsed symbol
    let expiry = parsed.expiry;
    if (pos.expiry || pos.expiry_date) {
      const rawExp = pos.expiry || pos.expiry_date;
      // Normalize: could be "2026-03-30" or "30-Mar-2026" etc
      const d = new Date(rawExp);
      if (!isNaN(d.getTime())) expiry = d.toISOString().slice(0, 10);
    }
    // Fallback: match against known chain expiries
    if (expiry.includes('NaN') || !expiry) {
      const chainExps = Object.keys(window._CHAINS[parsed.indexKey] || {}).sort();
      if (chainExps.length > 0) expiry = chainExps[0]; // Use nearest
    }

    const key = `${parsed.indexKey}_${expiry}`;
    if (!groups[key]) groups[key] = [];

    // Calculate live P&L from chain if available
    let liveLtp = 0;
    const chain = window._CHAINS[parsed.indexKey] && window._CHAINS[parsed.indexKey][expiry];
    if (chain && chain.strikes && chain.strikes[parsed.strike]) {
      const sd = chain.strikes[parsed.strike];
      if (parsed.type === 'CE' && sd.CE) liveLtp = sd.CE.ltp || 0;
      if (parsed.type === 'PE' && sd.PE) liveLtp = sd.PE.ltp || 0;
    }
    // Also check position chains from auto-fetch
    const posChain = (window._POSITION_CHAINS || {})[key];

    const entryPrice = pos.average_price || pos.buy_price || pos.sell_price || 0;
    const legPnl = qty > 0 ? (liveLtp - entryPrice) * Math.abs(qty) : (entryPrice - liveLtp) * Math.abs(qty);

    groups[key].push({
      strike: parsed.strike,
      type: parsed.type,
      action: qty > 0 ? 'BUY' : 'SELL',
      qty: Math.abs(qty),
      entry_ltp: entryPrice,
      pnl: liveLtp > 0 ? legPnl : 0,
      current_ltp: liveLtp,
      symbol: sym
    });
  }

  // Detect strategies and log to Supabase
  const detected = [];
  for (const key in groups) {
    const legs = groups[key];
    const [indexKey, expiry] = key.split('_');
    const stratType = detectStrategy(legs);
    if (!stratType || stratType === 'UNKNOWN') continue;

    // Sort legs: SELL first, then BUY; PE first within same action
    legs.sort((a, b) => {
      if (a.action !== b.action) return a.action === 'SELL' ? -1 : 1;
      return a.strike - b.strike;
    });

    // Check if already in Supabase — match by legs, flexible on expiry
    let existing = await dbFindOpenTrade(indexKey, expiry, legs[0].strike, legs[0].type, legs[0].action);

    // If not found, try without expiry filter (expiry might be wrong in DB)
    if (!existing && typeof dbFindOpenTradeByLegs === 'function') {
      existing = await dbFindOpenTradeByLegs(indexKey, legs[0].strike, legs[0].type, legs[0].action);
      // Auto-correct expiry if found with wrong one
      if (existing && existing.expiry !== expiry) {
        console.log(`[positions] Auto-correcting expiry: ${existing.expiry} → ${expiry}`);
        if (typeof dbUpdateTrade === 'function') {
          await dbUpdateTrade(existing.id, { expiry: expiry });
          existing.expiry = expiry;
        }
      }
    }

    if (!existing) {
      // New trade — insert to Supabase
      const trade = {
        strategy_type: stratType,
        index_key: indexKey,
        expiry: expiry,
        entry_spot: gv(indexKey === 'NF' ? 'nf_price' : 'bn_price'),
        entry_vix: gv('india_vix'),
        lots: legs[0].qty / (indexKey === 'NF' ? NF_LOT_SIZE : BNF_LOT),
      };
      // Calculate net premium from entry LTPs
      let netPrem = 0;
      for (let i = 0; i < Math.min(legs.length, 4); i++) {
        trade[`leg${i+1}`] = legs[i];
        const mult = legs[i].action === 'SELL' ? 1 : -1;
        netPrem += mult * legs[i].entry_ltp;
      }
      trade.entry_premium = +netPrem.toFixed(2);
      const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(stratType);
      const lotSize = indexKey === 'NF' ? NF_LOT_SIZE : BNF_LOT;
      // Derive width from actual leg strikes (not fixed constant)
      // For spreads: |strike1 - strike2|. For IC: min adjacent gap (= per-side width)
      const strikes = legs.map(l => l.strike).sort((a,b) => a - b);
      let width;
      if (strikes.length >= 2) {
        let minGap = Infinity;
        for (let i = 1; i < strikes.length; i++) minGap = Math.min(minGap, strikes[i] - strikes[i-1]);
        width = minGap;
      } else {
        width = indexKey === 'NF' ? NF_IC_WIDTH : BNF_IC_WIDTH;
      }
      const safeLots = Math.max(1, trade.lots || 1);
      if (isCredit) {
        trade.max_profit = +(netPrem * lotSize * safeLots).toFixed(0);
        trade.max_loss = +((width - netPrem) * lotSize * safeLots).toFixed(0);
      } else {
        trade.max_profit = +((width - Math.abs(netPrem)) * lotSize * safeLots).toFixed(0);
        trade.max_loss = +(Math.abs(netPrem) * lotSize * safeLots).toFixed(0);
      }
      trade.target_profit = +(trade.max_profit * 0.5).toFixed(0);
      trade.stop_loss = +(trade.max_loss * 0.5).toFixed(0);

      // ── Entry thesis snapshot — for smart exit checks ──
      const entryChain = window._CHAINS[indexKey] && window._CHAINS[indexKey][expiry];
      if (entryChain) {
        trade.entry_pcr = entryChain.pcr || null;
        trade.entry_max_pain = entryChain.maxPain || null;
        // OI at sell strike(s)
        const sellLegs = legs.filter(l => l.action === 'SELL');
        if (sellLegs.length > 0 && entryChain.strikes) {
          let totalSellOI = 0;
          for (const sl of sellLegs) {
            const sd = entryChain.strikes[sl.strike];
            if (sd && sd[sl.type]) totalSellOI += sd[sl.type].oi || 0;
          }
          trade.entry_sell_oi = totalSellOI;
        }
        // OI at buy strike(s) — for adversarial Control Index
        const buyLegs = legs.filter(l => l.action === 'BUY');
        if (buyLegs.length > 0 && entryChain.strikes) {
          let totalBuyOI = 0;
          for (const bl of buyLegs) {
            const sd = entryChain.strikes[bl.strike];
            if (sd && sd[bl.type]) totalBuyOI += sd[bl.type].oi || 0;
          }
          trade.entry_buy_oi = totalBuyOI;
        }
      }

      const result = await dbInsertTrade(trade);
      console.log(`[positions] Logged new ${stratType}: ${indexKey} ${expiry}`, result);
      detected.push({ ...trade, id: result.id, legs, status: 'OPEN', recommendation: 'HOLD', current_pnl: 0 });
    } else {
      // Existing trade — update with live P&L + track peak
      const livePnl = legs.reduce((sum, l) => sum + l.pnl, 0);
      const liveSpot = gv(indexKey === 'NF' ? 'nf_price' : 'bn_price');
      const prevPeak = existing.peak_pnl || 0;
      const newPeak = Math.max(prevPeak, livePnl);
      existing.peak_pnl = newPeak; // Pass to computeRecommendation
      const rec = computeRecommendation(existing, livePnl, liveSpot, expiry);
      await dbUpdateTrade(existing.id, {
        current_pnl: +livePnl.toFixed(0),
        current_spot: liveSpot,
        recommendation: rec,
        peak_pnl: +newPeak.toFixed(0)
      });
      detected.push({ ...existing, legs, current_pnl: +livePnl.toFixed(0), peak_pnl: +newPeak.toFixed(0), recommendation: rec });
    }
  }

  // Check for auto-close
  await autoCloseGonePositions(Object.keys(groups));

  // Render positions from Supabase (source of truth)
  renderPositionsTab();
  // Phase 3: auto-expire past trades + refresh journal
  await autoExpireOpenTrades();
  renderJournalTab();
}

async function autoCloseGonePositions(activeKeys) {
  const openTrades = await dbGetOpenTrades();
  for (const trade of openTrades) {
    const key = `${trade.index_key}_${trade.expiry}`;
    if (!activeKeys.includes(key)) {
      // This trade is no longer in Upstox positions — auto-close
      await dbCloseTrade(trade.id, {
        status: 'CLOSED',
        exit_reason: 'AUTO_DETECT',
        actual_pnl: trade.current_pnl || 0
      });
      console.log(`[positions] Auto-closed trade #${trade.id}: ${trade.strategy_type} ${trade.index_key} ${trade.expiry}`);
    }
  }
}

// ═══════════════════════════════════════════════════
// TRADE BOOK EXIT MATCHING — Real P&L from fills
// ═══════════════════════════════════════════════════

async function matchTradeBookExits(trades) {
  if (!trades || !trades.length) return;
  if (typeof dbGetOpenTrades !== 'function') return;

  const openTrades = await dbGetOpenTrades();
  if (!openTrades.length) return;

  // Parse trade book fills
  const fills = [];
  for (const t of trades) {
    const sym = t.tradingsymbol || t.trading_symbol || '';
    const parsed = parseUpstoxSymbol(sym);
    if (!parsed) continue;
    fills.push({
      ...parsed,
      txnType: t.transaction_type || '',  // BUY or SELL
      price: t.price || t.average_price || 0,
      qty: Math.abs(t.quantity || 0),
      tradeId: t.trade_id || '',
      tradedAt: t.traded_at || t.fill_timestamp || ''
    });
  }

  if (!fills.length) return;

  // For each OPEN trade, check if trade book has exit fills
  for (const trade of openTrades) {
    const legs = [];
    for (let i = 1; i <= 4; i++) {
      if (trade[`leg${i}_strike`]) {
        legs.push({
          strike: trade[`leg${i}_strike`],
          type: trade[`leg${i}_type`],
          action: trade[`leg${i}_action`],
          entryLtp: trade[`leg${i}_entry_ltp`] || 0
        });
      }
    }
    if (!legs.length) continue;

    // Find exit fills: same strike+type but REVERSED action
    // Entry SELL → Exit BUY, Entry BUY → Exit SELL
    const exitFills = [];
    for (const leg of legs) {
      const reverseAction = leg.action === 'SELL' ? 'BUY' : 'SELL';
      const match = fills.find(f =>
        f.indexKey === trade.index_key &&
        f.expiry === trade.expiry &&
        f.strike === leg.strike &&
        f.type === leg.type &&
        f.txnType === reverseAction
      );
      if (match) exitFills.push({ ...leg, exitPrice: match.price, exitTime: match.tradedAt });
    }

    // All legs must have exit fills (all legs cleared at once)
    if (exitFills.length !== legs.length) continue;

    // Calculate real P&L from actual fill prices
    const lotSize = trade.index_key === 'NF' ? NF_LOT_SIZE : BNF_LOT;
    const lots = trade.lots || 1;
    let exitPremium = 0, entryPremium = 0;

    for (const ef of exitFills) {
      const entryMult = ef.action === 'SELL' ? 1 : -1;  // credit +, debit -
      const exitMult = ef.action === 'SELL' ? -1 : 1;     // closing reverses
      entryPremium += entryMult * ef.entryLtp;
      exitPremium += exitMult * ef.exitPrice;
    }

    // P&L = (entry premium + exit premium) × lotSize × lots
    // For credit: entry +ve (collected), exit -ve (paid to close) → profit if exit < entry
    // For debit: entry -ve (paid), exit +ve (received) → profit if exit > entry
    const actualPnl = +((entryPremium + exitPremium) * lotSize * lots).toFixed(0);

    // Determine exit reason
    const target = trade.target_profit || 0;
    const sl = trade.stop_loss || 0;
    let exitReason = 'MANUAL';
    if (target > 0 && actualPnl >= target * 0.8) exitReason = 'TARGET';
    else if (sl > 0 && actualPnl <= -(sl * 0.8)) exitReason = 'SL';

    // Close trade in Supabase with real P&L
    await dbCloseTrade(trade.id, {
      status: 'CLOSED',
      exit_premium: +exitPremium.toFixed(2),
      actual_pnl: actualPnl,
      exit_reason: exitReason
    });

    console.log(`[tradebook] Matched exit for #${trade.id}: ${trade.strategy_type} ${trade.index_key} ${trade.expiry} → P&L ₹${actualPnl} (${exitReason})`);
  }

  // Refresh journal after processing exits
  if (typeof renderJournalTab === 'function') renderJournalTab();
}

// ═══════════════════════════════════════════════════
// HOLD / EXIT / TRAIL ENGINE
// ═══════════════════════════════════════════════════

function computeRecommendation(trade, currentPnl, currentSpot, expiry) {
  const target = trade.target_profit || 0;
  const sl = trade.stop_loss || 0;
  const dte = daysTo(expiry);
  const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
  const peakPnl = trade.peak_pnl || 0;

  // ── Thesis check from position chains ──
  const thesis = checkThesis(trade);

  // ── Adversarial Control Index ──
  const control = computeControlIndex(trade);
  trade._controlIndex = control; // Attach for rendering

  // ── EXIT NOW: hard limits (unchanged — these are non-negotiable) ──
  if (target > 0 && currentPnl >= target) return 'EXIT_NOW';
  if (sl > 0 && currentPnl <= -sl) return 'EXIT_NOW';
  // Spot breaching sell strike danger zone
  if (currentSpot && trade.leg1_strike) {
    const vix = gv('india_vix') || 14;
    const tdte = tradingDaysTo(expiry);
    const em = bsExpectedMove(currentSpot, vix, tdte);
    const sellStrike = trade.leg1_strike;
    if (Math.abs(currentSpot - sellStrike) < em.one_sigma * 0.5) return 'EXIT_NOW';
  }
  if (isCredit && dte <= 3 && currentPnl < 0) return 'EXIT_NOW';

  // ── ADVERSARIAL-ENHANCED DECISIONS ──
  const ci = control.score; // -100 to +100

  // Profitable + opponent in control → BOOK PROFIT urgently
  if (currentPnl > 0 && ci < -30) return 'BOOK_PROFIT';
  // Profitable + control slipping → BOOK PROFIT
  if (currentPnl > 0 && ci < -10 && thesis.severity >= 1) return 'BOOK_PROFIT';

  // Losing + opponent in control → EXIT EARLY
  if (currentPnl < 0 && ci < -30) return 'EXIT_EARLY';
  // Losing + control contested + thesis weakening → EXIT EARLY
  if (currentPnl < 0 && ci < 10 && thesis.severity >= 2) return 'EXIT_EARLY';

  // Legacy thesis-based BOOK PROFIT (still valid)
  if (thesis.severity >= 2 && currentPnl > 0) return 'BOOK_PROFIT';
  if (target > 0 && currentPnl >= target * 0.35 && dte <= 5) return 'BOOK_PROFIT';
  if (target > 0 && currentPnl >= target * 0.40) return 'BOOK_PROFIT';

  // Legacy thesis-based EXIT EARLY
  if (thesis.severity >= 2 && currentPnl < 0) return 'EXIT_EARLY';
  if (peakPnl > 0 && currentPnl > 0 && currentPnl < peakPnl * 0.70 && thesis.severity >= 1) return 'EXIT_EARLY';
  if (peakPnl > target * 0.20 && currentPnl <= 0 && thesis.severity >= 1) return 'EXIT_EARLY';

  // ── TRAIL: profitable + you're in control → let it ride ──
  if (isCredit) {
    if (dte >= 4 && dte <= 10 && trade.max_profit && currentPnl > trade.max_profit * 0.30) return 'TRAIL';
  } else {
    if (dte <= 5 && currentPnl <= 0) return 'EXIT_NOW'; // Debit: no move, theta killing
    if (currentPnl > 0 && trade.max_loss && currentPnl > trade.max_loss * 0.20) return 'TRAIL';
  }

  // ── HOLD: default, but narrative from control index tells the story ──
  return 'HOLD';
}

const ALERT_META = {
  EXIT_NOW:    { label: 'EXIT NOW',    css: 'rec-exit',   banner: 'alert-exit',   icon: '🔴', priority: 5 },
  EXIT_EARLY:  { label: 'EXIT EARLY',  css: 'rec-early',  banner: 'alert-early',  icon: '🟠', priority: 4 },
  BOOK_PROFIT: { label: 'BOOK PROFIT', css: 'rec-book',   banner: 'alert-book',   icon: '🟢', priority: 3 },
  TRAIL:       { label: 'TRAIL',       css: 'rec-trail',  banner: 'alert-trail',  icon: '🟡', priority: 2 },
  HOLD:        { label: 'HOLD',        css: 'rec-hold',   banner: '',             icon: '⚪', priority: 0 }
};

// ═══════════════════════════════════════════════════
// NOTIFICATION ENGINE — PWA Android Notifications
// ═══════════════════════════════════════════════════

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function fireNotification(title, body, tag) {
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return;

  // Use service worker registration if available
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, {
      body: body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">⚡</text></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">⚡</text></svg>',
      tag: tag || 'market-radar',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200]
    });
  } else {
    // Fallback: basic Notification API
    new Notification(title, { body: body, tag: tag || 'market-radar' });
  }
}

let _lastRoutineNotif = 0; // timestamp of last routine notification
const ROUTINE_INTERVAL = 30 * 60 * 1000; // 30 minutes



// ═══════════════════════════════════════════════════
// THESIS CHECK — Chain-aware smart exits
// Called by auto-fetch with position-specific chains
// ═══════════════════════════════════════════════════

function checkThesis(trade) {
  // Returns: { intact: bool, signals: [], severity: 0-3 }
  const key = `${trade.index_key}|${trade.expiry}`;

  // Try position-specific chains first (from auto-fetch), then full chains (from manual fetch)
  let chain = (window._POSITION_CHAINS || {})[key];
  if (!chain) {
    // Build from full _CHAINS if available
    const fullChain = window._CHAINS && window._CHAINS[trade.index_key] && window._CHAINS[trade.index_key][trade.expiry];
    if (fullChain) {
      const sellStrikeOI = {};
      for (const sk in fullChain.strikes) {
        const sd = fullChain.strikes[sk];
        if (sd.CE) sellStrikeOI[`${sk}_CE`] = sd.CE.oi || 0;
        if (sd.PE) sellStrikeOI[`${sk}_PE`] = sd.PE.oi || 0;
      }
      chain = { pcr: fullChain.pcr, maxPain: fullChain.maxPain, callOI: fullChain.callOI, putOI: fullChain.putOI, sellStrikeOI, spot: fullChain.spot };
    }
  }
  if (!chain) return { intact: true, signals: [], severity: 0 };

  const signals = [];
  let severity = 0;

  // ── Check 1: PCR drift ──
  if (trade.entry_pcr && chain.pcr) {
    const drift = chain.pcr - trade.entry_pcr;
    const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
    const isBearish = ['BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
    const isBullish = ['BULL_PUT'].includes(trade.strategy_type);

    // Bear strategies hurt when PCR rises (puts unwinding = bullish shift)
    if (isBearish && drift > 0.15) {
      signals.push(`PCR shifted ${trade.entry_pcr}→${chain.pcr} (bullish drift)`);
      severity += drift > 0.25 ? 2 : 1;
    }
    // Bull strategies hurt when PCR drops (calls unwinding = bearish shift)
    if (isBullish && drift < -0.15) {
      signals.push(`PCR shifted ${trade.entry_pcr}→${chain.pcr} (bearish drift)`);
      severity += drift < -0.25 ? 2 : 1;
    }
  }

  // ── Check 2: Max Pain migration ──
  if (trade.entry_max_pain && chain.maxPain) {
    const spot = chain.spot || gv(trade.index_key === 'NF' ? 'nf_price' : 'bn_price') || 0;
    const mpShift = chain.maxPain - trade.entry_max_pain;
    const isNF = trade.index_key === 'NF';
    const threshold = isNF ? 100 : 300;

    // If you're in a bear trade and max pain moved DOWN significantly, 
    // institutions accept lower levels — your protection is weaker
    const isBearish = ['BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
    const isBullish = ['BULL_PUT','BULL_CALL'].includes(trade.strategy_type);

    if (isBearish && mpShift > threshold) {
      signals.push(`MaxPain shifted UP ${trade.entry_max_pain}→${chain.maxPain} (against bear thesis)`);
      severity += mpShift > threshold * 2 ? 2 : 1;
    }
    if (isBullish && mpShift < -threshold) {
      signals.push(`MaxPain shifted DOWN ${trade.entry_max_pain}→${chain.maxPain} (against bull thesis)`);
      severity += mpShift < -threshold * 2 ? 2 : 1;
    }
  }

  // ── Check 3: OI buildup at sell strike ──
  if (trade.entry_sell_oi && chain.sellStrikeOI) {
    // Check OI at all sell legs
    let currentSellOI = 0;
    for (let i = 1; i <= 4; i++) {
      const strike = trade[`leg${i}_strike`];
      const type = trade[`leg${i}_type`];
      const action = trade[`leg${i}_action`];
      if (strike && type && action === 'SELL') {
        const oiKey = `${strike}_${type}`;
        currentSellOI += chain.sellStrikeOI[oiKey] || 0;
      }
    }

    if (trade.entry_sell_oi > 0 && currentSellOI > 0) {
      const oiRatio = currentSellOI / trade.entry_sell_oi;
      if (oiRatio > 1.5) {
        signals.push(`OI at sell strike(s) up ${((oiRatio - 1) * 100).toFixed(0)}% (adversary pressure)`);
        severity += oiRatio > 2.0 ? 2 : 1;
      }
    }
  }

  return {
    intact: severity < 2,
    signals,
    severity: Math.min(3, severity) // 0=solid, 1=watch, 2=weakening, 3=broken
  };
}

// ═══════════════════════════════════════════════════
// ADVERSARIAL CONTROL INDEX
// "Who is in control of this trade right now?"
// -100 = opponent in full control, +100 = you in control
//
// Options trading is zero-sum: for every winner there's a loser.
// Mutual fund heavyweights use options to HEDGE their equity.
// They can afford to "lose" on options because they win on stocks.
// Max Pain works because institutions can push index toward
// settlement levels that minimize their combined exposure.
// ═══════════════════════════════════════════════════

function computeControlIndex(trade) {
  const result = { score: 0, signals: [], narrative: '' };

  // Determine trade direction
  const isBearTrade = ['BEAR_CALL','BEAR_PUT'].includes(trade.strategy_type);
  const isBullTrade = ['BULL_PUT','BULL_CALL'].includes(trade.strategy_type);
  const isIC = trade.strategy_type === 'IRON_CONDOR';
  const dirLabel = isBearTrade ? 'bear' : isBullTrade ? 'bull' : 'neutral';

  // Get chain data
  const key = `${trade.index_key}|${trade.expiry}`;
  let chain = (window._POSITION_CHAINS || {})[key];
  if (!chain) {
    const fc = window._CHAINS && window._CHAINS[trade.index_key] && window._CHAINS[trade.index_key][trade.expiry];
    if (fc) {
      const sellStrikeOI = {};
      for (const sk in fc.strikes) {
        const sd = fc.strikes[sk];
        if (sd.CE) sellStrikeOI[`${sk}_CE`] = sd.CE.oi || 0;
        if (sd.PE) sellStrikeOI[`${sk}_PE`] = sd.PE.oi || 0;
      }
      chain = { pcr: fc.pcr, maxPain: fc.maxPain, callOI: fc.callOI, putOI: fc.putOI, sellStrikeOI, spot: fc.spot };
    }
  }
  if (!chain) return result;

  let totalScore = 0, totalWeight = 0;

  // ── Signal 1: Max Pain Migration (35%) — "Are institutions with or against me?" ──
  if (trade.entry_max_pain && chain.maxPain) {
    const mpShift = chain.maxPain - trade.entry_max_pain;
    const isNF = trade.index_key === 'NF';
    const normFactor = trade.entry_max_pain * 0.02; // 2% of MP = full signal

    let mpScore = 0;
    if (isBearTrade) {
      // Bear wins when MP moves DOWN (institutions accept lower levels)
      mpScore = -mpShift / normFactor;
    } else if (isBullTrade) {
      // Bull wins when MP moves UP
      mpScore = mpShift / normFactor;
    } else if (isIC) {
      // IC wins when MP stays near center of sell strikes
      const sellStrikes = [];
      for (let i = 1; i <= 4; i++) {
        if (trade[`leg${i}_action`] === 'SELL' && trade[`leg${i}_strike`]) sellStrikes.push(trade[`leg${i}_strike`]);
      }
      if (sellStrikes.length >= 2) {
        const center = (Math.max(...sellStrikes) + Math.min(...sellStrikes)) / 2;
        const entryDist = Math.abs(trade.entry_max_pain - center);
        const currentDist = Math.abs(chain.maxPain - center);
        mpScore = (entryDist - currentDist) / normFactor; // Closer to center = better
      }
    }
    mpScore = Math.max(-1, Math.min(1, mpScore));

    const mpPts = Math.abs(mpShift);
    const mpDir = mpShift > 0 ? 'UP' : 'DOWN';
    const mpGood = mpScore > 0.1;
    const mpBad = mpScore < -0.1;
    result.signals.push({
      name: 'Max Pain',
      score: mpScore,
      detail: `${trade.entry_max_pain}→${chain.maxPain} (${mpDir} ${mpPts}pts)`,
      reading: mpGood ? 'Institutions aligning with you' : mpBad ? 'Institutions moving against you' : 'Stable'
    });
    totalScore += mpScore * 35; totalWeight += 35;
  }

  // ── Signal 2: Sell Strike OI (30%) — "Are they defending or abandoning my level?" ──
  if (trade.entry_sell_oi && chain.sellStrikeOI) {
    let currentSellOI = 0;
    for (let i = 1; i <= 4; i++) {
      const strike = trade[`leg${i}_strike`];
      const type = trade[`leg${i}_type`];
      const action = trade[`leg${i}_action`];
      if (strike && type && action === 'SELL') {
        currentSellOI += chain.sellStrikeOI[`${strike}_${type}`] || 0;
      }
    }

    if (currentSellOI > 0) {
      const oiChange = (currentSellOI - trade.entry_sell_oi) / trade.entry_sell_oi;
      // OI increasing = sellers defending your level = GOOD
      // OI decreasing = sellers retreating = BAD
      let oiScore = Math.max(-1, Math.min(1, oiChange * 2)); // ±50% change = full signal

      const pctChange = (oiChange * 100).toFixed(0);
      result.signals.push({
        name: 'Sell OI',
        score: oiScore,
        detail: `${(trade.entry_sell_oi/1000).toFixed(0)}K→${(currentSellOI/1000).toFixed(0)}K (${oiChange >= 0 ? '+' : ''}${pctChange}%)`,
        reading: oiScore > 0.1 ? 'Sellers defending your level' : oiScore < -0.1 ? 'Sellers retreating — losing confidence' : 'Stable'
      });
      totalScore += oiScore * 30; totalWeight += 30;
    }
  }

  // ── Signal 3: PCR Shift (25%) — "Is overall sentiment turning?" ──
  if (trade.entry_pcr && chain.pcr) {
    const pcrShift = chain.pcr - trade.entry_pcr;
    let pcrScore = 0;

    if (isBearTrade) {
      // Bear wins when PCR drops (calls getting sold = bearish)
      pcrScore = -pcrShift / 0.20; // ±0.20 shift = full signal
    } else if (isBullTrade) {
      // Bull wins when PCR rises (puts getting sold = bullish)
      pcrScore = pcrShift / 0.20;
    } else if (isIC) {
      // IC wants PCR stable near 1.0
      const entryDist = Math.abs(trade.entry_pcr - 1.0);
      const currentDist = Math.abs(chain.pcr - 1.0);
      pcrScore = (entryDist - currentDist) / 0.20;
    }
    pcrScore = Math.max(-1, Math.min(1, pcrScore));

    result.signals.push({
      name: 'PCR',
      score: pcrScore,
      detail: `${trade.entry_pcr}→${chain.pcr} (${pcrShift >= 0 ? '+' : ''}${pcrShift.toFixed(2)})`,
      reading: pcrScore > 0.1 ? 'Sentiment supporting your thesis' : pcrScore < -0.1 ? 'Sentiment shifting against you' : 'Neutral'
    });
    totalScore += pcrScore * 25; totalWeight += 25;
  }

  // ── Signal 4: Heavyweight Divergence (10%, BNF only) ──
  if (trade.index_key === 'BNF' && window._BNF_LIVE_BREADTH) {
    const breadth = window._BNF_LIVE_BREADTH; // { weightedPct, topStockDir }
    let hwScore = 0;
    if (isBearTrade) {
      // Bear wins when weighted breadth is negative (heavyweights falling)
      hwScore = Math.max(-1, Math.min(1, -breadth.weightedPct / 1.5));
    } else if (isBullTrade) {
      hwScore = Math.max(-1, Math.min(1, breadth.weightedPct / 1.5));
    }

    result.signals.push({
      name: 'Heavyweights',
      score: hwScore,
      detail: `Weighted: ${breadth.weightedPct >= 0 ? '+' : ''}${breadth.weightedPct.toFixed(2)}%`,
      reading: hwScore > 0.1 ? 'Big stocks aligned with you' : hwScore < -0.1 ? 'Heavyweight fighting your thesis' : 'Mixed'
    });
    totalScore += hwScore * 10; totalWeight += 10;
  }

  // Normalize to -100 to +100
  result.score = totalWeight > 0 ? Math.round(totalScore / totalWeight * 100) : 0;

  // Generate narrative
  const absScore = Math.abs(result.score);
  if (result.score > 30) {
    result.narrative = `You're in control (${result.score > 60 ? 'strong' : 'moderate'}) — thesis holders dominating`;
  } else if (result.score > 10) {
    result.narrative = 'Slight edge to you — watch for shifts';
  } else if (result.score > -10) {
    result.narrative = 'Contested — neither side has clear control';
  } else if (result.score > -30) {
    result.narrative = 'Opponent gaining ground — consider booking if profitable';
  } else {
    result.narrative = `Opponent in control (${result.score < -60 ? 'strong' : 'moderate'}) — protect capital`;
  }

  return result;
}

async function checkThesisAndNotify(openTrades) {
  if (!openTrades || !openTrades.length) return;

  for (const trade of openTrades) {
    // Calculate live P&L using shared function
    const livePnl = computeLivePnL(trade);
    const prevPeak = trade.peak_pnl || 0;
    const newPeak = Math.max(prevPeak, livePnl);
    trade.current_pnl = livePnl;
    trade.peak_pnl = newPeak;

    // Update Supabase with fresh P&L
    if (typeof dbUpdateTrade === 'function') {
      const liveSpot = (window._POSITION_CHAINS || {})[`${trade.index_key}|${trade.expiry}`]?.spot || gv(trade.index_key === 'NF' ? 'nf_price' : 'bn_price');
      const rec = computeRecommendation(trade, livePnl, liveSpot, trade.expiry);
      trade.recommendation = rec;
      dbUpdateTrade(trade.id, {
        current_pnl: livePnl,
        current_spot: liveSpot,
        peak_pnl: +newPeak.toFixed(0),
        recommendation: rec
      });
      console.log(`[auto] P&L: ${trade.strategy_type} ${trade.index_key} ₹${livePnl} (peak: ₹${newPeak}) → ${rec}`);
    }
  }

  // Fire notifications (market hours only)
  if (typeof isMarketHours === 'function' && !isMarketHours()) return;

  const now = Date.now();
  for (const trade of openTrades) {
    const rec = trade.recommendation || 'HOLD';
    const meta = ALERT_META[rec];
    if (!meta) continue;

    const pnl = trade.current_pnl || 0;
    const target = trade.target_profit || 0;
    const pct = target > 0 ? Math.round((pnl / target) * 100) : 0;
    const pnlStr = (pnl >= 0 ? '+' : '') + '₹' + pnl.toLocaleString('en-IN');
    const stratName = STRAT_LABELS[trade.strategy_type] || trade.strategy_type;
    const body = `P&L ${pnlStr} (${pct}% of target) · DTE ${daysTo(trade.expiry)}${trade._controlIndex ? ' · Control: '+(trade._controlIndex.score > 0 ? '+' : '')+trade._controlIndex.score : ''}`;

    // Urgent (EXIT_NOW, EXIT_EARLY, BOOK_PROFIT) → IMMEDIATE
    if (meta.priority >= 3) {
      fireNotification(`${meta.icon} ${meta.label} — ${stratName} ${trade.index_key}`, body, `mr-urgent-${rec}`);
    }
  }

  // Routine notification every 30 minutes for HOLD/TRAIL
  if (now - _lastRoutineNotif >= ROUTINE_INTERVAL) {
    const trade = openTrades[0];
    const pnl = trade.current_pnl || 0;
    const target = trade.target_profit || 0;
    const pct = target > 0 ? Math.round((pnl / target) * 100) : 0;
    const pnlStr = (pnl >= 0 ? '+' : '') + '₹' + pnl.toLocaleString('en-IN');
    const stratName = STRAT_LABELS[trade.strategy_type] || trade.strategy_type;
    const rec = trade.recommendation || 'HOLD';
    const meta = ALERT_META[rec] || ALERT_META.HOLD;
    fireNotification(`${meta.icon} ${meta.label} — ${stratName} ${trade.index_key}`, `P&L ${pnlStr} (${pct}%) · DTE ${daysTo(trade.expiry)}${trade._controlIndex ? ' · Ctrl:'+(trade._controlIndex.score > 0 ? '+' : '')+trade._controlIndex.score : ''}`, 'mr-routine');
    _lastRoutineNotif = now;
  }
}

// ═══════════════════════════════════════════════════
// LIVE P&L CALCULATOR — shared by card, banner, notifications
// ═══════════════════════════════════════════════════

function computeLivePnL(trade, legs) {
  if (!legs) {
    legs = [];
    for (let i = 1; i <= 4; i++) {
      if (trade[`leg${i}_strike`]) {
        legs.push({ strike: trade[`leg${i}_strike`], type: trade[`leg${i}_type`], action: trade[`leg${i}_action`], entry_ltp: trade[`leg${i}_entry_ltp`] || 0 });
      }
    }
  }
  if (legs.length === 0) return trade.current_pnl || 0;

  const fullChain = window._CHAINS && window._CHAINS[trade.index_key] && window._CHAINS[trade.index_key][trade.expiry];
  const posChainData = (window._POSITION_CHAINS || {})[`${trade.index_key}|${trade.expiry}`];
  const lotSize = trade.index_key === 'NF' ? NF_LOT_SIZE : BNF_LOT;
  const lots = trade.lots || 1;

  let calcPnl = 0, foundAll = true;
  for (const leg of legs) {
    let currentLtp = 0;
    // Try position chain FIRST (fresh from auto-fetch every 5 min)
    if (posChainData && posChainData.strikeLTPs) {
      currentLtp = posChainData.strikeLTPs[`${leg.strike}_${leg.type}`] || 0;
    }
    // Fallback to full chain (from last manual fetch)
    if (currentLtp === 0 && fullChain && fullChain.strikes && fullChain.strikes[leg.strike]) {
      const sd = fullChain.strikes[leg.strike];
      if (leg.type === 'PE' && sd.PE) currentLtp = sd.PE.ltp || 0;
      if (leg.type === 'CE' && sd.CE) currentLtp = sd.CE.ltp || 0;
    }
    if (currentLtp > 0 && leg.entry_ltp > 0) {
      const mult = leg.action === 'BUY' ? 1 : -1;
      calcPnl += mult * (currentLtp - leg.entry_ltp);
    } else {
      foundAll = false;
    }
  }
  return foundAll ? +(calcPnl * lotSize * lots).toFixed(0) : (trade.current_pnl || 0);
}

// ═══════════════════════════════════════════════════
// POSITIONS TAB RENDER
// ═══════════════════════════════════════════════════

async function renderPositionsTab() {
  const openEl = document.getElementById('positions-open');
  const histEl = document.getElementById('positions-history');
  if (!openEl) return;

  // ── Supabase is the source of truth — always query open trades ──
  const openTrades = typeof dbGetOpenTrades === 'function' ? await dbGetOpenTrades() : [];

  if (!openTrades.length) {
    openEl.innerHTML = '<div class="cmd-placeholder">No active positions</div>';
  } else {
    openEl.innerHTML = openTrades.map((trade, idx) => {
      const meta = ALERT_META[trade.recommendation] || ALERT_META.HOLD;

      // Build legs from flat Supabase fields
      const legs = [];
      for (let i = 1; i <= 4; i++) {
        if (trade[`leg${i}_strike`]) {
          legs.push({ strike: trade[`leg${i}_strike`], type: trade[`leg${i}_type`], action: trade[`leg${i}_action`], entry_ltp: trade[`leg${i}_entry_ltp`] || 0 });
        }
      }

      const legStr = legs.map(l => `${l.action} ${l.strike} ${l.type}`).join(' | ');

      // Live P&L from chains if available, else Supabase stored value
      let livePnl = computeLivePnL(trade, legs);
      if (livePnl === 0 && trade.current_pnl) livePnl = trade.current_pnl;

      const pnlClass = livePnl >= 0 ? 'profit' : 'loss';
      const peakPnl = Math.max(trade.peak_pnl || 0, livePnl);
      const peakStr = peakPnl > 0 ? ` · Peak: ₹${peakPnl.toLocaleString('en-IN')}` : '';
      const target = trade.target_profit || 0;
      const sl = trade.stop_loss || 0;
      const pct = target > 0 ? Math.round((livePnl / target) * 100) : 0;
      const dte = daysTo(trade.expiry);
      const stratName = STRAT_LABELS[trade.strategy_type] || trade.strategy_type;

      // Thesis check (returns default if no chain data)
      const thesis = checkThesis(trade);
      const thesisHTML = renderThesisDetails(trade, thesis, legs);

      return `<div class="pos-card">
        <div class="pos-card-header">
          <span class="pos-strat-name">${stratName}</span>
          <span class="pos-rec ${meta.css}">${meta.label}</span>
        </div>
        <div class="pos-card-index">${trade.index_key} · ${trade.expiry} · DTE ${dte}</div>
        <div class="pos-card-legs">${legStr}</div>
        <div class="pos-card-pnl">
          <span>P&L: <span class="${pnlClass}">₹${livePnl.toLocaleString('en-IN')}</span> (${pct}%)${peakStr}</span>
          <span>Target: ₹${target.toLocaleString('en-IN')} | SL: ₹${sl.toLocaleString('en-IN')}</span>
        </div>
        <div class="pos-card-toggle" data-idx="${idx}">▼ Details</div>
        <div class="pos-card-details" id="pos-details-${idx}" style="display:none">
          ${thesisHTML}
        </div>
      </div>`;
    }).join('');

    // Bind expandable toggle clicks
    document.querySelectorAll('.pos-card-toggle').forEach(el => {
      el.addEventListener('click', () => {
        const idx = el.dataset.idx;
        const details = document.getElementById(`pos-details-${idx}`);
        if (details) {
          const isOpen = details.style.display !== 'none';
          details.style.display = isOpen ? 'none' : 'block';
          el.textContent = isOpen ? '▼ Details' : '▲ Close';
        }
      });
    });
  }

  // Render recent trade history from Supabase
  if (!histEl) return;
  try {
    const allTrades = await dbGetAllTrades(10);
    if (!allTrades.length) { histEl.innerHTML = '<div class="cmd-placeholder">No trade history yet</div>'; return; }
    histEl.innerHTML = allTrades.map(t => {
      const statusClass = t.status === 'OPEN' ? 'status-open' : t.status === 'CLOSED' ? 'status-closed' : 'status-expired';
      const pnl = t.actual_pnl || t.current_pnl || 0;
      const pnlClass = pnl >= 0 ? 'profit' : 'loss';
      return `<div class="hist-row">
        <span class="hist-strat">${t.strategy_type}</span>
        <span class="hist-index">${t.index_key}</span>
        <span class="hist-expiry">${t.expiry}</span>
        <span class="${statusClass}">${t.status}</span>
        <span class="${pnlClass}">₹${pnl.toLocaleString('en-IN')}</span>
      </div>`;
    }).join('');
  } catch(e) {
    histEl.innerHTML = '<div class="cmd-placeholder">Could not load trade history</div>';
  }
}

// ── Thesis details for expandable position card ──
function renderThesisDetails(trade, thesis, legs) {
  let html = '<div class="pos-thesis">';

  // ── Adversarial Control Index ──
  const control = trade._controlIndex || computeControlIndex(trade);
  if (control.signals.length > 0) {
    const ci = control.score;
    const barPct = Math.min(100, Math.max(0, (ci + 100) / 2)); // 0=opponent, 100=you
    const barColor = ci > 30 ? '#22c55e' : ci > 10 ? '#8b5cf6' : ci > -10 ? '#f59e0b' : ci > -30 ? '#f97316' : '#ef4444';
    const ciLabel = ci > 0 ? `+${ci}` : `${ci}`;

    html += '<div class="pos-thesis-title">Control Index</div>';
    html += `<div class="pos-control-bar"><div class="pos-control-fill" style="width:${barPct}%;background:${barColor}"></div></div>`;
    html += `<div class="pos-control-label" style="color:${barColor}">Control: ${ciLabel} — ${control.narrative}</div>`;

    // Individual signals
    for (const sig of control.signals) {
      const sigColor = sig.score > 0.1 ? '#22c55e' : sig.score < -0.1 ? '#ef4444' : '#8a8a9a';
      const sigIcon = sig.score > 0.1 ? '✅' : sig.score < -0.1 ? '🔴' : '⚪';
      html += `<div class="pos-control-signal">${sigIcon} <strong>${sig.name}</strong>: ${sig.detail} <span style="color:${sigColor};font-size:11px">${sig.reading}</span></div>`;
    }
    html += '<div style="height:8px"></div>';
  }

  // Thesis health section
  html += '<div class="pos-thesis-title">Thesis Health</div>';
  if (thesis.signals.length > 0) {
    html += thesis.signals.map(s => {
      const icon = thesis.severity >= 2 ? '🔴' : '⚠️';
      return `<div class="pos-thesis-signal">${icon} ${s}</div>`;
    }).join('');
    html += `<div class="pos-thesis-severity">Severity: ${thesis.severity}/3 — ${thesis.intact ? 'Thesis intact' : 'Thesis weakening'}</div>`;
  } else {
    // No chain data available (weekend/pre-sync)
    const hasChainData = (window._CHAINS && window._CHAINS[trade.index_key] && window._CHAINS[trade.index_key][trade.expiry]) || (window._POSITION_CHAINS && window._POSITION_CHAINS[`${trade.index_key}|${trade.expiry}`]);
    if (hasChainData) {
      html += '<div class="pos-thesis-signal">✅ All checks passed — thesis intact</div>';
    } else {
      html += '<div class="pos-thesis-signal">⏳ Sync for live thesis check</div>';
    }
  }

  // Entry snapshot
  html += '<div class="pos-thesis-title" style="margin-top:8px">Entry Snapshot</div>';
  html += `<div class="pos-entry-row">Entry spot: ${trade.entry_spot ? trade.entry_spot.toLocaleString('en-IN') : '—'} | VIX: ${trade.entry_vix || '—'}</div>`;
  html += `<div class="pos-entry-row">Entry premium: ₹${trade.entry_premium || '—'} | Lots: ${trade.lots || 1}</div>`;
  html += `<div class="pos-entry-row">Max profit: ₹${(trade.max_profit||0).toLocaleString('en-IN')} | Max loss: ₹${(trade.max_loss||0).toLocaleString('en-IN')}</div>`;
  html += `<div class="pos-entry-row">Entered: ${trade.entry_date || '—'}${trade.entry_pcr ? ' | Entry PCR: '+trade.entry_pcr : ''}</div>`;
  if (trade.entry_bias) html += `<div class="pos-entry-row">Bias: ${trade.entry_bias} (net ${trade.entry_bias_net || '—'})</div>`;
  if (trade.entry_score) html += `<div class="pos-entry-row">Score: ${trade.entry_score} | Tier: ${trade.entry_varsity_tier || '—'}</div>`;
  if (trade.entry_call_wall || trade.entry_put_wall) html += `<div class="pos-entry-row">OI Walls: Call ${trade.entry_call_wall || '—'} | Put ${trade.entry_put_wall || '—'}</div>`;
  if (trade.entry_atm_iv) html += `<div class="pos-entry-row">ATM IV: ${trade.entry_atm_iv}%</div>`;
  if (trade.entry_fii_cash) html += `<div class="pos-entry-row">FII Cash: ₹${trade.entry_fii_cash} Cr</div>`;
  if (trade.entry_futures_premium != null) html += `<div class="pos-entry-row">Futures Premium: ${trade.entry_futures_premium > 0 ? '+' : ''}${trade.entry_futures_premium}%</div>`;

  // Legs with entry prices
  html += '<div class="pos-thesis-title" style="margin-top:8px">Legs</div>';
  for (const leg of legs) {
    html += `<div class="pos-entry-row">${leg.action} ${trade.index_key} ${leg.strike} ${leg.type} @ ₹${(leg.entry_ltp||0).toFixed(2)}</div>`;
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════
// PHASE 3: AUTO-EXPIRE + TRADE JOURNAL
// ═══════════════════════════════════════════════════

async function autoExpireOpenTrades() {
  if (typeof dbGetOpenTrades !== 'function') return;
  const openTrades = await dbGetOpenTrades();
  if (!openTrades.length) return;

  const today = new Date(); today.setHours(0,0,0,0);

  for (const trade of openTrades) {
    if (!trade.expiry) continue;
    const expDate = new Date(trade.expiry); expDate.setHours(0,0,0,0);
    if (expDate >= today) continue; // Not yet expired

    // Trade has expired — calculate final P&L
    let finalPnl = trade.current_pnl || 0;

    // If we have last known spot + legs, calculate intrinsic value at expiry
    const lastSpot = trade.current_spot || trade.entry_spot || 0;
    if (lastSpot > 0 && trade.leg1_strike) {
      const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
      const lotSize = trade.index_key === 'NF' ? NF_LOT_SIZE : BNF_LOT;
      const lots = trade.lots || 1;

      // Calculate intrinsic at expiry for each leg
      let intrinsic = 0;
      for (let i = 1; i <= 4; i++) {
        const strike = trade[`leg${i}_strike`];
        const type = trade[`leg${i}_type`];
        const action = trade[`leg${i}_action`];
        const entryLtp = trade[`leg${i}_entry_ltp`] || 0;
        if (!strike || !type || !action) continue;

        const expiryVal = type === 'CE' ? Math.max(lastSpot - strike, 0) : Math.max(strike - lastSpot, 0);
        const mult = action === 'SELL' ? -1 : 1;
        intrinsic += mult * (expiryVal - entryLtp);
      }
      finalPnl = +(intrinsic * lotSize * lots).toFixed(0);
    }

    if (typeof dbExpireTrade === 'function') {
      await dbExpireTrade(trade.id, finalPnl);
      console.log(`[journal] Auto-expired trade #${trade.id}: ${trade.strategy_type} ${trade.index_key} ${trade.expiry} → P&L ₹${finalPnl}`);
    }
  }
}

async function renderJournalTab() {
  const statsEl = document.getElementById('journal-stats');
  const tradesEl = document.getElementById('journal-trades');
  if (!statsEl) return;

  // Fetch stats
  const stats = typeof dbGetTradeStats === 'function' ? await dbGetTradeStats() : null;

  if (!stats) {
    statsEl.innerHTML = '<div class="cmd-placeholder">No closed trades yet — complete a trade to see journal</div>';
    if (tradesEl) tradesEl.innerHTML = '';
    return;
  }

  // Render stats summary
  const pnlClass = stats.totalPnl >= 0 ? 'profit' : 'loss';
  let stratRows = '';
  for (const st in stats.byStrat) {
    const s = stats.byStrat[st];
    const wr = s.total > 0 ? ((s.wins / s.total) * 100).toFixed(0) : 0;
    const spnl = s.pnl >= 0 ? 'profit' : 'loss';
    stratRows += `<div class="journal-strat-row"><span>${STRAT_LABELS[st] || st}</span><span>${s.wins}/${s.total} (${wr}%)</span><span class="${spnl}">₹${s.pnl.toLocaleString('en-IN')}</span></div>`;
  }

  statsEl.innerHTML = `
    <div class="journal-stats-grid">
      <div class="journal-stat"><div class="journal-stat-val ${pnlClass}">₹${stats.totalPnl.toLocaleString('en-IN')}</div><div class="journal-stat-label">Total P&L</div></div>
      <div class="journal-stat"><div class="journal-stat-val">${stats.winRate}%</div><div class="journal-stat-label">Win Rate (${stats.wins}/${stats.total})</div></div>
      <div class="journal-stat"><div class="journal-stat-val">₹${stats.avgPnl.toLocaleString('en-IN')}</div><div class="journal-stat-label">Avg P&L / Trade</div></div>
      <div class="journal-stat"><div class="journal-stat-val">${stats.total}</div><div class="journal-stat-label">Total Trades</div></div>
      <div class="journal-stat"><div class="journal-stat-val profit">₹${stats.bestTrade.pnl.toLocaleString('en-IN')}</div><div class="journal-stat-label">Best (${stats.bestTrade.type} ${stats.bestTrade.index})</div></div>
      <div class="journal-stat"><div class="journal-stat-val loss">₹${stats.worstTrade.pnl.toLocaleString('en-IN')}</div><div class="journal-stat-label">Worst (${stats.worstTrade.type} ${stats.worstTrade.index})</div></div>
    </div>
    ${stratRows ? '<div class="section-title" style="margin-top:8px;font-size:11px">By Strategy</div>' + stratRows : ''}
  `;

  // Render recent closed trades
  if (!tradesEl) return;
  const closed = typeof dbGetClosedTrades === 'function' ? await dbGetClosedTrades(15) : [];
  if (!closed.length) {
    tradesEl.innerHTML = '<div class="cmd-placeholder">No closed trades</div>';
    return;
  }

  tradesEl.innerHTML = closed.map((t, idx) => {
    const pnl = t.actual_pnl || 0;
    const pClass = pnl >= 0 ? 'profit' : 'loss';
    const reason = t.exit_reason || 'MANUAL';
    const reasonClass = reason === 'EXPIRY' ? 'reason-expiry' : reason === 'TARGET' ? 'reason-target' : reason.includes('SL') ? 'reason-sl' : 'reason-manual';
    const legs = [];
    for (let i = 1; i <= 4; i++) {
      if (t[`leg${i}_strike`]) legs.push(`${t[`leg${i}_action`]} ${t[`leg${i}_strike`]} ${t[`leg${i}_type`]}`);
    }
    const dissection = renderTradeDissection(t);
    return `<div class="journal-trade">
      <div class="journal-trade-header">
        <span class="journal-trade-strat">${STRAT_LABELS[t.strategy_type] || t.strategy_type}</span>
        <span class="journal-trade-pnl ${pClass}">${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}</span>
      </div>
      <div class="journal-trade-meta">${t.index_key} · ${t.expiry} · ${t.entry_date || '—'} → ${t.exit_date || '—'}</div>
      <div class="journal-trade-meta">${legs.join(' | ')}</div>
      <span class="journal-trade-reason ${reasonClass}">${reason}</span>
      <div class="journal-trade-toggle" data-idx="jt-${idx}">▼ Dissect Trade</div>
      <div class="journal-trade-dissection" id="jt-${idx}" style="display:none">
        ${dissection}
      </div>
    </div>`;
  }).join('');

  // Bind toggle clicks for dissection
  document.querySelectorAll('.journal-trade-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.idx;
      const details = document.getElementById(id);
      if (details) {
        const isOpen = details.style.display !== 'none';
        details.style.display = isOpen ? 'none' : 'block';
        el.textContent = isOpen ? '▼ Dissect Trade' : '▲ Close';
      }
    });
  });
}

// ═══════════════════════════════════════════════════
// PHASE 4: TRADE DISSECTION
// Post-trade analysis from rich entry snapshot
// ═══════════════════════════════════════════════════

function renderTradeDissection(trade) {
  const pnl = trade.actual_pnl || 0;
  const peak = trade.peak_pnl || 0;
  const target = trade.target_profit || 0;
  const maxProfit = trade.max_profit || 0;
  const maxLoss = trade.max_loss || 0;
  const sl = trade.stop_loss || 0;
  const isWin = pnl > 0;

  let html = '<div class="dissection">';

  // ── P&L Journey ──
  html += '<div class="dissect-title">P&L Journey</div>';
  const pctTarget = target > 0 ? ((pnl / target) * 100).toFixed(1) : '—';
  const pctMaxProfit = maxProfit > 0 ? ((pnl / maxProfit) * 100).toFixed(1) : '—';
  const peakPctTarget = target > 0 ? ((peak / target) * 100).toFixed(1) : '—';

  // Hold duration
  let holdDays = '—';
  if (trade.entry_date && trade.exit_date) {
    const entry = new Date(trade.entry_date);
    const exit = new Date(trade.exit_date);
    const calDays = Math.round((exit - entry) / 86400000);
    // Count trading days
    let tradingDays = 0;
    const d = new Date(entry);
    d.setDate(d.getDate() + 1);
    while (d <= exit) { if (isTradingDay(d)) tradingDays++; d.setDate(d.getDate() + 1); }
    holdDays = `${calDays} cal (${tradingDays} trading)`;
  }

  html += `<div class="dissect-row"><span>Exit P&L</span><span class="${isWin ? 'profit' : 'loss'}">${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}</span></div>`;
  html += `<div class="dissect-row"><span>Peak P&L</span><span class="profit">₹${peak.toLocaleString('en-IN')}</span></div>`;
  if (peak > 0 && pnl > 0 && pnl < peak) {
    const leftOnTable = peak - pnl;
    html += `<div class="dissect-row"><span>Left on table</span><span class="loss">₹${leftOnTable.toLocaleString('en-IN')}</span></div>`;
  }
  html += `<div class="dissect-row"><span>% of Target</span><span>${pctTarget}%</span></div>`;
  html += `<div class="dissect-row"><span>% of Max Profit</span><span>${pctMaxProfit}%</span></div>`;
  html += `<div class="dissect-row"><span>Peak % of Target</span><span>${peakPctTarget}%</span></div>`;
  html += `<div class="dissect-row"><span>Hold Duration</span><span>${holdDays}</span></div>`;

  // ── P&L Bar Visualization ──
  const barMax = Math.max(maxProfit, Math.abs(maxLoss || maxProfit));
  if (barMax > 0) {
    const slPct = sl > 0 ? Math.min((sl / barMax) * 100, 100) : 0;
    const pnlPct = Math.min(Math.abs(pnl) / barMax * 100, 100);
    const peakPct = Math.min(peak / barMax * 100, 100);
    const targetPct = target > 0 ? Math.min(target / barMax * 100, 100) : 0;
    const maxPct = Math.min(maxProfit / barMax * 100, 100);

    html += '<div class="dissect-pnl-bar">';
    if (isWin) {
      html += `<div class="pnl-bar-track">`;
      html += `<div class="pnl-bar-fill profit-fill" style="width:${pnlPct}%"></div>`;
      if (peakPct > pnlPct) html += `<div class="pnl-bar-peak" style="left:${peakPct}%" title="Peak"></div>`;
      if (targetPct > 0) html += `<div class="pnl-bar-marker target-marker" style="left:${targetPct}%" title="Target"></div>`;
      html += `<div class="pnl-bar-marker max-marker" style="left:${maxPct}%" title="Max"></div>`;
      html += `</div>`;
      html += `<div class="pnl-bar-labels"><span class="profit">₹${pnl.toLocaleString('en-IN')}</span><span>Target ₹${target.toLocaleString('en-IN')}</span><span>Max ₹${maxProfit.toLocaleString('en-IN')}</span></div>`;
    } else {
      html += `<div class="pnl-bar-track loss-track">`;
      html += `<div class="pnl-bar-fill loss-fill" style="width:${pnlPct}%"></div>`;
      if (slPct > 0) html += `<div class="pnl-bar-marker sl-marker" style="left:${slPct}%" title="SL"></div>`;
      html += `</div>`;
      html += `<div class="pnl-bar-labels"><span class="loss">₹${pnl.toLocaleString('en-IN')}</span><span>SL ₹${sl.toLocaleString('en-IN')}</span><span>Max Loss ₹${maxLoss.toLocaleString('en-IN')}</span></div>`;
    }
    html += '</div>';
  }

  // ── Entry Conditions ──
  const hasSnapshot = trade.entry_bias || trade.entry_score || trade.entry_call_wall || trade.entry_atm_iv;
  html += '<div class="dissect-title">Entry Conditions</div>';
  html += `<div class="dissect-row"><span>Entry Spot</span><span>${trade.entry_spot ? trade.entry_spot.toLocaleString('en-IN') : '—'}</span></div>`;
  html += `<div class="dissect-row"><span>Entry VIX</span><span>${trade.entry_vix || '—'}</span></div>`;
  html += `<div class="dissect-row"><span>Entry Premium</span><span>₹${trade.entry_premium || '—'}</span></div>`;
  if (trade.entry_pcr) html += `<div class="dissect-row"><span>Entry PCR</span><span>${trade.entry_pcr}</span></div>`;
  if (trade.entry_max_pain) html += `<div class="dissect-row"><span>Entry Max Pain</span><span>${trade.entry_max_pain.toLocaleString('en-IN')}</span></div>`;

  if (hasSnapshot) {
    // Rich snapshot available
    if (trade.entry_bias) html += `<div class="dissect-row"><span>Bias</span><span>${trade.entry_bias} (net ${trade.entry_bias_net || '—'})</span></div>`;
    if (trade.entry_score) html += `<div class="dissect-row"><span>Composite Score</span><span>${trade.entry_score}</span></div>`;
    if (trade.entry_varsity_tier) html += `<div class="dissect-row"><span>Varsity Tier</span><span>${trade.entry_varsity_tier}</span></div>`;
    if (trade.entry_call_wall) html += `<div class="dissect-row"><span>Call Wall</span><span>${trade.entry_call_wall.toLocaleString('en-IN')}</span></div>`;
    if (trade.entry_put_wall) html += `<div class="dissect-row"><span>Put Wall</span><span>${trade.entry_put_wall.toLocaleString('en-IN')}</span></div>`;
    if (trade.entry_total_call_oi && trade.entry_total_put_oi) html += `<div class="dissect-row"><span>Total OI</span><span>Call: ${(trade.entry_total_call_oi/1e6).toFixed(1)}M | Put: ${(trade.entry_total_put_oi/1e6).toFixed(1)}M</span></div>`;
    if (trade.entry_atm_iv) html += `<div class="dissect-row"><span>ATM IV</span><span>${trade.entry_atm_iv}%</span></div>`;
    if (trade.entry_fii_cash) html += `<div class="dissect-row"><span>FII Cash</span><span>₹${trade.entry_fii_cash.toLocaleString('en-IN')} Cr</span></div>`;
    if (trade.entry_close_char != null) html += `<div class="dissect-row"><span>Close Char</span><span>${trade.entry_close_char}</span></div>`;
    if (trade.entry_futures_premium != null) html += `<div class="dissect-row"><span>Futures Premium</span><span>${trade.entry_futures_premium > 0 ? '+' : ''}${trade.entry_futures_premium}%</span></div>`;
  } else {
    html += '<div class="dissect-note">Rich snapshot not available — trade logged before Phase 3.1</div>';
  }

  // ── Leg Details ──
  html += '<div class="dissect-title">Legs</div>';
  for (let i = 1; i <= 4; i++) {
    if (trade[`leg${i}_strike`]) {
      html += `<div class="dissect-row"><span>${trade[`leg${i}_action`]} ${trade.index_key} ${trade[`leg${i}_strike`]} ${trade[`leg${i}_type`]}</span><span>@ ₹${(trade[`leg${i}_entry_ltp`] || 0).toFixed(2)}</span></div>`;
    }
  }

  // ── Outcome Scoring ──
  html += '<div class="dissect-title">Trade Score Card</div>';

  // Bias accuracy
  if (trade.entry_bias) {
    const biasDir = trade.entry_bias.includes('BEAR') ? 'BEAR' : trade.entry_bias.includes('BULL') ? 'BULL' : 'NEUTRAL';
    const isCredit = ['BULL_PUT','BEAR_CALL','IRON_CONDOR'].includes(trade.strategy_type);
    const isDebitBear = trade.strategy_type === 'BEAR_PUT';
    const isDebitBull = trade.strategy_type === 'BULL_CALL';

    let biasCorrect = false;
    if (isWin) {
      // Win = bias was correct for the strategy type
      biasCorrect = true;
    } else if (biasDir === 'BEAR' && (isDebitBear || trade.strategy_type === 'BEAR_CALL')) {
      biasCorrect = pnl > -sl * 0.3; // Mild loss on correct bias = timing issue
    }
    html += `<div class="dissect-score-row">${biasCorrect ? '✅' : '❌'} Bias: ${trade.entry_bias} — ${biasCorrect ? 'direction correct' : 'direction wrong'}</div>`;
  }

  // Target achievement
  if (target > 0) {
    const targetPct = (pnl / target) * 100;
    const icon = targetPct >= 80 ? '✅' : targetPct >= 30 ? '⚠️' : '❌';
    html += `<div class="dissect-score-row">${icon} Target: ${targetPct.toFixed(0)}% achieved (₹${pnl.toLocaleString('en-IN')} of ₹${target.toLocaleString('en-IN')})</div>`;
  }

  // Risk management
  if (sl > 0) {
    const slHit = pnl <= -sl;
    html += `<div class="dissect-score-row">${slHit ? '❌' : '✅'} Risk: ${slHit ? 'SL hit' : 'SL not hit'} (limit ₹${sl.toLocaleString('en-IN')})</div>`;
  }

  // Exit efficiency (did we leave money on the table?)
  if (peak > 0 && pnl > 0) {
    const captureRate = ((pnl / peak) * 100).toFixed(0);
    const icon = captureRate >= 70 ? '✅' : captureRate >= 40 ? '⚠️' : '❌';
    html += `<div class="dissect-score-row">${icon} Capture: ${captureRate}% of peak (peak ₹${peak.toLocaleString('en-IN')}, exited ₹${pnl.toLocaleString('en-IN')})</div>`;
  }

  // Hold timing
  if (trade.entry_date && trade.exit_date) {
    const entry = new Date(trade.entry_date);
    const exit = new Date(trade.exit_date);
    const expiry = trade.expiry ? new Date(trade.expiry) : null;
    if (expiry) {
      const totalDte = Math.round((expiry - entry) / 86400000);
      const usedDte = Math.round((exit - entry) / 86400000);
      const pctUsed = totalDte > 0 ? ((usedDte / totalDte) * 100).toFixed(0) : '—';
      const icon = isWin ? (usedDte <= totalDte * 0.5 ? '✅' : '⚠️') : (usedDte >= totalDte * 0.8 ? '❌' : '⚠️');
      html += `<div class="dissect-score-row">${icon} Timing: used ${usedDte}/${totalDte} DTE (${pctUsed}%)</div>`;
    }
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      const n = parseInt(tab.id.replace('t',''));
      go(n);
      // Render journal when switching to CLOSE tab
      if (n === 3) renderJournalTab();
    });
  });
  const lr=document.getElementById('btn-lock-radar'); if(lr) lr.addEventListener('click',toggleRadar);
  const lb=document.getElementById('btn-lock-breadth'); if(lb) lb.addEventListener('click',toggleBreadth);
  const le=document.getElementById('btn-lock-evening'); if(le) le.addEventListener('click',toggleEvening);
  const bh=document.getElementById('btn-bhav-upload'); if(bh) bh.addEventListener('click',handleBhavUpload);
  const dbg=document.getElementById('btn-debug'); if(dbg) dbg.addEventListener('click',showDebug);
  // BNF breadth section collapse/expand
  const bnfTgl=document.getElementById('bnf-toggle');
  if(bnfTgl) bnfTgl.addEventListener('click',()=>{
    const body=document.getElementById('bnf-body'), arrow=document.getElementById('bnf-arrow');
    if(body){const open=body.style.display!=='none';body.style.display=open?'none':'block';if(arrow)arrow.textContent=open?'▼':'▲';}
  });
  initInputListeners(); initDrawer(); restoreSavedState(); renderEveningSection(); updateBnfReadout(); calcScore(); go(0);
  // Load positions + auto-expire + journal on startup
  renderPositionsTab();
  autoExpireOpenTrades();
  console.log('[app.js] Market Radar v5.0 — Phase 5: Expandable Q1 + Weighted Breadth + Futures Premium Bias');
});
