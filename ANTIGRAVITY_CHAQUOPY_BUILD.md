# Antigravity: Kotlin + Chaquopy Build Brief
## Market Radar v2.1 · Tonight's Build · Apr 10, 2026

---

## CONTEXT — WHY THIS BUILD

We asked ChatGPT and Gemini Pro the same question: "Will a foreground service + WAKE_LOCK keep WebView JS alive in background?"

**Both said NO.** WebView renderer runs in a separate sandboxed process. Android suspends it independently of the app process. No amount of WAKE_LOCK or foreground service keeps JS timers alive.

**Consensus architecture:** Kotlin becomes the polling engine. WebView becomes UI only. Python brain moves from Pyodide (WASM inside WebView) to Chaquopy (native CPython inside Kotlin).

---

## THE ARCHITECTURE

```
┌──────────────────────────────────────────┐
│         MarketWatchService (Kotlin)        │
│         Foreground Service — ALWAYS ALIVE  │
│                                            │
│  ┌─────────────┐  ┌────────────────────┐  │
│  │ Poll Timer   │  │ Chaquopy Brain     │  │
│  │ 5-min loop   │  │ brain.py (54 funcs)│  │
│  │ Coroutine    │  │ Native CPython     │  │
│  └──────┬──────┘  └────────┬───────────┘  │
│         │                   │              │
│  ┌──────┴──────┐  ┌────────┴───────────┐  │
│  │ OkHttp      │  │ Alert Engine       │  │
│  │ Upstox API  │  │ Native Notifications│  │
│  └──────┬──────┘  └────────────────────┘  │
│         │                                  │
│  ┌──────┴──────────────────────────────┐  │
│  │ Data Store (SharedPreferences/JSON) │  │
│  │ latestPoll, pollHistory, brainResult│  │
│  └─────────────────────────────────────┘  │
└──────────────────┬───────────────────────┘
                   │
            NativeBridge
         (JS pulls on resume)
                   │
┌──────────────────┴───────────────────────┐
│            WebView (UI ONLY)              │
│  Renders charts, cards, tabs, inputs      │
│  Push to GitHub → live instantly          │
│  On resume: pulls data from Kotlin        │
│  Full Pyodide brain ALSO runs for UI      │
└───────────────────────────────────────────┘
```

---

## WHAT YOU NEED TO BUILD (5 files)

### File 1: MarketWatchService.kt — THE POLLING ENGINE

This is the core. A foreground service that:

1. Shows persistent notification: "📊 Market Radar watching · NF 24013 · VIX 18.9"
2. Runs a coroutine timer every 5 minutes (only during market hours 9:15-15:30 IST)
3. Calls Upstox API via OkHttp:
   - `GET /v2/market-quote/quotes?instrument_key=NSE_INDEX|Nifty Bank,NSE_INDEX|Nifty 50,NSE_INDEX|India VIX`
   - `GET /v2/option/chain?instrument_key=NSE_INDEX|Nifty Bank&expiry_date=YYYY-MM-DD`
4. Parses response JSON
5. Stores poll data in memory + SharedPreferences (survives process restart)
6. Runs brain.py via Chaquopy with poll data as input
7. Checks brain output for alerts → fires native notifications
8. Updates the persistent notification with latest spot/VIX

**Upstox API details:**
- Base URL: `https://api.upstox.com/v2`
- Auth header: `Authorization: Bearer <access_token>`
- The access token is currently hardcoded in api.js. I'll provide it.
- Response format: JSON with `data` array containing market quotes

**Market hours check:**
```kotlin
fun isMarketOpen(): Boolean {
    val ist = java.util.TimeZone.getTimeZone("Asia/Kolkata")
    val cal = java.util.Calendar.getInstance(ist)
    val day = cal.get(Calendar.DAY_OF_WEEK)
    if (day == Calendar.SATURDAY || day == Calendar.SUNDAY) return false
    val mins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    return mins in 555..930  // 9:15 AM to 3:30 PM IST
}
```

**What to store per poll (JSON):**
```json
{
    "t": "10:15",
    "bnf": 55764,
    "nf": 24013,
    "vix": 18.9,
    "pcr": 1.2,
    "cw": 57000,
    "cwOI": 682650,
    "pw": 54000,
    "pwOI": 523400,
    "fp": 0.12,
    "straddle": 2300,
    "bnfCOI": 1250000,
    "bnfPOI": 980000
}
```

### File 2: brain.py — THE PYTHON BRAIN (Chaquopy)

This is the EXACT same Python code currently embedded in app.js (lines 140-2286). 
It's 54 functions, ~2100 lines of pure Python using only `json` and `math` (stdlib).

