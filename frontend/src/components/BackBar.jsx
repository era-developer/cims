import React from 'react';
import { useNavigate } from 'react-router-dom';

// The way back from any page that is not a top-level navbar destination
// (QR labels, a unit's page, a program, component details, analytics...).
// Always sits top-left above the page title so it is in the same place
// everywhere. Goes to the previous page when there is one in this tab's
// history; a page opened cold (a QR link, a pasted URL) falls back to the
// given `to` so the user is never stranded.
export default function BackBar({ to, label, style }) {
  const navigate = useNavigate();
  function goBack() {
    // idx > 0 means React Router pushed at least one entry in this tab.
    const hasHistory = typeof window !== 'undefined' && window.history.state && window.history.state.idx > 0;
    if (hasHistory) navigate(-1);
    else navigate(to || '/');
  }
  return (
    <button type="button" onClick={goBack} style={{ ...styles.btn, ...style }} aria-label={label || 'Back'}>
      <span style={styles.arrow}>←</span> {label || 'Back'}
    </button>
  );
}

const styles = {
  btn: { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: '#2d2a6e', fontWeight: 700, fontSize: '13px', cursor: 'pointer', padding: '6px 0', marginBottom: '8px', fontFamily: "'DM Sans', sans-serif" },
  arrow: { fontSize: '16px', lineHeight: 1 },
};
