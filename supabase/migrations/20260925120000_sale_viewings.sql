-- Buyers viewing our own house (37 Springleaze), kept apart from the house hunt
create table public.sale_viewings (
  id           text primary key,                 -- 'YYYY-MM-DD-HHMM-viewer-slug'
  starts_at    timestamptz not null,
  viewer       text not null default '',          -- buyer's name as the agent gives it
  agent        text not null default 'Garrett Bradly',
  agent_contact text not null default '',         -- who is accompanying / sent it
  status       text not null default 'Confirmed'
               check (status in ('Confirmed','Rescheduled','Cancelled','Done')),
  feedback     text not null default '',          -- agent's feedback after the viewing
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index sale_viewings_starts_at_idx on public.sale_viewings (starts_at);
create trigger sale_viewings_touch before update on public.sale_viewings
  for each row execute function public.touch_updated_at();
alter table public.sale_viewings enable row level security;
create policy "allowed users read sale viewings"   on public.sale_viewings for select to authenticated using ((select public.is_allowed()));
create policy "allowed users insert sale viewings" on public.sale_viewings for insert to authenticated with check ((select public.is_allowed()));
create policy "allowed users update sale viewings" on public.sale_viewings for update to authenticated using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "allowed users delete sale viewings" on public.sale_viewings for delete to authenticated using ((select public.is_allowed()));
alter publication supabase_realtime add table public.sale_viewings;

-- Separate secret for the 37 Springleaze calendar feed (viewings-ics?feed=sale)
insert into public.app_settings (key, value)
values ('sale_ical_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
