// FreeRope for the web: the Android app's screens rebuilt in plain JS, no build step.
import * as E from './energy.js';
import { Handle, bluetoothAvailable } from './handle.js';
import { Engine, presets } from './engine.js';
import { Account, accountsEnabled, suggestName, validName, friendlyError } from './account.js';

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
  xmark: '<path d="M6 6l12 12M18 6L6 18"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.2-9C1.5 8 3.6 4.5 7 4.5c2.1 0 3.5 1.2 5 3 1.5-1.8 2.9-3 5-3 3.4 0 5.5 3.5 4.2 7-1.7 4.4-9.2 9-9.2 9z" fill="currentColor" stroke="none"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20.5h7M10 17h4l.5 3.5h-5z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  apple: '<path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" fill="currentColor" stroke="none"/>',
};
// Google's "G", in its own colours (their branding guidelines ask for it unaltered).
const GOOGLE_G = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';
// Set by the iOS app's bridge (ios/FreeRope/bridge.js); Apple doesn't allow PayPal tips in apps.
const NATIVE = window.FREEROPE_NATIVE || null;
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
const account = new Account();
// Leaderboard filters and a short cache, so flipping between tabs doesn't refetch every time.
// One global board: no countries.
const lb = { period: 'day', metric: 'jumps', rows: null, key: '', at: 0, loading: false, error: null, cache: {} };

handle.addEventListener('change', () => { if (!engine.s) render(); });
account.addEventListener('change', () => { if (!engine.s) render(); });
account.addEventListener('ready', () => syncNow());
window.addEventListener('online', () => syncNow());

/** Uploads any workouts the account hasn't seen yet; quiet unless asked, since it runs in the background. */
async function syncNow(announce = false) {
  try {
    const n = await account.sync(sessions);
    if (n) { lb.cache = {}; if (announce) toast(`${n} workout${n === 1 ? '' : 's'} added to the leaderboard`); }
    return n;
  } catch {
    return 0; // offline or the server said no: try again next time
  }
}

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
  if (s.jumps > 0 && !handle.demo && account.state === 'ready') showTodayRank(s);
});

/** After a workout: upload it, then tell the jumper where it puts them today. */
async function showTodayRank(s) {
  await syncNow();
  try {
    const rows = await account.leaderboard({ period: 'day', metric: 'jumps', limit: 3 });
    const me = rows.find((r) => r.is_me);
    if (me && ui.view?.type === 'summary' && ui.view.session === s) { ui.view.rank = me; render(); }
  } catch { /* offline: the summary is complete without it */ }
}

// ================================================================= render

function render() {
  if (!profile.onboarded) return renderOnboarding();
  let html;
  if (ui.view?.type === 'detail' || ui.view?.type === 'summary') html = renderDetail();
  else html = { summary: renderSummary, workouts: renderWorkouts, history: renderHistory, leaders: renderLeaders, profile: renderProfile }[ui.tab]();
  const scroller = app.querySelector('.screen');
  const keep = scroller && scroller.dataset.key === screenKey() ? scroller.scrollTop : 0;
  app.innerHTML = html + (ui.view ? '' : tabbar());
  const next = app.querySelector('.screen');
  if (next) { next.dataset.key = screenKey(); next.scrollTop = keep; }
  bindCharts();
}
const screenKey = () => ui.view ? `${ui.view.type}:${ui.view.session?.id}` : ui.tab;

function tabbar() {
  const t = [['summary', 'rings', 'Summary'], ['workouts', 'dumbbell', 'Workouts'], ['history', 'calendar', 'History'],
    ...(accountsEnabled ? [['leaders', 'trophy', 'Leaderboard']] : []), ['profile', 'person', 'Profile']];
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
    ${accountGroup()}
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
    <div class="group" style="margin-top:22px"><button class="row-item" data-act="feedback"><div class="tile" style="background:var(--teal)">${icon('chat')}</div><span class="title">Send Feedback</span>${icon('chevR', 'chev')}</button></div>
    <div class="group-footer">Bugs, ideas, a jump count that looked off: it all goes straight to Ramón.</div>
    ${NATIVE ? '' : `<div class="group" style="margin-top:22px"><a class="row-item" href="${DONATE}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="tile" style="background:var(--pink)">${icon('heart')}</div><span class="title">Support FreeRope</span><span class="value">PayPal</span></a></div>
    <div class="group-footer">FreeRope costs nothing. Tips pay for the App Store ($99/year) and Play Store ($25) so it can be published properly and keep improving.</div>`}
    <p class="center small muted" style="margin-top:28px;line-height:1.5">FreeRope ${NATIVE ? 'for iPhone' : 'for Web'} 1.5<br>Works with Crossrope AMP handles. Not affiliated with Crossrope.<br>${account.state === 'ready' ? 'Your workouts are saved on this device and summarised to your account for the leaderboard.' : `Your workouts are stored only ${NATIVE ? 'on this phone' : 'in this browser'}.`}</p>
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
    ${v.type === 'summary' && !v.demo ? rankCard(v) : ''}
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

// ================================================================= leaderboard

const METRICS = {
  jumps: { label: 'Jumps', unit: 'jumps', color: 'var(--accent)' },
  minute: { label: 'Best Minute', unit: 'in 1 min', color: 'var(--teal)' },
  streak: { label: 'Longest Streak', unit: 'in a row', color: 'var(--pink)' },
};
const PERIODS = [['day', 'Today'], ['week', 'This Week'], ['all', 'All Time']];
const MEDALS = ['#ffd60a', '#d1d1d6', '#ff9f0a'];

/** A coloured circle with the first letter, the same colour for a name every time. */
function avatar(name, size = 40) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:hsl(${h} 55% 32%)">${esc(name[0].toUpperCase())}</span>`;
}

