// Revival — bootstrap. Steps 1-3: tab routing, Today view from mock data,
// per-set save-on-blur with IndexedDB write queue (offline-first stub).
// Live Apps Script POSTs and progression verdicts land in later steps.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // IndexedDB write queue (stub — flush to Apps Script lands in a later step)
  // ---------------------------------------------------------------------------
  const DB_NAME = 'revival';
  const DB_VER  = 1;
  const STORE   = 'pendingWrites';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  const dbReady = openDb().catch(err => {
    console.error('[revival] IndexedDB open failed', err);
    return null;
  });

  function queueWrite(action, payload) {
    return dbReady.then(db => {
      if (!db) throw new Error('no db');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).add({ action, payload, ts: Date.now() });
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    });
  }

  function pendingCount() {
    return dbReady.then(db => {
      if (!db) return 0;
      return new Promise((resolve) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(0);
      });
    });
  }
  // expose for dev / future flush logic
  window.__revival = { queueWrite, pendingCount };

  // ---------------------------------------------------------------------------
  // Mock workout data (Tuesday — Lower A, Block 1 Week 1, return-from-layoff)
  // Buckets snapped to SPEC § 3 (pink 8-10 compound, orange 12-15 isolation).
  // Block_UL_4d sheet has stale 10-12 prescriptions — flagged separately.
  // ---------------------------------------------------------------------------
  const TODAY_WORKOUT = {
    day: 'Tuesday',
    workoutName: 'Lower A',
    exercises: [
      {
        id: 'hack-squat',
        name: 'Hack Squat',
        bucket: 'pink',
        sets: 3,
        repsLow: 8,
        repsHigh: 10,
        rir: 4,
        last: { load: 225, reps: [9, 8, 8], unit: 'lb' }
      },
      {
        id: 'rdl-db',
        name: 'Romanian Deadlift (DB)',
        bucket: 'pink',
        sets: 3,
        repsLow: 8,
        repsHigh: 10,
        rir: 4,
        last: { load: 80, reps: [10, 9, 8], unit: 'lb' }
      },
      {
        id: 'leg-press',
        name: 'Leg Press',
        bucket: 'pink',
        sets: 3,
        repsLow: 8,
        repsHigh: 10,
        rir: 4,
        last: { load: 270, reps: [9, 8, 8], unit: 'lb' }
      },
      {
        id: 'seated-leg-curl',
        name: 'Seated Leg Curl',
        bucket: 'orange',
        sets: 3,
        repsLow: 12,
        repsHigh: 15,
        rir: 4,
        last: { load: 95, reps: [13, 12, 12], unit: 'lb' }
      },
      {
        id: 'standing-calf-raise',
        name: 'Standing Calf Raise',
        bucket: 'orange',
        sets: 3,
        repsLow: 12,
        repsHigh: 15,
        rir: 4,
        last: { load: 180, reps: [15, 13, 12], unit: 'lb' }
      },
      {
        id: 'hanging-leg-raise',
        name: 'Hanging Leg Raise',
        bucket: 'orange',
        sets: 3,
        repsLow: 12,
        repsHigh: 15,
        rir: 4,
        last: { load: 'BW', reps: [12, 11, 10], unit: '' }
      }
    ]
  };

  // ---------------------------------------------------------------------------
  // Settings — single source of truth. Apps Script will hydrate / persist later.
  // SPEC § 2 defaults (Will edits these in Settings, not here).
  // ---------------------------------------------------------------------------
  const TODAY_ISO = '2026-05-05';
  const SETTINGS = {
    goalWeight:     170,
    goalDate:       '2026-07-01',
    startWeight:    190,
    lossCap:        0.75,
    blockNumber:    1,
    blockStartDate: '2026-04-27',
    activeSplit:    'UL 4d',          // 'UL 4d' | 'PPL 6d' | 'Original 6d'
    rirFloor:       4,                // return phase per SPEC § 3
    whoopEnabled:   false,
    appleHealthStatus: 'Manual',
    appleHealthSub:    'Auto-sync requires iOS Shortcut',
    sheetStatus:       'Connected',
    sheetSub:          'Revival_Tracker_v3',
    appsScriptUrl:  'https://script.google.com/macros/s/AKfycbwAYGx4bmY6RCNmhUziETCdqPwYw2mXZQk-zF-1rqYYPoCEJTgdhSh8Hd5rPSbjh5H_/exec'
  };
  // Mock streak state (real source TBD — workout completions in last 7 days)
  const STREAK = { done: 4, total: 4 };

  function generateMockWeightLog(today, days) {
    const log = [];
    const start = 192.5;          // ~30 days ago
    const end   = 189.4;          // today — ~0.70 lbs/wk descent, plausible recomp under loss cap
    const t0 = new Date(today + 'T00:00:00');
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(t0);
      d.setDate(d.getDate() - i);
      const t = (days - 1 - i) / (days - 1);
      const base = start + (end - start) * t;
      const noise = Math.sin(i * 1.7) * 0.18 + Math.cos(i * 0.9) * 0.12;
      log.push({
        date: d.toISOString().slice(0, 10),
        weight: Math.round((base + noise) * 10) / 10
      });
    }
    return log;
  }
  const MOCK_WEIGHT_LOG = generateMockWeightLog(TODAY_ISO, 30);

  // ---------------------------------------------------------------------------
  // Plate calculator — greedy from Olympic plates [45, 35, 25, 10, 5, 2.5]
  // Bar default 45 lb. Returns null when the target is loadable on a bar.
  // ---------------------------------------------------------------------------
  const PLATES_LB = [45, 35, 25, 10, 5, 2.5];
  const BAR_LB    = 45;

  function calcPlates(target, bar) {
    if (target == null || target === 'BW') return null;
    const t = parseFloat(target);
    if (!isFinite(t) || t < bar) return null;
    let perSide = (t - bar) / 2;
    if (perSide < 0) return null;
    const used = [];
    for (const p of PLATES_LB) {
      while (perSide + 1e-6 >= p) {
        used.push(p);
        perSide -= p;
      }
    }
    return { used: used, leftoverPerSide: perSide };
  }

  function formatPlates(target) {
    const r = calcPlates(target, BAR_LB);
    if (!r) return null;
    if (r.used.length === 0) {
      return r.leftoverPerSide < 0.01 ? 'Bar only' : 'Custom';
    }
    const counts = {};
    r.used.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    const parts = [];
    PLATES_LB.forEach(p => {
      if (!counts[p]) return;
      const n = counts[p];
      parts.push(n > 1 ? n + '×' + p : String(p));
    });
    let text = parts.join(' + ') + ' per side';
    if (r.leftoverPerSide > 0.01) {
      const shortBoth = (r.leftoverPerSide * 2).toFixed(1);
      text += '<span class="plates-spare"> · +' + shortBoth + ' lb short</span>';
    }
    return text;
  }

  // ---------------------------------------------------------------------------
  // SVG icons (SF Symbols-style, inline so they pick up currentColor)
  // ---------------------------------------------------------------------------
  const ICONS = {
    swap:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M7 7h11l-3-3M17 17H6l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.startsWith('data-')) node.setAttribute(k, attrs[k]);
        else if (k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'inputmode' || k === 'min' || k === 'max' || k === 'step' || k === 'pattern' || k === 'placeholder' || k === 'for' || k === 'name') node.setAttribute(k, attrs[k]);
        else node[k] = attrs[k];
      }
    }
    (children || []).forEach(c => {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function renderTodayHeader(workout) {
    document.getElementById('today-eyebrow').textContent =
      workout.day + ' · ' + workout.workoutName;
    document.getElementById('today-title').textContent =
      'Block ' + SETTINGS.blockNumber + ' · Week ' + blockWeek();
  }

  function renderDeloadRecap(ex) {
    if (!ex.last || ex.last.load === 'BW' || ex.last.load == null) {
      return el('div', { class: 'exercise-recap' }, [
        el('span', { class: 'recap-label', text: 'Suggest' }),
        el('span', { class: 'recap-value', text: 'Light load · easy' })
      ]);
    }
    const target = Math.round(ex.last.load * 0.7);
    return el('div', { class: 'exercise-recap' }, [
      el('span', { class: 'recap-label', text: 'Suggest' }),
      el('span', { class: 'recap-value', text: '~' + target + ' ' + (ex.last.unit || 'lb') + ' (70%)' })
    ]);
  }

  function renderRecap(last) {
    if (!last) return el('div', { class: 'exercise-recap' }, [
      el('span', { class: 'recap-label', text: 'Last session' }),
      el('span', { class: 'recap-value recap-empty', text: 'No history yet' })
    ]);
    const loadStr = (last.load === 'BW' || last.load == null)
      ? 'BW'
      : last.load + ' ' + (last.unit || 'lb');
    const repsStr = last.reps.join(', ');
    return el('div', { class: 'exercise-recap' }, [
      el('span', { class: 'recap-label', text: 'Last session' }),
      el('span', { class: 'recap-value', text: loadStr + ' · ' + repsStr + ' reps' })
    ]);
  }

  function renderSetRow(setNum, exId, exName) {
    const wId = exId + '-s' + setNum + '-w';
    const rId = exId + '-s' + setNum + '-r';
    const iId = exId + '-s' + setNum + '-i';
    const showLabels = setNum === 1;

    function field(labelText, inputId, inputAttrs) {
      const children = [];
      if (showLabels) {
        children.push(el('label', { class: 'set-field-label', for: inputId, text: labelText }));
      }
      const inputProps = Object.assign(
        { class: 'set-input', id: inputId, type: 'number', placeholder: '—' },
        inputAttrs
      );
      if (!showLabels) {
        inputProps['aria-label'] = exName + ' set ' + setNum + ' ' + labelText.toLowerCase();
      }
      children.push(el('input', inputProps));
      return el('div', { class: 'set-field' }, children);
    }

    return el('div', { class: 'set-row', 'data-set': setNum }, [
      el('div', { class: 'set-label', text: 'Set ' + setNum }),
      el('div', { class: 'set-inputs' }, [
        field('Weight', wId, { inputmode: 'decimal', step: '2.5' }),
        field('Reps',   rId, { inputmode: 'numeric', pattern: '[0-9]*', step: '1' }),
        field('RIR',    iId, { inputmode: 'numeric', pattern: '[0-9]*', step: '1' })
      ])
    ]);
  }

  function renderExerciseCard(ex) {
    const article = el('article', {
      class: 'exercise',
      'data-bucket': ex.bucket,
      'data-id': ex.id
    });
    article.appendChild(el('div', { class: 'exercise-band', 'aria-hidden': 'true' }));

    const body = el('div', { class: 'exercise-body' });
    const p = effectivePrescription(ex);
    const deload = isDeloadActive();

    const headerInfo = el('div', { class: 'exercise-info' }, [
      el('h2', { class: 'exercise-name', text: ex.name }),
      el('p', { class: 'exercise-target', text:
        p.sets + ' × ' + p.repsLow + '–' + p.repsHigh + ' · RIR ' + p.rir +
        (deload ? ' · Deload' : '')
      })
    ]);

    const swapBtn = el('button', {
      class: 'exercise-swap',
      type: 'button',
      'aria-label': 'Swap exercise',
      html: ICONS.swap
    });

    const header = el('header', { class: 'exercise-header' }, [headerInfo, swapBtn]);
    body.appendChild(header);
    body.appendChild(deload ? renderDeloadRecap(ex) : renderRecap(ex.last));

    // Plate calc row — initial target = last load (deload uses 70% as suggested)
    const initialTarget = deload && ex.last && ex.last.load !== 'BW'
      ? Math.round(ex.last.load * 0.7)
      : (ex.last && ex.last.load !== 'BW' ? ex.last.load : null);
    const platesText = initialTarget != null ? formatPlates(initialTarget) : null;
    if (platesText) {
      body.appendChild(el('div', { class: 'exercise-plates' }, [
        el('span', { class: 'plates-label', text: 'Plates' }),
        el('span', { class: 'plates-value', html: platesText })
      ]));
    }

    const setList = el('div', { class: 'set-list' });
    for (let i = 1; i <= p.sets; i++) setList.appendChild(renderSetRow(i, ex.id, ex.name));
    body.appendChild(setList);

    body.appendChild(el('div', {
      class: 'verdict-slot',
      'data-verdict': 'pending',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      text: 'Verdict pending'
    }));

    article.appendChild(body);
    return article;
  }

  function renderToday(workout) {
    renderTodayHeader(workout);
    renderBriefing();
    renderDeloadBanner();
    const body = document.getElementById('today-body');
    body.innerHTML = '';
    workout.exercises.forEach(ex => body.appendChild(renderExerciseCard(ex)));
    // Initial verdicts (all pending) + counter
    workout.exercises.forEach(ex => {
      const card = body.querySelector('.exercise[data-id="' + ex.id + '"]');
      if (card) renderVerdict(card, ex);
    });
    renderCounter();
  }

  // ---------------------------------------------------------------------------
  // Block week + deload — derived from SETTINGS.blockStartDate + today.
  // Week 7 of every 7-week block = deload. Computed every render; never stored.
  // ---------------------------------------------------------------------------
  function blockWeek() {
    const days = daysBetween(SETTINGS.blockStartDate, TODAY_ISO);
    if (days < 0) return 0;
    return Math.floor(days / 7) + 1;
  }

  function isDeloadActive() {
    return blockWeek() === 7;
  }

  function isLastDayOfWeek7() {
    if (!isDeloadActive()) return false;
    const days = daysBetween(SETTINGS.blockStartDate, TODAY_ISO);
    return days === 48;   // 0-indexed last day of week 7 (week 7 day 7)
  }

  // Deload prescription overrides per Helms (SPEC § 3)
  function deloadPrescription(ex) {
    if (ex.bucket === 'pink') {
      return { sets: 2, repsLow: 6, repsHigh: 8, rir: 4 };
    }
    return { sets: 2, repsLow: 10, repsHigh: 12, rir: 4 };
  }

  function effectivePrescription(ex) {
    if (isDeloadActive()) return deloadPrescription(ex);
    return { sets: ex.sets, repsLow: ex.repsLow, repsHigh: ex.repsHigh, rir: ex.rir };
  }

  // ---------------------------------------------------------------------------
  // Daily briefing — Coach voice. Mock context for now (last-session callout
  // and WHOOP recovery come from real history when wired). Voice rules per
  // SPEC § 5b: direct, knowledgeable, slightly dry. No cheerleading.
  // ---------------------------------------------------------------------------
  const MOCK_LAST_SESSION_CALLOUT = {
    exercise: 'Hack Squat',
    verdict: 'green',
    bumpLbs: 5
  };
  const MOCK_WHOOP = {
    todayRecovery: 67,
    sevenDayAvg: 72
  };

  function buildBriefingLines() {
    const lines = [];
    const name = 'Will';

    // Greeting + workout name
    const w = workoutForActiveSplit();
    const wname = w ? w.workoutName : SETTINGS.activeSplit;
    lines.push({
      kind: 'greeting',
      html: 'Welcome back, <span class="b-emph">' + name + '</span>. ' + wname + ' today.'
    });

    // Last-session callout (only if there's something worth saying)
    if (MOCK_LAST_SESSION_CALLOUT && MOCK_LAST_SESSION_CALLOUT.verdict === 'green') {
      lines.push({
        html: 'Last session you hit top of range on <span class="b-emph">' +
          MOCK_LAST_SESSION_CALLOUT.exercise + '</span>. Bump ' +
          MOCK_LAST_SESSION_CALLOUT.bumpLbs + ' lbs.'
      });
    }

    // WHOOP — skip entirely if integration off
    if (SETTINGS.whoopEnabled) {
      lines.push({
        html: '<span class="b-dim">Recovery</span> ' + MOCK_WHOOP.todayRecovery +
          '%. <span class="b-dim">7-day avg</span> ' + MOCK_WHOOP.sevenDayAvg + '%.'
      });
    }

    // Streak
    const cap = STREAK.done >= STREAK.total ? ' Lock it in.' : '';
    lines.push({
      html: '<span class="b-dim">Streak</span> ' + STREAK.done + ' of ' +
        STREAK.total + ' this week.' + cap
    });

    return lines;
  }

  function renderBriefing() {
    const card = document.getElementById('briefing-card');
    if (!card) return;
    card.innerHTML = '';
    card.appendChild(el('p', { class: 'briefing-eyebrow', id: 'briefing-eyebrow', text: 'Daily Briefing' }));
    buildBriefingLines().forEach(line => {
      const cls = 'briefing-line' + (line.kind === 'greeting' ? ' briefing-greeting' : '');
      card.appendChild(el('p', { class: cls, html: line.html }));
    });
  }

  // ---------------------------------------------------------------------------
  // Helms progression engine — set-1-based verdict per SPEC § 3 / § 5
  // ---------------------------------------------------------------------------
  const setState = new Map();   // exId -> Map(setNum -> {weight, reps, rir})

  function getExSets(exId) {
    if (!setState.has(exId)) setState.set(exId, new Map());
    return setState.get(exId);
  }

  function exerciseById(id) {
    return TODAY_WORKOUT.exercises.find(e => e.id === id);
  }

  function computeVerdict(ex) {
    if (isDeloadActive()) {
      return { kind: 'pending', text: 'Deload · progression locked' };
    }
    const p = effectivePrescription(ex);
    const sets = getExSets(ex.id);
    if (sets.size < p.sets) {
      return { kind: 'pending', text: 'Verdict pending' };
    }
    const set1 = sets.get(1);
    if (!set1) return { kind: 'pending', text: 'Verdict pending' };

    if (set1.reps < p.repsLow) {
      return { kind: 'amber', text: 'BELOW RANGE · Logged' };
    }
    if (set1.reps >= p.repsHigh && set1.rir <= p.rir) {
      return { kind: 'green', text: 'TOP HIT · Bump 2.5–5 lbs next session' };
    }
    return { kind: 'blue', text: 'PUSH REPS · Hold this load' };
  }

  function renderVerdict(card, ex) {
    const slot = card.querySelector('.verdict-slot');
    const v = computeVerdict(ex);
    slot.dataset.verdict = v.kind;
    slot.textContent = v.text;
  }

  function renderCounter() {
    const counter = document.getElementById('progression-counter');
    if (isDeloadActive()) {
      counter.innerHTML = '';
      counter.hidden = true;
      return;
    }
    counter.hidden = false;
    const total = TODAY_WORKOUT.exercises.length;
    const top = TODAY_WORKOUT.exercises.reduce((n, ex) =>
      n + (computeVerdict(ex).kind === 'green' ? 1 : 0), 0);
    counter.innerHTML = '<strong>' + top + '</strong> of ' + total + ' hitting top';
    counter.dataset.zero = top === 0 ? 'true' : 'false';
  }

  function renderDeloadBanner() {
    const banner = document.getElementById('deload-banner');
    if (!isDeloadActive()) { banner.hidden = true; return; }
    banner.hidden = false;
    const titleEl = banner.querySelector('.deload-banner-title');
    const subEl   = banner.querySelector('.deload-banner-sub');
    titleEl.textContent = 'Week 7 · Deload';
    let sub = 'Cut volume. No grinding. Progression locked.';
    if (isLastDayOfWeek7()) {
      const next = SETTINGS.blockNumber + 1;
      sub = 'Block ' + SETTINGS.blockNumber + ' done. Block ' + next + ' starts Monday.';
    }
    subEl.textContent = sub;
  }

  // ---------------------------------------------------------------------------
  // Rest timer — floating bubble, count-down, tap-to-dismiss
  // Defaults: pink 120s · orange 75s. Deload cuts both by 33%.
  // ---------------------------------------------------------------------------
  const REST_SECS        = { pink: 120, orange: 75 };
  const REST_DELOAD_SECS = { pink: 80,  orange: 50 };
  const RING_CIRCUMFERENCE = 2 * Math.PI * 46;   // r=46 in viewBox 0 0 100 100

  function defaultRestSeconds(ex) {
    const t = isDeloadActive() ? REST_DELOAD_SECS : REST_SECS;
    return t[ex.bucket] || 90;
  }

  let restTimer = null;   // { total, remaining, intervalId, doneAt, exName }

  function fmtMmSs(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' + r : r);
  }

  function paintRestRing() {
    const fill = document.querySelector('#rest-timer .rest-ring-fill');
    if (!fill) return;
    const ratio = restTimer ? restTimer.remaining / restTimer.total : 0;
    // Inline styles win over the external stylesheet defaults.
    fill.style.strokeDasharray  = String(RING_CIRCUMFERENCE);
    fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ratio));
  }

  function paintRestNumbers() {
    if (!restTimer) return;
    document.getElementById('rest-mmss').textContent = fmtMmSs(restTimer.remaining);
    document.getElementById('rest-label').textContent = restTimer.exName + ' · rest';
  }

  function dismissTimer() {
    if (restTimer && restTimer.intervalId) clearInterval(restTimer.intervalId);
    restTimer = null;
    const overlay = document.getElementById('rest-timer');
    overlay.classList.remove('is-done');
    overlay.hidden = true;
    const status = document.getElementById('rest-status');
    if (status) status.textContent = '';
  }

  function tickTimer() {
    if (!restTimer) return;
    if (restTimer.remaining > 0) {
      restTimer.remaining -= 1;
      paintRestNumbers();
      paintRestRing();
      if (restTimer.remaining === 0) onTimerDone();
    } else if (restTimer.doneAt && Date.now() - restTimer.doneAt >= 3000) {
      dismissTimer();
    }
  }

  function onTimerDone() {
    restTimer.doneAt = Date.now();
    const overlay = document.getElementById('rest-timer');
    overlay.classList.add('is-done');
    const status = document.getElementById('rest-status');
    if (status) status.textContent = 'Rest complete';
    if ('vibrate' in navigator) {
      try { navigator.vibrate([100, 60, 100]); } catch (e) {}
    }
  }

  function startRestTimer(ex) {
    const total = defaultRestSeconds(ex);
    if (restTimer && restTimer.intervalId) clearInterval(restTimer.intervalId);
    restTimer = {
      total: total,
      remaining: total,
      intervalId: null,
      doneAt: null,
      exName: ex.name
    };
    const overlay = document.getElementById('rest-timer');
    overlay.classList.remove('is-done');
    overlay.hidden = false;
    paintRestNumbers();
    paintRestRing();
    restTimer.intervalId = setInterval(tickTimer, 1000);
  }

  document.getElementById('rest-timer-btn').addEventListener('click', dismissTimer);

  // Dev hook for screenshots: window.__revival.previewRestTimer('hack-squat', 78)
  window.__revival.previewRestTimer = function (exId, remaining) {
    const ex = exerciseById(exId) || TODAY_WORKOUT.exercises[0];
    startRestTimer(ex);
    if (remaining != null) {
      restTimer.remaining = Math.max(0, Math.min(restTimer.total, remaining));
      paintRestNumbers();
      paintRestRing();
    }
  };

  // ---------------------------------------------------------------------------
  // Per-set save-on-blur — fires when all 3 fields (weight/reps/RIR) are filled
  // ---------------------------------------------------------------------------
  const savedSig = new Map();   // `${exId}:${setNum}` -> JSON of last saved values

  function readSet(row) {
    const inputs = row.querySelectorAll('.set-input');
    const w = inputs[0].value;
    const r = inputs[1].value;
    const i = inputs[2].value;
    if (w === '' || r === '' || i === '') return null;
    const weight = parseFloat(w);
    const reps   = parseInt(r, 10);
    const rir    = parseFloat(i);
    if (!isFinite(weight) || !isFinite(reps) || !isFinite(rir)) return null;
    return { weight, reps, rir };
  }

  function pulseRow(row) {
    row.classList.remove('is-saved-pulse');
    void row.offsetWidth;            // restart the animation
    row.classList.add('is-saved-pulse');
  }

  function todayDateStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function trySaveSet(row) {
    const card = row.closest('.exercise');
    if (!card) return;
    const values = readSet(row);
    if (!values) return;

    const exId    = card.dataset.id;
    const exName  = card.querySelector('.exercise-name').textContent;
    const setNum  = parseInt(row.dataset.set, 10);
    const sigKey  = exId + ':' + setNum;
    const sigStr  = JSON.stringify(values);
    if (savedSig.get(sigKey) === sigStr) return;   // dedup repeat blurs

    savedSig.set(sigKey, sigStr);

    const payload = {
      date:     todayDateStr(),
      workout:  TODAY_WORKOUT.workoutName,
      exercise: exName,
      set:      setNum,
      load:     values.weight,
      reps:     values.reps,
      rir:      values.rir
    };

    queueWrite('log_set', payload).then(id => {
      console.log('[revival] queued log_set #' + id, payload);
      row.classList.add('is-saved');
      pulseRow(row);
      updateSyncIndicator();
    }).catch(err => {
      console.error('[revival] queue failed', err);
    });

    getExSets(exId).set(setNum, values);
    const ex = exerciseById(exId);
    if (ex) {
      renderVerdict(card, ex);
      renderCounter();
      startRestTimer(ex);
    }
  }

  document.getElementById('today-body').addEventListener('focusout', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains('set-input')) return;
    const row = t.closest('.set-row');
    if (row) trySaveSet(row);
  });

  // Live plate-calc update — Set 1 weight input drives the plate row.
  document.getElementById('today-body').addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains('set-input')) return;
    const row = t.closest('.set-row');
    if (!row || row.dataset.set !== '1') return;
    const inputs = row.querySelectorAll('.set-input');
    if (t !== inputs[0]) return;   // only the weight input
    const card = t.closest('.exercise');
    if (!card) return;
    const platesEl = card.querySelector('.plates-value');
    if (!platesEl) return;
    const v = parseFloat(t.value);
    if (!isFinite(v)) return;
    const text = formatPlates(v);
    if (text) platesEl.innerHTML = text;
  });

  // ---------------------------------------------------------------------------
  // Weight view — entry, computations, SVG chart
  // ---------------------------------------------------------------------------
  function daysBetween(aIso, bIso) {
    const a = new Date(aIso + 'T00:00:00');
    const b = new Date(bIso + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function rollingPace(log, days) {
    if (log.length < 2) return null;
    const cutoff = log[log.length - 1];
    const cutoffDate = new Date(cutoff.date + 'T00:00:00');
    const startTarget = new Date(cutoffDate);
    startTarget.setDate(startTarget.getDate() - days);
    // Find oldest entry on or after startTarget
    const startEntry = log.find(e =>
      new Date(e.date + 'T00:00:00') >= startTarget) || log[0];
    const elapsedDays = daysBetween(startEntry.date, cutoff.date);
    if (elapsedDays <= 0) return null;
    const lossLbs = startEntry.weight - cutoff.weight;
    return lossLbs / (elapsedDays / 7);   // lbs/wk (positive = loss)
  }

  function computeStatus(actualLbsWk, requiredLbsWk, lossCap) {
    if (actualLbsWk > lossCap) {
      return { kind: 'too-fast', label: 'Too fast — eat more' };
    }
    if (requiredLbsWk <= 0) {
      return { kind: 'on-track', label: 'On track' };
    }
    // BEHIND only if losing slower than 80% of required.
    // Above the band but under loss cap = ahead of pace = ON TRACK.
    if (actualLbsWk < 0.8 * requiredLbsWk) {
      return { kind: 'behind', label: 'Behind pace' };
    }
    return { kind: 'on-track', label: 'On track' };
  }

  function fmtSigned(n, digits) {
    if (n == null || isNaN(n)) return '—';
    const s = n.toFixed(digits || 2);
    return n >= 0 ? '−' + Math.abs(n).toFixed(digits || 2) : '+' + Math.abs(n).toFixed(digits || 2);
    // (sign-flip: positive `n` = loss, shown as minus on display)
  }

  function renderWeightView() {
    const log = MOCK_WEIGHT_LOG.slice();
    const latest = log[log.length - 1];
    const previous = log.length > 1 ? log[log.length - 2] : null;

    // Big-number entry — pre-fill with latest as a hint, but leave editable
    const input = document.getElementById('weight-input');
    input.value = '';
    input.placeholder = String(latest.weight);

    document.getElementById('weight-entry-meta').textContent = previous
      ? 'Last logged ' + fmtDate(previous.date) + ' · ' + previous.weight + ' lbs'
      : 'No prior entries';

    // Goal cell
    document.getElementById('progress-goal').textContent = SETTINGS.goalWeight + ' lbs';
    const lbsToGoal = Math.max(0, latest.weight - SETTINGS.goalWeight);
    document.getElementById('progress-goal-sub').textContent =
      lbsToGoal.toFixed(1) + ' lbs to go';

    // Days left
    const daysLeft = Math.max(0, daysBetween(TODAY_ISO, SETTINGS.goalDate));
    document.getElementById('progress-days').textContent = daysLeft;
    document.getElementById('progress-days-sub').textContent =
      'until ' + fmtDate(SETTINGS.goalDate);

    // Required pace (lbs/wk)
    const weeksLeft = daysLeft / 7;
    const requiredPace = weeksLeft > 0 ? lbsToGoal / weeksLeft : 0;
    document.getElementById('progress-required').textContent = '−' + requiredPace.toFixed(2);

    // Actual pace — 14-day rolling
    const actualPace = rollingPace(log, 14) || 0;
    document.getElementById('progress-actual').textContent =
      (actualPace >= 0 ? '−' : '+') + Math.abs(actualPace).toFixed(2);

    // Status
    const status = computeStatus(actualPace, requiredPace, SETTINGS.lossCap);
    const row = document.getElementById('status-row');
    row.dataset.status = status.kind;
    document.getElementById('status-label').textContent = status.label;

    // Streak
    document.getElementById('streak-value').textContent =
      STREAK.done + ' / ' + STREAK.total;

    // Chart
    document.getElementById('chart-wrap').innerHTML = renderChartSvg(log, SETTINGS.goalWeight);
  }

  function renderChartSvg(log, goalWeight) {
    const W = 358, H = 160;
    const PADL = 28, PADR = 8, PADT = 10, PADB = 22;
    const innerW = W - PADL - PADR;
    const innerH = H - PADT - PADB;

    const weights = log.map(e => e.weight).concat([goalWeight]);
    const minW = Math.min(...weights) - 1;
    const maxW = Math.max(...weights) + 1;
    const yScale = w => PADT + innerH * (1 - (w - minW) / (maxW - minW));
    const xScale = i => PADL + innerW * (i / (log.length - 1));

    // Y gridlines (4 ticks)
    const ticks = 4;
    let grid = '';
    let yLabels = '';
    for (let t = 0; t <= ticks; t++) {
      const v = minW + ((maxW - minW) * t) / ticks;
      const y = yScale(v);
      grid += '<line x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + y +
              '" y2="' + y + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
      yLabels += '<text x="' + (PADL - 6) + '" y="' + (y + 3) +
                 '" text-anchor="end" font-size="9" fill="#8E8E93" font-family="-apple-system, system-ui">' +
                 Math.round(v) + '</text>';
    }

    // X labels (3 — first, mid, last)
    let xLabels = '';
    [0, Math.floor(log.length / 2), log.length - 1].forEach(i => {
      xLabels += '<text x="' + xScale(i) + '" y="' + (H - 6) +
                 '" text-anchor="middle" font-size="9" fill="#8E8E93" font-family="-apple-system, system-ui">' +
                 fmtDate(log[i].date) + '</text>';
    });

    // Goal line (dotted)
    const goalY = yScale(goalWeight);
    const goalLine =
      '<line x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + goalY +
      '" y2="' + goalY + '" stroke="#30D158" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.85"/>';

    // Weight line + area
    const linePts = log.map((e, i) => xScale(i) + ',' + yScale(e.weight)).join(' ');
    const areaPath = 'M ' + xScale(0) + ' ' + (PADT + innerH) +
                     ' L ' + log.map((e, i) => xScale(i) + ' ' + yScale(e.weight)).join(' L ') +
                     ' L ' + xScale(log.length - 1) + ' ' + (PADT + innerH) + ' Z';
    const area = '<path d="' + areaPath + '" fill="rgba(10,132,255,0.12)"/>';
    const polyline = '<polyline points="' + linePts +
                     '" fill="none" stroke="#0A84FF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    const lastDot =
      '<circle cx="' + xScale(log.length - 1) + '" cy="' + yScale(log[log.length - 1].weight) +
      '" r="3.5" fill="#0A84FF" stroke="#0A0A0A" stroke-width="1.5"/>';

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="30-day weight chart">' +
      grid + goalLine + area + polyline + lastDot + yLabels + xLabels +
      '</svg>';
  }

  // Save handler — queue log_weight to IndexedDB
  function wireWeightSave() {
    const input = document.getElementById('weight-input');
    const btn   = document.getElementById('weight-save');
    const card  = btn.closest('.card');

    function pulseEntry() {
      card.classList.remove('is-saved-pulse');
      void card.offsetWidth;
      card.classList.add('is-saved-pulse');
    }

    btn.addEventListener('click', () => {
      const v = parseFloat(input.value);
      if (!isFinite(v) || v < 50 || v > 500) {
        input.focus();
        return;
      }
      const payload = { date: TODAY_ISO, weight: v, source: 'Manual' };
      queueWrite('log_weight', payload).then(id => {
        console.log('[revival] queued log_weight #' + id, payload);
        MOCK_WEIGHT_LOG.push({ date: TODAY_ISO, weight: v });
        const last = MOCK_WEIGHT_LOG[MOCK_WEIGHT_LOG.length - 2];
        if (last && last.date === TODAY_ISO) MOCK_WEIGHT_LOG.splice(-2, 1);
        renderWeightView();
        pulseEntry();
        input.blur();
        updateSyncIndicator();
      }).catch(err => console.error('[revival] log_weight queue failed', err));
    });
  }

  // ---------------------------------------------------------------------------
  // Active split routing — renders Today based on SETTINGS.activeSplit
  // For non-UL splits we show a stub until step that wires Sheet workouts.
  // ---------------------------------------------------------------------------
  function workoutForActiveSplit() {
    if (SETTINGS.activeSplit === 'UL 4d') return TODAY_WORKOUT;
    return null; // PPL 6d / Original 6d not mocked yet
  }

  function renderTodayForSplit() {
    const w = workoutForActiveSplit();
    const eyebrow = document.getElementById('today-eyebrow');
    const title   = document.getElementById('today-title');
    const counter = document.getElementById('progression-counter');
    const banner  = document.getElementById('deload-banner');
    const body    = document.getElementById('today-body');

    if (w) {
      renderToday(w);
      return;
    }
    eyebrow.textContent = 'Tuesday · ' + SETTINGS.activeSplit;
    title.textContent   = 'Block ' + SETTINGS.blockNumber + ' · Week 1';
    counter.innerHTML   = '';
    counter.dataset.zero = 'true';
    banner.hidden = true;
    body.innerHTML = '';
    const stub = document.createElement('div');
    stub.className = 'split-stub';
    stub.innerHTML = '<strong>' + SETTINGS.activeSplit + ' workouts not yet wired</strong>' +
      'Mock data only exists for UL 4d. Switch back in Settings to see Lower A.';
    body.appendChild(stub);
    // Briefing still renders for non-UL splits (greeting + streak only)
    renderBriefing();
  }

  // ---------------------------------------------------------------------------
  // Settings view — render, wire, save on change, propagate to dependent views
  // ---------------------------------------------------------------------------
  function row(label, sub, controlNode) {
    const r = el('div', { class: 'settings-row' }, [
      el('div', { class: 'settings-row-label' }, [
        document.createTextNode(label),
        sub ? el('span', { class: 'settings-row-sub', text: sub }) : null
      ]),
      el('div', { class: 'settings-row-control' }, controlNode ? [].concat(controlNode) : [])
    ]);
    return r;
  }

  function input(attrs) {
    return el('input', Object.assign({ class: 'settings-input' }, attrs));
  }
  function select(attrs, options, current) {
    const sel = el('select', Object.assign({ class: 'settings-select' }, attrs));
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = String(opt);
      o.textContent = String(opt);
      if (String(opt) === String(current)) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  function unit(text) { return el('span', { class: 'settings-unit', text: text }); }

  function toggle(key, ariaLabel) {
    const btn = el('button', {
      class: 'toggle-button',
      type: 'button',
      'aria-label': ariaLabel,
      'aria-pressed': SETTINGS[key] ? 'true' : 'false'
    });
    btn.dataset.toggleKey = key;
    return btn;
  }

  function statusPill(text, state) {
    return el('span', {
      class: 'settings-status',
      'data-state': state,
      html: '<span class="status-dot" aria-hidden="true"></span>' +
            '<span>' + text + '</span>'
    });
  }

  function section(title, rows) {
    const wrap = el('div', { class: 'settings-section' }, [
      el('p', { class: 'settings-section-title', text: title }),
      el('div', { class: 'settings-card' }, rows)
    ]);
    return wrap;
  }

  function renderSettingsView() {
    const body = document.getElementById('settings-body');
    body.innerHTML = '';

    const goalSection = section('Goal', [
      row('Goal weight', null, [
        input({ type: 'number', inputmode: 'decimal', step: '0.5',
          'data-setting-key': 'goalWeight', 'aria-label': 'Goal weight in pounds',
          value: SETTINGS.goalWeight }),
        unit('lbs')
      ]),
      row('Goal date', null,
        input({ type: 'date', 'data-setting-key': 'goalDate',
          'aria-label': 'Goal date', value: SETTINGS.goalDate })
      ),
      row('Starting weight', null, [
        input({ type: 'number', inputmode: 'decimal', step: '0.5',
          'data-setting-key': 'startWeight', 'aria-label': 'Starting weight in pounds',
          value: SETTINGS.startWeight }),
        unit('lbs')
      ]),
      row('Loss cap', 'Above this → eat more', [
        input({ type: 'number', inputmode: 'decimal', step: '0.05',
          'data-setting-key': 'lossCap', 'aria-label': 'Loss cap pounds per week',
          value: SETTINGS.lossCap }),
        unit('lbs/wk')
      ])
    ]);

    const programSection = section('Program', [
      row('Active split', null,
        select({ 'data-setting-key': 'activeSplit', 'aria-label': 'Active split' },
          ['UL 4d', 'PPL 6d', 'Original 6d'], SETTINGS.activeSplit)
      ),
      row('RIR floor', 'Return phase: 4–5', null)
    ]);
    // RIR floor select needs to be inserted into the second row's control
    programSection.querySelectorAll('.settings-row-control')[1].appendChild(
      select({ 'data-setting-key': 'rirFloor', 'aria-label': 'RIR floor' },
        [0, 1, 2, 3, 4, 5], SETTINGS.rirFloor)
    );
    programSection.querySelector('.settings-card').appendChild(
      row('Block number', null, [
        input({ type: 'number', inputmode: 'numeric', step: '1', min: '1',
          'data-setting-key': 'blockNumber', 'aria-label': 'Block number',
          value: SETTINGS.blockNumber })
      ])
    );
    programSection.querySelector('.settings-card').appendChild(
      row('Block start date', null,
        input({ type: 'date', 'data-setting-key': 'blockStartDate',
          'aria-label': 'Block start date', value: SETTINGS.blockStartDate })
      )
    );

    const integrationsSection = section('Integrations', [
      row('WHOOP', SETTINGS.whoopEnabled ? 'Enabled' : 'Off — enable when ready',
        toggle('whoopEnabled', 'WHOOP integration')),
      row('Apple Health', SETTINGS.appleHealthSub,
        statusPill(SETTINGS.appleHealthStatus, 'warn')),
      row('Google Sheet', SETTINGS.sheetSub,
        statusPill(SETTINGS.sheetStatus, 'ok'))
    ]);

    const advancedSection = section('Advanced', [
      el('div', { class: 'settings-row settings-row--stack' }, [
        el('div', { class: 'settings-row-label' }, [
          document.createTextNode('Apps Script Web App URL'),
          el('span', { class: 'settings-row-sub', text: 'Used by all writes — change with care' })
        ]),
        el('div', { class: 'settings-row-control' }, [
          input({ type: 'url', class: 'settings-input settings-input--mono',
            'data-setting-key': 'appsScriptUrl', 'aria-label': 'Apps Script Web App URL',
            value: SETTINGS.appsScriptUrl })
        ])
      ])
    ]);

    body.appendChild(goalSection);
    body.appendChild(programSection);
    body.appendChild(integrationsSection);
    body.appendChild(advancedSection);
  }

  function flashRow(node) {
    const r = node.closest('.settings-row');
    if (!r) return;
    r.classList.remove('is-saved-flash');
    void r.offsetWidth;
    r.classList.add('is-saved-flash');
  }

  function saveSetting(key, value) {
    SETTINGS[key] = value;
    queueWrite('update_setting', { key: key, value: value })
      .then(id => { console.log('[revival] queued update_setting #' + id, key, '=', value); updateSyncIndicator(); })
      .catch(err => console.error('[revival] update_setting queue failed', err));
    // Propagate to dependent views
    if (key === 'goalWeight' || key === 'goalDate' ||
        key === 'startWeight' || key === 'lossCap') {
      renderWeightView();
    }
    if (key === 'activeSplit' || key === 'blockStartDate' || key === 'blockNumber') {
      renderTodayForSplit();
    }
  }

  function wireSettings() {
    const body = document.getElementById('settings-body');

    body.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const key = t.dataset.settingKey;
      if (!key) return;
      let value;
      if (t.type === 'number') {
        const n = parseFloat(t.value);
        if (!isFinite(n)) { t.value = SETTINGS[key]; return; }
        value = n;
      } else {
        value = t.value;
      }
      saveSetting(key, value);
      flashRow(t);
    });

    body.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-button');
      if (!btn) return;
      const key = btn.dataset.toggleKey;
      const next = !(btn.getAttribute('aria-pressed') === 'true');
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      saveSetting(key, next);
      flashRow(btn);
      // Update the sub-text on the WHOOP row
      if (key === 'whoopEnabled') {
        const row = btn.closest('.settings-row');
        const sub = row && row.querySelector('.settings-row-sub');
        if (sub) sub.textContent = next ? 'Enabled' : 'Off — enable when ready';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Onboarding — first-run only, blocks Today until done
  // ---------------------------------------------------------------------------
  const ONBOARDING_KEY = 'revival.onboarding.complete';

  // Local draft — captured per step, committed to SETTINGS on finish
  const obDraft = {
    name:           'Will',
    currentWeight:  189.5,
    goalWeight:     SETTINGS.goalWeight,
    goalDate:       SETTINGS.goalDate,
    phase:          'return',         // 'return' | 'full'
    activeSplit:    SETTINGS.activeSplit,
    blockNumber:    SETTINGS.blockNumber,
    blockStartDate: SETTINGS.blockStartDate,
    whoopEnabled:   SETTINGS.whoopEnabled,
    appleHealthOn:  true              // default-on per SPEC § 5
  };

  let obIndex = 0;
  const ob = () => document.getElementById('onboarding');

  function nextWorkoutForSplit(split, fromDateIso) {
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const tablesByDow = {
      'UL 4d':       { Mon: 'Upper A', Tue: 'Lower A', Wed: null, Thu: 'Upper B', Fri: 'Lower B', Sat: null, Sun: null },
      'PPL 6d':      { Mon: 'Push 1',  Tue: 'Pull 1',  Wed: 'Legs 1', Thu: 'Push 2', Fri: 'Pull 2', Sat: 'Legs 2', Sun: null },
      'Original 6d': { Mon: 'Upper 1', Tue: 'Lower 1', Wed: null, Thu: 'Chest/Arms', Fri: 'Back/Delts', Sat: 'Lower 2', Sun: null }
    };
    const tbl = tablesByDow[split];
    const start = new Date(fromDateIso + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dow = dows[d.getDay()];
      if (tbl[dow]) {
        const label = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }));
        return { when: label, workout: tbl[dow] };
      }
    }
    return null;
  }

  const OB_STEPS = [
    {
      key: 'welcome',
      render: () => ({
        body: el('div', { class: 'ob-fields' }, [
          el('h1', { class: 'ob-headline', id: 'ob-title', text: 'Hey ' + obDraft.name + '. Let’s set up your block.' }),
          el('p',  { class: 'ob-sub',
            text: 'A minute or so. You can change anything later in Settings.' })
        ]),
        canNext: true,
        primaryLabel: 'Get started'
      })
    },
    {
      key: 'profile',
      render: () => ({
        body: (function() {
          const wrap = el('div', { class: 'ob-fields' }, [
            el('h1', { class: 'ob-headline', id: 'ob-title', text: 'Your starting line' }),
            el('p',  { class: 'ob-sub',     text: 'These set up the Weight view + pace math.' })
          ]);
          const fName = el('div', { class: 'ob-field' }, [
            el('label', { class: 'ob-field-label', for: 'ob-name', text: 'Name' }),
            el('input', { class: 'ob-input', id: 'ob-name', type: 'text', value: obDraft.name,
              'data-ob-key': 'name', 'aria-label': 'Your name' })
          ]);
          const fCur = el('div', { class: 'ob-field' }, [
            el('label', { class: 'ob-field-label', for: 'ob-cur', text: 'Current weight (lbs)' }),
            el('input', { class: 'ob-input', id: 'ob-cur', type: 'number', inputmode: 'decimal', step: '0.1',
              value: obDraft.currentWeight,
              'data-ob-key': 'currentWeight', 'aria-label': 'Current weight in pounds' })
          ]);
          const fGoal = el('div', { class: 'ob-field' }, [
            el('label', { class: 'ob-field-label', for: 'ob-goalw', text: 'Goal weight (lbs)' }),
            el('input', { class: 'ob-input', id: 'ob-goalw', type: 'number', inputmode: 'decimal', step: '0.5',
              value: obDraft.goalWeight,
              'data-ob-key': 'goalWeight', 'aria-label': 'Goal weight in pounds' })
          ]);
          const fDate = el('div', { class: 'ob-field' }, [
            el('label', { class: 'ob-field-label', for: 'ob-goald', text: 'Goal date' }),
            el('input', { class: 'ob-input', id: 'ob-goald', type: 'date',
              value: obDraft.goalDate,
              'data-ob-key': 'goalDate', 'aria-label': 'Goal date' })
          ]);
          wrap.appendChild(fName);
          wrap.appendChild(fCur);
          wrap.appendChild(fGoal);
          wrap.appendChild(fDate);
          return wrap;
        })(),
        canNext: true
      })
    },
    {
      key: 'phase',
      render: () => ({
        body: (function() {
          const wrap = el('div', { class: 'ob-fields' }, [
            el('h1', { class: 'ob-headline', id: 'ob-title', text: 'Where are you starting?' }),
            el('p',  { class: 'ob-sub', text: 'Sets your RIR floor. Return phase = no grinding sets.' })
          ]);
          const list = el('div', { class: 'ob-choice-list' });
          [
            { val: 'return', title: 'Return from layoff', sub: 'RIR floor 4 · 50% volume' },
            { val: 'full',   title: 'Full volume',         sub: 'RIR floor 2 · standard programming' }
          ].forEach(opt => {
            const btn = el('button', {
              class: 'ob-choice',
              type: 'button',
              'aria-pressed': obDraft.phase === opt.val ? 'true' : 'false'
            }, [
              el('span', { class: 'ob-choice-title', text: opt.title }),
              el('span', { class: 'ob-choice-sub',   text: opt.sub })
            ]);
            btn.dataset.obChoiceKey = 'phase';
            btn.dataset.obChoiceVal = opt.val;
            list.appendChild(btn);
          });
          wrap.appendChild(list);
          return wrap;
        })(),
        canNext: true
      })
    },
    {
      key: 'split',
      render: () => ({
        body: (function() {
          const wrap = el('div', { class: 'ob-fields' }, [
            el('h1', { class: 'ob-headline', id: 'ob-title', text: 'Pick your split' }),
            el('p',  { class: 'ob-sub', text: 'Default is Upper/Lower 4-day. You can swap any time in Settings.' })
          ]);
          const list = el('div', { class: 'ob-choice-list' });
          [
            { val: 'UL 4d',       title: 'Upper / Lower — 4 day', sub: 'Mon · Tue · Thu · Fri' },
            { val: 'PPL 6d',      title: 'Push / Pull / Legs — 6 day', sub: 'Higher volume, full schedule' },
            { val: 'Original 6d', title: 'Original 6-day',          sub: 'Your prior block' }
          ].forEach(opt => {
            const btn = el('button', {
              class: 'ob-choice',
              type: 'button',
              'aria-pressed': obDraft.activeSplit === opt.val ? 'true' : 'false'
            }, [
              el('span', { class: 'ob-choice-title', text: opt.title }),
              el('span', { class: 'ob-choice-sub',   text: opt.sub })
            ]);
            btn.dataset.obChoiceKey = 'activeSplit';
            btn.dataset.obChoiceVal = opt.val;
            list.appendChild(btn);
          });
          wrap.appendChild(list);
          // Block start + number
          const blockRow = el('div', { class: 'ob-input-row' }, [
            el('div', { class: 'ob-field' }, [
              el('label', { class: 'ob-field-label', for: 'ob-blockn', text: 'Block #' }),
              el('input', { class: 'ob-input', id: 'ob-blockn', type: 'number', step: '1', min: '1',
                value: obDraft.blockNumber, 'data-ob-key': 'blockNumber', 'aria-label': 'Block number' })
            ]),
            el('div', { class: 'ob-field' }, [
              el('label', { class: 'ob-field-label', for: 'ob-blocks', text: 'Block start' }),
              el('input', { class: 'ob-input', id: 'ob-blocks', type: 'date',
                value: obDraft.blockStartDate, 'data-ob-key': 'blockStartDate', 'aria-label': 'Block start date' })
            ])
          ]);
          wrap.appendChild(blockRow);
          return wrap;
        })(),
        canNext: true
      })
    },
    {
      key: 'integrations',
      render: () => ({
        body: (function() {
          const wrap = el('div', { class: 'ob-fields' }, [
            el('h1', { class: 'ob-headline', id: 'ob-title', text: 'Integrations' }),
            el('p',  { class: 'ob-sub', text: 'Both optional. Manual entry always works.' })
          ]);
          function makeToggleRow(title, sub, key, ariaLabel) {
            const t = el('button', {
              class: 'toggle-button',
              type: 'button',
              'aria-label': ariaLabel,
              'aria-pressed': obDraft[key] ? 'true' : 'false'
            });
            t.dataset.obToggleKey = key;
            return el('div', { class: 'ob-toggle-row' }, [
              el('div', { class: 'ob-toggle-text' }, [
                el('span', { class: 'ob-toggle-title', text: title }),
                el('span', { class: 'ob-toggle-sub',   text: sub })
              ]),
              t
            ]);
          }
          wrap.appendChild(makeToggleRow('WHOOP', 'Connect later in Settings if you want', 'whoopEnabled', 'WHOOP integration'));
          wrap.appendChild(makeToggleRow('Apple Health', 'Manual fallback always available', 'appleHealthOn', 'Apple Health connection'));
          return wrap;
        })(),
        canNext: true
      })
    },
    {
      key: 'walkthrough',
      render: () => {
        const next = nextWorkoutForSplit(obDraft.activeSplit, TODAY_ISO);
        const line = next
          ? next.when + ' is ' + next.workout + '. Open the app and follow the cards.'
          : 'No workout in the next 7 days for that split. Pick another in Settings.';
        return {
          body: el('div', { class: 'ob-fields' }, [
            el('h1', { class: 'ob-headline', id: 'ob-title', text: 'You’re set.' }),
            el('p',  { class: 'ob-sub', text: line })
          ]),
          canNext: true,
          primaryLabel: 'Done',
          isFinal: true
        };
      }
    }
  ];

  function renderOnboardingStep() {
    const step = OB_STEPS[obIndex].render();
    const content = document.getElementById('ob-content');
    content.innerHTML = '';
    content.appendChild(step.body);

    // Dots
    const dots = document.getElementById('ob-dots');
    dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'ob-dot';
      d.dataset.active = i === obIndex ? 'true' : 'false';
      dots.appendChild(d);
    });

    // Actions
    const actions = document.getElementById('ob-actions');
    actions.innerHTML = '';
    if (obIndex > 0) {
      const back = el('button', { class: 'ob-btn ob-btn-secondary', type: 'button',
        text: 'Back', 'aria-label': 'Previous step' });
      back.addEventListener('click', () => { obIndex--; renderOnboardingStep(); });
      actions.appendChild(back);
    }
    const primary = el('button', { class: 'ob-btn ob-btn-primary', type: 'button',
      text: step.primaryLabel || 'Continue',
      'aria-label': step.primaryLabel || 'Continue' });
    primary.disabled = !step.canNext;
    primary.addEventListener('click', () => {
      if (step.isFinal) finishOnboarding();
      else { obIndex++; renderOnboardingStep(); }
    });
    actions.appendChild(primary);
  }

  function commitObDraftToSettings() {
    SETTINGS.goalWeight     = parseFloat(obDraft.goalWeight)  || SETTINGS.goalWeight;
    SETTINGS.goalDate       = obDraft.goalDate                || SETTINGS.goalDate;
    SETTINGS.startWeight    = parseFloat(obDraft.currentWeight) || SETTINGS.startWeight;
    SETTINGS.activeSplit    = obDraft.activeSplit             || SETTINGS.activeSplit;
    SETTINGS.blockNumber    = parseInt(obDraft.blockNumber, 10) || SETTINGS.blockNumber;
    SETTINGS.blockStartDate = obDraft.blockStartDate          || SETTINGS.blockStartDate;
    SETTINGS.whoopEnabled   = !!obDraft.whoopEnabled;
    SETTINGS.rirFloor       = obDraft.phase === 'full' ? 2 : 4;
  }

  function finishOnboarding() {
    commitObDraftToSettings();
    queueWrite('update_settings', {
      name:           obDraft.name,
      goalWeight:     SETTINGS.goalWeight,
      goalDate:       SETTINGS.goalDate,
      startWeight:    SETTINGS.startWeight,
      activeSplit:    SETTINGS.activeSplit,
      blockNumber:    SETTINGS.blockNumber,
      blockStartDate: SETTINGS.blockStartDate,
      whoopEnabled:   SETTINGS.whoopEnabled,
      appleHealthOn:  obDraft.appleHealthOn,
      rirFloor:       SETTINGS.rirFloor
    }).then(id => { console.log('[revival] queued update_settings (onboarding) #' + id); updateSyncIndicator(); })
      .catch(err => console.error('[revival] onboarding save failed', err));

    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch (e) {}
    ob().hidden = true;
    document.getElementById('app').inert = false;
    // Re-render dependent views with new SETTINGS
    renderTodayForSplit();
    renderWeightView();
    renderSettingsView();
    show('today');
  }

  function wireOnboardingEvents() {
    const overlay = ob();

    overlay.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const key = t.dataset.obKey;
      if (!key) return;
      obDraft[key] = (t.type === 'number') ? parseFloat(t.value) : t.value;
    });

    overlay.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const key = t.dataset.obKey;
      if (!key) return;
      obDraft[key] = (t.type === 'number') ? parseFloat(t.value) : t.value;
    });

    overlay.addEventListener('click', (e) => {
      const choice = e.target.closest('.ob-choice');
      if (choice) {
        const key = choice.dataset.obChoiceKey;
        const val = choice.dataset.obChoiceVal;
        obDraft[key] = val;
        // refresh aria-pressed on siblings
        choice.parentElement.querySelectorAll('.ob-choice').forEach(b =>
          b.setAttribute('aria-pressed', b === choice ? 'true' : 'false'));
        return;
      }
      const tog = e.target.closest('[data-ob-toggle-key]');
      if (tog) {
        const key  = tog.dataset.obToggleKey;
        const next = !(tog.getAttribute('aria-pressed') === 'true');
        obDraft[key] = next;
        tog.setAttribute('aria-pressed', next ? 'true' : 'false');
      }
    });
  }

  function maybeShowOnboarding() {
    let done = false;
    try { done = localStorage.getItem(ONBOARDING_KEY) === '1'; } catch (e) {}
    if (done) return;
    obIndex = 0;
    ob().hidden = false;
    document.getElementById('app').inert = true;
    renderOnboardingStep();
  }

  // Dev helper — reset onboarding from console: window.__revival.resetOnboarding()
  window.__revival.resetOnboarding = function () {
    try { localStorage.removeItem(ONBOARDING_KEY); } catch (e) {}
    obIndex = 0;
    ob().hidden = false;
    document.getElementById('app').inert = true;
    renderOnboardingStep();
  };

  // ---------------------------------------------------------------------------
  // Sync indicator — pulls pendingCount() from IndexedDB. Refreshes on save +
  // periodically. Real flush logic lives in a later step.
  // ---------------------------------------------------------------------------
  function updateSyncIndicator() {
    const node = document.getElementById('sync-indicator');
    if (!node) return;
    pendingCount().then(n => {
      const dotState = n === 0 ? 'ok' : 'pending';
      node.dataset.state = dotState;
      const txt = node.querySelector('.sync-text');
      if (txt) txt.textContent = n === 0 ? 'Synced' : (n + ' pending');
    });
  }
  setInterval(updateSyncIndicator, 15000);

  // ---------------------------------------------------------------------------
  // Tab router
  // ---------------------------------------------------------------------------
  const tabs = document.querySelectorAll('.tabbar .tab');
  const views = document.querySelectorAll('.view');

  function show(target) {
    views.forEach(v => { v.hidden = v.dataset.view !== target; });
    tabs.forEach(t => {
      const match = t.dataset.target === target;
      t.classList.toggle('is-active', match);
      t.setAttribute('aria-selected', match ? 'true' : 'false');
    });
  }

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.target)));

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  renderTodayForSplit();
  renderWeightView();
  wireWeightSave();
  renderSettingsView();
  wireSettings();
  wireOnboardingEvents();
  maybeShowOnboarding();
  show('today');
  updateSyncIndicator();

  // ---------------------------------------------------------------------------
  // Service-worker registration — after first paint, skipped in dev mode so
  // iframe cache-busts aren't haunted by a stale cache.
  // ---------------------------------------------------------------------------
  const isDevMode =
    /[?&]dev=/.test(location.search) ||
    location.pathname.indexOf('/_dev/') !== -1 ||
    (window.parent !== window && window.parent.document &&
      window.parent.document.querySelector('iframe[title="Revival app"]'));

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    if (isDevMode) {
      console.log('[revival] dev mode — skipping SW registration');
      return;
    }
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[revival] SW registered, scope:', reg.scope))
      .catch(err => console.error('[revival] SW register failed', err));
  }

  if (document.readyState === 'complete') {
    registerSw();
  } else {
    window.addEventListener('load', registerSw);
  }

  // Dev kill-switch — clears SW + caches
  window.__revival.unregisterSw = async function () {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    console.log('[revival] SW + caches cleared. Reload to re-register.');
  };
})();
