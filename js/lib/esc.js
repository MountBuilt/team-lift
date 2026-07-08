// Escape a value for safe interpolation into HTML.
// Coerces non-strings via String(). No DOM/Firebase dependency — pure logic.
export function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Validate a value as a 6-digit hex color for safe use in a style attribute.
// Firestore field values are untrusted, so we whitelist rather than escape:
// a color must be a real hex to be meaningful, and anything else falls back.
export function safeColor(c, fallback = '#f97316') {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}
