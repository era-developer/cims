import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProgramSelect, { OTHER_PROGRAM } from '../components/ProgramSelect';
import { useCenters } from '../context/CentersContext';
import NotificationsCard from '../components/NotificationsCard';

const PROGRAM_STATUS_META = {
  planning: { label: 'Planning', color: '#1d4ed8', bg: '#dbeafe' },
  ongoing: { label: 'Ongoing', color: '#b45309', bg: '#fef3c7' },
  completed: { label: 'Completed', color: '#047857', bg: '#d1fae5' },
};
const PROGRAM_STATUS_OPTIONS = ['planning', 'ongoing', 'completed'];

// Renders "N students, M teams, from Institute" from whichever of the three
// optional session-context fields are actually set -- used for both
// Procurement Requests and (via ProgramDetail) Internal Use records.
function sessionContextLine(record) {
  const parts = [];
  if (record.studentCount != null) parts.push(`${record.studentCount} student${record.studentCount === 1 ? '' : 's'}`);
  if (record.teamCount != null) parts.push(`${record.teamCount} team${record.teamCount === 1 ? '' : 's'}`);
  if (!parts.length && !record.instituteName) return '';
  return parts.join(', ') + (record.instituteName ? `${parts.length ? ' from ' : 'From '}${record.instituteName}` : '');
}

const PROCUREMENT_STATUS_META = {
  Requested: { background: '#fff4e6', color: '#d97706' },
  Approved: { background: '#ecfdf5', color: '#047857' },
  Rejected: { background: '#fce4ec', color: '#c62828' },
  'Order Placed': { background: '#e3f2fd', color: '#1565c0' },
  'In Transit': { background: '#f3e5f5', color: '#6a1b9a' },
  Received: { background: '#eef2ff', color: '#4338ca' },
};

