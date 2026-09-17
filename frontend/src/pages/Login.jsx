import React, { useEffect, useState } from 'react';
import axios from 'axios';
import QRCode from 'react-qr-code';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { APP_EXPANDED_NAME, APP_SUBTITLE, APP_SHORT_NAME, PRIMARY_COLOR, REGISTRATION_QUERY } from '../brand';
import { useCenters } from '../context/CentersContext';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';

const STUDENT_USER_GUIDE_URL = process.env.REACT_APP_STUDENT_GUIDE_URL || '';
// Stable public entry point (matches backend SITE_URL) -- not derived from
// window.location, so the QR/link stays correct regardless of which host
// (ngrok, a new domain, etc.) is actually serving the app underneath it.
// Set REACT_APP_SITE_URL at build time; falls back to the current origin so a
// fresh deployment still produces a working QR code instead of a dead link to
// somebody else's portal.
const STABLE_SITE_URL = process.env.REACT_APP_SITE_URL
  || (typeof window !== 'undefined' ? window.location.origin : '');

const INITIAL_REGISTER_FORM = {
  username: '',
  fullName: '',
  email: '',
  mobile: '',
  altMobile: '',
  college: '',
  graduationYear: '',
  degree: '',
  department: '',
  // Filled in from the fetched center list once it arrives -- there is no
  // compiled-in center to default to any more.
  centerId: '',
  password: '',
  confirmPassword: '',
};

