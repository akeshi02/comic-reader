-- Run this in Supabase's SQL Editor (Project → SQL Editor → New query).
-- Stores only comic metadata + the Drive link — never the PDF bytes.

create table if not exists public.library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id text not null,                 -- Drive file ID (or "local-..." for
                                          -- device-only comics, which are
                                          -- never pushed up — see app.js)
  title text not null,
  size bigint,
  thumbnail_link text,
  source text not null default 'drive',
  series text,
  added_at timestamptz not null default now(),
  last_page_read integer not null default 0,
  unique (user_id, file_id)
);

-- Row Level Security: a user can only ever see/change their own rows.
-- This is what makes it safe to use the publishable key in the browser.
alter table public.library enable row level security;

create policy "Users can view own library"
  on public.library for select
  using (auth.uid() = user_id);

create policy "Users can insert own library rows"
  on public.library for insert
  with check (auth.uid() = user_id);

create policy "Users can update own library rows"
  on public.library for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own library rows"
  on public.library for delete
  using (auth.uid() = user_id);
