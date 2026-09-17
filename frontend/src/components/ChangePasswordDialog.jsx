import React, { useState } from 'react';
import axios from 'axios';

// Self-service password change for every role, opened from the navbar.
//
// Every field carries an explicit autoComplete hint. Browsers key their
// password manager off these: "current-password" lets the saved password be
// offered for the field it belongs to, and "new-password" tells the browser
// this is a new credential to save rather than an old one to fill. Leaving
// them off is what let a saved admin login get autofilled into the student
// registration form.
export default function ChangePasswordDialog({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post('/api/auth/change-password', { currentPassword, newPassword });
      setDone(data.message || 'Password changed.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to change password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.dialog} onClick={event => event.stopPropagation()}>
        <h3 style={styles.title}>Change password</h3>

        {done ? (
          <>
            <div style={styles.success}>{done}</div>
            <button type="button" style={styles.primaryBtn} onClick={onClose}>Close</button>
          </>
        ) : (
          <form onSubmit={submit} autoComplete="off">
            {error && <div style={styles.error}>{error}</div>}

            <label style={styles.label}>Current password</label>
            <input
              style={styles.input}
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              required
            />

            <label style={styles.label}>New password</label>
            <div style={styles.row}>
              <input
                style={{ ...styles.input, marginBottom: 0 }}
                type={showNew ? 'text' : 'password'}
                name="newPassword"
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                minLength={8}
                required
              />
              <button type="button" style={styles.toggle} onClick={() => setShowNew(current => !current)}>
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>
            <div style={styles.hint}>At least 8 characters.</div>

            <label style={styles.label}>Confirm new password</label>
            <input
              style={styles.input}
              type={showNew ? 'text' : 'password'}
              name="confirmNewPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              required
            />

            <div style={styles.actions}>
              <button type="submit" style={{ ...styles.primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
                {saving ? 'Saving...' : 'Change password'}
              </button>
              <button type="button" style={styles.secondaryBtn} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(16,37,72,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' },
  dialog: { background: '#fff', borderRadius: '14px', padding: '22px', width: '100%', maxWidth: '400px', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 20px 50px rgba(16,37,72,0.25)' },
  title: { margin: '0 0 14px', fontSize: '17px', fontWeight: 800, color: '#1a1a2e' },
  label: { display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d7dde9', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', marginBottom: '4px' },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  toggle: { background: '#f1f3f9', border: '1px solid #d7dde9', borderRadius: '10px', padding: '9px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' },
  hint: { fontSize: '11px', color: '#9097a6', marginTop: '4px' },
  actions: { display: 'flex', gap: '10px', marginTop: '18px' },
  primaryBtn: { background: '#2d2a6e', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
  secondaryBtn: { background: '#f1f3f9', color: '#374151', border: '1px solid #d7dde9', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 600 },
  success: { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '10px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, marginBottom: '14px' },
};
