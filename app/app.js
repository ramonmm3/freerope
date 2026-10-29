// FreeRope for the web: the Android app's screens rebuilt in plain JS, no build step.
import * as E from './energy.js';
import { Handle, bluetoothAvailable } from './handle.js';
import { Engine, presets } from './engine.js';

// ================================================================= storage

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};

const defaultProfile = {
  name: '', weightKg: 70, heightCm: 170, age: 30, sex: 'UNSET', ropeLb: 1,
  dailyGoal: 1000, minuteGoal: 15, calorieGoal: 150, voice: true, haptics: true,
  imperial: /^en-(US|LR|MM)$/i.test(navigator.language || ''), onboarded: false,
};
let profile = { ...defaultProfile, ...store.get('freerope.profile', {}) };
let sessions = store.get('freerope.sessions', []);

function updateProfile(patch) {
  profile = { ...profile, ...patch };
  store.set('freerope.profile', profile);
  render();
}
function saveSessions() {
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  store.set('freerope.sessions', sessions);
}

// ================================================================= format

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const compact = (n) => n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}K` : String(n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = (min) => min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.max(1, Math.round(min))} min`;

const units = {
  height: (cm) => {
    if (!profile.imperial) return `${cm} cm`;
    const inch = Math.round(cm / 2.54);
    return `${Math.floor(inch / 12)}′ ${inch % 12}″`;
  },
  weight: (kg) => profile.imperial ? `${Math.round(kg * 2.20462)} lb` : `${Math.round(kg)} kg`,
  stepHeight: (cm, d) => Math.min(230, Math.max(120, profile.imperial ? Math.round((Math.round(cm / 2.54) + d) * 2.54) : cm + d)),
  stepWeight: (kg, d) => Math.min(200, Math.max(30, profile.imperial ? (Math.round(kg * 2.20462) + d) / 2.20462 : Math.round(kg) + d)),
};

const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86400000;
function dayLabel(t) {
  const d0 = dayStart(Date.now()), d = dayStart(t);
  if (d === d0) return 'Today';
  if (d === d0 - DAY) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { weekday: d0 - d < 6 * DAY ? 'long' : undefined, month: 'short', day: 'numeric' });
}
const timeLabel = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// ================================================================= stats

function totals(list) {
  return list.reduce((a, s) => ({ jumps: a.jumps + s.jumps, minutes: a.minutes + s.activeSec / 60, calories: a.calories + s.calories, count: a.count + 1 }), { jumps: 0, minutes: 0, calories: 0, count: 0 });
}
const today = () => totals(sessions.filter((s) => dayStart(s.startedAt) === dayStart(Date.now())));
function daily(n) {
  const d0 = dayStart(Date.now());
  return Array.from({ length: n }, (_, i) => {
    const d = d0 - (n - 1 - i) * DAY;
    return { day: d, jumps: sessions.filter((s) => dayStart(s.startedAt) === d).reduce((a, s) => a + s.jumps, 0) };
  });
}
function dayStreak() {
  const days = new Set(sessions.map((s) => dayStart(s.startedAt)));
  let d = dayStart(Date.now());
  if (!days.has(d)) d -= DAY;
  let n = 0;
  while (days.has(d)) { n++; d -= DAY; }
  return n;
}
function bests(list = sessions) {
  return {
    jumps: Math.max(0, ...list.map((s) => s.jumps)),
    streak: Math.max(0, ...list.map((s) => s.bestStreak)),
    jpm: Math.max(0, ...list.filter((s) => s.activeSec >= 30).map((s) => s.avgJpm)),
  };
}

// ================================================================= icons

const P = {
  rings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  dumbbell: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" stroke="none"/>',
  infinity: '<path d="M7 8.5c-2 0-3.5 1.5-3.5 3.5S5 15.5 7 15.5c3.5 0 6.5-7 10-7 2 0 3.5 1.5 3.5 3.5S19 15.5 17 15.5c-3.5 0-6.5-7-10-7z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  bt: '<path d="M7 7l10 10-5 4.5V2.5L17 7 7 17"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-4.5-4-7-4-11-2.5 1.5-4 4-4 6-1-1-2-2-2-3.5C6.5 8.5 5 11 5 15c0 4.2 3 7 7 7z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  cake: '<path d="M4 21h16v-8H4zM4 16c2 1 4 1 5.5 0s3.5-1 5 0 4 1 5.5 0M12 13V9M12 6V4"/>',
  sex: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  voice: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  vibe: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/>',
  rope: '<path d="M6 3v6M18 3v6M6 9c0 7 2 12 6 12s6-5 6-12"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  run: '<circle cx="14" cy="4.5" r="2"/><path d="M6 21l3.5-6 3 2.5V22M8 11l3-4 3.5 2 2 3H20M11 7l-1.5 5"/>',
  bike: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8l2 8h-6M14 5h2"/>',
  swim: '<path d="M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M5 13l5-5 4 3M16 6.5a2 2 0 1 0 0-.1"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M9 22l2.5-7 2.5 2v5M10 10l2.5-2.5 2 3.5 3 1.5M12.5 7.5L9 10v4"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor" stroke="none"/>',
  units: '<path d="M3 7h18M3 12h12M3 17h6"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.2-9C1.5 8 3.6 4.5 7 4.5c2.1 0 3.5 1.2 5 3 1.5-1.8 2.9-3 5-3 3.4 0 5.5 3.5 4.2 7-1.7 4.4-9.2 9-9.2 9z" fill="currentColor" stroke="none"/>',
};
const DONATE = 'https://www.paypal.com/donate/?business=ramonmm3%40gmail.com&item_name=Help+FreeRope+reach+the+App+Store+and+Play+Store&currency_code=USD';
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
const modeIcon = { FREE: 'infinity', TIMED: 'timer', TARGET: 'flag', INTERVAL: 'repeat' };
const modeGrad = {
  FREE: 'linear-gradient(135deg,#c8ff4a,#7be000)', TIMED: 'linear-gradient(135deg,#6af5ff,#00c3f0)',
  TARGET: 'linear-gradient(135deg,#ff8aa8,#fa114f)', INTERVAL: 'linear-gradient(135deg,#ffcf5a,#ff9f0a)',
};
const badge = (mode) => `<div class="badge" style="background:${modeGrad[mode]}">${icon(modeIcon[mode])}</div>`;

// ================================================================= rings

let gradId = 0;
/** Activity rings as SVG. Each ring: [progress, colorA, colorB]. Past 100% laps overlap like Apple's. */
function ringsSVG(rings, size, strokeFrac = 0.115, gapPx = 3) {
  const stroke = size * strokeFrac;
  let out = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)"><defs>`;
  const parts = [];
  rings.forEach(([p, a, b], i) => {
    const id = `rg${++gradId}`;
    out += `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    const r = size / 2 - stroke / 2 - i * (stroke + gapPx);
    if (r <= 0) return;
    const c = 2 * Math.PI * r;
    parts.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${a}" stroke-opacity=".22" stroke-width="${stroke}"/>`);
    if (p >= 1) parts.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${a}" stroke-width="${stroke}"/>`);
    const frac = p >= 1 ? (p % 1 || 0.0001) : p;
    if (p > 0) parts.push(`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${Math.max(frac * c, 0.01)} ${c}"/>`);
  });
  return out + '</defs>' + parts.join('') + '</svg>';
}

