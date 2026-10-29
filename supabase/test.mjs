// Runs the FreeRope migration in an in-memory Postgres (PGlite) with a stand-in for Supabase's
// auth schema and roles, then checks the rules: RLS, validation, flagging, leaderboards, reports,
// account deletion.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import fs from 'node:fs';

const db = new PGlite({ extensions: { citext } });
const migration = fs.readFileSync('C:/Crossrope/web/supabase/migrations/20261029000000_accounts_leaderboards.sql', 'utf8');

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
await db.exec(migration);
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
`);

const U = { ana: '11111111-1111-1111-1111-111111111111', ben: '22222222-2222-2222-2222-222222222222', cat: '33333333-3333-3333-3333-333333333333', dan: '44444444-4444-4444-4444-444444444444', eve: '55555555-5555-5555-5555-555555555555' };
for (const [n, id] of Object.entries(U)) await db.query('insert into auth.users values ($1, $2)', [id, `${n}@x.com`]);

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); };
async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function fails(user, sql, params, msg, code) {
  try { await as(user, sql, params); ok(false, msg + ' (no error)'); }
  catch (e) { ok(!code || String(e.message).includes(code), `${msg} → ${e.message.split('\n')[0]}`); }
}

const today = new Date().toISOString().slice(0, 10);
const nowIso = new Date().toISOString();
const W = (user, o = {}) => as(user, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm, max_jpm, best_streak, best_minute, calories, rope_lb, source)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning flagged`,
  [o.user_id || user, o.client_id ?? Math.floor(Math.random() * 1e12), o.started_at || nowIso, o.local_date || today, o.mode || 'FREE', 'Free Jump',
    o.duration_sec ?? 600, o.active_sec ?? 580, o.jumps ?? 1200, o.avg_jpm ?? 124, o.max_jpm ?? 150, o.best_streak ?? 400, o.best_minute ?? 140, o.calories ?? 120, 1, 'web']);

// --- profiles
await as(U.ana, `insert into profiles (id, username, country) values ($1, 'ana_jumps', 'MX')`, [U.ana]);
await as(U.ben, `insert into profiles (id, username, country) values ($1, 'Ben', 'US')`, [U.ben]);
await as(U.cat, `insert into profiles (id, username, country) values ($1, 'cat.rope', 'MX')`, [U.cat]);
await as(U.dan, `insert into profiles (id, username, country) values ($1, 'dan', 'GB')`, [U.dan]);
ok(true, 'four users created profiles');
await fails(U.eve, `insert into profiles (id, username) values ($1, 'ANA_JUMPS')`, [U.eve], 'usernames are unique, ignoring case', 'duplicate');
await fails(U.eve, `insert into profiles (id, username) values ($1, 'freerope_team')`, [U.eve], 'reserved names are blocked', 'username_reserved');
await fails(U.eve, `insert into profiles (id, username) values ($1, 'a b')`, [U.eve], 'spaces are rejected', 'username_format');
await fails(U.eve, `insert into profiles (id, username) values ($1, 'eve')`, [U.ana], 'cannot create a profile for someone else', 'row-level security');
await as(U.eve, `insert into profiles (id, username) values ($1, 'eve')`, [U.eve]);
const upd = await as(U.ana, `update profiles set username = 'hacked' where id = $1 returning id`, [U.ben]);
ok(upd.rows.length === 0, 'cannot rename someone else');
ok((await as(null, `select count(*)::int n from profiles`)).rows[0].n === 5, 'signed-out visitors can read profiles');
ok((await as(null, `select username_available('ana_jumps') a`)).rows[0].a === false, 'username_available: taken name');
ok((await as(null, `select username_available('new.jumper') a`)).rows[0].a === true, 'username_available: free name');
ok((await as(U.ana, `select username_available('ana_jumps') a`)).rows[0].a === true, 'username_available: your own name counts as available');

