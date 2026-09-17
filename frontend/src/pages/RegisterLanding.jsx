import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCenters } from '../context/CentersContext';
import { APP_LONG_NAME, ORG_NAME, PRIMARY_COLOR, LOGO_URL } from '../brand';

// Landing page for a center's registration link (/register/<centerId>).
// Styled inline like the rest of the app; the Tailwind classes it used to
// carry never applied because the project does not include Tailwind.
export default function RegisterLanding() {
  const { centerId } = useParams();
  const { centers, loading } = useCenters();
  const center = centers.find(c => c.id === centerId);

  const body = (() => {
    if (loading) return <p style={styles.muted}>Loading…</p>;
    if (!center) {
      return (
        <>
          <h2 style={styles.h2}>Center not found</h2>
          <p style={styles.muted}>This registration link is not valid. Ask your center for the correct one, or sign in below.</p>
          <Link to="/" style={{ ...styles.btn, ...styles.secondary }}>Go to sign in</Link>
        </>
      );
    }
    return (
      <>
        <h2 style={styles.h2}>Welcome to {center.name}</h2>
        <p style={styles.muted}>Register as a student to browse components, place requests for your projects and track returns.</p>
        <Link to={`/?register=1&centerId=${encodeURIComponent(centerId)}`} style={{ ...styles.btn, background: PRIMARY_COLOR, color: '#fff' }}>Register now</Link>
        <Link to="/" style={{ ...styles.btn, ...styles.secondary }}>I already have an account — sign in</Link>
      </>
    );
  })();

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src={LOGO_URL} alt={ORG_NAME} style={styles.logo} />
        <div style={styles.appName}>{APP_LONG_NAME}</div>
        <div style={styles.body}>{body}</div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'linear-gradient(160deg, #17355f 0%, #2d2a6e 100%)', fontFamily: "'DM Sans', sans-serif" },
  card: { background: '#fff', borderRadius: '18px', padding: '28px 26px', width: '100%', maxWidth: '440px', boxShadow: '0 30px 80px rgba(0,0,0,0.3)', textAlign: 'center' },
  logo: { height: '56px', width: 'auto', maxWidth: '100%', objectFit: 'contain' },
  appName: { fontSize: '12px', color: '#6b7280', fontWeight: 600, marginTop: '8px', marginBottom: '22px' },
  body: { display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' },
  h2: { fontSize: '20px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
  muted: { color: '#4b5563', fontSize: '14px', lineHeight: 1.55, margin: '0 0 6px' },
  btn: { display: 'block', textAlign: 'center', padding: '12px 14px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', textDecoration: 'none' },
  secondary: { background: '#f1f3f9', color: '#1a1a2e', border: '1px solid #d7dde9' },
};
