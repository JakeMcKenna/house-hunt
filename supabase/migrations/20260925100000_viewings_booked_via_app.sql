-- Viewings Jake books by phone from the app, awaiting the agent's confirmation email
alter table public.viewings
  add column booked_via text not null default 'email' check (booked_via in ('email','app')),
  add column email_confirmed_at timestamptz;
update public.viewings set email_confirmed_at = created_at where booked_via = 'email';
comment on column public.viewings.booked_via is 'email = created from an agent confirmation email; app = Jake logged it in the app after a phone call';
comment on column public.viewings.email_confirmed_at is 'When the agent''s confirmation email was matched. Null on an app-booked viewing = still waiting for the email (chase up).';
create index viewings_awaiting_email_idx on public.viewings (starts_at) where booked_via = 'app' and email_confirmed_at is null;
