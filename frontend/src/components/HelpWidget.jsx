import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import { APP_SHORT_NAME } from '../brand';
import { formatWhen } from './../utils/notificationsUi';

// The floating Help bubble, present on every signed-in page.
//
// Three things, in order of how often they resolve a question: quick answers
// for the common "how do I…" cases (links straight to the page), a place to
// ask the center's admins (a support thread: the admin answers from
// Admin -> Support and the reply comes back here, to the bell, and by email),
// and the support contact for anything urgent (WhatsApp / email).
//
// No live chat yet: the thread refetches when opened and whenever a new
// message is sent. A notification link with ?help=<thread id> opens the
// bubble straight onto that thread.

const STATUS_META = {
  open: { label: 'Waiting for reply', color: '#b45309', bg: '#fff7ed' },
  answered: { label: 'Replied', color: '#047857', bg: '#ecfdf5' },
  closed: { label: 'Resolved', color: '#4b5563', bg: '#f3f4f6' },
};

const STUDENT_FAQ = [
  {
    q: 'How do I request components?',
    a: 'Open Browse, add what you need to the cart, then open the Cart and fill in your project details. Accept the terms and submit; a one-time code is emailed to you to confirm the order.',
    link: { label: 'Go to Browse', to: '/dashboard' },
  },
  {
    q: 'What happens after I submit?',
    a: 'Your order shows as Pending in My Orders until a center admin approves it. You get a bell notification (and email / phone notification if enabled) when it is approved or rejected. Collect the components at your center.',
    link: { label: 'Open My Orders', to: '/my-orders' },
  },
  {
    q: 'How do I return components?',
    a: 'In My Orders, open the approved order and tap Request Return, then hand the components to the admin. They record each unit as Good or Damaged and the order closes.',
    link: { label: 'Open My Orders', to: '/my-orders' },
  },
  {
    q: 'What do the order statuses mean?',
    a: 'Pending: waiting for admin review. Approved: issued to you. Rejected: not approved (reason is in the order). Return Requested: waiting for the admin to check what you brought back. Partially Returned: some units still with you. Returned: fully closed.',
  },
  {
    q: 'What is the QR label on a component for?',
    a: 'Scan it with your phone camera (or the Scan button in the top bar) and you see that exact unit: its component, whether it is free, and your own history with it.',
  },
  {
    q: 'How do I get notifications on my phone?',
    a: 'Open My Profile and use "Notifications on this device". You can also add the portal to your home screen from the sign-in page (Android: Install button; iPhone: Share -> Add to Home Screen).',
    link: { label: 'Open My Profile', to: '/my-profile' },
  },
  {
    q: 'I forgot my password',
    a: 'Sign out and use "Forgot password?" on the sign-in page. A reset code is emailed to the address on your account.',
  },
];

const ADMIN_FAQ = [
  {
    q: 'Approve and issue an order',
    a: 'Orders -> Approve on the pending order. Set the issuing quantity per component, then scan or tick exactly the units you hand over. Confirm & issue unlocks once every component has its full count.',
    link: { label: 'Open Orders', to: '/admin/orders' },
  },
  {
    q: 'Record a return',
    a: 'Orders -> open the order -> Record Returned Items. One Scan QR code button covers the whole return: scan a unit, choose Good or Damaged, scan the next. Damaged needs a reason. Save Return Update.',
    link: { label: 'Open Orders', to: '/admin/orders' },
  },
  {
    q: 'Add new stock',
    a: 'Invoices -> New Invoice. Each line item creates its units with asset tags. Untick "Print QR labels" for bulk consumables; tick "Record serial numbers" only when you want the maker\'s serials on file. Print the labels from the success message.',
    link: { label: 'Open Invoices', to: '/admin/invoices' },
  },
  {
    q: 'Staff taking components for a session',
    a: 'Inventory -> Internal Use. Pick the exact units by scanning, typing the tag, or from the dropdown under each component; or just enter a quantity. Return them from Orders -> Internal use tab.',
    link: { label: 'Open Inventory', to: '/admin/inventory' },
  },
  {
    q: 'Borrow components from another center',
    a: 'My Center -> Request components from another center. The component must already be in your catalog. The super admin picks the supplying center and approves; use Return components when you send them back.',
    link: { label: 'Open My Center', to: '/admin/my-center' },
  },
  {
    q: 'Approve a student registration',
    a: 'Users -> the student shows as Pending Approval -> Approve. They get an email and can sign in straight away.',
    link: { label: 'Open Users', to: '/admin/users' },
  },
  {
    q: 'Where do student questions go?',
    a: 'Every question asked from this Help bubble lands in Admin -> Support for the student\'s center (and in the center mailbox, the bell and push). Reply there; the student sees it here, in their bell and by email.',
    link: { label: 'Open Support inbox', to: '/admin/support' },
  },
];

