# McKenna House Hunt

A small web app for tracking houses from our Rightmove search, who to call, and upcoming viewings.

- **Database and sign-in:** Supabase (Postgres, one shared password login, row level security, live updates)
- **Front end:** static HTML, CSS and JS in `public/` with no build step, hosted on Vercel
- **Automation:** a scheduled Claude task runs at 7:45, 12:45 and 18:45 UK time. It reads Rightmove alerts and agents' viewing emails from Gmail, writes to the database through the Supabase connector, and adds viewings to Google Calendar.

## Layout

```
public/
  index.html   page shell
  styles.css   styles, with light and dark themes
  app.js       Supabase client, password sign-in, rendering, live updates
  config.js    Supabase URL and anon key (public values, safe to commit)
supabase/
  migrations/20260925090000_init.sql   schema, row level security, allowed users
```

## Data model

| table | purpose |
|---|---|
| `properties` | one row per house. `status` is one of: To review, Want to view, Called, Viewing booked, Viewed, Offer made, Not for us, Sold / withdrawn |
| `viewings` | houses we're viewing. `starts_at` is a timestamptz; Claude writes it as `'2026-09-30 17:00 Europe/London'` |
| `allowed_users` | accounts that may use the app (just the shared login, `house-hunt@example.com`). Only readable by the service role |
| `sync_state` | Claude's bookkeeping (last run time, Gmail thread IDs already processed). Hidden from the app |

Row level security: signed-in users can read and write `properties` and `viewings` only if their email is in `allowed_users`, so a stray sign-up can't see anything. Claude connects as the postgres role through the connector, which bypasses row level security.

## One-off setup

Supabase project `house-hunt` (ref `fkpcolgfgkhmyfuauirf`, London region) already has the migration applied and the data loaded.

1. **Create the shared login.** In Supabase, go to Authentication → Users → Add user → Create new user. Enter the email `house-hunt@example.com`, choose the password everyone will use, and tick **Auto Confirm User**.
2. **Turn off sign-ups.** In Authentication → Sign In / Providers, turn off "Allow new users to sign up". This is optional, because row level security already blocks any other account, but it keeps things tidy.
3. **Deploy.** Push this repo to GitHub, then in Vercel choose New Project → import the repo. Set Framework Preset to "Other", leave the build command empty, and set the output directory to `public`.

The app asks only for the password. It signs in as `house-hunt@example.com` behind the scenes, and the session is remembered on each device until someone clicks **Lock**.

## Run locally

```
npx serve public -l 5173
```

## Change the password

In Supabase, go to Authentication → Users → house-hunt@example.com → Reset password (or edit the user and set a new one), then tell everyone the new password.