// --- workouts
ok((await W(U.ana, { jumps: 5011, active_sec: 2200, duration_sec: 2240, avg_jpm: 137, best_minute: 159, best_streak: 2051 })).rows[0].flagged === false, 'normal workout is accepted, not flagged');
await W(U.ana, { jumps: 900, best_minute: 150, best_streak: 300 });
await W(U.ben, { jumps: 3000, active_sec: 1500, duration_sec: 1600, best_minute: 171, best_streak: 2600 });
await W(U.cat, { jumps: 4200, active_sec: 2000, duration_sec: 2100, best_minute: 140, best_streak: 900 });
ok((await W(U.dan, { jumps: 9000, active_sec: 600, duration_sec: 600, avg_jpm: 900 > 400 ? 380 : 0, best_minute: 380 })).rows[0].flagged === true, 'implausible workout (15 jumps/s) is flagged');
await fails(U.ben, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm) values ($1, 1, now(), current_date, 'FREE', 'x', 60, 60, 100, 100)`, [U.ana], 'cannot upload a workout for someone else', 'not_your_workout');
await fails(U.ana, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm) values ($1, 2, now() + interval '1 day', current_date + 1, 'FREE', 'x', 60, 60, 100, 100)`, [U.ana], 'future workouts are rejected', 'workout_in_future');
await fails(U.ana, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm) values ($1, 3, now(), current_date - 5, 'FREE', 'x', 60, 60, 100, 100)`, [U.ana], 'local date must match the start time', 'bad_local_date');
await fails(U.ana, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm, best_streak) values ($1, 4, now(), current_date, 'FREE', 'x', 60, 60, 100, 100, 500)`, [U.ana], 'streak longer than the workout is rejected', 'bad_streak');
await fails(U.ana, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm) values ($1, 5, now(), current_date, 'HACK', 'x', 60, 60, 100, 100)`, [U.ana], 'unknown modes are rejected', 'check constraint');
const dupId = 777;
await W(U.ben, { client_id: dupId, jumps: 100, best_minute: 100, best_streak: 50, active_sec: 60, duration_sec: 60 });
await fails(U.ben, `insert into workouts (user_id, client_id, started_at, local_date, mode, title, duration_sec, active_sec, jumps, avg_jpm) values ($1, ${dupId}, now(), current_date, 'FREE', 'x', 60, 60, 100, 100)`, [U.ben], 'the same workout cannot be uploaded twice', 'duplicate');
ok((await as(U.ana, `select count(*)::int n from workouts`)).rows[0].n === 2, 'users only see their own workouts');
ok((await as(null, `select count(*)::int n from workouts`)).rows[0].n === 0, 'signed-out visitors see no workouts');
const upw = await as(U.ana, `update workouts set jumps = 99999 returning id`);
ok(upw.rows.length === 0, 'workouts cannot be edited after upload');

// last week (counts for week, not today)
const d3 = new Date(Date.now() - 3 * 86400000);
await W(U.cat, { started_at: d3.toISOString(), local_date: d3.toISOString().slice(0, 10), jumps: 2000, best_minute: 160, best_streak: 1000 });
const d30 = new Date(Date.now() - 30 * 86400000);
await W(U.ben, { started_at: d30.toISOString(), local_date: d30.toISOString().slice(0, 10), jumps: 20000, active_sec: 6000, duration_sec: 6200, best_minute: 150, best_streak: 3000 });

// --- leaderboards
const board = async (user, p, m, country = null) => (await as(user, `select * from leaderboard($1, $2, $3::date, $4, 100)`, [p, m, today, country])).rows;
const show = (rows) => rows.map((r) => `${r.rank}.${r.username}=${r.value}${r.is_me ? '*' : ''}`).join(' ');
let b = await board(U.ana, 'day', 'jumps');
console.log('      today jumps:', show(b));
ok(b[0].username === 'ana_jumps' && Number(b[0].value) === 5911, "today's jumps: ana first with 5,011 + 900");
ok(!b.some((r) => r.username === 'dan'), 'flagged workouts stay off the board');
ok(b.find((r) => r.username === 'ana_jumps').is_me === true, 'your own row is marked');
b = await board(null, 'day', 'minute'); console.log('      today best minute:', show(b));
ok(b[0].username === 'Ben' && Number(b[0].value) === 171, 'best minute: Ben with 171');
b = await board(null, 'week', 'jumps'); console.log('      week jumps:', show(b));
ok(b[0].username === 'cat.rope' && Number(b[0].value) === 6200, 'week includes 3 days ago: cat 6,200');
b = await board(null, 'all', 'jumps'); console.log('      all-time jumps:', show(b));
ok(b[0].username === 'Ben' && Number(b[0].value) === 23100, 'all-time: Ben 23,100');
b = await board(null, 'day', 'jumps', 'MX'); console.log('      today MX:', show(b));
ok(b.length === 2 && b.every((r) => r.country === 'MX'), 'country filter');
b = await board(null, 'day', 'streak'); console.log('      today streak:', show(b));
ok(b[0].username === 'Ben' && Number(b[0].value) === 2600, 'longest streak: Ben 2,600');
const lim = (await as(U.cat, `select * from leaderboard('day', 'jumps', $1::date, null, 1)`, [today])).rows;
ok(lim.length === 2 && lim.some((r) => r.is_me), 'with a limit, your own row is still included');

// --- reports
await as(U.ben, `select report_user($1, 'rude name')`, [U.dan]);
await as(U.cat, `select report_user($1, null)`, [U.dan]);
ok((await as(null, `select count(*)::int n from profiles where username = 'dan'`)).rows[0].n === 1, 'two reports: still visible');
await as(U.ana, `select report_user($1, null)`, [U.dan]);
ok((await as(null, `select count(*)::int n from profiles where username = 'dan'`)).rows[0].n === 0, 'three reports: name is hidden');
ok((await as(U.dan, `select count(*)::int n from profiles where username = 'dan'`)).rows[0].n === 1, 'hidden users still see their own profile');
await as(U.dan, `update profiles set hidden = false where id = $1`, [U.dan]);
ok((await as(null, `select count(*)::int n from profiles where username = 'dan'`)).rows[0].n === 0, 'hidden users cannot unhide themselves');
ok((await as(U.ana, `select count(*)::int n from reports`)).rows[0].n === 0, 'reports are not readable');
await fails(null, `select report_user($1, null)`, [U.ana], 'signed-out visitors cannot report', 'permission denied');

// --- account deletion
await fails(null, `select delete_my_account()`, [], 'signed-out visitors cannot delete accounts', 'permission denied');
await as(U.cat, `select delete_my_account()`);
const left = (await db.query(`select (select count(*)::int from auth.users where id = $1) u, (select count(*)::int from profiles where id = $1) p, (select count(*)::int from workouts where user_id = $1) w`, [U.cat])).rows[0];
ok(left.u === 0 && left.p === 0 && left.w === 0, 'deleting an account removes the user, profile and workouts');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