async function loadBoard(force = false) {
  if (!accountsEnabled) return;
  const key = `${lb.period}|${lb.metric}`;
  const hit = lb.cache[key];
  if (!force && hit && Date.now() - hit.at < 30000) { Object.assign(lb, { rows: hit.rows, key, error: null, loading: false }); return render(); }
  Object.assign(lb, { key, loading: true, error: null });
  if (lb.rows && lb.key !== key) lb.rows = null;
  render();
  try {
    const rows = await account.leaderboard({ period: lb.period, metric: lb.metric });
    lb.cache[key] = { rows, at: Date.now() };
    if (lb.key === key) Object.assign(lb, { rows, loading: false });
  } catch (e) {
    if (lb.key === key) Object.assign(lb, { loading: false, error: friendlyError(e) || 'Couldn’t load the leaderboard.' });
  }
  if (ui.tab === 'leaders' && !ui.view) render();
}

function renderLeaders() {
  const m = METRICS[lb.metric];
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const right = `<button class="iconbtn press" data-act="lbRefresh" aria-label="Refresh">${icon('refresh')}</button>`;
  const rows = lb.rows || [];
  const me = rows.find((r) => r.is_me);
  const top = rows.filter((r) => r.rank <= 3).slice(0, 3);
  const rest = rows.filter((r) => !top.includes(r));
  const when = { day: 'today', week: 'this week', all: 'yet' }[lb.period];

  let body;
  if (lb.loading && !lb.rows) body = `<div class="card lb-list">${'<div class="lb-row skel"><i></i><i></i><i></i></div>'.repeat(6)}</div>`;
  else if (lb.error) body = `<div class="empty"><b>Couldn’t load the leaderboard</b>${esc(lb.error)}<div style="margin-top:18px"><button class="btn gray press" data-act="lbRefresh">Try Again</button></div></div>`;
  else if (!rows.length) body = `<div class="empty"><div class="empty-icon">${icon('trophy')}</div><b>No jumps ${when}</b>The board is wide open. Finish a workout to take the top spot.
      <div style="margin-top:18px"><button class="btn press" data-act="start" data-arg="free">${icon('play')}Start Free Jump</button></div></div>`;
  else {
    const order = [top[1], top[0], top[2]].filter(Boolean);
    body = `<div class="podium ${top.length < 3 ? 'few' : ''}">${order.map((r) => `
        <button class="pod press ${r.is_me ? 'me' : ''} p${r.rank}" data-act="lbRow" data-arg="${r.user_id}">
          <div class="pod-av" style="--medal:${MEDALS[r.rank - 1]}">${avatar(r.username, r.rank === 1 ? 64 : 52)}<span class="medal num">${r.rank}</span></div>
          <div class="pod-name">${esc(r.username)}</div>
          <div class="pod-val num" style="color:${m.color}">${fmt(r.value)}</div><div class="pod-unit">${m.unit}</div>
        </button>`).join('')}</div>
      ${rest.length ? `<div class="card lb-list">${rest.map(boardRow).join('')}</div>` : ''}`;
  }

  return `<div class="screen lb-screen">${nav('Leaderboard', date, right)}<div class="wrap">
    ${joinCard()}
    <div class="seg" style="margin-top:4px">${PERIODS.map(([k, l]) => `<button data-act="lbPeriod" data-arg="${k}" class="${lb.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="lb-filters">
      <div class="chips">${Object.entries(METRICS).map(([k, x]) => `<button data-act="lbMetric" data-arg="${k}" class="${lb.metric === k ? 'on' : ''}">${x.label}</button>`).join('')}</div>
    </div>
    <div class="lb-body ${lb.loading ? 'busy' : ''}">${body}</div>
  </div></div>
  ${account.state === 'ready' && lb.rows ? `<div class="me-bar">${me
    ? `${avatar(me.username, 34)}<div style="flex:1;min-width:0"><b>You’re #${me.rank}</b><div class="small muted">${fmt(me.value)} ${m.unit} ${when === 'yet' ? 'all time' : when}</div></div><span class="num me-rank">#${me.rank}</span>`
    : `${avatar(account.profile.username, 34)}<div style="flex:1"><b>You’re not on this board yet</b><div class="small muted">Finish a workout ${lb.period === 'all' ? '' : when} to get on it.</div></div>`}</div>` : ''}`;
}