// ================================================================= pace chart

const PACE_SEC = 5;

/** Splits rests from jumping and smooths, like the Android PaceChart. */
function paceModel(values) {
  const real = values.filter((v) => v >= 40).sort((a, b) => a - b);
  const median = real.length ? real[Math.floor(real.length / 2)] : 0;
  const cutoff = Math.max(40, 0.6 * median);
  const jumping = values.map((v) => v >= cutoff);
  const k = [1, 2, 3, 2, 1];
  const smooth = values.map((v, i) => {
    if (!jumping[i]) return null;
    let s = 0, w = 0;
    for (let j = -2; j <= 2; j++) {
      const x = i + j;
      if (x >= 0 && x < values.length && jumping[x]) { s += values[x] * k[j + 2]; w += k[j + 2]; }
    }
    return s / w;
  });
  const vals = smooth.filter((v) => v != null);
  const raw = values.filter((_, i) => jumping[i]);
  let lo = vals.length ? Math.floor(Math.min(...vals) / 10) * 10 : 0;
  let hi = vals.length ? Math.ceil(Math.max(...vals) / 10) * 10 : 100;
  if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 20) / 10) * 10; hi = lo + 40; }
  return {
    jumping, smooth, lo: Math.max(0, lo), hi,
    avg: raw.length ? Math.round(raw.reduce((a, b) => a + b, 0) / raw.length) : 0,
    peak: vals.length ? Math.round(Math.max(...vals)) : 0,
    restSec: jumping.filter((j) => !j).length * PACE_SEC,
  };
}