**I will provide this file separately** — extracted from app.js with zero modifications. 
The entry point is:
```python
def analyze(poll_json, trades_json, baseline_json, open_trades_json, 
            candidates_json, strike_oi_json, context_json='{}'):
    # Returns JSON string with verdict, market insights, position verdicts
```

For the Kotlin background service, we need a SIMPLER entry point:
```python
def background_analyze(polls_json, baseline_json, open_trades_json):
    """Lightweight analysis for background service.
    Returns: {alerts: [{type, title, body, urgency}], summary: str}"""
    # Subset of full brain — danger detection + regime + effective bias
```

### File 3: MainActivity.kt — UPDATED

Changes from current:
- NativeBridge adds data-pull methods:
  - `getLatestPoll()` → returns latest poll JSON
  - `getPollHistory()` → returns today's poll array JSON  
  - `getBrainResult()` → returns latest brain analysis JSON
  - `getServiceStatus()` → returns {isRunning, pollCount, lastPollTime}
- On `onResume()`: pushes latest data to WebView via `evaluateJavascript`
- Starts service on app open (if market hours)
- Stops service after market close

### File 4: AndroidManifest.xml — UPDATED

Same as before but add:
- Chaquopy configuration
- OkHttp internet permission (already have INTERNET)

### File 5: build.gradle (app level) — UPDATED

Add dependencies:
```gradle
plugins {
    id 'com.chaquo.python'  // Chaquopy plugin
}

android {
    defaultConfig {
        python {
            version "3.11"
            pip {
                // No external packages needed — brain uses only json + math (stdlib)
            }
        }
    }
}

dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
}
```

Also add to project-level build.gradle:
```gradle
plugins {
    id 'com.chaquo.python' version '15.0.1' apply false
}
```

---

## NATIVEBRIDGE CONTRACT

The JS ↔ Kotlin bridge. JS calls these methods via `window.NativeBridge.methodName()`:

### Kotlin → JS (already exist, keep):
```kotlin
@JavascriptInterface fun isNative(): Boolean = true
@JavascriptInterface fun startMarketService()   // starts foreground service
@JavascriptInterface fun stopMarketService()    // stops service
@JavascriptInterface fun sendNotification(title: String, body: String, type: String)
@JavascriptInterface fun saveFile(base64: String, name: String, mime: String)
@JavascriptInterface fun getAppVersion(): String
```

### NEW — Data pull (JS calls to get background data):
```kotlin
@JavascriptInterface fun getLatestPoll(): String        // latest poll JSON
@JavascriptInterface fun getPollHistory(): String       // today's polls array JSON
@JavascriptInterface fun getBrainResult(): String       // latest brain output JSON
@JavascriptInterface fun getServiceStatus(): String     // {running, polls, lastPoll}
@JavascriptInterface fun getOpenTrades(): String        // open trades (synced from JS)
```

### NEW — Data push (JS sends to Kotlin for background monitoring):
```kotlin
@JavascriptInterface fun setOpenTrades(json: String)    // JS sends open trades to Kotlin
@JavascriptInterface fun setBaseline(json: String)      // JS sends morning baseline
@JavascriptInterface fun setApiToken(token: String)     // JS sends Upstox token
@JavascriptInterface fun setExpiries(bnf: String, nf: String)  // expiry dates
```

---

## THE UPSTOX API

### Authentication
The access token is refreshed daily. Currently hardcoded in api.js:
```javascript
const TOKEN = 'eyJ...';  // ~800 char JWT
```

For Kotlin, JS passes this token via `NativeBridge.setApiToken(token)` on app open.

### Endpoints needed

**1. Spots (VIX, BNF, NF):**
```
GET /v2/market-quote/quotes?instrument_key=NSE_INDEX|Nifty Bank,NSE_INDEX|Nifty 50,NSE_INDEX|India VIX
Headers: Authorization: Bearer <token>, Accept: application/json
```

Response structure:
```json
{
    "data": {
        "NSE_INDEX:Nifty Bank": {
            "last_price": 55764.5,
            "ohlc": {"open": 55200, "high": 55900, "low": 55100, "close": 55500}
        },
        "NSE_INDEX:Nifty 50": { "last_price": 24013.2 },
        "NSE_INDEX:India VIX": { "last_price": 18.9 }
    }
}
```

**2. Option Chain (BNF):**
```
GET /v2/option/chain?instrument_key=NSE_INDEX|Nifty Bank&expiry_date=2026-04-17
Headers: Authorization: Bearer <token>, Accept: application/json
```

Response: ~50KB JSON with strike-by-strike data (OI, LTP, IV, Greeks for CE and PE).