function boardRow(r) {
  const m = METRICS[lb.metric];
  return `<button class="lb-row press ${r.is_me ? 'me' : ''}" data-act="lbRow" data-arg="${r.user_id}">
    <span class="lb-rank num">${r.rank}</span>${avatar(r.username, 36)}
    <span class="lb-name">${esc(r.username)}${r.is_me ? ' <span class="you">You</span>' : ''}</span>
    <span class="lb-val num"><b style="color:${m.color}">${fmt(r.value)}</b><small>${m.unit}</small></span></button>`;
}

/** The invitation at the top of the board, until the jumper is on it. */
function joinCard() {
  if (account.state === 'signedOut') {
    return `<button class="join press" data-act="signin"><div class="join-icon">${icon('trophy')}</div>
      <div style="flex:1;text-align:left"><b>Get on the leaderboard</b><div class="small">Sign in to post your jumps and see where you rank. Takes 10 seconds.</div></div>${icon('chevR', 'chev')}</button>`;
  }
  if (account.state === 'needsName') {
    return `<button class="join press" data-act="editName"><div class="join-icon">${icon('person')}</div>
      <div style="flex:1;text-align:left"><b>Pick your leaderboard name</b><div class="small">One last step and you’re on the board.</div></div>${icon('chevR', 'chev')}</button>`;
  }
  return '';
}

/** On the workout summary: where this workout puts you today, or an invite to find out. */
function rankCard(v) {
  if (!accountsEnabled) return '';
  if (account.state === 'ready') {
    if (!v.rank) return '';
    return `<button class="rank-card press" data-act="tab" data-arg="leaders"><div class="join-icon">${icon('trophy')}</div>
      <div style="flex:1;text-align:left"><b>#${v.rank.rank} on today’s leaderboard</b><div class="small muted">${fmt(v.rank.value)} jumps today</div></div>${icon('chevR', 'chev')}</button>`;
  }
  if (account.state === 'signedOut') {
    return `<button class="rank-card press" data-act="signin"><div class="join-icon">${icon('trophy')}</div>
      <div style="flex:1;text-align:left"><b>See where you rank today</b><div class="small muted">Sign in to put this workout on the leaderboard.</div></div>${icon('chevR', 'chev')}</button>`;
  }
  return '';
}

function playerSheet(r) {
  if (!r) return;
  const m = METRICS[lb.metric];
  const canReport = account.state === 'ready' && !r.is_me;
  openSheet(`<div class="center" style="margin-top:8px">${avatar(r.username, 72)}</div>
    <h3>${esc(r.username)}</h3>
    <div class="sub">#${r.rank} ${PERIODS.find(([k]) => k === lb.period)[1].toLowerCase()}</div>
    <div class="card center" style="background:var(--grouped2)"><div class="num" style="font-size:40px;font-weight:800;color:${m.color}">${fmt(r.value)}</div><div class="muted">${m.unit} ${{ day: 'today', week: 'this week', all: 'all time' }[lb.period]}</div></div>
    ${canReport ? '<button class="btn red press" style="margin-top:16px" data-sheet="report">Report Name</button><p class="center small muted" style="margin:10px 0 0">Report names that are offensive or impersonate someone.</p>' : ''}`, (sh) => {
    sh.querySelector('[data-sheet="report"]')?.addEventListener('click', async () => {
      if (!confirm(`Report “${r.username}” as offensive or impersonating someone?`)) return;
      try { await account.report(r.user_id); closeSheet(); toast('Thanks. We’ll take a look.'); } catch (e) { toast(friendlyError(e) || 'Couldn’t send the report.'); }
    });
  });
}

// ================================================================= account

function accountGroup() {
  if (!accountsEnabled) return '';
  const s = account.state;
  if (s === 'loading') return `<div class="group-header">Account</div><div class="group"><div class="row-item"><span class="title muted">Loading…</span></div></div>`;
  if (s === 'signedOut') {
    return `<div class="group-header">Account</div>
      <div class="group"><button class="row-item" data-act="signin"><div class="tile" style="background:var(--yellow)">${icon('trophy').replace('<svg', '<svg style="color:#000"')}</div><span class="title">Sign In</span><span class="value">Join the leaderboard</span>${icon('chevR', 'chev')}</button></div>
      <div class="group-footer">Use Apple, Google or your email. Your workouts stay on this device either way; signing in adds a summary of each one to the leaderboard.</div>`;
  }
  if (s === 'needsName') {
    return `<div class="group-header">Account</div>
      <div class="group"><button class="row-item" data-act="editName"><div class="tile" style="background:var(--accent)">${icon('person').replace('<svg', '<svg style="color:#000"')}</div><span class="title">Pick Your Leaderboard Name</span>${icon('chevR', 'chev')}</button>
      <button class="row-item plain" data-act="signout"><span class="title" style="color:var(--red)">Sign Out</span></button></div>`;
  }
  const p = account.profile;
  const via = account.user?.app_metadata?.provider;
  const how = via === 'apple' ? 'Apple' : via === 'google' ? 'Google' : 'email';
  return `<div class="account-card">${avatar(p.username, 56)}<div style="flex:1;min-width:0"><div class="acct-name">${esc(p.username)}</div>
      <div class="small muted acct-sub">Signed in with ${how}${account.user?.email && !/privaterelay/.test(account.user.email) ? ` · ${esc(account.user.email)}` : ''}</div></div></div>
    <div class="group" style="margin-top:12px">
      <button class="row-item" data-act="editName"><div class="tile" style="background:var(--accent)">${icon('person').replace('<svg', '<svg style="color:#000"')}</div><span class="title">Username</span><span class="value">${esc(p.username)}</span>${icon('chevR', 'chev')}</button>
      <button class="row-item" data-act="tab" data-arg="leaders"><div class="tile" style="background:var(--yellow)">${icon('trophy').replace('<svg', '<svg style="color:#000"')}</div><span class="title">Leaderboard</span>${icon('chevR', 'chev')}</button>
    </div>
    <div class="group" style="margin-top:12px">
      <button class="row-item plain" data-act="signout"><span class="title" style="color:var(--accent)">Sign Out</span></button>
      <button class="row-item plain" data-act="deleteAccount"><span class="title" style="color:var(--red)">Delete Account</span></button>
    </div>
    <div class="group-footer">Your username and a summary of each workout (jumps, time, pace) are stored with your account for the leaderboard.</div>`;
}