function paceChartSVG(values, w, h, axis = true) {
  const m = paceModel(values);
  const n = values.length;
  if (n < 2) return { svg: `<svg viewBox="0 0 ${w} ${h}"></svg>`, m };
  const left = 0, right = axis ? w - 34 : w, top = 8, bottom = axis ? h - 20 : h;
  const x = (i) => left + (right - left) * i / (n - 1);
  const y = (v) => bottom - (bottom - top) * (v - m.lo) / (m.hi - m.lo);
  let bands = '', segs = [], cur = [];
  m.jumping.forEach((j, i) => {
    if (!j) {
      bands += `<rect x="${x(Math.max(i - 0.5, 0))}" y="${top}" width="${(right - left) / (n - 1)}" height="${bottom - top}" fill="rgba(118,118,128,.18)"/>`;
      if (cur.length) { segs.push(cur); cur = []; }
    } else cur.push(i);
  });
  if (cur.length) segs.push(cur);
  let paths = '';
  segs.forEach((seg) => {
    if (seg.length === 1) seg = [seg[0], seg[0]];
    const line = seg.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.smooth[i]).toFixed(1)}`).join('');
    paths += `<path d="${line}L${x(seg.at(-1))},${bottom}L${x(seg[0])},${bottom}Z" fill="url(#paceFill)"/>`;
    paths += `<path d="${line}" fill="none" stroke="url(#paceLine)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  const ay = y(m.avg);
  let ax = '';
  if (axis) {
    ax += `<text x="${w}" y="${top + 4}" text-anchor="end" fill="rgba(235,235,245,.6)" font-size="11">${m.hi}</text>`;
    ax += `<text x="${w}" y="${bottom}" text-anchor="end" fill="rgba(235,235,245,.6)" font-size="11">${m.lo}</text>`;
    if (m.avg) ax += `<text x="${w}" y="${ay + 4}" text-anchor="end" fill="#fff" font-size="11" font-weight="600">avg ${m.avg}</text>`;
    ax += `<text x="${left}" y="${h - 4}" fill="rgba(235,235,245,.6)" font-size="11">0:00</text>`;
    ax += `<text x="${right}" y="${h - 4}" text-anchor="end" fill="rgba(235,235,245,.6)" font-size="11">${clock((n - 1) * PACE_SEC)}</text>`;
  }
  const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="paceLine" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#7be000"/><stop offset=".6" stop-color="#a6ff00"/><stop offset="1" stop-color="#64d2ff"/></linearGradient>
      <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ff00" stop-opacity=".28"/><stop offset="1" stop-color="#a6ff00" stop-opacity="0"/></linearGradient>
    </defs>
    ${bands}${paths}
    ${m.avg ? `<line x1="${left}" x2="${right}" y1="${ay}" y2="${ay}" stroke="rgba(255,255,255,.55)" stroke-dasharray="4 4" stroke-width="1"/>` : ''}
    ${ax}
    <g class="scrub" style="display:none"><line y1="${top}" y2="${bottom}" stroke="#fff" stroke-width="1"/><circle r="4.5" fill="#fff"/></g>
  </svg>`;
  return { svg, m, geom: { left, right, top, bottom, n, x, y } };
}

// ================================================================= cues

const cues = {
  say(text) {
    if (!profile.voice || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* no voice available */ }
  },
  buzz(ms) { if (profile.haptics && navigator.vibrate) navigator.vibrate(ms); },
};

// ================================================================= app state

const handle = new Handle();
const engine = new Engine(handle, cues, () => profile);
const ui = { tab: 'summary', view: null, histRange: 'week', compareTab: 'activities', food: 0 };
const app = document.getElementById('app');

handle.addEventListener('change', () => { if (!engine.s) render(); });

engine.addEventListener('finished', (e) => {
  const s = e.detail;
  const prev = bests();
  const newBests = [];
  if (prev.jumps > 0 && s.jumps > prev.jumps) newBests.push('Most jumps');
  if (prev.streak > 0 && s.bestStreak > prev.streak) newBests.push('Longest streak');
  if (s.activeSec >= 30 && prev.jpm > 0 && s.avgJpm > prev.jpm) newBests.push('Fastest pace');
  // Demo workouts are for trying the app; keep them out of history and stats.
  if (s.jumps > 0 && !handle.demo) { sessions.push(s); saveSessions(); }
  ui.view = { type: 'summary', session: s, newBests, demo: handle.demo };
  releaseWakeLock();
  closeLive();
  render();
});

// ================================================================= render

function render() {
  if (!profile.onboarded) return renderOnboarding();
  let html;
  if (ui.view?.type === 'detail' || ui.view?.type === 'summary') html = renderDetail();
  else html = { summary: renderSummary, workouts: renderWorkouts, history: renderHistory, profile: renderProfile }[ui.tab]();
  const scroller = app.querySelector('.screen');
  const keep = scroller && scroller.dataset.key === screenKey() ? scroller.scrollTop : 0;
  app.innerHTML = html + (ui.view ? '' : tabbar());
  const next = app.querySelector('.screen');
  if (next) { next.dataset.key = screenKey(); next.scrollTop = keep; }
  bindCharts();
}
const screenKey = () => ui.view ? `${ui.view.type}:${ui.view.session?.id}` : ui.tab;

function tabbar() {
  const t = [['summary', 'rings', 'Summary'], ['workouts', 'dumbbell', 'Workouts'], ['history', 'calendar', 'History'], ['profile', 'person', 'Profile']];
  return `<nav class="tabbar">${t.map(([k, ic, l]) => `<button data-act="tab" data-arg="${k}" class="${ui.tab === k ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
}

const nav = (title, eyebrow = '', right = '') => `<div class="nav"><div class="wrap"><div class="eyebrow">${eyebrow}</div><div class="row"><h1 class="large-title">${title}</h1>${right}</div></div></div>`;

function handleCard() {
  const st = handle.state;
  const dot = st === 'connected' ? 'on' : st === 'connecting' ? 'wait' : '';
  const name = st === 'connected' ? esc(handle.name || 'Crossrope AMP') : 'Crossrope Handle';
  const sub = st === 'connected' ? (handle.demo ? 'Demo mode · simulated jumps' : `Connected${handle.firmware ? ` · firmware ${handle.firmware}` : ''}`) : st === 'connecting' ? 'Connecting…' : 'Not connected · tap to pair';
  return `<button class="card handle-card press" data-act="${st === 'connected' ? 'tab' : 'connect'}" data-arg="profile" style="width:100%;text-align:left">
    <div class="tile" style="background:var(--blue)">${icon('bt')}</div>
    <div style="flex:1"><div style="font-weight:600">${name}</div><div class="small muted">${sub}</div></div><span class="dot ${dot}"></span></button>`;
}

function workoutRow(s) {
  return `<button class="wrow press" data-act="open" data-arg="${s.id}">${badge(s.mode)}
    <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(s.title)}</div><div class="num" style="font-size:24px;font-weight:700;color:var(--accent)">${fmt(s.jumps)} <small class="muted" style="font-size:13px">JUMPS</small></div></div>
    <div style="text-align:right" class="small muted"><div>${dayLabel(s.startedAt)}</div><div class="num">${clock(s.durationSec)}</div></div></button>`;
}

function renderSummary() {
  const t = today();
  const week = daily(7);
  const maxW = Math.max(...week.map((d) => d.jumps), 1);
  const avg = Math.round(week.reduce((a, d) => a + d.jumps, 0) / 7);
  const b = bests();
  const rings = ringsSVG([
    [t.jumps / profile.dailyGoal, '#fa114f', '#ff5a8c'],
    [t.minutes / profile.minuteGoal, '#7be000', '#c8ff4a'],
    [t.calories / profile.calorieGoal, '#00c3f0', '#6af5ff'],
  ], 150);
  const leg = (l, v, g, u, c) => `<div><div class="l">${l}</div><div class="v num" style="color:${c}">${fmt(v)}<small>/${fmt(g)}${u ? ' ' + u : ''}</small></div></div>`;
  const quick = [
    [presets.timed[2], '5', 'MIN', 'linear-gradient(135deg,#6af5ff,#00c3f0)'],
    [presets.target[2], '500', 'JUMPS', 'linear-gradient(135deg,#ff8aa8,#fa114f)'],
    [presets.intervals[0], 'Tabata', '8 ROUNDS', 'linear-gradient(135deg,#ffcf5a,#ff9f0a)'],
    [presets.timed[3], '10', 'MIN', 'linear-gradient(135deg,#d6a8ff,#bf5af2)'],
  ];
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return `<div class="screen">${nav('Summary', date)}<div class="wrap">
    <div class="section">Activity</div>
    <button class="card rings-card press" data-act="tab" data-arg="history" style="width:100%;text-align:left">
      <div class="legend">${leg('Jumps', t.jumps, profile.dailyGoal, '', '#ff5a8c')}${leg('Minutes', Math.floor(t.minutes), profile.minuteGoal, 'MIN', '#c8ff4a')}${leg('Calories', t.calories, profile.calorieGoal, 'CAL', '#6af5ff')}</div>${rings}
    </button>
    ${handleCard()}
    <div style="margin-top:16px"><button class="btn press" data-act="start" data-arg="free">${icon('play')}Start Free Jump</button></div>
    <div class="section">Quick Start</div>
    <div class="quick">${quick.map(([p, big, small, bg], i) => `<button class="q press" style="background:${bg};color:#000" data-act="startq" data-arg="${i}"><b>${big}</b><span>${small}</span></button>`).join('')}</div>
    <div class="section">This Week</div>
    <div class="card"><div class="small muted" style="font-weight:600">DAILY AVERAGE</div><div class="num" style="font-size:28px;font-weight:700">${fmt(avg)} <small class="muted" style="font-size:15px">jumps</small></div>
      <div class="bars">${week.map((d) => `<div><i class="${d.jumps ? '' : 'zero'}" style="height:${Math.max(d.jumps / maxW * 100, 3)}%"></i><span>${new Date(d.day).toLocaleDateString('en-US', { weekday: 'narrow' })}</span></div>`).join('')}</div></div>
    <div class="section">Highlights</div>
    <div class="hl">
      ${hl('Day Streak', dayStreak(), 'days', 'var(--orange)')}${hl('Total', sessions.reduce((a, s) => a + s.jumps, 0), 'jumps', 'var(--accent)')}
      ${hl('Best Streak', b.streak, 'jumps', 'var(--pink)')}${hl('Top Pace', b.jpm, 'JPM', 'var(--teal)')}
    </div>
    ${sessions.length ? `<div class="section">Workouts<button class="action" data-act="tab" data-arg="history">Show More</button></div><div class="card" style="padding:0">${sessions.slice(0, 3).map(workoutRow).join('')}</div>` : ''}
  </div></div>`;
}
const hl = (l, v, u, c) => `<div class="card"><div class="foot" style="font-weight:600;color:${c}">${l}</div><div class="num" style="font-size:30px;font-weight:700;margin-top:4px">${fmt(v)} <small class="muted" style="font-size:15px">${u}</small></div></div>`;

function renderWorkouts() {
  return `<div class="screen">${nav('Workouts')}<div class="wrap">
    <button class="hero press" data-act="start" data-arg="free"><div><div style="font-weight:700;font-size:13px;opacity:.7">OPEN GOAL</div><h2>Free Jump</h2><div style="opacity:.75">No timer, no target. Just jump.</div></div><span class="pill">Start ▸</span></button>
    <div class="section">Timed</div>
    <div class="tiles">${presets.timed.map((p, i) => `<button class="press" data-act="startp" data-arg="timed:${i}"><b class="num" style="color:var(--teal)">${p.durationSec / 60}</b><span>MIN</span></button>`).join('')}</div>
    <button class="custom-row press" data-act="custom" data-arg="timed" style="--c:var(--teal)">${icon('timer')}<span>Custom time</span>${icon('chevR', 'chev')}</button>
    <div class="section">Target</div>
    <div class="tiles">${presets.target.map((p, i) => `<button class="press" data-act="startp" data-arg="target:${i}"><b class="num" style="color:var(--pink)">${compact(p.targetJumps)}</b><span>JUMPS</span></button>`).join('')}</div>
    <button class="custom-row press" data-act="custom" data-arg="target" style="--c:var(--pink)">${icon('flag')}<span>Custom target</span>${icon('chevR', 'chev')}</button>
    <div class="section">Intervals</div>
    <div class="card" style="padding:0">${presets.intervals.map((p, i) => `<button class="wrow press" data-act="startp" data-arg="intervals:${i}">${badge('INTERVAL')}<div style="flex:1"><div style="font-weight:600">${p.title}</div><div class="small muted">${p.subtitle}</div></div>${icon('chevR', 'chev')}</button>`).join('')}</div>
  </div></div>`;
}

function renderHistory() {
  if (!sessions.length) {
    return `<div class="screen">${nav('History')}<div class="wrap"><div class="empty"><b>No workouts yet</b>Finish a workout and it shows up here, with your pace, streaks and calories.</div></div></div>`;
  }
  const r = ui.histRange;
  const now = Date.now();
  const span = { week: 7, month: 30, year: 365 }[r];
  const from = dayStart(now) - (span - 1) * DAY;
  const inRange = sessions.filter((s) => s.startedAt >= from);
  const t = totals(inRange);
  let buckets;
  if (r === 'year') {
    buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - 11 + i);
      const e = new Date(d); e.setMonth(e.getMonth() + 1);
      return { l: d.toLocaleDateString('en-US', { month: 'narrow' }), v: sessions.filter((s) => s.startedAt >= d && s.startedAt < e).reduce((a, s) => a + s.jumps, 0) };
    });
  } else {
    buckets = daily(span).map((d, i) => ({ l: r === 'week' ? new Date(d.day).toLocaleDateString('en-US', { weekday: 'narrow' }) : (i % 5 === 0 ? new Date(d.day).getDate() : ''), v: d.jumps }));
  }
  const max = Math.max(...buckets.map((b) => b.v), 1);
  const groups = {};
  sessions.forEach((s) => {
    const k = new Date(s.startedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    (groups[k] ||= []).push(s);
  });
  return `<div class="screen">${nav('History')}<div class="wrap">
    <div class="seg" style="margin-top:4px">${['week', 'month', 'year'].map((k) => `<button data-act="range" data-arg="${k}" class="${r === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="card" style="margin-top:14px">
      <div class="grid2" style="grid-template-columns:repeat(4,1fr)">
        ${[['Jumps', fmt(t.jumps), 'var(--pink)'], ['Minutes', fmt(t.minutes), 'var(--accent)'], ['Calories', fmt(t.calories), 'var(--teal)'], ['Workouts', t.count, 'var(--orange)']].map(([l, v, c]) => `<div style="border:0;padding:4px 0"><div class="small muted" style="font-weight:600">${l}</div><div class="num" style="font-size:22px;font-weight:700;color:${c}">${v}</div></div>`).join('')}
      </div>
      <div class="bars" style="gap:${r === 'month' ? 3 : 8}px">${buckets.map((b) => `<div><i class="${b.v ? '' : 'zero'}" style="height:${Math.max(b.v / max * 100, 3)}%"></i><span>${b.l}</span></div>`).join('')}</div>
    </div>
    ${Object.entries(groups).map(([k, list]) => `<div class="section" style="font-size:20px">${k}</div><div class="card" style="padding:0">${list.map(workoutRow).join('')}</div>`).join('')}
  </div></div>`;
}

function stepRow(title, value, ic, color, act, last = false) {
  return `<div class="row-item"><div class="tile" style="background:${color}">${icon(ic)}</div><span class="title">${title}</span><span class="value num">${value}</span>
    <div class="stepper"><button data-hold="${act}" data-arg="-1">−</button><i></i><button data-hold="${act}" data-arg="1">+</button></div></div>`;
}
const seg = (opts, sel, act) => `<div class="seg">${opts.map((o, i) => `<button data-act="${act}" data-arg="${i}" class="${i === sel ? 'on' : ''}">${o}</button>`).join('')}</div>`;
const sw = (on, act) => `<button class="switch ${on ? 'on' : ''}" data-act="${act}" aria-pressed="${on}"></button>`;

function bodyRows() {
  return `<div class="group">
      <div class="row-item"><div class="tile" style="background:var(--blue)">${icon('units')}</div><span class="title">Units</span><div style="width:180px">${seg(['Metric', 'Imperial'], profile.imperial ? 1 : 0, 'units')}</div></div>
      ${stepRow('Height', units.height(profile.heightCm), 'ruler', 'var(--teal)', 'height')}
      ${stepRow('Weight', units.weight(profile.weightKg), 'scale', 'var(--orange)', 'weight')}
      ${stepRow('Age', profile.age, 'cake', 'var(--pink)', 'age')}
    </div>
    <div class="group" style="margin-top:12px"><div class="row-item"><div class="tile" style="background:var(--indigo)">${icon('sex')}</div><span class="title">Sex</span><div style="width:220px">${seg(['Not Set', 'Female', 'Male'], ['UNSET', 'FEMALE', 'MALE'].indexOf(profile.sex), 'sex')}</div></div></div>`;
}

function ropeNote() {
  if (profile.ropeLb <= 0.25) return 'Heavier cables are turned from the elbows and shoulders, not the wrists. FreeRope counts that extra arm work in your calories.';
  return `Heavier cables are turned from the elbows and shoulders, not the wrists. A ${E.ropeLabel(profile.ropeLb)} rope burns about ${Math.round(E.ropeExtra(profile.ropeLb, profile) * 100)}% more than a ¼ lb one for you.`;
}

function renderProfile() {
  const st = handle.state;
  return `<div class="screen">${nav('Profile')}<div class="wrap">
    <div class="group-header">Handle</div>
    <div class="group">
      <div class="row-item"><div class="tile" style="background:var(--blue)">${icon('bt')}</div><span class="title">${st === 'connected' ? esc(handle.name) : 'Crossrope AMP'}</span><span class="value">${st === 'connected' ? 'Connected' : st === 'connecting' ? 'Connecting…' : 'Not Connected'}</span></div>
      ${st === 'connected' ? `<button class="row-item plain" data-act="disconnect"><span class="title" style="color:var(--red)">Disconnect</span></button>` : `<button class="row-item plain" data-act="connect"><span class="title" style="color:var(--accent)">Connect Handle</span></button>`}
    </div>
    <div class="group-footer">FreeRope talks to your Crossrope AMP handle directly over Bluetooth. Shake the handle to wake it before connecting.</div>
    <div class="group-header">Daily Goals</div>
    <div class="group">
      ${stepRow('Jumps', fmt(profile.dailyGoal), 'goal', 'var(--pink)', 'goalJumps')}
      ${stepRow('Minutes', `${profile.minuteGoal} min`, 'timer', 'var(--accent)', 'goalMin')}
      ${stepRow('Calories', `${profile.calorieGoal} cal`, 'flame', 'var(--teal)', 'goalCal')}
    </div>
    <div class="group-header">Rope</div>
    <div class="group"><div style="padding:16px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px"><div class="tile" style="background:var(--orange)">${icon('rope')}</div><span style="flex:1">Rope Weight</span><span class="muted">${E.ropeLabel(profile.ropeLb)}</span></div>
      ${seg(E.ropeOptions.map(E.ropeLabel), E.ropeOptions.indexOf(profile.ropeLb), 'rope')}
    </div></div>
    <div class="group-footer">${ropeNote()}</div>
    <div class="group-header">Body</div>
    ${bodyRows()}
    <div class="group-footer">Height, weight, age and sex set your resting metabolism, which scales every calorie estimate.</div>
    <div class="group-header">Coaching</div>
    <div class="group">
      <div class="row-item"><div class="tile" style="background:var(--pink)">${icon('voice')}</div><span class="title">Voice Cues</span>${sw(profile.voice, 'voice')}</div>
      <div class="row-item"><div class="tile" style="background:var(--purple)">${icon('vibe')}</div><span class="title">Haptics</span>${sw(profile.haptics, 'haptics')}</div>
    </div>
    <div class="group" style="margin-top:22px"><div class="row-item"><div class="tile" style="background:var(--indigo)">${icon('flask')}</div><span class="title">Demo Handle</span>${sw(handle.demo, 'demo')}</div></div>
    <div class="group-footer">Simulates a handle so you can try workouts without a rope.</div>
    <div class="group" style="margin-top:22px"><a class="row-item" href="${DONATE}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="tile" style="background:var(--pink)">${icon('heart')}</div><span class="title">Support FreeRope</span><span class="value">PayPal</span></a></div>
    <div class="group-footer">FreeRope costs nothing. Tips pay for the App Store ($99/year) and Play Store ($25) so it can be published properly and keep improving.</div>
    <p class="center small muted" style="margin-top:28px;line-height:1.5">FreeRope for Web 1.5<br>Works with Crossrope AMP handles. Not affiliated with Crossrope.<br>Your workouts are stored only in this browser.</p>
  </div></div>`;
}

// ---------------------------------------------------------------- detail / summary

function renderDetail() {
  const v = ui.view;
  const s = v.type === 'summary' ? v.session : sessions.find((x) => x.id === v.id);
  if (!s) { ui.view = null; return renderSummary(); }
  const end = s.startedAt + s.durationSec * 1000;
  const m = paceModel(s.pace);
  const g = (l, val, u, c) => `<div class="metric"><div class="label">${l}</div><div class="val num" style="color:${c}">${val}${u ? `<small>${u}</small>` : ''}</div></div>`;
  const top = v.type === 'summary'
    ? `<div class="nav"><div class="wrap"><div class="row"><span></span><button class="back" data-act="done" style="font-weight:600">Done</button></div></div></div>`
    : `<div class="nav"><div class="wrap"><div class="row"><button class="back" data-act="back">${icon('chevL').replace('<svg', '<svg style="width:22px;height:22px"')}History</button><button data-act="delete" style="color:var(--red)">${icon('trash').replace('<svg', '<svg style="width:22px;height:22px"')}</button></div></div></div>`;
  return `<div class="screen no-tabs">${top}<div class="wrap">
    <div class="head">${badge(s.mode)}<div><h1>${esc(s.title)}</h1><div class="muted">${dayLabel(s.startedAt)} · ${timeLabel(s.startedAt)} – ${timeLabel(end)}</div></div></div>
    ${v.type === 'summary' && v.demo ? '<div class="banner">Demo workout · not saved to your history</div>' : ''}
    ${(v.newBests || []).map((b) => `<div class="newbest">${icon('star').replace('<svg', '<svg style="width:18px;height:18px"')} New personal best · ${b}</div>`).join('')}
    <div class="section">Workout Details</div>
    <div class="card"><div class="grid2">
      ${g('Workout Time', clock(s.durationSec), '', 'var(--yellow)')}${g('Jumps', fmt(s.jumps), '', 'var(--accent)')}
      ${g('Overall Pace', s.avgJpm, 'JPM', 'var(--teal)')}${g('Peak Pace', s.maxJpm, 'JPM', 'var(--teal)')}
      ${g('Best Streak', fmt(s.bestStreak), '', 'var(--pink)')}${g('Misses', s.misses, '', 'var(--orange)')}
      ${g('Active Calories', s.calories, 'CAL', 'var(--pink)')}${g('Rope', E.ropeLabel(s.ropeLb).replace(' lb', ''), 'LB', 'var(--orange)')}
    </div></div>
    ${s.pace.length >= 2 ? `<div class="section">Pace</div>
    <div class="card"><div class="pace-stats">
      <div><div class="k">AVG. PACE</div><div class="v num">${m.avg} <small>JPM</small></div></div>
      <div><div class="k">PEAK</div><div class="v num">${m.peak} <small>JPM</small></div></div>
      <div><div class="k">RESTS</div><div class="v num">${clock(m.restSec)}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="k">AT</div><div class="v num" id="scrubVal">–</div></div></div>
      <div class="chart" data-pace="${s.id}"></div>
      <div class="small muted" style="margin-top:8px">Average excludes rests (shaded). Drag across the chart to see your pace at any moment.</div></div>` : ''}
    <div class="section">In Perspective</div>
    ${equivalents(s)}
  </div></div>`;
}

function equivalents(s) {
  const tab = ui.compareTab;
  const header = `<div class="small muted" style="margin-bottom:12px">${fmt(s.calories)} active calories · ≈ ${Math.round(s.calories / E.KCAL_PER_G_FAT)} g of body fat's worth of energy</div>
    ${seg(['Activities', 'Food'], tab === 'food' ? 1 : 0, 'compare')}`;
  if (tab !== 'food') {
    const mine = s.activeSec / 60;
    const rows = E.activities.map((a) => ({ a, min: E.minutesFor(s.calories, a, profile) }));
    const max = Math.max(mine, ...rows.map((r) => r.min));
    const colors = ['var(--orange)', 'var(--teal)', 'var(--blue)', 'var(--purple)'];
    return `<div class="card">${header}<div class="small muted" style="margin:14px 0 2px;font-weight:600">TIME TO BURN THE SAME ENERGY</div>
      <div class="compare"><div class="tile dark" style="background:var(--accent)">${icon('rope')}</div><div style="flex:1"><div style="display:flex;justify-content:space-between"><b>Your jump rope</b><b class="num" style="color:var(--accent)">${dur(mine)}</b></div><div class="bar"><i style="width:${mine / max * 100}%;background:var(--accent)"></i></div></div></div>
      ${rows.map((r, i) => `<div class="compare"><div class="tile" style="background:${colors[i]}">${icon(r.a.icon)}</div><div style="flex:1"><div style="display:flex;justify-content:space-between"><span>${r.a.name}</span><span class="num muted">${dur(r.min)}</span></div><div class="bar"><i style="width:${r.min / max * 100}%;background:${colors[i]}"></i></div></div></div>`).join('')}
      <div class="small muted" style="margin-top:8px">At running 10 km/h, cycling 20 km/h, swimming laps and brisk walking, for your body.</div></div>`;
  }
  const f = E.foods[ui.food];
  const e = E.earned(f, s.calories, s.jumps, s.activeSec / 60, s.avgJpm);
  return `<div class="card">${header}
    <div class="earned" style="margin-top:16px"><div class="small muted" style="font-weight:600">YOU EARNED BACK</div>
      <div><span class="n num">${e.servings.toFixed(1)}</span> <b>${e.servings >= 0.95 && e.servings < 1.05 ? f.name : f.plural}</b></div>
      <div class="foot muted">Eat this much and you're back to even.</div>
      <div style="font-size:28px;margin-top:8px;letter-spacing:4px">${f.emoji.repeat(Math.min(Math.max(Math.round(e.servings), 1), 8))}</div></div>
    <div style="background:var(--grouped2);border-radius:12px;padding:12px;margin-top:12px"><div class="small muted">To burn off one ${f.name}</div><b class="num">${fmt(e.jumpsToBurnOne)} jumps · ${Math.round(e.minutesToBurnOne)} min</b></div>
    <div class="foods">${E.foods.map((x, i) => `<button class="${i === ui.food ? 'on' : ''}" data-act="food" data-arg="${i}"><span>${x.emoji}</span>${x.short}</button>`).join('')}</div>
    <div class="small muted" style="margin-top:10px">Includes ${e.epoc} cal of afterburn, and the ${e.digest} cal your body spends digesting each ${f.name}.</div></div>`;
}

function bindCharts() {
  const el = app.querySelector('.chart[data-pace]');
  if (!el) return;
  const s = (ui.view.type === 'summary' ? ui.view.session : sessions.find((x) => String(x.id) === el.dataset.pace));
  const w = el.clientWidth || 340, h = 200;
  const { svg, geom, m } = paceChartSVG(s.pace, w, h);
  el.innerHTML = svg;
  const out = document.getElementById('scrubVal');
  const g = el.querySelector('.scrub');
  const move = (ev) => {
    const r = el.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.round((px - geom.left) / (geom.right - geom.left) * (geom.n - 1));
    if (i < 0 || i >= geom.n) return;
    g.style.display = '';
    const xx = geom.x(i);
    g.querySelector('line').setAttribute('x1', xx); g.querySelector('line').setAttribute('x2', xx);
    const v = m.smooth[i];
    const c = g.querySelector('circle');
    c.style.display = v == null ? 'none' : '';
    if (v != null) { c.setAttribute('cx', xx); c.setAttribute('cy', geom.y(v)); }
    out.innerHTML = v == null ? `Rest <small>${clock(i * PACE_SEC)}</small>` : `${Math.round(v)} <small>@ ${clock(i * PACE_SEC)}</small>`;
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerdown', move);
  el.addEventListener('touchmove', move, { passive: true });
}

// ================================================================= onboarding

let obPage = 0;
function renderOnboarding() {
  const pages = [
    () => `<div class="center"><img src="icon.svg" alt="" style="width:120px;height:120px;border-radius:28px"></div>
      <h1>Welcome to FreeRope</h1><p class="lead">A jump counter for Crossrope AMP handles.</p>
      <div class="feature"><div class="tile" style="background:var(--blue)">${icon('bt')}</div><div><b>Live jump count</b><span>Connects straight to your handle. No account needed.</span></div></div>
      <div class="feature"><div class="tile" style="background:var(--orange)">${icon('flame')}</div><div><b>Honest calories</b><span>Based on jump rope research, your body and your rope's weight.</span></div></div>
      <div class="feature"><div class="tile dark" style="background:var(--accent)">${icon('chart')}</div><div><b>Pace, streaks & history</b><span>Every workout charted. Your data stays on your device.</span></div></div>
      <p class="center small muted" style="margin-top:24px">Not affiliated with Crossrope.</p>`,
    () => `<h1>About You</h1><p class="lead">Your size, age and sex set how many calories you burn at rest and while jumping.</p>
      <div class="wrap">${bodyRows()}<div class="group-footer">Hold + or − to change faster. You can edit all of this later in Profile.</div></div>`,
    () => `<h1>Your Rope</h1><p class="lead">Heavier cables are turned from the elbows and shoulders, so they burn more. Pick the one you use most.</p>
      <div class="wrap">${seg(E.ropeOptions.map(E.ropeLabel), E.ropeOptions.indexOf(profile.ropeLb), 'rope')}
      <p class="center foot muted" style="margin-top:16px">${profile.ropeLb <= 0.25 ? 'The lightest rope: the baseline every other weight is compared to.' : `About ${Math.round(E.ropeExtra(profile.ropeLb, profile) * 100)}% more calories than a ¼ lb rope for you.`}<br>You can switch rope before every workout.</p></div>`,
  ];
  const label = ['Get Started', 'Continue', 'Start Jumping'][obPage];
  const keepScroll = app.querySelector('.ob .body')?.scrollTop || 0;
  const same = app.querySelector('.ob')?.dataset.page === String(obPage);
  app.innerHTML = `<div class="ob" data-page="${obPage}"><div class="body"><div class="${same ? '' : 'fade-in'}" style="max-width:560px;margin:0 auto">${pages[obPage]()}</div></div>
    <div class="bottom"><div class="dots">${[0, 1, 2].map((i) => `<i class="${i === obPage ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn press" data-act="obNext">${label}</button>
      ${obPage ? '<button class="center muted" style="display:block;margin:12px auto 0;padding:6px 12px" data-act="obBack">Back</button>' : ''}</div></div>`;
  if (same) app.querySelector('.ob .body').scrollTop = keepScroll;
}

// ================================================================= sheets

function openSheet(html, onBind) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="grabber"></div>${html}`;
  document.body.append(scrim, sheet);
  scrim.addEventListener('click', () => closeSheet());
  requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
  onBind?.(sheet);
  return sheet;
}
function closeSheet(instant = false) {
  document.querySelectorAll('.sheet, .scrim').forEach((el) => {
    if (instant) return el.remove();
    el.classList.remove('show');
    setTimeout(() => el.remove(), 380);
  });
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
}

function showNoBluetooth() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  openSheet(`<h3>Bluetooth isn't available here</h3>
    <p class="sub">${ios ? 'Safari on iPhone can’t talk to Bluetooth devices. Open FreeRope in <b>Bluefy</b>, a free browser that can.' : 'This browser can’t talk to Bluetooth devices. Open FreeRope in <b>Google Chrome</b>.'}</p>
    ${ios ? `<a class="btn press" style="text-decoration:none" href="bluefy://open?url=${encodeURI(location.origin + location.pathname)}">Open in Bluefy</a>
    <a class="btn gray press" style="text-decoration:none;margin-top:10px" href="https://apps.apple.com/app/id1492822055" target="_blank" rel="noopener">Get Bluefy (free)</a>
    <p class="center small muted" style="margin:12px 0 0">Already in Safari with the beacio extension? Turn it on for this site and reload.</p>` : ''}
    <button class="btn gray press" style="margin-top:12px" data-sheet="demo">Try the Demo Instead</button>`, (sh) => {
    sh.querySelector('[data-sheet="demo"]').onclick = () => { handle.startDemo(); closeSheet(); toast('Demo handle connected'); };
  });
}

async function connectHandle() {
  if (!bluetoothAvailable()) { showNoBluetooth(); return false; }
  try {
    await handle.connect();
    toast(`Connected to ${handle.name}`);
    return true;
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast('Couldn’t connect. Shake the handle to wake it and try again.');
    render();
    return false;
  }
}

function preStart(plan) {
  let rope = profile.ropeLb;
  let ring = plan.mode === 'TARGET' ? plan.targetJumps : 100;
  const connected = () => handle.state === 'connected';
  const body = () => `<h3>Ready?</h3><div class="sub">${esc(plan.title)} · ${esc(plan.subtitle || '')}</div>
    <div class="label">Rope</div>${seg(E.ropeOptions.map(E.ropeLabel), E.ropeOptions.indexOf(rope), 'psRope')}
    <div class="small muted" style="margin:8px 4px 0">${rope === profile.ropeLb ? 'Your profile rope. Change it here for this workout only.' : 'For this workout only.'}</div>
    ${plan.mode === 'TARGET' ? '' : `<div class="label">Ring</div><div style="display:flex;align-items:center;gap:14px"><div class="num" style="font-size:28px;font-weight:700;flex:1">${fmt(ring)} <small class="muted" style="font-size:15px">jumps per lap</small></div>
      <div class="stepper"><button data-ps="-">−</button><i></i><button data-ps="+">+</button></div></div>
      <div class="chips" style="margin-top:12px">${[50, 100, 200, 500, 1000].map((n) => `<button data-ring="${n}" class="${n === ring ? 'on' : ''}">${fmt(n)}</button>`).join('')}</div>`}
    <button class="btn press" style="margin-top:24px" data-go>${icon('play')}${connected() ? 'Start' : 'Connect & Start'}</button>`;
  const sheet = openSheet('<div class="ps"></div>');
  const box = sheet.querySelector('.ps');
  const draw = () => { box.innerHTML = body(); };
  draw();
  box.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'psRope') { rope = E.ropeOptions[+t.dataset.arg]; draw(); }
    else if (t.dataset.ring) { ring = +t.dataset.ring; draw(); }
    else if (t.dataset.ps) { ring = Math.min(5000, Math.max(10, ring + (t.dataset.ps === '+' ? (ring >= 200 ? 50 : 10) : -(ring > 200 ? 50 : 10)))); draw(); }
    else if (t.hasAttribute('data-go')) {
      if (!connected() && !(await connectHandle())) return;
      closeSheet();
      startWorkout({ ...plan, ropeLb: rope, ringJumps: ring });
    }
  });
}

