-- House Hunt: initial schema
-- Tables: allowed_users, properties, viewings, sync_state
-- Access: the shared login (email in allowed_users) can read/write
-- properties and viewings. Claude writes through the Supabase connector
-- (postgres role), which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Who may sign in to the web app
-- ---------------------------------------------------------------------------
create table public.allowed_users (
  email text primary key check (email = lower(email))
);
alter table public.allowed_users enable row level security;
-- no policies: only the postgres/service role can read or change this list

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table public.properties (
  id             text primary key,                 -- slug, e.g. 'rockside-gardens-bs16'
  rightmove_id   text unique,                      -- e.g. '93368586' when known
  address        text not null,
  price          integer,
  price_note     text not null default '',         -- 'Offers over', 'Guide price', ...
  beds           smallint,
  property_type  text not null default '',
  agent          text not null default '',
  phone          text not null default '',
  link           text not null default '',
  status         text not null default 'To review'
                 check (status in ('To review','Want to view','Called','Viewing booked',
                                   'Viewed','Offer made','Not for us','Sold / withdrawn')),
  notes          text not null default '',
  alert          text not null default '',         -- 'New listing' | 'Reduced' | 'Added by hand' | ...
  first_seen     date not null default current_date,
  source         text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index properties_status_idx on public.properties (status);
create trigger properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Viewings (only houses Jake is viewing - never buyers viewing 37 Springleaze)
-- ---------------------------------------------------------------------------
create table public.viewings (
  id                 text primary key,             -- 'YYYY-MM-DD-HHMM-street-slug'
  property_id        text references public.properties(id) on delete set null,
  starts_at          timestamptz not null,         -- write as '2026-09-30 17:00 Europe/London'
  address            text not null,
  agent              text not null default '',
  contact            text not null default '',
  with_whom          text not null default '',
  status             text not null default 'Confirmed'
                     check (status in ('Confirmed','Rescheduled','Cancelled','Done')),
  calendar_event_id  text,
  notes              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index viewings_starts_at_idx on public.viewings (starts_at);
create index viewings_property_id_idx on public.viewings (property_id);
create trigger viewings_touch before update on public.viewings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Scheduled-run bookkeeping (Claude only)
-- ---------------------------------------------------------------------------
create table public.sync_state (
  id                 smallint primary key default 1 check (id = 1),
  last_run           timestamptz,
  processed_threads  text[] not null default '{}'
);
alter table public.sync_state enable row level security;
-- no policies: invisible to the web app
insert into public.sync_state (id) values (1);

-- ---------------------------------------------------------------------------
-- Row level security for the web app
-- ---------------------------------------------------------------------------
alter table public.properties enable row level security;
alter table public.viewings   enable row level security;

create policy "allowed users read properties"   on public.properties for select to authenticated using ((select public.is_allowed()));
create policy "allowed users insert properties" on public.properties for insert to authenticated with check ((select public.is_allowed()));
create policy "allowed users update properties" on public.properties for update to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "allowed users delete properties" on public.properties for delete to authenticated using ((select public.is_allowed()));

create policy "allowed users read viewings"   on public.viewings for select to authenticated using ((select public.is_allowed()));
create policy "allowed users insert viewings" on public.viewings for insert to authenticated with check ((select public.is_allowed()));
create policy "allowed users update viewings" on public.viewings for update to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "allowed users delete viewings" on public.viewings for delete to authenticated using ((select public.is_allowed()));

-- ---------------------------------------------------------------------------
-- Live updates in the web app
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.properties, public.viewings;

-- ---------------------------------------------------------------------------
-- Allowed accounts: one shared login (the app only asks for the password).
-- Create this user in Supabase: Authentication -> Users -> Add user,
-- tick "Auto confirm", and set the shared password there.
-- ---------------------------------------------------------------------------
insert into public.allowed_users (email) values
  ('house-hunt@example.com');
