(function() {
  var C = window.TrackerCore;
  var KEY = 'daily-tracker-data';   /* unchanged, so a backup from the old page restores as-is */

  var QUOTES = [
    ["Everybody wants to be a bodybuilder, but don't nobody want to lift no heavy-ass weight.", "Ronnie Coleman"],
    ["The last three or four reps is what makes the muscle grow. This area of pain divides a champion from someone who is not a champion.", "Arnold Schwarzenegger"],
    ["Stimulate, don't annihilate.", "Lee Haney"],
    ["The worst thing I can be is the same as everybody else.", "Arnold Schwarzenegger"],
    ["Yeah buddy. Light weight, baby.", "Ronnie Coleman"],
    ["The mind is the limit. As long as the mind can envision the fact that you can do something, you can do it.", "Arnold Schwarzenegger"],
    ["Everybody pities the weak; jealousy you have to earn.", "Arnold Schwarzenegger"],
    ["I hated every minute of training, but I said: don't quit. Suffer now and live the rest of your life as a champion.", "Muhammad Ali"],
    ["Blood, sweat and respect. The first two you give, the last one you earn.", "Dwayne Johnson"],
    ["The resistance that you fight physically in the gym and the resistance that you fight in life can only build a strong character.", "Arnold Schwarzenegger"],
    ["Anything you want in life, you have to work for it. Nothing comes easy.", "Dorian Yates"],
    ["What is the point of being on this Earth if you are going to be like everyone else?", "Arnold Schwarzenegger"],
    ["Success is usually the culmination of controlling failure.", "Sylvester Stallone"],
    ["Discipline is doing what you hate to do, but doing it like you love it.", "Mike Tyson"],
    ["I don't count my sit-ups. I only start counting when it starts hurting.", "Muhammad Ali"],
    ["Bodybuilding is much like any other sport. To be successful, you must dedicate yourself 100% to your training, diet and mental approach.", "Arnold Schwarzenegger"],
    ["Don't count the days, make the days count.", "Muhammad Ali"],
    ["You must bleed for your dreams.", "Kai Greene"],
    ["The successful warrior is the average man, with laser-like focus.", "Bruce Lee"],
    ["A champion is someone who gets up when he can't.", "Jack Dempsey"],
    ["The only place where success comes before work is in the dictionary.", "Vidal Sassoon"],
    ["Weight training is the fountain of youth.", "Lee Haney"],
    ["If you want to be a champion, you have to train like one, eat like one, and think like one.", "Franco Columbu"],
    ["Everything is hard before it is easy.", "Johann Wolfgang von Goethe"]
  ];

  var dismissLaunch = function() {};
  (function launch() {
    var q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    var box = document.getElementById('launch');
    document.getElementById('lquote').textContent = '"' + q[0] + '"';
    document.getElementById('lauthor').textContent = q[1];
    var dismiss = function() {
      box.className = 'gone';
      setTimeout(function() { box.style.display = 'none'; }, 500);
    };
    dismissLaunch = dismiss;
    box.addEventListener('click', dismiss);
    setTimeout(dismiss, 3600);   /* long enough to actually read the quote; a tap still skips it */
  })();

  var store = {
    ok: false,
    get: function(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  };
  try {
    window.localStorage.setItem('__t', '1');
    window.localStorage.removeItem('__t');
    store.ok = true;
  } catch (e) { store.ok = false; }

  function ymd(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return ymd(new Date()); }
  function parseDate(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var round1 = C.round1;

  var cache = {};
  var settings = C.withDefaults({});
  var currentDate = todayStr();
  var currentTab = 'day';
  var flash = '';

  function defaultDay() {
    return { dayType: 'rest', meals: [], steps: '', weight: '', done: false };
  }
  function getDay(date) {
    if (!cache[date]) cache[date] = defaultDay();
    if (typeof cache[date].done === 'undefined') cache[date].done = false;
    return cache[date];
  }
  function isEmptyDay(d) {
    return !d || ((!d.meals || d.meals.length === 0) && !d.steps && !d.weight);
  }

  /* The most recent day carrying a weight, which is what the goals are derived from. */
  function latestWeight() {
    var dates = [], k;
    for (k in cache) if (cache[k] && cache[k].weight) dates.push(k);
    if (!dates.length) return 0;
    dates.sort();
    return Number(cache[dates[dates.length - 1]].weight) || 0;
  }

  function targetFor(day) { return C.targetFor(day, settings, latestWeight()); }
  function totals(day)    { return C.totals(day); }
  function stepBonus(day) { return C.stepBonus(day, settings); }

  /* The API key is deliberately not part of a backup blob — that text gets pasted around. */
  function exportable() {
    var s = {}, k;
    for (k in settings) if (k !== 'apiKey') s[k] = settings[k];
    return JSON.stringify({ logs: cache, settings: s });
  }

  /* Hung off save() rather than each call site: every mutation in the app routes through
     here, so the widget cannot drift out of step with the data. */
  function save() {
    if (store.ok) store.set(KEY, JSON.stringify({ logs: cache, settings: settings }));
    syncWidget();
  }

  function plugin(name) {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  }
  function bridge() { return plugin('WidgetBridge'); }

  var stepState = { available: null, permitted: null };
  var stepTimer = null;

  /* The sensor hub keeps counting with the app shut, and launch/resume reads pick that up. But
     nothing re-read it while the app was OPEN, so walking with theCut in the foreground showed a
     frozen number. Poll while visible, stop the moment we are backgrounded — there is nothing to
     update off-screen and the resume read covers the gap. 10s is under the threshold where a
     glance feels broken and well over the cost of an on-change sensor read. */
  function startStepPolling() {
    stopStepPolling();
    if (!settings.autoSteps) return;
    stepTimer = setInterval(syncSteps, 10000);
  }
  function stopStepPolling() {
    if (stepTimer) { clearInterval(stepTimer); stepTimer = null; }
  }

  function enableAutoSteps() {
    var SC = plugin('StepCounter');
    if (!SC) { renderSettings(); return; }
    SC.request().then(function(r) {
      if (r) stepState = { available: !!r.available, permitted: !!r.permitted };
      if (r && r.available && r.permitted) { syncSteps(); startStepPolling(); }
      renderSettings();
    }).catch(function() { renderSettings(); });
  }

  /* The counter runs in the phone's sensor hub whether or not the app is open, so reading it on
     launch and on resume is enough — no background service, no battery cost of our own.
     The ceiling: steps are attributed to the day they are READ. Go two days without opening the
     app and the second day's reading claims only what accrued since the app last looked. */
  function syncSteps() {
    if (!settings.autoSteps) return;
    var SC = plugin('StepCounter');
    if (!SC) return;
    SC.read().then(function(r) {
      if (r) stepState = { available: !!r.available, permitted: !!r.permitted };
      if (!r || typeof r.value !== 'number') return;   /* not permitted, or the sensor timed out */
      var t = todayStr();
      var day = getDay(t);
      /* The baseline advances even on a hand-typed day, so clearing the field later resumes
         from the right place instead of claiming every step since boot. */
      day.stepTally = C.stepTally(day.stepTally, r.value, t);
      if (!day.stepsManual) day.steps = String(day.stepTally.steps);
      save();
      render();
    }).catch(function() {});
  }

  function syncWidget() {
    var B = bridge();
    if (!B) return;                       /* a plain browser has no widget to feed */
    try {
      var counted = countedDates().map(getDay);
      var blob = C.widgetBlob(getDay(todayStr()), counted, settings, latestWeight(), todayStr());
      B.sync({ state: JSON.stringify(blob) });
    } catch (e) {}                        /* a widget that misses an update is not worth a crash */
  }

  function load() {
    if (!store.ok) return;
    var raw = store.get(KEY);
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data.logs) cache = data.logs;
      settings = C.withDefaults(data.settings);
    } catch (e) {}
  }

  /* Days logged before this feature existed get their flag guessed, and any finished day that
     has never been snapshotted gets frozen now — the alternative is letting it float forever
     and re-score itself every time the scale moves. */
  function backfillDoneFlags() {
    var t = todayStr(), changed = false, snap = C.snapshotFor(settings, latestWeight());
    for (var k in cache) {
      var d = cache[k];
      if (typeof d.done === 'undefined') {
        d.done = (k < t) && d.meals && d.meals.length > 0;
        changed = true;
      }
      if (d.done && !d.maintenance) {
        d.maintenance = snap.maintenance;
        d.proteinTarget = snap.proteinTarget;
        changed = true;
      }
    }
    if (changed) save();
  }

  function allLoggedDates() {
    var out = [];
    for (var k in cache) {
      if (cache[k] && cache[k].meals && cache[k].meals.length > 0) out.push(k);
    }
    out.sort();
    return out;
  }
  function countedDates() {
    return allLoggedDates().filter(function(d) { return getDay(d).done; });
  }

  function renderWarn() {
    var box = document.getElementById('warnBox');
    if (flash) box.innerHTML = '<div class="ok">' + flash + '</div>';
    else if (!store.ok) box.innerHTML = '<div class="warn">This device is blocking storage, so entries will not survive a restart. Use Copy my data on the Progress tab.</div>';
    else box.innerHTML = '';
  }

  function renderDayStrip() {
    var el = document.getElementById('dayStrip');
    var items = C.dayStrip(cache, currentDate, todayStr()), html = '', i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      html += '<button type="button" class="strip-day' + (it.date === currentDate ? ' sel' : '') + '" data-date="' + it.date + '">'
            +   '<span class="sd-label">' + it.label + '</span>'
            +   '<span class="sd-num">' + it.dayNum + '</span>'
            +   '<span class="sd-dot ' + it.status + '"></span>'
            + '</button>';
    }
    el.innerHTML = html;
  }

  function renderDay() {
    var day = getDay(currentDate);
    var t = totals(day);
    var target = targetFor(day);

    renderDayStrip();

    document.getElementById('calNums').textContent = t.cal + ' / ' + target.cal;
    var calBar = document.getElementById('calBar');
    calBar.style.width = Math.min(100, (t.cal / target.cal) * 100) + '%';
    calBar.className = 'bar-fill ' + (t.cal > target.cal ? 'over' : 'cal');
    var calLeft = target.cal - t.cal;
    document.getElementById('calRemaining').textContent =
      calLeft >= 0 ? (calLeft + ' cal left') : (Math.abs(calLeft) + ' cal over');

    document.getElementById('proNums').textContent = t.protein + 'g / ' + target.protein + 'g';
    document.getElementById('proBar').style.width =
      Math.min(100, (t.protein / target.protein) * 100) + '%';
    var proLeft = round1(target.protein - t.protein);
    document.getElementById('proRemaining').textContent =
      proLeft > 0 ? (proLeft + 'g protein left') : 'protein target hit';

    /* The sub line carries the day's muscle group; the mark and the accent fill already say
       whether it is done, so the group does not have to compete with a "tap" hint. */
    document.getElementById('workoutSub').textContent = C.workoutSplit(cache, currentDate);
    if (day.dayType === 'training') {
      document.getElementById('workoutTile').className = 'tile active';
      document.getElementById('workoutMark').textContent = '✓';
    } else {
      document.getElementById('workoutTile').className = 'tile';
      document.getElementById('workoutMark').textContent = '—';
    }

    document.getElementById('stepsInput').value = day.steps || '';
    document.getElementById('weightInput').value = day.weight || '';

    var bonus = stepBonus(day);
    document.getElementById('stepsFig').textContent = day.steps || '0';
    document.getElementById('stepsBonus').textContent =
      (bonus > 0 ? '+' + bonus : bonus) + ' cal to target';

    document.getElementById('weightFig').textContent = day.weight ? (day.weight + ' kg') : '—';
    var wDelta = C.weightDelta(cache, currentDate);
    document.getElementById('weightSub').textContent =
      (wDelta === null) ? (day.weight ? 'Logged' : 'Tap to log')
                         : ((wDelta >= 0 ? '+' : '') + wDelta.toFixed(1) + ' vs last log');

    var baseline = C.num(settings.stepBaseline, 2500);
    var per = C.num(settings.calPer1000Steps, 45);
    var hint = document.getElementById('stepHint');
    if (!day.steps) {
      hint.textContent = 'Steps adjust this day’s calorie target. Baseline ' + baseline +
        '; every extra 1000 adds about ' + per + ' cal.';
    } else if (bonus === 0) {
      hint.textContent = 'At the ' + baseline + '-step baseline, no adjustment.';
    } else if (bonus > 0) {
      hint.textContent = 'Above baseline, target raised by ' + bonus + ' cal.';
    } else {
      hint.textContent = 'Below baseline, target lowered by ' + Math.abs(bonus) + ' cal.';
    }
    if (settings.autoSteps && currentDate === todayStr()) {
      if (stepState.available === false) {
        hint.textContent += ' This phone has no step sensor, so steps stay manual.';
      } else if (stepState.permitted === false) {
        hint.textContent += ' Physical activity permission is not granted — see Settings.';
      } else if (day.stepsManual) {
        hint.textContent += ' Typed by hand — clear the field to go back to counting automatically.';
      } else {
        hint.textContent += ' Counting automatically. Only steps taken since you first opened the app today are counted.';
      }
    }

    renderQuickAdds('quickAdds');
    renderMealPreview();
  }

  /* ---- meals: shared row rendering (Today's read-only preview and the Meals screen's
     swipe-to-delete list both build the same row shape) ---- */

  /* The meal object carries no time/category field of its own (that shape is a storage
     contract — see CLAUDE.md), so the "Breakfast · 08:10" meta line is derived from the one
     timestamp a meal already has: `id`, which has been Date.now() since the very first
     #addBtn handler. mealSlot() is the pure, tested half of this; reading the local hour off
     a Date is glue that belongs here, next to todayStr()/parseDate(). */
  function mealMeta(m) {
    var dt = new Date(m.id);
    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
    return C.mealSlot(dt.getHours()) + ' · ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  }

  function mealRowInnerHTML() {
    return '<div class="meal-info"><div class="meal-name"></div><div class="meal-meta"></div></div>'
         +   '<div class="meal-nums"><div class="meal-cal"></div><div class="meal-pro"></div></div>';
  }

  /* Every user-supplied string reaches the DOM through textContent, never string-concatenated
     into innerHTML — a meal name comes from Claude or from typing and must not be able to
     inject markup. */
  function fillMealRow(row, m) {
    row.querySelector('.meal-name').textContent = m.name;
    row.querySelector('.meal-meta').textContent = mealMeta(m);
    row.querySelector('.meal-cal').textContent = Math.round(C.num(m.cal, 0));
    row.querySelector('.meal-pro').textContent = round1(C.num(m.protein, 0)) + 'g';
  }

  /* Today's preview: the last three meals, read-only. Spec §7 lists quick-add chips, the last
     three meals and "See all" for this card — no delete affordance of its own, so there is
     only one place a meal can be removed from (the Meals screen's swipe list, below). */
  function renderMealPreview() {
    var day = getDay(currentDate);
    var recent = day.meals.slice(-3);
    var list = document.getElementById('mealList');
    if (!recent.length) {
      list.innerHTML = '<div class="empty">No meals logged yet</div>';
      return;
    }
    var html = '', i;
    for (i = 0; i < recent.length; i++) html += '<div class="meal-row">' + mealRowInnerHTML() + '</div>';
    list.innerHTML = html;
    var rows = list.querySelectorAll('.meal-row');
    for (i = 0; i < rows.length; i++) fillMealRow(rows[i], recent[i]);
  }

  /* ---- quick add (§8, also called from renderDay() so the same grid appears on Today) ---- */

  function renderQuickAdds(hostId) {
    var host = document.getElementById(hostId);
    var items = C.quickAdds(cache, 4, todayStr()), html = '', i;
    for (i = 0; i < items.length; i++) {
      html += '<button type="button" class="qa" data-qa="' + i + '">'
            +   '<span class="qa-name"></span><span class="qa-nums"></span><span class="qa-plus">+</span>'
            + '</button>';
    }
    host.innerHTML = html;
    var btns = host.querySelectorAll('.qa');
    for (i = 0; i < btns.length; i++) {
      btns[i].querySelector('.qa-name').textContent = items[i].name;
      btns[i].querySelector('.qa-nums').textContent = items[i].cal + ' cal · ' + items[i].protein + 'g';
    }
    host.quickAddItems = items;
  }

  /* One delegated handler covers both grids (Today's #quickAdds and Meals' #mealsQuickAdds) —
     the tapped item is looked up on whichever .qa-grid the button lives in. */
  document.getElementById('app').addEventListener('click', function(e) {
    var btn = e.target.closest('.qa');
    if (!btn) return;
    var host = btn.closest('.qa-grid');
    var items = host && host.quickAddItems;
    var item = items && items[Number(btn.getAttribute('data-qa'))];
    if (!item) return;
    getDay(currentDate).meals.push({ id: Date.now(), name: item.name, cal: item.cal, protein: item.protein });
    save(); render();
  });

  /* ---- Meals screen (§8) ---- */

  var editing = -1;   /* index into the current day's meals under edit here, or -1 */

  function mealsDateLabel(dateStr) {
    return parseDate(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function editCardHTML() {
    return '<div class="meal-edit">'
         +   '<div class="meal-edit-head"><span class="meal-edit-tag">Editing</span><span class="meal-edit-meta"></span></div>'
         +   '<input type="text" class="meal-edit-name">'
         +   '<div class="meal-edit-row">'
         +     '<div class="meal-edit-field"><input type="number" inputmode="decimal" class="meal-edit-cal"><span>cal</span></div>'
         +     '<div class="meal-edit-field"><input type="number" inputmode="decimal" class="meal-edit-pro"><span>g</span></div>'
         +   '</div>'
         +   '<div class="meal-edit-actions"><button type="button" class="meal-edit-cancel">Cancel</button><button type="button" class="meal-edit-save">Save</button></div>'
         + '</div>';
  }

  function wireEditCard(card, index) {
    var m = getDay(currentDate).meals[index];
    var nameEl = card.querySelector('.meal-edit-name');
    var calEl = card.querySelector('.meal-edit-cal');
    var proEl = card.querySelector('.meal-edit-pro');
    card.querySelector('.meal-edit-meta').textContent = mealMeta(m);
    nameEl.value = m.name;
    calEl.value = m.cal;
    proEl.value = m.protein;
    card.querySelector('.meal-edit-cancel').addEventListener('click', function() {
      editing = -1; render();
    });
    card.querySelector('.meal-edit-save').addEventListener('click', function() {
      var name = nameEl.value.trim();
      var cal = Number(calEl.value);
      if (!name || !cal) return;
      m.name = name; m.cal = cal; m.protein = Number(proEl.value) || 0;
      editing = -1;
      save(); render();
    });
  }

  /* Pointer events on the row, a translateX transform, a ~60px threshold. The gesture must not
     engage until it is clearly horizontal (an 8px dead zone, then whichever axis moved further
     wins and locks for the rest of the drag) or it fights the page's own vertical scroll —
     touch-action: pan-y on the row is the other half of that, letting the browser keep scrolling
     while this handler claims left/right.

     Deliberately NOT delete-on-swipe: reaching the threshold only adds .revealed, which slides
     the row to expose the Delete panel underneath. Deleting is a second, explicit tap on that
     panel's own button. A half-recognised gesture — released early, or cut short by
     pointercancel (the OS taking the gesture back, or a re-render replacing this row under an
     active pointer capture) — always resolves through the same end() to either fully closed or
     revealed-but-not-deleted; there is no path from a swipe alone to a removed meal. */
  function wireSwipe(row, onTap) {
    var x0 = 0, y0 = 0, dx = 0, axis = null, id = null, moved = false;
    row.addEventListener('pointerdown', function(e) {
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; axis = null; moved = false;
      row.classList.add('dragging');
    });
    row.addEventListener('pointermove', function(e) {
      if (e.pointerId !== id) return;
      var mx = e.clientX - x0, my = e.clientY - y0;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis === 'x') {
          moved = true;
          try { row.setPointerCapture(id); } catch (err) {}
        }
      }
      if (axis !== 'x') return;
      e.preventDefault();
      dx = Math.min(0, mx);                      /* left only */
      row.style.transform = 'translateX(' + dx + 'px)';
    });
    function end() {
      row.classList.remove('dragging');
      if (axis === 'x' && dx < -60) row.classList.add('revealed');
      else row.classList.remove('revealed');
      row.style.transform = '';
      axis = null; id = null;
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    row.addEventListener('click', function() {
      if (moved) { moved = false; return; }             /* swallow the click after a real drag */
      if (row.classList.contains('revealed')) {          /* tap-anywhere dismisses an open panel */
        row.classList.remove('revealed');
        return;
      }
      if (onTap) onTap();
    });
  }

  function renderMealsList() {
    var day = getDay(currentDate);
    var meals = day.meals;
    var host = document.getElementById('mealsList');
    var i, html;
    if (!meals.length) {
      host.innerHTML = '<div class="empty">No meals logged yet</div>';
      return;
    }
    html = '';
    for (i = 0; i < meals.length; i++) {
      html += (i === editing) ? editCardHTML()
        : '<div class="meal-row-wrap"><div class="meal-row-panel"><button type="button" class="meal-del-btn" data-remove="'
          + meals[i].id + '">Delete</button></div><div class="meal-row">' + mealRowInnerHTML() + '</div></div>';
    }
    host.innerHTML = html;
    for (i = 0; i < meals.length; i++) {
      if (i === editing) { wireEditCard(host.children[i], i); continue; }
      (function(idx, row) {
        fillMealRow(row, meals[idx]);
        wireSwipe(row, function() { editing = idx; render(); });
      })(i, host.children[i].querySelector('.meal-row'));
    }
  }

  /* The panel's Delete button reuses this one route — Today's preview has no delete button of
     its own (see renderMealPreview()), so this is the only place a meal is ever removed. */
  document.getElementById('mealsList').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    var id = Number(btn.getAttribute('data-remove'));
    var day = getDay(currentDate);
    day.meals = day.meals.filter(function(m) { return m.id !== id; });
    editing = -1;
    save(); render();
  });

  function renderMeals() {
    var day = getDay(currentDate);
    var t = totals(day);

    document.getElementById('mealsDate').textContent = mealsDateLabel(currentDate);
    document.getElementById('mealsTotalFig').textContent = t.cal;
    document.getElementById('mealsTotalSub').textContent = 'cal · ' + t.protein + 'g protein';
    document.getElementById('mealsLoggedLabel').textContent =
      (currentDate === todayStr()) ? 'Logged today' : 'Logged';

    renderQuickAdds('mealsQuickAdds');
    renderMealsList();
  }

  document.getElementById('mealsDate').addEventListener('click', function() {
    var picker = document.getElementById('mealsDatePicker');
    picker.value = currentDate;
    if (picker.showPicker) picker.showPicker(); else picker.click();
  });
  document.getElementById('mealsDatePicker').addEventListener('change', function(e) {
    if (e.target.value) { currentDate = e.target.value; editing = -1; render(); }
  });

  function renderProgress() {
    var counted = countedDates();
    var all = allLoggedDates();
    var lw = latestWeight();
    var totalDeficit = 0, totalProtein = 0;

    for (var i = 0; i < counted.length; i++) {
      var d = getDay(counted[i]);
      totalDeficit += C.deficitFor(d, settings, lw);
      totalProtein += totals(d).protein;
    }

    var n = counted.length;
    document.getElementById('statDays').textContent = n;
    document.getElementById('statDeficit').textContent = n ? Math.round(totalDeficit / n) : 0;
    document.getElementById('statProtein').textContent = (n ? Math.round(totalProtein / n) : 0) + 'g';

    var pendingCount = all.length - n;
    document.getElementById('pendingNote').textContent = pendingCount
      ? (pendingCount + ' logged day' + (pendingCount > 1 ? 's are' : ' is') + ' not marked finished and stays out of these numbers.')
      : '';

    var kgLost = totalDeficit / C.KCAL_PER_KG_FAT;
    var goal = C.num(settings.goalKg, 3) || 3;
    document.getElementById('goalNums').textContent = kgLost.toFixed(2) + ' / ' + goal + ' kg';
    document.getElementById('goalBar').style.width =
      Math.max(0, Math.min(100, (kgLost / goal) * 100)) + '%';

    var avgDef = n ? (totalDeficit / n) : 0;
    var etaEl = document.getElementById('goalEta');
    if (n < 3) etaEl.textContent = 'Mark a few finished days for a meaningful projection.';
    else if (avgDef <= 0) etaEl.textContent = 'At or above maintenance on average, so no fat loss projected.';
    else {
      var rem = goal - kgLost;
      etaEl.textContent = rem <= 0 ? 'Goal reached based on logged deficit.'
        : 'About ' + Math.ceil((rem * C.KCAL_PER_KG_FAT) / avgDef) + ' more days at ' + Math.round(avgDef) + ' cal/day.';
    }

    var wDates = [];
    for (var k in cache) { if (cache[k].weight) wDates.push(k); }
    wDates.sort();
    if (wDates.length) {
      var first = Number(getDay(wDates[0]).weight);
      var last = Number(getDay(wDates[wDates.length - 1]).weight);
      document.getElementById('statWStart').textContent = first.toFixed(1);
      document.getElementById('statWNow').textContent = last.toFixed(1);
      var delta = last - first;
      document.getElementById('statWDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1);
    } else {
      document.getElementById('statWStart').textContent = '-';
      document.getElementById('statWNow').textContent = '-';
      document.getElementById('statWDelta').textContent = '-';
    }

    var rows = '';
    var recent = all.slice(-14).reverse();
    for (var r = 0; r < recent.length; r++) {
      var dd = getDay(recent[r]);
      var tt = totals(dd), tg = targetFor(dd);
      var diff = tt.cal - tg.cal;
      var lbl = parseDate(recent[r]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      if (!dd.done) {
        rows += '<tr><td>' + lbl + ' <span class="pending">in progress</span></td>' +
                '<td class="num">' + tt.cal + '</td><td class="num">' + tg.cal +
                '</td><td class="num pending">-</td><td class="num">' + tt.protein + 'g</td></tr>';
      } else {
        rows += '<tr><td>' + lbl + '</td><td class="num">' + tt.cal + '</td><td class="num">' + tg.cal +
                '</td><td class="num ' + (diff > 0 ? 'neg' : 'pos') + '">' + (diff > 0 ? '+' : '') + diff +
                '</td><td class="num">' + tt.protein + 'g</td></tr>';
      }
    }
    document.getElementById('histBody').innerHTML =
      rows || '<tr><td colspan="5" class="empty">No days logged yet</td></tr>';

    document.getElementById('goalInput').value = settings.goalKg;
  }

  function renderSettings() {
    var lw = latestWeight();
    var tracking = !!settings.useLatestWeight && lw > 0;

    document.getElementById('setUseLatest').checked = !!settings.useLatestWeight;
    var wEl = document.getElementById('setWeight');
    wEl.value = tracking ? lw : settings.bodyweight;
    wEl.readOnly = tracking;
    document.getElementById('weightHint').textContent = tracking
      ? 'Following the weight you logged most recently, so your targets come down as you do.'
      : (settings.useLatestWeight ? 'No weight logged yet, so this figure is used until you log one.'
                                  : 'Fixed. Your logged weights will not change your targets.');

    document.getElementById('setMaintPerKg').value      = settings.maintenancePerKg;
    document.getElementById('setMaintOverride').value   = settings.maintenanceOverride;
    document.getElementById('setProteinPerKg').value    = settings.proteinPerKg;
    document.getElementById('setProteinOverride').value = settings.proteinOverride;
    document.getElementById('setRestDeficit').value     = settings.restDeficit;
    document.getElementById('setTrainingBump').value    = settings.trainingBump;
    document.getElementById('setStepBaseline').value    = settings.stepBaseline;
    document.getElementById('setCalPer1000').value      = settings.calPer1000Steps;
    document.getElementById('setApiKey').value          = settings.apiKey;

    document.getElementById('setAutoSteps').checked = !!settings.autoSteps;
    var ah = document.getElementById('autoStepsHint');
    if (!settings.autoSteps) {
      ah.textContent = 'Off — steps are whatever you type on the Today tab.';
    } else if (stepState.available === false) {
      ah.textContent = 'This phone has no step sensor, so steps stay manual.';
    } else if (stepState.permitted === false) {
      ah.textContent = 'Physical activity permission was declined. Switch this off and on again to ask for it.';
    } else {
      ah.textContent = 'On — reading the phone\u2019s own step counter, and again every 10 seconds while the app is open. '
        + (stepState.available === null
            ? 'Waiting for the first reading\u2026'
            : 'Sensor reading fine.')
        + ' Anything you type on the Today tab wins for that day.';
    }

    var m = C.maintenanceCal(settings, lw);
    var rest = m - C.num(settings.restDeficit, 400);
    document.getElementById('derived').textContent =
      'Maintenance ' + m + ' cal · rest day ' + rest +
      ' · training day ' + (rest + C.num(settings.trainingBump, 200)) +
      ' · protein ' + C.proteinTarget(settings, lw) + 'g';
  }

  function render() {
    renderWarn();
    if (currentTab === 'day') renderDay();
    else if (currentTab === 'meals') renderMeals();
    else if (currentTab === 'progress') renderProgress();
    else renderSettings();
  }

  function flashMsg(msg) {
    flash = msg; render();
    setTimeout(function() { flash = ''; renderWarn(); }, 3000);
  }

  function selectTab(name) {
    currentTab = name;
    var tabBtns = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].className = (tabBtns[i].getAttribute('data-tab') === name) ? 'active' : '';
    }
    ['day', 'meals', 'progress', 'settings'].forEach(function(t) {
      document.getElementById('page-' + t).className = 'page' + (name === t ? ' active' : '');
    });
    /* The FAB (camera) only makes sense on Today, matching the canvas — it is drawn on the
       Today artboard and on none of the other three. The composer is docked on Meals only. */
    document.getElementById('fab').hidden = (name !== 'day');
    document.getElementById('mealComposer').hidden = (name !== 'meals');
    if (name !== 'meals') editing = -1;   /* never leave a stale edit card for the next visit */
    render();
  }

  document.querySelector('.nav').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tab]');
    if (btn) selectTab(btn.getAttribute('data-tab'));
  });

  document.getElementById('dayStrip').addEventListener('click', function(e) {
    var b = e.target.closest('[data-date]');
    if (!b) return;
    currentDate = b.getAttribute('data-date');
    render();
  });

  document.getElementById('workoutTile').addEventListener('click', function() {
    var day = getDay(currentDate);
    day.dayType = (day.dayType === 'training') ? 'rest' : 'training';
    save(); render();
  });

  document.getElementById('stepsTile').addEventListener('click', function() {
    var el = document.getElementById('stepsRevealRow');
    el.hidden = !el.hidden;
  });
  document.getElementById('weightTile').addEventListener('click', function() {
    var el = document.getElementById('weightRevealRow');
    el.hidden = !el.hidden;
  });

  document.getElementById('seeAllBtn').addEventListener('click', function() { selectTab('meals'); });
  document.getElementById('fab').addEventListener('click', function() {
    selectTab('meals');            /* the composer that takePhoto() fills lives there */
    takePhoto('CAMERA');
  });

  document.getElementById('stepsInput').addEventListener('change', function(e) {
    var day = getDay(currentDate);
    day.steps = e.target.value;
    day.stepsManual = !!e.target.value;   /* clearing the field hands the day back to the sensor */
    save(); render();
    if (!day.stepsManual) syncSteps();
  });
  document.getElementById('weightInput').addEventListener('change', function(e) {
    getDay(currentDate).weight = e.target.value; save(); render();
  });
  document.getElementById('goalInput').addEventListener('change', function(e) {
    settings.goalKg = Number(e.target.value) || 3; save(); render();
  });

  /* One handler for the whole settings page; every field carries its own settings key. */
  document.getElementById('page-settings').addEventListener('change', function(e) {
    var el = e.target, k = el.getAttribute('data-set');
    if (!k) return;
    settings[k] = (el.type === 'checkbox') ? el.checked : el.value;
    save();
    if (k === 'autoSteps' && settings.autoSteps) enableAutoSteps();
    else {
      if (k === 'autoSteps') stopStepPolling();
      renderSettings();
    }
  });

  document.getElementById('addBtn').addEventListener('click', function() {
    var nameEl = document.getElementById('mealName');
    var calEl = document.getElementById('mealCal');
    var proEl = document.getElementById('mealProtein');
    var name = nameEl.value.trim();
    var cal = Number(calEl.value);
    var pro = Number(proEl.value);
    if (!name || !cal) return;
    getDay(currentDate).meals.push({ id: Date.now(), name: name, cal: cal, protein: pro || 0 });
    nameEl.value = ''; calEl.value = ''; proEl.value = '';
    aiStatus('');
    save(); render();
  });

  /* ---- meal photo ---- */

  function aiStatus(msg, isError) {
    var el = document.getElementById('aiStatus');
    el.textContent = msg || '';
    el.className = 'hint' + (isError ? ' ai-err' : '');
  }

  var analysing = false;
  function setAnalysing(on) {
    analysing = on;
    document.getElementById('fab').disabled = on;
  }

  function takePhoto(source) {
    if (analysing) return;

    var key = String(settings.apiKey || '').trim();
    if (!key) { aiStatus('Add your Anthropic API key on the Settings tab first.', true); return; }

    var Camera = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
    if (!Camera) { aiStatus('The camera is only available in the installed app.', true); return; }

    setAnalysing(true);
    aiStatus('Opening the camera…');

    Camera.getPhoto({
      resultType: 'base64',
      source: source,
      quality: 60,
      width: 1024,
      correctOrientation: true
    }).then(function(photo) {
      if (!photo || !photo.base64String) throw new Error('No photo came back.');
      aiStatus('Reading the plate…');
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(C.mealRequest(photo.base64String, 'image/' + (photo.format || 'jpeg')))
      });
    }).then(function(res) {
      return res.json().catch(function() {
        throw new Error('Claude sent back something unreadable (HTTP ' + res.status + ').');
      });
    }).then(function(body) {
      var meal = C.parseMealResponse(body);
      document.getElementById('mealName').value = meal.name;
      document.getElementById('mealCal').value = meal.cal;
      document.getElementById('mealProtein').value = meal.protein;
      aiStatus('Estimated with ' + meal.confidence + ' confidence. Check the numbers, then Add meal.');
    }).catch(function(e) {
      var msg = (e && e.message) || '';
      if (/cancel/i.test(msg)) { aiStatus(''); return; }          /* backing out is not an error */
      aiStatus(msg || 'Could not estimate that photo. Enter it by hand.', true);
    }).then(function() {
      setAnalysing(false);
    });
  }

  /* The widget's button launches the app with an extra; the bridge hands it over exactly once,
     so a later resume does not re-open the camera. */
  function checkWidgetAction() {
    var B = bridge();
    if (!B || !B.consumeAction) return;
    B.consumeAction().then(function(r) {
      if (!r || !r.shoot) return;
      dismissLaunch();
      currentDate = todayStr();           /* the widget always means today */
      selectTab('meals');                 /* the composer that takePhoto() fills lives there */
      takePhoto('CAMERA');
    }).catch(function() {});
  }

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { stopStepPolling(); return; }
    checkWidgetAction();
    syncSteps();
    startStepPolling();
  });

  /* ---- backup ---- */

  document.getElementById('moveBtn').addEventListener('click', function() {
    var target = document.getElementById('moveTarget').value;
    var hint = document.getElementById('moveHint');
    if (!target) { hint.textContent = 'Pick a date to move this day to.'; return; }
    if (target === currentDate) { hint.textContent = 'That is the day you are already on.'; return; }
    var src = getDay(currentDate);
    if (isEmptyDay(src)) { hint.textContent = 'Nothing logged on this day to move.'; return; }
    if (!isEmptyDay(cache[target]) &&
        !window.confirm('That date already has entries. Overwrite them?')) return;
    cache[target] = src;
    delete cache[currentDate];
    currentDate = target;
    document.getElementById('moveTarget').value = '';
    hint.textContent = 'Moves everything on the day you are viewing to the date you pick.';
    save();
    flashMsg('Day moved.');
  });

  document.getElementById('exportBtn').addEventListener('click', function() {
    var area = document.getElementById('importArea');
    var hint = document.getElementById('ioHint');
    area.style.display = 'block';
    area.value = exportable();
    area.select();
    try { document.execCommand('copy'); hint.textContent = 'Copied. Paste it somewhere safe. Your API key is not included.'; }
    catch (e) { hint.textContent = 'Select the text above and copy it manually.'; }
  });

  document.getElementById('importBtn').addEventListener('click', function() {
    var area = document.getElementById('importArea');
    var hint = document.getElementById('ioHint');
    if (area.style.display !== 'block' || !area.value.trim()) {
      area.style.display = 'block'; area.value = '';
      hint.textContent = 'Paste your backup above, then press Restore data again.';
      area.focus(); return;
    }
    try {
      var data = JSON.parse(area.value.trim());
      if (!data.logs) throw new Error('bad');
      var keptKey = settings.apiKey;        /* backups carry no key, so keep the one on this device */
      cache = data.logs;
      settings = C.withDefaults(data.settings);
      settings.apiKey = keptKey;
      backfillDoneFlags();
      area.style.display = 'none'; area.value = '';
      hint.textContent = 'Data restored.';
      save(); render();
    } catch (e) { hint.textContent = 'Could not read that. Paste the whole backup text.'; }
  });

  document.getElementById('resetBtn').addEventListener('click', function() {
    if (!window.confirm('Erase all logged days? Your goals and API key are kept. This cannot be undone.')) return;
    cache = {};
    currentDate = todayStr();
    save(); render();
  });

  load();
  backfillDoneFlags();
  currentDate = todayStr();
  document.getElementById('storageMode').textContent =
    store.ok ? 'Saving automatically to this device' : 'Storage unavailable, use backup';
  render();
  syncWidget();
  checkWidgetAction();
  syncSteps();
  startStepPolling();
})();
