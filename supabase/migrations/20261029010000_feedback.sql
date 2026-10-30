-- In-app feedback. Anyone can send it (signed in or not); nobody can read it through the API.
-- Read it in the Supabase dashboard: Table Editor → feedback (newest first).

create table public.feedback (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  message      text not null check (length(btrim(message)) between 1 and 2000),
  email        text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  user_id      uuid default auth.uid() references auth.users (id) on delete set null,
  username     text,                                  -- filled in from the profile, for context
  install_id   text not null check (length(install_id) between 8 and 64), -- random per install, for rate limits
  platform     text not null check (platform in ('web', 'ios', 'android')),
  app_version  text check (length(app_version) <= 20),
  device       text check (length(device) <= 120)
);

create index feedback_recent on public.feedback (created_at desc);

-- Fills in who sent it (never trusts the client for that) and keeps one install from flooding it.
create or replace function public.check_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  recent integer;
begin
  new.user_id := auth.uid();
  new.username := (select username::text from profiles where id = auth.uid());
  new.created_at := now();
  select count(*) into recent from feedback
   where install_id = new.install_id and created_at > now() - interval '1 hour';
  if recent >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return new;
end $$;

create trigger feedback_check before insert on public.feedback
  for each row execute function public.check_feedback();

alter table public.feedback enable row level security;
create policy "anyone can send feedback" on public.feedback for insert with check (true);
-- No select policy: feedback is only readable in the dashboard.

grant insert on public.feedback to anon, authenticated;
