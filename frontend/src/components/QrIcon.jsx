import React from 'react';

// The "scan" glyph used on every scan button: a QR-style square with
// viewfinder corners. Inline SVG so it inherits the button's text colour.
export default function QrIcon({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3" />
      <path d="M16 4h3a1 1 0 0 1 1 1v3" />
      <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="8" y="8" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="13" y="8" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="8" y="13" width="3" height="3" fill="currentColor" stroke="none" />
      <path d="M13 13h3v3h-3z" />
    </svg>
  );
}
