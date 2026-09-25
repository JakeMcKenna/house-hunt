-- Secret token for the public iCal feed (supabase/functions/viewings-ics)
create table public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
create policy "allowed users read app settings" on public.app_settings
  for select to authenticated using ((select public.is_allowed()));
insert into public.app_settings (key, value)
values ('ical_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
comment on table public.app_settings is 'Small key/value settings. ical_token = secret in the calendar feed URL (rotate by updating it).';