/** One sheet for every way in: Apple, Google, or a 6-digit code by email. */
function signInSheet() {
  let step = 'pick', email = '', busy = false, error = '';
  const sheet = openSheet('<div class="auth"></div>');
  const box = sheet.querySelector('.auth');
  const draw = () => {
    if (step === 'pick') {
      box.innerHTML = `<div class="auth-hero">${icon('trophy')}</div>
        <h3>Join the leaderboard</h3>
        <div class="sub">Post your jumps, see where you rank today and race jumpers everywhere. Your workouts still stay on your phone.</div>
        <button class="abtn apple press" data-p="apple">${icon('apple')}Continue with Apple</button>
        <button class="abtn google press" data-p="google">${GOOGLE_G}Continue with Google</button>
        <button class="abtn email press" data-p="email">${icon('mail')}Continue with Email</button>
        ${error ? `<div class="auth-error">${esc(error)}</div>` : ''}
        <p class="center small muted" style="margin:16px 8px 0;line-height:1.4">No password needed. You can delete your account any time in Profile. <a href="../privacy.html" target="_blank" rel="noopener" style="color:var(--label2)">Privacy</a></p>`;
    } else if (step === 'email') {
      box.innerHTML = `<button class="back press" data-back>${icon('chevL').replace('<svg', '<svg style="width:20px;height:20px"')}Back</button>
        <h3>What’s your email?</h3><div class="sub">We’ll send you a 6-digit code. No password to remember.</div>
        <input class="field" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(email)}" autofocus>
        ${error ? `<div class="auth-error">${esc(error)}</div>` : ''}
        <button class="btn press" style="margin-top:16px" data-send ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send Code'}</button>`;
      const f = box.querySelector('input');
      f.focus();
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('[data-send]').click(); });
    } else {
      box.innerHTML = `<button class="back press" data-back>${icon('chevL').replace('<svg', '<svg style="width:20px;height:20px"')}Back</button>
        <h3>Check your email</h3><div class="sub">Enter the 6-digit code we sent to<br><b style="color:var(--label)">${esc(email)}</b></div>
        <input class="field code num" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" autofocus>
        ${error ? `<div class="auth-error">${esc(error)}</div>` : ''}
        <button class="btn press" style="margin-top:16px" data-verify ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Sign In'}</button>
        <button class="center muted small" style="display:block;margin:14px auto 0;padding:6px" data-resend>Didn’t get it? Send again</button>`;
      const f = box.querySelector('input');
      f.focus();
      // Six digits in (typed, pasted or filled from the email by the keyboard) signs in straight away.
      f.addEventListener('input', () => { f.value = f.value.replace(/\D/g, '').slice(0, 6); if (f.value.length === 6) box.querySelector('[data-verify]').click(); });
    }
  };
  const done = () => {
    closeSheet();
    if (account.state === 'needsName') setTimeout(nameSheet, 420);
    else { toast(`Welcome back, ${account.profile.username}`); syncNow(true); }
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    error = '';
    if (b.dataset.back !== undefined) { step = step === 'code' ? 'email' : 'pick'; return draw(); }
    if (b.dataset.p === 'email') { step = 'email'; return draw(); }
    if (b.dataset.p) {
      busy = true; b.classList.add('loading');
      try {
        if (!NATIVE) sessionStorage.setItem('freerope.afterSignIn', '1');
        await account.signInWith(b.dataset.p);
        if (NATIVE) { await waitForAccount(); done(); }
      } catch (err) {
        sessionStorage.removeItem('freerope.afterSignIn');
        error = friendlyError(err); busy = false; draw();
      }
      return;
    }
    if (b.dataset.send !== undefined || b.dataset.resend !== undefined) {
      if (step === 'email') email = box.querySelector('input').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { error = 'That doesn’t look like an email address.'; return draw(); }
      busy = true; draw();
      try { await account.sendCode(email); step = 'code'; if (b.dataset.resend !== undefined) toast('New code sent'); } catch (err) { error = friendlyError(err); }
      busy = false; return draw();
    }
    if (b.dataset.verify !== undefined) {
      const code = box.querySelector('input').value.trim();
      if (code.length !== 6) { error = 'Enter all 6 digits.'; return draw(); }
      busy = true; draw();
      try { await account.verifyCode(email, code); done(); } catch (err) { error = friendlyError(err); busy = false; draw(); }
    }
  });
  draw();
}

