/**
 * Canonical action id + HTML entity helpers for button extraction.
 */

export function decodeHtmlEntities(s = '') {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&apos;/gi, "'");
}

export function slugifyActionId(str = '') {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}

/**
 * Prefer data-action attribute — never slugify visible label when data-action exists.
 */
export function canonicalActionId(dataAction = '', btnId = '', label = '') {
  const da = decodeHtmlEntities(dataAction).trim();
  if (da) return slugifyActionId(da);
  const id = (btnId || '').trim();
  if (id) return slugifyActionId(id);
  return slugifyActionId(decodeHtmlEntities(label));
}

/**
 * Extract data-action from button attrs or nearest ancestor in HTML slice.
 */
export function extractDataActionFromContext(attrs = '', html = '', btnIndex = 0) {
  const onBtn = attrs.match(/data-action=["']([^"']+)["']/i)?.[1];
  if (onBtn?.trim()) return decodeHtmlEntities(onBtn).trim();

  const slice = html.slice(Math.max(0, btnIndex - 400), btnIndex + 80);
  const matches = [...slice.matchAll(/data-action=["']([^"']+)["']/gi)];
  if (matches.length) return decodeHtmlEntities(matches[matches.length - 1][1]).trim();
  return '';
}
