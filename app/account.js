// Accounts, workout sync and leaderboards on Supabase. Everything here is optional: with no
// backend configured (config.js) or no sign-in, the app works exactly as before, fully local.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const cfg = window.FREEROPE_BACKEND || { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
export const accountsEnabled = !!cfg.url;
const NATIVE = window.FREEROPE_NATIVE || null;
// The iPhone app signs in through Apple's secure browser sheet and comes back on this URL.
const NATIVE_REDIRECT = 'freerope://auth-callback';
const PACE_SEC = 5;

let clientPromise = null;
function client() {
  clientPromise ||= import('./vendor/supabase.js').then(({ createClient }) => createClient(cfg.url, cfg.key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !NATIVE, storageKey: 'freerope.auth' },
  }));
  return clientPromise;
}

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** The viewer's calendar day, which is what "today" means on the boards. */
export const localDate = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Most jumps in any 60 seconds, from the 5-second pace samples (each a jumps-per-minute rate). */
export function bestMinute(s) {
  const p = s.pace || [];
  const n = 60 / PACE_SEC;
  if (s.activeSec < 60 || p.length < n) return Math.min(s.jumps, 400);
  let sum = 0, best = 0;
  p.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= p[i - n];
    if (i >= n - 1) best = Math.max(best, sum / n);
  });
  return Math.min(Math.round(best), s.jumps, 400);
}

/** The phone's country, for the flag next to a name and the country board. */
export function guessCountry() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (/^[A-Z]{2}$/.test(region || '')) return region;
  } catch { /* old browser */ }
  return null;
}
export const flag = (cc) => cc ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
export function countryName(cc) {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(cc); } catch { return cc; }
}

/** A leaderboard name from whatever the sign-in provider gave us: "Ramón Mendoza" → "ramon.mendoza". */
export function suggestName(user) {
  const m = user?.user_metadata || {};
  const raw = m.preferred_username || m.full_name || m.name || (user?.email || '').split('@')[0] || 'jumper';
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '.').replace(/\.{2,}/g, '.').replace(/^[._]+|[._]+$/g, '').slice(0, 20);
  if (s.length < 3) s = `jumper${Math.floor(100 + Math.random() * 900)}`;
  return s;
}
export const validName = (n) => /^[A-Za-z0-9_.]{3,20}$/.test(n) && !/^[._]|[._]$/.test(n);

/** Turns database errors into something a person can act on. */
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (/username_reserved/.test(m)) return 'That name is reserved. Try another.';
  if (/duplicate key.*username|profiles_username_key/.test(m)) return 'That name is taken. Try another.';
  if (/username_format/.test(m)) return 'Use 3–20 letters, numbers, dots or underscores.';
  if (/rate_limited/.test(m)) return 'Too many uploads at once. Try again in a bit.';
  if (/Token has expired|invalid.*otp|otp.*invalid|expired/i.test(m)) return 'That code didn’t work. Check it or send a new one.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Check your internet and try again.';
  if (/cancel/i.test(m)) return '';
  return 'Something went wrong. Try again.';
}

/** Native sign-in sheet in the iPhone app (ios/FreeRope/AuthBridge.swift); resolves with the callback URL. */
function nativeAuth(url) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    (window.__authReplies ||= {})[id] = { resolve, reject };
    window.webkit.messageHandlers.auth.postMessage({ id, url, scheme: NATIVE_REDIRECT.split(':')[0] });
  });
}
window.__auth = {
  reply(id, ok, value) {
    const p = window.__authReplies?.[id];
    if (!p) return;
    delete window.__authReplies[id];
    ok ? p.resolve(value) : p.reject(new Error(value || 'cancelled'));
  },
};

export class Account extends EventTarget {
  constructor() {
    super();
    this.state = accountsEnabled ? 'loading' : 'off'; // off | loading | signedOut | needsName | ready
    this.user = null;
    this.profile = null;
    this.syncing = null; // the upload in progress, if any
  }

  emit() { this.dispatchEvent(new Event('change')); }

  async init() {
    if (!accountsEnabled) return;
    try {
      const sb = await client();
      sb.auth.onAuthStateChange((event, session) => {
        // Supabase warns against awaiting other calls inside this callback.
        setTimeout(() => this.setUser(session?.user || null), 0);
      });
      const { data } = await sb.auth.getSession();
      await this.setUser(data.session?.user || null);
    } catch {
      this.state = 'signedOut';
      this.emit();
    }
  }

