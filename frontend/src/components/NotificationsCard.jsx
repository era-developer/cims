import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  isPushSupported, isIosBrowserWithoutInstall, getPushStatus, enablePush, disablePush, sendTestPush,
  isPromptDismissed, dismissPrompt,
} from '../utils/push';

// Browser notifications switch. Two shapes:
//
//   <NotificationsCard />            full card for My Profile / Settings:
//                                    on-off switch, device count, send test.
//   <NotificationsCard compact />    one-line nudge for the dashboards, shown
//                                    only while notifications are off on this
//                                    device and the person has not dismissed
//                                    it this week.
//
// Renders nothing where push cannot work (plain iOS Safari, http, old
// browsers) so nobody sees a button that cannot do anything.
export default function NotificationsCard({ compact = false, style }) {
  const { user } = useAuth();
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(compact && isPromptDismissed());

  useEffect(() => {
    let alive = true;
    getPushStatus().then(s => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);

  async function run(action, okMessage) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await action();
      setStatus(await getPushStatus());
      setMessage(result?.message || okMessage || '');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (!status || hidden) return null;
  if (!status.supported || !status.configured) {
    if (compact) return null;
    return (
      <div style={{ ...styles.card, ...style }}>
        <div style={styles.title}>Notifications</div>
        <p style={styles.muted}>
          {!status.configured && status.supported
            ? 'Browser notifications are not switched on for this server yet.'
            : isIosBrowserWithoutInstall()
              ? 'On iPhone and iPad, notifications work once the portal is added to the Home Screen: tap Share, then "Add to Home Screen", and open it from there.'
              : 'This browser cannot show notifications. Chrome, Edge or Firefox on a phone or laptop can.'}
        </p>
      </div>
    );
  }

  const blocked = status.permission === 'denied';
  const on = status.subscribed;
  const what = isAdmin
    ? 'new orders, return requests and student registrations'
    : 'order approvals, rejections and return reminders';

  if (compact) {
    if (on || blocked) return null;
    return (
      <div style={{ ...styles.banner, ...style }}>
        <span style={styles.bell} aria-hidden="true">🔔</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.bannerTitle}>Get notified on this device</div>
          <div style={styles.bannerSub}>Hear about {what} the moment they happen.</div>
          {error && <div style={styles.errorInline}>{error}</div>}
        </div>
        <button type="button" style={styles.primary} disabled={busy} onClick={() => run(enablePush, 'Notifications enabled')}>
          {busy ? 'Enabling…' : 'Enable'}
        </button>
        <button type="button" style={styles.ghost} onClick={() => { dismissPrompt(); setHidden(true); }} aria-label="Not now">
          Not now
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.card, ...style }}>
      <div style={styles.row}>
        <div>
          <div style={styles.title}>Notifications on this device</div>
          <p style={styles.muted}>
            {on
              ? `You will hear about ${what} here${status.devices > 1 ? ` (and on ${status.devices - 1} other device${status.devices > 2 ? 's' : ''})` : ''}.`
              : blocked
                ? 'Notifications are blocked for this site in the browser. Allow them from the address-bar site settings, then come back here.'
                : `Turn on to hear about ${what} the moment they happen, even when the portal is closed.`}
          </p>
        </div>
        <span style={{ ...styles.pill, ...(on ? styles.pillOn : styles.pillOff) }}>{on ? 'On' : 'Off'}</span>
      </div>
      {message && <div style={styles.success}>{message}</div>}
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.actions}>
        {!on && !blocked && (
          <button type="button" style={styles.primary} disabled={busy} onClick={() => run(enablePush, 'Notifications enabled')}>
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}
        {on && (
          <>
            <button type="button" style={styles.secondary} disabled={busy} onClick={() => run(sendTestPush)}>
              {busy ? 'Sending…' : 'Send me a test'}
            </button>
            <button type="button" style={styles.ghost} disabled={busy} onClick={() => run(disablePush, 'Notifications turned off on this device')}>
              Turn off
            </button>
          </>
        )}
      </div>
      {!isPushSupported() ? null : isIosBrowserWithoutInstall() && (
        <p style={styles.hint}>On iPhone/iPad, add the portal to your Home Screen first (Share → Add to Home Screen).</p>
      )}
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: '14px', border: '1px solid #e3e8f2', padding: '18px 20px', boxShadow: '0 1px 3px rgba(16,37,72,0.04)', fontFamily: "'DM Sans', sans-serif" },
  row: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
  title: { fontSize: '15px', fontWeight: 800, color: '#1a1a2e' },
  muted: { color: '#4b5563', fontSize: '13px', lineHeight: 1.55, margin: '6px 0 0' },
  hint: { color: '#6b7280', fontSize: '12px', margin: '10px 0 0' },
  pill: { fontSize: '11px', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', flexShrink: 0, letterSpacing: '0.04em' },
  pillOn: { background: '#e8f5e9', color: '#2e7d32' },
  pillOff: { background: '#f1f3f9', color: '#6b7280' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' },
  primary: { background: '#2d2a6e', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 16px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  secondary: { background: '#eef0fb', color: '#2d2a6e', border: '1px solid #d7d9f0', borderRadius: '10px', padding: '10px 16px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  ghost: { background: 'transparent', color: '#4b5563', border: '1px solid #d7dde9', borderRadius: '10px', padding: '10px 14px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  success: { background: '#e8f5e9', color: '#2e7d32', padding: '9px 12px', borderRadius: '9px', fontSize: '13px', marginTop: '12px' },
  error: { background: '#fef2f2', color: '#b91c1c', padding: '9px 12px', borderRadius: '9px', fontSize: '13px', marginTop: '12px' },
  errorInline: { color: '#b91c1c', fontSize: '12px', marginTop: '4px' },
  banner: { display: 'flex', alignItems: 'center', gap: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '12px 14px', fontFamily: "'DM Sans', sans-serif", flexWrap: 'wrap' },
  bell: { fontSize: '20px' },
  bannerTitle: { fontWeight: 800, fontSize: '14px', color: '#1a1a2e' },
  bannerSub: { fontSize: '12.5px', color: '#4b5563', marginTop: '2px' },
};
