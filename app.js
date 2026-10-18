(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const pad = (n) => String(n).padStart(2, '0');
  const HOUR = 52; // px per hour, mirrored into --hour
  const LS_KEY = 'nightfall-calendar-v1';

  const svgFill = (d) => `<svg viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
  const svgLine = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    person: svgFill('<circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-4.2 3.6-6.8 8-6.8s8 2.6 8 6.8z"/>'),
    phone: svgFill('<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>'),
    sunrise: svgLine('<path d="M12 3v3M4.9 8.4l1.8 1.8M19.1 8.4l-1.8 1.8M2 17h20M5 21h14M6.5 17a5.5 5.5 0 0 1 11 0"/>'),
    moon: svgFill('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'),
    bolt: svgFill('<path d="M13.5 2 4.5 13.5h6.5L10 22l9.5-12H13z"/>'),
    feet: svgFill('<ellipse cx="8" cy="7.5" rx="3" ry="4.5"/><rect x="6" y="13.5" width="4" height="3.5" rx="1.75"/><ellipse cx="16" cy="11" rx="3" ry="4.5"/><rect x="14" y="17" width="4" height="3.5" rx="1.75"/>'),
    utensils: svgLine('<path d="M6.5 3v18M4 3v5.5a2.5 2.5 0 0 0 5 0V3M18 21V3c-2.4 1.3-3.8 3.9-3.8 7.5V14H18"/>'),
    repeat: svgLine('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    pencil: svgLine('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  };

  const CATS = {
    adriel: { label: 'Adriel', icon: ICONS.person, color: '#df4a9e' },
    alex: { label: 'Alex', icon: ICONS.person, color: '#0b9fbf' },
    call: { label: 'Call', icon: ICONS.phone, color: '#14a05a' },
    morning: { label: 'Morning routine', icon: ICONS.sunrise, color: '#e3a008' },
    wind: { label: 'Wind down', icon: ICONS.moon, color: '#7a5af0' },
    deep: { label: 'Deep work', icon: ICONS.bolt, color: '#1048e0' },
    walk: { label: 'Walk', icon: ICONS.feet, color: '#5c9c1c' },
    eat: { label: 'Eat', icon: ICONS.utensils, color: '#ee6430' },
  };
  const DEFAULT_CAT = 'deep';
  const catOf = (e) => CATS[e.cat] || CATS[DEFAULT_CAT];
  const catStyle = (e) => `--c:${catOf(e).color}`;

  // ---------- timezone maths ----------
  const dtfCache = {};
  function dtf(tz) {
    return (dtfCache[tz] ||= new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  function parts(ms, tz) {
    const o = {};
    for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  // ms to add to UTC to get wall-clock time in tz
  function tzOffset(ms, tz) {
    const p = parts(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }
  // wall-clock (date string + minutes since midnight) in tz → UTC ms
  function zonedToUtc(dateStr, minutes, tz) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, 0, minutes);
    const off = tzOffset(guess, tz);
    let ms = guess - off;
    const off2 = tzOffset(ms, tz);
    if (off2 !== off) ms = guess - off2;
    return ms;
  }
  const isValidTz = (tz) => { try { dtf(tz); return true; } catch { return false; } };
  function shortOffset(ms, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
      if (p) return p.value;
    } catch { /* fall through */ }
    const off = tzOffset(ms, tz) / 60000;
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
  }

  // ---------- calendar date strings (YYYY-MM-DD) ----------
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const toUTCDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fromUTCDate = (dt) => ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  const addDays = (s, n) => { const d = toUTCDate(s); d.setUTCDate(d.getUTCDate() + n); return fromUTCDate(d); };
  const addMonths = (s, n) => { const d = toUTCDate(s); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return fromUTCDate(d); };
  const dow = (s) => (toUTCDate(s).getUTCDay() + 6) % 7; // Monday = 0
  const startOfWeek = (s) => addDays(s, -dow(s));
  const dayNum = (s) => toUTCDate(s).getUTCDate();
  const daysBetween = (a, b) => Math.round((toUTCDate(b) - toUTCDate(a)) / 864e5);
  const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fmt = (s, opts) => toUTCDate(s).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

  const dateIn = (ms, tz) => { const p = parts(ms, tz); return ymd(p.y, p.m, p.d); };
  const dateOf = (ms) => dateIn(ms, state.tz);
  const minutesOf = (ms) => { const p = parts(ms, state.tz); return p.h * 60 + p.mi; };
  // 12-hour clock: "9:30 AM"; compact drops ":00" and the space ("9am", "1:30pm")
  const ampm = (h) => (h < 12 ? 'AM' : 'PM');
  const h12 = (h) => h % 12 || 12;
  const fmtTime = (ms, compact = false) => {
    const p = parts(ms, state.tz);
    if (compact) return `${h12(p.h)}${p.mi ? ':' + pad(p.mi) : ''}${ampm(p.h).toLowerCase()}`;
    return `${h12(p.h)}:${pad(p.mi)} ${ampm(p.h)}`;
  };
  const today = () => dateOf(Date.now());
  const dayBounds = (s) => [zonedToUtc(s, 0, state.tz), zonedToUtc(addDays(s, 1), 0, state.tz)];

  // ---------- state ----------
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const state = { tz: localTz, view: window.innerWidth < 640 ? 'day' : 'week', cursor: '', selected: '', mini: '', events: [], todos: {}, clocks: ['Europe/London', 'America/New_York'], clockNames: {} };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (!saved) return false;
      if (['day', 'week', 'month'].includes(saved.view)) state.view = saved.view;
      if (saved.tz && isValidTz(saved.tz)) state.tz = saved.tz;
      state.events = Array.isArray(saved.events) ? saved.events : [];
      state.todos = saved.todos && typeof saved.todos === 'object' ? saved.todos : {};
      if (Array.isArray(saved.clocks)) state.clocks = saved.clocks.filter(isValidTz);
      if (saved.clockNames && typeof saved.clockNames === 'object') state.clockNames = saved.clockNames;
      for (const e of state.events) if (!CATS[e.cat]) e.cat = DEFAULT_CAT;
      return true;
    } catch { return false; }
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ view: state.view, tz: state.tz, events: state.events, todos: state.todos, clocks: state.clocks, clockNames: state.clockNames }));
    } catch { /* storage unavailable: app still works for this session */ }
  }

  function seed() {
    const t = today();
    const mk = (off, s, e, title, cat, steps = [], repeat = null) => ({
      id: uid(), title, cat, notes: '', repeat, tz: state.tz,
      start: zonedToUtc(addDays(t, off), s, state.tz),
      end: zonedToUtc(addDays(t, off), e, state.tz),
      subtasks: steps.map((text) => ({ id: uid(), text, done: false })),
    });
    state.todos = { [t]: [{ id: uid(), text: 'Reply to emails', done: false }, { id: uid(), text: 'Post content', done: false }] };
    state.events = [
      mk(0, 7 * 60, 7 * 60 + 45, 'Morning routine', 'morning', ['Water', 'Stretch', 'Journal'], { freq: 'daily', interval: 1 }),
      mk(-dow(t), 9 * 60 + 30, 12 * 60, 'Deep work block', 'deep', ['Pick one thing', 'Phone away'], { freq: 'weekly', interval: 1, days: [0, 1, 2, 3, 4] }),
      mk(0, 12 * 60 + 30, 13 * 60 + 15, 'Lunch', 'eat', [], { freq: 'daily', interval: 1 }),
      mk(0, 15 * 60, 15 * 60 + 30, 'Catch-up call', 'call'),
      mk(1, 19 * 60, 21 * 60, 'Dinner with Adriel', 'adriel'),
      mk(2, 18 * 60, 19 * 60, 'Gym with Alex', 'alex'),
      mk(-dow(t) + 1, 18 * 60, 18 * 60 + 45, 'Evening walk', 'walk', [], { freq: 'weekly', interval: 1, days: [1, 3] }),
      mk(0, 22 * 60, 22 * 60 + 45, 'Wind down', 'wind', ['No screens', 'Read'], { freq: 'daily', interval: 1 }),
    ];
  }

  // ---------- queries ----------
  // ---------- recurrence ----------
  // repeat = { freq: 'daily' | 'weekly' | 'monthly', interval, days?: [0-6, Mon = 0], until?: 'YYYY-MM-DD' }
  // Occurrences follow the wall-clock time in the timezone the series was saved in.
  const repeatDays = (r, base) => (r.days && r.days.length ? r.days : [dow(base)]);
  function matches(r, base, d) {
    const n = Math.max(1, r.interval || 1);
    if (r.freq === 'daily') return daysBetween(base, d) % n === 0;
    if (r.freq === 'weekly') return (daysBetween(startOfWeek(base), startOfWeek(d)) / 7) % n === 0 && repeatDays(r, base).includes(dow(d));
    if (r.freq === 'monthly') return monthsBetween(base, d) % n === 0 && dayNum(d) === dayNum(base);
    return false;
  }
  // all occurrences of e overlapping [a, b)
  function occurrences(e, a, b) {
    if (!e.repeat) return e.start < b && e.end > a ? [{ e, key: '', start: e.start, end: e.end }] : [];
    const tz = e.tz || state.tz;
    const p = parts(e.start, tz);
    const base = ymd(p.y, p.m, p.d), baseMin = p.h * 60 + p.mi, dur = e.end - e.start;
    let d = addDays(dateIn(a, tz), -(Math.ceil(dur / 864e5) + 1));
    if (d < base) d = base;
    const last = dateIn(b, tz), until = e.repeat.until, skip = e.exdates || [];
    const out = [];
    for (; d <= last; d = addDays(d, 1)) {
      if (until && d > until) break;
      if (!matches(e.repeat, base, d) || skip.includes(d)) continue;
      const st = zonedToUtc(d, baseMin, tz);
      if (st < b && st + dur > a) out.push({ e, key: d, start: st, end: st + dur });
    }
    return out;
  }
  function describeRepeat(r, base) {
    if (!r) return '';
    const n = Math.max(1, r.interval || 1);
    let txt;
    if (r.freq === 'daily') txt = n === 1 ? 'Daily' : `Every ${n} days`;
    else if (r.freq === 'weekly') {
      const days = repeatDays(r, base).slice().sort();
      const list = days.join() === '0,1,2,3,4' ? 'weekdays' : days.map((x) => DOW_SHORT[x]).join(', ');
      txt = `${n === 1 ? 'Weekly' : `Every ${n} weeks`} on ${list}`;
    } else txt = `${n === 1 ? 'Monthly' : `Every ${n} months`} on day ${dayNum(base)}`;
    if (r.until) txt += `, until ${fmt(r.until, { day: 'numeric', month: 'short' })}`;
    return txt;
  }

  // step completion is tracked per occurrence for repeating tasks
  const isDone = (o, sub) => (o.key ? (o.e.checks?.[o.key] || []).includes(sub.id) : !!sub.done);
  function setDone(o, sub, val) {
    if (!o.key) { sub.done = val; return; }
    const checks = (o.e.checks ||= {});
    const set = new Set(checks[o.key] || []);
    if (val) set.add(sub.id); else set.delete(sub.id);
    if (set.size) checks[o.key] = [...set]; else delete checks[o.key];
  }
  function progress(o) {
    const subs = o.e.subtasks || [];
    return { subs, done: subs.filter((s) => isDone(o, s)).length };
  }

  function eventsOn(s) {
    const [a, b] = dayBounds(s);
    return state.events.flatMap((e) => occurrences(e, a, b)).sort((x, y) => x.start - y.start || y.end - x.end);
  }
  const findEvent = (id) => state.events.find((e) => e.id === id);

  // place overlapping events side by side
  function layoutDay(s) {
    const [a, b] = dayBounds(s);
    const items = eventsOn(s).map((o) => {
      const st = o.start <= a ? 0 : minutesOf(o.start);
      let en = o.end >= b ? 1440 : minutesOf(o.end);
      if (en <= st) en = Math.min(1440, st + 30);
      return { o, s: st, en: Math.max(en, st + 20) };
    });
    items.sort((x, y) => x.s - y.s || y.en - x.en);
    const out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const cols = [];
      for (const it of cluster) {
        let c = cols.findIndex((end) => end <= it.s);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = it.en; it.col = c;
      }
      for (const it of cluster) it.cols = cols.length;
      out.push(...cluster); cluster = [];
    };
    for (const it of items) {
      if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en);
    }
    if (cluster.length) flush();
    return out;
  }

  // ---------- rendering ----------
  const view = $('#view');
  const agenda = $('#agenda');

  function render() {
    renderHeader();
    renderMini();
    renderView();
    $('#fTz').textContent = state.tz.replace(/_/g, ' ');
    renderTzPicker();
    renderClocks();
    lastMinute = '';
    tick();
    save();
  }

  function renderHeader() {
    const c = state.cursor;
    let title;
    if (state.view === 'day') {
      title = fmt(c, { weekday: 'long', day: 'numeric', month: 'long' });
    } else if (state.view === 'week') {
      const a = startOfWeek(c), b = addDays(a, 6);
      const ta = toUTCDate(a), tb = toUTCDate(b);
      if (ta.getUTCMonth() === tb.getUTCMonth()) title = `${dayNum(a)} – ${fmt(b, { day: 'numeric', month: 'long', year: 'numeric' })}`;
      else if (ta.getUTCFullYear() === tb.getUTCFullYear()) title = `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
      else title = `${fmt(a, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else {
      title = fmt(c, { month: 'long', year: 'numeric' });
    }
    // last word in brand blue, like the headline style
    const cut = title.lastIndexOf(' ');
    $('#rangeTitle').innerHTML = `${esc(title.slice(0, cut + 1))}<span class="hl">${esc(title.slice(cut + 1))}</span>`;
    document.querySelectorAll('.seg button').forEach((b) => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
  }

  function renderMini() {
    const first = state.mini;
    const start = startOfWeek(first);
    const m = first.slice(0, 7);
    const t = today();
    $('#miniTitle').textContent = fmt(first, { month: 'long', year: 'numeric' });
    let html = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="mini-dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const cls = ['mini-d'];
      if (d.slice(0, 7) !== m) cls.push('is-other');
      if (d === t) cls.push('is-today');
      if (d === state.selected) cls.push('is-selected');
      const cats = [...new Set(eventsOn(d).map((o) => catOf(o.e).color))].slice(0, 3);
      const dots = cats.length ? `<span class="mini-dots">${cats.map((c) => `<i style="--c:${c}"></i>`).join('')}</span>` : '';
      html += `<button class="${cls.join(' ')}" data-date="${d}" aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}">${dayNum(d)}${dots}</button>`;
    }
    $('#miniGrid').innerHTML = html;
  }

  function checkItem(x, key, done = x.done) {
    return `<li>
      <label class="check"><input type="checkbox" data-toggle="${key}"${done ? ' checked' : ''}><span class="box"></span><span class="txt">${esc(x.text)}</span></label>
      <button type="button" class="del" data-remove="${key}" aria-label="Delete">${ICONS.x}</button>
    </li>`;
  }

  function renderView() {
    const prev = view.querySelector('.tg-scroll');
    const keepScroll = prev && prev.dataset.view === state.view ? prev.scrollTop : null;

    if (state.view === 'month') view.innerHTML = renderMonth();
    else if (state.view === 'week') {
      const s = startOfWeek(state.cursor);
      view.innerHTML = renderTimeGrid(Array.from({ length: 7 }, (_, i) => addDays(s, i)), 'week');
    } else {
      view.innerHTML = renderTimeGrid([state.cursor], 'day');
    }
    // the side column (month calendar + day's tasks) only appears in day view
    $('.layout').classList.toggle('no-side', state.view !== 'day');
    agenda.hidden = state.view !== 'day';
    agenda.innerHTML = state.view === 'day' ? renderAgenda(state.cursor) : '';

    const sc = view.querySelector('.tg-scroll');
    if (sc) {
      sc.dataset.view = state.view;
      if (keepScroll != null) sc.scrollTop = keepScroll;
      else {
        const t = today();
        const days = state.view === 'day' ? [state.cursor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(state.cursor), i));
        const first = days.flatMap(eventsOn)[0];
        const h = days.includes(t) ? minutesOf(Date.now()) / 60 - 2 : first ? minutesOf(first.start) / 60 - 1 : 7;
        sc.scrollTop = Math.max(0, h) * HOUR;
      }
    }
  }

  // untimed tasks for one day: checklist plus an inline "add" field
  function dayTasks(d) {
    const list = state.todos[d] || [];
    return `<ul class="todo-list">${list.map((t) => `<li class="todo${t.done ? ' done' : ''}">
        <label class="tcheck"><input type="checkbox" data-todo="${d}:${t.id}"${t.done ? ' checked' : ''}><span class="box sm"></span><span class="txt" title="${esc(t.text)}">${esc(t.text)}</span></label>
        <button type="button" class="del" data-todo-del="${d}:${t.id}" aria-label="Delete task">${ICONS.x}</button>
      </li>`).join('')}</ul>
      <form class="todo-add" data-todo-add="${d}" autocomplete="off"><input placeholder="+ Add task" maxlength="200" aria-label="Add a task for ${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}"></form>`;
  }

  function renderTimeGrid(days, kind) {
    const t = today();
    const now = Date.now();
    let head = `<div class="tg-head" style="--cols:${days.length}"><div class="tz-label">${esc(shortOffset(now, state.tz))}</div>`;
    for (const d of days) {
      const cls = ['tg-day'];
      if (d === t) cls.push('is-today');
      if (d === state.selected) cls.push('is-selected');
      head += `<button class="${cls.join(' ')}" data-goday="${d}"><span class="dow">${fmt(d, { weekday: 'short' })}</span><span class="num">${dayNum(d)}</span></button>`;
    }
    head += '<div class="allday-label">Tasks</div>';
    for (const d of days) head += `<div class="allday">${dayTasks(d)}</div>`;
    head += '</div>';

    let gutter = '<div class="tg-gutter">';
    for (let h = 0; h < 24; h++) gutter += `<div class="hour-label"><span>${h ? `${h12(h)} ${ampm(h)}` : ''}</span></div>`;
    gutter += '</div>';

    let cols = '';
    for (const d of days) {
      cols += `<div class="tg-col${d === t ? ' is-today' : ''}" data-col="${d}">`;
      for (const it of layoutDay(d)) cols += eventBlock(it);
      if (d === t) cols += `<div class="now-line" style="top:${(minutesOf(now) / 60) * HOUR}px"></div>`;
      cols += '</div>';
    }
    return `<div class="tg-scroll tg-view-${kind}"><div class="tg-inner">${head}<div class="tg-body" style="--cols:${days.length}">${gutter}${cols}</div></div></div>`;
  }

  const evAttrs = (o) => `data-ev="${o.e.id}" data-occ="${o.key}"`;
  // "9:00 – 10:30 AM", or "11:00 AM – 1:00 PM" when it crosses noon/midnight
  const timeRange = (o) => {
    const a = fmtTime(o.start), b = fmtTime(o.end);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
  };

  function eventBlock(it) {
    const o = it.o, e = o.e;
    const top = (it.s / 60) * HOUR;
    const h = Math.max(((it.en - it.s) / 60) * HOUR - 2, 18);
    const w = 100 / it.cols;
    const { subs, done } = progress(o);
    const cls = ['ev'];
    if (h < 40) cls.push('ev-short');
    if (subs.length && done === subs.length) cls.push('ev-done');
    const title = e.title || '(untitled)';
    return `<button class="${cls.join(' ')}" ${evAttrs(o)} title="${esc(`${title} · ${timeRange(o)}`)}" style="${catStyle(e)};top:${top}px;height:${h}px;left:calc(${it.col * w}% + 3px);width:calc(${w}% - 6px)">
      <span class="ev-title">${esc(title)}</span>
    </button>`;
  }

  function renderAgenda(d) {
    const occs = eventsOn(d);
    let html = `<h3 class="agenda-h">${d === today() ? 'Your day' : fmt(d, { weekday: 'long' })}</h3><p class="agenda-sub">${occs.length} task${occs.length === 1 ? '' : 's'}</p>`;
    if (!occs.length) html += '<div class="empty-day">No tasks yet. Click anywhere on the timeline to add one.</div>';
    for (const o of occs) {
      const e = o.e;
      const { subs, done } = progress(o);
      const pct = subs.length ? Math.round((done / subs.length) * 100) : 0;
      const meta = [timeRange(o)];
      if (subs.length) meta.push(`${done}/${subs.length} steps`);
      html += `<article class="opt-card" style="${catStyle(e)}">
        <button class="opt-row" ${evAttrs(o)}>
          <span class="icon-tile">${catOf(e).icon}</span>
          <span class="opt-text"><span class="opt-title">${esc(e.title || '(untitled)')}</span><span class="opt-meta">${meta.join(' · ')}${e.repeat ? ICONS.repeat : ''}</span></span>
          <span class="ring${subs.length && done === subs.length ? ' full' : ''}" style="${catStyle(e)};--p:${pct}"></span>
        </button>
        <div class="opt-body">
          ${subs.length ? `<ul class="checklist">${subs.map((s) => checkItem(s, `sub:${e.id}:${s.id}:${o.key}`, isDone(o, s))).join('')}</ul>` : ''}
          <form class="add-row" data-addsub="${e.id}" autocomplete="off"><input placeholder="Add a step…" maxlength="200"></form>
        </div>
      </article>`;
    }
    html += `<button class="btn ghost" data-new="${d}">+ Add task</button>`;
    return html;
  }

  function renderMonth() {
    const first = state.cursor.slice(0, 8) + '01';
    const start = startOfWeek(first);
    const m = first.slice(0, 7);
    const t = today();
    let html = `<div class="month"><div class="month-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div>${d}</div>`).join('')}</div><div class="month-grid">`;
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const [dayStart] = dayBounds(d);
      const evs = eventsOn(d);
      const cls = ['mc'];
      if (d.slice(0, 7) !== m) cls.push('is-other');
      if (d === t) cls.push('is-today');
      if (d === state.selected) cls.push('is-selected');
      html += `<div class="${cls.join(' ')}" data-cell="${d}">
        <div class="mc-top"><button class="mc-num" data-goday="${d}" aria-label="Open ${fmt(d, { day: 'numeric', month: 'long' })}">${dayNum(d)}</button></div>
        <div class="mc-tasks">${dayTasks(d)}</div>
        ${evs.slice(0, 3).map((o) => `<button class="chip" ${evAttrs(o)} title="${esc(`${o.e.title || '(untitled)'} · ${timeRange(o)}`)}" style="${catStyle(o.e)}"><span class="dot"></span><span class="chip-title">${esc(o.e.title || '(untitled)')}</span></button>`).join('')}
        ${evs.length > 3 ? `<button class="more" data-goday="${d}">+${evs.length - 3} more</button>` : ''}
      </div>`;
    }
    return html + '</div></div>';
  }

  // ---------- timezone picker (searchable) ----------
  // Tasks are stored as exact moments, so switching zone moves every task to its local time there.
  let zoneList = null;
  const cityOf = (z) => z.split('/').pop().replace(/_/g, ' ');
  function buildZones() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers: fall back to a short list */ }
    if (!zones.length) zones = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo', 'Australia/Sydney'];
    zones = [...new Set(['UTC', state.tz, ...zones])].filter((z) => z !== localTz && isValidTz(z)).sort((a, b) => a.localeCompare(b));
    const now = Date.now();
    zoneList = [localTz, ...zones].map((z) => {
      const off = shortOffset(now, z);
      const local = z === localTz;
      const name = z.replace(/_/g, ' ');
      return { z, off, local, name, key: `${name} ${z} ${off} ${off.replace('GMT', 'UTC')} ${local ? 'local' : ''}`.toLowerCase() };
    });
  }
  function matchZones(q) {
    if (!zoneList) buildZones();
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return zoneList.filter((x) => words.every((w) => x.key.includes(w)));
  }
  const tzPop = $('#tzPop'), tzSearch = $('#tzSearch'), tzListEl = $('#tzList'), tzBtn = $('#tzBtn');
  let tzMatches = [], tzActive = 0;

  function renderTzPicker() {
    if (!zoneList) buildZones();
    const cur = zoneList.find((x) => x.z === state.tz);
    $('#tzLabel').textContent = `${state.tz === localTz ? 'Local · ' : ''}${cityOf(state.tz)} (${cur ? cur.off : shortOffset(Date.now(), state.tz)})`;
  }
  function filterTz() {
    const words = tzSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    tzMatches = matchZones(tzSearch.value);
    tzActive = Math.max(0, tzMatches.findIndex((x) => x.z === state.tz));
    if (words.length) tzActive = 0;
    tzListEl.innerHTML = tzMatches.length
      ? tzMatches.map((x, i) => `<li role="option" id="tzo-${i}" data-tz="${esc(x.z)}" aria-selected="${x.z === state.tz}"${i === tzActive ? ' class="active"' : ''}>
          <span class="tz-name">${x.local ? '<b>Local</b> · ' : ''}${esc(x.name)}</span><span class="tz-off">${esc(x.off)}</span></li>`).join('')
      : '<li class="tz-empty">No matching timezones</li>';
    moveTz(0);
  }
  function moveTz(step) {
    if (!tzMatches.length) return;
    tzActive = (tzActive + step + tzMatches.length) % tzMatches.length;
    tzListEl.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
    const el = $(`#tzo-${tzActive}`);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); tzSearch.setAttribute('aria-activedescendant', el.id); }
  }
  function openTz() {
    tzPop.hidden = false;
    tzBtn.setAttribute('aria-expanded', 'true');
    tzSearch.value = '';
    filterTz();
    tzSearch.focus();
  }
  function closeTz(refocus) {
    if (tzPop.hidden) return;
    tzPop.hidden = true;
    tzBtn.setAttribute('aria-expanded', 'false');
    if (refocus) tzBtn.focus();
  }
  function setTz(tz) {
    closeTz(true);
    if (!isValidTz(tz) || tz === state.tz) return;
    state.tz = tz;
    // keep looking at the same moment: jump to today's date in the new zone
    state.cursor = state.selected = today();
    state.mini = state.cursor.slice(0, 8) + '01';
    render();
  }
  tzBtn.addEventListener('click', () => (tzPop.hidden ? openTz() : closeTz(true)));
  tzSearch.addEventListener('input', filterTz);
  tzSearch.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveTz(1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveTz(-1); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (tzMatches[tzActive]) setTz(tzMatches[tzActive].z); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeTz(true); }
  });
  tzListEl.addEventListener('click', (ev) => {
    const li = ev.target.closest('[data-tz]');
    if (li) setTz(li.dataset.tz);
  });
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('#tzPick')) closeTz(false); });

  // ---------- world clock ----------
  const clocksDlg = $('#clocks');
  let cmpAt = null; // null = live "now"; otherwise a fixed moment to compare
  const timeIn = (ms, tz) => { const p = parts(ms, tz); return `${h12(p.h)}:${pad(p.mi)} ${ampm(p.h)}`; };
  function diffLabel(ms, tz) {
    const mins = Math.round((tzOffset(ms, tz) - tzOffset(ms, state.tz)) / 60000);
    if (!mins) return 'Same time';
    const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
    return `${mins > 0 ? '+' : '−'}${h ? `${h}h` : ''}${m ? ` ${m}m` : ''}`.trim();
  }
  function dayLabel(ms, tz) {
    const n = daysBetween(dateIn(ms, state.tz), dateIn(ms, tz));
    return n === 0 ? '' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : fmt(dateIn(ms, tz), { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function hourHint(ms, tz) {
    const h = parts(ms, tz).h;
    if (h >= 9 && h < 18) return '<span class="hint work">Work hours</span>';
    if (h >= 22 || h < 7) return '<span class="hint night">Night</span>';
    return '<span></span>';
  }

  function renderClocks() {
    if (!clocksDlg.open) return;
    const now = Date.now(), at = cmpAt ?? now;
    $('#myZone').textContent = `${state.tz === localTz ? 'Your time · ' : ''}${state.tz.replace(/_/g, ' ')} (${shortOffset(now, state.tz)})`;
    $('#myClock').textContent = timeIn(now, state.tz);
    $('#myDate').textContent = fmt(dateIn(now, state.tz), { weekday: 'long', day: 'numeric', month: 'long' });
    if (cmpAt == null && document.activeElement !== $('#cmpTime') && document.activeElement !== $('#cmpDate')) {
      $('#cmpDate').value = dateIn(now, state.tz);
      $('#cmpTime').value = toTimeInput(minutesOf(now));
    }
    $('#cmpNow').hidden = cmpAt == null;
    if (editingClock) return; // don't redraw the list under someone typing a name
    const zones = state.clocks.filter((z) => z !== state.tz);
    $('#clockList').innerHTML = zones.length
      ? zones.map((z) => `<li class="clock-row">
          <span class="clock-name">
            <button type="button" class="clock-rename" data-clock-rename="${esc(z)}" title="Rename"><b>${esc(clockName(z))}</b>${ICONS.pencil}</button>
            <small>${state.clockNames[z] ? `${esc(cityOf(z))} · ` : ''}${esc(z.includes('/') ? z.split('/')[0].replace(/_/g, ' ') : 'Universal')} · ${esc(shortOffset(at, z))}</small>
          </span>
          <span class="clock-time"><b>${timeIn(at, z)}</b><small>${[dayLabel(at, z), diffLabel(at, z)].filter(Boolean).join(' · ')}</small></span>
          ${hourHint(at, z)}
          <button type="button" class="del" data-clock-del="${esc(z)}" aria-label="Remove ${esc(cityOf(z))}">${ICONS.x}</button>
        </li>`).join('')
      : '<li class="clock-empty">Add a time zone below to compare times.</li>';
  }
  let editingClock = null;
  const clockName = (z) => state.clockNames[z] || cityOf(z);
  function startRename(z) {
    const btn = $('#clockList').querySelector(`[data-clock-rename="${CSS.escape(z)}"]`);
    if (!btn) return;
    editingClock = z;
    const input = document.createElement('input');
    input.className = 'clock-name-input';
    input.value = clockName(z);
    input.maxLength = 40;
    input.setAttribute('aria-label', `Rename ${cityOf(z)}`);
    input.placeholder = cityOf(z);
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (keep) {
        if (name && name !== cityOf(z)) state.clockNames[z] = name; else delete state.clockNames[z];
        save();
      }
      editingClock = null;
      renderClocks();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }
  function openClocks() {
    cmpAt = null;
    clocksDlg.showModal();
    $('#clockSearch').value = '';
    $('#clockResults').hidden = true;
    renderClocks();
  }
  function setCompare() {
    const d = $('#cmpDate').value, t = $('#cmpTime').value;
    if (!d || !t) return;
    const [hh, mm] = t.split(':').map(Number);
    cmpAt = zonedToUtc(d, hh * 60 + mm, state.tz);
    renderClocks();
  }
  $('#clocksBtn').addEventListener('click', openClocks);
  $('#cmpDate').addEventListener('change', setCompare);
  $('#cmpTime').addEventListener('change', setCompare);
  $('#cmpTime').addEventListener('input', setCompare);
  $('#cmpNow').addEventListener('click', () => { cmpAt = null; renderClocks(); });
  clocksDlg.addEventListener('click', (ev) => {
    if (ev.target === clocksDlg || ev.target.closest('[data-close-clocks]')) { clocksDlg.close(); return; }
    const del = ev.target.closest('[data-clock-del]');
    if (del) { state.clocks = state.clocks.filter((z) => z !== del.dataset.clockDel); save(); renderClocks(); return; }
    const ren = ev.target.closest('[data-clock-rename]');
    if (ren) { startRename(ren.dataset.clockRename); return; }
    const add = ev.target.closest('[data-clock-add]');
    if (add) addClock(add.dataset.clockAdd);
  });
  function addClock(z) {
    if (!state.clocks.includes(z)) state.clocks.push(z);
    save();
    $('#clockSearch').value = '';
    $('#clockResults').hidden = true;
    renderClocks();
    $('#clockSearch').focus();
  }
  let clockHits = [], clockActive = 0;
  function showClockResults() {
    const q = $('#clockSearch').value;
    const box = $('#clockResults');
    if (!q.trim()) { box.hidden = true; return; }
    clockHits = matchZones(q).filter((x) => !state.clocks.includes(x.z) && x.z !== state.tz).slice(0, 40);
    clockActive = 0;
    box.hidden = false;
    box.innerHTML = clockHits.length
      ? clockHits.map((x, i) => `<li data-clock-add="${esc(x.z)}"${i === 0 ? ' class="active"' : ''}><span>${esc(x.name)}</span><small>${esc(x.off)}</small></li>`).join('')
      : '<li class="tz-empty">No matching timezones</li>';
  }
  $('#clockSearch').addEventListener('input', showClockResults);
  $('#clockSearch').addEventListener('keydown', (ev) => {
    const items = [...$('#clockResults').querySelectorAll('[data-clock-add]')];
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!items.length) return;
      clockActive = (clockActive + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === clockActive));
      items[clockActive].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (clockHits[clockActive]) addClock(clockHits[clockActive].z);
    }
  });
  setInterval(renderClocks, 1000);

  // ---------- live bits: now line, day rollover ----------
  let lastMinute = '';
  function tick() {
    if (drag?.active) return; // don't redraw under a drag
    const p = parts(Date.now(), state.tz);
    const minuteKey = `${ymd(p.y, p.m, p.d)}|${p.h}:${p.mi}`;
    if (minuteKey === lastMinute) return;
    const dayChanged = lastMinute && lastMinute.split('|')[0] !== minuteKey.split('|')[0];
    lastMinute = minuteKey;
    if (dayChanged) { render(); return; }
    const line = view.querySelector('.now-line');
    if (line) line.style.top = `${((p.h * 60 + p.mi) / 60) * HOUR}px`;
  }

  // ---------- editor ----------
  const dlg = $('#editor');
  let draft = null;      // working copy of the task being edited
  let draftOcc = '';     // occurrence (date key) it was opened from, for repeating tasks
  let draftChecks = new Set();

  $('#fCats').innerHTML = Object.entries(CATS).map(([k, c]) => `
    <label class="opt" style="--c:${c.color}">
      <input type="radio" name="cat" value="${k}">
      <span class="icon-tile">${c.icon}</span>
      <span class="label">${c.label}</span>
      <span class="radio"></span>
    </label>`).join('');
  $('#fDays').innerHTML = DOW_SHORT.map((d, i) => `<button type="button" class="day-pill" data-dow="${i}" aria-pressed="false" aria-label="${d}">${d[0]}</button>`).join('');

  const toTimeInput = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

  // --- repeat controls ---
  function repeatPreset(r, base) {
    if (!r) return 'none';
    const n = r.interval || 1;
    if (n === 1) {
      if (r.freq === 'daily') return 'daily';
      if (r.freq === 'weekly' && repeatDays(r, base).join() === String(dow(base))) return 'weekly';
      if (r.freq === 'monthly') return 'monthly';
    }
    return 'custom';
  }
  function setPressedDays(days) {
    document.querySelectorAll('.day-pill').forEach((b) => b.setAttribute('aria-pressed', days.includes(+b.dataset.dow)));
  }
  const pressedDays = () => [...document.querySelectorAll('.day-pill[aria-pressed="true"]')].map((b) => +b.dataset.dow);

  function syncRepeatUI() {
    const date = $('#fDate').value || state.selected;
    const sel = $('#fRepeat');
    sel.querySelector('[value="weekly"]').textContent = `Weekly on ${fmt(date, { weekday: 'long' })}`;
    sel.querySelector('[value="monthly"]').textContent = `Monthly on day ${dayNum(date)}`;
    const mode = sel.value;
    $('#fCustom').hidden = mode !== 'custom';
    $('#fEndsRow').hidden = mode === 'none';
    $('#fDays').hidden = $('#fFreq').value !== 'weekly';
    $('#fUntil').hidden = $('#fEnds').value !== 'on';
    $('#fDateLabel').textContent = mode === 'none' ? 'Date' : 'Starts';
    const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[$('#fFreq').value];
    const n = +$('#fInterval').value || 1;
    $('#fFreq').querySelectorAll('option').forEach((o) => { o.textContent = { daily: 'day', weekly: 'week', monthly: 'month' }[o.value] + (n === 1 ? '' : 's'); });
    if (unit && !pressedDays().length) setPressedDays([dow(date)]);
  }
  ['fRepeat', 'fFreq', 'fEnds', 'fDate'].forEach((id) => $('#' + id).addEventListener('change', syncRepeatUI));
  $('#fInterval').addEventListener('input', syncRepeatUI);
  $('#fDays').addEventListener('click', (ev) => {
    const b = ev.target.closest('.day-pill');
    if (!b) return;
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
  });

  function loadRepeatForm(r, base) {
    $('#fRepeat').value = repeatPreset(r, base);
    $('#fInterval').value = r?.interval || 1;
    $('#fFreq').value = r?.freq || 'weekly';
    setPressedDays(r ? repeatDays(r, base) : [dow(base)]);
    $('#fEnds').value = r?.until ? 'on' : 'never';
    $('#fUntil').value = r?.until || addMonths(base, 3);
    syncRepeatUI();
  }
  function readRepeatForm(date) {
    const mode = $('#fRepeat').value;
    let r = null;
    if (mode === 'daily') r = { freq: 'daily', interval: 1 };
    else if (mode === 'weekly') r = { freq: 'weekly', interval: 1, days: [dow(date)] };
    else if (mode === 'monthly') r = { freq: 'monthly', interval: 1 };
    else if (mode === 'custom') {
      const freq = $('#fFreq').value;
      r = { freq, interval: Math.min(99, Math.max(1, Math.round(+$('#fInterval').value) || 1)) };
      if (freq === 'weekly') r.days = pressedDays().length ? pressedDays() : [dow(date)];
    }
    if (r && $('#fEnds').value === 'on' && $('#fUntil').value) r.until = $('#fUntil').value < date ? date : $('#fUntil').value;
    return r;
  }

  function openEditor(opts) {
    const e = opts.id ? findEvent(opts.id) : null;
    if (opts.id && !e) return;
    let date;
    if (e) {
      draft = structuredClone(e);
      draft.subtasks ||= [];
      draftOcc = e.repeat ? opts.occ || '' : '';
      const o = { e, key: draftOcc };
      draftChecks = new Set(draft.subtasks.filter((s) => isDone(o, s)).map((s) => s.id));
      date = dateOf(e.start);
      $('#editorTitle').textContent = 'Edit task';
      $('#fStart').value = toTimeInput(minutesOf(e.start));
      $('#fEnd').value = toTimeInput(minutesOf(e.end));
    } else {
      date = opts.date || state.selected;
      let start = opts.startMin;
      if (start == null) {
        const nowMin = minutesOf(Date.now());
        start = date === today() ? Math.min(Math.ceil((nowMin + 1) / 30) * 30, 23 * 60) : 9 * 60;
      }
      draft = { id: null, title: '', cat: DEFAULT_CAT, notes: '', subtasks: [], repeat: null };
      draftOcc = '';
      draftChecks = new Set();
      $('#editorTitle').textContent = 'New task';
      $('#fStart').value = toTimeInput(start);
      $('#fEnd').value = toTimeInput(Math.min(start + 60, 23 * 60 + 59));
    }
    $('#fDate').value = date;
    $('#fTitle').value = draft.title;
    $('#fNotes').value = draft.notes || '';
    (dlg.querySelector(`input[name="cat"][value="${draft.cat}"]`) || dlg.querySelector(`input[name="cat"][value="${DEFAULT_CAT}"]`)).checked = true;
    loadRepeatForm(draft.repeat, date);
    $('#fDelete').hidden = !draft.id;
    $('#fDelete').textContent = draft.repeat ? 'Delete all' : 'Delete';
    $('#fDeleteOne').hidden = !(draft.id && draft.repeat && draftOcc);
    $('#fSubsNote').hidden = !(draft.repeat && draftOcc);
    if (draftOcc) $('#fSubsNote').textContent = `Ticks apply to ${fmt(draftOcc, { weekday: 'short', day: 'numeric', month: 'short' })} only`;
    renderDraftSubs();
    renderEditorZones();
    dlg.showModal();
    $('#fTitle').focus();
  }

  // the task's time converted into each saved world-clock zone
  function rangeIn(start, end, tz) {
    const a = timeIn(start, tz), b = timeIn(end, tz);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
  }
  function renderEditorZones() {
    const zones = state.clocks.filter((z) => z !== state.tz);
    const field = $('#fZonesField');
    const date = $('#fDate').value, s = $('#fStart').value, en = $('#fEnd').value;
    field.hidden = !zones.length || !date || !s || !en;
    if (field.hidden) return;
    const [sh, sm] = s.split(':').map(Number), [eh, em] = en.split(':').map(Number);
    const sMin = sh * 60 + sm, eMin = eh * 60 + em;
    const start = zonedToUtc(date, sMin, state.tz);
    const end = eMin === sMin ? start + 30 * 60000 : zonedToUtc(eMin > sMin ? date : addDays(date, 1), eMin, state.tz);
    $('#fZones').innerHTML = zones.map((z) => {
      const n = daysBetween(date, dateIn(start, z));
      const day = n === 0 ? '' : fmt(dateIn(start, z), { weekday: 'short', day: 'numeric', month: 'short' });
      return `<li><span class="zt-name">${esc(clockName(z))}</span><span class="zt-time">${rangeIn(start, end, z)}</span>${day ? `<span class="zt-day">${esc(day)}</span>` : ''}</li>`;
    }).join('');
  }
  ['fDate', 'fStart', 'fEnd'].forEach((id) => {
    $('#' + id).addEventListener('input', renderEditorZones);
    $('#' + id).addEventListener('change', renderEditorZones);
  });

  function renderDraftSubs() {
    $('#fSubs').innerHTML = draft.subtasks.map((s) => checkItem(s, `draft:${s.id}`, draftChecks.has(s.id))).join('');
  }
  function addDraftSub() {
    const inp = $('#fSubInput');
    const text = inp.value.trim();
    if (!text) return;
    draft.subtasks.push({ id: uid(), text, done: false });
    inp.value = '';
    renderDraftSubs();
  }
  $('#fSubAdd').addEventListener('click', addDraftSub);
  $('#fSubInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addDraftSub(); } });
  $('#fSubs').addEventListener('change', (ev) => {
    const id = ev.target.dataset.toggle?.split(':')[1];
    if (!id) return;
    if (ev.target.checked) draftChecks.add(id); else draftChecks.delete(id);
  });
  $('#fSubs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-remove]');
    if (!btn) return;
    const id = btn.dataset.remove.split(':')[1];
    draft.subtasks = draft.subtasks.filter((x) => x.id !== id);
    draftChecks.delete(id);
    renderDraftSubs();
  });

  $('#editorForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if ($('#fSubInput').value.trim()) addDraftSub();
    const date = $('#fDate').value;
    const [sh, sm] = $('#fStart').value.split(':').map(Number);
    const [eh, em] = $('#fEnd').value.split(':').map(Number);
    if (!date || Number.isNaN(sh) || Number.isNaN(eh)) return;
    const sMin = sh * 60 + sm, eMin = eh * 60 + em;
    const start = zonedToUtc(date, sMin, state.tz);
    // an end time before the start means it runs past midnight
    const end = eMin === sMin ? start + 30 * 60000 : zonedToUtc(eMin > sMin ? date : addDays(date, 1), eMin, state.tz);
    const repeat = readRepeatForm(date);

    Object.assign(draft, {
      title: $('#fTitle').value.trim() || '(untitled)',
      notes: $('#fNotes').value.trim(),
      cat: dlg.querySelector('input[name="cat"]:checked')?.value || DEFAULT_CAT,
      start, end, repeat,
    });
    if (repeat) {
      draft.tz = state.tz;
      const key = draftOcc || date;
      draft.checks ||= {};
      if (draftChecks.size) draft.checks[key] = [...draftChecks]; else delete draft.checks[key];
      draft.subtasks.forEach((s) => { s.done = false; });
    } else {
      draft.subtasks.forEach((s) => { s.done = draftChecks.has(s.id); });
      delete draft.tz; delete draft.checks; delete draft.exdates;
    }
    if (draft.id) {
      const i = state.events.findIndex((e) => e.id === draft.id);
      if (i >= 0) state.events[i] = draft;
    } else {
      draft.id = uid();
      state.events.push(draft);
    }
    goTo(draftOcc && repeat ? state.selected : date, { keepView: true });
    dlg.close();
  });

  $('#fDelete').addEventListener('click', () => {
    if (!draft?.id) return;
    state.events = state.events.filter((e) => e.id !== draft.id);
    dlg.close();
    render();
  });
  $('#fDeleteOne').addEventListener('click', () => {
    const e = draft?.id && findEvent(draft.id);
    if (!e || !draftOcc) return;
    (e.exdates ||= []).push(draftOcc);
    if (e.checks) delete e.checks[draftOcc];
    dlg.close();
    render();
  });
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close();
  });

  // ---------- navigation ----------
  function goTo(date, { view: v, keepView } = {}) {
    if (v) state.view = v;
    state.selected = date;
    if (!keepView || !isVisible(date)) state.cursor = date;
    state.mini = date.slice(0, 8) + '01';
    render();
  }
  function isVisible(d) {
    if (state.view === 'day') return d === state.cursor;
    if (state.view === 'week') return startOfWeek(d) === startOfWeek(state.cursor);
    return d.slice(0, 7) === state.cursor.slice(0, 7);
  }
  function step(dir) {
    let d;
    if (state.view === 'day') d = addDays(state.cursor, dir);
    else if (state.view === 'week') d = addDays(state.cursor, 7 * dir);
    else {
      d = addMonths(state.cursor, dir);
      const t = today();
      if (t.slice(0, 7) === d.slice(0, 7)) d = t;
    }
    goTo(d);
  }
  function setView(v) {
    state.view = v;
    state.cursor = state.selected;
    render();
  }

  $('#prevBtn').addEventListener('click', () => step(-1));
  $('#nextBtn').addEventListener('click', () => step(1));
  $('#todayBtn').addEventListener('click', () => goTo(today()));
  $('#newBtn').addEventListener('click', () => openEditor({ date: state.selected }));
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  $('#miniPrev').addEventListener('click', () => { state.mini = addMonths(state.mini, -1); renderMini(); });
  $('#miniNext').addEventListener('click', () => { state.mini = addMonths(state.mini, 1); renderMini(); });
  $('#miniGrid').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-date]');
    if (b) goTo(b.dataset.date);
  });

  // ---------- task checklists ----------
  // keys look like sub:<eventId>:<stepId>:<occurrence date or empty>
  const findTodo = (key) => {
    const [d, id] = key.split(':');
    return { d, list: state.todos[d] || [], item: (state.todos[d] || []).find((t) => t.id === id) };
  };
  function onToggle(ev) {
    if (ev.target.dataset.todo) {
      const { item } = findTodo(ev.target.dataset.todo);
      if (item) { item.done = ev.target.checked; render(); }
      return;
    }
    const key = ev.target.dataset.toggle;
    if (!key || !key.startsWith('sub:')) return;
    const [, id, subId, occ = ''] = key.split(':');
    const e = findEvent(id);
    const sub = e?.subtasks?.find((x) => x.id === subId);
    if (!sub) return;
    setDone({ e, key: e.repeat ? occ : '' }, sub, ev.target.checked);
    render();
  }
  function onRemove(ev) {
    const btn = ev.target.closest('[data-remove]');
    if (!btn || !btn.dataset.remove.startsWith('sub:')) return false;
    const [, id, subId] = btn.dataset.remove.split(':');
    const e = findEvent(id);
    if (e) { e.subtasks = (e.subtasks || []).filter((x) => x.id !== subId); render(); }
    return true;
  }

  // ---------- main view + day panel interactions ----------
  for (const el of [view, agenda]) {
    el.addEventListener('change', onToggle);
    el.addEventListener('submit', onAddStep);
    el.addEventListener('click', onViewClick);
  }
  function onAddStep(ev) {
    const addTodo = ev.target.closest('[data-todo-add]');
    if (addTodo) {
      ev.preventDefault();
      const d = addTodo.dataset.todoAdd;
      const text = addTodo.querySelector('input').value.trim();
      if (!text) return;
      (state.todos[d] ||= []).push({ id: uid(), text, done: false });
      render();
      document.querySelector(`[data-todo-add="${d}"] input`)?.focus();
      return;
    }
    const form = ev.target.closest('[data-addsub]');
    if (!form) return;
    ev.preventDefault();
    const e = findEvent(form.dataset.addsub);
    const text = form.querySelector('input').value.trim();
    if (!e || !text) return;
    (e.subtasks ||= []).push({ id: uid(), text, done: false });
    render();
    document.querySelector(`[data-addsub="${e.id}"] input`)?.focus();
  }
  function onViewClick(ev) {
    if (justDragged) return; // the click that ends a drag
    const del = ev.target.closest('[data-todo-del]');
    if (del) {
      const { d, list, item } = findTodo(del.dataset.todoDel);
      if (item) {
        const rest = list.filter((t) => t !== item);
        if (rest.length) state.todos[d] = rest; else delete state.todos[d];
        render();
      }
      return;
    }
    // clicks inside a day's task list never open the editor or change day
    if (ev.target.closest('.todo-list, .todo-add')) return;
    if (onRemove(ev)) return;
    if (ev.target.closest('label.check, form')) return;
    const evBtn = ev.target.closest('[data-ev]');
    if (evBtn) return openEditor({ id: evBtn.dataset.ev, occ: evBtn.dataset.occ });
    const go = ev.target.closest('[data-goday]');
    if (go) return goTo(go.dataset.goday, { view: 'day' });
    const nw = ev.target.closest('[data-new]');
    if (nw) return openEditor({ date: nw.dataset.new });
    const col = ev.target.closest('[data-col]');
    if (col) {
      const y = ev.clientY - col.getBoundingClientRect().top;
      const min = Math.max(0, Math.min(23 * 60 + 45, Math.floor(((y / HOUR) * 60) / 15) * 15));
      state.selected = col.dataset.col;
      return openEditor({ date: col.dataset.col, startMin: min });
    }
    const cell = ev.target.closest('[data-cell]');
    if (cell) {
      state.selected = cell.dataset.cell;
      render();
    }
  }
  view.addEventListener('dblclick', (ev) => {
    const cell = ev.target.closest('[data-cell]');
    if (cell && !ev.target.closest('[data-ev],[data-goday],.mc-tasks')) openEditor({ date: cell.dataset.cell, startMin: 9 * 60 });
  });

  // keyboard shortcuts: d / w / m, t, n, ← →
  document.addEventListener('keydown', (ev) => {
    if (dlg.open || scopeDlg.open || clocksDlg.open || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target.closest('input, textarea, select')) return;
    const k = ev.key.toLowerCase();
    if (k === 'd') setView('day');
    else if (k === 'w') setView('week');
    else if (k === 'm') setView('month');
    else if (k === 't') goTo(today());
    else if (k === 'n') { ev.preventDefault(); openEditor({ date: state.selected }); }
    else if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'ArrowRight') step(1);
  });

  // ---------- drag to move ----------
  // Day/week: drag a block to a new time or day (15-minute steps). Month: drag a chip to another day.
  const SNAP = 15;
  let drag = null, justDragged = false;

  function occFor(e, key) {
    if (!e.repeat || !key) return { e, key: '', start: e.start, end: e.end };
    const tz = e.tz || state.tz, p = parts(e.start, tz);
    const st = zonedToUtc(key, p.h * 60 + p.mi, tz);
    return { e, key, start: st, end: st + (e.end - e.start) };
  }

  view.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const el = ev.target.closest('.ev, .chip');
    const e = el && findEvent(el.dataset.ev);
    if (!e) return;
    const r = el.getBoundingClientRect();
    drag = {
      el, o: occFor(e, el.dataset.occ), kind: el.classList.contains('ev') ? 'grid' : 'month',
      x0: ev.clientX, y0: ev.clientY, grabX: ev.clientX - r.left, grabY: ev.clientY - r.top,
      pointerId: ev.pointerId, touch: ev.pointerType === 'touch', active: false, timer: null,
    };
    // on touch, hold briefly to pick a task up so normal swipes still scroll
    if (drag.touch) drag.timer = setTimeout(() => drag && !drag.active && startDrag(), 350);
  });

  function startDrag() {
    drag.active = true;
    document.body.classList.add('is-dragging');
    drag.el.classList.add('dragging');
    try { drag.el.setPointerCapture(drag.pointerId); } catch { /* capture is a nicety */ }
    if (drag.kind === 'month') {
      const g = drag.el.cloneNode(true);
      g.classList.remove('dragging');
      g.classList.add('drag-ghost');
      g.style.width = `${drag.el.getBoundingClientRect().width}px`;
      document.body.append(g);
      drag.ghost = g;
    } else {
      drag.label = document.createElement('span');
      drag.label.className = 'ev-drag-time';
      drag.el.append(drag.label);
      drag.el.style.left = '3px';
      drag.el.style.width = 'calc(100% - 6px)';
    }
  }

  function moveGrid(ev) {
    const sc = view.querySelector('.tg-scroll');
    const headBottom = sc.querySelector('.tg-head').getBoundingClientRect().bottom;
    const r = sc.getBoundingClientRect();
    if (ev.clientY < headBottom + 30) sc.scrollTop -= 14;
    else if (ev.clientY > r.bottom - 30) sc.scrollTop += 14;
    const col = document.elementsFromPoint(ev.clientX, Math.max(ev.clientY, headBottom + 1)).find((n) => n.matches?.('.tg-col')) || drag.el.parentElement;
    if (col !== drag.el.parentElement) col.append(drag.el);
    const y = ev.clientY - col.getBoundingClientRect().top - drag.grabY;
    const min = Math.max(0, Math.min(1440 - SNAP, Math.round(((y / HOUR) * 60) / SNAP) * SNAP));
    drag.date = col.dataset.col;
    drag.min = min;
    drag.el.style.top = `${(min / 60) * HOUR}px`;
    const st = zonedToUtc(drag.date, min, state.tz);
    drag.label.textContent = timeRange({ start: st, end: st + (drag.o.end - drag.o.start) });
  }

  function moveMonth(ev) {
    drag.ghost.style.transform = `translate(${ev.clientX - drag.grabX}px, ${ev.clientY - drag.grabY}px)`;
    const cell = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.matches?.('.mc'));
    view.querySelectorAll('.drop-target').forEach((n) => { if (n !== cell) n.classList.remove('drop-target'); });
    cell?.classList.add('drop-target');
    drag.date = cell?.dataset.cell || null;
  }

  document.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const dist = Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0);
      if (drag.touch) { if (dist > 8) { clearTimeout(drag.timer); drag = null; } return; }
      if (dist < 5) return;
      startDrag();
    }
    ev.preventDefault();
    if (drag.kind === 'grid') moveGrid(ev); else moveMonth(ev);
  });
  document.addEventListener('touchmove', (ev) => { if (drag?.active) ev.preventDefault(); }, { passive: false });

  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    if (!d.active) return;
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 50);
    document.body.classList.remove('is-dragging');
    d.ghost?.remove();
    if (ev.type === 'pointercancel' || !d.date) { render(); return; }
    const min = d.kind === 'grid' ? d.min : minutesOf(d.o.start);
    const newStart = zonedToUtc(d.date, min, state.tz);
    if (newStart === d.o.start) { render(); return; }
    commitMove(d.o, newStart);
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // --- applying a move ---
  const scopeDlg = $('#scopeAsk');
  let scopeResolve = null;
  function askScope(e) {
    $('#scopeText').textContent = `“${e.title || 'This task'}” repeats. Move just this one, or every time it happens?`;
    scopeDlg.showModal();
    return new Promise((resolve) => { scopeResolve = resolve; });
  }
  function finishScope(choice) {
    const resolve = scopeResolve;
    scopeResolve = null;
    if (scopeDlg.open) scopeDlg.close();
    resolve?.(choice);
  }
  scopeDlg.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-scope]');
    if (b) finishScope(b.dataset.scope);
    else if (ev.target === scopeDlg) finishScope('');
  });
  scopeDlg.addEventListener('close', () => finishScope('')); // Escape key

  async function commitMove(o, newStart) {
    const e = o.e, dur = o.end - o.start;
    if (!e.repeat) {
      e.start = newStart;
      e.end = newStart + dur;
    } else {
      const scope = await askScope(e);
      if (scope === 'one') moveOne(o, newStart);
      else if (scope === 'all') moveSeries(o, newStart);
    }
    state.selected = dateOf(newStart);
    render();
  }

  // pull one occurrence out of the series as its own task
  function moveOne(o, newStart) {
    const e = o.e;
    const done = new Set(e.checks?.[o.key] || []);
    const copy = structuredClone(e);
    Object.assign(copy, { id: uid(), start: newStart, end: newStart + (o.end - o.start), repeat: null });
    delete copy.tz; delete copy.checks; delete copy.exdates;
    copy.subtasks = (copy.subtasks || []).map((s) => ({ ...s, done: done.has(s.id) }));
    (e.exdates ||= []).push(o.key);
    if (e.checks) delete e.checks[o.key];
    state.events.push(copy);
  }

  // shift the whole series by the same days/minutes the occurrence moved
  function moveSeries(o, newStart) {
    const e = o.e, r = e.repeat, tz = e.tz || state.tz, dur = e.end - e.start;
    const op = parts(o.start, tz), np = parts(newStart, tz), bp = parts(e.start, tz);
    const dayShift = daysBetween(ymd(op.y, op.m, op.d), ymd(np.y, np.m, np.d));
    const minShift = (np.h * 60 + np.mi) - (op.h * 60 + op.mi);
    const base = ymd(bp.y, bp.m, bp.d);
    if (r.freq === 'weekly') r.days = repeatDays(r, base).map((x) => (((x + dayShift) % 7) + 7) % 7);
    e.start = zonedToUtc(addDays(base, dayShift), bp.h * 60 + bp.mi + minShift, tz);
    e.end = e.start + dur;
    const shift = (k) => addDays(k, dayShift);
    if (e.exdates) e.exdates = e.exdates.map(shift);
    if (e.checks) e.checks = Object.fromEntries(Object.entries(e.checks).map(([k, v]) => [shift(k), v]));
    if (r.until) r.until = shift(r.until);
  }

  // ---------- boot ----------
  document.documentElement.style.setProperty('--hour', `${HOUR}px`);
  if (!load()) seed();
  state.cursor = state.selected = today();
  state.mini = state.cursor.slice(0, 8) + '01';
  render();
  setInterval(tick, 1000);
})();
