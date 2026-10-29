// App Store screenshot mode (debug builds only, see WebViewController.swift): fills the app with a
// realistic month of workouts and opens the screen named in window.FREEROPE_SHOT.
(() => {
  const DAY = 86400000, now = Date.now();
  const pace = (min, avg, rests) => {
    const n = Math.round(min * 12), a = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let v = avg + 10 * Math.sin(i / 7) + ((i * 37) % 11) - 5 - 6 * t;
      if (i < 3) v = 60 + i * 30;
      if (rests.some((r) => Math.abs(t - r) < 0.008)) v = (i * 13) % 20;
      a.push(Math.max(0, Math.round(v)));
    }
    return a;
  };
  const at = (d, h, m = 5) => { const x = new Date(now - d * DAY); x.setHours(h, m, 0, 0); return x.getTime(); };
  const sessions = [];
  const add = (d, h, mode, title, min, jumps, avg, streak, rests = [0.33, 0.66]) => {
    const t = at(d, h);
    sessions.push({ id: t, startedAt: t, mode, title, durationSec: Math.round(min * 60 * 1.04), activeSec: Math.round(min * 60), jumps, avgJpm: avg,
      maxJpm: avg + 24, bestStreak: streak, misses: Math.round(min * 0.6), calories: Math.round(jumps * 0.09), pace: pace(min, avg + 6, rests), ropeLb: 1 });
  };
  // Today mirrors a real 37-minute, 5,011-jump session; then four weeks of lived-in history.
  add(0, 7, 'FREE', 'Free Jump', 36.6, 5011, 137, 2051, [0.3, 0.52, 0.7, 0.86]);
  add(1, 18, 'FREE', 'Free Jump', 36.3, 5011, 138, 1800, [0.3, 0.52, 0.7, 0.86]);
  add(2, 7, 'FREE', 'Free Jump', 30.2, 3850, 127, 1300);
  const plan = [[3, 'TIMED', '10 min', 10, 1290, 129], [4, 'FREE', 'Free Jump', 28, 3500, 128], [6, 'TARGET', '1,000 jumps', 8, 1000, 125],
    [7, 'INTERVAL', 'Tabata', 8, 860, 132], [9, 'FREE', 'Free Jump', 25, 3100, 126], [10, 'TIMED', '15 min', 15, 1880, 125],
    [12, 'FREE', 'Free Jump', 31, 3900, 127], [14, 'TARGET', '2,000 jumps', 16, 2000, 124], [16, 'FREE', 'Free Jump', 20, 2400, 121],
    [17, 'TIMED', '20 min', 20, 2450, 122], [19, 'INTERVAL', 'Sprint 30/30', 10, 1150, 128], [21, 'FREE', 'Free Jump', 18, 2100, 118],
    [23, 'TIMED', '10 min', 10, 1180, 118], [25, 'FREE', 'Free Jump', 15, 1700, 115], [27, 'TARGET', '1,000 jumps', 9, 1000, 112]];
  for (const [d, mode, title, min, jumps, avg] of plan) add(d, 7 + (d % 3) * 5, mode, title, min, jumps, avg, Math.round(jumps * 0.32));
  localStorage.setItem('freerope.sessions', JSON.stringify(sessions));
  localStorage.setItem('freerope.profile', JSON.stringify({ name: 'Ramón', weightKg: 69, heightCm: 180, age: 28, sex: 'MALE', ropeLb: 1,
    dailyGoal: 5000, minuteGoal: 35, calorieGoal: 400, voice: false, haptics: false, imperial: false, onboarded: true }));

  const click = (sel) => document.querySelector(sel)?.click();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const scrollTo = (text, top) => {
    const sc = document.querySelector('.screen');
    const el = [...sc.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === text);
    if (el) sc.scrollTop += el.getBoundingClientRect().top - top;
  };
  const shots = {
    summary: async () => {},
    workouts: async () => click('[data-act=tab][data-arg=workouts]'),
    history: async () => click('[data-act=tab][data-arg=history]'),
    pace: async () => { click('[data-act=open]'); await wait(1500); scrollTo('Pace', 100); },
    live: async () => {
      click('[data-act=tab][data-arg=profile]'); await wait(300); click('[data-act=demo]'); await wait(300);
      click('[data-act=tab][data-arg=summary]'); await wait(300); click('[data-act=start]'); await wait(1200); click('[data-go]');
    },
  };
  window.addEventListener('load', async () => { await wait(800); await shots[window.FREEROPE_SHOT]?.(); });
})();