export default function MyCenter() {
  const { centers } = useCenters();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'super_admin';
  const [centerId, setCenterId] = useState('');
  const [inventory, setInventory] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [programModalOpen, setProgramModalOpen] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState(null);
  const [programForm, setProgramForm] = useState({
    name: '', handledBy: '', startDate: '', expectedEndDate: '', instituteName: '', notes: '', completionDate: '', status: 'planning',
  });
  const [programSaving, setProgramSaving] = useState(false);
  const [showAllPrograms, setShowAllPrograms] = useState(false);
  const [programMsg, setProgramMsg] = useState('');
  const [procurementRequests, setProcurementRequests] = useState([]);
  const [loadingProcurement, setLoadingProcurement] = useState(false);
  const [procurementFormOpen, setProcurementFormOpen] = useState(false);
  const [procurementRows, setProcurementRows] = useState([{ id: 'p-row-0', name: '', componentId: '', available: 0, unit: 'pcs', qty: '', reason: '' }]);
  const [procurementProjectId, setProcurementProjectId] = useState('');
  const [procurementOtherProgram, setProcurementOtherProgram] = useState('');
  const [procurementStudentCount, setProcurementStudentCount] = useState('');
  const [procurementTeamCount, setProcurementTeamCount] = useState('');
  const [procurementInstituteName, setProcurementInstituteName] = useState('');
  const [procurementSaving, setProcurementSaving] = useState(false);
  const [procurementMsg, setProcurementMsg] = useState('');

  // Depends on `centers` because the list is fetched: on first render it is
  // still empty, so a super admin would otherwise be left with no center
  // selected until they picked one by hand.
  useEffect(() => {
    setCenterId(isSuperAdmin ? (centers[0]?.id || '') : (user?.centerId || ''));
  }, [isSuperAdmin, user, centers]);

  useEffect(() => {
    let cancel = false;
    axios
      .get('/api/components')
      .then(response => {
        if (cancel) return;
        setInventory(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => { /* suggestions are a convenience; the form still works */ });
    return () => {
      cancel = true;
    };
  }, []);

  const fetchProcurement = useCallback(async () => {
    if (!centerId) return;
    setLoadingProcurement(true);
    try {
      const { data } = await axios.get('/api/procurement', { params: { centerId } });
      setProcurementRequests(data);
    } catch (err) {
      console.error('Unable to load component requests', err);
    } finally {
      setLoadingProcurement(false);
    }
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    fetchProcurement();
  }, [centerId, fetchProcurement]);

  function updateProcurementRow(rowId, field, value) {
    setProcurementRows(prev => prev.map(row => (row.id === rowId ? { ...row, [field]: value } : row)));
  }

  function handleProcurementNameChange(rowId, value) {
    updateProcurementRow(rowId, 'name', value);
    setProcurementRows(prev => prev.map(row => (row.id === rowId ? { ...row, componentId: '', available: 0, unit: 'pcs' } : row)));
  }

  function handleProcurementSuggestionSelect(rowId, item) {
    setProcurementRows(prev => prev.map(row => (row.id === rowId
      ? { ...row, componentId: item.id, name: item.name, available: Number(item.stock || 0), unit: item.unit || 'pcs' }
      : row)));
  }

  const procurementSuggestionsMap = useMemo(() => {
    const map = {};
    procurementRows.forEach(row => {
      // Once a suggestion is picked (componentId set), the name field holds
      // that exact match, which would otherwise keep matching itself and
      // leave the dropdown open right after the click that was meant to close it.
      if (!row.name.trim() || row.componentId) return;
      const query = row.name.trim().toLowerCase();
      map[row.id] = inventory.filter(item => item.name?.toLowerCase().includes(query)).slice(0, 6);
    });
    return map;
  }, [inventory, procurementRows]);

  function addProcurementRow() {
    setProcurementRows(prev => [...prev, { id: `p-row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name: '', componentId: '', available: 0, unit: 'pcs', qty: '', reason: '' }]);
  }

  function removeProcurementRow(rowId) {
    setProcurementRows(prev => prev.filter(row => row.id !== rowId));
  }

  async function handleProcurementSubmit(event) {
    event.preventDefault();
    setProcurementMsg('');
    const isOtherProgram = procurementProjectId === OTHER_PROGRAM;
    const hasProgram = isOtherProgram ? procurementOtherProgram.trim() : procurementProjectId;
    if (!hasProgram) {
      setProcurementMsg('Select which program this request is for.');
      return;
    }
    const validItems = procurementRows
      .filter(row => row.name.trim() && Number(row.qty) > 0)
      .map(row => ({ name: row.name.trim(), qty: Number(row.qty), reason: row.reason.trim() }));
    if (!validItems.length) {
      setProcurementMsg('Add at least one component with a name and quantity.');
      return;
    }
    setProcurementSaving(true);
    try {
      await axios.post('/api/procurement', {
        centerId, items: validItems,
        ...(isOtherProgram ? { otherProgramName: procurementOtherProgram.trim() } : { projectId: Number(procurementProjectId) }),
        studentCount: procurementStudentCount, teamCount: procurementTeamCount, instituteName: procurementInstituteName.trim(),
      });
      setProcurementFormOpen(false);
      setProcurementRows([{ id: `p-row-${Date.now().toString(36)}`, name: '', componentId: '', available: 0, unit: 'pcs', qty: '', reason: '' }]);
      setProcurementProjectId('');
      setProcurementOtherProgram('');
      setProcurementStudentCount('');
      setProcurementTeamCount('');
      setProcurementInstituteName('');
      await fetchProcurement();
    } catch (err) {
      setProcurementMsg(err.response?.data?.message || 'Unable to submit this request.');
    } finally {
      setProcurementSaving(false);
    }
  }

  const fetchPrograms = useCallback(async () => {
    if (!centerId) return;
    try {
      const { data } = await axios.get('/api/programs', { params: { centerId } });
      setPrograms(data);
    } catch (err) {
      console.error('Unable to load programs', err);
    }
  }, [centerId]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  function openProgramModal() {
    setEditingProgramId(null);
    setProgramForm({ name: '', handledBy: '', startDate: '', expectedEndDate: '', instituteName: '', notes: '', completionDate: '', status: 'planning' });
    setProgramMsg('');
    setProgramModalOpen(true);
  }

  function openEditProgramModal(program) {
    setEditingProgramId(program.id);
    setProgramForm({
      name: program.name || '',
      handledBy: program.handled_by || '',
      startDate: program.start_date || '',
      expectedEndDate: program.expected_end_date || '',
      instituteName: program.institute_name || '',
      notes: program.notes || '',
      completionDate: program.completion_date || '',
      status: program.status || 'planning',
    });
    setProgramMsg('');
    setProgramModalOpen(true);
  }

  async function handleProgramSubmit(event) {
    event.preventDefault();
    setProgramMsg('');
    if (!programForm.name.trim() || !programForm.handledBy.trim()) {
      setProgramMsg('Program name and who is handling it are required.');
      return;
    }
    setProgramSaving(true);
    const payload = {
      centerId,
      name: programForm.name.trim(), handledBy: programForm.handledBy.trim(),
      startDate: programForm.startDate, expectedEndDate: programForm.expectedEndDate,
      instituteName: programForm.instituteName.trim(), notes: programForm.notes.trim(),
      completionDate: programForm.completionDate, status: programForm.status,
    };
    try {
      if (editingProgramId) {
        await axios.put(`/api/programs/${editingProgramId}`, payload);
      } else {
        await axios.post('/api/programs', payload);
      }
      setProgramModalOpen(false);
      fetchPrograms();
    } catch (err) {
      setProgramMsg(err.response?.data?.message || `Unable to ${editingProgramId ? 'update' : 'create'} this program.`);
    } finally {
      setProgramSaving(false);
    }
  }

  function openProgramDetail(program) {
    navigate(`/admin/programs/${program.id}`);
  }

  const sortedPrograms = useMemo(() => {
    return [...programs].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [programs]);
  const recentPrograms = sortedPrograms.slice(0, 5);

  const centerName = isSuperAdmin
    ? (centers.find(c => c.id === centerId)?.name || 'Select a center')
    : (user?.centerName || 'your center');

  return (
    <div style={styles.page}>
      {isSuperAdmin && (
        <div style={{ marginBottom: 14 }}>
          <label style={styles.fieldLabel}>
            <span style={styles.labelText}>Viewing center</span>
            <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.input}>
              {centers.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
          </label>
        </div>
      )}
      <section style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div>
            <div style={{ ...styles.sectionHeading, marginBottom: 6 }}>Programs — {centerName}</div>
            <p style={styles.helperText}>
              Programs created here show up as a dropdown wherever a program/project name is asked — invoice entry, component
              add, and marking a unit damaged.
            </p>
          </div>
          {isSuperAdmin && (
            <button type="button" onClick={openProgramModal} style={styles.primarySmallBtn}>
              + Add Program
            </button>
          )}
        </div>
        {programs.length === 0 ? (
          <p style={styles.helperText}>No programs created yet.</p>
        ) : (
          <>
            <div style={styles.historyList}>
              {(showAllPrograms ? sortedPrograms : recentPrograms).map(program => (
                <ProgramRow key={program.id} program={program} onEdit={openEditProgramModal} onOpen={openProgramDetail} />
              ))}
            </div>
            {sortedPrograms.length > 5 && (
              <button type="button" onClick={() => setShowAllPrograms(v => !v)} style={styles.seeAllBtn}>
                {showAllPrograms ? 'Show recent only' : `See all programs (${sortedPrograms.length})`}
              </button>
            )}
          </>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div>
            <div style={{ ...styles.sectionHeading, marginBottom: 6 }}>Request New Components — {centerName}</div>
            <p style={styles.helperText}>
              For components your center doesn't have yet (or needs more of) for a prototype or program. Goes to the
              super admin for approval and procurement.
            </p>
          </div>
          <button type="button" onClick={() => { setProcurementFormOpen(true); setProcurementMsg(''); }} style={styles.primarySmallBtn}>
            + Request Components
          </button>
        </div>

        {procurementFormOpen && (
          <form onSubmit={handleProcurementSubmit} style={{ marginTop: '12px', marginBottom: '18px', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
            {procurementMsg && <p style={{ color: '#c62828', fontSize: '13px', marginTop: 0 }}>{procurementMsg}</p>}
            <div style={{ marginBottom: '12px', maxWidth: '360px' }}>
              <ProgramSelect
                programs={programs} mode="id" label="Program" required
                value={procurementProjectId} otherValue={procurementOtherProgram}
                onChange={setProcurementProjectId} onOtherChange={setProcurementOtherProgram}
              />
            </div>
            <p style={{ ...styles.helperText, marginTop: 0 }}>If this is for a workshop/session with visiting students, optionally fill in:</p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <label style={{ flex: '1 1 140px' }}>
                <span style={styles.labelText}>Number of Students</span>
                <input type="number" min="0" style={styles.input} value={procurementStudentCount}
                  onChange={e => setProcurementStudentCount(e.target.value)} />
              </label>
              <label style={{ flex: '1 1 140px' }}>
                <span style={styles.labelText}>Number of Teams</span>
                <input type="number" min="0" style={styles.input} value={procurementTeamCount}
                  onChange={e => setProcurementTeamCount(e.target.value)} />
              </label>
              <label style={{ flex: '1 1 200px' }}>
                <span style={styles.labelText}>Institute Name</span>
                <input style={styles.input} value={procurementInstituteName}
                  onChange={e => setProcurementInstituteName(e.target.value)} />
              </label>
            </div>
            {procurementRows.map(row => (
              <div key={row.id} style={{ ...styles.tableRow, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input style={styles.input} placeholder="Component name"
                    value={row.name} onChange={e => handleProcurementNameChange(row.id, e.target.value)} />
                  {row.componentId ? (
                    <span style={styles.helperText}>Currently available: {row.available} {row.unit}</span>
                  ) : (row.name.trim() && (
                    <span style={styles.helperText}>New component -- not currently in your inventory.</span>
                  ))}
                  {procurementSuggestionsMap[row.id]?.length ? (
                    <div style={styles.suggestionList}>
                      {procurementSuggestionsMap[row.id].map(item => (
                        <button key={item.id} type="button" style={styles.suggestionItem}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => handleProcurementSuggestionSelect(row.id, item)}>
                          <span style={styles.suggestionName}>{item.name}</span>
                          <span style={styles.suggestionMeta}>{item.stock || 0} pcs · {item.category || 'Inventory'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input style={{ ...styles.input, flex: 1, minWidth: '80px' }} type="number" min="1" placeholder="Qty"
                  value={row.qty} onChange={e => updateProcurementRow(row.id, 'qty', e.target.value)} />
                <input style={{ ...styles.input, flex: 2, minWidth: '160px' }} placeholder="Reason (optional)"
                  value={row.reason} onChange={e => updateProcurementRow(row.id, 'reason', e.target.value)} />
                <button type="button" onClick={() => removeProcurementRow(row.id)} style={styles.removeRowBtn}
                  disabled={procurementRows.length === 1} title="Remove this component">
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <button type="button" onClick={addProcurementRow} style={styles.seeAllBtn}>+ Add another component</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => setProcurementFormOpen(false)} style={styles.secondaryBtn}>Cancel</button>
                <button type="submit" disabled={procurementSaving} style={styles.primarySmallBtn}>
                  {procurementSaving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </form>
        )}

        {loadingProcurement ? (
          <p style={styles.helperText}>Loading...</p>
        ) : procurementRequests.length === 0 ? (
          <p style={styles.helperText}>No component requests yet.</p>
        ) : (
          <div style={styles.historyList}>
            {procurementRequests.map(request => (
              <div key={request.id} style={styles.historyItem}>
                <div style={styles.historyRow}>
                  <span style={styles.historyTitle}>Request #{request.id} {request.programName ? `· ${request.programName}` : ''}</span>
                  <span style={{ ...styles.statusBadge, ...(PROCUREMENT_STATUS_META[request.status] || {}) }}>{request.status}</span>
                </div>
                <div style={styles.componentList}>
                  {request.items.map(item => (
                    <span key={item.id} style={styles.componentPill}>{item.componentName} × {item.qtyRequested}</span>
                  ))}
                </div>
                {sessionContextLine(request) && <p style={styles.helperText}>{sessionContextLine(request)}</p>}
                {request.adminRemarks && <p style={styles.helperText}>Remarks: {request.adminRemarks}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {programModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setProgramModalOpen(false)}>
          <div style={styles.modal} onClick={event => event.stopPropagation()}>
            <h3 style={styles.modalTitle}>{editingProgramId ? 'Edit Program' : 'Add Program'}</h3>
            <p style={styles.modalText}>This becomes a selectable option wherever a program/project name is asked.</p>
            {programMsg && <div style={styles.error}>{programMsg}</div>}
            <label style={styles.modalLabel}>
              Program Name *
              <input style={styles.modalInput} value={programForm.name}
                onChange={e => setProgramForm({ ...programForm, name: e.target.value })} />
            </label>
            <label style={styles.modalLabel}>
              Handled By *
              <input style={styles.modalInput} value={programForm.handledBy}
                onChange={e => setProgramForm({ ...programForm, handledBy: e.target.value })}
                placeholder="Name of the admin/faculty managing this program" />
            </label>
            <label style={styles.modalLabel}>
              Program Start Date
              <input type="date" style={styles.modalInput} value={programForm.startDate}
                onChange={e => setProgramForm({ ...programForm, startDate: e.target.value })} />
            </label>
            <label style={styles.modalLabel}>
              Expected End Date
              <input type="date" style={styles.modalInput} value={programForm.expectedEndDate}
                onChange={e => setProgramForm({ ...programForm, expectedEndDate: e.target.value })} />
            </label>
            <label style={styles.modalLabel}>
              Institute Name (if an institute is involved)
              <input style={styles.modalInput} value={programForm.instituteName}
                onChange={e => setProgramForm({ ...programForm, instituteName: e.target.value })} />
            </label>
            <label style={styles.modalLabel}>
              Other Details
              <textarea style={{ ...styles.modalInput, minHeight: 70 }} value={programForm.notes}
                onChange={e => setProgramForm({ ...programForm, notes: e.target.value })} />
            </label>
            <label style={styles.modalLabel}>
              Status (set by the mentor/admin — this decides whether it's still selectable elsewhere)
              <select style={styles.modalInput} value={programForm.status}
                onChange={e => setProgramForm({ ...programForm, status: e.target.value })}>
                {PROGRAM_STATUS_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{PROGRAM_STATUS_META[opt].label}</option>
                ))}
              </select>
            </label>
            {editingProgramId && (
              <label style={styles.modalLabel}>
                Completion Date (optional record of when it actually wrapped up)
                <input type="date" style={styles.modalInput} value={programForm.completionDate}
                  onChange={e => setProgramForm({ ...programForm, completionDate: e.target.value })} />
              </label>
            )}
            <div style={styles.modalActions}>
              <button type="button" style={styles.modalCancelBtn} onClick={() => setProgramModalOpen(false)} disabled={programSaving}>
                Cancel
              </button>
              <button type="button" style={styles.primaryBtn} onClick={handleProgramSubmit} disabled={programSaving}>
                {programSaving ? 'Saving...' : editingProgramId ? 'Save changes' : 'Create Program'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NotificationsCard style={{ marginTop: '16px' }} />
    </div>
  );
}

function ProgramRow({ program, onEdit, onOpen }) {
  const meta = PROGRAM_STATUS_META[program.status] || PROGRAM_STATUS_META.planning;
  const timeline = program.completion_date
    ? `Completed ${program.completion_date}${program.start_date ? ` (started ${program.start_date})` : ''}`
    : `${program.start_date || 'Start date not set'} → ${program.expected_end_date || 'no expected end date'}`;
  return (
    <div style={styles.historyItemClickable} onClick={() => onOpen(program)}>
      <div style={styles.historyRow}>
        <span style={styles.historyTitle}>{program.name}</span>
        <span style={{ ...styles.statusBadge, color: meta.color, background: meta.bg }}>{meta.label}</span>
      </div>
      <div style={styles.historyRow}>
        <span>Handled by: {program.handled_by || '-'}</span>
        <span>Institute: {program.institute_name || '-'}</span>
      </div>
      <div style={styles.historyRow}>
        <span>{timeline}</span>
      </div>
      {program.notes && <div style={styles.historyRow}><span>{program.notes}</span></div>}
      <div style={{ ...styles.returnButtonRow, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={styles.helperText}>Click to view full transaction history & lifecycle</span>
        <button type="button" style={styles.secondaryBtn} onClick={event => { event.stopPropagation(); onEdit(program); }}>
          Edit
        </button>
      </div>
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
  cardHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  primarySmallBtn: {
    background: '#1a237e',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    padding: '10px 16px',
    whiteSpace: 'nowrap',
  },
  seeAllBtn: {
    marginTop: 14,
    background: 'transparent',
    border: '1px solid #cbd5f5',
    borderRadius: 10,
    padding: '10px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    color: '#1a237e',
    width: '100%',
  },
  statusBadge: {
    display: 'inline-flex',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
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
  historyItemClickable: { border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', background: '#f8fafc', cursor: 'pointer' },
  historyRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#1e1b4b', marginBottom: 6 },
  historyTitle: { fontWeight: 700, color: '#0f172a' },
  historyStatus: { fontWeight: 600, color: '#047857' },
  componentPill: { display: 'inline-flex', padding: '4px 8px', borderRadius: 8, background: '#fff', border: '1px solid #d1d5db', marginRight: 6, marginBottom: 6, fontSize: 12 },
  componentList: { display: 'flex', flexWrap: 'wrap', marginTop: 8 },
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
  modalWide: {
    background: '#fff',
    borderRadius: 20,
    padding: '28px',
    width: 'min(700px, 92%)',
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
