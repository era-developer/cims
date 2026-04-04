import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';

const INITIAL_FORM = {
  fullName: '',
  email: '',
  mobile: '',
  altMobile: '',
  college: '',
  degree: '',
  department: '',
  graduationYear: '',
};

export default function MyProfile() {
  const { user, refreshProfile, updateProfile } = useAuth();
  const { isMobile } = useViewport();
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');

  // Load profile once per signed-in user to avoid resetting typed edits on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    async function loadProfile() {
      try {
        const profile = await refreshProfile();
        setForm({
          fullName: profile.fullName || '',
          email: profile.email || '',
          mobile: profile.mobile || '',
          altMobile: profile.altMobile || '',
          college: profile.college || '',
          degree: profile.degree || '',
          department: profile.department || '',
          graduationYear: profile.graduationYear || '',
        });
      } catch {
        setForm({
          fullName: user?.fullName || '',
          email: user?.email || '',
          mobile: user?.mobile || '',
          altMobile: user?.altMobile || '',
          college: user?.college || '',
          degree: user?.degree || '',
          department: user?.department || '',
          graduationYear: user?.graduationYear || '',
        });
        setMessageType('error');
        setMessage('Unable to refresh profile from server. Showing your saved session data.');
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [user?.id]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm(current => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await updateProfile(form);
      setMessageType('success');
      setMessage('Profile updated successfully.');
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.message || 'Unable to update your profile right now.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={styles.loading}>Loading your profile...</div>;
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>My Profile</h1>
          <p style={styles.sub}>Keep your contact and academic details up to date so checkout is faster next time.</p>
        </div>

        <div style={styles.card}>
          {message && (
            <div style={{ ...styles.message, ...(messageType === 'success' ? styles.messageSuccess : styles.messageError) }}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
              <Field label="Full Name" name="fullName" value={form.fullName} onChange={handleChange} placeholder="Your full name" />
              <Field label="Email" name="email" value={form.email} onChange={handleChange} placeholder="name@college.edu" />
              <Field label="Mobile Number" name="mobile" value={form.mobile} onChange={handleChange} placeholder="10-digit mobile" />
              <Field label="Alternative Mobile" name="altMobile" value={form.altMobile} onChange={handleChange} placeholder="Optional alternate mobile" />
              <Field label="College / Institution" name="college" value={form.college} onChange={handleChange} placeholder="Institution name" fullWidth />
              <Field label="Degree" name="degree" value={form.degree} onChange={handleChange} placeholder="B.Tech / B.Sc / MBA" />
              <Field label="Department" name="department" value={form.department} onChange={handleChange} placeholder="ECE / CSE / Mechanical" />
              <Field label="Graduation Year" name="graduationYear" value={form.graduationYear} onChange={handleChange} placeholder="2026" />
            </div>

            <div style={styles.actions}>
              <button type="submit" style={{ ...styles.saveBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, placeholder, fullWidth }) {
  return (
    <div style={{ ...styles.field, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '920px', margin: '0 auto' },
  loading: { padding: '80px', textAlign: 'center', color: '#6b7280' },
  header: { marginBottom: '22px' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '28px', fontWeight: 800, color: '#1a1a2e', marginBottom: '8px' },
  sub: { color: '#6b7280', fontSize: '14px', lineHeight: 1.6 },
  card: { background: '#fff', borderRadius: '18px', padding: '28px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  message: { padding: '12px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, marginBottom: '18px' },
  messageSuccess: { background: '#e8f5e9', border: '1px solid #a5d6a7', color: '#2e7d32' },
  messageError: { background: '#fce4ec', border: '1px solid #f48fb1', color: '#c62828' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  gridMobile: { gridTemplateColumns: '1fr' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: 700, color: '#334155' },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", color: '#102548', outline: 'none', background: '#fff' },
  actions: { display: 'flex', justifyContent: 'flex-end', marginTop: '24px' },
  saveBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", fontSize: '14px' },
};