/** Waits for the profile lookup that follows a sign-in. */
function waitForAccount() {
  return new Promise((res) => {
    if (account.state === 'ready' || account.state === 'needsName') return res();
    const on = () => { if (account.state === 'ready' || account.state === 'needsName') { account.removeEventListener('change', on); res(); } };
    account.addEventListener('change', on);
  });
}

/** Choose (or change) the name shown on the leaderboard. */
function nameSheet() {
  if (account.state !== 'needsName' && account.state !== 'ready') return;
  const editing = account.state === 'ready';
  let name = editing ? account.profile.username : suggestName(account.user);
  let status = 'checking', busy = false, error = '', timer = null, seq = 0;
  const sheet = openSheet(`<div class="auth">
    <div class="center" style="margin-top:6px" data-av></div>
    <h3>${editing ? 'Your leaderboard name' : 'Pick your name'}</h3>
    <div class="sub">${editing ? 'Change how you appear to other jumpers.' : 'This is how other jumpers will see you on the leaderboard.'}</div>
    <div class="namefield"><span class="at">@</span><input class="field" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(name)}"><span class="nstatus"></span></div>
    <div class="nhint small"></div>
    <div class="auth-error" style="display:none"></div>
    <button class="btn press" style="margin-top:22px" data-save>${editing ? 'Save' : 'Join the Leaderboard'}</button></div>`);
  const input = sheet.querySelector('input');
  const paint = () => {
    sheet.querySelector('[data-av]').innerHTML = avatar(name || '?', 72);
    const st = sheet.querySelector('.nstatus'), hint = sheet.querySelector('.nhint');
    st.innerHTML = status === 'ok' ? icon('check') : status === 'taken' || status === 'invalid' ? icon('xmark') : '';
    st.className = `nstatus ${status}`;
    hint.textContent = { ok: 'Available', taken: 'Taken. Try another.', invalid: '3–20 letters, numbers, dots or underscores.', checking: 'Checking…' }[status] || '';
    hint.className = `nhint small ${status}`;
    const save = sheet.querySelector('[data-save]');
    save.disabled = busy || status !== 'ok';
    save.textContent = busy ? 'Saving…' : editing ? 'Save' : 'Join the Leaderboard';
    const err = sheet.querySelector('.auth-error');
    err.style.display = error ? '' : 'none'; err.textContent = error;
  };
  const check = () => {
    clearTimeout(timer);
    if (!validName(name)) { status = 'invalid'; return paint(); }
    if (editing && name.toLowerCase() === account.profile.username.toLowerCase()) { status = 'ok'; return paint(); }
    status = 'checking'; paint();
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        let free = await account.nameAvailable(name);
        // A suggested name that's taken gets a number on the end, before the jumper even notices.
        if (!free && !editing && mine === 1) {
          for (let i = 0; i < 4 && !free; i++) {
            const alt = `${name.slice(0, 16)}${Math.floor(10 + Math.random() * 990)}`;
            if (await account.nameAvailable(alt)) { name = alt; input.value = alt; free = true; }
          }
        }
        if (mine === seq) { status = free ? 'ok' : 'taken'; paint(); }
      } catch { if (mine === seq) { status = 'ok'; paint(); } } // offline: let the save decide
    }, mine === 1 ? 0 : 350);
  };
  input.addEventListener('input', () => { name = input.value.trim(); error = ''; check(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sheet.querySelector('[data-save]').click(); });
  sheet.querySelector('[data-save]').addEventListener('click', async () => {
    if (status !== 'ok' || busy) return;
    busy = true; error = ''; paint();
    try {
      await account.saveProfile({ username: name });
      closeSheet();
      lb.cache = {};
      if (editing) toast('Saved');
      else {
        const n = await syncNow();
        toast(n ? `You’re on the board! ${n} workout${n === 1 ? '' : 's'} added.` : 'You’re on the board!');
        ui.tab = 'leaders'; ui.view = null; loadBoard(true);
      }
    } catch (e) {
      error = friendlyError(e); busy = false;
      if (/taken|reserved/.test(error)) status = 'taken';
      paint();
    }
  });
  check();
  paint();
}

const APP_VERSION = '1.6';

