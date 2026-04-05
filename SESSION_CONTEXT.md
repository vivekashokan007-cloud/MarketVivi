# Market Radar v2.1 — Session Context

> **Last Updated**: April 5, 2026  
> **Status**: All P0/P1 bugs fixed, pushed to GitHub  
> **Repo**: github.com/vivekashokan007-cloud/MarketVivi  
> **Live**: vivekashokan007-cloud.github.io/MarketVivi

---

## What This Project Is

A **premium-first options trading PWA** for NSE (Nifty 50 + Bank Nifty). Runs on Samsung S23 Ultra. Built with Claude AI, audited + fixed by Antigravity.

### Stack
- **Frontend**: Vanilla JS (no framework), Roboto font, Upstox-matched theme
- **API**: Upstox v2 (read-only analytics token, 1-year expiry)
- **Database**: Supabase (PostgreSQL + RLS)
- **Brain**: Pyodide (Python 3.11 in WebAssembly, no server)
- **Hosting**: GitHub Pages

### Files (6 source files, ~8,500 lines)
| File | Lines | Purpose |
|------|-------|---------|
| app.js | 6,874 | Core engine: bias, forces, candidates, polling, rendering |
| api.js | 535 | Upstox API wrapper, chain parsing, DTE, market hours |
| db.js | 367 | Supabase CRUD layer |
| bs.js | 147 | Black-Scholes: IV solver, delta, theta, sigma engine |
| style.css | ~850 | Upstox-matched theme (light/dark) |
| index.html | 216 | PWA shell, 4 tabs |

---

## What Was Done (April 5, 2026)

### 1. Environment Restored
- Created `bs.js`, `style.css`, `manifest.json` from Claude's output
- Verified all 6 files present and functional

### 2. Comprehensive Audit
- Read every line of all 6 files
- Created detailed knowledge base (see `PROJECT_KNOWLEDGE.md` in repo)
- Mapped all data flows, calibration data, and strategic alignment

### 3. Bug Fixes Applied (6 bugs, 19 edits)

| Bug | File | Fix |
|-----|------|-----|
| `\|\|` treats 0 as null | db.js:44-46 | `\|\|` → `??` on diiCash, fiiIdxFut, fiiStkFut |
| UTC in tradingDTE | api.js:268 | `toISOString` → `toLocaleDateString('en-CA')` |
| UTC in isMarketHours | api.js:302 | Same fix |
| IV threshold too aggressive | api.js:129,147 | `< 5` → `< 1` |
| 12× UTC "today" dates | app.js (12 lines) | All → `API.todayIST()` (new utility) |
| Poll history DB bloat | app.js:6795+ | Auto-cleanup keys >7 days old |

### 4. Git + GitHub Setup
- Initialized git repo
- Pushed all 19 files to `vivekashokan007-cloud/MarketVivi`
- Created `/push` workflow for future pushes

---

## What's Next (Priority Order)

### Near-Term (Next Session)
1. [ ] **Intraday/Swing toggle** — `STATE.tradeMode` exists but needs UI binding
2. [ ] **VIX direction qualifier** on strategy cards
3. [ ] **Journal field** in trade lifecycle (combat attribution bias)

### Long-Term
1. [ ] **Modularize app.js** into 4 files: Engine, Render, Brain, Trade
2. [ ] **Kelly % display** after 15+ closed trades
3. [ ] **Evening chain visualization** (gap classification)
4. [ ] **Performance** — debounce renderAll(), virtualize OI table

---

## Key Context for AI Assistants

### DO NOT CHANGE
- `bs.js` calibration constants (from 274 NF + 134 BNF observations)
- Strike distance: MIN_SIGMA_OTM = 0.5, sweet spot = 0.5–0.8σ
- Transaction cost model (calibrated from 25 paper trades)
- Force alignment engine (3/3 forces must align for entry)

### Architecture Decisions
- **No framework** — vanilla JS by design (mobile PWA, offline-first)
- **Pyodide Brain** — Python in WASM, no server dependency
- **Single file (app.js)** — intentional for now, modularization is planned
- **Upstox token hardcoded** — read-only, no order placement, 1-year expiry

### Git Workflow
```
$env:Path += ";C:\Program Files\Git\bin"
git add -A
git commit -m "message"
git push origin main
```

---

## For Detailed Reference
- **Full Knowledge Base**: See `PROJECT_KNOWLEDGE.md` in repo root
- **Varsity Alignment**: See `VARSITY_COMPARISON.md` in repo root
- **Audit Brief**: See `REVIEW_BRIEF.md` in repo root
