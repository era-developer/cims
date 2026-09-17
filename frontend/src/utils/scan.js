// What a QR label encodes, and how to read one back.
//
// Labels carry a link to the portal with the tag as a query parameter
// (https://kalampragati.s.gy/kims?unit=AKTU-ELEC-00001) so that ANY phone
// camera -- a student's, with no app open -- lands on the unit's page. The
// in-app scanner accepts that link, a /unit/<tag> path, or a bare tag.

const SITE_URL = (process.env.REACT_APP_SITE_URL
  || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');

export function unitLabelUrl(tag) {
  return `${SITE_URL}?unit=${encodeURIComponent(tag)}`;
}

export function extractTagFromScan(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('unit');
    if (fromQuery) return fromQuery.trim().toUpperCase();
    const fromPath = url.pathname.match(/\/unit\/([^/?#]+)/);
    if (fromPath) return decodeURIComponent(fromPath[1]).trim().toUpperCase();
  } catch {
    // not a URL -- treat as a bare tag
  }
  return raw.toUpperCase();
}
