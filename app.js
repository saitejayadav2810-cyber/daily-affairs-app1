/**
 * ═══════════════════════════════════════════════════════════════
 *  APP.JS — Daily Current Affairs Core Logic
 *
 *  Handles:
 *   • fetchQuestions()     — Google Sheets → localStorage cache
 *   • selectDailyCards()   — 10 random cards/day, no repeats
 *   • skipCard()           — delay reappearance 3 days
 *   • saveCard()           — bookmark to saved list
 *   • loadNextCard()       — advance card state
 *   • Progress tracking    — streak, totals, per-category
 *   • All UI rendering
 * ═══════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════
//  CONFIG — ▶ UPDATE SPREADSHEET_ID BEFORE DEPLOYING
// ════════════════════════════════════════════════════════════════
const CONFIG = {
  // ↓ Replace with your actual Google Spreadsheet ID
  SPREADSHEET_ID: '1x_SEEuZDey4XfoyYRDnrAN1eZcJ_d65PPDeLUWHRyGo',
  SHEET_NAME:     'sheet1',

  // Public API proxy (no auth required)
  // Alternative: https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={NAME}
  API_BASE: 'https://opensheet.elk.sh',

  CARDS_PER_DAY:    99999,  // Unlimited — all questions shown continuously
  CACHE_TTL_HOURS:  12,    // Re-fetch sheet after this many hours
  SKIP_DELAY_DAYS:  3,     // Skipped cards return after N days
};

// ════════════════════════════════════════════════════════════════
//  LOCAL STORAGE KEYS
// ════════════════════════════════════════════════════════════════
const LS = {
  QUESTIONS:     'dca_questions',       // Cached question array
  CACHE_TIME:    'dca_cache_time',      // When cache was last written
  SEEN_IDS:      'dca_seen_ids',        // Set of all question ids ever seen
  SKIPPED:       'dca_skipped',         // { id: timestamp } skipped cards
  SAVED:         'dca_saved',           // Array of saved question objects
  DAILY_DATE:    'dca_daily_date',      // "YYYY-MM-DD" of today's session
  DAILY_CARDS:   'dca_daily_cards',     // Today's 10 selected question ids
  DAILY_INDEX:   'dca_daily_index',     // How many cards shown today
  STATS:         'dca_stats',           // { streak, lastActive, totalSeen, daysActive }
  GUIDE_SHOWN:   'dca_guide_shown',     // Whether swipe guide has been dismissed
};

// ════════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════════
let State = {
  allQuestions:    [],      // Full fetched dataset
  dailyCards:      [],      // Today's 10 question objects
  currentIndex:    0,       // Which card we're on (0–9)
  isFlipped:       false,   // Is current card showing answer?
  sessionSaved:    0,       // Saved this session
  sessionSkipped:  0,       // Skipped this session
};

// ════════════════════════════════════════════════════════════════
//  DOM REFS
// ════════════════════════════════════════════════════════════════
let DOM = {};

function _cacheDom() {
  DOM = {
    splash:            document.getElementById('splash-screen'),
    loaderFill:        document.getElementById('loader-fill'),
    loaderText:        document.getElementById('loader-text'),
    app:               document.getElementById('app'),

    // Header
    headerStreak:      document.getElementById('header-streak'),

    // Daily progress
    dailyCount:        document.getElementById('daily-count'),
    dailyProgressFill: document.getElementById('daily-progress-fill'),
    currentCategory:   document.getElementById('current-category'),

    // Card elements
    cardArena:         document.getElementById('card-arena'),
    activeCard:        document.getElementById('active-card'),
    cardInner:         document.getElementById('card-inner'),
    cardFront:         document.getElementById('card-front'),
    cardBack:          document.getElementById('card-back'),
    cardNumber:        document.getElementById('card-number'),
    cardQuestion:      document.getElementById('card-question'),
    cardAnswer:        document.getElementById('card-answer'),
    cardQuestionRepeat:document.getElementById('card-question-repeat'),
    overlayRight:      document.getElementById('overlay-right'),
    overlayLeft:       document.getElementById('overlay-left'),
    overlayUp:         document.getElementById('overlay-up'),
    overlayDown:       document.getElementById('overlay-down'),

    // Action buttons
    btnSkip:           document.getElementById('btn-skip'),
    btnFlip:           document.getElementById('btn-flip'),
    btnSave:           document.getElementById('btn-save'),
    btnNext:           document.getElementById('btn-next'),

    // Swipe guide
    swipeGuide:        document.getElementById('swipe-guide'),

    // Completion
    completionScreen:  document.getElementById('completion-screen'),
    compSaved:         document.getElementById('comp-saved'),
    compSkipped:       document.getElementById('comp-skipped'),
    compStreak:        document.getElementById('comp-streak'),
    btnReviewSaved:    document.getElementById('btn-review-saved'),

    // Tabs
    tabHome:           document.getElementById('tab-home'),
    tabSaved:          document.getElementById('tab-saved'),
    tabProgress:       document.getElementById('tab-progress'),
    viewHome:          document.getElementById('view-home'),
    viewSaved:         document.getElementById('view-saved'),
    viewProgress:      document.getElementById('view-progress'),
    savedBadge:        document.getElementById('saved-badge'),
    savedCountLabel:   document.getElementById('saved-count-label'),
    savedList:         document.getElementById('saved-list'),
    savedEmpty:        document.getElementById('saved-empty'),

    // Progress
    todayDateLabel:    document.getElementById('today-date-label'),
    statStreak:        document.getElementById('stat-streak'),
    statTotal:         document.getElementById('stat-total'),
    statSaved:         document.getElementById('stat-saved'),
    statDays:          document.getElementById('stat-days'),
    heatmap:           document.getElementById('heatmap'),
    categoryBars:      document.getElementById('category-bars'),
    btnReset:          document.getElementById('btn-reset'),

    // Toast
    toast:             document.getElementById('toast'),

    // Ads
    adBanner:          document.getElementById('ad-banner'),
    adClose:           document.getElementById('ad-close'),
  };
}

// ════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════

function today() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function ls_get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function ls_set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[LS] Write failed:', e); }
}

function ls_remove(key) {
  localStorage.removeItem(key);
}

/** Fisher-Yates shuffle */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _toastTimer = null;
function showToast(msg, duration = 2200) {
  const t = DOM.toast;
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function setLoaderProgress(pct, text) {
  if (DOM.loaderFill) DOM.loaderFill.style.width = `${pct}%`;
  if (text && DOM.loaderText) DOM.loaderText.textContent = text;
}

// ════════════════════════════════════════════════════════════════
//  1. FETCH QUESTIONS  fetchQuestions()
// ════════════════════════════════════════════════════════════════

async function fetchQuestions() {
  setLoaderProgress(10, 'Checking cache…');

  const cacheTime = ls_get(LS.CACHE_TIME, 0);
  const cached    = ls_get(LS.QUESTIONS, null);
  const ageHours  = (Date.now() - cacheTime) / 3_600_000;

  // ── Serve fresh cache if available ──────────────────────────
  if (cached && Array.isArray(cached) && cached.length > 0 && ageHours < CONFIG.CACHE_TTL_HOURS) {
    setLoaderProgress(100, `✓ Loaded ${cached.length} questions`);
    await _delay(300);
    return cached;
  }

  // ── Guard: catch un-configured Spreadsheet ID ────────────────
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    _showFetchError(
      'SPREADSHEET_ID not set!',
      'Open app.js and replace YOUR_SPREADSHEET_ID_HERE with your actual Google Spreadsheet ID.'
    );
    return _getDemoData();
  }

  // ── API 1: opensheet.elk.sh (primary) ────────────────────────
  setLoaderProgress(30, 'Connecting to Google Sheets…');
  const url1 = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/${CONFIG.SHEET_NAME}`;

  let raw = null;
  let lastError = '';

  try {
    const res = await fetch(url1, { cache: 'no-store' });
    if (!res.ok) throw new Error(`opensheet returned HTTP ${res.status}`);
    raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('opensheet returned empty array');
    setLoaderProgress(70, `Got ${raw.length} rows from API…`);
  } catch (err) {
    lastError = err.message;
    console.warn('[Fetch] API-1 failed:', err.message, '— trying backup API…');
    setLoaderProgress(50, 'Primary API failed, trying backup…');

    // ── API 2: Google's own CSV/JSON endpoint (backup) ─────────
    const url2 = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME}`;
    try {
      const res2 = await fetch(url2, { cache: 'no-store' });
      if (!res2.ok) throw new Error(`Google gviz returned HTTP ${res2.status}`);
      const text = await res2.text();

      // Google wraps JSON in: /*O_o*/google.visualization.Query.setResponse({...});
      const jsonStr = text.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
      const gviz    = JSON.parse(jsonStr);
      const cols    = gviz.table.cols.map(c => c.label.toLowerCase().trim());
      raw = gviz.table.rows
        .filter(r => r && r.c)
        .map(r => {
          const obj = {};
          cols.forEach((col, i) => { obj[col] = r.c[i]?.v ?? ''; });
          return obj;
        });

      if (!Array.isArray(raw) || raw.length === 0) throw new Error('gviz returned empty data');
      setLoaderProgress(70, `Got ${raw.length} rows via backup API…`);
      lastError = '';
    } catch (err2) {
      lastError = `API-1: ${err.message} | API-2: ${err2.message}`;
      console.error('[Fetch] Both APIs failed:', lastError);
      raw = null;
    }
  }

  // ── Handle complete failure ────────────────────────────────────
  if (!raw) {
    if (cached && cached.length > 0) {
      setLoaderProgress(100, `⚠ Offline — using ${cached.length} cached questions`);
      showToast('⚠ Could not reach Google Sheets — showing cached data');
      return cached;
    }
    _showFetchError(
      'Could not load your Google Sheet',
      `Both APIs failed.\n\nError: ${lastError}\n\nCheck:\n` +
      `1. Spreadsheet ID is correct in app.js\n` +
      `2. Sheet is shared as "Anyone with the link"\n` +
      `3. Tab is named exactly "${CONFIG.SHEET_NAME}"`
    );
    setLoaderProgress(100, '⚠ Using demo data (sheet unreachable)');
    return _getDemoData();
  }

  // ── Normalise rows (case-insensitive column matching) ──────────
  // Build a lowercase key map for each row so "Question"/"QUESTION"/"question" all work
  function normaliseRow(row) {
    const out = {};
    Object.keys(row).forEach(k => { out[k.toLowerCase().trim()] = row[k]; });
    return out;
  }

  const normRaw = raw.map(normaliseRow);

  // Debug: log the first row's keys so you can see what column names came through
  if (normRaw.length > 0) {
    console.info('[Fetch] Column keys found in sheet:', Object.keys(normRaw[0]));
  }

  const questions = normRaw
    .filter(row => {
      const q = row.question ?? row.questions ?? row.q ?? '';
      return String(q).trim() !== '';
    })
    .map((row, idx) => {
      // Accept common column name variants
      const q    = row.question  ?? row.questions ?? row.q        ?? '';
      const a    = row.answer    ?? row.answers   ?? row.a        ?? '';
      const cat  = row.category  ?? row.cat       ?? row.topic    ?? row.subject ?? 'General';
      const id   = row.id        ?? row.sl        ?? row.sr       ?? row.no      ?? (idx + 1);
      return {
        id:       String(id).trim(),
        question: String(q).trim(),
        answer:   String(a).trim(),
        category: String(cat).trim() || 'General',
      };
    })
    .filter(q => q.question !== '' && q.answer !== '');

  if (questions.length === 0) {
    // Show the actual column names found to help debug
    const foundCols = normRaw.length > 0 ? Object.keys(normRaw[0]).join(', ') : 'none';
    _showFetchError(
      'Sheet loaded but 0 questions found',
      `Sheet connected ✓  but no valid rows were read.\n\n` +
      `Columns found in your sheet:\n"${foundCols}"\n\n` +
      `App needs columns named (any capitalisation):\n` +
      `"id"  "question"  "answer"  "category"\n\n` +
      `Fix: rename your sheet column headers to match, then refresh.`
    );
    if (cached && cached.length > 0) return cached;
    return _getDemoData();
  }

  setLoaderProgress(90, `Processing ${questions.length} questions…`);

  // Cache the fresh data
  ls_set(LS.QUESTIONS, questions);
  ls_set(LS.CACHE_TIME, Date.now());

  await _delay(200);
  setLoaderProgress(100, `✓ ${questions.length} questions loaded!`);
  return questions;
}