/** "Send Feedback": a message (and an optional email for a reply) to the developer. */
function feedbackSheet() {
  const mine = account.user?.email && !/privaterelay/.test(account.user.email) ? account.user.email : '';
  const sheet = openSheet(`<div class="auth">
    <h3>Send Feedback</h3><div class="sub">Bugs, ideas, anything. Ramón reads every message.</div>
    <textarea class="field area" maxlength="2000" placeholder="What’s on your mind?"></textarea>
    <input class="field" type="email" inputmode="email" autocomplete="email" placeholder="Your email (optional, for a reply)" value="${esc(mine)}" style="margin-top:10px">
    <div class="auth-error" style="display:none"></div>
    <button class="btn press" style="margin-top:16px" data-send>Send</button></div>`);
  const text = sheet.querySelector('textarea'), mail = sheet.querySelector('input'), btn = sheet.querySelector('[data-send]'), err = sheet.querySelector('.auth-error');
  setTimeout(() => text.focus(), 350);
  btn.addEventListener('click', async () => {
    const message = text.value.trim(), email = mail.value.trim();
    const show = (m) => { err.textContent = m; err.style.display = m ? '' : 'none'; };
    if (!message) return show('Write a message first.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return show('That email doesn’t look right. Leave it empty if you prefer.');
    if (!accountsEnabled) {
      // No backend configured: hand it to the mail app instead.
      location.href = `mailto:ramonmm3@gmail.com?subject=${encodeURIComponent('FreeRope feedback')}&body=${encodeURIComponent(message)}`;
      return closeSheet();
    }
    btn.disabled = true; btn.textContent = 'Sending…'; show('');
    try {
      await account.sendFeedback({ message, email, version: APP_VERSION });
      closeSheet(); toast('Thanks! Your feedback was sent.');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Send';
      show(/rate_limited/.test(e?.message) ? 'You’ve sent a lot in the last hour. Try again later.' : friendlyError(e) || 'Couldn’t send it. Try again.');
    }
  });
}

function deleteAccountSheet() {
  openSheet(`<h3>Delete your account?</h3>
    <div class="sub">This removes your username and every workout summary from the leaderboard, for good. Workouts saved on this device stay here.</div>
    <button class="btn red press" data-sheet="yes">Delete Account</button>
    <button class="btn gray press" style="margin-top:10px" data-sheet="no">Cancel</button>`, (sh) => {
    sh.querySelector('[data-sheet="no"]').onclick = () => closeSheet();
    sh.querySelector('[data-sheet="yes"]').onclick = async (e) => {
      e.target.textContent = 'Deleting…'; e.target.disabled = true;
      try { await account.deleteAccount(); closeSheet(); lb.cache = {}; toast('Your account was deleted'); }
      catch (err) { toast(friendlyError(err) || 'Couldn’t delete the account. Try again.'); closeSheet(); }
    };
  });
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
  // A home-screen icon added with "Open as Web App" on runs outside Safari, where extensions can't help.
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const appUrl = location.origin + location.pathname;
  const steps = !ios
    ? '<p class="sub">This browser can’t talk to Bluetooth devices. Open FreeRope in <b>Google Chrome</b> or <b>Edge</b>.</p>'
    : standalone
      ? `<p class="sub">This icon opens FreeRope as a separate web app, where Bluetooth isn’t available. Remove it, then in Safari tap <b>Share → Add to Home Screen</b> again and switch <b>off</b> “Open as Web App”.</p>`
      : `<p class="sub">Safari needs the free <b>beacio</b> app to use Bluetooth. Install it, open it once and follow its setup screen, then come back here and tap Connect.</p>
         <a class="btn press" style="text-decoration:none" href="https://apps.apple.com/app/id6761301368" target="_blank" rel="noopener">Get beacio (free)</a>
         <p class="center small muted" style="margin:14px 0 6px">Older iPhone, or prefer another browser?</p>
         <a class="btn gray press" style="text-decoration:none" href="bluefy://open?url=${encodeURI(appUrl)}">Open in Bluefy</a>`;
  openSheet(`<h3>Bluetooth isn't available here</h3>${steps}
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
    if (!cd) { cd = document.createElement('div'); cd.className = 'countdown'; document.body.append(cd); }
    if (cd.dataset.n !== String(s.countdown)) {
      const [a, b] = LIVE_COLORS[s.plan.mode];
      cd.dataset.n = s.countdown;
      cd.innerHTML = `<div class="cd-ring"><svg viewBox="0 0 240 240"><defs><linearGradient id="cdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
        <circle cx="120" cy="120" r="113" fill="none" stroke="${a}" stroke-opacity=".2" stroke-width="14"/>
        <circle class="cd-arc" cx="120" cy="120" r="113" fill="none" stroke="url(#cdg)" stroke-width="14" stroke-linecap="round" transform="rotate(-90 120 120)"/></svg>
        <span class="num">${s.countdown}</span></div><div class="cd-label">Get Ready</div>`;
    }
    return;
  }
  document.querySelector('.countdown')?.remove();
  if (!liveEl.dataset.built) buildLive(s);
  updateLive(s);
});

// Same look as the Android app's live screen (LiveWorkoutScreen.kt): ring colours per mode.
const LIVE_COLORS = { FREE: ['#5bc800', '#b8ff3a'], TIMED: ['#0071e3', '#55d6ff'], TARGET: ['#ff6a00', '#ffc23d'], INTERVAL: ['#e5005a', '#ff7aa8'] };
const liveColors = (s) => s.phase === 'REST' ? ['#5e5ce6', '#bf5af2'] : s.phase === 'PAUSED' ? ['#ff9f0a', '#ffd60a'] : LIVE_COLORS[s.plan.mode];

function buildLive(s) {
  liveEl.dataset.built = '1';
  const x = icon('xmark');
  liveEl.innerHTML = `<div class="live-glow"></div>
    <div class="live-nav"><button class="live-x press" data-live="end" aria-label="End workout">${x}</button>
      <div class="live-title"><b>${esc(s.plan.title)}</b><span class="live-sub"></span></div><span class="live-conn"></span></div>
    ${s.plan.mode === 'INTERVAL' ? `<div class="live-rounds">${Array.from({ length: Math.min(s.plan.rounds, 30) }, () => '<i></i>').join('')}</div>` : ''}
    <div class="live-mid"><div class="ring-wrap"><div class="ringSvg"></div>
      <div class="ring-center"><div class="rest-label">Rest</div><div class="big num"></div><div class="unit"></div><div class="ring-sub"></div></div></div></div>
    <div class="live-card">
      <div class="lm"><span>Time</span><b class="num l-time" style="color:var(--yellow)"></b></div>
      <div class="lm"><span>Pace</span><b class="num" style="color:var(--teal)"><span class="l-jpm"></span><small>JPM</small></b></div>
      <div class="lm"><span>Streak</span><b class="num l-streak" style="color:var(--pink)"></b></div>
      <div class="lm"><span>Calories</span><b class="num" style="color:#ff5a8c"><span class="l-cal"></span><small>CAL</small></b></div>
      <svg class="spark" viewBox="0 0 300 52" preserveAspectRatio="none">
        <defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ff00" stop-opacity=".25"/><stop offset="1" stop-color="#a6ff00" stop-opacity="0"/></linearGradient></defs>
        <line class="sparkAvg" x1="0" x2="300" stroke="rgba(255,255,255,.45)" stroke-dasharray="4 4" stroke-width="1"/>
        <path class="sparkArea" fill="url(#sparkFill)"/><path class="sparkPath" fill="none" stroke="#a6ff00" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle class="sparkDot" r="3.5" fill="#a6ff00"/></svg>
    </div>
    <div class="live-ctrls">
      <button class="ctrl press" data-live="end"><i style="--c:var(--red)">${x}</i><span>End</span></button>
      <button class="ctrl press" data-live="pause"><i class="pauseIcon"></i><span class="pauseLabel"></span></button>
    </div>
    <div class="live-drop">Reconnecting to handle…</div>`;
  liveEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-live]');
    if (!b) return;
    if (b.dataset.live === 'pause') engine.togglePause();
    else if (b.dataset.live === 'end') confirmEnd();
  });
}

/** "End Workout?" like the Android app: save, discard, or keep going. */
function confirmEnd() {
  const s = engine.s;
  if (!s) return;
  const discard = () => { engine.discard(); releaseWakeLock(); closeLive(); render(); };
  alertBox('End Workout?', s.jumps > 0 ? `You've done ${fmt(s.jumps)} jumps.` : 'No jumps have been recorded yet.', [
    ...(s.jumps > 0 ? [{ title: 'End & Save', bold: true, run: () => engine.finish() }] : []),
    { title: s.jumps > 0 ? 'Discard' : 'End', destructive: true, run: discard },
    { title: 'Keep Going', run: () => {} },
  ]);
}

