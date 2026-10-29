// Workout engine, ported from the Android app's workout/WorkoutEngine.kt.
import { activeKcalPerMin } from './energy.js';

export const presets = {
  free: { mode: 'FREE', title: 'Free Jump', subtitle: 'Jump at your own pace' },
  timed: [1, 3, 5, 10, 15, 20].map((m) => ({ mode: 'TIMED', title: `${m} min`, subtitle: 'Timed session', durationSec: m * 60 })),
  target: [100, 250, 500, 1000, 2000, 5000].map((n) => ({ mode: 'TARGET', title: `${n.toLocaleString()} jumps`, subtitle: 'Hit the target', targetJumps: n })),
  intervals: [
    { mode: 'INTERVAL', title: 'Tabata', subtitle: '20s on · 10s off · 8 rounds', workSec: 20, restSec: 10, rounds: 8 },
    { mode: 'INTERVAL', title: 'Sprint 30/30', subtitle: '30s on · 30s off · 10 rounds', workSec: 30, restSec: 30, rounds: 10 },
    { mode: 'INTERVAL', title: 'Burner 45/15', subtitle: '45s on · 15s off · 8 rounds', workSec: 45, restSec: 15, rounds: 8 },
    { mode: 'INTERVAL', title: 'Endurance', subtitle: '2 min on · 30s off · 5 rounds', workSec: 120, restSec: 30, rounds: 5 },
  ],
};

export class Engine extends EventTarget {
  constructor(handle, cues, profile) {
    super();
    this.handle = handle;
    this.cues = cues;
    this.profile = profile;
    this.s = null;
    this.onCount = (e) => this.count(e.detail);
    this.onConn = () => {
      // After a dropout the handle needs START again to resume counting.
      if (this.s?.phase === 'WORK' && this.handle.state === 'connected' && this.wasDropped) {
        this.firstFrame = true;
        this.handle.startCounting();
      }
      this.wasDropped = this.handle.state !== 'connected';
    };
  }

  emit() { this.dispatchEvent(new Event('change')); }

  start(plan) {
    this.stopTimers();
    this.recent = [];
    this.lastCount = 0;
    this.firstFrame = true;
    this.lastJumpAt = 0;
    this.nextPaceAt = 5000;
    this.lastSpoken = -1;
    this.startedAt = Date.now();
    this.ropeLb = plan.ropeLb ?? this.profile().ropeLb;
    this.s = {
      plan: { ringJumps: 100, ...plan }, phase: 'COUNTDOWN', countdown: 3, jumps: 0, elapsedMs: 0, activeMs: 0,
      phaseLeftMs: 0, round: 1, jpm: 0, avgJpm: 0, maxJpm: 0, streak: 0, bestStreak: 0, misses: 0,
      calories: 0, pace: [], tick: 0,
    };
    this.handle.addEventListener('count', this.onCount);
    this.handle.addEventListener('change', this.onConn);
    this.wasDropped = false;
    let n = 3;
    const step = () => {
      if (!this.s) return;
      if (n > 0) {
        this.s.countdown = n;
        this.cues.say(String(n));
        this.cues.buzz(40);
        this.emit();
        n--;
        this.cd = setTimeout(step, 1000);
      } else {
        this.cues.say('Go');
        this.cues.buzz(150);
        this.beginWork();
        this.last = performance.now();
        this.loop = setInterval(() => this.tick(), 100);
      }
    };
    step();
    this.emit();
  }

  progress() {
    const s = this.s;
    if (!s) return 0;
    if (s.plan.mode === 'TARGET') return Math.min(s.jumps / s.plan.targetJumps, 1);
    if (s.phase === 'REST') return Math.min(Math.max(1 - s.phaseLeftMs / (s.plan.restSec * 1000), 0), 1);
    return Math.min(s.jumps / Math.max(s.plan.ringJumps, 1), 50);
  }

  togglePause() {
    const s = this.s;
    if (!s) return;
    if (s.phase === 'WORK' || s.phase === 'REST') {
      this.resumePhase = s.phase;
      if (s.phase === 'WORK') this.handle.stopCounting();
      s.phase = 'PAUSED';
      this.cues.say('Paused');
      this.cues.buzz(60);
    } else if (s.phase === 'PAUSED') {
      s.phase = this.resumePhase;
      if (s.phase === 'WORK') {
        this.firstFrame = true;
        this.lastJumpAt = 0;
        this.handle.startCounting();
      }
      this.cues.say("Let's go");
      this.cues.buzz(60);
    }
    this.emit();
  }

  finish() {
    const s = this.s;
    if (!s) return null;
    this.teardown();
    if (s.phase === 'COUNTDOWN') return null;
    this.cues.say(`Workout complete. ${s.jumps} jumps`);
    this.cues.buzz(300);
    const active = Math.max(s.activeMs, 1);
    const session = {
      id: this.startedAt, startedAt: this.startedAt, mode: s.plan.mode, title: s.plan.title,
      durationSec: Math.floor(s.elapsedMs / 1000), activeSec: Math.floor(s.activeMs / 1000), jumps: s.jumps,
      avgJpm: Math.floor(s.jumps * 60000 / active), maxJpm: Math.max(s.maxJpm, s.avgJpm), bestStreak: s.bestStreak,
      misses: s.misses, calories: Math.round(s.calories), pace: s.pace, ropeLb: this.ropeLb,
    };
    this.dispatchEvent(new CustomEvent('finished', { detail: session }));
    return session;
  }

