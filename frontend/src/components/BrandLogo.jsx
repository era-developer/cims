import React from 'react';
import { APP_LONG_NAME, APP_SHORT_NAME, APP_SUBTITLE } from '../brand';

export default function BrandLogo({ compact = false, dark = false, showSystemName = true }) {
  const blue = dark ? '#d7e6ff' : '#234d81';
  const orange = '#f9a825';
  const gray = dark ? 'rgba(255,255,255,0.82)' : '#6b7280';
  const textColor = dark ? '#ffffff' : '#1a1a2e';
  const innovationLabel = APP_SUBTITLE.replace('Comedkares ', '').toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '12px' : '16px' }}>
      <svg width={compact ? '60' : '88'} height={compact ? '52' : '76'} viewBox="0 0 220 170" fill="none" aria-hidden="true">
        <path d="M8 54L108 14L210 54L110 94L8 54Z" fill={blue} />
        <path d="M56 86L110 108L166 86V130L110 154L56 132V86Z" fill={orange} />
        <path d="M210 54V134" stroke={blue} strokeWidth="10" strokeLinecap="round" />
      </svg>
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '18px' : '32px', fontWeight: 800, letterSpacing: compact ? '0.02em' : '0.04em', color: textColor }}>
          COMED
          <span style={{ fontWeight: 400, color: blue, marginLeft: '6px' }}>KARES</span>
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '11px' : '15px', fontWeight: 600, letterSpacing: '0.32em', color: gray, marginTop: compact ? '4px' : '6px' }}>
          {innovationLabel}
        </div>
        {showSystemName && (
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? '10px' : '12px', fontWeight: 500, color: gray, marginTop: compact ? '5px' : '8px', maxWidth: compact ? '180px' : '360px', lineHeight: 1.4 }}>
            {compact ? `${APP_SHORT_NAME} - Inventory Management System` : APP_LONG_NAME}
          </div>
        )}
      </div>
    </div>
  );
}