/** A centred alert with stacked buttons (UIAlertController look, as on Android). */
function alertBox(title, message, actions) {
  document.querySelector('.alert-scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'alert-scrim';
  scrim.innerHTML = `<div class="alert"><div class="alert-text"><b>${esc(title)}</b>${message ? `<span>${esc(message)}</span>` : ''}</div>
    ${actions.map((a, i) => `<button data-i="${i}" class="${a.destructive ? 'destructive' : ''} ${a.bold ? 'bold' : ''}">${esc(a.title)}</button>`).join('')}</div>`;
  scrim.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b && e.target !== scrim) return;
    scrim.remove();
    if (b) actions[+b.dataset.i].run();
  });
  document.body.append(scrim);
}

function updateLive(s) {
  const q = (c) => liveEl.querySelector(c);
  const rest = s.phase === 'REST', paused = s.phase === 'PAUSED';
  const [a, b] = liveColors(s);
  liveEl.style.setProperty('--glow', b);
  const size = 300;
  q('.ringSvg').innerHTML = ringsSVG([[engine.progress(), a, b]], size, 0.075).replace(`width="${size}" height="${size}"`, 'width="100%" height="100%"');
  const left = Math.ceil(s.phaseLeftMs / 1000);
  const mode = s.plan.mode;
  q('.live-sub').textContent = mode === 'INTERVAL' ? `Round ${s.round} of ${s.plan.rounds}` : mode === 'TARGET' ? `Goal ${fmt(s.plan.targetJumps)}` : mode === 'TIMED' ? 'Timed' : 'Open goal';
  liveEl.querySelectorAll('.live-rounds i').forEach((el, i) => { el.style.background = i < s.round ? b : ''; });

  q('.rest-label').style.display = rest ? '' : 'none';
  const big = q('.big');
  big.textContent = rest ? clock(left) : fmt(s.jumps);
  big.classList.toggle('small', !rest && s.jumps >= 10000);
  if (s.tick !== lastTick) { lastTick = s.tick; big.classList.remove('bump'); void big.offsetWidth; big.classList.add('bump'); }
  const unit = q('.unit');
  unit.style.display = rest ? 'none' : '';
  unit.textContent = paused ? 'PAUSED' : 'JUMPS';
  unit.style.color = paused ? 'var(--yellow)' : b;
  const lap = s.plan.ringJumps || 100;
  q('.ring-sub').textContent = rest ? `Round ${s.round + 1} up next`
    : mode === 'TIMED' ? `${clock(Math.max(left, 0))} left · ${fmt(lap - (s.jumps % lap))} to next ring`
    : mode === 'INTERVAL' ? `${clock(Math.max(left, 0))} left in round ${s.round}`
    : mode === 'TARGET' ? `${fmt(Math.max(s.plan.targetJumps - s.jumps, 0))} to go`
    : `Ring ${Math.floor(s.jumps / lap) + 1} · ${fmt(lap - (s.jumps % lap))} to go`;

  q('.l-time').textContent = clock(s.elapsedMs / 1000);
  q('.l-jpm').textContent = s.jpm;
  q('.l-streak').textContent = fmt(s.streak);
  q('.l-cal').textContent = Math.floor(s.calories);
  const pace = s.pace;
  if (pace.length > 1) {
    const live = pace.filter((v) => v > 0);
    const hi = Math.max(...pace, s.avgJpm, 60) + 10, lo = Math.max(Math.min(...(live.length ? live : [0]), s.avgJpm || hi) - 20, 0);
    const X = (i) => (i / (pace.length - 1) * 300), Y = (v) => 48 - Math.max(v - lo, 0) / Math.max(hi - lo, 1) * 44;
    const d = pace.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    q('.sparkPath').setAttribute('d', d);
    q('.sparkArea').setAttribute('d', `${d}L300,52L0,52Z`);
    q('.sparkDot').setAttribute('cx', 300); q('.sparkDot').setAttribute('cy', Y(pace.at(-1)));
    const avg = q('.sparkAvg');
    avg.style.display = s.avgJpm ? '' : 'none';
    avg.setAttribute('y1', Y(s.avgJpm)); avg.setAttribute('y2', Y(s.avgJpm));
  }

  const pb = q('[data-live="pause"]');
  pb.querySelector('i').style.setProperty('--c', paused ? 'var(--green)' : 'var(--yellow)');
  pb.querySelector('i').innerHTML = paused ? icon('play') : icon('pause');
  pb.querySelector('.pauseLabel').textContent = paused ? 'Resume' : 'Pause';
  const on = handle.state === 'connected';
  q('.live-conn').className = `live-conn ${on ? 'on' : 'wait'}`;
  q('.live-drop').classList.toggle('show', !on);
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
    case 'tab': ui.tab = arg; ui.view = null; render(); app.querySelector('.screen')?.scrollTo(0, 0); if (arg === 'leaders') loadBoard(); break;
    case 'feedback': feedbackSheet(); break;
    case 'signin': signInSheet(); break;
    case 'editName': nameSheet(); break;
    case 'signout': account.signOut().then(() => { lb.cache = {}; toast('Signed out'); }); break;
    case 'deleteAccount': deleteAccountSheet(); break;
    case 'lbPeriod': lb.period = arg; loadBoard(); break;
    case 'lbMetric': lb.metric = arg; loadBoard(); break;
    case 'lbRefresh': loadBoard(true); break;
    case 'lbRow': playerSheet(lb.rows?.find((r) => r.user_id === arg)); break;
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
        const id = ui.view.id;
        sessions = sessions.filter((s) => s.id !== id); saveSessions(); ui.view = null; render();
        account.removeWorkout(id).then(() => { lb.cache = {}; }).catch(() => {});
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

// Coming back from Google or Apple sign-in on the web: land on the leaderboard, with a clean URL.
const returningFromSignIn = new URLSearchParams(location.search).has('code') || sessionStorage.getItem('freerope.afterSignIn');
if (returningFromSignIn && accountsEnabled) { ui.tab = 'leaders'; sessionStorage.removeItem('freerope.afterSignIn'); }
render();
account.init().then(() => {
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname);
  if (ui.tab === 'leaders') loadBoard();
  if (returningFromSignIn && account.state === 'needsName') nameSheet();
  else if (returningFromSignIn && account.state === 'ready') toast(`Welcome back, ${account.profile.username}`);
});