/** Pick any duration or jump target: big number, slider, and +/- that repeat while held. */
function customSheet(kind) {
  const timed = kind === 'timed';
  let v = timed ? 8 : 750;
  const min = timed ? 1 : 50, max = timed ? 120 : 20000, step = timed ? 1 : 50;
  const color = timed ? 'var(--teal)' : 'var(--pink)';
  const label = () => timed ? `${v}` : fmt(v);
  const sheet = openSheet(`<h3>${timed ? 'Custom Time' : 'Custom Target'}</h3><div class="sub">${timed ? 'Jump until the timer runs out.' : 'The workout ends when you hit it.'}</div>
    <div class="center"><span class="num cv" style="font-size:72px;font-weight:800;letter-spacing:-2px">${label()}</span> <b style="color:${color};font-size:20px">${timed ? 'MIN' : 'JUMPS'}</b></div>
    <input class="cs" type="range" min="${min}" max="${timed ? 60 : 10000}" step="${step}" value="${v}" style="width:100%;accent-color:${color};margin:18px 0 14px">
    <div style="display:flex;justify-content:center"><div class="stepper"><button data-cs="-1">−</button><i></i><button data-cs="1">+</button></div></div>
    <button class="btn press" style="margin-top:24px" data-cgo>${icon('play')}Continue</button>`);
  const out = sheet.querySelector('.cv'), range = sheet.querySelector('.cs');
  const set = (n) => { v = Math.min(max, Math.max(min, n)); out.textContent = label(); range.value = Math.min(v, +range.max); };
  range.addEventListener('input', () => set(+range.value));
  let timer = null;
  sheet.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-cs]');
    if (!b) return;
    e.preventDefault();
    const d = +b.dataset.cs * step;
    set(v + d);
    let gap = 120;
    const again = () => { set(v + d); gap = Math.max(gap - 8, 30); timer = setTimeout(again, gap); };
    timer = setTimeout(again, 400);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => sheet.addEventListener(t, () => clearTimeout(timer)));
  sheet.querySelector('[data-cgo]').addEventListener('click', () => {
    const plan = timed
      ? { mode: 'TIMED', title: `${v} min`, subtitle: 'Custom time', durationSec: v * 60 }
      : { mode: 'TARGET', title: `${fmt(v)} jumps`, subtitle: 'Custom target', targetJumps: v };
    closeSheet(true);
    preStart(plan);
  });
}

