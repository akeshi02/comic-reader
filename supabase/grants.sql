-- Run this in Supabase: SQL Editor > New query > paste > Run.
-- Fixes the 403 error: tables created via raw SQL (rather than the Table
-- Editor UI) don't automatically get privilege grants for the
-- "authenticated" role. RLS policies only run *after* this base grant
-- check passes, so without this, every request gets rejected before your
-- policies are even evaluated.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.comics to authenticated;
