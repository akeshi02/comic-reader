// js/library.js
// Client-side library: maps Drive File IDs -> comic metadata.
// Persisted in localStorage so nothing server-side is needed.

const LIB_KEY = 'comicreader.library.v1';
const SETTINGS_KEY = 'comicreader.settings.v1';
const PROGRESS_KEY = 'comicreader.progress.v1';

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLibrary(items) {
  localStorage.setItem(LIB_KEY, JSON.stringify(items));
}

function addComic({ fileId, title, size = null, thumbnailLink = null, source = 'drive' }) {
  const items = loadLibrary();
  if (items.some((c) => c.fileId === fileId)) {
    throw new Error('This file ID is already in your library.');
  }
  const comic = {
    fileId,
    title: title?.trim() || fileId,
    size,
    thumbnailLink,
    source, // 'drive' (fetched via Drive API) or 'local' (imported from device, no network needed)
    addedAt: Date.now(),
  };
  items.push(comic);
  saveLibrary(items);
  return comic;
}

function removeComic(fileId) {
  const items = loadLibrary().filter((c) => c.fileId !== fileId);
  saveLibrary(items);
  clearProgress(fileId);
}

function updateComic(fileId, patch) {
  const items = loadLibrary();
  const idx = items.findIndex((c) => c.fileId === fileId);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveLibrary(items);
  return items[idx];
}

// --- series grouping: combine same-series volumes/chapters into one folder ---

// Matches a trailing volume/chapter/issue/book/part marker + number, e.g.
// " Vol. 3", " Chapter 12", " Bk 2", " #7", " Part III" (roman numerals up
// to a few digits) — so it can be stripped off a title to recover the bare
// series name it belongs to.
const ROMAN = 'M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})';
const VOLUME_SUFFIX = new RegExp(
  `\\s*[-–—:,]?\\s*(?:` +
  `(?:vol(?:ume)?|ch(?:apter|ap)?|bk|book|part|pt|issue|iss|no|number|episode|ep)\\.?\\s*#?\\s*(?:\\d+(?:\\.\\d+)?|${ROMAN})` +
  `|#\\s*\\d+(?:\\.\\d+)?` +
  `)\\s*$`,
  'i'
);

// Strips a trailing volume/chapter/issue marker off a title to recover the
// series it belongs to, e.g. "Saga Vol. 3" -> "Saga", "Berserk #34" ->
// "Berserk". Repeats in case a title has more than one marker chained on
// the end (rare, but harmless to handle). Falls back to the original title
// untouched if stripping would empty it out (e.g. a one-shot literally
// titled "Book One").
function deriveSeriesTitle(title) {
  const original = (title || '').trim();
  let stripped = original;
  let prev;
  do {
    prev = stripped;
    stripped = stripped.replace(VOLUME_SUFFIX, '').trim();
  } while (stripped !== prev && stripped.length > 0);
  return stripped || original;
}

// The grouping key for a comic: an explicit `comic.series` (set via
// setComicSeries, for when auto-detection guesses wrong) wins over the
// title-derived series name. Case-insensitive so "Saga" and "SAGA" land in
// the same folder.
function seriesKeyFor(comic) {
  const display = (comic.series && comic.series.trim()) || deriveSeriesTitle(comic.title);
  return display.toLowerCase();
}

// Manually assigns (or clears, with an empty/null series) which series a
// comic belongs to, overriding auto-detection from its title. Use this to
// fix a mis-grouped comic or to pull one out of a folder into its own.
function setComicSeries(fileId, series) {
  return updateComic(fileId, { series: series?.trim() || null });
}

// Picks out the first number in a title (volume/chapter/issue number) so a
// folder's comics can be sorted in reading order rather than by add date.
function firstNumber(title) {
  const m = (title || '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function compareWithinSeries(a, b) {
  const na = firstNumber(a.title);
  const nb = firstNumber(b.title);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;
  return (a.addedAt || 0) - (b.addedAt || 0);
}

// Groups the library into series folders. Every folder is keyed on its
// series name, so it only ever contains comics that share that exact
// series — nothing unrelated can end up in it. A "folder" is only created
// once a series has 2+ comics in the library; a series with just one comic
// so far is returned in `singles` instead of becoming a one-item folder,
// since a folder for one issue isn't useful yet — it'll turn into a real
// folder automatically the moment a second volume of it is added.
function groupBySeries(items) {
  const byKey = new Map();
  items.forEach((comic) => {
    const key = seriesKeyFor(comic);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        seriesTitle: (comic.series && comic.series.trim()) || deriveSeriesTitle(comic.title),
        comics: [],
      });
    }
    byKey.get(key).comics.push(comic);
  });

  const folders = [];
  const singles = [];
  byKey.forEach((group) => {
    if (group.comics.length > 1) {
      group.comics.sort(compareWithinSeries);
      folders.push(group);
    } else {
      singles.push(group.comics[0]);
    }
  });
  folders.sort((a, b) => a.seriesTitle.localeCompare(b.seriesTitle));

  return { folders, singles };
}

// --- reading progress: which page a comic was left on ---

function loadProgressMap() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getProgress(fileId) {
  return loadProgressMap()[fileId] || 0;
}

function setProgress(fileId, pageIndex) {
  const map = loadProgressMap();
  map[fileId] = pageIndex;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

function clearProgress(fileId) {
  const map = loadProgressMap();
  delete map[fileId];
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

// --- settings: API key lives here, restricted to this browser's storage ---

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { apiKey: '', supabaseUrl: '', supabaseAnonKey: '' };
  } catch {
    return { apiKey: '', supabaseUrl: '', supabaseAnonKey: '' };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// --- cloud sync merge: folds Supabase rows into the local library ---

// Unions cloud-synced comics (metadata only — see supabase-sync.js) into
// the local library. Never deletes a local comic just because the cloud
// doesn't have it (e.g. it hasn't been pushed yet, or the device is mid
// sign-up) — it only adds what's missing and refreshes fields on matches,
// so a flaky pull can't destructively wipe anything out.
function mergeCloudComics(cloudItems) {
  const items = loadLibrary();
  const byId = new Map(items.map((c) => [c.fileId, c]));
  let changed = false;
  cloudItems.forEach((cloud) => {
    const existing = byId.get(cloud.fileId);
    if (!existing) {
      items.push(cloud);
      changed = true;
      return;
    }
    if (
      existing.title !== cloud.title ||
      existing.thumbnailLink !== cloud.thumbnailLink ||
      existing.series !== cloud.series
    ) {
      existing.title = cloud.title;
      existing.thumbnailLink = cloud.thumbnailLink;
      existing.series = cloud.series;
      changed = true;
    }
  });
  if (changed) saveLibrary(items);
  return changed;
}

export {
  loadLibrary,
  saveLibrary,
  addComic,
  removeComic,
  updateComic,
  getProgress,
  setProgress,
  clearProgress,
  loadSettings,
  saveSettings,
  deriveSeriesTitle,
  setComicSeries,
  groupBySeries,
  mergeCloudComics,
};