// ================================================================= live

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch { /* already released */ } wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (engine.s && document.visibilityState === 'visible') keepAwake(); });

let liveEl = null;
let lastTick = 0;
function startWorkout(plan) {
  keepAwake();
  // Unlock speech on iOS: it only speaks after a user gesture has spoken once.
  if (profile.voice && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  liveEl = document.createElement('div');
  liveEl.className = 'live';
  document.body.append(liveEl);
  lastTick = 0;
  engine.start(plan);
}
function closeLive() {
  liveEl?.remove();
  liveEl = null;
  document.querySelector('.countdown')?.remove();
}

engine.addEventListener('change', () => {
  const s = engine.s;
  if (!s || !liveEl) return;
  if (s.phase === 'COUNTDOWN') {
    let cd = document.querySelector('.countdown');
    if (!cd) { cd = document.createElement('div'); cd.className = 'countdown num'; document.body.append(cd); }
    if (cd.dataset.n !== String(s.countdown)) { cd.dataset.n = s.countdown; cd.innerHTML = `<span>${s.countdown}</span>`; }
    return;
  }
  document.querySelector('.countdown')?.remove();
  if (!liveEl.dataset.built) buildLive(s);
  updateLive(s);
});

function buildLive(s) {
  liveEl.dataset.built = '1';
  liveEl.innerHTML = `<div class="top"><span class="title">${esc(s.plan.title)}</span><span class="conn"><span class="dot"></span><span class="connText"></span></span></div>
    <div class="banner dropBanner" style="display:none">Handle disconnected · reconnecting…</div>
    <div class="ring-wrap"><div class="ringSvg" style="width:100%;height:100%"></div>
      <div class="ring-center"><div class="phase-chip"></div><div class="big num"></div><div class="ring-sub"></div></div></div>
    <div class="live-stats"><div><b class="num l-time"></b><span class="l-time-label"></span></div><div><b class="num l-jpm"></b><span>JPM</span></div><div><b class="num l-cal"></b><span>CAL</span></div></div>
    <svg class="spark" viewBox="0 0 300 52" preserveAspectRatio="none"><path class="sparkPath" fill="none" stroke="#a6ff00" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>
    <div class="controls"><button class="btn gray press" data-live="pause"></button><button class="btn red press" data-live="finish">${icon('stop')}Finish</button></div>`;
  liveEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-live]');
    if (!b) return;
    if (b.dataset.live === 'pause') engine.togglePause();
    else if (b.dataset.live === 'finish') {
      if (engine.s && engine.s.jumps === 0) { engine.discard(); releaseWakeLock(); closeLive(); render(); }
      else engine.finish();
    }
  });
}

