import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useCenters } from '../context/CentersContext';
import useViewport from '../hooks/useViewport';

// Super-admin settings: who order notifications go to, which business heads
// invoices can be booked against, and which centers exist.
//
// Both were previously fixed at deploy time -- notification contacts lived in
// backend/.env behind a service restart, and centers were a hardcoded array in
// two source files. They are on one screen because they are the same job: when
// the admin responsible for a center changes, you update that center's contact
// details; when the organisation opens a new center, you add it here instead
// of asking for a code change.

const EMPTY_CENTER_FORM = {
  id: '',
  name: '',
  code: '',
  notificationEmail: '',
  whatsappNumber: '',
  active: true,
};

export default function AdminSettings() {
  const { user } = useAuth();
  const { refresh: refreshCenters } = useCenters();
  const { isMobile } = useViewport();

  const [settings, setSettings] = useState(null);
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [notifyForm, setNotifyForm] = useState({ orderEmail: '', whatsappAdmin: '' });
  const [savingNotify, setSavingNotify] = useState(false);
  const [testing, setTesting] = useState(''); // 'email' | 'whatsapp' | ''
  const [testResult, setTestResult] = useState(null); // { ok, text }

  const [centerForm, setCenterForm] = useState(EMPTY_CENTER_FORM);
  const [editingId, setEditingId] = useState('');
  const [savingCenter, setSavingCenter] = useState(false);
  const [centerError, setCenterError] = useState('');

  const [heads, setHeads] = useState([]);
  const [headName, setHeadName] = useState('');
  const [editingHeadId, setEditingHeadId] = useState(null);
  const [savingHead, setSavingHead] = useState(false);
  const [headError, setHeadError] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      // includeInactive: a super admin managing centers needs to see retired
      // ones in order to bring one back.
      const [settingsRes, centersRes, headsRes] = await Promise.all([
        axios.get('/api/admin/settings'),
        axios.get('/api/admin/centers?includeInactive=true'),
        axios.get('/api/admin/business-heads?includeInactive=true'),
      ]);
      setSettings(settingsRes.data);
      setNotifyForm({
        orderEmail: settingsRes.data.orderEmail || '',
        whatsappAdmin: settingsRes.data.whatsappAdmin || '',
      });
      setCenters(Array.isArray(centersRes.data) ? centersRes.data : []);
      setHeads(Array.isArray(headsRes.data) ? headsRes.data : []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  }

  async function saveNotify(event) {
    event.preventDefault();
    setSavingNotify(true);
    setError('');
    try {
      const { data } = await axios.put('/api/admin/settings', notifyForm);
      setSettings(data);
      // Echo back what the server stored: it normalises phone numbers, so the
      // field should show the saved form, not what was typed.
      setNotifyForm({ orderEmail: data.orderEmail || '', whatsappAdmin: data.whatsappAdmin || '' });
      flash('Notification settings saved.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save settings');
    } finally {
      setSavingNotify(false);
    }
  }

  // Sends a test to whatever is currently typed in the field -- not the saved
  // value -- so a new address or number can be checked before committing it.
  async function sendTest(kind) {
    setTesting(kind);
    setTestResult(null);
    try {
      const { data } = kind === 'email'
        ? await axios.post('/api/admin/settings/test-email', { to: notifyForm.orderEmail })
        : await axios.post('/api/admin/settings/test-whatsapp', { to: notifyForm.whatsappAdmin });
      setTestResult({ ok: true, text: data.message });
    } catch (err) {
      setTestResult({ ok: false, text: err?.response?.data?.message || `Unable to send test ${kind}` });
    } finally {
      setTesting('');
    }
  }

  // Derives the id/code the backend would generate, so the form shows what is
  // about to be created rather than surprising the user after the fact.
  async function suggestFromName(name) {
    if (editingId || !name.trim()) return;
    try {
      const { data } = await axios.get('/api/admin/centers/suggest', { params: { name } });
      setCenterForm(current => ({
        ...current,
        id: current.id || data.id || '',
        code: current.code || data.code || '',
      }));
    } catch {
      // Suggestion is a convenience; the server validates on submit anyway.
    }
  }

  function startEdit(center) {
    setEditingId(center.id);
    setCenterForm({
      id: center.id,
      name: center.name,
      code: center.code,
      notificationEmail: center.notificationEmail || '',
      whatsappNumber: center.whatsappNumber || '',
      active: center.active,
    });
    setCenterError('');
  }

  function cancelEdit() {
    setEditingId('');
    setCenterForm(EMPTY_CENTER_FORM);
    setCenterError('');
  }

  async function saveCenter(event) {
    event.preventDefault();
    setSavingCenter(true);
    setCenterError('');
    try {
      if (editingId) {
        await axios.put(`/api/admin/centers/${editingId}`, centerForm);
        flash(`Center "${centerForm.name}" updated.`);
      } else {
        await axios.post('/api/admin/centers', centerForm);
        flash(`Center "${centerForm.name}" created.`);
      }
      cancelEdit();
      await load();
      // The public center list feeds login and every center dropdown, so it
      // has to be refetched or the new center is invisible until reload.
      await refreshCenters();
    } catch (err) {
      setCenterError(err?.response?.data?.message || 'Unable to save center');
    } finally {
      setSavingCenter(false);
    }
  }

  async function toggleActive(center) {
    try {
      await axios.put(`/api/admin/centers/${center.id}`, { active: !center.active });
      flash(`Center "${center.name}" ${center.active ? 'deactivated' : 'reactivated'}.`);
      await load();
      await refreshCenters();
    } catch (err) {
      setCenterError(err?.response?.data?.message || 'Unable to update center');
    }
  }

  async function removeCenter(center) {
    // Tell the user what will actually happen before they commit: a center
    // that owns records is retired, not deleted, and the difference matters.
    let usage = { canHardDelete: true, references: {} };
    try {
      const { data } = await axios.get(`/api/admin/centers/${center.id}/usage`);
      usage = data;
    } catch {
      // Fall through to the cautious wording below.
    }

    const summary = Object.entries(usage.references || {})
      .map(([table, count]) => `${count} ${table.replace(/_/g, ' ')}`)
      .join(', ');

    const confirmText = usage.canHardDelete
      ? `Delete "${center.name}"? It has no records, so it will be removed completely.`
      : `"${center.name}" has ${summary}.\n\nIt cannot be deleted without losing that history, so it will be deactivated instead: hidden from new orders and dropdowns, with all records kept.\n\nContinue?`;

    if (!window.confirm(confirmText)) return;

    try {
      const { data } = await axios.delete(`/api/admin/centers/${center.id}`);
      flash(data.deleted
        ? `Center "${center.name}" deleted.`
        : `Center "${center.name}" deactivated; its records were kept.`);
      await load();
      await refreshCenters();
    } catch (err) {
      setCenterError(err?.response?.data?.message || 'Unable to remove center');
    }
  }

  // ---------- Business heads ----------

  function startEditHead(head) {
    setEditingHeadId(head.id);
    setHeadName(head.name);
    setHeadError('');
  }

  function cancelEditHead() {
    setEditingHeadId(null);
    setHeadName('');
    setHeadError('');
  }

  async function saveHead(event) {
    event.preventDefault();
    setSavingHead(true);
    setHeadError('');
    try {
      if (editingHeadId) {
        await axios.put(`/api/admin/business-heads/${editingHeadId}`, { name: headName });
        flash(`Business head renamed to "${headName.trim()}".`);
      } else {
        await axios.post('/api/admin/business-heads', { name: headName });
        flash(`Business head "${headName.trim()}" added.`);
      }
      cancelEditHead();
      await load();
    } catch (err) {
      setHeadError(err?.response?.data?.message || 'Unable to save business head');
    } finally {
      setSavingHead(false);
    }
  }

  async function toggleHeadActive(head) {
    try {
      await axios.put(`/api/admin/business-heads/${head.id}`, { active: !head.active });
      flash(`Business head "${head.name}" ${head.active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (err) {
      setHeadError(err?.response?.data?.message || 'Unable to update business head');
    }
  }

  async function removeHead(head) {
    let usage = { canHardDelete: true, references: {} };
    try {
      const { data } = await axios.get(`/api/admin/business-heads/${head.id}/usage`);
      usage = data;
    } catch {
      // Cautious wording below covers it.
    }
    const summary = Object.entries(usage.references || {})
      .map(([table, count]) => `${count} ${table}`)
      .join(', ');
    const confirmText = usage.canHardDelete
      ? `Delete business head "${head.name}"? Nothing is booked against it, so it will be removed completely.`
      : `"${head.name}" is booked on ${summary}.

It will be deactivated instead of deleted: hidden from new invoices, with existing records kept.

Continue?`;
    if (!window.confirm(confirmText)) return;

    try {
      const { data } = await axios.delete(`/api/admin/business-heads/${head.id}`);
      flash(data.deleted
        ? `Business head "${head.name}" deleted.`
        : `Business head "${head.name}" deactivated; its invoices were kept.`);
      await load();
    } catch (err) {
      setHeadError(err?.response?.data?.message || 'Unable to remove business head');
    }
  }

  if (!isSuperAdmin) {
    return <div style={styles.page}><div style={styles.card}>Super admin access required.</div></div>;
  }

  if (loading) {
    return <div style={styles.page}><div style={styles.card}>Loading settings...</div></div>;
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.header}>
        <h1 style={styles.title}>Settings</h1>
        <p style={styles.subtitle}>Notification contacts and centers for {settings?.orgName || 'this portal'}.</p>
      </div>

      {message && <div style={styles.successBanner}>{message}</div>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* ---------- Notification contacts ---------- */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Order notifications</h2>
        <p style={styles.cardHint}>
          Where new order alerts are sent when a center has no contact of its own.
          Changes take effect immediately -- no restart needed.
        </p>

        <form onSubmit={saveNotify}>
          <div style={{ ...styles.formGrid, ...(isMobile ? styles.formGridMobile : {}) }}>
            <Field
              label="Order notification email"
              value={notifyForm.orderEmail}
              onChange={value => setNotifyForm(current => ({ ...current, orderEmail: value }))}
              placeholder="orders@example.org"
              type="email"
              action={{
                label: testing === 'email' ? 'Sending...' : 'Send test email',
                onClick: () => sendTest('email'),
                disabled: !!testing || !notifyForm.orderEmail,
              }}
            />
            <Field
              label="Admin WhatsApp number"
              value={notifyForm.whatsappAdmin}
              onChange={value => setNotifyForm(current => ({ ...current, whatsappAdmin: value }))}
              placeholder="9686737460"
              hint="10 digits assumes +91; include a country code for anything else."
              action={{
                label: testing === 'whatsapp' ? 'Sending...' : 'Send test message',
                onClick: () => sendTest('whatsapp'),
                disabled: !!testing || !notifyForm.whatsappAdmin,
              }}
            />
          </div>
          {testResult && (
            <div style={testResult.ok ? styles.successBanner : styles.errorBanner}>{testResult.text}</div>
          )}
          <button type="submit" style={{ ...styles.primaryBtn, opacity: savingNotify ? 0.7 : 1 }} disabled={savingNotify}>
            {savingNotify ? 'Saving...' : 'Save notification settings'}
          </button>
        </form>

        <div style={styles.metaRow}>
          <span style={styles.metaLabel}>Emails are sent as</span>
          <span style={styles.metaValue}>{settings?.emailSenderName || '-'}</span>
        </div>
      </div>

      {/* ---------- Business heads ---------- */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Business heads</h2>
        <p style={styles.cardHint}>
          The funding entity an invoice is booked against. Every head listed here is
          offered in the Invoices and Add Component forms and gets its own column in
          the dashboard's asset-value breakdown.
        </p>

        {headError && <div style={styles.errorBanner}>{headError}</div>}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Business head</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {heads.map(head => (
                <tr key={head.id} style={head.active ? undefined : styles.inactiveRow}>
                  <td style={styles.td}><span style={styles.centerName}>{head.name}</span></td>
                  <td style={styles.td}>
                    <span style={head.active ? styles.activePill : styles.inactivePill}>
                      {head.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button style={styles.linkBtn} onClick={() => startEditHead(head)}>Rename</button>
                      <button style={styles.linkBtn} onClick={() => toggleHeadActive(head)}>
                        {head.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button style={styles.dangerLinkBtn} onClick={() => removeHead(head)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!heads.length && (
                <tr><td style={styles.td} colSpan={3}>No business heads yet -- invoices cannot be entered until one exists.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.divider} />

        <h3 style={styles.subCardTitle}>{editingHeadId ? 'Rename business head' : 'Add a business head'}</h3>
        <form onSubmit={saveHead}>
          <div style={{ ...styles.formGrid, ...(isMobile ? styles.formGridMobile : {}) }}>
            <Field
              label="Name"
              value={headName}
              onChange={setHeadName}
              placeholder="ERA Foundation"
              required
            />
          </div>
          <div style={styles.formActions}>
            <button type="submit" style={{ ...styles.primaryBtn, opacity: savingHead ? 0.7 : 1 }} disabled={savingHead}>
              {savingHead ? 'Saving...' : editingHeadId ? 'Save name' : 'Add business head'}
            </button>
            {editingHeadId && (
              <button type="button" style={styles.secondaryBtn} onClick={cancelEditHead}>Cancel</button>
            )}
          </div>
        </form>
      </div>

      {/* ---------- Centers ---------- */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Centers</h2>
        <p style={styles.cardHint}>
          Every center added here appears in the login screen, the center dropdowns,
          and inventory scoping straight away.
        </p>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Center</th>
                <th style={styles.th}>Code</th>
                <th style={styles.th}>Order email</th>
                <th style={styles.th}>WhatsApp</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {centers.map(center => (
                <tr key={center.id} style={center.active ? undefined : styles.inactiveRow}>
                  <td style={styles.td}>
                    <div style={styles.centerName}>{center.name}</div>
                    <div style={styles.centerId}>{center.id}</div>
                  </td>
                  <td style={styles.td}><span style={styles.codePill}>{center.code}</span></td>
                  <td style={styles.td}>
                    {center.notificationEmail || <span style={styles.inherited}>uses default</span>}
                  </td>
                  <td style={styles.td}>
                    {center.whatsappNumber || <span style={styles.inherited}>uses default</span>}
                  </td>
                  <td style={styles.td}>
                    <span style={center.active ? styles.activePill : styles.inactivePill}>
                      {center.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button style={styles.linkBtn} onClick={() => startEdit(center)}>Edit</button>
                      <button style={styles.linkBtn} onClick={() => toggleActive(center)}>
                        {center.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button style={styles.dangerLinkBtn} onClick={() => removeCenter(center)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!centers.length && (
                <tr><td style={styles.td} colSpan={6}>No centers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={styles.divider} />

        <h3 style={styles.subCardTitle}>{editingId ? `Edit ${centerForm.name || 'center'}` : 'Add a new center'}</h3>
        {centerError && <div style={styles.errorBanner}>{centerError}</div>}

        <form onSubmit={saveCenter}>
          <div style={{ ...styles.formGrid, ...(isMobile ? styles.formGridMobile : {}) }}>
            <Field
              label="Center name"
              value={centerForm.name}
              onChange={value => setCenterForm(current => ({ ...current, name: value }))}
              onBlur={() => suggestFromName(centerForm.name)}
              placeholder="AKTU, Lucknow"
              required
            />
            <Field
              label="Center code"
              value={centerForm.code}
              onChange={value => setCenterForm(current => ({ ...current, code: value.toUpperCase() }))}
              placeholder="AKTU"
              hint="Printed on asset tags. Keep it stable once tags exist."
              required
            />
            {!editingId && (
              <Field
                label="Center ID"
                value={centerForm.id}
                onChange={value => setCenterForm(current => ({ ...current, id: value }))}
                placeholder="aktu_lucknow"
                hint="Permanent. Derived from the name if left blank."
              />
            )}
            <Field
              label="Order email for this center"
              value={centerForm.notificationEmail}
              onChange={value => setCenterForm(current => ({ ...current, notificationEmail: value }))}
              placeholder="Leave blank to use the default above"
              type="email"
            />
            <Field
              label="WhatsApp number for this center"
              value={centerForm.whatsappNumber}
              onChange={value => setCenterForm(current => ({ ...current, whatsappNumber: value }))}
              placeholder="Leave blank to use the default above"
            />
          </div>

          <div style={styles.formActions}>
            <button type="submit" style={{ ...styles.primaryBtn, opacity: savingCenter ? 0.7 : 1 }} disabled={savingCenter}>
              {savingCenter ? 'Saving...' : editingId ? 'Save changes' : 'Create center'}
            </button>
            {editingId && (
              <button type="button" style={styles.secondaryBtn} onClick={cancelEdit}>Cancel</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// `action` renders a small button beside the input (used for "Send test").
function Field({ label, value, onChange, onBlur, placeholder, type = 'text', hint, required, action }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>
        {label}{required && <span style={styles.required}> *</span>}
      </label>
      <div style={styles.inputRow}>
        <input
          style={{ ...styles.input, flex: 1 }}
          type={type}
          value={value}
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
        />
        {action && (
          <button
            type="button"
            style={{ ...styles.testBtn, opacity: action.disabled ? 0.5 : 1, cursor: action.disabled ? 'default' : 'pointer' }}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        )}
      </div>
      {hint && <div style={styles.hint}>{hint}</div>}
    </div>
  );
}

const styles = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px', fontFamily: "'DM Sans', sans-serif" },
  pageMobile: { padding: '18px 14px 40px' },
  header: { marginBottom: '20px' },
  title: { fontSize: '26px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
  subtitle: { color: '#6b7280', fontSize: '14px', marginTop: '6px' },
  card: { background: '#fff', borderRadius: '14px', border: '1px solid #e3e8f2', padding: '22px', marginBottom: '22px', boxShadow: '0 1px 3px rgba(16,37,72,0.04)' },
  cardTitle: { fontSize: '17px', fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' },
  subCardTitle: { fontSize: '15px', fontWeight: 700, color: '#1a1a2e', margin: '0 0 12px' },
  cardHint: { color: '#6b7280', fontSize: '13px', margin: '0 0 18px', lineHeight: 1.5 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '18px' },
  formGridMobile: { gridTemplateColumns: '1fr' },
  field: { display: 'flex', flexDirection: 'column' },
  label: { fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px' },
  required: { color: '#dc2626' },
  input: { padding: '10px 12px', borderRadius: '10px', border: '1px solid #d7dde9', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  inputRow: { display: 'flex', gap: '8px', alignItems: 'stretch' },
  testBtn: { background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '0 12px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif" },
  hint: { fontSize: '11px', color: '#9097a6', marginTop: '5px', lineHeight: 1.4 },
  primaryBtn: { background: '#2d2a6e', color: '#fff', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
  secondaryBtn: { background: '#f1f3f9', color: '#374151', border: '1px solid #d7dde9', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
  formActions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  successBanner: { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '11px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', fontWeight: 600 },
  errorBanner: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '11px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', fontWeight: 600 },
  metaRow: { display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #eef1f7' },
  metaLabel: { fontSize: '12px', color: '#6b7280' },
  metaValue: { fontSize: '13px', fontWeight: 700, color: '#1a1a2e' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eef1f7', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  td: { padding: '12px', borderBottom: '1px solid #f1f3f9', verticalAlign: 'top' },
  inactiveRow: { opacity: 0.55 },
  centerName: { fontWeight: 700, color: '#1a1a2e' },
  centerId: { fontSize: '11px', color: '#9097a6', marginTop: '2px' },
  codePill: { background: '#eef2ff', color: '#3730a3', padding: '3px 9px', borderRadius: '6px', fontWeight: 700, fontSize: '11px' },
  inherited: { color: '#9097a6', fontStyle: 'italic', fontSize: '12px' },
  activePill: { background: '#ecfdf5', color: '#047857', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  inactivePill: { background: '#f3f4f6', color: '#6b7280', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  linkBtn: { background: 'none', border: 'none', color: '#2d2a6e', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: 0, fontFamily: "'DM Sans', sans-serif" },
  dangerLinkBtn: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '12px', fontWeight: 700, padding: 0, fontFamily: "'DM Sans', sans-serif" },
  divider: { height: '1px', background: '#eef1f7', margin: '22px 0' },
};
