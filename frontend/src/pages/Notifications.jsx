import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import BackBar from '../components/BackBar';
import NotificationsCard from '../components/NotificationsCard';
import { formatWhen, kindIcon, KIND_LABELS } from '../utils/notificationsUi';

// Full history behind the bell: everything the portal has told this person,
// with read / unread state, oldest reachable by "Load more".
export default function Notifications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ before = null, append = false } = {}) => {
    setLoading(true); setError('');
    try {
      const res = await axios.get('/api/notifications', { params: { limit: 30, before: before || undefined, unread: unreadOnly ? 1 : undefined } });
      setItems(current => (append ? [...current, ...res.data.items] : res.data.items));
      setUnread(res.data.unread || 0);
      setHasMore(!!res.data.hasMore);
      setNextBefore(res.data.nextBefore);
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to load notifications');
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => { load(); }, [load]);

  async function open(item) {
    if (!item.read) {
      setItems(current => current.map(i => (i.id === item.id ? { ...i, read: true } : i)));
      setUnread(current => Math.max(0, current - 1));
      axios.put(`/api/notifications/${item.id}/read`).catch(() => {});
    }
    if (item.url) navigate(item.url);
  }

  async function markAll() {
    try {
      await axios.put('/api/notifications/read-all');
      setItems(current => current.map(i => ({ ...i, read: true })));
      setUnread(0);
      if (unreadOnly) load();
    } catch { /* keep state */ }
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <BackBar to={isAdmin ? '/admin' : '/dashboard'} label="Back to dashboard" />
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Notifications</h1>
          <p style={styles.sub}>{unread ? `${unread} unread` : 'All caught up'} · every update the portal has sent you, by e-mail, push or here.</p>
        </div>
        <div style={styles.headerActions}>
          <label style={styles.toggle}>
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
          {unread > 0 && <button type="button" style={styles.secondary} onClick={markAll}>Mark all read</button>}
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.card}>
        {!loading && !items.length && (
          <div style={styles.empty}>{unreadOnly ? 'No unread notifications.' : 'Nothing yet. Order updates, reminders and approvals will show up here.'}</div>
        )}
        {items.map(item => (
          <button type="button" key={item.id} style={{ ...styles.row, ...(item.read ? {} : styles.rowUnread) }} onClick={() => open(item)}>
            <span style={styles.icon} aria-hidden="true">{kindIcon(item.kind)}</span>
            <span style={styles.body}>
              <span style={styles.top}>
                <span style={styles.rowTitle}>{item.title}</span>
                <span style={styles.kind}>{KIND_LABELS[item.kind] || 'Update'}</span>
              </span>
              {item.body && <span style={styles.text}>{item.body}</span>}
              <span style={styles.meta}>{formatWhen(item.createdAt)}{item.read ? ` · read ${formatWhen(item.readAt)}` : ' · unread'}</span>
            </span>
            {!item.read && <span style={styles.dot} aria-label="Unread" />}
          </button>
        ))}
        {loading && <div style={styles.empty}>Loading…</div>}
        {hasMore && !loading && (
          <button type="button" style={styles.more} onClick={() => load({ before: nextBefore, append: true })}>Load older</button>
        )}
      </div>

      <NotificationsCard style={{ marginTop: '18px' }} />
    </div>
  );
}

const styles = {
  page: { maxWidth: '860px', margin: '0 auto', padding: '22px 24px 60px', fontFamily: "'DM Sans', sans-serif" },
  pageMobile: { padding: '14px 14px 40px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' },
  title: { fontSize: '26px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
  sub: { color: '#6b7280', fontSize: '14px', margin: '6px 0 0' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  toggle: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', fontWeight: 600, cursor: 'pointer' },
  secondary: { background: '#eef0fb', color: '#2d2a6e', border: '1px solid #d7d9f0', borderRadius: '10px', padding: '9px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  card: { background: '#fff', borderRadius: '14px', border: '1px solid #e3e8f2', boxShadow: '0 1px 3px rgba(16,37,72,0.04)', overflow: 'hidden' },
  empty: { padding: '28px 18px', color: '#6b7280', fontSize: '14px', textAlign: 'center' },
  row: { display: 'flex', gap: '12px', alignItems: 'flex-start', width: '100%', textAlign: 'left', background: '#fff', border: 'none', borderBottom: '1px solid #f1f3f9', padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' },
  rowUnread: { background: '#f6f7ff' },
  icon: { fontSize: '20px', lineHeight: 1.2, flexShrink: 0 },
  body: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 },
  top: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  rowTitle: { fontWeight: 700, fontSize: '14px', lineHeight: 1.3 },
  kind: { fontSize: '10.5px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', background: '#f1f3f9', padding: '2px 7px', borderRadius: '999px' },
  text: { fontSize: '13px', color: '#4b5563', lineHeight: 1.45 },
  meta: { fontSize: '11.5px', color: '#9ca3af', marginTop: '2px' },
  dot: { width: '9px', height: '9px', borderRadius: '50%', background: '#2d2a6e', flexShrink: 0, marginTop: '7px' },
  more: { display: 'block', width: '100%', padding: '13px', background: '#fafbfe', border: 'none', borderTop: '1px solid #eef1f7', color: '#2d2a6e', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '11px 14px', borderRadius: '10px', marginBottom: '14px' },
};
