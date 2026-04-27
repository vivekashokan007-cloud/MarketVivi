/* ═══════════════════════════════════════════════════════════════════════════
 * log-viewer.js — In-app log viewer for Marketapp APK (Directive LV.1)
 *
 * Architecture: pure renderer.
 *   - Capture, filtering, dedup, ring buffer, mode probe → all in Kotlin
 *   - This file: display, gestures, formatting only
 *
 * Bridge contract (provided by Marketapp NativeBridge.kt):
 *   getLogBuffer(filterJson: string|null) → JSON array of {ts, level, tag, msg}
 *   clearLogBuffer() → boolean
 *   getLogCaptureMode() → "LOGCAT" | "LOGTAP" | "UNINITIALIZED"
 *
 * Integration: see LOG_VIEWER_INTEGRATION.md.
 *
 * Date: 2026-04-27
 * ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // Bridge resolution — adjust here if MarketVivi uses a different bridge name
  // ─────────────────────────────────────────────────────────────────────────
  function getBridge() {
    return window.NativeBridge || window.Android || null;
  }

  function bridgeAvailable() {
    const b = getBridge();
    return !!(b && typeof b.getLogBuffer === 'function');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Style injection — runs at script-eval time
  // ─────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('lv-styles')) return;
    const style = document.createElement('style');
    style.id = 'lv-styles';
    style.textContent = `
      #tab-logs.active {
        display: flex;
        flex-direction: column;
        min-height: 60vh;
        background: #0f172a;
        color: #e2e8f0;
        overflow: hidden;
        padding: 0;
      }
      .lv-header {
        padding: 8px;
        background: #1e293b;
        border-bottom: 1px solid #334155;
        position: sticky;
        top: 0;
        z-index: 10;
        flex-shrink: 0;
      }
      .lv-mode-row, .lv-controls-row, .lv-actions-row {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-bottom: 6px;
      }
      .lv-actions-row { margin-bottom: 0; }
      .lv-mode-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 10px;
        letter-spacing: 0.5px;
      }
      .lv-mode-logcat        { background: #14532d; color: #86efac; }
      .lv-mode-logtap        { background: #713f12; color: #fcd34d; }
      .lv-mode-uninitialized { background: #334155; color: #94a3b8; }
      .lv-count {
        font-size: 11px;
        color: #94a3b8;
        margin-left: auto;
      }
      .lv-controls-row select {
        flex: 1;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid #334155;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 12px;
      }
      .lv-live-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #cbd5e1;
        white-space: nowrap;
      }
      .lv-btn {
        flex: 1;
        background: #334155;
        color: #e2e8f0;
        border: 1px solid #475569;
        padding: 8px 4px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        min-height: 36px;
      }
      .lv-btn:active { background: #475569; }
      .lv-btn-danger {
        background: #7f1d1d;
        border-color: #991b1b;
      }
      .lv-pull-indicator {
        text-align: center;
        font-size: 11px;
        color: #64748b;
        padding: 4px;
        background: #1e293b;
        flex-shrink: 0;
        transition: transform 0.15s ease-out;
      }
      .lv-list {
        flex: 1;
        overflow-y: auto;
        font-family: 'Courier New', Consolas, monospace;
        font-size: 11px;
        line-height: 1.4;
        padding: 4px;
        -webkit-overflow-scrolling: touch;
      }
      .lv-entry {
        padding: 3px 4px;
        border-bottom: 1px solid #1e293b;
        word-break: break-all;
        white-space: pre-wrap;
      }
      .lv-ts { color: #64748b; margin-right: 6px; }
      .lv-level {
        display: inline-block;
        width: 12px;
        font-weight: 700;
        margin-right: 4px;
        text-align: center;
      }
      .lv-tag { color: #818cf8; margin-right: 6px; }
      .lv-sev-error .lv-msg,
      .lv-sev-error .lv-level { color: #f87171; }
      .lv-sev-warn .lv-msg,
      .lv-sev-warn .lv-level  { color: #fbbf24; }
      .lv-empty {
        padding: 24px 16px;
        text-align: center;
        color: #64748b;
        font-size: 12px;
      }
      .lv-flash {
        background: #1e40af;
        color: white;
        padding: 8px 12px;
        text-align: center;
        font-size: 12px;
        animation: lv-flash-fade 2.5s forwards;
      }
      @keyframes lv-flash-fade {
        0% { opacity: 1; }
        80% { opacity: 1; }
        100% { opacity: 0; }
      }
      .lv-pwa-fallback {
        padding: 24px 16px;
        text-align: center;
        color: #94a3b8;
        font-size: 13px;
      }
      .lv-hidden { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM injection — runs on DOMContentLoaded
  //
  // If index.html already contains <div id="tab-logs" class="tab-content"></div>
  // (preferred — matches MarketVivi convention), populate it.
  // Otherwise create one and append to body.
  // ─────────────────────────────────────────────────────────────────────────
  function injectDom() {
    let container = document.getElementById('tab-logs');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tab-logs';
      container.className = 'tab-content';
      document.body.appendChild(container);
    }
    // Skip if already populated (idempotent)
    if (container.querySelector('.lv-header')) return;
    container.innerHTML = `
      <div class="lv-header">
        <div class="lv-mode-row">
          <span class="lv-mode-badge lv-mode-uninitialized" id="lvModeBadge">…</span>
          <span class="lv-count" id="lvCount">0 entries</span>
        </div>
        <div class="lv-controls-row">
          <select id="lvFilter">
            <option value="ALL">ALL</option>
            <option value="Kotlin">Kotlin</option>
            <option value="Python">Python</option>
            <option value="OkHttp">OkHttp</option>
            <option value="Errors">Errors only</option>
          </select>
          <label class="lv-live-toggle">
            <input type="checkbox" id="lvLive">
            <span>Live</span>
          </label>
        </div>
        <div class="lv-actions-row">
          <button class="lv-btn" id="lvRefresh">↻ Refresh</button>
          <button class="lv-btn" id="lvShare">⇪ Share</button>
          <button class="lv-btn lv-btn-danger" id="lvClear">🗑 Clear</button>
        </div>
      </div>
      <div class="lv-pull-indicator" id="lvPullIndicator">Pull to refresh</div>
      <div class="lv-list" id="lvList">
        <div class="lv-empty">No logs yet. Pull down to refresh or wait for activity.</div>
      </div>
      <div class="lv-pwa-fallback lv-hidden" id="lvPwaFallback">
        Log viewer requires APK. Currently running in PWA-only mode.
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LogViewer module
  // ─────────────────────────────────────────────────────────────────────────
  const LV = {
    state: {
      filter: 'ALL',
      liveInterval: null,
      mounted: false,
      eventsBound: false
    },

    init() {
      if (!document.getElementById('tab-logs')) injectDom();

      if (this.state.mounted) {
        this.updateModeBadge();
        this.refresh();
        return;
      }
      this.state.mounted = true;

      if (!bridgeAvailable()) {
        this.showPwaFallback();
        return;
      }

      if (!this.state.eventsBound) {
        this.bindEvents();
        this.bindPullToRefresh();
        this.state.eventsBound = true;
      }
      this.updateModeBadge();
      this.refresh();
    },

    unmount() {
      this.stopLive();
      this.state.mounted = false;
      // events stay bound — re-init is cheap
    },

    showPwaFallback() {
      const fallback   = document.getElementById('lvPwaFallback');
      const header     = document.querySelector('#tab-logs .lv-header');
      const list       = document.getElementById('lvList');
      const indicator  = document.getElementById('lvPullIndicator');
      if (fallback)  fallback.classList.remove('lv-hidden');
      if (header)    header.classList.add('lv-hidden');
      if (list)      list.classList.add('lv-hidden');
      if (indicator) indicator.classList.add('lv-hidden');
    },

    bindEvents() {
      const $ = (id) => document.getElementById(id);
      const onClick = (id, fn) => {
        const el = $(id);
        if (el) el.addEventListener('click', fn);
      };

      onClick('lvRefresh', () => this.refresh());
      onClick('lvShare',   () => this.share());
      onClick('lvClear',   () => this.clearWithConfirm());

      const filter = $('lvFilter');
      if (filter) filter.addEventListener('change', (e) => {
        this.state.filter = e.target.value;
        this.refresh();
      });

      const live = $('lvLive');
      if (live) live.addEventListener('change', (e) => {
        if (e.target.checked) this.startLive();
        else this.stopLive();
      });
    },

    updateModeBadge() {
      const badge = document.getElementById('lvModeBadge');
      if (!badge) return;
      try {
        const mode = getBridge().getLogCaptureMode();
        badge.textContent = mode;
        badge.className = 'lv-mode-badge lv-mode-' + mode.toLowerCase();
      } catch (e) {
        badge.textContent = 'ERR';
        badge.className = 'lv-mode-badge lv-mode-uninitialized';
      }
    },

    refresh() {
      if (!bridgeAvailable()) return;
      try {
        const filterArg = this.state.filter === 'ALL'
          ? null
          : JSON.stringify({ filter: this.state.filter });
        const json = getBridge().getLogBuffer(filterArg);
        const entries = JSON.parse(json || '[]');
        this.render(entries);
      } catch (e) {
        this.renderError(e);
      }
    },

    render(entries) {
      const list = document.getElementById('lvList');
      const count = document.getElementById('lvCount');
      if (count) count.textContent = entries.length + ' entries';
      if (!list) return;

      if (entries.length === 0) {
        list.innerHTML = '<div class="lv-empty">No entries match current filter.</div>';
        return;
      }

      // Cap render at 500 entries for perf — full set still available via Share
      const capped = entries.slice(0, 500);
      const overflow = entries.length - capped.length;
      let html = capped.map((e) => this.renderEntry(e)).join('');
      if (overflow > 0) {
        html += `<div class="lv-empty">… ${overflow} older entries hidden (use Share to export full set)</div>`;
      }
      list.innerHTML = html;
    },

    renderEntry(e) {
      const ts  = this.formatTimestamp(e.ts);
      const sev = this.severityClass(e.level);
      const tag = this.escape(e.tag);
      const msg = this.escape(e.msg);
      const lvl = this.escape(e.level || '?');
      return `<div class="lv-entry ${sev}">` +
               `<span class="lv-ts">${ts}</span>` +
               `<span class="lv-level">${lvl}</span>` +
               `<span class="lv-tag">${tag}</span>` +
               `<span class="lv-msg">${msg}</span>` +
             `</div>`;
    },

    formatTimestamp(ts) {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '--:--:--.---';
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${hh}:${mm}:${ss}.${ms}`;
    },

    severityClass(level) {
      if (level === 'E' || level === 'F') return 'lv-sev-error';
      if (level === 'W') return 'lv-sev-warn';
      return 'lv-sev-default';
    },

    escape(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    renderError(err) {
      const list = document.getElementById('lvList');
      if (!list) return;
      const msg = (err && err.message) ? err.message : String(err);
      list.innerHTML = `<div class="lv-empty lv-sev-error">Error loading logs: ${this.escape(msg)}</div>`;
    },

    startLive() {
      if (this.state.liveInterval) clearInterval(this.state.liveInterval);
      this.state.liveInterval = setInterval(() => this.refresh(), 2000);
    },

    stopLive() {
      if (this.state.liveInterval) {
        clearInterval(this.state.liveInterval);
        this.state.liveInterval = null;
      }
      const cb = document.getElementById('lvLive');
      if (cb) cb.checked = false;
    },

    async share() {
      if (!bridgeAvailable()) return;
      try {
        const filterArg = this.state.filter === 'ALL'
          ? null
          : JSON.stringify({ filter: this.state.filter });
        const json = getBridge().getLogBuffer(filterArg);
        const entries = JSON.parse(json || '[]');
        let mode = '?';
        try { mode = getBridge().getLogCaptureMode(); } catch (e) { /* ignore */ }

        const sep = '─'.repeat(60);
        const header = `Marketapp logs — ${new Date().toISOString()}\n` +
                       `capture=${mode} filter=${this.state.filter} count=${entries.length}\n` +
                       `${sep}\n`;
        const body = entries.map((e) =>
          `${this.formatTimestamp(e.ts)} ${e.level}/${e.tag}: ${e.msg}`
        ).join('\n');
        const text = header + body;

        // 1. Web Share API (preferred — opens Android share intent picker)
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Marketapp logs', text: text });
            return;
          } catch (e) {
            if (e && e.name === 'AbortError') return;
            // fall through
          }
        }

        // 2. Clipboard API (HTTPS context — works on github.io)
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          this.flashMessage('Copied to clipboard');
          return;
        }

        // 3. Last-resort textarea fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          this.flashMessage('Copied to clipboard');
        } catch (e) {
          this.flashMessage('Share unavailable on this device');
        }
        document.body.removeChild(ta);
      } catch (e) {
        this.flashMessage('Share failed: ' + (e.message || e));
      }
    },

    clearWithConfirm() {
      if (!bridgeAvailable()) return;
      if (!confirm('Clear log buffer? This cannot be undone.')) return;
      try {
        getBridge().clearLogBuffer();
        this.refresh();
        this.flashMessage('Buffer cleared');
      } catch (e) {
        this.flashMessage('Clear failed: ' + (e.message || e));
      }
    },

    flashMessage(msg) {
      const list = document.getElementById('lvList');
      if (!list || !list.parentNode) return;
      const flash = document.createElement('div');
      flash.className = 'lv-flash';
      flash.textContent = msg;
      list.parentNode.insertBefore(flash, list);
      setTimeout(() => { if (flash.parentNode) flash.remove(); }, 2500);
    },

    bindPullToRefresh() {
      const list = document.getElementById('lvList');
      const indicator = document.getElementById('lvPullIndicator');
      if (!list || !indicator) return;

      let startY = 0;
      let currentDelta = 0;
      let pulling = false;
      const THRESHOLD = 60;
      const MAX_PULL = 100;

      list.addEventListener('touchstart', (e) => {
        if (list.scrollTop > 0) { pulling = false; return; }
        startY = e.touches[0].clientY;
        currentDelta = 0;
        pulling = true;
      }, { passive: true });

      list.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        currentDelta = e.touches[0].clientY - startY;
        if (currentDelta > 0) {
          const pull = Math.min(currentDelta, MAX_PULL);
          indicator.style.transform = `translateY(${pull}px)`;
          indicator.textContent = currentDelta > THRESHOLD
            ? '↓ Release to refresh'
            : 'Pull to refresh';
        }
      }, { passive: true });

      list.addEventListener('touchend', () => {
        if (!pulling) return;
        if (currentDelta > THRESHOLD) {
          this.refresh();
          indicator.textContent = 'Refreshed';
          setTimeout(() => { indicator.textContent = 'Pull to refresh'; }, 800);
        }
        indicator.style.transform = 'translateY(0)';
        startY = 0;
        currentDelta = 0;
        pulling = false;
      }, { passive: true });

      list.addEventListener('touchcancel', () => {
        indicator.style.transform = 'translateY(0)';
        indicator.textContent = 'Pull to refresh';
        pulling = false;
      }, { passive: true });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-hook into MarketVivi tab-switch convention
  //
  // Listens for clicks on any element with [data-tab="logs"] and calls init().
  // Listens for clicks on any other [data-tab] and calls unmount().
  //
  // If your nav buttons don't use data-tab attribute, this is a no-op —
  // call window.LogViewer.init() / unmount() manually from your tab logic.
  // ─────────────────────────────────────────────────────────────────────────
  function autoHook() {
    document.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-tab]');
      if (!navBtn) return;
      const tab = navBtn.dataset.tab;
      if (tab === 'logs') {
        // Defer so existing tab-switch logic runs first (shows the pane)
        setTimeout(() => LV.init(), 0);
      } else if (LV.state.mounted) {
        LV.unmount();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bootstrap
  // ─────────────────────────────────────────────────────────────────────────
  injectStyles();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectDom();
      autoHook();
    });
  } else {
    injectDom();
    autoHook();
  }

  // Public API
  window.LogViewer = LV;
})();