function updateLive(s) {
  const q = (c) => liveEl.querySelector(c);
  const rest = s.phase === 'REST', paused = s.phase === 'PAUSED';
  const p = engine.progress();
  const colors = rest ? ['#00c3f0', '#6af5ff'] : s.plan.mode === 'TARGET' ? ['#fa114f', '#ff5a8c'] : ['#7be000', '#c8ff4a'];
  const size = 300;
  q('.ringSvg').innerHTML = ringsSVG([[p, colors[0], colors[1]]], size, 0.1).replace(`width="${size}" height="${size}"`, 'width="100%" height="100%"');
  const chip = q('.phase-chip');
  chip.textContent = paused ? 'PAUSED' : rest ? 'REST' : s.plan.mode === 'INTERVAL' ? `ROUND ${s.round} / ${s.plan.rounds}` : 'JUMPING';
  chip.style.background = paused ? 'rgba(255,214,10,.16)' : rest ? 'rgba(100,210,255,.16)' : 'rgba(166,255,0,.14)';
  chip.style.color = paused ? 'var(--yellow)' : rest ? 'var(--teal)' : 'var(--accent)';
  const big = q('.big');
  const left = Math.ceil(s.phaseLeftMs / 1000);
  big.textContent = rest ? clock(left) : fmt(s.jumps);
  if (s.tick !== lastTick) { lastTick = s.tick; big.classList.remove('bump'); void big.offsetWidth; big.classList.add('bump'); }
  let sub;
  if (rest) sub = `Next: round ${s.round + 1}`;
  else if (s.plan.mode === 'TARGET') sub = `${fmt(Math.max(s.plan.targetJumps - s.jumps, 0))} to go`;
  else {
    const lap = s.plan.ringJumps;
    sub = `Ring ${Math.floor(s.jumps / lap) + 1} · ${fmt(lap - (s.jumps % lap))} to go`;
  }
  q('.ring-sub').textContent = sub;
  const timed = s.plan.mode === 'TIMED' || s.plan.mode === 'INTERVAL';
  q('.l-time').textContent = timed && !paused ? clock(Math.max(left, 0)) : clock(s.elapsedMs / 1000);
  q('.l-time-label').textContent = timed ? 'LEFT' : 'TIME';
  q('.l-jpm').textContent = s.jpm;
  q('.l-cal').textContent = Math.floor(s.calories);
  q('[data-live="pause"]').innerHTML = paused ? `${icon('play')}Resume` : `${icon('pause')}Pause`;
  const pace = s.pace.slice(-60);
  if (pace.length > 1) {
    const max = Math.max(...pace, 60), min = Math.min(...pace.filter((v) => v > 0), max) - 10;
    q('.sparkPath').setAttribute('d', pace.map((v, i) => `${i ? 'L' : 'M'}${(i / (pace.length - 1) * 300).toFixed(1)},${(50 - Math.max(v - min, 0) / Math.max(max - min, 1) * 46).toFixed(1)}`).join(''));
  }
  const on = handle.state === 'connected';
  q('.conn .dot').className = `dot ${on ? 'on' : 'wait'}`;
  q('.connText').textContent = on ? (handle.demo ? 'Demo' : 'Connected') : 'Reconnecting';
  q('.dropBanner').style.display = on ? 'none' : '';
}

