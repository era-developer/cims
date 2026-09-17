import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import QrScanner from '../components/QrScanner';
import QrIcon from '../components/QrIcon';
import BackBar from '../components/BackBar';
import { extractTagFromScan } from '../utils/scan';

// The page a QR label leads to. Students see the component and their own
// history with this unit; admins see everything and can act on it.

const STATUS = {
  available: ['Available', '#2e7d32', '#e8f5e9'],
  reserved: ['Reserved', '#ef6c00', '#fff3e0'],
  issued: ['Issued', '#1565c0', '#e3f2fd'],
  return_requested: ['Return requested', '#b45309', '#fffbeb'],
  under_repair: ['Under repair', '#6a1b9a', '#f3e5f5'],
  damaged: ['Damaged / consumed', '#c62828', '#fce4ec'],
  disposed: ['Disposed', '#6b7280', '#f3f4f6'],
};

function fmt(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export default function UnitPage() {
  const { tag } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [acting, setActing] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const isAdmin = ['admin', 'super_admin'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: d } = await axios.get(`/api/units/${encodeURIComponent(tag)}`);
      setData(d);
    } catch (err) {
      setData(null);
      setError(err?.response?.data?.message || `Could not find "${tag}"`);
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  const onScanned = useCallback(text => {
    const next = extractTagFromScan(text);
    setScanning(false);
    if (next) navigate(`/unit/${encodeURIComponent(next)}`);
  }, [navigate]);

  async function changeStatus(action) {
    const notes = window.prompt(`${action.label}\n\nReason / notes (required):`);
    if (notes === null) return;
    if (!notes.trim()) { setActionMsg('A reason is required.'); return; }
    setActing(action.toStatus);
    setActionMsg('');
    try {
      await axios.put(`/api/assets/${data.unit.id}/status`, { toStatus: action.toStatus, notes: notes.trim() });
      setActionMsg(`Updated: ${action.label}.`);
      await load();
    } catch (err) {
      setActionMsg(err?.response?.data?.message || 'Unable to update status');
    } finally {
      setActing('');
    }
  }

  const backHome = () => navigate(isAdmin ? '/admin' : '/dashboard');
  const backTo = isAdmin ? '/admin/inventory' : '/dashboard';
  const backLabel = isAdmin ? 'Back to inventory' : 'Back to browse';

  if (loading) return <div style={styles.page}><BackBar to={backTo} label={backLabel} /><div style={styles.card}>Looking up {tag}...</div></div>;

  if (error || !data) {
    return (
      <div style={styles.page}>
        <BackBar to={backTo} label={backLabel} />
        <div style={styles.card}>
          <div style={styles.errorBox}>{error}</div>
          <div style={styles.actions}>
            <button type="button" style={{ ...styles.primaryBtn, ...styles.iconBtn }} onClick={() => setScanning(true)}><QrIcon size={16} /> Scan QR code</button>
            <button type="button" style={styles.secondaryBtn} onClick={backHome}>Back</button>
          </div>
          {scanning && <QrScanner onScan={onScanned} onClose={() => setScanning(false)} />}
        </div>
      </div>
    );
  }

  const { unit, component, holder } = data;
  const [statusLabel, color, bg] = STATUS[unit.status] || [unit.status, '#374151', '#f3f4f6'];

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <BackBar to={backTo} label={backLabel} />
      <div style={styles.card}>
        {/* ---------- Header: what is this ---------- */}
        <div style={styles.header}>
          {component.image
            ? <img src={component.image} alt="" style={styles.photo} />
            : <div style={styles.photoPlaceholder}>No photo</div>}
          <div style={{ minWidth: 0 }}>
            <div style={styles.kicker}>{unit.classification} · {unit.centerName}</div>
            <h1 style={styles.name}>{component.name}</h1>
            <div style={styles.tag}>{unit.assetTag}{unit.serialNumber ? ` · SN ${unit.serialNumber}` : ''}</div>
            <span style={{ ...styles.pill, color, background: bg }}>{statusLabel}</span>
          </div>
        </div>

        {/* ---------- Student view ---------- */}
        {!isAdmin && (
          <>
            {holder?.mine && (
              <div style={styles.noticeBlue}>
                <strong>This unit is issued to you</strong> on order {holder.orderId} ({holder.status}).
                {holder.expectedReturnDate && <> Expected return: <strong>{fmtDate(holder.expectedReturnDate)}</strong>.</>}
              </div>
            )}
            {holder && !holder.mine && (
              <div style={styles.noticeGrey}>This unit is currently issued to another student.</div>
            )}
            {!holder && unit.status === 'available' && (
              <div style={styles.noticeGreen}>This unit is available. {component.available} of {component.total} units of this component are free to request right now.</div>
            )}
            {component.description && <p style={styles.desc}>{component.description}</p>}

            <div style={styles.actions}>
              {holder?.mine && (
                <button type="button" style={styles.primaryBtn} onClick={() => navigate(`/my-orders?q=${encodeURIComponent(holder.orderId)}`)}>
                  Open my order {holder.orderId}
                </button>
              )}
              {component.catalogId && (
                <button type="button" style={holder?.mine ? styles.secondaryBtn : styles.primaryBtn} onClick={() => navigate(`/components/${component.catalogId}`)}>
                  Know more about this component
                </button>
              )}
              {unit.status === 'available' && component.catalogId && (
                <button type="button" style={styles.secondaryBtn} onClick={() => navigate(`/components/${component.catalogId}`)}>
                  Request this component
                </button>
              )}
            </div>

            <Section title="My history with this unit">
              {data.myOrders.length ? data.myOrders.map(o => (
                <Row key={o.order_id} left={<><strong>{o.order_id}</strong> · {o.status}</>} right={o.returned_at ? `Returned ${fmtDate(o.returned_at)}` : o.issued_at ? `Issued ${fmtDate(o.issued_at)}` : ''} />
              )) : <div style={styles.muted}>You have not borrowed this unit before.</div>}
            </Section>
          </>
        )}

        {/* ---------- Admin view ---------- */}
        {isAdmin && (
          <>
            {holder ? (
              <div style={styles.noticeBlue}>
                <div style={styles.noticeTitle}>Currently with</div>
                <strong>{holder.studentName || holder.studentUsername}</strong> · order {holder.orderId} · {holder.status}
                {holder.expectedReturnDate && <> · due {fmtDate(holder.expectedReturnDate)}</>}
              </div>
            ) : (
              <div style={unit.status === 'available' ? styles.noticeGreen : styles.noticeGrey}>
                Not on any open order. {component.available} of {component.total} units of this component available.
              </div>
            )}

            <div style={styles.factGrid}>
              <Fact label="Location" value={unit.location} />
              <Fact label="Added" value={fmtDate(unit.addedDate)} />
              <Fact label="Unit value" value={unit.unitValue != null ? `₹${Number(unit.unitValue).toLocaleString('en-IN')}` : '-'} />
              <Fact label="Warranty" value={unit.hasWarranty ? `until ${fmtDate(unit.warrantyUntil)}` : 'none'} />
            </div>

            <div style={styles.actions}>
              {holder && (
                <button type="button" style={styles.primaryBtn} onClick={() => navigate(`/admin/orders?q=${encodeURIComponent(holder.orderId)}`)}>
                  Open order {holder.orderId}
                </button>
              )}
              <button type="button" style={holder ? styles.secondaryBtn : styles.primaryBtn} onClick={() => navigate(`/admin/inventory?q=${encodeURIComponent(component.name)}`)}>
                Open in Inventory
              </button>
              {component.catalogId && (
                <button type="button" style={styles.secondaryBtn} onClick={() => navigate(`/admin/labels?catalogId=${component.catalogId}&centerId=${encodeURIComponent(unit.centerId)}`)}>
                  Print QR labels
                </button>
              )}
            </div>

            {data.actions?.length > 0 && (
              <Section title="Change status">
                <div style={styles.actionRow}>
                  {data.actions.map(a => (
                    <button key={a.toStatus} type="button" style={{ ...styles.statusBtn, opacity: acting ? 0.6 : 1 }} disabled={!!acting} onClick={() => changeStatus(a)}>
                      {acting === a.toStatus ? 'Saving...' : a.label}
                    </button>
                  ))}
                </div>
                {actionMsg && <div style={styles.muted}>{actionMsg}</div>}
              </Section>
            )}

            <Section title="Order history">
              {data.orders?.length ? data.orders.map(o => (
                <Row key={o.order_id} left={<><strong>{o.order_id}</strong> · {o.student_name || '-'} · {o.status}</>}
                  right={o.returned_at ? `Returned ${fmtDate(o.returned_at)}` : o.issued_at ? `Issued ${fmtDate(o.issued_at)}` : ''}
                  onClick={() => navigate(`/admin/orders?q=${encodeURIComponent(o.order_id)}`)} />
              )) : <div style={styles.muted}>Never issued.</div>}
            </Section>

            <Section title="Lifecycle">
              {data.history?.length ? data.history.map((e, i) => (
                <Row key={i} left={<><strong>{e.event_type.replace(/_/g, ' ')}</strong>{e.to_status ? ` → ${e.to_status}` : ''}{e.notes ? <span style={styles.notes}> — {e.notes}</span> : null}</>}
                  right={<>{fmt(e.occurred_at)}{e.performed_by ? ` · ${e.performed_by}` : ''}</>} />
              )) : <div style={styles.muted}>No events recorded.</div>}
            </Section>
          </>
        )}

        <div style={styles.footerRow}>
          <button type="button" style={{ ...styles.secondaryBtn, ...styles.iconBtn }} onClick={() => setScanning(true)}><QrIcon size={16} /> Scan QR code</button>
          <button type="button" style={styles.linkBtn} onClick={backHome}>Back</button>
        </div>
        {scanning && <QrScanner onScan={onScanned} onClose={() => setScanning(false)} />}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}
function Row({ left, right, onClick }) {
  return (
    <div style={{ ...styles.row, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ minWidth: 0 }}>{left}</div>
      <div style={styles.rowRight}>{right}</div>
    </div>
  );
}
function Fact({ label, value }) {
  return (
    <div style={styles.fact}>
      <div style={styles.factLabel}>{label}</div>
      <div style={styles.factValue}>{value || '-'}</div>
    </div>
  );
}

const styles = {
  page: { maxWidth: '720px', margin: '0 auto', padding: '22px 20px 60px', fontFamily: "'DM Sans', sans-serif" },
  pageMobile: { padding: '12px 12px 50px' },
  card: { background: '#fff', borderRadius: '16px', border: '1px solid #e3e8f2', padding: '20px', boxShadow: '0 1px 3px rgba(16,37,72,0.04)' },
  header: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px' },
  photo: { width: '96px', height: '96px', objectFit: 'cover', borderRadius: '14px', border: '1px solid #e5e7eb', flexShrink: 0 },
  photoPlaceholder: { width: '96px', height: '96px', borderRadius: '14px', background: '#f1f3f9', color: '#9097a6', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  kicker: { fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700 },
  name: { fontSize: '20px', fontWeight: 800, color: '#1a1a2e', margin: '2px 0 4px', lineHeight: 1.2 },
  tag: { fontFamily: "'DM Mono', Consolas, monospace", fontSize: '13px', color: '#334155', marginBottom: '6px', wordBreak: 'break-all' },
  pill: { display: 'inline-block', fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '999px' },
  noticeBlue: { background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#1e1b4b', marginBottom: '14px' },
  noticeGreen: { background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#064e3b', marginBottom: '14px' },
  noticeGrey: { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#374151', marginBottom: '14px' },
  noticeTitle: { fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#3730a3', fontWeight: 800, marginBottom: '3px' },
  desc: { color: '#4b5563', fontSize: '14px', lineHeight: 1.55, margin: '0 0 14px' },
  factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' },
  fact: { background: '#f8fafc', border: '1px solid #eef1f7', borderRadius: '10px', padding: '8px 10px' },
  factLabel: { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', fontWeight: 700 },
  factValue: { fontSize: '13px', color: '#1a1a2e', fontWeight: 600, marginTop: '2px' },
  actions: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' },
  actionRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  primaryBtn: { background: '#2d2a6e', color: '#fff', border: 'none', padding: '12px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' },
  secondaryBtn: { background: '#f1f3f9', color: '#1a1a2e', border: '1px solid #d7dde9', padding: '12px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' },
  statusBtn: { background: '#fff', color: '#2d2a6e', border: '1.5px solid #c7d2fe', padding: '9px 12px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '12px' },
  iconBtn: { display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' },
  linkBtn: { background: 'none', border: 'none', color: '#6b7280', padding: '10px', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },
  section: { borderTop: '1px solid #eef1f7', paddingTop: '12px', marginTop: '4px', marginBottom: '12px' },
  sectionTitle: { fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 800, marginBottom: '8px' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px', padding: '7px 0', borderBottom: '1px solid #f1f3f9', color: '#1a1a2e' },
  rowRight: { fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap', textAlign: 'right' },
  notes: { color: '#6b7280' },
  muted: { fontSize: '13px', color: '#6b7280', padding: '4px 0' },
  errorBox: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '12px 14px', borderRadius: '10px', marginBottom: '14px' },
  footerRow: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' },
};
