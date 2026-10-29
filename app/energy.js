// Calorie model v3, ported from the Android app's data/Energy.kt. Keep the two in sync.
//
// Gross cost = body (legs + trunk) + rope turning; active = gross − resting (Mifflin–St Jeor).
// Body METs convert to absolute energy (MET × 3.5 ml/kg/min × 5 kcal/L), anchored to the
// Digi-Jump (8.9 METs at 120 jpm, Lyons 2020) and real skipping (11.7–12.5 METs, Quirk &
// Sinning 1980). The rope term is mechanical work per turn at muscle efficiency: lifting the
// cable, circling forearms (wider circles for heavier ropes) and holding the tension.

export const ropeOptions = [0.25, 0.5, 1, 2];

export function ropeLabel(lb) {
  return { 0.25: '¼ lb', 0.5: '½ lb', 1: '1 lb', 2: '2 lb' }[lb] ?? `${lb} lb`;
}

const KCAL_PER_L_O2 = 5.0;
const G = 9.81;
const KG_PER_LB = 0.4536;
const J_PER_KCAL = 4184;

export function bmrPerDay(p) {
  const sexTerm = p.sex === 'MALE' ? 5 : p.sex === 'FEMALE' ? -161 : -78;
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sexTerm;
}

export const bmrPerMin = (p) => bmrPerDay(p) / 1440;

export const kcalPerMetMin = (p) => (3.5 * p.weightKg) / 1000 * KCAL_PER_L_O2;

export function bodyMet(jpm) {
  const steady = Math.min(Math.max(9.4 + 0.015 * (jpm - 120), 8.8), 10.2);
  return jpm >= 80 ? steady : 1 + (9.4 + 0.015 * (80 - 120) - 1) * Math.max(jpm, 0) / 80;
}

function handRadiusM(lb) {
  if (lb <= 0.25) return 0.03;
  if (lb <= 0.5) return 0.05;
  if (lb <= 1) return 0.08;
  return 0.12;
}

export function ropeWatts(lb, rpm, p) {
  if (rpm <= 0) return 0;
  const m = lb * KG_PER_LB;
  const heightM = p.heightCm / 100;
  const omega = rpm * 2 * Math.PI / 60;
  const cable = m * G * 0.55 * heightM;
  const arms = 2 * (0.03 * p.weightKg) * G * 2 * handRadiusM(lb);
  const perRev = (cable + arms) * (1 / 0.25 + 1 / 1.2);
  const tension = m * omega * omega * 0.3 * heightM;
  return perRev * rpm / 60 + 0.25 * tension;
}

export function activeKcalPerMin(jpm, p, lb) {
  if (jpm <= 0) return 0;
  const gross = bodyMet(jpm) * kcalPerMetMin(p) + ropeWatts(lb, jpm, p) * 60 / J_PER_KCAL;
  return Math.max(gross - bmrPerMin(p), 0);
}

export const ropeExtra = (lb, p) => activeKcalPerMin(130, p, lb) / activeKcalPerMin(130, p, 0.25) - 1;

export function sessionCalories(s, p, lb = s.ropeLb) {
  let kcal = s.pace.reduce((a, j) => a + activeKcalPerMin(j, p, lb) * 5 / 60, 0);
  const leftover = Math.max(s.activeSec - s.pace.length * 5, 0);
  kcal += activeKcalPerMin(s.avgJpm, p, lb) * leftover / 60;
  return Math.round(kcal);
}

// ------------------------------------------------------------------ equivalents

export const activities = [
  { name: 'Running', met: 9.8, icon: 'run', kmh: 10, unit: 'km' },
  { name: 'Cycling', met: 8.0, icon: 'bike', kmh: 20, unit: 'km' },
  { name: 'Swimming', met: 5.8, icon: 'swim', kmh: 2, unit: 'laps', perKm: 40 },
  { name: 'Brisk walk', met: 4.3, icon: 'walk', kmh: 5.6, unit: 'steps', perKm: 1300 },
];

export const minutesFor = (kcal, a, p) => kcal / Math.max(a.met * kcalPerMetMin(p) - bmrPerMin(p), 0.1);

export const foods = [
  { name: 'slice of pizza', plural: 'slices of pizza', short: 'Pizza', emoji: '🍕', kcal: 285, protein: 12, carbs: 36, fat: 10 },
  { name: 'cheeseburger', plural: 'cheeseburgers', short: 'Burger', emoji: '🍔', kcal: 300, protein: 15, carbs: 33, fat: 12 },
  { name: 'croissant', plural: 'croissants', short: 'Croissant', emoji: '🥐', kcal: 230, protein: 5, carbs: 26, fat: 12 },
  { name: 'cookie', plural: 'cookies', short: 'Cookie', emoji: '🍪', kcal: 160, protein: 2, carbs: 21, fat: 8 },
  { name: 'scoop of ice cream', plural: 'scoops of ice cream', short: 'Ice Cream', emoji: '🍨', kcal: 140, protein: 2.5, carbs: 16, fat: 7.5 },
  { name: 'beer', plural: 'beers', short: 'Beer', emoji: '🍺', kcal: 150, protein: 1.6, carbs: 13, fat: 0, alcohol: 14 },
  { name: 'latte', plural: 'lattes', short: 'Latte', emoji: '☕', kcal: 190, protein: 13, carbs: 19, fat: 7 },
  { name: 'slice of cake', plural: 'slices of cake', short: 'Cake', emoji: '🍰', kcal: 350, protein: 4, carbs: 50, fat: 15 },
];

export function tef(f) {
  const p = f.protein * 4, c = f.carbs * 4, fa = f.fat * 9, a = (f.alcohol || 0) * 7;
  const total = Math.max(p + c + fa + a, 1);
  return (p * 0.25 + c * 0.075 + fa * 0.02 + a * 0.15) / total;
}

export function epocFraction(avgJpm, activeMin) {
  const byIntensity = avgJpm >= 120 ? 0.08 : avgJpm >= 100 ? 0.06 : 0.04;
  return byIntensity * Math.min(Math.max(activeMin / 20, 0), 1);
}

/** How much of a food the workout pays for: eat this much and you're energy-neutral. */
export function earned(f, activeKcal, jumps, activeMin, avgJpm) {
  const epoc = Math.round(activeKcal * epocFraction(avgJpm, activeMin));
  const total = activeKcal + epoc;
  const net = f.kcal * (1 - tef(f));
  const perJump = jumps > 0 ? total / jumps : 0;
  const perMin = activeMin > 0 ? total / activeMin : 0;
  return {
    activeKcal, epoc, total,
    servings: net > 0 ? total / net : 0,
    digest: Math.round(f.kcal - net),
    net: Math.round(net),
    jumpsToBurnOne: perJump > 0 ? Math.round(net / perJump) : 0,
    minutesToBurnOne: perMin > 0 ? net / perMin : 0,
  };
}

export const KCAL_PER_G_FAT = 7.7;
