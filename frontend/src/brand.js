// Org-level branding for the portal.
//
// This used to derive everything from a per-center subdomain lookup with
// "Comedkares Innovation Hub" hardcoded as the fallback -- fine when there was
// one organisation with nine centers, wrong now that the same codebase runs
// both CIMS (Comedkare) and KIMS (Kalam Pragati). The values below come from
// build-time env vars so a deployment is rebranded by its .env, not by a code
// change; the defaults are Comedkares'.
//
// Center-level theming (colour/logo per center) was only ever used by the
// subdomain-based Comedkare setup and is no longer applied here -- centers are
// created at runtime by a super admin and have no build-time brand assets.

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

export const ORG_NAME = env('REACT_APP_ORG_NAME', 'Comedkares Innovation Hub');
export const APP_SHORT_NAME = env('REACT_APP_APP_SHORT_NAME', 'CIMS');
export const APP_SUBTITLE = env('REACT_APP_ORG_TAGLINE', 'Innovation Hub');

export const APP_LONG_NAME = env(
  'REACT_APP_APP_LONG_NAME',
  `${ORG_NAME} Inventory Management System`
);
export const APP_EXPANDED_NAME = APP_LONG_NAME;

// Comedkares navy (matches --primary in public/index.html).
export const PRIMARY_COLOR = env('REACT_APP_PRIMARY_COLOR', '#1a237e');
export const LOGO_URL = env('REACT_APP_LOGO_URL', '/logo.png');

// The logo artwork already contains the wordmark and tagline, so the header
// renders the image alone rather than pairing it with a text wordmark.
export const LOGO_HAS_WORDMARK = env('REACT_APP_LOGO_HAS_WORDMARK', 'true') !== 'false';

export const REGISTRATION_QUERY = '?register=1';
