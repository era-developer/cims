import React, { useEffect, useState } from 'react';
import axios from 'axios';
import useViewport from '../hooks/useViewport';
import { useAuth } from '../context/AuthContext';
import { CENTERS } from '../centers';

const STATUS_STYLES = {
  Pending: { background: '#fff4e6', color: '#d97706' },
  Approved: { background: '#ecfdf5', color: '#047857' },
  'Return Requested': { background: '#fffbeb', color: '#b45309' },
  Returned: { background: '#eef2ff', color: '#4338ca' },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return DATE_FORMATTER.format(date);
}

function centerNameFromId(centerId) {
  if (!centerId) return '';
  const center = CENTERS.find(item => item.id === centerId);
  return center?.name || centerId;
}

export default function AdminTransfers() {
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCenter, setFilterCenter] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [pageMessage, setPageMessage] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [componentDrafts, setComponentDrafts] = useState({});
  const [processingId, setProcessingId] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';

  function getCurrentParams() {
    const params = {};
    if (isSuperAdmin) {
      if (filterCenter) params.centerId = filterCenter;
    } else if (user?.centerId) {
      params.centerId = user.centerId;
    }
    return params;
  }

  useEffect(() => {
    const params = {};
    if (isSuperAdmin) {
      if (filterCenter) params.centerId = filterCenter;
    } else if (user?.centerId) {
      params.centerId = user.centerId;
    }
    fetchRequests(params);
  }, [filterCenter, isSuperAdmin, user?.centerId]);

  async function fetchRequests(params = {}) {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/transfers', { params });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load transfer requests right now.');
    } finally {
      setLoading(false);
    }
  }

  function handleDraftChange(id, field, value) {
    setDrafts(current => ({
      ...current,
      [id]: { ...(current[id] || {}), [field]: value },
    }));
  }

  function handleComponentQtyChange(requestId, componentId, rawValue) {
    const value = Math.max(0, Number(rawValue) || 0);
    setComponentDrafts(current => ({
      ...current,
      [requestId]: { ...(current[requestId] || {}), [componentId]: value },
    }));
  }

  function getComponentQty(requestId, component) {
    const draftQty = componentDrafts[requestId]?.[component.id];
    return draftQty !== undefined ? draftQty : Number(component.qty) || 0;
  }

  async function handleApprove(request) {
    if (request.status !== 'Pending') {
      setError('This request is already assigned. Supply center cannot be changed now.');
      return;
    }
    const draft = drafts[request.id] || {};
    const supplyCenterId = draft.supplyCenterId || '';
    if (!supplyCenterId) {
      setError('Select a supply center before approving.');
      return;
    }
    setProcessingId(request.id);
    setError('');
    try {
      const payload = {
        status: 'Approved',
        supplyCenterId,
        supplierRemarks: draft.supplierRemarks?.trim() || '',
        components: (request.components || [])
          .map(component => ({
            ...component,
            qty: getComponentQty(request.id, component),
          }))
          .filter(component => Number(component.qty) > 0),
      };

      if (!payload.components.length) {
        setError('At least one component must remain on the transfer before approval.');
        setProcessingId('');
        return;
      }

      const { data } = await axios.put(`/api/transfers/${request.id}`, payload);
      setPageMessage(`Transfer ${data.id} approved and locked to ${data.supplyCenterName}.`);
      await fetchRequests(getCurrentParams());
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to approve the transfer right now.');
    } finally {
      setProcessingId('');
    }
  }

  async function handleReturn(request) {
    const draft = drafts[request.id] || {};
    if (!draft.returnNotes?.trim()) {
      setError('Add return confirmation notes before marking this transfer as returned.');
      return;
    }
    setProcessingId(request.id);
    setError('');
    try {
      const { data } = await axios.put(`/api/transfers/${request.id}`, {
        status: 'Returned',
        returnNotes: draft.returnNotes.trim(),
      });
      setPageMessage(`Transfer ${data.id} marked as returned.`);
      setDrafts(current => ({ ...current, [request.id]: { ...draft, returnNotes: '' } }));
      await fetchRequests(getCurrentParams());
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update transfer status.');
    } finally {
      setProcessingId('');
    }
  }

  const statusTabs = ['All', 'Pending', 'Approved', 'Return Requested', 'Partially Returned', 'Returned', 'Rejected'];
  const counts = requests.reduce((acc, request) => {
    const status = request.status || 'Pending';
    acc.All += 1;
    if (acc[status] !== undefined) acc[status] += 1;
    return acc;
  }, {
    All: 0,
    Pending: 0,
    Approved: 0,
    'Return Requested': 0,
    'Partially Returned': 0,
    Returned: 0,
    Rejected: 0,
  });
  const filteredRequests = statusFilter === 'All'
    ? requests
    : requests.filter(request => (request.status || 'Pending') === statusFilter);

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <p style={styles.label}>Transfer Requests</p>
          <h1 style={styles.title}>Center-to-center inventory approvals</h1>
          <p style={styles.subtitle}>
            Approve once, lock the supplier center, and continue the return workflow with full tracking.
          </p>
        </div>
      </header>

      {isSuperAdmin && (
        <div style={styles.centerRow}>
          <select value={filterCenter} onChange={event => setFilterCenter(event.target.value)} style={styles.centerSelect}>
            <option value="">All Centers</option>
            {CENTERS.map(center => (
              <option key={center.id} value={center.id}>{center.name}</option>
            ))}
          </select>
        </div>
      )}

      {pageMessage && <div style={styles.success}>{pageMessage}</div>}
      {error && <div style={styles.error}>{error}</div>}

      <div style={{ ...styles.filterRow, ...(isMobile ? styles.filterRowMobile : {}) }}>
        <div style={{ ...styles.tabs, ...(isMobile ? styles.tabsMobile : {}) }}>
          {statusTabs.map(tab => (
            <button
              key={tab}
              type="button"
              style={{ ...styles.tab, ...(statusFilter === tab ? styles.tabActive : {}) }}
              onClick={() => setStatusFilter(tab)}
            >
              {tab} <span style={styles.tabCount}>{counts[tab]}</span>
            </button>
          ))}
        </div>
        <div style={styles.statusSelectWrap}>
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
            style={styles.statusSelect}
          >
            {statusTabs.map(tab => (
              <option key={`status-${tab}`} value={tab}>{tab} ({counts[tab]})</option>
            ))}
          </select>
        </div>
      </div>

      <section style={styles.list}>
        {loading ? (
          <div style={styles.placeholder}>Loading transfer requests...</div>
        ) : !filteredRequests.length ? (
          <div style={styles.placeholder}>
            No transfer requests found for "{statusFilter}".
          </div>
        ) : (
          filteredRequests.map(request => {
            const draft = drafts[request.id] || {};
            const supplyOptions = CENTERS.filter(center => center.id !== request.requestingCenterId);
            const suggestedIds = new Set((request.availableCenters || []).map(center => center.id));
            const statusStyle = STATUS_STYLES[request.status] || { background: '#f3f4f6', color: '#111827' };
            const canApprove = request.status === 'Pending';
            const canMarkReturned = request.status === 'Return Requested';
            const assignedSupplyCenter = request.supplyCenterName || centerNameFromId(request.supplyCenterId) || 'Not assigned yet';
            const currentRemarks = request.supplierRemarks || 'No supplier remarks';

            return (
              <article key={request.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div>
                    <div style={styles.badge}>{request.status || 'Pending'}</div>
                    <h2 style={styles.cardTitle}>Transfer {request.id}</h2>
                    <p style={styles.cardMeta}>
                      {request.requestingCenterName} | requested by {request.requestedBy || 'admin'} on {formatDate(request.requestDate)}
                    </p>
                  </div>
                  <span style={{ ...styles.statusPill, ...statusStyle }}>{request.status || 'Pending'}</span>
                </div>

                <div style={styles.sectionGrid}>
                  <div>
                    <strong>Program</strong>
                    <p style={styles.detailText}>{request.programName || '-'}</p>
                  </div>
                  <div>
                    <strong>Responsible</strong>
                    <p style={styles.detailText}>{request.responsiblePerson || '-'} | {request.responsibleEmail || '-'}</p>
                  </div>
                  <div>
                    <strong>Purpose</strong>
                    <p style={styles.detailText}>{request.purpose || '-'}</p>
                  </div>
                  <div>
                    <strong>Return by</strong>
                    <p style={styles.detailText}>{formatDate(request.desiredReturnDate)}</p>
                  </div>
                </div>

                <div style={styles.componentList}>
                  {(request.components || []).map(component => {
                    const qtyValue = getComponentQty(request.id, component);
                    return (
                      <div key={`${request.id}-${component.id}-${component.name}`} style={styles.componentRow}>
                        <span>{component.name || component.id}</span>
                        {canApprove ? (
                          <label style={styles.editInputWrapper}>
                            <input
                              type="number"
                              min="0"
                              value={qtyValue}
                              onChange={event => handleComponentQtyChange(request.id, component.id, event.target.value)}
                              style={styles.qtyInput}
                            />
                            <span style={styles.qtyUnit}>{component.unit || 'pcs'}</span>
                          </label>
                        ) : (
                          <span style={styles.qtyBadge}>{Number(component.qty) || 0} {component.unit || 'pcs'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {canApprove && (
                  request.availableCenters?.length ? (
                    <div style={styles.availability}>
                      Suggested supply center(s): {request.availableCenters.map(center => center.name).join(', ')}
                    </div>
                  ) : (
                    <div style={styles.helper}>No single center currently has full availability. Choose the best center manually.</div>
                  )
                )}

                {canApprove ? (
                  <div style={{ ...styles.actionGrid, flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={styles.fieldGroup}>
                      <label style={styles.fieldLabel}>Supply center</label>
                      <select
                        value={draft.supplyCenterId || ''}
                        onChange={event => handleDraftChange(request.id, 'supplyCenterId', event.target.value)}
                        style={styles.select}
                      >
                        <option value="">Select supply center</option>
                        {supplyOptions.map(center => (
                          <option key={center.id} value={center.id}>
                            {center.name}{suggestedIds.has(center.id) ? ' - available' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={styles.fieldGroup}>
                      <label style={styles.fieldLabel}>Supplier remarks</label>
                      <textarea
                        value={draft.supplierRemarks || ''}
                        onChange={event => handleDraftChange(request.id, 'supplierRemarks', event.target.value)}
                        placeholder="Add context for both centers"
                        style={styles.textarea}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={styles.lockedPanel}>
                    <div style={styles.lockedItem}>
                      <div style={styles.lockedLabel}>Assigned supply center</div>
                      <div style={styles.lockedValue}>{assignedSupplyCenter}</div>
                    </div>
                    <div style={styles.lockedItem}>
                      <div style={styles.lockedLabel}>Supplier remarks</div>
                      <div style={styles.lockedValue}>{currentRemarks}</div>
                    </div>
                  </div>
                )}

                <div style={styles.buttonRow}>
                  {canApprove && (
                    <button
                      type="button"
                      style={styles.primaryBtn}
                      disabled={processingId === request.id}
                      onClick={() => handleApprove(request)}
                    >
                      {processingId === request.id ? 'Processing...' : 'Approve transfer'}
                    </button>
                  )}

                  {request.status === 'Approved' && (
                    <div style={styles.flowHint}>Waiting for return request from requesting center.</div>
                  )}

                  {canMarkReturned && (
                    <div style={styles.returnSection}>
                      <textarea
                        value={draft.returnNotes || ''}
                        onChange={event => handleDraftChange(request.id, 'returnNotes', event.target.value)}
                        placeholder="Return confirmation notes"
                        style={styles.returnInput}
                      />
                      <button
                        type="button"
                        onClick={() => handleReturn(request)}
                        disabled={processingId === request.id}
                        style={styles.secondaryBtn}
                      >
                        {processingId === request.id ? 'Processing...' : 'Mark as returned'}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px 32px 64px',
  },
  hero: {
    background: '#0e1a43',
    borderRadius: 20,
    padding: '26px 32px',
    color: '#fff',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
  },
  label: { fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 8, color: '#a5b4fc' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { maxWidth: 560, margin: 0, color: '#dbe2ff', lineHeight: 1.6 },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  filterRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  filterRowMobile: { alignItems: 'stretch' },
  tabs: { display: 'flex', gap: '6px', marginBottom: 0, flexWrap: 'wrap' },
  tabsMobile: { flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '6px' },
  tab: { padding: '9px 16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' },
  tabActive: { background: '#1a237e', borderColor: '#1a237e', color: '#fff' },
  tabCount: { background: 'rgba(255,255,255,0.25)', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' },
  statusSelectWrap: { marginBottom: 0 },
  statusSelect: { minWidth: '230px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff', color: '#1f2937' },
  list: {},
  card: {
    borderRadius: 18,
    background: '#fff',
    padding: '24px',
    marginBottom: 20,
    boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  badge: { fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#475569', marginBottom: 8 },
  cardTitle: { margin: '0 0 6px', fontSize: 20 },
  cardMeta: { margin: 0, color: '#64748b', fontSize: 13 },
  statusPill: {
    padding: '8px 16px',
    borderRadius: 999,
    fontWeight: 700,
    border: '1px solid rgba(15,23,42,0.08)',
  },
  sectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
    marginTop: 16,
  },
  detailText: { margin: '6px 0 0', color: '#1f2933', fontSize: 13 },
  componentList: { marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  componentRow: { display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1e1b4b' },
  qtyBadge: { fontSize: 13, color: '#0f172a' },
  editInputWrapper: { display: 'flex', alignItems: 'center', gap: 6 },
  qtyInput: {
    width: 90,
    borderRadius: 8,
    border: '1px solid #cbd5f5',
    padding: '4px 10px',
    fontSize: 13,
    textAlign: 'center',
  },
  qtyUnit: { fontSize: 12, color: '#475569' },
  availability: { marginTop: 12, fontSize: 13, color: '#047857' },
  helper: { marginTop: 12, fontSize: 13, color: '#fb923c' },
  actionGrid: { display: 'flex', gap: 16, marginTop: 20, flexWrap: 'wrap' },
  fieldGroup: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#475569' },
  select: { borderRadius: 10, border: '1px solid #cbd5f5', padding: '10px 12px', fontSize: 14 },
  textarea: { borderRadius: 12, border: '1px solid #cbd5f5', minHeight: 70, padding: 10, fontSize: 14 },
  lockedPanel: {
    marginTop: 16,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '14px 16px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  lockedItem: { display: 'flex', flexDirection: 'column', gap: 4 },
  lockedLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#64748b' },
  lockedValue: { fontSize: 14, color: '#0f172a', fontWeight: 600 },
  buttonRow: { marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  primaryBtn: {
    borderRadius: 12,
    border: 'none',
    background: '#111827',
    color: '#fff',
    padding: '14px 18px',
    fontWeight: 700,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  secondaryBtn: {
    borderRadius: 10,
    border: '1px solid #111827',
    background: '#fff',
    color: '#111827',
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  returnSection: { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  returnInput: { borderRadius: 12, border: '1px solid #cbd5f5', minHeight: 54, padding: '10px 12px', flex: '1 1 360px' },
  flowHint: { fontSize: 13, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' },
  placeholder: { padding: '32px', borderRadius: 16, background: '#f8fafc', textAlign: 'center', color: '#475569' },
  success: {
    background: '#ecfdf5',
    borderRadius: 12,
    padding: '10px 14px',
    color: '#047857',
    marginBottom: 12,
  },
  error: {
    background: '#fee2e2',
    borderRadius: 12,
    padding: '10px 14px',
    color: '#b91c1c',
    marginBottom: 12,
  },
};