function waLink(number, text) {
  const digits = String(number || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export default function HelpWidget() {
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('faq');           // faq | ask
  const [faqOpen, setFaqOpen] = useState(null);
  const [contact, setContact] = useState({ supportEmail: '', supportWhatsapp: '' });
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [active, setActive] = useState(null);      // { thread, messages }
  const [composer, setComposer] = useState({ subject: '', message: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const scrollRef = useRef(null);

  const faq = isAdmin ? ADMIN_FAQ : STUDENT_FAQ;

  useEffect(() => {
    axios.get('/api/centers/branding')
      .then(({ data }) => setContact({ supportEmail: data?.supportEmail || '', supportWhatsapp: data?.supportWhatsapp || '' }))
      .catch(() => { /* the contact block simply stays empty */ });
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const { data } = await axios.get('/api/support/threads', { params: { scope: 'mine', status: 'all' } });
      setThreads(Array.isArray(data) ? data : []);
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const openThread = useCallback(async (id) => {
    setError('');
    try {
      const { data } = await axios.get(`/api/support/threads/${id}`);
      setActive(data);
      setTab('ask');
      setNewOpen(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to open that question');
    }
  }, []);

  // A notification link (?help=<id>) opens the bubble on that thread, then
  // the parameter is dropped so a reload does not reopen it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('help');
    if (!wanted) return;
    setOpen(true);
    if (/^\d+$/.test(wanted)) openThread(Number(wanted));
    else { setTab('ask'); setNewOpen(true); }
    params.delete('help');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate, openThread]);

  useEffect(() => {
    if (open && tab === 'ask') loadThreads();
  }, [open, tab, loadThreads]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active?.messages?.length]);

  const waitingCount = useMemo(() => threads.filter(t => t.status === 'answered').length, [threads]);

  async function submitQuestion(event) {
    event.preventDefault();
    if (!composer.message.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post('/api/support/threads', composer);
      setComposer({ subject: '', message: '' });
      setNewOpen(false);
      setActive(data);
      loadThreads();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to send your question');
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    if (!reply.trim() || busy || !active) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post(`/api/support/threads/${active.thread.id}/messages`, { message: reply });
      setReply('');
      setActive(data);
      loadThreads();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to send the message');
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

  function go(to) {
    setOpen(false);
    navigate(to);
  }

  if (!user) return null;

  const wa = waLink(contact.supportWhatsapp, `Hi, I am ${user.fullName || user.username} (${user.centerName || APP_SHORT_NAME}). `);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ ...styles.fab, ...(isMobile ? styles.fabMobile : {}) }}
        aria-label={open ? 'Close help' : 'Help and support'}
        aria-expanded={open}
      >
        <span style={styles.fabIcon} aria-hidden="true">{open ? '✕' : '?'}</span>
        {!isMobile && <span>{open ? 'Close' : 'Help'}</span>}
        {!open && waitingCount > 0 && <span style={styles.fabBadge}>{waitingCount}</span>}
      </button>

      {open && (
        <div style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }} role="dialog" aria-label="Help and support">
          <div style={styles.head}>
            <div>
              <div style={styles.title}>Help &amp; support</div>
              <div style={styles.subtitle}>{user.centerName ? `${user.centerName} · ` : ''}{APP_SHORT_NAME}</div>
            </div>
            <div style={styles.tabs}>
              <button type="button" style={{ ...styles.tabBtn, ...(tab === 'faq' ? styles.tabBtnActive : {}) }} onClick={() => setTab('faq')}>Quick answers</button>
              <button type="button" style={{ ...styles.tabBtn, ...(tab === 'ask' ? styles.tabBtnActive : {}) }} onClick={() => { setTab('ask'); setActive(null); }}>
                Ask us{waitingCount > 0 ? ` (${waitingCount})` : ''}
              </button>
            </div>
          </div>

          <div style={styles.body}>
            {tab === 'faq' && (
              <div>
                {faq.map((item, index) => (
                  <div key={item.q} style={styles.faqItem}>
                    <button type="button" style={styles.faqQ} onClick={() => setFaqOpen(faqOpen === index ? null : index)} aria-expanded={faqOpen === index}>
                      <span>{item.q}</span>
                      <span style={styles.chevron}>{faqOpen === index ? '−' : '+'}</span>
                    </button>
                    {faqOpen === index && (
                      <div style={styles.faqA}>
                        <p style={{ margin: 0 }}>{item.a}</p>
                        {item.link && (
                          <button type="button" style={styles.linkBtn} onClick={() => go(item.link.to)}>{item.link.label} →</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div style={styles.askNudge}>
                  Not answered here?{' '}
                  <button type="button" style={styles.linkBtn} onClick={() => { setTab('ask'); setNewOpen(true); setActive(null); }}>Ask your center admin</button>
                </div>
              </div>
            )}

            {tab === 'ask' && !active && (
              <div>
                {error && <div style={styles.error}>{error}</div>}
                {newOpen ? (
                  <form onSubmit={submitQuestion} style={styles.form}>
                    <input
                      style={styles.input}
                      placeholder="Subject (optional)"
                      value={composer.subject}
                      maxLength={120}
                      onChange={e => setComposer(c => ({ ...c, subject: e.target.value }))}
                    />
                    <textarea
                      style={{ ...styles.input, minHeight: '96px', resize: 'vertical' }}
                      placeholder={isAdmin ? 'Your question for the super admin / support team…' : 'Your question for the center admin — include the order ID if it is about an order.'}
                      value={composer.message}
                      maxLength={2000}
                      onChange={e => setComposer(c => ({ ...c, message: e.target.value }))}
                      required
                    />
                    <div style={styles.formRow}>
                      <button type="button" style={styles.secondaryBtn} onClick={() => setNewOpen(false)} disabled={busy}>Cancel</button>
                      <button type="submit" style={styles.primaryBtn} disabled={busy || !composer.message.trim()}>{busy ? 'Sending…' : 'Send question'}</button>
                    </div>
                    <div style={styles.hint}>Goes to your center's admins by email, bell and phone notification. Replies show up here and in your bell.</div>
                  </form>
                ) : (
                  <button type="button" style={{ ...styles.primaryBtn, width: '100%' }} onClick={() => setNewOpen(true)}>+ New question</button>
                )}

                <div style={styles.listHead}>Your questions</div>
                {threadsLoading && !threads.length ? (
                  <div style={styles.empty}>Loading…</div>
                ) : !threads.length ? (
                  <div style={styles.empty}>Nothing asked yet.</div>
                ) : (
                  threads.map(t => {
                    const meta = STATUS_META[t.status] || STATUS_META.open;
                    return (
                      <button key={t.id} type="button" style={styles.threadRow} onClick={() => openThread(t.id)}>
                        <div style={styles.threadTop}>
                          <span style={styles.threadSubject}>{t.subject || `Question #${t.id}`}</span>
                          <span style={{ ...styles.chip, color: meta.color, background: meta.bg }}>{meta.label}</span>
                        </div>
                        {t.lastMessage && (
                          <div style={styles.threadPreview}>
                            {['admin', 'super_admin'].includes(t.lastMessage.senderRole) ? 'Admin: ' : 'You: '}{t.lastMessage.body}
                          </div>
                        )}
                        <div style={styles.threadTime}>{formatWhen(t.lastMessageAt)}</div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {tab === 'ask' && active && (
              <div style={styles.thread}>
                <div style={styles.threadHead}>
                  <button type="button" style={styles.linkBtn} onClick={() => setActive(null)}>← All questions</button>
                  <span style={{ ...styles.chip, ...(STATUS_META[active.thread.status] ? { color: STATUS_META[active.thread.status].color, background: STATUS_META[active.thread.status].bg } : {}) }}>
                    {(STATUS_META[active.thread.status] || STATUS_META.open).label}
                  </span>
                </div>
                <div style={styles.threadTitle}>{active.thread.subject || `Question #${active.thread.id}`}</div>
                {error && <div style={styles.error}>{error}</div>}
                <div ref={scrollRef} style={styles.messages}>
                  {active.messages.map(m => {
                    const mine = m.senderUserId === user.id;
                    return (
                      <div key={m.id} style={{ ...styles.bubbleWrap, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <div style={{ ...styles.bubble, ...(mine ? styles.bubbleMine : styles.bubbleTheirs) }}>
                          {!mine && <div style={styles.bubbleName}>{m.senderName}</div>}
                          <div style={styles.bubbleText}>{m.body}</div>
                          <div style={{ ...styles.bubbleTime, textAlign: mine ? 'right' : 'left' }}>{formatWhen(m.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {active.thread.status === 'closed' ? (
                  <div style={styles.closedRow}>
                    Marked as resolved.{' '}
                    <button type="button" style={styles.linkBtn} onClick={() => setClosed(false)} disabled={busy}>Reopen</button>
                  </div>
                ) : (
                  <form onSubmit={submitReply} style={styles.replyForm}>
                    <textarea
                      style={{ ...styles.input, minHeight: '64px', resize: 'vertical' }}
                      placeholder="Write a reply…"
                      value={reply}
                      maxLength={2000}
                      onChange={e => setReply(e.target.value)}
                    />
                    <div style={styles.formRow}>
                      <button type="button" style={styles.secondaryBtn} onClick={() => setClosed(true)} disabled={busy}>Mark resolved</button>
                      <button type="submit" style={styles.primaryBtn} disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          {(contact.supportEmail || wa) && (
            <div style={styles.foot}>
              <span style={styles.footLabel}>Urgent?</span>
              {wa && <a href={wa} target="_blank" rel="noreferrer" style={styles.footLink}>WhatsApp support</a>}
              {contact.supportEmail && <a href={`mailto:${contact.supportEmail}`} style={styles.footLink}>{contact.supportEmail}</a>}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const NAVY = '#1a237e';

const styles = {
  fab: {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: 150,
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    padding: '0 18px 0 12px', height: '48px', borderRadius: '999px', border: 'none',
    background: NAVY, color: '#fff', fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: '14px',
    boxShadow: '0 10px 30px rgba(26,35,126,0.35)', cursor: 'pointer',
  },
  fabMobile: { right: '14px', bottom: '14px', width: '48px', padding: 0, justifyContent: 'center' },
  fabIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(255,255,255,0.18)', fontSize: '16px', fontWeight: 900 },
  fabBadge: { position: 'absolute', top: '-4px', right: '-4px', minWidth: '20px', height: '20px', padding: '0 6px', borderRadius: '999px', background: '#f9a825', color: '#102548', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', boxSizing: 'content-box' },
  panel: {
    position: 'fixed', right: '20px', bottom: '80px', zIndex: 150,
    width: '390px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(640px, calc(100vh - 100px))',
    display: 'flex', flexDirection: 'column',
    background: '#fff', color: '#1a1a2e', borderRadius: '16px', border: '1px solid #e3e8f2',
    boxShadow: '0 24px 70px rgba(16,37,72,0.3)', fontFamily: "'DM Sans', sans-serif", overflow: 'hidden',
  },
  panelMobile: { right: '10px', left: '10px', bottom: '72px', width: 'auto', maxHeight: 'calc(100vh - 90px)' },
  head: { padding: '14px 16px 0', borderBottom: '1px solid #eef1f7', background: '#f8f9fe' },
  title: { fontWeight: 800, fontSize: '15px' },
  subtitle: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  tabs: { display: 'flex', gap: '4px', marginTop: '10px' },
  tabBtn: { flex: 1, background: 'transparent', border: 'none', borderBottom: '3px solid transparent', padding: '8px 6px 10px', fontFamily: 'inherit', fontWeight: 700, fontSize: '13px', color: '#6b7280', cursor: 'pointer' },
  tabBtnActive: { color: NAVY, borderBottomColor: NAVY },
  body: { overflowY: 'auto', padding: '12px 14px', flex: 1, minHeight: 0 },
  faqItem: { borderBottom: '1px solid #f1f3f9' },
  faqQ: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '11px 2px', textAlign: 'left', fontFamily: 'inherit', fontWeight: 700, fontSize: '13.5px', color: '#1a1a2e', cursor: 'pointer' },
  chevron: { color: NAVY, fontWeight: 900, fontSize: '16px', flexShrink: 0 },
  faqA: { padding: '0 2px 12px', fontSize: '13px', color: '#4b5563', lineHeight: 1.5 },
  askNudge: { marginTop: '14px', padding: '10px 12px', background: '#f6f7ff', borderRadius: '10px', fontSize: '13px', color: '#374151' },
  linkBtn: { background: 'none', border: 'none', color: NAVY, fontWeight: 700, fontSize: '13px', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  form: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' },
  input: { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '13px', fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' },
  formRow: { display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  primaryBtn: { background: NAVY, color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 16px', fontWeight: 800, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { background: '#eef2ff', color: NAVY, border: 'none', borderRadius: '10px', padding: '10px 14px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  hint: { fontSize: '11.5px', color: '#9ca3af', lineHeight: 1.4 },
  listHead: { fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9097a6', margin: '14px 0 6px' },
  empty: { padding: '14px 4px', color: '#6b7280', fontSize: '13px' },
  threadRow: { width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #eef1f7', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' },
  threadTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  threadSubject: { fontWeight: 700, fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chip: { fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '999px', flexShrink: 0 },
  threadPreview: { fontSize: '12.5px', color: '#4b5563', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  threadTime: { fontSize: '11px', color: '#9ca3af', marginTop: '4px' },
  thread: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' },
  threadHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  threadTitle: { fontWeight: 800, fontSize: '14px', marginBottom: '8px' },
  messages: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0', maxHeight: '300px' },
  bubbleWrap: { display: 'flex' },
  bubble: { maxWidth: '85%', padding: '8px 11px', borderRadius: '12px', fontSize: '13px', lineHeight: 1.45 },
  bubbleMine: { background: NAVY, color: '#fff', borderBottomRightRadius: '4px' },
  bubbleTheirs: { background: '#f1f3f9', color: '#1a1a2e', borderBottomLeftRadius: '4px' },
  bubbleName: { fontSize: '11px', fontWeight: 800, color: NAVY, marginBottom: '2px' },
  bubbleText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  bubbleTime: { fontSize: '10.5px', opacity: 0.7, marginTop: '4px' },
  replyForm: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' },
  closedRow: { marginTop: '10px', fontSize: '13px', color: '#4b5563' },
  error: { background: '#fce4ec', color: '#c62828', padding: '8px 10px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '8px' },
  foot: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', padding: '10px 14px', borderTop: '1px solid #eef1f7', background: '#f8f9fe', fontSize: '12.5px' },
  footLabel: { fontWeight: 800, color: '#6b7280' },
  footLink: { color: NAVY, fontWeight: 700, textDecoration: 'none' },
};