  async setUser(user) {
    if (user?.id === this.user?.id && this.state !== 'loading' && this.state !== 'signedOut') return;
    this.user = user;
    if (!user) { this.profile = null; this.state = 'signedOut'; this.emit(); return; }
    const sb = await client();
    const { data } = await sb.from('profiles').select('id, username, country').eq('id', user.id).maybeSingle();
    this.profile = data || null;
    this.state = data ? 'ready' : 'needsName';
    this.emit();
    if (data) this.dispatchEvent(new Event('ready'));
  }

  // ------------------------------------------------------------------ sign in

  async signInWith(provider) {
    const sb = await client();
    if (NATIVE) {
      const { data, error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
      if (error) throw error;
      const back = new URL(await nativeAuth(data.url));
      const err = back.searchParams.get('error_description');
      if (err) throw new Error(err);
      const { error: e2 } = await sb.auth.exchangeCodeForSession(back.searchParams.get('code'));
      if (e2) throw e2;
      return;
    }
    // On the web the page leaves for the provider and comes back signed in.
    const back = location.origin + location.pathname;
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: back } });
    if (error) throw error;
  }

  async sendCode(email) {
    const sb = await client();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
  }

  async verifyCode(email, token) {
    const sb = await client();
    const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    await this.setUser(data.user);
  }

  async nameAvailable(name) {
    if (!validName(name)) return false;
    const sb = await client();
    const { data, error } = await sb.rpc('username_available', { p_name: name });
    if (error) throw error;
    return data;
  }

  async saveProfile({ username, country }) {
    const sb = await client();
    const row = { id: this.user.id, username, country: country || null };
    const { data, error } = await sb.from('profiles').upsert(row).select('id, username, country').single();
    if (error) throw error;
    const first = this.state !== 'ready';
    this.profile = data;
    this.state = 'ready';
    this.emit();
    if (first) this.dispatchEvent(new Event('ready'));
  }

  async signOut() {
    const sb = await client();
    await sb.auth.signOut();
    this.user = null; this.profile = null; this.state = 'signedOut';
    this.emit();
  }

  async deleteAccount() {
    const sb = await client();
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    store.set(this.syncKey(), []);
    await sb.auth.signOut().catch(() => {});
    this.user = null; this.profile = null; this.state = 'signedOut';
    this.emit();
  }

  // ------------------------------------------------------------------ workouts

  syncKey() { return `freerope.synced.${this.user?.id}`; }

  /** Uploads every workout this account hasn't seen yet. Returns how many went up. */
  sync(sessions) {
    if (this.state !== 'ready') return Promise.resolve(0);
    // A second call while one is running waits for that one (and then catches anything newer).
    if (this.syncing) return this.syncing.then((n) => this.sync(sessions).then((m) => n + m));
    this.syncing = this.upload(sessions).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async upload(sessions) {
    const done = new Set(store.get(this.syncKey(), []));
    const todo = sessions.filter((s) => !done.has(s.id) && s.jumps > 0);
    if (!todo.length) return 0;
    const sb = await client();
    const source = NATIVE === 'ios' ? 'ios' : 'web';
    let sent = 0;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const rows = batch.map((s) => ({
        user_id: this.user.id, client_id: s.id, started_at: new Date(s.startedAt).toISOString(), local_date: localDate(s.startedAt),
        mode: s.mode, title: String(s.title).slice(0, 60), duration_sec: Math.max(1, s.durationSec), active_sec: Math.min(s.activeSec, s.durationSec + 5),
        jumps: s.jumps, avg_jpm: Math.min(s.avgJpm, 400), max_jpm: Math.min(s.maxJpm || 0, 600), best_streak: Math.min(s.bestStreak || 0, s.jumps),
        best_minute: bestMinute(s), calories: Math.round(s.calories || 0), rope_lb: s.ropeLb, source,
      }));
      const { error } = await sb.from('workouts').upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
      if (error) throw error;
      batch.forEach((s) => done.add(s.id));
      store.set(this.syncKey(), [...done]);
      sent += batch.length;
    }
    return sent;
  }

  /** Lets the app forget a deleted workout on the server too. */
  async removeWorkout(id) {
    if (this.state !== 'ready') return;
    const sb = await client();
    await sb.from('workouts').delete().eq('user_id', this.user.id).eq('client_id', id);
  }

  // ------------------------------------------------------------------ leaderboards

  async leaderboard({ period = 'day', metric = 'jumps', country = null, limit = 100 } = {}) {
    const sb = await client();
    const { data, error } = await sb.rpc('leaderboard', { p_period: period, p_metric: metric, p_day: localDate(), p_country: country, p_limit: limit });
    if (error) throw error;
    return data.map((r) => ({ ...r, rank: Number(r.rank), value: Number(r.value) }));
  }

  async report(userId, reason) {
    const sb = await client();
    const { error } = await sb.rpc('report_user', { p_user: userId, p_reason: reason || null });
    if (error) throw error;
  }
}