/** Show a visible error panel on the splash screen */
function _showFetchError(title, detail) {
  const loaderEl = document.querySelector('.splash-loader');
  if (!loaderEl) { alert(`${title}\n\n${detail}`); return; }
  loaderEl.innerHTML = `
    <div style="
      background:#1a0a0a;border:1px solid #ff5252;border-radius:12px;
      padding:16px;text-align:left;margin-top:8px;">
      <div style="color:#ff5252;font-weight:700;font-size:13px;margin-bottom:8px;">
        ⚠ ${title}
      </div>
      <div style="color:#9fa8da;font-size:11px;white-space:pre-wrap;line-height:1.6;">
${detail}
      </div>
      <div style="color:#5c6bc0;font-size:10px;margin-top:12px;">
        App will load with demo questions. Fix the issue and refresh.
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
//  2. SELECT DAILY CARDS  selectDailyCards()
// ════════════════════════════════════════════════════════════════

function selectDailyCards(allQuestions) {
  // ── UNLIMITED MODE: return ALL shuffled questions, no daily cap ──
  // Shows unseen questions first; when all seen, reshuffles everything.

  const seenIds    = new Set(ls_get(LS.SEEN_IDS, []));
  const skipped    = ls_get(LS.SKIPPED, {});
  const nowMs      = Date.now();
  const skipMs     = CONFIG.SKIP_DELAY_DAYS * 86_400_000;

  // IDs still in skip-delay window
  const inDelayIds = new Set(
    Object.entries(skipped)
      .filter(([, ts]) => nowMs - ts < skipMs)
      .map(([id]) => id)
  );

  // Prefer unseen questions first
  let pool = allQuestions.filter(
    q => !seenIds.has(q.id) && !inDelayIds.has(q.id)
  );

  // All seen → reset cycle, start fresh
  if (pool.length === 0) {
    console.info('[Cards] All questions seen — reshuffling');
    ls_set(LS.SEEN_IDS, []);
    pool = allQuestions.filter(q => !inDelayIds.has(q.id));
  }

  // Edge case: everything is skipped
  if (pool.length === 0) pool = allQuestions;

  // Return ALL available questions (shuffled) — NO slice limit
  const selected = shuffle(pool);

  ls_set(LS.DAILY_DATE,  today());
  ls_set(LS.DAILY_CARDS, selected.map(q => q.id));

  return selected;
}

// ════════════════════════════════════════════════════════════════
//  3. SAVE CARD  saveCard()
// ════════════════════════════════════════════════════════════════

function saveCard(question) {
  const saved = ls_get(LS.SAVED, []);

  // Avoid duplicates
  if (saved.find(q => q.id === question.id)) {
    showToast('Already saved!');
    return;
  }

  saved.unshift(question); // newest first
  ls_set(LS.SAVED, saved);
  State.sessionSaved++;

  // Update badge
  _updateSavedBadge(saved.length);

  TG.Haptic.success();
  showToast('🔖 Saved!');
}

function unsaveCard(id) {
  let saved = ls_get(LS.SAVED, []);
  saved = saved.filter(q => q.id !== id);
  ls_set(LS.SAVED, saved);
  _updateSavedBadge(saved.length);
  renderSavedTab();
  showToast('Removed from saved');
}

function _updateSavedBadge(count) {
  const badge = DOM.savedBadge;
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════════════
//  4. SKIP CARD  skipCard()
// ════════════════════════════════════════════════════════════════

function skipCard(questionId) {
  const skipped = ls_get(LS.SKIPPED, {});
  skipped[questionId] = Date.now();
  ls_set(LS.SKIPPED, skipped);
  State.sessionSkipped++;
  TG.Haptic.light();
}

// ════════════════════════════════════════════════════════════════
//  5. MARK SEEN  (called after any action)
// ════════════════════════════════════════════════════════════════

function markSeen(questionId) {
  const seen = ls_get(LS.SEEN_IDS, []);
  if (!seen.includes(questionId)) {
    seen.push(questionId);
    ls_set(LS.SEEN_IDS, seen);
  }
  _updateStats();
}

// ════════════════════════════════════════════════════════════════
//  6. LOAD NEXT CARD  loadNextCard()
// ════════════════════════════════════════════════════════════════

function loadNextCard() {
  State.currentIndex++;
  ls_set(LS.DAILY_INDEX, State.currentIndex);

  // When queue is exhausted, reshuffle all questions and keep going
  if (State.currentIndex >= State.dailyCards.length) {
    showToast('🔄 Great job! Reshuffling…');
    State.dailyCards  = selectDailyCards(State.allQuestions);
    State.currentIndex = 0;
    ls_set(LS.DAILY_INDEX, 0);
  }

  _updateDailyProgress();
  _renderCard(State.dailyCards[State.currentIndex]);
}

// ════════════════════════════════════════════════════════════════
//  STATS & STREAK
// ════════════════════════════════════════════════════════════════

function _updateStats() {
  const todayStr = today();
  const stats    = ls_get(LS.STATS, {
    streak: 0, lastActive: '', totalSeen: 0, daysActive: 0,
  });

  // Update total seen
  stats.totalSeen = ls_get(LS.SEEN_IDS, []).length;

  // Streak logic
  if (stats.lastActive === todayStr) {
    // Same day — no streak change
  } else {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (stats.lastActive === yesterday) {
      stats.streak++;
    } else if (stats.lastActive !== todayStr) {
      stats.streak = 1; // reset
    }
    stats.lastActive = todayStr;
    stats.daysActive++;
  }

  ls_set(LS.STATS, stats);
  _renderStreakUI(stats.streak);
}

function _renderStreakUI(streak) {
  if (DOM.headerStreak) DOM.headerStreak.textContent = streak;
  if (DOM.statStreak)   DOM.statStreak.textContent   = streak;
}

// ════════════════════════════════════════════════════════════════
//  CARD RENDERING
// ════════════════════════════════════════════════════════════════

function _renderCard(question) {
  if (!question) return;

  // Reset flip state
  State.isFlipped = false;
  DOM.cardInner?.classList.remove('flipped');

  // Reset card position/classes
  const card = DOM.activeCard;
  if (card) {
    card.classList.remove('card-fly-right', 'card-fly-left', 'card-fly-up', 'card-snap-back');
    card.style.transform  = '';
    card.style.opacity    = '';
    card.style.transition = '';
  }

  // Fill content
  const cardNum = State.currentIndex + 1;
  if (DOM.cardNumber)        DOM.cardNumber.textContent        = `Q${cardNum}`;
  if (DOM.cardQuestion)      DOM.cardQuestion.textContent      = question.question;
  if (DOM.cardAnswer)        DOM.cardAnswer.textContent        = question.answer;
  if (DOM.cardQuestionRepeat)DOM.cardQuestionRepeat.textContent = question.question;
  if (DOM.currentCategory)   DOM.currentCategory.textContent  = question.category;

  // Animate card entrance
  if (card) {
    card.style.opacity   = '0';
    card.style.transform = 'translateY(30px) scale(0.95)';
    card.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition = 'opacity 0.35s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
        card.style.opacity    = '1';
        card.style.transform  = 'translateY(0) scale(1)';
      });
    });

    // Re-init swipe engine on each card
    SwipeEngine.destroy();
    setTimeout(() => {
      SwipeEngine.init(card, {
        right: DOM.overlayRight,
        left:  DOM.overlayLeft,
        up:    DOM.overlayUp,
        down:  DOM.overlayDown,
      }, {
        onSwipeDown:  () => _flipCard(),                 // ↓ reveal answer
        onSwipeUp:    () => _handleSkip(question),       // ↑ skip
        onSwipeRight: () => _handleSkip(question),       // → skip
        onSwipeLeft:  () => _handleSkip(question),       // ← skip
        onTap:        () => _flipCard(),                 // tap = also reveal
      });
    }, 400);
  }

  _updateDailyProgress();
}

function _flipCard() {
  State.isFlipped = !State.isFlipped;
  DOM.cardInner?.classList.toggle('flipped', State.isFlipped);
  TG.Haptic.light();

  // Hide swipe guide permanently after first interaction
  if (!ls_get(LS.GUIDE_SHOWN)) {
    ls_set(LS.GUIDE_SHOWN, true);
    DOM.swipeGuide?.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════════════
//  SWIPE HANDLERS
// ════════════════════════════════════════════════════════════════

function _handleNext(question) {
  // "Got it" — mark seen, load next
  markSeen(question.id);
  TG.Haptic.success();
  setTimeout(loadNextCard, 420);
}

function _handleSkip(question) {
  skipCard(question.id);
  markSeen(question.id);
  setTimeout(loadNextCard, 420);
}

function _handleSave(question) {
  saveCard(question);
  markSeen(question.id);
  setTimeout(loadNextCard, 420);
}

// ════════════════════════════════════════════════════════════════
//  DAILY PROGRESS UI
// ════════════════════════════════════════════════════════════════

function _updateDailyProgress() {
  const total   = State.dailyCards.length;
  const current = State.currentIndex + 1;
  const pct     = Math.round(((State.currentIndex) / total) * 100);

  // Show "Card X of Y (total remaining)"
  if (DOM.dailyCount)
    DOM.dailyCount.textContent = `Card ${current} of ${total}`;
  if (DOM.dailyProgressFill)
    DOM.dailyProgressFill.style.width = `${pct}%`;
}

// ════════════════════════════════════════════════════════════════
//  COMPLETION SCREEN
// ════════════════════════════════════════════════════════════════

function _showCompletion() {
  TG.Haptic.success();
  _updateStats();

  const stats = ls_get(LS.STATS, { streak: 0 });

  if (DOM.compSaved)    DOM.compSaved.textContent    = State.sessionSaved;
  if (DOM.compSkipped)  DOM.compSkipped.textContent  = State.sessionSkipped;
  if (DOM.compStreak)   DOM.compStreak.textContent   = stats.streak;

  DOM.completionScreen?.classList.remove('hidden');
  DOM.cardArena?.classList.add('hidden');

  // Update progress tab too
  renderProgressTab();
}

// ════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ════════════════════════════════════════════════════════════════

function _initTabs() {
  const tabs = [
    { btn: DOM.tabHome,     view: DOM.viewHome,     id: 'home' },
    { btn: DOM.tabSaved,    view: DOM.viewSaved,    id: 'saved' },
    { btn: DOM.tabProgress, view: DOM.viewProgress, id: 'progress' },
  ];

  tabs.forEach(({ btn, view, id }) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn?.classList.remove('active');
        t.view?.classList.remove('active');
      });
      btn.classList.add('active');
      view?.classList.add('active');
      TG.Haptic.select();

      if (id === 'saved')    renderSavedTab();
      if (id === 'progress') renderProgressTab();
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  SAVED TAB RENDERING
// ════════════════════════════════════════════════════════════════

function renderSavedTab() {
  const saved = ls_get(LS.SAVED, []);

  if (DOM.savedCountLabel)
    DOM.savedCountLabel.textContent = `${saved.length} card${saved.length !== 1 ? 's' : ''}`;

  if (!DOM.savedList) return;
  DOM.savedList.innerHTML = '';

  if (saved.length === 0) {
    DOM.savedEmpty?.classList.remove('hidden');
    DOM.savedList.classList.add('hidden');
    return;
  }

  DOM.savedEmpty?.classList.add('hidden');
  DOM.savedList.classList.remove('hidden');

  saved.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    item.style.setProperty('--i', i);
    item.innerHTML = `
      <div class="saved-item-category">${_escHtml(q.category)}</div>
      <div class="saved-item-question">${_escHtml(q.question)}</div>
      <div class="saved-item-answer">${_escHtml(q.answer)}</div>
      <button class="saved-remove-btn" data-id="${q.id}" aria-label="Remove">✕</button>
    `;
    item.querySelector('.saved-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      unsaveCard(q.id);
      TG.Haptic.light();
    });
    DOM.savedList.appendChild(item);
  });

  _updateSavedBadge(saved.length);
}

// ════════════════════════════════════════════════════════════════
//  PROGRESS TAB RENDERING
// ════════════════════════════════════════════════════════════════

function renderProgressTab() {
  const stats  = ls_get(LS.STATS, { streak: 0, totalSeen: 0, daysActive: 0 });
  const saved  = ls_get(LS.SAVED, []);
  const todayStr = today();

  // Date label
  const d = new Date();
  if (DOM.todayDateLabel)
    DOM.todayDateLabel.textContent = d.toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

  // Stats
  if (DOM.statStreak) DOM.statStreak.textContent = stats.streak      || 0;
  if (DOM.statTotal)  DOM.statTotal.textContent  = stats.totalSeen   || 0;
  if (DOM.statSaved)  DOM.statSaved.textContent  = saved.length;
  if (DOM.statDays)   DOM.statDays.textContent   = stats.daysActive  || 0;

  // Weekly heatmap
  _renderHeatmap();

  // Category breakdown
  _renderCategoryBars();
}

function _renderHeatmap() {
  if (!DOM.heatmap) return;
  DOM.heatmap.innerHTML = '';

  const dayNames  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDate = new Date();
  const todayStr  = today();
  const dailyDate = ls_get(LS.DAILY_DATE, '');

  // Build last 7 days
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const ds  = d.toISOString().slice(0, 10);
    const isT = ds === todayStr;
    const done = ds === dailyDate && ls_get(LS.DAILY_INDEX, 0) >= CONFIG.CARDS_PER_DAY;

    const dayEl = document.createElement('div');
    dayEl.className = 'heatmap-day';
    dayEl.innerHTML = `
      <div class="heatmap-dot${done ? ' done' : ''}${isT ? ' today' : ''}">
        ${done ? '✓' : (isT ? '·' : '')}
      </div>
      <span class="heatmap-label">${dayNames[d.getDay()]}</span>
    `;
    DOM.heatmap.appendChild(dayEl);
  }
}

function _renderCategoryBars() {
  if (!DOM.categoryBars) return;

  const seen      = ls_get(LS.SEEN_IDS, []);
  const questions = ls_get(LS.QUESTIONS, []);

  // Count seen per category
  const seenSet = new Set(seen);
  const catCounts = {};
  let   maxCount  = 0;

  questions.forEach(q => {
    if (seenSet.has(q.id)) {
      catCounts[q.category] = (catCounts[q.category] || 0) + 1;
      maxCount = Math.max(maxCount, catCounts[q.category]);
    }
  });

  DOM.categoryBars.innerHTML = '';

  if (Object.keys(catCounts).length === 0) {
    DOM.categoryBars.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">No categories seen yet.</p>`;
    return;
  }

  // Sort by count desc
  Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([cat, count]) => {
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'cat-bar-row';
      row.innerHTML = `
        <span class="cat-bar-label">${_escHtml(cat)}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:0%" data-pct="${pct}"></div>
        </div>
        <span class="cat-bar-count">${count}</span>
      `;
      DOM.categoryBars.appendChild(row);
    });

  // Animate bars in
  requestAnimationFrame(() => {
    DOM.categoryBars.querySelectorAll('.cat-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  AD SYSTEM (placeholder)
// ════════════════════════════════════════════════════════════════

function _initAds() {
  // Show ad after every N completions
  const COMPLETIONS_BEFORE_AD = 5;
  const completions = parseInt(localStorage.getItem('dca_completions') || '0', 10);

  if (completions > 0 && completions % COMPLETIONS_BEFORE_AD === 0) {
    DOM.adBanner?.classList.remove('hidden');
  }

  DOM.adClose?.addEventListener('click', () => {
    DOM.adBanner?.classList.add('hidden');
    TG.Haptic.light();
  });

  // Increment completion counter when user completes daily set
  const prev = parseInt(localStorage.getItem('dca_completions') || '0', 10);
  localStorage.setItem('dca_completions', prev + 1);
}

// ════════════════════════════════════════════════════════════════
//  ACTION BUTTONS
// ════════════════════════════════════════════════════════════════

function _initButtons() {
  DOM.btnSkip?.addEventListener('click', () => {
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.light();
    SwipeEngine.triggerSwipe('left');
  });

  DOM.btnFlip?.addEventListener('click', () => {
    _flipCard();
  });

  DOM.btnSave?.addEventListener('click', () => {
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.medium();
    SwipeEngine.triggerSwipe('up');
  });

  DOM.btnNext?.addEventListener('click', () => {
    const q = State.dailyCards[State.currentIndex];
    if (!q) return;
    TG.Haptic.success();
    SwipeEngine.triggerSwipe('right');
  });

  // Completion → review saved
  DOM.btnReviewSaved?.addEventListener('click', () => {
    DOM.tabSaved?.click();
  });

  // Progress → reset
  DOM.btnReset?.addEventListener('click', () => {
    TG.confirm(
      'Reset all progress?\nThis will clear all seen cards, saved cards, and streak data.',
      () => {
        _resetAll();
        TG.Haptic.warning();
        showToast('🔄 Progress reset');
        setTimeout(() => location.reload(), 1000);
      }
    );
  });

  // Ad close
  DOM.adClose?.addEventListener('click', () => {
    DOM.adBanner?.classList.add('hidden');
  });
}

function _resetAll() {
  Object.values(LS).forEach(key => ls_remove(key));
}

// ════════════════════════════════════════════════════════════════
//  DEMO DATA (fallback when sheet is unreachable)
// ════════════════════════════════════════════════════════════════

function _getDemoData() {
  return [
    { id:'d1',  question:'Which country launched Chandrayaan-3?',          answer:'India',                   category:'Science' },
    { id:'d2',  question:'Who is the current RBI Governor?',               answer:'Shaktikanta Das',          category:'Economy' },
    { id:'d3',  question:'Which state is the largest producer of wheat?',  answer:'Uttar Pradesh',            category:'Geography' },
    { id:'d4',  question:'India\'s first indigenously built aircraft carrier?', answer:'INS Vikrant',         category:'Defence' },
    { id:'d5',  question:'PMGSY stands for?',                              answer:'Pradhan Mantri Gram Sadak Yojana', category:'Schemes' },
    { id:'d6',  question:'Which city hosts the BSE?',                      answer:'Mumbai',                   category:'Economy' },
    { id:'d7',  question:'Operation Sindoor target country?',              answer:'Pakistan',                 category:'Defence' },
    { id:'d8',  question:'Largest High Court in India by judges?',         answer:'Allahabad',                category:'Polity' },
    { id:'d9',  question:'National Farmers Day is observed on?',           answer:'23rd December',            category:'Agriculture' },
    { id:'d10', question:'Which district tops literacy in India?',         answer:'Serchhip, Mizoram',        category:'Education' },
    { id:'d11', question:'India\'s fastest train?',                        answer:'Vande Bharat Express',     category:'Transport' },
    { id:'d12', question:'Project Tiger was launched in?',                 answer:'1973',                     category:'Environment' },
    { id:'d13', question:'Headquarters of ISRO?',                         answer:'Bengaluru',                category:'Science' },
    { id:'d14', question:'Which river is called Ganges of South India?',   answer:'Kaveri (Cauvery)',         category:'Geography' },
    { id:'d15', question:'Who appoints India\'s Chief Justice?',           answer:'President of India',       category:'Polity' },
  ];
}

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════════
//  BOOT  — Entry point
// ════════════════════════════════════════════════════════════════

async function boot() {
  // 1. Cache DOM
  _cacheDom();

  // 2. Init Telegram
  TG.init();

  // 3. Show swipe guide if first time
  if (!ls_get(LS.GUIDE_SHOWN)) {
    DOM.swipeGuide?.classList.remove('hidden');
    // Auto-hide after 5 seconds
    setTimeout(() => {
      ls_set(LS.GUIDE_SHOWN, true);
      DOM.swipeGuide?.classList.add('hidden');
    }, 5000);
  } else {
    DOM.swipeGuide?.classList.add('hidden');
  }

  // 4. Fetch questions with loading progress
  let allQuestions;
  try {
    allQuestions = await fetchQuestions();
  } catch (err) {
    console.error('[Boot] Fetch error:', err);
    allQuestions = _getDemoData();
  }

  State.allQuestions = allQuestions;

  // 5. Select cards (all questions, shuffled)
  State.dailyCards   = selectDailyCards(allQuestions);
  State.currentIndex = ls_get(LS.DAILY_INDEX, 0);

  // ── FIX: if index is stale/out-of-range, reset to start ──────
  if (State.currentIndex >= State.dailyCards.length || State.currentIndex < 0) {
    State.currentIndex = 0;
    ls_set(LS.DAILY_INDEX, 0);
  }

  // 6. Update initial stats/streak
  _updateStats();

  // 7. Update saved badge
  const saved = ls_get(LS.SAVED, []);
  _updateSavedBadge(saved.length);

  // 8. Init UI
  _initTabs();
  _initButtons();
  _updateDailyProgress();

  // 9. Dismiss splash
  await _delay(600);

  DOM.splash?.classList.add('fade-out');
  setTimeout(() => {
    DOM.splash?.classList.add('hidden');
    DOM.app?.classList.remove('hidden');
  }, 500);

  // 10. Always render first card (no completion screen in unlimited mode)
  _renderCard(State.dailyCards[State.currentIndex]);
}

// ── Wait for DOM ──────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
