import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CENTERS } from '../centers';

const STATUS_FLOW = ['Requested', 'Approved', 'Order Placed', 'In Transit', 'Received'];
const STATUS_STYLES = {
  Requested: { background: '#fff4e6', color: '#d97706' },
  Approved: { background: '#ecfdf5', color: '#047857' },
  Rejected: { background: '#fce4ec', color: '#c62828' },
  'Order Placed': { background: '#e3f2fd', color: '#1565c0' },
  'In Transit': { background: '#f3e5f5', color: '#6a1b9a' },
  Received: { background: '#eef2ff', color: '#4338ca' },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return DATE_FORMATTER.format(date);
}

function sessionContextLine(record) {
  const parts = [];
  if (record.studentCount != null) parts.push(`${record.studentCount} student${record.studentCount === 1 ? '' : 's'}`);
  if (record.teamCount != null) parts.push(`${record.teamCount} team${record.teamCount === 1 ? '' : 's'}`);
  if (!parts.length && !record.instituteName) return '';
  return parts.join(', ') + (record.instituteName ? `${parts.length ? ' from ' : 'From '}${record.instituteName}` : '');
}


export default function AdminProcurement() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCenter, setFilterCenter] = useState('');
  const [error, setError] = useState('');
  const [pageMessage, setPageMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [qtyDraft, setQtyDraft] = useState({});
  const [remarksDraft, setRemarksDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [modalError, setModalError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCenter]);

  async function fetchRequests() {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/procurement', { params: filterCenter ? { centerId: filterCenter } : {} });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load requests right now.');
    } finally {
      setLoading(false);
    }
  }

  function openDetail(request) {
    setSelected(request);
    setModalError('');
    setRemarksDraft(request.adminRemarks || '');
    setStatusDraft(request.status);
    const initialQty = {};
    request.items.forEach(item => { initialQty[item.id] = item.qtyApproved ?? item.qtyRequested; });
    setQtyDraft(initialQty);
  }

  async function updateStatus() {
    setProcessing(true);
    setModalError('');
    try {
      const payload = { status: statusDraft, adminRemarks: remarksDraft.trim() || undefined };
      if (statusDraft === 'Approved') {
        payload.items = selected.items.map(item => ({ itemId: item.id, qtyApproved: qtyDraft[item.id] }));
      }
      await axios.put(`/api/procurement/${selected.id}/status`, payload);
      setPageMessage(`${selected.centerName} request #${selected.id} marked ${statusDraft}.`);
      setSelected(null);
      await fetchRequests();
    } catch (err) {
      setModalError(err.response?.data?.message || 'Unable to update this request.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <p style={styles.label}>Component Requests</p>
          <h1 style={styles.title}>Center procurement requests</h1>
          <p style={styles.subtitle}>
            Centers request new components here when they need something for a prototype or program. Open a request to
            review it, adjust quantities if needed, and move it through Approved → Order Placed → In Transit → Received.
            The real stock still gets added the usual way, through Invoice Entry.
          </p>
        </div>
      </header>

      <div style={styles.centerRow}>
        <select value={filterCenter} onChange={event => setFilterCenter(event.target.value)} style={styles.centerSelect}>
          <option value="">All Centers</option>
          {CENTERS.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
        </select>
      </div>

      {pageMessage && <div style={styles.success}>{pageMessage}</div>}
      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.list}>
        {loading ? (
          <div style={styles.placeholder}>Loading requests...</div>
        ) : !requests.length ? (
          <div style={styles.placeholder}>No component requests yet.</div>
        ) : (
          requests.map(request => {
            const statusStyle = STATUS_STYLES[request.status] || { background: '#f3f4f6', color: '#111827' };
            const itemSummary = request.items.map(i => i.componentName).join(', ');
            return (
              <button key={request.id} type="button" style={styles.row} onClick={() => openDetail(request)}>
                <div style={styles.rowMain}>
                  <div style={styles.rowTitle}>{request.centerName} · Request #{request.id}</div>
                  <div style={styles.rowMeta}>
                    {request.programName || 'No program'} · {request.items.length} component{request.items.length === 1 ? '' : 's'} · {itemSummary}
                  </div>
                  <div style={styles.rowMeta}>Requested by {request.requestedBy} on {formatDate(request.createdAt)}</div>
                </div>
                <span style={{ ...styles.statusPill, ...statusStyle }}>{request.status}</span>
              </button>
            );
          })
        )}
      </section>

      {selected && (
        <div style={styles.modalOverlay} onClick={() => !processing && setSelected(null)}>
          <div style={styles.modalCard} onClick={event => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={styles.modalTitle}>{selected.centerName} · Request #{selected.id}</h2>
                <p style={styles.modalMeta}>
                  Requested by {selected.requestedBy} on {formatDate(selected.createdAt)} · Program: {selected.programName || '-'}
                </p>
                {sessionContextLine(selected) && <p style={styles.modalMeta}>{sessionContextLine(selected)}</p>}
              </div>
              <button type="button" style={styles.closeBtn} onClick={() => setSelected(null)} disabled={processing}>&times;</button>
            </div>

            <span style={{ ...styles.statusPill, ...(STATUS_STYLES[selected.status] || {}) }}>{selected.status}</span>

            {modalError && <div style={{ ...styles.error, marginTop: 14 }}>{modalError}</div>}

            <div style={styles.itemsTable}>
              <div style={styles.itemsHeader}>
                <span style={{ flex: 2 }}>Component</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Requested</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Currently Available</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{statusDraft === 'Approved' ? 'Approve qty' : 'Approved'}</span>
                <span style={{ flex: 2 }}>Reason</span>
              </div>
              {selected.items.map(item => (
                <div key={item.id} style={styles.itemsRow}>
                  <span style={{ flex: 2, fontWeight: 600, color: '#1e1b4b' }}>{item.componentName}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: '#64748b' }}>{item.qtyRequested}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: item.currentStock == null ? '#94a3b8' : '#0f172a' }}>
                    {item.currentStock == null ? 'New component' : item.currentStock}
                  </span>
                  <span style={{ flex: 1, textAlign: 'right' }}>
                    {statusDraft === 'Approved' ? (
                      <input type="number" min="0" style={styles.qtyInput}
                        value={qtyDraft[item.id] ?? ''}
                        onChange={event => setQtyDraft(prev => ({ ...prev, [item.id]: event.target.value }))} />
                    ) : (
                      <span style={{ fontWeight: 700 }}>{item.qtyApproved ?? '-'}</span>
                    )}
                  </span>
                  <span style={{ flex: 2, color: '#64748b', fontSize: 13 }}>{item.reason || '-'}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <label style={styles.fieldLabel}>Remarks</label>
              <textarea style={styles.remarksTextarea} value={remarksDraft}
                onChange={event => setRemarksDraft(event.target.value)} placeholder="Optional note visible to the requesting center" />
            </div>

            <div style={styles.modalActions}>
              <select style={styles.statusSelectInput} value={statusDraft} onChange={event => setStatusDraft(event.target.value)}>
                {STATUS_FLOW.concat('Rejected').map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" style={styles.secondaryBtn} onClick={() => setSelected(null)} disabled={processing}>Close</button>
              <button type="button" style={statusDraft === 'Rejected' ? styles.rejectBtn : styles.primaryBtn}
                disabled={processing || statusDraft === selected.status} onClick={updateStatus}>
                {processing ? 'Saving...' : 'Update Status'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: '24px 32px 64px' },
  hero: { background: '#0e1a43', borderRadius: 20, padding: '26px 32px', color: '#fff', marginBottom: 20 },
  label: { fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 8, color: '#a5b4fc' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { maxWidth: 680, margin: '8px 0 0', color: '#dbe2ff', lineHeight: 1.6 },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
    borderRadius: 14, background: '#fff', padding: '16px 20px', border: '1px solid #e2e8f0', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  rowTitle: { fontWeight: 700, fontSize: 15, color: '#0f172a' },
  rowMeta: { fontSize: 13, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusPill: { padding: '7px 14px', borderRadius: 999, fontWeight: 700, fontSize: 13, border: '1px solid rgba(15,23,42,0.08)', flexShrink: 0 },
  placeholder: { padding: '32px', borderRadius: 16, background: '#f8fafc', textAlign: 'center', color: '#475569' },
  success: { background: '#ecfdf5', borderRadius: 12, padding: '10px 14px', color: '#047857', marginBottom: 12 },
  error: { background: '#fee2e2', borderRadius: 12, padding: '10px 14px', color: '#b91c1c', marginBottom: 12 },

  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', zIndex: 200 },
  modalCard: { background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '760px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '16px' },
  modalTitle: { margin: '0 0 6px', fontSize: 20, color: '#0f172a' },
  modalMeta: { margin: 0, color: '#64748b', fontSize: 13 },
  closeBtn: { background: 'transparent', border: 'none', fontSize: '26px', lineHeight: 1, color: '#64748b', cursor: 'pointer' },
  itemsTable: { marginTop: 18, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  itemsHeader: { display: 'flex', gap: 12, padding: '10px 14px', background: '#f8fafc', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  itemsRow: { display: 'flex', gap: 12, padding: '12px 14px', borderTop: '1px solid #f1f5f9', alignItems: 'center' },
  qtyInput: { width: '80px', padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5f5', fontSize: 14, textAlign: 'right' },
  fieldLabel: { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 },
  remarksTextarea: { width: '100%', minHeight: 60, borderRadius: 10, border: '1px solid #cbd5f5', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  statusSelectInput: { padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5f5', fontSize: 13, fontWeight: 700, color: '#334155', marginRight: 'auto' },
  primaryBtn: { borderRadius: 10, border: 'none', background: '#111827', color: '#fff', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' },
  secondaryBtn: { borderRadius: 10, border: '1px solid #cbd5f5', background: '#fff', color: '#334155', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' },
  rejectBtn: { borderRadius: 10, border: '1px solid #c62828', background: '#fff', color: '#c62828', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' },
};
