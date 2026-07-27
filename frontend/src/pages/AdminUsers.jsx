import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { CENTERS } from '../centers';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';

const EMPTY_FORM = {
  username: '',
  fullName: '',
  email: '',
  mobile: '',
  altMobile: '',
  college: '',
  graduationYear: '',
  degree: '',
  department: '',
  centerId: '',
  password: '',
  role: 'student',
  active: true,
};

export default function AdminUsers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile, isTablet } = useViewport();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pageMsg, setPageMsg] = useState('');
  const [pageMsgType, setPageMsgType] = useState('success');
  const [search, setSearch] = useState('');
  const [centerId, setCenterId] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    setCenterId(isSuperAdmin ? '' : (user?.centerId || ''));
  }, [isSuperAdmin, user]);

  useEffect(() => {
    fetchUsers();
    const timer = setInterval(fetchUsers, 30000);
    return () => clearInterval(timer);
  }, [centerId]);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  async function fetchUsers() {
    try {
      const { data } = await axios.get('/api/admin/users', { params: centerId ? { centerId } : {} });
      setUsers(data);
    } catch (err) {
      setPageMsgType('error');
      setPageMsg(err.response?.data?.message || 'Unable to load users right now.');
    } finally {
      setLoading(false);
    }
  }

  function handleSearchChange(value) {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  function openCreate() {
    setEditingId('');
    setForm({ ...EMPTY_FORM, centerId: isSuperAdmin ? centerId : (user?.centerId || '') });
    setMsg('');
    setModal('create');
  }

  function openEdit(user) {
    setEditingId(user.id);
    setForm({
      username: user.username || '',
      fullName: user.fullName || '',
      email: user.email || '',
      mobile: user.mobile || '',
      altMobile: user.altMobile || '',
      college: user.college || '',
      graduationYear: user.graduationYear || '',
      degree: user.degree || '',
      department: user.department || '',
      centerId: user.centerId || '',
      password: '',
      role: user.role || 'student',
      active: !!user.active,
    });
    setMsg('');
    setModal('edit');
  }

  async function handleCreate() {
    const payload = {
      ...form,
      username: form.username.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim(),
      altMobile: form.altMobile.trim(),
      college: form.college.trim(),
      graduationYear: form.graduationYear.trim(),
      degree: form.degree.trim(),
      department: form.department.trim(),
      centerId: form.centerId,
    };
    if (!payload.username || !payload.fullName || !payload.password) {
      setMsg('Username, full name, and password are required.');
      return;
    }

    setSaving(true);
    setMsg('');
    try {
      await axios.post('/api/admin/users', payload);
      await fetchUsers();
      setModal(null);
      setForm(EMPTY_FORM);
      setPageMsgType('success');
      setPageMsg(`User "${payload.username}" created successfully.`);
    } catch (err) {
      setMsg(err.response?.data?.message || 'Error creating user.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    const payload = {
      ...form,
      username: form.username.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim(),
      altMobile: form.altMobile.trim(),
      college: form.college.trim(),
      graduationYear: form.graduationYear.trim(),
      degree: form.degree.trim(),
      department: form.department.trim(),
      centerId: form.centerId,
    };
    if (!payload.username || !payload.fullName) {
      setMsg('Username and full name are required.');
      return;
    }
    if (!payload.password) delete payload.password;

    setSaving(true);
    setMsg('');
    try {
      await axios.put(`/api/admin/users/${editingId}`, payload);
      await fetchUsers();
      setModal(null);
      setPageMsgType('success');
      setPageMsg(`User "${payload.username}" updated successfully.`);
    } catch (err) {
      setMsg(err.response?.data?.message || 'Error updating user.');
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdate(userId, payload, successMessage) {
    try {
      await axios.put(`/api/admin/users/${userId}`, payload);
      await fetchUsers();
      setPageMsgType('success');
      setPageMsg(successMessage);
    } catch (err) {
      setPageMsgType('error');
      setPageMsg(err.response?.data?.message || 'Unable to update the user.');
    }
  }

  const students = users.filter(user => user.role === 'student');
  const admins = users.filter(user => user.role === 'admin');
  const pending = users.filter(user => user.role === 'student' && !user.active && user.source === 'self');
  const filteredUsers = users.filter(user => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      String(user.username || '').toLowerCase().includes(query) ||
      String(user.fullName || '').toLowerCase().includes(query) ||
      String(user.email || '').toLowerCase().includes(query) ||
      String(user.role || '').toLowerCase().includes(query) ||
      String(user.source || '').toLowerCase().includes(query)
    );
  });

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>User Management</h1>
            <p style={styles.sub}>{students.length} students · {admins.length} admins · {pending.length} pending approvals</p>
          </div>
          <button style={{ ...styles.addBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={openCreate}>+ Create User</button>
        </div>

        {isSuperAdmin && (
          <div style={styles.centerRow}>
            <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.centerSelect}>
              <option value="">All Centers</option>
              {CENTERS.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
          </div>
        )}

        {pageMsg && (
          <div style={{ ...styles.pageMsg, ...(pageMsgType === 'error' ? styles.pageMsgError : styles.pageMsgSuccess) }}>
            {pageMsg}
          </div>
        )}

        <div style={{ ...styles.statsRow, ...(isMobile ? styles.statsRowMobile : isTablet ? styles.statsRowTablet : {}) }}>
          <StatCard label="Students" value={students.length} />
          <StatCard label="Admins" value={admins.length} />
          <StatCard label="Pending Approval" value={pending.length} highlight />
        </div>

        <div style={styles.searchBar}>
          <input
            style={styles.searchInput}
            placeholder="Search by username, name, email, role..."
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
          />
        </div>

        {loading ? <div style={styles.loading}>Loading users...</div> : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Username</th>
                  <th style={styles.th}>Full Name</th>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Role</th>
                  <th style={styles.th}>Source</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Created</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={styles.emptyRow}>No users match this search.</td>
                  </tr>
                ) : filteredUsers.map((user, index) => {
                  const isPending = user.role === 'student' && !user.active && user.source === 'self';
                  return (
                    <tr key={user.id} style={{ ...styles.tr, background: index % 2 === 0 ? '#fff' : '#fafbff' }}>
                      <td style={{ ...styles.td, color: '#94a3b8', width: '40px' }}>{index + 1}</td>
                      <td style={styles.td}>
                        <div style={styles.usernameBadge}>
                          <span style={styles.avatar}>{(user.fullName || user.username || '?')[0]}</span>
                          <span style={styles.username}>{user.username}</span>
                        </div>
                      </td>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{user.fullName}</td>
                      <td style={{ ...styles.td, color: '#64748b', fontSize: '13px' }}>{user.email || '-'}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.roleBadge, ...(user.role === 'admin' ? styles.roleAdmin : styles.roleStudent) }}>
                          {user.role}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.sourceBadge}>{user.source === 'self' ? 'Self Register' : 'Manual'}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.statusBadge,
                          ...(isPending ? styles.statusPending : user.active ? styles.statusActive : styles.statusInactive),
                        }}>
                          {isPending ? 'Pending Approval' : user.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ ...styles.td, fontSize: '12px', color: '#64748b' }}>
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN') : '-'}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          {isPending && (
                            <button
                              style={styles.approveBtn}
                              onClick={() => quickUpdate(user.id, { active: true }, `Approved "${user.username}".`)}>
                              Approve
                            </button>
                          )}
                          <button style={styles.editBtn} onClick={() => openEdit(user)}>Edit</button>
                          <button
                            style={user.active ? styles.disableBtn : styles.activateBtn}
                            onClick={() => quickUpdate(user.id, { active: !user.active }, `${!user.active ? 'Activated' : 'Updated'} "${user.username}".`)}>
                            {user.active ? 'Disable' : 'Activate'}
                          </button>
                          <button
                            style={styles.deleteBtn}
                            onClick={async () => {
                              if (!window.confirm(`Delete user "${user.username}"?`)) return;
                              try {
                                await axios.delete(`/api/admin/users/${user.id}`);
                                await fetchUsers();
                                setPageMsgType('success');
                                setPageMsg(`User "${user.username}" deleted.`);
                              } catch (err) {
                                setPageMsgType('error');
                                setPageMsg(err.response?.data?.message || 'Unable to delete user.');
                              }
                            }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div style={styles.overlay} onClick={() => setModal(null)}>
          <div style={{ ...styles.modal, ...(isMobile ? styles.modalMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{modal === 'create' ? 'Create User' : 'Edit User'}</h3>
              <button style={styles.closeBtn} onClick={() => setModal(null)}>×</button>
            </div>

            {msg && <div style={styles.msgBox}>{msg}</div>}

            <div style={{ ...styles.modalGrid, ...(isMobile ? styles.modalGridSingle : {}) }}>
              <FormField label="Username *" value={form.username} onChange={value => setForm(current => ({ ...current, username: value }))} placeholder="e.g. student_2026" />
              <FormField label="Full Name *" value={form.fullName} onChange={value => setForm(current => ({ ...current, fullName: value }))} placeholder="Student full name" />
              <FormField label="Email" value={form.email} onChange={value => setForm(current => ({ ...current, email: value }))} placeholder="user@college.edu" fullWidth />
              <FormField
                label={modal === 'create' ? 'Password *' : 'Password (leave blank to keep current)'}
                type="password"
                value={form.password}
                onChange={value => setForm(current => ({ ...current, password: value }))}
                placeholder={modal === 'create' ? 'Set login password' : 'Only enter to reset password'}
                fullWidth
              />
              <div>
                <label style={styles.formLabel}>Role</label>
                <select style={styles.formInput} value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))}>
                  <option value="student">Student</option>
                  <option value="admin">Admin</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                </select>
              </div>
              <div>
                <label style={styles.formLabel}>Center</label>
                <select
                  style={styles.formInput}
                  value={form.centerId}
                  onChange={event => setForm(current => ({ ...current, centerId: event.target.value }))}
                  disabled={!isSuperAdmin || form.role === 'super_admin'}>
                  <option value="">Select center</option>
                  {CENTERS.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
              </div>
              <label style={styles.checkboxWrap}>
                <input type="checkbox" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))} />
                <span>Allow sign in</span>
              </label>
            </div>

            <div style={{ ...styles.modalFooter, ...(isMobile ? styles.modalFooterStack : {}) }}>
              <button style={{ ...styles.cancelBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={{ ...styles.saveBtn, ...(isMobile ? styles.fullWidthBtn : {}), opacity: saving ? 0.7 : 1 }}
                onClick={modal === 'create' ? handleCreate : handleUpdate}
                disabled={saving}>
                {saving ? 'Saving...' : modal === 'create' ? 'Create User' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight = false }) {
  return (
    <div style={{ ...styles.statCard, ...(highlight ? styles.statCardHighlight : {}) }}>
      <div style={styles.statVal}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = 'text', fullWidth }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={styles.formLabel}>{label}</label>
      <input
        style={styles.formInput}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1280px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px' },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px' },
  addBtn: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '14px' },
  fullWidthBtn: { width: '100%' },
  pageMsg: { padding: '12px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, marginBottom: '18px' },
  pageMsgSuccess: { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' },
  pageMsgError: { background: '#fce4ec', color: '#c62828', border: '1px solid #f48fb1' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginBottom: '24px' },
  statsRowTablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  statsRowMobile: { gridTemplateColumns: '1fr' },
  searchBar: { marginBottom: '18px' },
  searchInput: { width: '100%', padding: '12px 14px', border: '1.5px solid #dbe3f0', borderRadius: '12px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
  statCard: { background: '#fff', borderRadius: '12px', padding: '18px 24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  statCardHighlight: { border: '1px solid #fdba74', background: '#fffaf0' },
  statVal: { fontFamily: "'DM Sans', sans-serif", fontSize: '28px', fontWeight: 800, color: '#1a237e' },
  statLabel: { fontSize: '12px', color: '#6b7280', marginTop: '4px' },
  loading: { padding: '60px', textAlign: 'center', color: '#6b7280' },
  tableWrap: { background: '#fff', borderRadius: '14px', overflowX: 'auto', overflowY: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  table: { width: '100%', minWidth: '980px', borderCollapse: 'collapse' },
  emptyRow: { padding: '30px 14px', textAlign: 'center', fontSize: '13px', color: '#64748b', background: '#fff' },
  thead: { background: '#17355f' },
  th: { padding: '12px 14px', color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'left' },
  tr: { borderBottom: '1px solid #f0f2f8' },
  td: { padding: '12px 14px', fontSize: '13px', color: '#374151', verticalAlign: 'middle' },
  usernameBadge: { display: 'flex', alignItems: 'center', gap: '8px' },
  avatar: { width: '30px', height: '30px', borderRadius: '50%', background: '#e8eef8', color: '#17355f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px', flexShrink: 0 },
  username: { fontWeight: 700, fontFamily: "'DM Sans', sans-serif" },
  roleBadge: { padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, textTransform: 'capitalize' },
  roleAdmin: { background: '#e8eaf6', color: '#1a237e' },
  roleStudent: { background: '#e8f5e9', color: '#2e7d32' },
  sourceBadge: { background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  statusBadge: { padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  statusPending: { background: '#fff3e0', color: '#ef6c00' },
  statusActive: { background: '#e8f5e9', color: '#2e7d32' },
  statusInactive: { background: '#f1f5f9', color: '#64748b' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  approveBtn: { background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  editBtn: { background: '#e8eef8', color: '#17355f', border: 'none', borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  disableBtn: { background: '#fce4ec', color: '#c62828', border: 'none', borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  activateBtn: { background: '#e8f5e9', color: '#2e7d32', border: 'none', borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  deleteBtn: { background: '#ffcdd2', color: '#b71c1c', border: 'none', borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '20px' },
  modal: { background: '#fff', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '560px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalMobile: { padding: '22px 18px' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  modalTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 800, color: '#1a1a2e' },
  closeBtn: { background: '#f0f2f8', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: '#6b7280' },
  msgBox: { background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
  modalGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' },
  modalGridSingle: { gridTemplateColumns: '1fr' },
  formLabel: { display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '5px' },
  formInput: { width: '100%', padding: '10px 13px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  checkboxWrap: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', fontWeight: 600, alignSelf: 'end', minHeight: '42px' },
  modalFooter: { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
  modalFooterStack: { flexDirection: 'column' },
  cancelBtn: { background: '#f0f2f8', border: 'none', padding: '10px 18px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 },
  saveBtn: { background: 'linear-gradient(135deg, #17355f, #234d81)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 800 },
};
