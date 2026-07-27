import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';

// Center-specific admin WhatsApp numbers
const ADMIN_WHATSAPP_NUMBERS = {
  jp_nagar: '+918951955093',      // JP Nagar admin
  yelahanka: '+918951955092',     // Yelahanka admin
  gopalan_mall: '+919876543212',  // Gopalan Mall admin
  mysore: '+918951955095',        // Mysore admin
  tumkur: '+918951955094',        // Tumkur admin
  mangalore: '+918951955096',     // Mangalore admin
  hubballi: '+918951717352',      // Hubballi admin
  belagavi: '+918951955097',      // Belagavi admin
  kalaburagi: '+918951955098',    // Kalaburagi admin
};

// Fallback number if center not found
const DEFAULT_ADMIN_WHATSAPP_NUMBER = '911234567890';

const ADMIN_LOGIN_URL = 'https://bit.ly/comedkares_ims';

const INITIAL_DETAILS = {
  studentName: '',
  email: '',
  mobile: '',
  altMobile: '',
  college: '',
  degree: '',
  department: '',
  graduationYear: '',
  usn: '',
  semester: '',
  courseName: '',
  projectName: '',
  teamName: '',
  facultyGuide: '',
  expectedReturnDate: '',
  purpose: '',
};

export default function Cart() {
  const { cart, updateQty, removeFromCart, clearCart, totalItems } = useCart();
  const { user, updateProfile } = useAuth();
  const { isMobile, isTablet } = useViewport();
  const navigate = useNavigate();
  const [details, setDetails] = useState({ ...INITIAL_DETAILS, studentName: user.fullName || '', email: user.email || '', mobile: user.mobile || '', altMobile: user.altMobile || '', college: user.college || '', degree: user.degree || '', department: user.department || '', graduationYear: user.graduationYear || '' });
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [redirectCountdown, setRedirectCountdown] = useState(5);
  const autoRedirectedRef = useRef(false);

  useEffect(() => {
    setDetails(current => ({
      ...current,
      studentName: current.studentName || user.fullName || '',
      email: current.email || user.email || '',
      mobile: current.mobile || user.mobile || '',
      altMobile: current.altMobile || user.altMobile || '',
      college: current.college || user.college || '',
      degree: current.degree || user.degree || '',
      department: current.department || user.department || '',
      graduationYear: current.graduationYear || user.graduationYear || '',
    }));
  }, [user]);

  const handleChange = event => setDetails(prev => ({ ...prev, [event.target.name]: event.target.value }));

  const requiredFields = ['studentName', 'email', 'mobile', 'college', 'department', 'courseName', 'projectName', 'expectedReturnDate', 'purpose'];
  const isFormValid = requiredFields.every(field => details[field]?.trim());

  useEffect(() => {
    if (step !== 3 || !submittedOrder?.orderId) return undefined;
    if (autoRedirectedRef.current) return undefined;

    setRedirectCountdown(5);
    const interval = setInterval(() => {
      setRedirectCountdown(current => {
        if (current <= 1) {
          clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    const timeout = setTimeout(() => {
      const whatsappLink = buildAdminWhatsAppLink(submittedOrder, user);
      autoRedirectedRef.current = true;

      const popup = window.open(whatsappLink, '_blank', 'noopener,noreferrer');
      if (!popup) {
        window.location.assign(whatsappLink);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [step, submittedOrder]);

  async function handleSubmit() {
    if (!isFormValid) {
      setError('Please fill all required fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (saveToProfile) {
        await updateProfile({
          fullName: details.studentName,
          email: details.email,
          mobile: details.mobile,
          altMobile: details.altMobile,
          college: details.college,
          graduationYear: details.graduationYear,
          degree: details.degree,
          department: details.department,
        });
      }

      const { data } = await axios.post('/api/orders', {
        items: cart.map(item => ({ id: item.id, name: item.name, qty: item.qty, unit: item.unit })),
        studentDetails: details,
      });
      setSubmittedOrder({
        orderId: data.orderId,
        details,
        items: cart.map(item => ({ id: item.id, name: item.name, qty: item.qty, unit: item.unit })),
      });
      autoRedirectedRef.current = false;
      setOrderId(data.orderId);
      clearCart();
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.message || 'Error placing order. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 3) {
    const whatsappLink = buildAdminWhatsAppLink(submittedOrder, user);
    return (
      <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
        <div style={{ ...styles.successCard, ...(isMobile ? styles.successCardMobile : {}) }}>
          <div style={styles.successIcon}>Done</div>
          <h2 style={styles.successTitle}>Request Submitted</h2>
          <p style={styles.successSub}>Your component request has been sent to the Comedkares Innovation Hub team.</p>
          <div style={styles.orderIdBox}>Order ID: <strong>{orderId}</strong></div>
          <p style={styles.successNote}>The lab administrator will review and approve your request shortly.</p>
          <p style={styles.redirectNote}>Opening WhatsApp for admin notification in {redirectCountdown} second{redirectCountdown === 1 ? '' : 's'}...</p>
          <div style={{ ...styles.successBtns, ...(isMobile ? styles.stackButtons : {}) }}>
            <a
              href={whatsappLink}
              target="_blank"
              rel="noreferrer"
              style={{ ...styles.whatsAppBtn, ...(isMobile ? styles.fullWidthBtn : {}) }}>
              Send WhatsApp to Admin
            </a>
            <button style={{ ...styles.primaryBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/my-orders')}>View My Orders</button>
            <button style={{ ...styles.secBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/dashboard')}>Back to Browse</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={{ ...styles.steps, ...(isMobile ? styles.stepsMobile : {}) }}>
          {['Cart Review', 'Project Details', 'Confirm'].map((label, index) => (
            <div key={label} style={{ ...styles.stepItem, ...(isMobile ? styles.stepItemMobile : {}) }}>
              <div style={{ ...styles.stepNum, ...(step > index + 1 ? styles.stepDone : step === index + 1 ? styles.stepActive : {}) }}>
                {step > index + 1 ? 'OK' : index + 1}
              </div>
              <span style={{ ...styles.stepLabel, color: step === index + 1 ? '#1a237e' : '#6b7280' }}>{label}</span>
              {index < 2 && (
                <div
                  style={{
                    ...styles.stepLine,
                    ...(isMobile ? styles.stepLineMobile : {}),
                    background: step > index + 1 ? '#1a237e' : '#e2e8f0',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div style={{ ...styles.layout, ...(isTablet ? styles.layoutStacked : {}) }}>
            <div style={styles.cartList}>
              <h2 style={styles.sectionTitle}>Cart Review</h2>
              {cart.length === 0 ? (
                <div style={styles.emptyCart}>
                  <div style={styles.emptyIcon}>Cart</div>
                  <h3>Your cart is empty</h3>
                  <button style={styles.primaryBtn} onClick={() => navigate('/dashboard')}>Browse Components</button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.id} style={{ ...styles.cartItem, ...(isMobile ? styles.cartItemMobile : {}) }}>
                    <div style={styles.cartItemIcon}>{item.category === 'Sensors' ? 'SNS' : 'CMP'}</div>
                    <div style={styles.cartItemInfo}>
                      <div style={styles.cartItemName}>{item.name}</div>
                      <div style={styles.cartItemMeta}>{item.category} · {item.unit}</div>
                    </div>
                    <div style={styles.qtyCtrl}>
                      <button style={styles.qtyBtn} onClick={() => updateQty(item.id, item.qty - 1)}>-</button>
                      <span style={styles.qtyVal}>{item.qty}</span>
                      <button style={styles.qtyBtn} onClick={() => updateQty(item.id, Math.min(item.qty + 1, item.stock))}>+</button>
                    </div>
                    <button style={styles.removeBtn} onClick={() => removeFromCart(item.id)}>Remove</button>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div style={{ ...styles.summary, ...(isTablet ? styles.summaryStatic : {}) }}>
                <h3 style={styles.summaryTitle}>Order Summary</h3>
                {cart.map(item => (
                  <div key={item.id} style={styles.summaryRow}>
                    <span>{item.name}</span>
                    <span style={{ fontWeight: 600 }}>x{item.qty}</span>
                  </div>
                ))}
                <div style={styles.summaryDivider} />
                <div style={styles.summaryTotal}>
                  <span>Total Items</span>
                  <span style={styles.totalNum}>{totalItems}</span>
                </div>
                <div style={styles.summaryNote}>Components are issued for project use only. No pricing is shown.</div>
                <button style={{ ...styles.primaryBtn, width: '100%' }} onClick={() => setStep(2)}>Continue to Details</button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ ...styles.formCard, ...(isMobile ? styles.formCardMobile : {}) }}>
            <h2 style={styles.sectionTitle}>Project and Student Details</h2>
            <p style={styles.formNote}>Please fill in your details accurately. This will be sent to the lab administrator.</p>
            {error && <div style={styles.errorBox}>{error}</div>}
            <div style={{ ...styles.formGrid, ...(isMobile ? styles.formGridSingle : {}) }}>
              <Field label="Student Name *" name="studentName" value={details.studentName} onChange={handleChange} placeholder="Your full name" />
              <Field label="Email *" name="email" value={details.email} onChange={handleChange} placeholder="name@college.edu" />
              <Field label="Mobile Number *" name="mobile" value={details.mobile} onChange={handleChange} placeholder="10-digit mobile" />
              <Field label="Alternative Mobile" name="altMobile" value={details.altMobile} onChange={handleChange} placeholder="Optional alternate mobile" />
              <Field label="USN / Roll No" name="usn" value={details.usn} onChange={handleChange} placeholder="e.g. 1XX21CS001" />
              <Field label="Semester" name="semester" value={details.semester} onChange={handleChange} placeholder="e.g. 5th Sem" />
              <Field label="College / Institution *" name="college" value={details.college} onChange={handleChange} placeholder="Institution name" fullWidth />
              <Field label="Degree" name="degree" value={details.degree} onChange={handleChange} placeholder="B.Tech / B.Sc / MBA" />
              <Field label="Department *" name="department" value={details.department} onChange={handleChange} placeholder="e.g. CSE, ECE, ME" />
              <Field label="Graduation Year" name="graduationYear" value={details.graduationYear} onChange={handleChange} placeholder="2026" />
              <Field label="Course Name *" name="courseName" value={details.courseName} onChange={handleChange} placeholder="e.g. IoT Lab, Mini Project" />
              <Field label="Project Name *" name="projectName" value={details.projectName} onChange={handleChange} placeholder="Your project title" fullWidth />
              <Field label="Team Name" name="teamName" value={details.teamName} onChange={handleChange} placeholder="e.g. Team Alpha" />
              <Field label="Faculty Guide" name="facultyGuide" value={details.facultyGuide} onChange={handleChange} placeholder="Guiding faculty name" />
              <Field label="Expected Date of Return *" name="expectedReturnDate" value={details.expectedReturnDate} onChange={handleChange} type="date" min={new Date().toISOString().slice(0, 10)} />
              <Field label="Purpose / Reason *" name="purpose" value={details.purpose} onChange={handleChange} placeholder="Briefly describe why you need these components..." textarea fullWidth />
            </div>

            <label style={styles.profileSaveRow}>
              <input
                type="checkbox"
                checked={saveToProfile}
                onChange={event => setSaveToProfile(event.target.checked)}
              />
              <span>Save these contact and academic details to my profile for next time</span>
            </label>

            <div style={styles.cartReviewMini}>
              <strong>Components Requested:</strong>
              <div style={styles.cartChips}>
                {cart.map(item => <span key={item.id} style={styles.chip}>{item.name} x{item.qty}</span>)}
              </div>
            </div>

            <div style={{ ...styles.formActions, ...(isMobile ? styles.stackButtons : {}) }}>
              <button style={{ ...styles.secBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => setStep(1)}>Back to Cart</button>
              <button
                style={{ ...styles.primaryBtn, ...(isMobile ? styles.fullWidthBtn : {}), opacity: loading ? 0.7 : 1 }}
                onClick={handleSubmit}
                disabled={loading || !isFormValid}>
                {loading ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildAdminWhatsAppLink(order, user) {
  // Get center-specific admin number, fallback to default
  const adminNumber = ADMIN_WHATSAPP_NUMBERS[user?.centerId] || DEFAULT_ADMIN_WHATSAPP_NUMBER;

  if (!order?.orderId) {
    return `https://wa.me/${adminNumber}`;
  }

  const details = order.details || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.length
    ? items.map(item => `- ${item.name} x${item.qty}`).join('\n')
    : '- No items listed';

  const message = [
    'Hello Admin,',
    `${details.studentName || 'Student'} this side`,
    '',
    'I have placed a new CIMS order.',
    '',
    `Order ID: ${order.orderId}`,
    `Student: ${details.studentName || '-'}`,
    `Project: ${details.projectName || '-'}`,
    'Items:',
    itemLines,
    '',
    'Login to check:',
    ADMIN_LOGIN_URL,
  ].join('\n');

  return `https://wa.me/${adminNumber}?text=${encodeURIComponent(message)}`;
}

function Field({ label, name, value, onChange, placeholder, textarea, fullWidth, type = 'text', min }) {
  const base = {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: "'DM Sans', sans-serif",
    color: '#1a1a2e',
    outline: 'none',
    resize: textarea ? 'vertical' : undefined,
    minHeight: textarea ? '80px' : undefined,
  };

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>{label}</label>
      {textarea
        ? <textarea style={base} name={name} value={value} onChange={onChange} placeholder={placeholder} />
        : <input style={base} type={type} name={name} value={value} onChange={onChange} placeholder={placeholder} min={min} />}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1100px', margin: '0 auto' },
  steps: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '32px', gap: '0' },
  stepsMobile: { justifyContent: 'flex-start', overflowX: 'auto', paddingBottom: '8px' },
  stepItem: { display: 'flex', alignItems: 'center', gap: '8px' },
  stepItemMobile: { flexShrink: 0 },
  stepNum: { width: '32px', height: '32px', borderRadius: '50%', background: '#e2e8f0', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700' },
  stepActive: { background: '#1a237e', color: '#fff' },
  stepDone: { background: '#2e7d32', color: '#fff' },
  stepLabel: { fontSize: '13px', fontWeight: '500' },
  stepLine: { width: '60px', height: '2px', margin: '0 8px' },
  stepLineMobile: { width: '34px' },
  layout: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' },
  layoutStacked: { gridTemplateColumns: '1fr' },
  sectionTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: '700', color: '#1a1a2e', marginBottom: '20px' },
  cartList: { background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  cartItem: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: '1px solid #f0f2f8' },
  cartItemMobile: { flexWrap: 'wrap' },
  cartItemIcon: { width: '44px', height: '44px', background: '#e8eaf6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '800', color: '#1a237e', flexShrink: 0 },
  cartItemInfo: { flex: 1, minWidth: '180px' },
  cartItemName: { fontWeight: '600', fontSize: '14px', color: '#1a1a2e' },
  cartItemMeta: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  qtyCtrl: { display: 'flex', alignItems: 'center', gap: '8px', background: '#f0f2f8', borderRadius: '8px', padding: '4px 8px' },
  qtyBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', fontWeight: '700', color: '#1a237e', padding: '0 4px' },
  qtyVal: { fontSize: '14px', fontWeight: '700', color: '#1a1a2e', minWidth: '20px', textAlign: 'center' },
  removeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: '#c62828' },
  summary: { background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)', position: 'sticky', top: '80px' },
  summaryStatic: { position: 'static', top: 'auto' },
  summaryTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: '700', color: '#1a1a2e', marginBottom: '16px' },
  summaryRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6b7280', padding: '4px 0', gap: '10px' },
  summaryDivider: { borderTop: '1px solid #e2e8f0', margin: '12px 0' },
  summaryTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  totalNum: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: '800', color: '#1a237e' },
  summaryNote: { fontSize: '11px', color: '#6b7280', background: '#fff9c4', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px', lineHeight: '1.5' },
  emptyCart: { textAlign: 'center', padding: '60px 20px', color: '#6b7280' },
  emptyIcon: { fontSize: '20px', fontWeight: '800', color: '#1a237e', marginBottom: '16px' },
  formCard: { background: '#fff', borderRadius: '16px', padding: '32px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  formCardMobile: { padding: '24px 18px' },
  formNote: { color: '#6b7280', fontSize: '14px', marginBottom: '24px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' },
  formGridSingle: { gridTemplateColumns: '1fr' },
  errorBox: { background: '#fce4ec', border: '1px solid #f48fb1', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
  cartReviewMini: { background: '#f0f2f8', borderRadius: '10px', padding: '14px 16px', marginBottom: '24px', fontSize: '13px', color: '#374151' },
  profileSaveRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', color: '#374151', fontSize: '13px', fontWeight: '600' },
  cartChips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' },
  chip: { background: '#e8eaf6', color: '#1a237e', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' },
  formActions: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  stackButtons: { flexDirection: 'column' },
  fullWidthBtn: { width: '100%' },
  primaryBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' },
  secBtn: { background: '#f0f2f8', color: '#374151', border: 'none', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' },
  whatsAppBtn: { background: 'linear-gradient(135deg, #1fa855, #128c47)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  successCard: { maxWidth: '520px', margin: '80px auto', background: '#fff', borderRadius: '24px', padding: '48px', textAlign: 'center', boxShadow: '0 8px 40px rgba(26,35,126,0.12)' },
  successCardMobile: { margin: '24px auto', padding: '30px 20px' },
  successIcon: { fontSize: '22px', fontWeight: '800', color: '#2e7d32', marginBottom: '16px' },
  successTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '26px', fontWeight: '800', color: '#1a1a2e', marginBottom: '8px' },
  successSub: { color: '#6b7280', fontSize: '15px', marginBottom: '20px' },
  orderIdBox: { background: '#e8eaf6', color: '#1a237e', padding: '12px 20px', borderRadius: '10px', fontSize: '14px', marginBottom: '16px', display: 'inline-block' },
  successNote: { color: '#6b7280', fontSize: '13px', marginBottom: '28px', lineHeight: '1.6' },
  redirectNote: { color: '#1f2937', fontSize: '13px', marginBottom: '18px', fontWeight: '600' },
  successBtns: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' },
};
