// Firestore REST helpers for the sender pipeline. Public client identifiers
// (same key the web app ships in js/config.js), not secrets.
export const KEY = 'AIzaSyAWOzfMn7YjxaqSr2qx6zTLRE0_xs9VpZI';
export const BASE = 'https://firestore.googleapis.com/v1/projects/team-lift-app/databases/(default)/documents';

export function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decodeValue(v)]));
}

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encodeValue(v)]));
}

// Firestore only accepts bare field-path segments matching
// [A-Za-z_][A-Za-z0-9_]*; anything else (entry ids contain hyphens) must be
// backtick-quoted.
export function maskPath(...segments) {
  return segments
    .map(s => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '`' + s + '`'))
    .join('.');
}

export function buildPatchUrl(docPath, fieldPaths) {
  const mask = fieldPaths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
  return `${BASE}/${docPath}?key=${KEY}&${mask}`;
}

const docIdOf = (doc) => doc.name.slice(doc.name.lastIndexOf('/') + 1);

export async function fetchCollection(name) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${name}?key=${KEY}&pageSize=300` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GET ${name}: HTTP ${resp.status}`);
    const json = await resp.json();
    for (const d of json.documents || []) out.push({ id: docIdOf(d), ...decodeFields(d.fields) });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function fetchDoc(path) {
  const resp = await fetch(`${BASE}/${path}?key=${KEY}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GET ${path}: HTTP ${resp.status}`);
  return decodeFields((await resp.json()).fields);
}

export async function patchDoc(docPath, obj, fieldPaths) {
  const resp = await fetch(buildPatchUrl(docPath, fieldPaths), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeFields(obj) })
  });
  if (!resp.ok) throw new Error(`PATCH ${docPath}: HTTP ${resp.status} ${await resp.text()}`);
}