// ================================================================= input

const holdActs = {
  height: (d) => updateProfile({ heightCm: units.stepHeight(profile.heightCm, d) }),
  weight: (d) => updateProfile({ weightKg: units.stepWeight(profile.weightKg, d) }),
  age: (d) => updateProfile({ age: Math.min(100, Math.max(10, profile.age + d)) }),
  goalJumps: (d) => updateProfile({ dailyGoal: Math.min(50000, Math.max(100, profile.dailyGoal + d * 100)) }),
  goalMin: (d) => updateProfile({ minuteGoal: Math.min(240, Math.max(1, profile.minuteGoal + d)) }),
  goalCal: (d) => updateProfile({ calorieGoal: Math.min(2000, Math.max(10, profile.calorieGoal + d * 10)) }),
};

// Steppers: tap steps once, holding repeats and speeds up.
let holdTimer = null;
app.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-hold]');
  if (!b) return;
  e.preventDefault();
  const act = holdActs[b.dataset.hold], d = +b.dataset.arg;
  act(d);
  cues.buzz(5);
  let gap = 120;
  const again = () => { act(d); gap = Math.max(gap - 8, 40); holdTimer = setTimeout(again, gap); };
  holdTimer = setTimeout(again, 400);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => window.addEventListener(t, () => { clearTimeout(holdTimer); holdTimer = null; }));

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, arg = b.dataset.arg;
  switch (a) {
    case 'tab': ui.tab = arg; ui.view = null; render(); app.querySelector('.screen')?.scrollTo(0, 0); break;
    case 'connect': connectHandle(); break;
    case 'disconnect': handle.disconnect(); render(); break;
    case 'start': preStart(presets.free); break;
    case 'startq': preStart([presets.timed[2], presets.target[2], presets.intervals[0], presets.timed[3]][+arg]); break;
    case 'startp': { const [k, i] = arg.split(':'); preStart(presets[k][+i]); break; }
    case 'custom': customSheet(arg); break;
    case 'open': ui.view = { type: 'detail', id: +arg }; render(); app.querySelector('.screen')?.scrollTo(0, 0); break;
    case 'back': ui.view = null; render(); break;
    case 'done': ui.view = null; ui.tab = 'summary'; render(); break;
    case 'delete':
      if (confirm('Delete this workout? This can’t be undone.')) {
        sessions = sessions.filter((s) => s.id !== ui.view.id); saveSessions(); ui.view = null; render();
      }
      break;
    case 'range': ui.histRange = arg; render(); break;
    case 'compare': ui.compareTab = +arg ? 'food' : 'activities'; render(); break;
    case 'food': ui.food = +arg; render(); break;
    case 'units': updateProfile({ imperial: arg === '1' }); break;
    case 'sex': updateProfile({ sex: ['UNSET', 'FEMALE', 'MALE'][+arg] }); break;
    case 'rope': updateProfile({ ropeLb: E.ropeOptions[+arg] }); break;
    case 'voice': updateProfile({ voice: !profile.voice }); break;
    case 'haptics': updateProfile({ haptics: !profile.haptics }); break;
    case 'demo': if (handle.demo) handle.stopDemo(); else { if (handle.state === 'connected') handle.disconnect(); handle.startDemo(); } render(); break;
    case 'obNext': if (obPage < 2) { obPage++; renderOnboarding(); } else updateProfile({ onboarded: true }); break;
    case 'obBack': obPage--; renderOnboarding(); break;
    default: break;
  }
});

window.addEventListener('resize', () => { if (app.querySelector('.chart')) bindCharts(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
