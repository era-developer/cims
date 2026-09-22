import React from 'react';
import {
  APP_LONG_NAME,
  APP_SHORT_NAME,
  APP_SUBTITLE,
  LOGO_URL,
  LOGO_HAS_WORDMARK,
  ORG_NAME,
  PRIMARY_COLOR,
} from '../brand';

// Renders the org logo plus the system name.
//
// Previously this drew a hand-built SVG mark and the literal words
// "COMED"/"KARES", which meant the component could only ever show one
// organisation's brand. It now renders whatever LOGO_URL points at. Logos that
// already include the organisation's wordmark (Comedkares' does) suppress
// the text wordmark via LOGO_HAS_WORDMARK so it is not printed twice.
export default function BrandLogo({ compact = false, dark = false, showSystemName = true }) {
  const gray = dark ? 'rgba(255,255,255,0.82)' : '#6b7280';
  const textColor = dark ? '#ffffff' : '#1a1a2e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '12px' : '16px' }}>
      {/* The artwork is navy line art on transparent. On the dark navbar it is
          placed on a white chip rather than colour-inverted: a brightness/
          invert filter turns the fine portrait linework into a solid white
          silhouette, which is exactly what it looked like. */}
      <div
        style={{
          background: dark ? '#ffffff' : 'transparent',
          borderRadius: dark ? '10px' : 0,
          padding: dark ? (compact ? '4px 10px' : '8px 14px') : 0,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <img
          src={LOGO_URL}
          alt={ORG_NAME}
          style={{
            height: compact ? '34px' : '64px',
            width: 'auto',
            // The artwork is a wide lockup (~3.3:1); capping the width keeps
            // it from crowding the nav on narrow screens.
            maxWidth: compact ? '180px' : '320px',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {(!LOGO_HAS_WORDMARK || showSystemName) && (
        <div style={{ lineHeight: 1 }}>
          {!LOGO_HAS_WORDMARK && (
            <>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '18px' : '32px', fontWeight: 800, letterSpacing: compact ? '0.02em' : '0.04em', color: textColor }}>
                {ORG_NAME}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '11px' : '15px', fontWeight: 600, letterSpacing: '0.32em', color: dark ? gray : PRIMARY_COLOR, marginTop: compact ? '4px' : '6px' }}>
                {APP_SUBTITLE.toUpperCase()}
              </div>
            </>
          )}
          {showSystemName && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '10px' : '12px', fontWeight: 500, color: gray, marginTop: LOGO_HAS_WORDMARK ? 0 : (compact ? '5px' : '8px'), maxWidth: compact ? '180px' : '360px', lineHeight: 1.4 }}>
              {compact ? `${APP_SHORT_NAME} - Inventory Management System` : APP_LONG_NAME}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
