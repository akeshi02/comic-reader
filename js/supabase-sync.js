// js/supabase-sync.js
// Optional cloud sync: mirrors *metadata only* for Drive-backed comics
// (file ID, title, thumbnail, series) to a Supabase table, scoped to the
// signed-in user via Row Level Security. The PDFs themselves are never
// uploaded anywhere — a Drive-backed comic is already just a pointer
// (file ID + title), so syncing that pointer is enough to rebuild the
// library on any device. Locally-imported comics (source: 'local') are
// never synced, since their only copy is this device's IndexedDB — there
// is nothing in the cloud that could reconstruct them elsewhere.

import { loadSettings, saveSettings } from './library.js';

// Safe to ship in client code — this is Supabase's public "anon" key,
// meant to be embedded in the frontend. Access control comes from the
// Row Level Security policies on the `comics` table (see
// supabase/schema.sql), not from keeping this key secret. Baking it in
// here means a fresh device just works — no per-device setup step.
const DEFAULT_SUPABASE_URL = 'https://pyjkorggosbriqwqkdlz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_WNmiaeJVsY9EXLhZE4LUDA_Yl0lPF8_';

let client = null;
let currentUser = null;
const authListeners = [];

// A saved override (via the "Supabase project" panel) always wins, so
// switching to a different project still works — but with nothing saved,
// this falls back to the defaults above instead of requiring setup.
function getConfig() {
  const s = loadSettings();
  return {
    url: s.supabaseUrl || DEFAULT_SUPABASE_URL,
    anonKey: s.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY,
  };
}

function saveConfig(url, anonKey) {
  const s = loadSettings();
  s.supabaseUrl = url.trim();
  s.supabaseAnonKey = anonKey.trim();
  saveSettings(s);
}

function isConfigured() {
  const { url, anonKey } = getConfig();
  return !!(url && anonKey);
}

// Loaded from a CDN as an ES module — no build step, consistent with the
// rest of this app. Only fetched once, and only once a URL + anon key
// have actually been configured.
let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('https://esm.sh/@supabase/supabase-js@2');
  return sdkPromise;
}

async function initSupabase() {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) return null;
  const { createClient } = await loadSdk();
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    authListeners.forEach((fn) => fn(currentUser));
  });
  const { data } = await client.auth.getSession();
  currentUser = data?.session?.user || null;
  return client;
}

function onAuthChange(fn) {
  authListeners.push(fn);
}

function getUser() {
  return currentUser;
}

async function signUp(email, password) {
  if (!client) throw new Error('Set up your Supabase project first.');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  if (!client) throw new Error('Set up your Supabase project first.');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}

// ---------- comic row sync (metadata only — see schema.sql) ----------

function toRow(comic) {
  return {
    user_id: currentUser.id,
    file_id: comic.fileId,
    title: comic.title,
    thumbnail_link: comic.thumbnailLink || null,
    series: comic.series || null,
    added_at: comic.addedAt,
  };
}

function fromRow(row) {
  return {
    fileId: row.file_id,
    title: row.title,
    thumbnailLink: row.thumbnail_link,
    series: row.series,
    source: 'drive',
    addedAt: row.added_at,
    size: null,
  };
}

async function pullComics() {
  if (!client || !currentUser) return [];
  const { data, error } = await client
    .from('comics')
    .select('*')
    .eq('user_id', currentUser.id);
  if (error) throw error;
  return (data || []).map(fromRow);
}

async function pushComic(comic) {
  if (!client || !currentUser || comic.source === 'local') return;
  const { error } = await client
    .from('comics')
    .upsert(toRow(comic), { onConflict: 'user_id,file_id' });
  if (error) console.warn('Supabase sync: push failed —', error.message);
}

async function deleteComic(fileId) {
  if (!client || !currentUser) return;
  const { error } = await client
    .from('comics')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('file_id', fileId);
  if (error) console.warn('Supabase sync: delete failed —', error.message);
}

export {
  getConfig, saveConfig, isConfigured, initSupabase,
  onAuthChange, getUser,
  signUp, signIn, signOut,
  pullComics, pushComic, deleteComic,
};
