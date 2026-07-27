import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FLOW_STEPS = [
  'List the exact components and quantities you need, picking from the existing inventory items.',
  'Provide program details, responsible person, and why your center requires these parts.',
  'Submit the transfer request so super admin can review, select a supply center, and approve.',
  'The requested components are reserved, redistributed, and the stock is adjusted at both centers automatically.',
];

function createRow() {
  return {
    id: `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    componentId: '',
    name: '',
    link: '',
    qty: '',
    unit: 'pcs',
    available: 0,
  };
}

export default function MyCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [rows, setRows] = useState([createRow()]);
  const [inventory, setInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pageMessage, setPageMessage] = useState('');
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [viewMode, setViewMode] = useState('requested');
  const [returnModal, setReturnModal] = useState({ open: false, requestId: '', details: { courierName: '', trackingId: '', notes: '' } });
  const [formDetails, setFormDetails] = useState({
    programName: '',
    responsiblePerson: '',
    responsibleEmail: '',
    purpose: '',
    desiredReturnDate: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [submissionStatus, setSubmissionStatus] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoadingInventory(true);
    axios
      .get('/api/components')
      .then(response => {
        if (cancel) return;
        setInventory(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => {
        if (cancel) return;
        setPageMessage('Unable to load your inventory right now. Please refresh.');
      })
      .finally(() => {
        if (cancel) return;
        setLoadingInventory(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const fetchRequests = useCallback(async () => {
    if (!user?.centerId) return;
    setLoadingRequests(true);
    try {
      const { data } = await axios.get('/api/transfers', { params: { centerId: user.centerId } });
      setRequests(data);
    } catch (err) {
      console.error('Unable to load transfer history', err);
    } finally {
      setLoadingRequests(false);
    }
  }, [user?.centerId]);

  useEffect(() => {
    if (!user?.centerId) return;
    fetchRequests();
  }, [user?.centerId, fetchRequests]);

  const filteredRequests = useMemo(() => {
    if (!user?.centerId) return [];
    if (viewMode === 'sent') {
      return requests.filter(request => request.supplyCenterId === user.centerId);
    }
    return requests.filter(request => request.requestingCenterId === user.centerId);
  }, [requests, viewMode, user?.centerId]);

  function openReturnModal(requestId) {
    setReturnModal({ open: true, requestId, details: { courierName: '', trackingId: '', notes: '' } });
  }

  function closeReturnModal() {
    setReturnModal(prev => ({ ...prev, open: false }));
  }

  function handleReturnChange(field, value) {
    setReturnModal(prev => ({
      ...prev,
      details: { ...prev.details, [field]: value },
    }));
  }

  async function submitReturn() {
    if (!returnModal.requestId) return;
    try {
      setProcessing(true);
      await axios.post(`/api/transfers/${returnModal.requestId}/return-request`, returnModal.details);
      setPageMessage('Return request submitted; super admin will confirm receipt.');
      closeReturnModal();
      fetchRequests();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to submit return request.');
    } finally {
      setProcessing(false);
    }
  }

  const suggestionsMap = useMemo(() => {
    const map = {};
    rows.forEach(row => {
      if (!row.name.trim()) return;
      const query = row.name.trim().toLowerCase();
      map[row.id] = inventory
        .filter(item => item.name?.toLowerCase().includes(query))
        .slice(0, 6);
    });
    return map;
  }, [inventory, rows]);

  function updateRow(rowId, changes) {
    setRows(current => current.map(row => (row.id === rowId ? { ...row, ...changes } : row)));
  }

  function handleNameChange(rowId, value) {
    updateRow(rowId, { name: value, componentId: '', available: 0, unit: 'pcs' });
    setSubmissionStatus('');
  }

  function handleSuggestionSelect(rowId, item) {
    updateRow(rowId, {
      componentId: item.id,
      name: item.name,
      available: Number(item.stock || 0),
      unit: item.unit || 'pcs',
      link: item.image || item.imageUrl || '',
    });
  }

  function handleQtyChange(rowId, rawValue) {
    const value = Math.max(0, Number(rawValue) || 0);
    setRows(current => current.map(row => (row.id === rowId ? { ...row, qty: value } : row)));
  }

  function addRow() {
    setRows(current => [...current, createRow()]);
  }

  function removeRow(rowId) {
    setRows(current => (current.length === 1 ? current : current.filter(row => row.id !== rowId)));
  }

  function handleDetailChange(field, value) {
    setFormDetails(current => ({ ...current, [field]: value }));
    setSubmissionStatus('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setPageMessage('');
    const validRows = rows
      .map((row, index) => ({ ...row, qty: Number(row.qty) || 0, index: index + 1 }))
      .filter(row => row.componentId && row.qty > 0);
    if (!validRows.length) {
      setError('Select at least one existing component and enter a quantity.');
      return;
    }
    const payload = {
      programName: formDetails.programName.trim(),
      responsiblePerson: formDetails.responsiblePerson.trim(),
      responsibleEmail: formDetails.responsibleEmail.trim(),
      purpose: formDetails.purpose.trim(),
      desiredReturnDate: formDetails.desiredReturnDate,
      notes: formDetails.notes.trim(),
      components: validRows.map(row => ({
        id: row.componentId,
        name: row.name,
        qty: row.qty,
        link: row.link,
        unit: row.unit,
      })),
    };

    setProcessing(true);
    try {
      const { data } = await axios.post('/api/transfers', payload);
      setPageMessage(`Transfer request ${data.id} submitted. Super admin will assign a supply center shortly.`);
      setSubmissionStatus('waiting');
      setRows([createRow()]);
      setFormDetails({ programName: '', responsiblePerson: '', responsibleEmail: '', purpose: '', desiredReturnDate: '', notes: '' });
      fetchRequests();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to submit the request right now.');
      setSubmissionStatus('');
    } finally {
      setProcessing(false);
    }
  }

  const centerName = user?.centerName || 'your center';

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.label}>My Center — {centerName}</p>
          <h1 style={styles.title}>Request components from another center</h1>
          <p style={styles.subtitle}>
            When units within your center are busy or a project needs temporary additional parts, ask the super admin to
            allocate stock from another lab. All activity is tracked in the transfer register so nothing slips through the cracks.
          </p>
        </div>
        <div style={styles.actionRow}>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={styles.requestBtn}
          >
            {showForm ? 'Update request details below' : 'Request components from another center'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/admin/inventory')}
            style={styles.ghostBtn}
          >
            Add component to inventory
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.card}>
          <div style={{ ...styles.section, marginBottom: 24 }}>
            <div style={styles.sectionHeading}>Components required</div>
            <div style={styles.tableHeader}>
              <span style={{ flex: '0 0 40px' }}>S no</span>
              <span style={{ flex: 1 }}>Component name</span>
              <span style={{ flex: '0 0 160px' }}>Link (optional)</span>
              <span style={{ flex: '0 0 120px' }}>Quantity</span>
              <span style={{ flex: '0 0 50px' }} />
            </div>
            {rows.map((row, index) => (
              <div key={row.id} style={styles.tableRow}>
                <span style={{ flex: '0 0 40px', ...styles.serial }}>{index + 1}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    value={row.name}
                    onChange={event => handleNameChange(row.id, event.target.value)}
                    placeholder="Type to search inventory"
                    style={styles.input}
                  />
                  {row.componentId ? (
                    <span style={styles.helperText}>Available stock: {row.available} {row.unit}</span>
                  ) : (row.name.trim() && (
                    <span style={styles.helperTextError}>Select a listed component or add it via Inventory first.</span>
                  ))}
                  {suggestionsMap[row.id]?.length ? (
                    <div style={styles.suggestionList}>
                      {suggestionsMap[row.id].map(item => (
                        <button
                          key={item.id}
                          type="button"
                          style={styles.suggestionItem}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => handleSuggestionSelect(row.id, item)}
                        >
                          <span style={styles.suggestionName}>{item.name}</span>
                          <span style={styles.suggestionMeta}>{item.stock || 0} pcs · {item.category || 'Inventory'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  value={row.link}
                  onChange={event => updateRow(row.id, { link: event.target.value })}
                  placeholder="Optional link (docs/photo)"
                  style={{ ...styles.input, flex: '0 0 160px' }}
                />
                <input
                  type="number"
                  min="0"
                  value={row.qty}
                  onChange={event => handleQtyChange(row.id, event.target.value)}
                  placeholder="Qty"
                  style={{ ...styles.input, flex: '0 0 120px' }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  style={styles.removeRowBtn}
                  disabled={rows.length === 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addRow} style={styles.addRowBtn}>+ Add another component</button>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHeading}>Project & contact details</div>
            <div style={styles.detailGrid}>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Program / project name</span>
                <input
                  value={formDetails.programName}
                  onChange={event => handleDetailChange('programName', event.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Responsible person</span>
                <input
                  value={formDetails.responsiblePerson}
                  onChange={event => handleDetailChange('responsiblePerson', event.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Responsible email</span>
                <input
                  type="email"
                  value={formDetails.responsibleEmail}
                  onChange={event => handleDetailChange('responsibleEmail', event.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Purpose / justification</span>
                <textarea
                  value={formDetails.purpose}
                  onChange={event => handleDetailChange('purpose', event.target.value)}
                  style={{ ...styles.input, minHeight: 70 }}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Desired return date</span>
                <input
                  type="date"
                  value={formDetails.desiredReturnDate}
                  onChange={event => handleDetailChange('desiredReturnDate', event.target.value)}
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.labelText}>Additional notes</span>
                <textarea
                  value={formDetails.notes}
                  onChange={event => handleDetailChange('notes', event.target.value)}
                  style={{ ...styles.input, minHeight: 70 }}
                />
              </label>
            </div>
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {pageMessage && <div style={styles.message}>{pageMessage}</div>}

          <div style={styles.footerRow}>
            <button
              type="submit"
              style={styles.submitBtn}
              disabled={processing || submissionStatus === 'waiting'}
            >
              {submissionStatus === 'waiting' ? 'Waiting for super admin approval' : processing ? 'Submitting…' : 'Submit request'}
            </button>
            <span style={styles.helperNote}>
              Requests go to the super admin for approval. The supply center is chosen there and stock updates occur for both centers.
            </span>
          </div>
        </form>
      )}

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Process flow</div>
        <ol style={styles.flowList}>
          {FLOW_STEPS.map(step => (
            <li key={step} style={styles.flowItem}>{step}</li>
          ))}
        </ol>
        <p style={styles.helperText}>You can revisit this page anytime to track what you requested. Notifications are also emailed to the super admin automatically.</p>
        {loadingInventory && <span style={styles.helperText}>Loading inventory list for suggestions…</span>}
        {!loadingInventory && !inventory.length && (
          <span style={styles.helperTextError}>
            Your inventory looks empty—add components first so you can request them for other centers.
          </span>
        )}
      </section>

          <section style={styles.card}>
            <div style={styles.sectionHeading}>Request history</div>
            <div style={styles.filterRow}>
              <button
                type="button"
                onClick={() => setViewMode('requested')}
                style={viewMode === 'requested' ? styles.filterActive : styles.filterBtn}
              >
                Requested
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sent')}
                style={viewMode === 'sent' ? styles.filterActive : styles.filterBtn}
              >
                Sent
              </button>
            </div>
            {loadingRequests ? (
              <p style={styles.helperText}>Loading your transfer requests…</p>
            ) : !filteredRequests.length ? (
              <p style={styles.helperText}>
                {viewMode === 'requested'
                  ? 'No center-to-center requests submitted yet.'
                  : 'No sent transfers are recorded for this center yet.'}
              </p>
            ) : (
              <div style={styles.historyList}>
                {filteredRequests.map(request => {
                  const isRequested = viewMode === 'requested';
                  const counterpartName = isRequested
                    ? request.supplyCenterName || 'Waiting for supply center'
                    : request.requestingCenterName || user?.centerName;
                  const counterpartLabel = isRequested ? 'Supply center' : 'Requested center';
                  return (
                    <div key={request.id} style={styles.historyItem}>
                      <div style={styles.historyRow}>
                        <span style={styles.historyTitle}>{request.id}</span>
                        <span style={styles.historyStatus}>{request.status || 'Pending'}</span>
                      </div>
                      <div style={styles.historyRow}>
                        <span>{request.programName || 'Program not provided'}</span>
                        <span>Requested on {new Date(request.requestDate || Date.now()).toLocaleString()}</span>
                      </div>
                      <div style={styles.historyRow}>
                        <span>{counterpartLabel}: {counterpartName}</span>
                        <span>Responsible: {request.responsiblePerson || 'N/A'}</span>
                      </div>
                      <div style={styles.historyRow}>
                        <span>{request.responsibleEmail || 'Email not provided'}</span>
                      </div>
                      <div style={styles.componentList}>
                        {(request.components || []).map(component => (
                          <span key={`${request.id}-${component.id}`} style={styles.componentPill}>
                            {component.name || component.id} × {component.qty || 0}
                          </span>
                        ))}
                      </div>
                      {request.status === 'Approved' && viewMode === 'requested' && (
                        <div style={styles.returnButtonRow}>
                          <button
                            type="button"
                            style={styles.secondaryBtn}
                            onClick={() => openReturnModal(request.id)}
                          >
                            Return components
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

      {returnModal.open && (
        <div style={styles.modalOverlay} onClick={closeReturnModal}>
          <div style={styles.modal} onClick={event => event.stopPropagation()}>
            <h3 style={styles.modalTitle}>Confirm return details</h3>
            <p style={styles.modalText}>Add courier/tracking info if available; fields are optional.</p>
            <label style={styles.modalLabel}>
              Courier / transporter
              <input
                value={returnModal.details.courierName}
                onChange={event => handleReturnChange('courierName', event.target.value)}
                style={styles.modalInput}
                placeholder="Courier name (optional)"
              />
            </label>
            <label style={styles.modalLabel}>
              Tracking ID
              <input
                value={returnModal.details.trackingId}
                onChange={event => handleReturnChange('trackingId', event.target.value)}
                style={styles.modalInput}
                placeholder="Tracking number (optional)"
              />
            </label>
            <label style={styles.modalLabel}>
              Notes
              <textarea
                value={returnModal.details.notes}
                onChange={event => handleReturnChange('notes', event.target.value)}
                style={{ ...styles.modalInput, minHeight: 80 }}
                placeholder="Add extra context (optional)"
              />
            </label>
            <div style={styles.modalActions}>
              <button type="button" style={styles.modalCancelBtn} onClick={closeReturnModal} disabled={processing}>
                Cancel
              </button>
              <button type="button" style={styles.primaryBtn} onClick={submitReturn} disabled={processing}>
                {processing ? 'Sending…' : 'Send return info'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px 28px 60px',
  },
  hero: {
    marginBottom: 18,
    padding: '24px',
    borderRadius: 20,
    background: 'linear-gradient(135deg, #15264a, #1a3f82)',
    color: '#f5f7ff',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  label: { fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6, color: '#aec3ff' },
  title: { fontSize: 32, margin: '0 0 8px', lineHeight: 1.25 },
  subtitle: { margin: 0, maxWidth: 560, fontSize: 15, lineHeight: 1.6, color: '#dfe6ff' },
  actionRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  requestBtn: {
    background: '#f9a825',
    border: 'none',
    borderRadius: 12,
    color: '#102548',
    fontWeight: 700,
    cursor: 'pointer',
    padding: '12px 20px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
  },
  ghostBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.5)',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 18px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '24px',
    boxShadow: '0 14px 40px rgba(15,23,42,0.08)',
    marginBottom: 20,
  },
  section: { marginBottom: 12 },
  sectionHeading: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1c2564' },
  tableHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 4px',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#64748b',
    marginBottom: 10,
  },
  tableRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    padding: '12px 0',
    borderTop: '1px solid #e0e7ff',
  },
  serial: { fontWeight: 600, color: '#475569', textAlign: 'center' },
  input: {
    borderRadius: 12,
    border: '1px solid #cbd5f5',
    padding: '10px 14px',
    fontSize: 14,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  addRowBtn: {
    marginTop: 12,
    background: 'rgba(26, 35, 126, 0.08)',
    border: '1px dashed #1a237e',
    borderRadius: 12,
    padding: '10px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    color: '#1a237e',
  },
  removeRowBtn: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    width: 38,
    height: 38,
    cursor: 'pointer',
    fontSize: 18,
    color: '#c62828',
  },
  suggestionList: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 8,
    background: '#f9fafb',
    boxShadow: '0 12px 24px rgba(15,23,42,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 6,
  },
  suggestionItem: {
    border: 'none',
    background: '#fff',
    borderRadius: 10,
    padding: '8px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  suggestionName: { fontWeight: 700, color: '#102548' },
  suggestionMeta: { fontSize: 12, color: '#64748b' },
  helperText: { fontSize: 12, color: '#475569' },
  helperTextError: { fontSize: 12, color: '#c62828' },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
  },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: 4 },
  labelText: { fontSize: 12, fontWeight: 600, color: '#475569' },
  footerRow: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  submitBtn: {
    background: '#0f172a',
    border: 'none',
    borderRadius: 12,
    padding: '12px 24px',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  helperNote: { color: '#475569', fontSize: 13, maxWidth: '600px' },
  error: {
    background: '#fee2e2',
    color: '#b91c1c',
    borderRadius: 12,
    padding: '10px 14px',
    marginTop: 12,
  },
  message: {
    background: '#e7f5ff',
    color: '#0f4c81',
    borderRadius: 12,
    padding: '10px 14px',
    marginTop: 12,
  },
  flowList: { paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 },
  flowItem: { color: '#1e293b', fontSize: 14, lineHeight: 1.6 },
  historyList: { display: 'flex', flexDirection: 'column', gap: 12 },
  historyItem: { border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', background: '#f8fafc' },
  historyRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#1e1b4b', marginBottom: 6 },
  historyTitle: { fontWeight: 700, color: '#0f172a' },
  historyStatus: { fontWeight: 600, color: '#047857' },
  componentPill: { display: 'inline-flex', padding: '4px 8px', borderRadius: 8, background: '#fff', border: '1px solid #d1d5db', marginRight: 6, marginBottom: 6, fontSize: 12 },
  returnButtonRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 },
  secondaryBtn: {
    borderRadius: 10,
    border: '1px solid #0f172a',
    background: '#fff',
    color: '#0f172a',
    padding: '8px 14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.65)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  modal: {
    background: '#fff',
    borderRadius: 20,
    padding: '28px',
    width: 'min(480px, 90%)',
    boxShadow: '0 20px 40px rgba(15,23,42,0.25)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  modalTitle: { margin: 0, fontSize: 20, color: '#0f172a' },
  modalText: { margin: 0, color: '#475569', fontSize: 14 },
  modalLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#475569' },
  modalInput: { borderRadius: 10, border: '1px solid #cbd5f5', padding: '8px 12px', fontSize: 14 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  modalCancelBtn: {
    borderRadius: 10,
    border: '1px solid #cbd5f5',
    background: '#fff',
    color: '#0f172a',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  filterRow: { display: 'flex', gap: 8, marginTop: 12 },
  filterBtn: {
    borderRadius: 999,
    border: '1px solid #cbd5f5',
    background: '#fff',
    color: '#0f172a',
    padding: '6px 18px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  filterActive: {
    borderRadius: 999,
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#fff',
    padding: '6px 18px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
};
