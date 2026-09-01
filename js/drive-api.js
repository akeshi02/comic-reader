// js/drive-api.js
// Thin wrapper around the Google Drive REST API v3.
// Uses a browser API key (restricted to the Drive API) rather than OAuth,
// so every file that's read must be shared "Anyone with the link".

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

class DriveApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

/**
 * Fetch a file's raw bytes from Drive using alt=media.
 * This goes straight to the binary — it skips the "can't scan this file
 * for viruses" interstitial you get from the normal drive.google.com UI.
 *
 * @param {string} fileId   Drive file ID
 * @param {string} apiKey   Browser API key restricted to the Drive API
 * @param {(loaded:number, total:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
async function fetchFileBlob(fileId, apiKey, onProgress) {
  if (!fileId) throw new DriveApiError('No file ID provided', 400);
  if (!apiKey) throw new DriveApiError('No API key configured', 400);

  const url = `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveApiError(
      describeDriveError(res.status, body),
      res.status
    );
  }

  // Stream with progress if the browser gives us a reader + content-length;
  // otherwise fall back to a plain blob() read.
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !onProgress || !total) {
    return res.blob();
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }

  return new Blob(chunks);
}

/**
 * Fetch metadata only (name, size, mimeType) — useful for validating a
 * file ID before adding it to the library, without downloading it.
 */
async function fetchFileMeta(fileId, apiKey) {
  const url = `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,modifiedTime,thumbnailLink&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveApiError(describeDriveError(res.status, body), res.status);
  }
  return res.json();
}

/**
 * List .pdf files in a given Drive folder (optional convenience helper —
 * lets a user point the library manager at a folder instead of pasting
 * individual file IDs).
 */
async function listPdfInFolder(folderId, apiKey) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and (name contains '.pdf' or mimeType = 'application/pdf')`
  );
  const fields = encodeURIComponent('files(id,name,size,modifiedTime,thumbnailLink)');
  const url = `${DRIVE_BASE}/files?q=${q}&fields=${fields}&pageSize=200&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveApiError(describeDriveError(res.status, body), res.status);
  }
  const data = await res.json();
  return data.files || [];
}

function describeDriveError(status, rawBody) {
  let apiMessage = '';
  try {
    const parsed = JSON.parse(rawBody);
    apiMessage = parsed?.error?.message || '';
  } catch {
    // rawBody wasn't JSON — ignore
  }

  switch (status) {
    case 400:
      return `Bad request${apiMessage ? `: ${apiMessage}` : '. Check the file ID.'}`;
    case 403:
      return 'Access denied. Make sure the API key is unrestricted for the Drive API for this origin, and the file is shared "Anyone with the link".';
    case 404:
      return 'File not found. Double-check the file ID and that it hasn\'t been moved to the trash.';
    default:
      return apiMessage || `Drive API request failed (HTTP ${status})`;
  }
}

export { fetchFileBlob, fetchFileMeta, listPdfInFolder, DriveApiError };
