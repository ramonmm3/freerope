-- FreeRope accounts and leaderboards.
--
-- The apps stay local-first: workouts live on the phone, and signed-in users also upload a
-- summary of each one (no raw pace data) so it can count on the leaderboards. Workouts are
-- private; the public only sees usernames and leaderboard totals, through the functions below.

-- Supabase keeps extensions in their own schema; functions below include it in their search_path.
create schema if not exists extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------- profiles

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    citext not null unique,
  country     text check (country ~ '^[A-Z]{2}$'),
  hidden      boolean not null default false,   -- hidden by moderation (reports)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.]{3,20}$' and username !~ '^[._]|[._]$')
);

-- Names nobody can take: impersonation and the obvious junk. Kept small on purpose; reports
-- handle the rest.
create table public.reserved_usernames (name citext primary key);
insert into public.reserved_usernames (name) values
  ('admin'), ('administrator'), ('freerope'), ('crossrope'), ('support'), ('moderator'), ('mod'),
  ('official'), ('staff'), ('apple'), ('google'), ('root'), ('system'), ('null'), ('undefined'),
  ('anonymous'), ('everyone'), ('team');

create or replace function public.check_username() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.reserved_usernames r where new.username = r.name
             or new.username ilike r.name || '\_%' or new.username ilike r.name || '.%') then
    raise exception 'username_reserved' using errcode = '23514';
  end if;
  -- Only moderation can unhide; a user can't clear their own hidden flag.
  if tg_op = 'UPDATE' and old.hidden and not new.hidden and auth.uid() is not null then
    new.hidden := true;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_check before insert or update on public.profiles
  for each row execute function public.check_username();

alter table public.profiles enable row level security;
create policy "profiles are public" on public.profiles for select using (not hidden or id = auth.uid());
create policy "create own profile" on public.profiles for insert with check (id = auth.uid());
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------- workouts

create table public.workouts (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  client_id     bigint not null,                -- the app's own id (start time in ms)
  started_at    timestamptz not null,
  local_date    date not null,                  -- the day it counts for, in the jumper's time zone
  mode          text not null check (mode in ('FREE', 'TIMED', 'TARGET', 'INTERVAL')),
  title         text not null check (length(title) <= 60),
  duration_sec  integer not null check (duration_sec between 1 and 6 * 3600),
  active_sec    integer not null check (active_sec between 0 and 6 * 3600),
  jumps         integer not null check (jumps between 1 and 60000),
  avg_jpm       integer not null check (avg_jpm between 0 and 400),
  max_jpm       integer not null default 0 check (max_jpm between 0 and 600),
  best_streak   integer not null default 0 check (best_streak >= 0),
  best_minute   integer not null default 0 check (best_minute between 0 and 400),  -- most jumps in any 60 s
  calories      integer not null default 0 check (calories between 0 and 5000),
  rope_lb       numeric(4, 2) check (rope_lb between 0 and 5),
  source        text not null default 'web' check (source in ('web', 'ios', 'android')),
  flagged       boolean not null default false, -- implausible: kept for the owner, left off leaderboards
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);

create index workouts_day on public.workouts (local_date) where not flagged;
create index workouts_user on public.workouts (user_id, local_date);

-- Plausibility checks. Hard limits reject the row; borderline numbers are kept but flagged so a
-- typo in a physics constant or a glitchy handle can't put someone on top of the board.
create or replace function public.check_workout() returns trigger
language plpgsql as $$
declare
  recent integer;
begin
  if new.user_id <> auth.uid() then
    raise exception 'not_your_workout' using errcode = '42501';
  end if;
  if new.started_at > now() + interval '10 minutes' then
    raise exception 'workout_in_future' using errcode = '23514';
  end if;
  -- The local day must match the start time give or take time zones (UTC-12 to UTC+14).
  if new.local_date not between (new.started_at at time zone 'UTC')::date - 1
                            and (new.started_at at time zone 'UTC')::date + 1 then
    raise exception 'bad_local_date' using errcode = '23514';
  end if;
  if new.active_sec > new.duration_sec + 5 then
    raise exception 'bad_active_time' using errcode = '23514';
  end if;
  if new.best_streak > new.jumps then
    raise exception 'bad_streak' using errcode = '23514';
  end if;

  select count(*) into recent from public.workouts
   where user_id = new.user_id and created_at > now() - interval '1 hour';
  if recent >= 120 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  new.flagged := new.avg_jpm > 320                                   -- faster than elite single unders, sustained
              or new.best_minute > 380                               -- above the 1-minute world record pace
              or new.jumps > greatest(new.active_sec, 1) * 6.5       -- more than 6.5 jumps every second
              or new.best_minute > new.jumps;
  new.created_at := now();
  return new;
