import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import useViewport from '../hooks/useViewport';
import { timeAgo, kindIcon } from '../utils/notificationsUi';

// The bell in the navbar: unread badge, a dropdown with the latest entries,
// mark-all-read, and a way into the full history page. Refreshes on a slow
// poll, whenever the tab regains focus, and instantly when the service
// worker reports a push arriving while the portal is open.
const POLL_MS = 60 * 1000;

export default function NotificationBell() {
  const navigate = useNavigate();
  const { isMobile } = useViewport();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // The bell can sit anywhere along the navbar depending on wrap; anchor the
  // panel to whichever side has room so it never runs off screen.
  const [alignLeft, setAlignLeft] = useState(false);
  const [panelTop, setPanelTop] = useState(70);
  const wrapRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await axios.get('/api/notifications/unread-count');
      setUnread(res.data.unread || 0);
    } catch { /* offline or signed out; badge just stays */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/notifications', { params: { limit: 12 } });
      setItems(res.data.items || []);
      setUnread(res.data.unread || 0);
    } catch { /* leave whatever we had */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    const onFocus = () => refreshCount();
    const onSwMessage = event => { if (event.data?.type === 'PUSH_RECEIVED') { refreshCount(); if (open) loadList(); } };
    window.addEventListener('focus', onFocus);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage);
    };
  }, [refreshCount, loadList, open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = event => { if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false); };
    const onKey = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function toggle() {
    const next = !open;
    if (next && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setAlignLeft(rect.right < 400);
      setPanelTop(Math.round(rect.bottom + 8));
    }
    setOpen(next);
    if (next) loadList();
  }

  async function openItem(item) {
    setOpen(false);
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
    } catch { /* keep state */ }
  }

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button type="button" style={styles.bellBtn} onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} title="Notifications">
        <BellIcon />
        {unread > 0 && <span style={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div style={{ ...styles.panel, ...(alignLeft ? styles.panelLeft : {}), ...(isMobile ? { ...styles.panelMobile, top: panelTop } : {}) }} role="dialog" aria-label="Notifications">
          <div style={styles.panelHead}>
            <span style={styles.panelTitle}>Notifications</span>
            <div style={styles.panelActions}>
              {unread > 0 && <button type="button" style={styles.linkBtn} onClick={markAll}>Mark all read</button>}
              <button type="button" style={styles.linkBtn} onClick={() => { setOpen(false); navigate('/notifications'); }}>See all</button>
            </div>
          </div>
          <div style={styles.list}>
            {loading && !items.length && <div style={styles.empty}>Loading…</div>}
            {!loading && !items.length && <div style={styles.empty}>Nothing yet. Order updates and reminders will appear here.</div>}
            {items.map(item => (
              <button type="button" key={item.id} style={{ ...styles.item, ...(item.read ? {} : styles.itemUnread) }} onClick={() => openItem(item)}>
                <span style={styles.itemIcon} aria-hidden="true">{kindIcon(item.kind)}</span>
                <span style={styles.itemBody}>
                  <span style={styles.itemTitle}>{item.title}</span>
                  {item.body && <span style={styles.itemText}>{item.body}</span>}
                  <span style={styles.itemTime}>{timeAgo(item.createdAt)}</span>
                </span>
                {!item.read && <span style={styles.dot} aria-label="Unread" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

const styles = {
  wrap: { position: 'relative', flexShrink: 0 },
  bellBtn: { position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer' },
  badge: { position: 'absolute', top: '-6px', right: '-6px', minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '999px', background: '#f9a825', color: '#102548', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #17355f', boxSizing: 'content-box' },
  panel: { position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: '380px', maxWidth: 'calc(100vw - 24px)', background: '#fff', color: '#1a1a2e', borderRadius: '14px', boxShadow: '0 20px 60px rgba(16,37,72,0.28)', border: '1px solid #e3e8f2', zIndex: 200, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" },
  panelLeft: { right: 'auto', left: 0 },
  panelMobile: { position: 'fixed', left: '12px', right: '12px', top: '70px', width: 'auto' },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #eef1f7' },
  panelTitle: { fontWeight: 800, fontSize: '14px' },
  panelActions: { display: 'flex', gap: '12px' },
  linkBtn: { background: 'none', border: 'none', color: '#2d2a6e', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  list: { maxHeight: '60vh', overflowY: 'auto' },
  empty: { padding: '22px 16px', color: '#6b7280', fontSize: '13px', textAlign: 'center' },
  item: { display: 'flex', gap: '10px', alignItems: 'flex-start', width: '100%', textAlign: 'left', background: '#fff', border: 'none', borderBottom: '1px solid #f1f3f9', padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' },
  itemUnread: { background: '#f6f7ff' },
  itemIcon: { fontSize: '18px', lineHeight: 1.2, flexShrink: 0 },
  itemBody: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 },
  itemTitle: { fontWeight: 700, fontSize: '13.5px', lineHeight: 1.3 },
  itemText: { fontSize: '12.5px', color: '#4b5563', lineHeight: 1.4 },
  itemTime: { fontSize: '11px', color: '#9ca3af', marginTop: '2px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', background: '#2d2a6e', flexShrink: 0, marginTop: '6px' },
};
