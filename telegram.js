/**
 * ═══════════════════════════════════════════════════════════════
 *  TELEGRAM.JS — Telegram Mini App Integration
 *  Handles: theme sync, back button, haptics, user data
 * ═══════════════════════════════════════════════════════════════
 */

const TG = (() => {

  // ── Telegram WebApp object (with safe fallback for desktop browser) ──
  const twa = window.Telegram?.WebApp || null;

  // ── Initialise ────────────────────────────────────────────────
  function init() {
    if (!twa) {
      console.info('[TG] Running outside Telegram — using fallback mode.');
      return;
    }

    // Tell Telegram the app is ready (hides native loading spinner)
    twa.ready();

    // Expand to full height
    twa.expand();

    // ── Hide the top header bar (Bot name / × button) ────────
    if (typeof twa.requestFullscreen === 'function') {
      twa.requestFullscreen();
    }

    // ── Safe area: push app content below the status bar ─────
    function _applySafeArea() {
      const top    = twa.safeAreaInset?.top    ?? 0;
      const bottom = twa.safeAreaInset?.bottom ?? 0;
      const root   = document.documentElement;
      root.style.setProperty('--tg-safe-top',    top    + 'px');
      root.style.setProperty('--tg-safe-bottom', bottom + 'px');
    }
    _applySafeArea();
    twa.onEvent('safeAreaChanged',   _applySafeArea);
    twa.onEvent('fullscreenChanged', () => {
      if (!twa.isFullscreen && typeof twa.requestFullscreen === 'function') {
        twa.requestFullscreen();
      }
      _applySafeArea();
    });

    // Apply Telegram's colour theme to CSS variables
    _applyTheme();

    // Listen for theme changes (user switches Telegram dark/light)
    twa.onEvent('themeChanged', _applyTheme);

    // Disable vertical swipe close so card swipes work correctly
    if (typeof twa.disableVerticalSwipes === 'function') {
      twa.disableVerticalSwipes();
    }

    // Configure back button behaviour
    _setupBackButton();

    console.info('[TG] Telegram WebApp initialised.', {
      version: twa.version,
      platform: twa.platform,
      colorScheme: twa.colorScheme,
    });
  }

  // ── Apply Telegram theme colours to CSS vars ──────────────────
  function _applyTheme() {
    if (!twa) return;
    const p = twa.themeParams || {};
    const root = document.documentElement;

    // Map Telegram theme params → our CSS variables
    const map = {
      '--tg-bg':        p.bg_color,
      '--tg-text':      p.text_color,
      '--tg-hint':      p.hint_color,
      '--tg-link':      p.link_color,
      '--tg-btn':       p.button_color,
      '--tg-btn-text':  p.button_text_color,
      '--tg-secondary': p.secondary_bg_color,
    };

    Object.entries(map).forEach(([key, val]) => {
      if (val) root.style.setProperty(key, val);
    });
  }

  // ── Back button logic ─────────────────────────────────────────
  let _backHandlers = [];

  function _setupBackButton() {
    if (!twa?.BackButton) return;

    twa.BackButton.onClick(() => {
      // Run the topmost back handler; if none, hide button
      if (_backHandlers.length > 0) {
        _backHandlers[_backHandlers.length - 1]();
      } else {
        twa.BackButton.hide();
      }
    });
  }

  /** Push a back handler (e.g. when opening saved tab) */
  function pushBack(handler) {
    _backHandlers.push(handler);
    twa?.BackButton?.show();
  }

  /** Pop a back handler */
  function popBack() {
    _backHandlers.pop();
    if (_backHandlers.length === 0) {
      twa?.BackButton?.hide();
    }
  }

  // ── Haptic Feedback ───────────────────────────────────────────
  const Haptic = {
    light()   { twa?.HapticFeedback?.impactOccurred('light'); },
    medium()  { twa?.HapticFeedback?.impactOccurred('medium'); },
    heavy()   { twa?.HapticFeedback?.impactOccurred('heavy'); },
    success() { twa?.HapticFeedback?.notificationOccurred('success'); },
    warning() { twa?.HapticFeedback?.notificationOccurred('warning'); },
    error()   { twa?.HapticFeedback?.notificationOccurred('error'); },
    select()  { twa?.HapticFeedback?.selectionChanged(); },
  };

  // ── User Info ─────────────────────────────────────────────────
  function getUser() {
    if (!twa?.initDataUnsafe?.user) return null;
    return twa.initDataUnsafe.user; // { id, first_name, last_name, username, ... }
  }

  function getUserId() {
    return getUser()?.id?.toString() || 'guest';
  }

  // ── Color scheme ──────────────────────────────────────────────
  function isDark() {
    return twa ? twa.colorScheme === 'dark' : true;
  }

  // ── Show Telegram confirm popup ───────────────────────────────
  function confirm(message, onConfirm, onCancel) {
    if (twa?.showConfirm) {
      twa.showConfirm(message, (confirmed) => {
        if (confirmed) onConfirm?.();
        else onCancel?.();
      });
    } else {
      // Browser fallback
      if (window.confirm(message)) onConfirm?.();
      else onCancel?.();
    }
  }

  // ── Show Telegram popup ───────────────────────────────────────
  function showPopup(title, message) {
    if (twa?.showPopup) {
      twa.showPopup({ title, message, buttons: [{ type: 'close' }] });
    } else {
      alert(`${title}\n\n${message}`);
    }
  }

  // ── Close the mini app ────────────────────────────────────────
  function close() {
    twa?.close();
  }

  // ── Is running inside Telegram? ───────────────────────────────
  function isTelegram() {
    return !!twa && twa.platform !== 'unknown';
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init,
    pushBack,
    popBack,
    Haptic,
    getUser,
    getUserId,
    isDark,
    confirm,
    showPopup,
    close,
    isTelegram,
  };

})();
