// js/supabase-client.js
// Thin wrapper around Supabase auth + the `library` table. localStorage
// (via library.js) stays the source of truth for offline use; this file is
// what keeps it in sync with the user's account when they're signed in.
// Only metadata is ever stored remotely — never PDF bytes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://pyjkorggosbriqwqkdlz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WNmiaeJVsY9EXLhZE4LUDA_Yl0lPF8_';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- auth ---

async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Fires immediately with the current session, then again on every
// sign-in/sign-out/token-refresh. Returns the subscription so callers
// could unsubscribe, though this app never needs to.
function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

// --- library table sync ---
// `fileId` doubles as the Drive file ID. Comics with source === 'local'
// (imported straight from device storage) are deliberately never pushed
// here — their only copy is this browser's IndexedDB, so a metadata row
// with no matching PDF anywhere would just be a broken entry on another
// device. Callers are expected to filter those out before calling in.

function rowToComic(row) {
  return {
    fileId: row.file_id,
    title: row.title,
    size: row.size,
    thumbnailLink: row.thumbnail_link,
    source: row.source,
    series: row.series || null,
    addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
    lastPageRead: row.last_page_read || 0,
  };
}

function comicToRow(comic, userId) {
  return {
    user_id: userId,
    file_id: comic.fileId,
    title: comic.title,
    size: comic.size ?? null,
    thumbnail_link: comic.thumbnailLink ?? null,
    source: comic.source ?? 'drive',
    series: comic.series ?? null,
    added_at: comic.addedAt ? new Date(comic.addedAt).toISOString() : new Date().toISOString(),
    last_page_read: comic.lastPageRead ?? 0,
  };
}

async function fetchRemoteLibrary() {
  const { data, error } = await supabase.from('library').select('*');
  if (error) throw error;
  return (data || []).map(rowToComic);
}

async function upsertRemoteComic(comic, userId) {
  const { error } = await supabase
    .from('library')
    .upsert(comicToRow(comic, userId), { onConflict: 'user_id,file_id' });
  if (error) throw error;
}

async function deleteRemoteComic(fileId) {
  const { error } = await supabase.from('library').delete().eq('file_id', fileId);
  if (error) throw error;
}

async function updateRemoteProgress(fileId, pageIndex) {
  const { error } = await supabase
    .from('library')
    .update({ last_page_read: pageIndex })
    .eq('file_id', fileId);
  if (error) throw error;
}

export {
  signUp,
  signIn,
  signOut,
  getSession,
  onAuthChange,
  fetchRemoteLibrary,
  upsertRemoteComic,
  deleteRemoteComic,
  updateRemoteProgress,
};