  discard() { this.teardown(); }

  teardown() {
    this.stopTimers();
    this.handle.stopCounting();
    this.handle.removeEventListener('count', this.onCount);
    this.handle.removeEventListener('change', this.onConn);
    this.s = null;
    this.emit();
  }

  stopTimers() {
    clearTimeout(this.cd);
    clearInterval(this.loop);
  }

  beginWork() {
    const s = this.s;
    s.phaseLeftMs = s.plan.mode === 'TIMED' ? s.plan.durationSec * 1000 - s.elapsedMs : s.plan.mode === 'INTERVAL' ? s.plan.workSec * 1000 : 0;
    s.phase = 'WORK';
    this.firstFrame = true;
    this.lastJumpAt = 0;
    this.lastSpoken = -1;
    this.handle.startCounting();
    this.emit();
  }

  beginRest() {
    this.handle.stopCounting();
    this.s.phase = 'REST';
    this.s.phaseLeftMs = this.s.plan.restSec * 1000;
    this.lastSpoken = -1;
    this.cues.say('Rest');
    this.cues.buzz(200);
  }

  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    const s = this.s;
    if (!s) return;
    if (s.phase === 'WORK') this.tickWork(s, now, dt);
    else if (s.phase === 'REST') this.tickRest(s, dt);
    this.emit();
  }

  tickWork(s, now, dt) {
    while (this.recent.length && now - this.recent[0] > 10000) this.recent.shift();
    const active = s.activeMs + dt;
    const win = Math.max(Math.min(active, 10000), 1);
    const jpm = active < 3000 ? 0 : Math.floor(this.recent.length * 60000 / win);
    const jumping = this.lastJumpAt > 0 && now - this.lastJumpAt < 3000;
    const kcalPerMin = jumping ? activeKcalPerMin(jpm, this.profile(), this.ropeLb) : 0;
    if (active >= this.nextPaceAt) {
      s.pace.push(jpm);
      this.nextPaceAt += 5000;
    }
    s.elapsedMs += dt;
    s.activeMs = active;
    s.phaseLeftMs -= dt;
    s.jpm = jpm;
    s.avgJpm = active > 5000 ? Math.floor(s.jumps * 60000 / active) : 0;
    if (active > 10000) s.maxJpm = Math.max(s.maxJpm, jpm);
    s.calories += kcalPerMin * dt / 60000;
    if (s.plan.mode === 'TIMED') {
      this.announce(s.phaseLeftMs);
      if (s.phaseLeftMs <= 0) this.finish();
    } else if (s.plan.mode === 'INTERVAL') {
      this.announce(s.phaseLeftMs);
      if (s.phaseLeftMs <= 0) {
        if (s.round >= s.plan.rounds) this.finish();
        else this.beginRest();
      }
    }
  }

  tickRest(s, dt) {
    s.elapsedMs += dt;
    s.phaseLeftMs -= dt;
    this.announce(s.phaseLeftMs);
    if (s.phaseLeftMs <= 0) {
      s.round++;
      this.cues.say('Go');
      this.cues.buzz(150);
      this.beginWork();
    }
  }

  announce(left) {
    const sec = Math.ceil(left / 1000);
    if (sec >= 1 && sec <= 3 && sec !== this.lastSpoken) {
      this.lastSpoken = sec;
      this.cues.say(String(sec));
      this.cues.buzz(40);
    }
  }

  count(c) {
    if (this.s?.phase !== 'WORK') return;
    if (this.firstFrame) {
      this.firstFrame = false;
      // A count above 1 on the first frame is left over from the previous session.
      this.lastCount = c > 1 ? c : 0;
    }
    const delta = c - this.lastCount;
    this.lastCount = c;
    if (delta >= 1 && delta <= 30) this.addJumps(delta);
  }

  addJumps(n) {
    const s = this.s;
    const now = performance.now();
    const before = s.jumps;
    if (this.lastJumpAt > 0 && now - this.lastJumpAt > 1500) {
      if (s.streak > 0) s.misses++;
      s.streak = 0;
    }
    s.streak += n;
    this.lastJumpAt = now;
    for (let i = 0; i < n; i++) this.recent.push(now);
    s.jumps += n;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.tick++;
    const lap = s.plan.mode === 'TARGET' ? 100 : Math.max(s.plan.ringJumps, 1);
    if (Math.floor(s.jumps / lap) > Math.floor(before / lap)) {
      this.cues.say(String(Math.floor(s.jumps / lap) * lap));
      this.cues.buzz(60);
    }
    this.emit();
    if (s.plan.mode === 'TARGET' && s.jumps >= s.plan.targetJumps) this.finish();
  }
}
