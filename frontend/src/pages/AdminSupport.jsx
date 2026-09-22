import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCenters } from '../context/CentersContext';
import useViewport from '../hooks/useViewport';
import { formatWhen } from '../utils/notificationsUi';

// Admin -> Support: every question asked from the Help bubble, for this
// center (admin) or every center (super admin). Open questions first. A
// reply goes to the asker's Help panel, bell, push and email.
//
// ?thread=<id> (from a notification or email link) opens that question;
// ?q= (navbar search) filters the list.

const STATUS_META = {
  open: { label: 'Open', color: '#b45309', bg: '#fff7ed' },
  answered: { label: 'Answered', color: '#047857', bg: '#ecfdf5' },
  closed: { label: 'Closed', color: '#4b5563', bg: '#f3f4f6' },
};

const FILTERS = [
  { key: '', label: 'Needs attention' },
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

export default function AdminSupport() {
  const { user } = useAuth();
  const { centers } = useCenters();
  const { isMobile } = useViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSuperAdmin = user?.role === 'super_admin';

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [centerFilter, setCenterFilter] = useState('');
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [active, setActive] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => { setSearch(searchParams.get('q') || ''); }, [searchParams]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scope: 'inbox', status: statusFilter || undefined, limit: 100 };
      if (isSuperAdmin && centerFilter) params.centerId = centerFilter;
      const { data } = await axios.get('/api/support/threads', { params });
      setThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to load questions');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, centerFilter, isSuperAdmin]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (id) => {
    setError('');
    try {
      const { data } = await axios.get(`/api/support/threads/${id}`);
      setActive(data);
      setReply('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to open that question');
    }
  }, []);

  // Deep link from a notification / email.
  useEffect(() => {
    const wanted = searchParams.get('thread');
    if (wanted && /^\d+$/.test(wanted)) {
      openThread(Number(wanted));
      const next = new URLSearchParams(searchParams);
      next.delete('thread');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openThread]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active?.messages?.length, active?.thread?.id]);

  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => threads.filter(t => {
    if (!needle) return true;
    return [t.subject, t.userName, t.username, t.centerName, t.lastMessage?.body, `#${t.id}`]
      .filter(Boolean).join(' ').toLowerCase().includes(needle);
  }), [threads, needle]);

  const openCount = useMemo(() => threads.filter(t => t.status === 'open').length, [threads]);

  async function submitReply(event) {
    event.preventDefault();
    if (!reply.trim() || busy || !active) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post(`/api/support/threads/${active.thread.id}/messages`, { message: reply });
      setActive(data);
      setReply('');
      loadThreads();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to send the reply');
    } finally {
      setBusy(false);
    }
  }

  async function setClosed(closed) {
    if (!active || busy) return;
    setBusy(true);
    try {
      const { data } = await axios.put(`/api/support/threads/${active.thread.id}/${closed ? 'close' : 'reopen'}`);
      setActive(data);
      loadThreads();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to update the question');
    } finally {
      setBusy(false);
    }
  }

  function updateSearch(value) {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value); else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  const showList = !isMobile || !active;
  const showThread = !isMobile || !!active;

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <p style={styles.label}>Support inbox</p>
          <h1 style={styles.heroTitle}>Questions from the Help bubble</h1>
          <p style={styles.heroText}>
            {openCount ? `${openCount} waiting for a reply. ` : 'Nothing waiting right now. '}
            Replies reach the person in their Help panel, bell, phone notification and email.
          </p>
        </div>
      </header>

      <div style={{ ...styles.filterRow, ...(isMobile ? styles.filterRowMobile : {}) }}>
        <div style={styles.tabs}>
          {FILTERS.map(f => (
            <button
              key={f.key || 'attention'}
              type="button"
              style={{ ...styles.tab, ...(statusFilter === f.key ? styles.tabActive : {}) }}
              onClick={() => { setStatusFilter(f.key); setActive(null); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        {isSuperAdmin && (
          <select value={centerFilter} onChange={e => { setCenterFilter(e.target.value); setActive(null); }} style={styles.select}>
            <option value="">All centers</option>
            {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <input
          type="search"
          value={search}
          onChange={e => updateSearch(e.target.value)}
          placeholder="Search by name, subject, center or #id"
          style={styles.search}
        />
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={{ ...styles.split, ...(isMobile ? styles.splitMobile : {}) }}>
        {showList && (
          <div style={styles.list}>
            {loading && !threads.length ? (
              <div style={styles.empty}>Loading…</div>
            ) : !visible.length ? (
              <div style={styles.empty}>No questions {statusFilter ? 'with this status' : 'need attention'}.</div>
            ) : (
              visible.map(t => {
                const meta = STATUS_META[t.status] || STATUS_META.open;
                const isActive = active?.thread?.id === t.id;
                return (
                  <button key={t.id} type="button" style={{ ...styles.row, ...(isActive ? styles.rowActive : {}) }} onClick={() => openThread(t.id)}>
                    <div style={styles.rowTop}>
                      <span style={styles.rowName}>{t.userName}{t.userRole !== 'student' ? ` (${t.userRole.replace('_', ' ')})` : ''}</span>
                      <span style={{ ...styles.chip, color: meta.color, background: meta.bg }}>{meta.label}</span>
                    </div>
                    <div style={styles.rowSubject}>{t.subject || `Question #${t.id}`}</div>
                    {t.lastMessage && (
                      <div style={styles.rowPreview}>
                        {['admin', 'super_admin'].includes(t.lastMessage.senderRole) ? 'You: ' : ''}{t.lastMessage.body}
                      </div>
                    )}
                    <div style={styles.rowMeta}>{t.centerName || 'No center'} · {formatWhen(t.lastMessageAt)} · #{t.id}</div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {showThread && (
          <div style={styles.detail}>
            {!active ? (
              <div style={styles.emptyDetail}>Pick a question on the left to read and reply.</div>
            ) : (
              <>
                <div style={styles.detailHead}>
                  <div style={{ minWidth: 0 }}>
                    {isMobile && <button type="button" style={styles.linkBtn} onClick={() => setActive(null)}>← Back to list</button>}
                    <div style={styles.detailTitle}>{active.thread.subject || `Question #${active.thread.id}`}</div>
                    <div style={styles.detailMeta}>
                      {active.thread.userName} ({active.thread.username}) · {active.thread.centerName || 'No center'} · opened {formatWhen(active.thread.createdAt)}
                    </div>
                  </div>
                  <span style={{ ...styles.chip, ...(STATUS_META[active.thread.status] ? { color: STATUS_META[active.thread.status].color, background: STATUS_META[active.thread.status].bg } : {}) }}>
                    {(STATUS_META[active.thread.status] || STATUS_META.open).label}
                  </span>
                </div>

                <div ref={scrollRef} style={styles.messages}>
                  {active.messages.map(m => {
                    const fromAsker = m.senderUserId === active.thread.userId;
                    return (
                      <div key={m.id} style={{ ...styles.bubbleWrap, justifyContent: fromAsker ? 'flex-start' : 'flex-end' }}>
                        <div style={{ ...styles.bubble, ...(fromAsker ? styles.bubbleTheirs : styles.bubbleMine) }}>
                          <div style={{ ...styles.bubbleName, color: fromAsker ? NAVY : 'rgba(255,255,255,0.85)' }}>{m.senderName}</div>
                          <div style={styles.bubbleText}>{m.body}</div>
                          <div style={styles.bubbleTime}>{formatWhen(m.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {active.thread.status === 'closed' ? (
                  <div style={styles.closedRow}>
                    Closed{active.thread.closedBy ? ` by ${active.thread.closedBy}` : ''}.{' '}
                    <button type="button" style={styles.linkBtn} onClick={() => setClosed(false)} disabled={busy}>Reopen</button>
                  </div>
                ) : (
                  <form onSubmit={submitReply} style={styles.replyForm}>
                    <textarea
                      style={styles.textarea}
                      placeholder="Write your reply…"
                      value={reply}
                      maxLength={2000}
                      onChange={e => setReply(e.target.value)}
                    />
                    <div style={styles.formRow}>
                      <button type="button" style={styles.secondaryBtn} onClick={() => setClosed(true)} disabled={busy}>Close question</button>
                      <button type="submit" style={styles.primaryBtn} disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const NAVY = '#1a237e';

const styles = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: '24px 20px 60px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a2e' },
  hero: { background: 'linear-gradient(135deg, #1a237e 0%, #283593 100%)', color: '#fff', borderRadius: '18px', padding: '26px 28px', marginBottom: '18px' },
  label: { margin: 0, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(255,255,255,0.72)' },
  heroTitle: { margin: '6px 0 6px', fontSize: '26px', fontWeight: 800 },
  heroText: { margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: '14px' },
  filterRow: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' },
  filterRowMobile: { flexDirection: 'column', alignItems: 'stretch' },
  tabs: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  tab: { background: '#fff', border: '1.5px solid #dbe3f0', borderRadius: '999px', padding: '8px 14px', fontWeight: 700, fontSize: '13px', color: '#374151', cursor: 'pointer', fontFamily: 'inherit' },
  tabActive: { background: NAVY, borderColor: NAVY, color: '#fff' },
  select: { padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff', minWidth: '200px' },
  search: { flex: 1, minWidth: '220px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  error: { background: '#fce4ec', color: '#c62828', padding: '10px 12px', borderRadius: '10px', marginBottom: '12px', fontSize: '13px' },
  split: { display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: '16px', alignItems: 'start' },
  splitMobile: { gridTemplateColumns: '1fr' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '2px' },
  empty: { background: '#fff', borderRadius: '12px', padding: '20px', color: '#6b7280', fontSize: '13px', border: '1px solid #eef1f7' },
  row: { textAlign: 'left', background: '#fff', border: '1px solid #eef1f7', borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' },
  rowActive: { borderColor: NAVY, boxShadow: '0 0 0 2px rgba(26,35,126,0.12)' },
  rowTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  rowName: { fontWeight: 800, fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowSubject: { fontWeight: 700, fontSize: '13px', marginTop: '3px', color: '#111827' },
  rowPreview: { fontSize: '12.5px', color: '#4b5563', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta: { fontSize: '11px', color: '#9ca3af', marginTop: '6px' },
  chip: { fontSize: '11px', fontWeight: 800, padding: '3px 9px', borderRadius: '999px', flexShrink: 0 },
  detail: { background: '#fff', border: '1px solid #eef1f7', borderRadius: '14px', padding: '18px', minHeight: '320px', display: 'flex', flexDirection: 'column' },
  emptyDetail: { color: '#6b7280', fontSize: '14px', padding: '40px 10px', textAlign: 'center' },
  detailHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', borderBottom: '1px solid #eef1f7', paddingBottom: '12px', marginBottom: '12px' },
  detailTitle: { fontWeight: 800, fontSize: '17px' },
  detailMeta: { fontSize: '12.5px', color: '#6b7280', marginTop: '4px' },
  linkBtn: { background: 'none', border: 'none', color: NAVY, fontWeight: 700, fontSize: '13px', cursor: 'pointer', padding: 0, fontFamily: 'inherit', marginBottom: '6px' },
  messages: { display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '48vh', overflowY: 'auto', padding: '4px 2px' },
  bubbleWrap: { display: 'flex' },
  bubble: { maxWidth: '78%', padding: '10px 13px', borderRadius: '14px', fontSize: '13.5px', lineHeight: 1.5 },
  bubbleMine: { background: NAVY, color: '#fff', borderBottomRightRadius: '4px' },
  bubbleTheirs: { background: '#f1f3f9', color: '#1a1a2e', borderBottomLeftRadius: '4px' },
  bubbleName: { fontSize: '11px', fontWeight: 800, marginBottom: '3px' },
  bubbleText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  bubbleTime: { fontSize: '10.5px', opacity: 0.7, marginTop: '5px' },
  replyForm: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' },
  textarea: { width: '100%', minHeight: '90px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  formRow: { display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' },
  primaryBtn: { background: NAVY, color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 18px', fontWeight: 800, fontSize: '13.5px', cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { background: '#eef2ff', color: NAVY, border: 'none', borderRadius: '10px', padding: '10px 14px', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer', fontFamily: 'inherit' },
  closedRow: { marginTop: '14px', fontSize: '13px', color: '#4b5563' },
};
