# Personal Productivity Assistant

Initial authenticated app shell for a private productivity assistant.

## Local setup

1. Create a Supabase project and enable Email authentication.
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key. Do not use or expose a service-role key in this application.
3. Apply `supabase/migrations/20260730000000_create_profiles.sql` through the Supabase CLI or SQL Editor.
4. In Supabase Auth URL Configuration, add `http://localhost:3000/auth/callback` and the matching production URL as redirect URLs.
5. Run `npm install` then `npm run dev`.

The Supabase publishable/anon key is intentionally browser-visible and is protected by Row Level Security. All private credentials must remain server-only and outside version control.