end $$;

create trigger workouts_check before insert on public.workouts
  for each row execute function public.check_workout();

alter table public.workouts enable row level security;
create policy "see own workouts" on public.workouts for select using (user_id = auth.uid());
create policy "add own workouts" on public.workouts for insert with check (user_id = auth.uid());
create policy "delete own workouts" on public.workouts for delete using (user_id = auth.uid());
-- No update policy: a workout is a record of what happened.

-- ---------------------------------------------------------------------------- leaderboards

-- One board: a period ending on p_day (the viewer's local date) and a metric.
--   period: 'day' | 'week' (last 7 days) | 'all'
--   metric: 'jumps' (total) | 'minute' (best 60 s) | 'streak' (longest unbroken run)
create or replace function public.leaderboard(
  p_period  text default 'day',
  p_metric  text default 'jumps',
  p_day     date default current_date,
  p_country text default null,
  p_limit   integer default 100
) returns table (rank bigint, user_id uuid, username text, country text, value bigint, is_me boolean)
language sql stable security definer set search_path = public, extensions as $$
  with scope as (
    select w.user_id,
           case p_metric
             when 'minute' then max(w.best_minute)::bigint
             when 'streak' then max(w.best_streak)::bigint
             else sum(w.jumps)::bigint
           end as value,
           min(w.created_at) as first_at
      from workouts w
      join profiles p on p.id = w.user_id and not p.hidden
     where not w.flagged
       and (p_period = 'all'
            or (p_period = 'day' and w.local_date = p_day)
            or (p_period = 'week' and w.local_date between p_day - 6 and p_day))
       and (p_country is null or p.country = p_country)
     group by w.user_id
  ), ranked as (
    select rank() over (order by s.value desc) as rank, s.user_id, p.username::text, p.country, s.value,
           s.user_id = auth.uid() as is_me, s.first_at
      from scope s join profiles p on p.id = s.user_id
     where s.value > 0
  )
  select r.rank, r.user_id, r.username, r.country, r.value, r.is_me from ranked r
   where r.rank <= least(greatest(p_limit, 1), 500) or r.is_me
   order by r.rank, r.first_at;
$$;

-- ---------------------------------------------------------------------------- account helpers

create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_name ~ '^[A-Za-z0-9_.]{3,20}$' and p_name !~ '^[._]|[._]$'
     and not exists (select 1 from profiles where username = p_name::citext and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'))
     and not exists (select 1 from reserved_usernames r where p_name::citext = r.name
                     or p_name ilike r.name || '\_%' or p_name ilike r.name || '.%');
$$;

-- App Store guideline 5.1.1(v): people can delete their account from inside the app.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();   -- profile, workouts and reports cascade
end $$;

-- ---------------------------------------------------------------------------- reports

-- Usernames are user-generated content (guideline 1.2): anyone can report one, and three
-- different reporters hide it from the boards until it's reviewed.
create table public.reports (
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_id uuid not null references auth.users (id) on delete cascade,
  reason      text check (length(reason) <= 200),
  created_at  timestamptz not null default now(),
  primary key (reporter_id, reported_id)
);

create or replace function public.report_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_user = auth.uid() then return; end if;
  insert into reports (reporter_id, reported_id, reason) values (auth.uid(), p_user, left(p_reason, 200))
    on conflict do nothing;
  if (select count(*) from reports where reported_id = p_user) >= 3 then
    update profiles set hidden = true where id = p_user;
  end if;
end $$;

alter table public.reports enable row level security;   -- no policies: only report_user() writes here
alter table public.reserved_usernames enable row level security;
-- Readable by everyone: check_username() runs as the signed-in user and has to see the list.
create policy "reserved names are public" on public.reserved_usernames for select using (true);

-- ---------------------------------------------------------------------------- grants

-- New Supabase projects don't expose tables to the API by default; say exactly what each role may
-- touch. Row-level security above still decides which rows.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.reserved_usernames to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select, insert, delete on public.workouts to authenticated;

revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.report_user(uuid, text) from public, anon;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.report_user(uuid, text) to authenticated;
grant execute on function public.leaderboard(text, text, date, text, integer) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
