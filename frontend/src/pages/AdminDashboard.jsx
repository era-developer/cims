import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { APP_LONG_NAME, APP_SHORT_NAME, APP_SUBTITLE } from '../brand';
import useViewport from '../hooks/useViewport';

export default function AdminDashboard() {
  const { isMobile } = useViewport();
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const [ordersDateFrom, setOrdersDateFrom] = useState('');
  const [ordersDateTo, setOrdersDateTo] = useState('');

  async function fetchData() {
    try {
      const [statsRes, ordersRes] = await Promise.all([
        axios.get('/api/admin/stats'),
        axios.get('/api/orders'),
      ]);
      setStats(statsRes.data);
      setRecentOrders(ordersRes.data.slice(-5).reverse());
    } catch {
      setStats(null);
      setRecentOrders([]);
    } finally {
      setLoading(false);
    }
  }

  function downloadFile(type) {
    const token = localStorage.getItem('cims_token');
    const link = document.createElement('a');

    let query = '';
    if (type === 'orders' && (ordersDateFrom || ordersDateTo)) {
      const params = new URLSearchParams();
      if (ordersDateFrom) params.set('startDate', ordersDateFrom);
      if (ordersDateTo) params.set('endDate', ordersDateTo);
      query = `?${params.toString()}`;
    }

    link.href = `/api/admin/download/${type}${query}`;
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    fetch(link.href, { headers })
      .then(response => response.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        link.href = url;
        const dateRange = type === 'orders' && (ordersDateFrom || ordersDateTo)
          ? `_from-${ordersDateFrom || 'start'}_to-${ordersDateTo || 'now'}`
          : '';
        link.download = `${APP_SHORT_NAME}_${type}${dateRange}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  if (loading) {
    return <div style={styles.loading}>Loading dashboard...</div>;
  }

  const statCards = [
    { label: 'Total Components', value: stats?.totalComponents || 0, tone: '#17355f', bg: '#e8eef8' },
    { label: 'Total Stock Units', value: stats?.totalStock || 0, tone: '#2e7d32', bg: '#e8f5e9' },
    { label: 'Low Stock Alerts', value: stats?.lowStock || 0, tone: '#ef6c00', bg: '#fff3e0' },
    { label: 'Pending Orders', value: stats?.pendingOrders || 0, tone: '#f57f17', bg: '#fff9c4' },
    { label: 'Approved Orders', value: stats?.approvedOrders || 0, tone: '#1565c0', bg: '#e3f2fd' },
    { label: 'Pending Students', value: stats?.pendingStudents || 0, tone: '#8e24aa', bg: '#f3e5f5' },
    { label: 'Total Students', value: stats?.totalStudents || 0, tone: '#1a237e', bg: '#e8eaf6' },
  ];

  const quickLinks = [
    { title: 'Inventory', description: 'Add components, manage stock, and upload component photos.', path: '/admin/inventory', color: '#17355f' },
    { title: 'Orders', description: 'Approve requests, confirm returns, and monitor issue status.', path: '/admin/orders', color: '#ef6c00' },
    { title: 'Users', description: 'Approve student registrations, edit users, and maintain access.', path: '/admin/users', color: '#8e24aa' },
  ];

  const downloads = [
    { type: 'inventory', label: 'Inventory Report', note: 'Components, stock, photos, and locations' },
    { type: 'orders', label: 'Orders Report', note: 'Requests, issue status, and returns' },
    { type: 'users', label: 'Users Report', note: 'Manual users and self-registered students' },
    { type: 'logs', label: 'Activity Logs', note: 'System activity and audit trail' },
  ];

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
          <div>
            <div style={styles.kicker}>{APP_SUBTITLE}</div>
            <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>Admin Dashboard</h1>
            <p style={styles.subtitle}>{APP_LONG_NAME}</p>
          </div>
          <div style={{ ...styles.heroActions, ...(isMobile ? styles.heroActionsStack : {}) }}>
            <button style={{ ...styles.primaryAction, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/admin/users')}>Review Registrations</button>
            <button style={{ ...styles.secondaryAction, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/admin/inventory')}>Manage Inventory</button>
          </div>
        </div>

        <div style={styles.statsGrid}>
          {statCards.map(card => (
            <div key={card.label} style={styles.statCard}>
              <div style={{ ...styles.statAccent, background: card.bg, color: card.tone }}>{card.label}</div>
              <div style={{ ...styles.statValue, color: card.tone }}>{card.value}</div>
            </div>
          ))}
        </div>

        <div style={styles.quickGrid}>
          {quickLinks.map(link => (
            <button key={link.path} style={styles.quickCard} onClick={() => navigate(link.path)}>
              <div style={{ ...styles.quickTitle, color: link.color }}>{link.title}</div>
              <div style={styles.quickDescription}>{link.description}</div>
              <div style={{ ...styles.quickCta, color: link.color }}>Open</div>
            </button>
          ))}
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Excel Downloads</h2>
              <p style={styles.sectionText}>Download the latest reports from {APP_SHORT_NAME} in one click.</p>
            </div>
          </div>
          <div style={styles.downloadFilters}>
            <label style={styles.filterLabel}>
              From:
              <input
                type="date"
                value={ordersDateFrom}
                onChange={e => setOrdersDateFrom(e.target.value)}
                style={styles.filterInput}
              />
            </label>
            <label style={styles.filterLabel}>
              To:
              <input
                type="date"
                value={ordersDateTo}
                onChange={e => setOrdersDateTo(e.target.value)}
                style={styles.filterInput}
              />
            </label>
            <button style={styles.secondaryActionSmall} onClick={() => { setOrdersDateFrom(''); setOrdersDateTo(''); }}>
              Clear Date Range
            </button>
          </div>
          <div style={styles.downloadGrid}>
            {downloads.map(item => (
              <button key={item.type} style={styles.downloadCard} onClick={() => downloadFile(item.type)}>
                <div style={styles.downloadTitle}>{item.label}</div>
                <div style={styles.downloadNote}>{item.note}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Recent Requests</h2>
              <p style={styles.sectionText}>Latest student requests and their current processing stage.</p>
            </div>
            <button style={styles.viewAllBtn} onClick={() => navigate('/admin/orders')}>View All Orders</button>
          </div>

          <div style={styles.tableWrap}>
            <div style={styles.tableScroller}>
              <div style={styles.tableHead}>
                <span>Order ID</span>
                <span>Student</span>
                <span>College</span>
                <span>Components</span>
                <span>Date</span>
                <span>Status</span>
              </div>
              {recentOrders.length === 0 ? (
                <div style={styles.emptyTable}>No orders available yet.</div>
              ) : (
                recentOrders.map(order => (
                  <div key={order.orderId} style={styles.tableRow}>
                    <span style={styles.orderId}>{order.orderId}</span>
                    <span>{order.studentName}</span>
                    <span style={styles.mutedCell}>{order.college || '-'}</span>
                    <span style={styles.mutedCell}>{order.totalItems} item(s)</span>
                    <span style={styles.mutedCell}>
                      {order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : '-'}
                    </span>
                    <span style={{ ...styles.statusBadge, ...statusStyle(order.status) }}>{order.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusStyle(status) {
  const map = {
    Pending: { background: '#fff9c4', color: '#ef6c00' },
    Approved: { background: '#e8f5e9', color: '#2e7d32' },
    Rejected: { background: '#fce4ec', color: '#c62828' },
    'Return Requested': { background: '#fff3e0', color: '#ef6c00' },
    Returned: { background: '#e3f2fd', color: '#1565c0' },
  };
  return map[status] || map.Pending;
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1280px', margin: '0 auto' },
  loading: { padding: '80px', textAlign: 'center', color: '#6b7280' },
  hero: { background: 'linear-gradient(135deg, #102548 0%, #17355f 55%, #234d81 100%)', color: '#fff', borderRadius: '24px', padding: '28px 30px', display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '24px' },
  heroMobile: { padding: '24px 18px' },
  kicker: { fontSize: '12px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', fontWeight: 700, marginBottom: '10px' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '32px', fontWeight: 800, marginBottom: '8px' },
  titleMobile: { fontSize: '28px' },
  subtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.78)', maxWidth: '680px', lineHeight: 1.6 },
  heroActions: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  heroActionsStack: { width: '100%', flexDirection: 'column' },
  fullWidthBtn: { width: '100%' },
  primaryAction: { background: '#f9a825', color: '#102548', border: 'none', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' },
  secondaryAction: { background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', color: '#17355f', border: '1px solid rgba(147,197,253,0.85)', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 24px rgba(59,130,246,0.20)' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' },
  statCard: { background: '#fff', borderRadius: '16px', padding: '18px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  statAccent: { display: 'inline-flex', padding: '5px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, marginBottom: '14px' },
  statValue: { fontFamily: "'DM Sans', sans-serif", fontSize: '30px', fontWeight: 800, lineHeight: 1 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' },
  quickCard: { background: '#fff', border: 'none', borderRadius: '18px', padding: '22px', textAlign: 'left', cursor: 'pointer', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  quickTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '19px', fontWeight: 800, marginBottom: '8px' },
  quickDescription: { fontSize: '13px', color: '#64748b', lineHeight: 1.6, marginBottom: '14px' },
  quickCta: { fontSize: '13px', fontWeight: 700 },
  section: { background: '#fff', borderRadius: '18px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '18px', flexWrap: 'wrap' },
  sectionTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 800, color: '#1a1a2e' },
  sectionText: { fontSize: '13px', color: '#64748b', marginTop: '6px' },
  downloadFilters: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' },
  filterLabel: { display: 'inline-flex', flexDirection: 'column', fontSize: '12px', color: '#334155' },
  filterInput: { marginTop: '6px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '13px' },
  secondaryActionSmall: { background: '#e2e8f0', color: '#1e3a8a', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  downloadGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  downloadCard: { background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', border: 'none', borderRadius: '14px', padding: '16px', textAlign: 'left', cursor: 'pointer', color: '#fff', boxShadow: '0 8px 20px rgba(30, 64, 175, 0.25)' },
  downloadTitle: { fontSize: '14px', fontWeight: 800, color: '#fff', marginBottom: '6px' },
  downloadNote: { fontSize: '12px', color: '#64748b', lineHeight: 1.5 },
  viewAllBtn: { background: '#eef2ff', border: '1px solid #c7d2fe', color: '#1e3a8a', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  tableWrap: { border: '1px solid #e2e8f0', borderRadius: '14px', overflowX: 'auto', overflowY: 'hidden' },
  tableScroller: { minWidth: '760px' },
  tableHead: { display: 'grid', gridTemplateColumns: '160px 1fr 1.2fr 120px 100px 120px', gap: '12px', padding: '12px 16px', background: '#17355f', color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  tableRow: { display: 'grid', gridTemplateColumns: '160px 1fr 1.2fr 120px 100px 120px', gap: '12px', padding: '14px 16px', borderBottom: '1px solid #eef2f7', alignItems: 'center', fontSize: '13px', color: '#334155' },
  orderId: { fontFamily: "'DM Sans', sans-serif", fontWeight: 800, color: '#17355f', fontSize: '12px' },
  mutedCell: { color: '#64748b', fontSize: '12px' },
  statusBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '5px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  emptyTable: { padding: '34px', textAlign: 'center', color: '#64748b', background: '#fff' },
};