### Rate limits
Upstox allows ~250 requests/minute. We make 3 requests per poll (spots + BNF chain + NF chain) × 72 polls/day = 216 total. Well within limits.

---

## ALERT LOGIC FOR BACKGROUND SERVICE

The Kotlin service doesn't need the FULL 54-function brain for alerts. It needs:

### Critical alerts (fire native notification immediately):
1. **Spot breached sell strike** — spot > sell_strike for Bear Call, spot < sell_strike for Bull Put
2. **VIX spike** — VIX rose > 2.0 since entry
3. **Wall collapsed** — call wall moved below sell strike (for Bear Call)

### These need open trade data from JS:
```json
{
    "id": "t_123",
    "strategy_type": "BEAR_CALL",
    "sell_strike": 55300,
    "buy_strike": 55800,
    "index_key": "BNF",
    "entry_vix": 20.4,
    "is_credit": true,
    "paper": false
}
```

JS sends this via `NativeBridge.setOpenTrades(JSON.stringify(STATE.openTrades))` whenever trades change.

---

## CHAQUOPY BRAIN INTEGRATION

### Phase 1 (tonight): Simple background alerts in Kotlin
- Kotlin checks spot vs sell_strike, VIX change, wall movement
- No Chaquopy yet — pure Kotlin logic
- Fast to build, covers 80% of alert scenarios

### Phase 2 (this weekend): Full brain via Chaquopy
- brain.py extracted from app.js (I provide the file)
- Kotlin calls `background_analyze(polls, baseline, trades)` every poll
- Brain returns alerts with full danger scoring
- 100% coverage

### Phase 3 (next week): Brain runs ONLY in Chaquopy
- Remove Pyodide from WebView entirely
- WebView calls `NativeBridge.runBrain()` which runs Chaquopy
- Single source of truth for brain logic
- ~20MB smaller app (no Pyodide WASM download)

---

## WHAT I (CLAUDE) PROVIDE

1. **brain.py** — extracted Python brain (54 functions, 2100 lines, pure stdlib)
2. **background_brain.py** — lightweight version for background alerts (subset)
3. **Updated app.js** — JS-side NativeBridge calls for data push/pull
4. **Updated EFFECTIVE_BIAS_DESIGN.md** — latest design doc

## WHAT ANTIGRAVITY BUILDS

1. **MarketWatchService.kt** — foreground service with OkHttp polling + coroutine timer
2. **MainActivity.kt** — updated NativeBridge with data pull/push methods
3. **build.gradle** — Chaquopy + OkHttp dependencies
4. **AndroidManifest.xml** — service declaration + permissions
5. **Integration guide** — step by step for Android Studio

---

## CRITICAL NOTES

1. **Upstox token expires daily.** JS must pass fresh token to Kotlin on each app open via `NativeBridge.setApiToken()`. If token expires while app is in background, polling should gracefully skip (not crash) and retry on next cycle.

2. **Expiry dates change weekly.** JS must pass current expiry dates via `NativeBridge.setExpiries()`. Without correct expiry, chain fetch fails.

3. **SharedPreferences for persistence.** Poll history stored in SharedPreferences (JSON string). When app opens, JS pulls via `NativeBridge.getPollHistory()`. Maximum 100 polls stored (trim oldest).

4. **Thread safety.** Chaquopy Python runs on a background thread. OkHttp calls run on IO thread. SharedPreferences access must be synchronized. Use `@Synchronized` or `Mutex`.

5. **Notification channels.** Two channels:
   - `market_radar_service` (LOW priority) — persistent "watching" notification
   - `market_radar_alerts` (HIGH priority) — brain alerts (EXIT, DANGER)

6. **Service lifecycle:**
   - Start: When user opens app during market hours OR Lock & Scan
   - Stop: Auto-stop at 3:35 PM IST (5 min after market close)
   - Restart: `START_STICKY` — Android restarts if killed
   - On restart: Load poll history from SharedPreferences, resume polling

7. **The WebView still works independently.** If Kotlin service isn't running (first install, or service crashed), the WebView PWA still functions as before — just without background polling. Graceful degradation.

---

## TONIGHT'S BUILD ORDER

1. **First:** Get Chaquopy working in Android Studio (plugin, build.gradle, hello world)
2. **Second:** Build MarketWatchService with OkHttp polling (no brain yet)
3. **Third:** Add NativeBridge data methods to MainActivity
4. **Fourth:** Test: open app → start service → minimize → check notifications
5. **Fifth:** Add brain.py via Chaquopy → run in service
6. **Sixth:** Test full loop: poll → brain → alert → notification

Take it step by step. Each step is independently testable. Don't try to build everything at once.
