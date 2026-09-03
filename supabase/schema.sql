-- Run this once in Supabase: Database > SQL Editor > New query > paste > Run.
-- Creates the "comics" table Gutter syncs Drive-comic metadata (never the
-- PDFs themselves) into, scoped per-user via Row Level Security.

create table if not exists public.comics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id text not null,
  title text not null,
  thumbnail_link text,
  series text,
  added_at bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, file_id)
);

create index if not exists comics_user_id_idx on public.comics (user_id);

alter table public.comics enable row level security;

create policy "Users can view their own comics"
  on public.comics for select
  using (auth.uid() = user_id);

create policy "Users can insert their own comics"
  on public.comics for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own comics"
  on public.comics for update
  using (auth.uid() = user_id);

create policy "Users can delete their own comics"
  on public.comics for delete
  using (auth.uid() = user_id);