export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const { centers } = useCenters();
  const { isMobile, isTablet } = useViewport();

  const [mode, setMode] = useState(searchParams.get('register') === '1' ? 'register' : 'login');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState(INITIAL_REGISTER_FORM);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [loading, setLoading] = useState(false);
  const [registrationLink, setRegistrationLink] = useState('');

  // Preselect the first center once the list arrives, so a registering
  // student is never looking at an empty required dropdown. Only fills a
  // blank value, so it never overwrites a choice the user already made.
  useEffect(() => {
    if (!centers.length) return;
    setRegisterForm(current => (
      current.centerId ? current : { ...current, centerId: centers[0].id }
    ));
  }, [centers]);

  // 'request' = enter username/email and ask for a code; 'reset' = enter
  // the emailed code plus a new password. Kept as local state rather than
  // a 'forgot' branch of `mode` needing a URL param -- there's no reason to
  // deep-link into this flow.
  const [forgotStep, setForgotStep] = useState('request');
  const [forgotLoginId, setForgotLoginId] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotCooldown, setForgotCooldown] = useState(0);

  useEffect(() => {
    if (forgotCooldown <= 0) return undefined;
    const timer = setInterval(() => setForgotCooldown(current => Math.max(current - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [forgotCooldown > 0]);

  useEffect(() => {
    setMode(searchParams.get('register') === '1' ? 'register' : 'login');
    const centerId = searchParams.get('centerId');
    if (centerId) {
      setRegisterForm(prev => ({ ...prev, centerId }));
    }
  }, [searchParams]);

  useEffect(() => {
    setRegistrationLink(`${STABLE_SITE_URL}/${REGISTRATION_QUERY}`);
  }, []);

  function switchMode(nextMode, options = {}) {
    if (!options.preserveMessage) {
      setMessage('');
      setMessageType('error');
    }
    setLoading(false);
    if (nextMode === 'register') {
      setSearchParams({ register: '1' });
    } else {
      setSearchParams({});
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const user = await login(loginForm.username.trim(), loginForm.password);
      navigate(['admin', 'super_admin'].includes(user.role) ? '/admin' : '/dashboard');
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setMessage('');

    const payload = {
      username: registerForm.username.trim(),
      fullName: registerForm.fullName.trim(),
      email: registerForm.email.trim(),
      mobile: registerForm.mobile.trim(),
      altMobile: registerForm.altMobile.trim(),
      college: registerForm.college.trim(),
      graduationYear: registerForm.graduationYear.trim(),
      degree: registerForm.degree.trim(),
      department: registerForm.department.trim(),
      centerId: registerForm.centerId,
      password: registerForm.password,
    };

    if (!payload.username || !payload.fullName || !payload.email || !payload.password || !payload.mobile || !payload.college || !payload.centerId) {
      setMessageType('error');
      setMessage('Username, full name, email, password, mobile, college, and center are required.');
      return;
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setMessageType('error');
      setMessage('Password and confirm password must match.');
      return;
    }

    setLoading(true);
    try {
      const response = await register(payload);
      setRegisterForm(INITIAL_REGISTER_FORM);
      setMessageType('success');
      setMessage(response.message || 'Registration submitted. Wait for admin approval.');
      switchMode('login', { preserveMessage: true });
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.message || 'Unable to register right now.');
    } finally {
      setLoading(false);
    }
  }

  function openForgotPassword() {
    setForgotStep('request');
    setForgotLoginId(loginForm.username.trim());
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotCooldown(0);
    setMessage('');
    setMode('forgot');
  }

  async function handleForgotRequest(event) {
    event.preventDefault();
    if (!forgotLoginId.trim()) {
      setMessageType('error');
      setMessage('Enter your username or email.');
      return;
    }
    setMessage('');
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/forgot-password', { loginId: forgotLoginId.trim() });
      setMessageType('success');
      setMessage(data.message);
      setForgotStep('reset');
      setForgotCooldown(45);
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.message || 'Unable to request a code right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotReset(event) {
    event.preventDefault();
    if (!forgotCode.trim() || !forgotNewPassword) {
      setMessageType('error');
      setMessage('Enter the code from your email and a new password.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setMessageType('error');
      setMessage('New password and confirm password must match.');
      return;
    }
    setMessage('');
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/reset-password', {
        loginId: forgotLoginId.trim(),
        code: forgotCode.trim(),
        newPassword: forgotNewPassword,
      });
      setLoginForm({ username: forgotLoginId.trim(), password: '' });
      setMessageType('success');
      setMessage(data.message || 'Password reset. You can now sign in.');
      setMode('login');
    } catch (err) {
      setMessageType('error');
      setMessage(err.response?.data?.message || 'Unable to reset password right now.');
    } finally {
      setLoading(false);
    }
  }

  async function copyRegistrationLink() {
    if (!registrationLink) return;
    try {
      await navigator.clipboard.writeText(registrationLink);
      setMessageType('success');
      setMessage('Registration link copied.');
    } catch {
      setMessageType('error');
      setMessage('Unable to copy the registration link on this device.');
    }
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.bg}>
        {[...Array(8)].map((_, index) => (
          <div key={index} style={{ ...styles.orb, ...orbPos[index] }} />
        ))}
      </div>

      <div style={{ ...styles.layout, ...(isTablet ? styles.layoutStacked : {}) }}>
        <div style={{ ...styles.card, ...(isMobile ? styles.cardMobile : {}) }}>
          <BrandLogo showSystemName={false} />

          {mode !== 'forgot' && (
            <div style={{ ...styles.tabRow, ...(isMobile ? styles.tabRowMobile : {}) }}>
              <button style={{ ...styles.tabBtn, ...(mode === 'login' ? styles.tabBtnActive : {}) }} onClick={() => switchMode('login')}>
                Sign In
              </button>
              <button style={{ ...styles.tabBtn, ...(mode === 'register' ? styles.tabBtnActive : {}) }} onClick={() => switchMode('register')}>
                Student Register
              </button>
            </div>
          )}

          <h2 style={{ ...styles.heading, ...(isMobile ? styles.headingMobile : {}), ...(mode === 'forgot' ? { marginTop: '26px' } : {}) }}>
            {mode === 'login' ? 'Welcome Back' : mode === 'forgot' ? 'Reset Your Password' : 'Student Self Registration'}
          </h2>
          <p style={styles.subheading}>
            {mode === 'login'
              ? `Sign in to access the ${APP_SUBTITLE} portal.`
              : mode === 'forgot'
              ? (forgotStep === 'request'
                ? "Enter your username or email and we'll send a verification code to your registered email."
                : 'Enter the code we emailed you and choose a new password.')
              : 'Students can submit their own registration. Admin approval is required before sign in.'}
          </p>

          {message && (
            <div style={{ ...styles.message, ...(messageType === 'success' ? styles.messageSuccess : styles.messageError) }}>
              {message}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <Field
                label="Username or Email"
                value={loginForm.username}
                onChange={value => setLoginForm(current => ({ ...current, username: value }))}
                autoComplete="username"
                autoFocus
                placeholder="Enter your username or email"
              />
              <PasswordField
                label="Password"
                value={loginForm.password}
                onChange={value => setLoginForm(current => ({ ...current, password: value }))}
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button type="submit" style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button type="button" style={styles.forgotLink} onClick={openForgotPassword}>Forgot password?</button>
            </form>
          ) : mode === 'forgot' ? (
            forgotStep === 'request' ? (
              <form onSubmit={handleForgotRequest}>
                <Field
                  label="Username or Email"
                  value={forgotLoginId}
                  onChange={setForgotLoginId}
                  autoComplete="username"
                  autoFocus
                  placeholder="Enter your username or email"
                />
                <button type="submit" style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
                  {loading ? 'Sending...' : 'Send Verification Code'}
                </button>
                <button type="button" style={styles.forgotLink} onClick={() => switchMode('login')}>Back to Sign In</button>
              </form>
            ) : (
              <form onSubmit={handleForgotReset}>
                <Field
                  label="Verification Code"
                  value={forgotCode}
                  onChange={setForgotCode}
                  autoFocus
                  placeholder="6-digit code from your email"
                />
                <PasswordField
                  label="New Password"
                  value={forgotNewPassword}
                  onChange={setForgotNewPassword}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                />
                <PasswordField
                  label="Confirm New Password"
                  value={forgotConfirmPassword}
                  onChange={setForgotConfirmPassword}
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                />
                <button type="submit" style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>
                <div style={styles.forgotRow}>
                  <button
                    type="button"
                    style={{ ...styles.forgotLink, opacity: forgotCooldown > 0 ? 0.5 : 1, cursor: forgotCooldown > 0 ? 'default' : 'pointer' }}
                    onClick={forgotCooldown > 0 ? undefined : handleForgotRequest}
                    disabled={forgotCooldown > 0}
                  >
                    {forgotCooldown > 0 ? `Resend code in ${forgotCooldown}s` : 'Resend code'}
                  </button>
                  <button type="button" style={styles.forgotLink} onClick={() => switchMode('login')}>Back to Sign In</button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleRegister}>
              <div style={{ ...styles.formGrid, ...(isMobile ? styles.formGridSingle : {}) }}>
                <Field label="Full Name" value={registerForm.fullName} onChange={value => setRegisterForm(current => ({ ...current, fullName: value }))} placeholder="Your full name" />
                <Field label="Username" value={registerForm.username} onChange={value => setRegisterForm(current => ({ ...current, username: value }))} placeholder="Choose a username" />
                <Field label="Email" type="email" value={registerForm.email} onChange={value => setRegisterForm(current => ({ ...current, email: value }))} placeholder="name@college.edu" fullWidth />
                <Field label="Mobile (WhatsApp)" value={registerForm.mobile} onChange={value => setRegisterForm(current => ({ ...current, mobile: value }))} placeholder="10-digit mobile" />
                <Field label="Alternative Mobile" value={registerForm.altMobile} onChange={value => setRegisterForm(current => ({ ...current, altMobile: value }))} placeholder="Alt mobile (optional)" />
                <Field label="College" value={registerForm.college} onChange={value => setRegisterForm(current => ({ ...current, college: value }))} placeholder="College/institution name" />
                <SelectField
                  label="Center"
                  value={registerForm.centerId}
                  onChange={value => setRegisterForm(current => ({ ...current, centerId: value }))}
                  options={centers}
                />
                <Field label="Year of Graduation" value={registerForm.graduationYear} onChange={value => setRegisterForm(current => ({ ...current, graduationYear: value }))} placeholder="2024" />
                <Field label="Degree" value={registerForm.degree} onChange={value => setRegisterForm(current => ({ ...current, degree: value }))} placeholder="B.Tech / B.Sc / MBA" />
                <Field label="Department" value={registerForm.department} onChange={value => setRegisterForm(current => ({ ...current, department: value }))} placeholder="ECE / CSE / Mechanical" />
                <PasswordField label="Password" value={registerForm.password} onChange={value => setRegisterForm(current => ({ ...current, password: value }))} placeholder="Create a password" />
                <PasswordField label="Confirm Password" value={registerForm.confirmPassword} onChange={value => setRegisterForm(current => ({ ...current, confirmPassword: value }))} placeholder="Repeat password" />
              </div>
              <button type="submit" style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
                {loading ? 'Submitting...' : 'Submit Registration'}
              </button>
            </form>
          )}

          <div style={styles.hint}>
            <p style={{ fontWeight: 700, color: PRIMARY_COLOR, marginBottom: '8px' }}>{APP_SHORT_NAME}</p>
            <p>{APP_EXPANDED_NAME}</p>
          </div>
        </div>

        <aside style={{ ...styles.sidePanel, ...(isTablet ? styles.sidePanelMobile : {}) }}>
          <div style={{ ...styles.sideCard, ...(isMobile ? styles.sideCardMobile : {}) }}>
            <h3 style={styles.sideTitle}>Student Registration QR</h3>
            <p style={styles.sideText}>Students can scan this QR or open the link below to register themselves.</p>
            <div style={styles.qrWrap}>
              {registrationLink && <QRCode value={registrationLink} size={isMobile ? 132 : 160} bgColor="#ffffff" fgColor="#1a237e" />}
            </div>
            <div style={styles.linkBox}>{registrationLink || 'Open this page in the browser to generate the registration link.'}</div>
            <button style={styles.secondaryBtn} onClick={copyRegistrationLink}>Copy Registration Link</button>
            {/* Hidden unless a guide URL is configured for this deployment --
                the previous hardcoded link pointed at Comedkare's document. */}
            {STUDENT_USER_GUIDE_URL && (
              <a
                href={STUDENT_USER_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.secondaryLinkBtn}
              >
                Students User Guide
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', autoComplete, autoFocus, fullWidth }) {
  return (
    <div style={{ ...styles.field, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function PasswordField({ label, value, onChange, placeholder, autoComplete, fullWidth }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={{ ...styles.field, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={styles.label}>{label}</label>
      <div style={styles.passwordContainer}>
        <input
          style={{ ...styles.input, paddingRight: '50px' }}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          style={styles.togglePasswordBtn}
          onClick={() => setShowPassword(!showPassword)}
          title={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? '🙈 Hide' : '👁️ Show'}
        </button>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options, fullWidth }) {
  return (
    <div style={{ ...styles.field, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={styles.label}>{label}</label>
      <select style={styles.input} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </div>
  );
}

const orbPos = [
  { top: '10%', left: '5%', width: '280px', height: '280px', background: 'rgba(249,168,37,0.16)' },
  { top: '62%', left: '12%', width: '180px', height: '180px', background: 'rgba(35,77,129,0.18)' },
  { top: '16%', right: '8%', width: '240px', height: '240px', background: 'rgba(35,77,129,0.12)' },
  { bottom: '8%', right: '8%', width: '320px', height: '320px', background: 'rgba(249,168,37,0.10)' },
  { top: '40%', left: '45%', width: '130px', height: '130px', background: 'rgba(255,255,255,0.08)' },
  { top: '8%', right: '28%', width: '90px', height: '90px', background: 'rgba(249,168,37,0.10)' },
  { bottom: '28%', left: '30%', width: '110px', height: '110px', background: 'rgba(35,77,129,0.12)' },
  { top: '74%', right: '24%', width: '78px', height: '78px', background: 'rgba(249,168,37,0.10)' },
];

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #102548 0%, #17355f 52%, #21436f 100%)', padding: '24px', position: 'relative', overflow: 'hidden' },
  pageMobile: { alignItems: 'flex-start', padding: '18px 14px 24px' },
  bg: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  orb: { position: 'absolute', borderRadius: '50%', filter: 'blur(64px)' },
  layout: { position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 560px) minmax(280px, 340px)', gap: '24px', width: '100%', maxWidth: '960px', alignItems: 'start' },
  layoutStacked: { gridTemplateColumns: '1fr', maxWidth: '640px' },
  card: { background: 'rgba(255,255,255,0.98)', borderRadius: '26px', padding: '34px', boxShadow: '0 32px 80px rgba(0,0,0,0.26)' },
  cardMobile: { padding: '24px 18px', borderRadius: '22px' },
  tabRow: { display: 'flex', gap: '10px', marginTop: '26px', marginBottom: '22px' },
  tabRowMobile: { flexDirection: 'column' },
  tabBtn: { flex: 1, border: '1px solid #dbe3f0', background: '#f8fafc', color: '#475569', borderRadius: '12px', padding: '12px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  tabBtnActive: { background: '#1a237e', color: '#fff', borderColor: '#1a237e' },
  heading: { fontFamily: "'DM Sans', sans-serif", fontSize: '28px', fontWeight: 800, color: '#102548', marginBottom: '8px' },
  headingMobile: { fontSize: '24px' },
  subheading: { fontSize: '14px', color: '#64748b', marginBottom: '22px', lineHeight: 1.6 },
  message: { padding: '12px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, marginBottom: '18px' },
  messageSuccess: { background: '#e8f5e9', border: '1px solid #a5d6a7', color: '#2e7d32' },
  messageError: { background: '#fce4ec', border: '1px solid #f48fb1', color: '#c62828' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' },
  formGridSingle: { gridTemplateColumns: '1fr' },
  field: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", color: '#102548', outline: 'none', background: '#fff' },
  passwordContainer: { position: 'relative', display: 'flex', alignItems: 'center' },
  togglePasswordBtn: { position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '4px 8px', color: '#1a237e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.2s ease' },
  primaryBtn: { width: '100%', padding: '14px', background: 'linear-gradient(135deg, #1a237e, #234d81)', border: 'none', borderRadius: '12px', color: '#fff', fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 800, cursor: 'pointer', marginTop: '8px' },
  forgotLink: { display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none', color: '#1a237e', fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginTop: '14px', padding: '4px', fontFamily: "'DM Sans', sans-serif" },
  forgotRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
  hint: { marginTop: '22px', padding: '14px 16px', background: '#f8fafc', borderRadius: '12px', fontSize: '12px', color: '#64748b', lineHeight: 1.8 },
  sidePanel: { display: 'flex' },
  sidePanelMobile: { width: '100%' },
  sideCard: { width: '100%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '24px', padding: '24px', color: '#fff', backdropFilter: 'blur(14px)' },
  sideCardMobile: { padding: '20px 18px', borderRadius: '20px' },
  sideTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 800, marginBottom: '10px' },
  sideText: { fontSize: '14px', lineHeight: 1.6, color: 'rgba(255,255,255,0.82)', marginBottom: '18px' },
  qrWrap: { background: '#fff', borderRadius: '18px', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' },
  linkBox: { background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.92)', borderRadius: '12px', padding: '12px', fontSize: '12px', lineHeight: 1.6, wordBreak: 'break-word', marginBottom: '14px' },
  secondaryBtn: { width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.14)', color: '#fff', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  secondaryLinkBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.14)', color: '#fff', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', marginTop: '12px', boxSizing: 'border-box' },
};
