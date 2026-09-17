import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { APP_LONG_NAME, APP_SHORT_NAME, APP_SUBTITLE } from '../brand';
import { useCenters } from '../context/CentersContext';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import { formatInr } from '../utils/currency';

// Append one line here as each V2.1 phase ships, so the notice on the
// dashboard always reflects what's actually live, not what's planned.
// Colours cycle through this list, one per business head, in list order.
const BH_PALETTE = [
  { tone: '#2e7d32', bg: '#e8f5e9' },
  { tone: '#1565c0', bg: '#e3f2fd' },
  { tone: '#6a1b9a', bg: '#f3e5f5' },
  { tone: '#ef6c00', bg: '#fff3e0' },
];

export default function AdminDashboard() {
  const { centers } = useCenters();
  const { isMobile } = useViewport();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [assetValues, setAssetValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [centerId, setCenterId] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    setCenterId(isSuperAdmin ? '' : (user?.centerId || ''));
  }, [isSuperAdmin, user]);

  useEffect(() => {
    fetchData();
    fetchAssetValues();
    // Everything on this page refreshes on a short interval so it stays
    // live even if the admin leaves this tab open (e.g. while an order gets
    // approved or units get damaged/repaired from another tab/device).
    const statsTimer = setInterval(fetchData, 20000);
    const valuesTimer = setInterval(fetchAssetValues, 15000);
    return () => {
      clearInterval(statsTimer);
      clearInterval(valuesTimer);
    };
  }, [centerId, classificationFilter]);

  const [ordersDateFrom, setOrdersDateFrom] = useState('');
  const [ordersDateTo, setOrdersDateTo] = useState('');

  async function fetchData() {
    try {
      const orderParams = centerId ? { centerId } : {};
      const statsParams = { ...orderParams, ...(classificationFilter ? { classificationId: classificationFilter } : {}) };
      const [statsRes, ordersRes] = await Promise.all([
        axios.get('/api/admin/stats', { params: statsParams }),
        axios.get('/api/orders', { params: orderParams }),
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

  async function fetchAssetValues() {
    try {
      const params = centerId ? { centerId } : {};
      const { data } = await axios.get('/api/assets/value-summary', { params });
      setAssetValues(data);
    } catch {
      setAssetValues(null);
    }
  }

  function downloadFile(type, extraParams = {}) {
    const token = localStorage.getItem('cims_token');
    const link = document.createElement('a');

    let query = '';
    const params = new URLSearchParams();
    if (centerId) params.set('centerId', centerId);
    if (type === 'orders' && (ordersDateFrom || ordersDateTo)) {
      if (ordersDateFrom) params.set('startDate', ordersDateFrom);
      if (ordersDateTo) params.set('endDate', ordersDateTo);
    }
    Object.entries(extraParams).forEach(([key, value]) => params.set(key, value));
    query = params.toString() ? `?${params.toString()}` : '';

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
        const suffix = extraParams.businessHead ? `_${extraParams.businessHead}` : '';
        link.download = `${APP_SHORT_NAME}_${type}${suffix}${dateRange}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  if (loading) {
    return <div style={styles.loading}>Loading dashboard...</div>;
  }

  const statCards = [
    { label: 'Total Line Items', value: stats?.totalComponents || 0, tone: '#17355f', bg: '#e8eef8' },
    { label: 'Total Stock Units', value: stats?.totalStock || 0, tone: '#2e7d32', bg: '#e8f5e9' },
    { label: 'Low Stock Alerts', value: stats?.lowStock || 0, tone: '#ef6c00', bg: '#fff3e0' },
    { label: 'Pending Orders', value: stats?.pendingOrders || 0, tone: '#f57f17', bg: '#fff9c4' },
    { label: 'Approved Orders', value: stats?.approvedOrders || 0, tone: '#1565c0', bg: '#e3f2fd' },
    { label: 'Pending Students', value: stats?.pendingStudents || 0, tone: '#8e24aa', bg: '#f3e5f5' },
    { label: 'Total Students', value: stats?.totalStudents || 0, tone: '#1a237e', bg: '#e8eaf6' },
  ];

  const classifications = assetValues?.byClassification || [];
  // "All" (no filter) uses the combined totals already at the top level of
  // the response; picking a classification scopes the same 4 metrics to
  // just that row -- an independent breakdown, not crossed with business head.
  const selectedClassRow = classificationFilter
    ? classifications.find(c => String(c.classificationId) === classificationFilter)
    : assetValues;
  const assetValueCards = [
    { label: 'Available Asset Value', value: selectedClassRow?.available_value, tone: '#2e7d32', bg: '#e8f5e9' },
    { label: 'Damaged/Consumed Asset Value', value: selectedClassRow?.damaged_value, tone: '#c62828', bg: '#fce4ec' },
    { label: 'Total Asset Value', value: selectedClassRow?.total_value, tone: '#1a237e', bg: '#e8eaf6' },
    { label: 'Total Asset Value + GST', value: selectedClassRow?.total_value_with_gst, tone: '#5b21b6', bg: '#ede9fe' },
  ];

  // One column per business head the backend reports (it returns every
  // real head, even at zero). They used to be two hardcoded Comedkare
  // names; heads are now managed by a super admin in Settings, so the
  // columns and their colours are derived from whatever exists.
  const businessHeads = assetValues?.byBusinessHead || [];
  const businessHeadColumns = businessHeads
    .filter(b => b.businessHeadName !== 'Unspecified')
    .map((b, index) => {
      const palette = BH_PALETTE[index % BH_PALETTE.length];
      return { key: String(b.businessHeadId), name: b.businessHeadName, tone: palette.tone, bg: palette.bg, data: b };
    });
  const unspecifiedHead = businessHeads.find(b => b.businessHeadName === 'Unspecified');
  const businessHeadNames = businessHeadColumns.map(col => col.name).join(' + ') || 'business head';

  // Carries the selected classification into Inventory as a name (Inventory
  // filters by classification_name client-side, not by id), so picking a
  // class here and opening Inventory lands already filtered to it.
  const selectedClassName = classificationFilter
    ? classifications.find(c => String(c.classificationId) === classificationFilter)?.classificationName || ''
    : '';
  const inventoryPath = selectedClassName ? `/admin/inventory?classification=${encodeURIComponent(selectedClassName)}` : '/admin/inventory';

  const quickLinks = [
    { title: 'Inventory', description: 'Add components, manage stock, and upload component photos.', path: inventoryPath, color: '#17355f' },
    { title: 'Orders', description: 'Approve requests, confirm returns, and monitor issue status.', path: '/admin/orders', color: '#ef6c00' },
    { title: 'Users', description: 'Approve student registrations, edit users, and maintain access.', path: '/admin/users', color: '#8e24aa' },
    ...(isSuperAdmin ? [{ title: 'Analytics', description: 'View system-wide statistics and charts.', path: '/admin/analytics', color: '#1a237e' }] : []),
  ];

  const downloads = [
    { type: 'inventory', label: 'Inventory Report', note: 'Components, stock, photos, and locations' },
    { type: 'orders', label: 'Orders Report', note: 'Requests, issue status, and returns' },
    { type: 'transfers', label: 'Center Transfer Report', note: 'Requested + sent center-to-center movement details' },
    { type: 'internal-issues', label: 'Internal Use Report', note: 'Session components, asset tags, and returns' },
    { type: 'users', label: 'Users Report', note: 'Manual users and self-registered students' },
    { type: 'logs', label: 'Activity Logs', note: 'System activity and audit trail' },
  ];

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
            <div>
              <div style={styles.kicker}>{APP_SUBTITLE}</div>
              <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>Center Dashboard</h1>
              <p style={styles.subtitle}>{isSuperAdmin && centerId ? `${APP_LONG_NAME} - ${centers.find(center => center.id === centerId)?.name || ''}` : APP_LONG_NAME}</p>
            </div>
          <div style={{ ...styles.heroActions, ...(isMobile ? styles.heroActionsStack : {}) }}>
            <button style={{ ...styles.primaryAction, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/admin/users')}>Review Registrations</button>
            <button style={{ ...styles.secondaryAction, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate(inventoryPath)}>Manage Inventory</button>
          </div>
        </div>

        <div style={styles.superBar}>
          <div style={styles.filterBarRow}>
            {isSuperAdmin && (
              <label style={styles.superLabel}>
                View center
                <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.superSelect}>
                  <option value="">All Centers</option>
                  {centers.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
              </label>
            )}
            <label style={styles.superLabel}>
              View classification
              <select value={classificationFilter} onChange={event => setClassificationFilter(event.target.value)} style={styles.superSelect}>
                <option value="">All Classifications (combined)</option>
                {classifications.map(cls => (
                  <option key={cls.classificationId} value={String(cls.classificationId)}>{cls.classificationName}</option>
                ))}
              </select>
            </label>
          </div>
          {classificationFilter && (
            <p style={styles.filterNote}>
              Line Items, Stock Units, Low Stock Alerts, and Asset Values below are scoped to "{selectedClassName}".
              Opening Inventory carries this over too. Orders and student counts stay center-wide (an order can span multiple classifications).
            </p>
          )}
        </div>

        <div style={styles.liveRow}>
          <span style={styles.liveBadge}>&#9679; LIVE</span>
          <span style={styles.liveLabel}>
            Inventory, orders, and student counts {isSuperAdmin && !centerId ? 'across all centers' : ''} · refreshes automatically
          </span>
        </div>
        <div style={styles.statsGrid}>
          {statCards.map(card => (
            <div key={card.label} style={styles.statCard}>
              <div style={{ ...styles.statAccent, background: card.bg, color: card.tone }}>{card.label}</div>
              <div style={{ ...styles.statValue, color: card.tone }}>{card.value}</div>
            </div>
          ))}
        </div>

        <div style={styles.liveRow}>
          <span style={styles.liveBadge}>&#9679; LIVE</span>
          <span style={styles.liveLabel}>
            Asset values {isSuperAdmin && !centerId ? 'across all centers' : ''} · refreshes automatically
          </span>
        </div>
        <div style={styles.statsGrid}>
          {assetValueCards.map(card => (
            <div key={card.label} style={styles.statCard}>
              <div style={{ ...styles.statAccent, background: card.bg, color: card.tone }}>{card.label}</div>
              <div style={{ ...styles.statValue, color: card.tone }}>
                {assetValues ? formatInr(card.value) : '...'}
              </div>
            </div>
          ))}
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Asset Value by Business Head</h2>
              <p style={styles.sectionText}>{businessHeadNames}, split out from the combined total above.</p>
            </div>
          </div>
          <div style={{ ...styles.bhGrid, ...(isMobile ? styles.bhGridMobile : {}) }}>
            {businessHeadColumns.map(col => (
              <div key={col.key} style={styles.bhColumn}>
                <div style={{ ...styles.bhHeader, background: col.bg, color: col.tone }}>{col.name}</div>
                <div style={styles.bhBody}>
                  <div style={styles.bhRow}><span>Available Value</span><strong>{assetValues ? formatInr(col.data?.available_value) : '...'}</strong></div>
                  <div style={styles.bhRow}><span style={{ color: '#c62828' }}>Damaged/Consumed Value</span><strong style={{ color: '#c62828' }}>{assetValues ? formatInr(col.data?.damaged_value) : '...'}</strong></div>
                  <div style={styles.bhRow}><span>Total Value</span><strong>{assetValues ? formatInr(col.data?.total_value) : '...'}</strong></div>
                  <div style={{ ...styles.bhRow, ...styles.bhRowTotal, color: col.tone }}><span>Total Value + GST</span><strong>{assetValues ? formatInr(col.data?.total_value_with_gst) : '...'}</strong></div>
                </div>
                <button style={{ ...styles.bhDownloadBtn, borderColor: col.tone, color: col.tone }} onClick={() => downloadFile('assets', { businessHead: col.key })}>
                  Download {col.name} asset details
                </button>
              </div>
            ))}
          </div>

          {unspecifiedHead && (
            <div style={styles.bhUnspecifiedNote}>
              Note: {formatInr(unspecifiedHead.total_value)} of asset value has no business head recorded on its invoice yet (not shown in any column above).
            </div>
          )}

          <div style={styles.bhCombinedRow}>
            <div>
              <div style={styles.bhCombinedLabel}>Total center{isSuperAdmin && !centerId ? 's' : ''} asset value ({businessHeadNames} combined)</div>
              <div style={styles.bhCombinedValue}>{assetValues ? formatInr(assetValues.total_value) : '...'} <span style={styles.bhCombinedGst}>({assetValues ? formatInr(assetValues.total_value_with_gst) : '...'} incl. GST)</span></div>
            </div>
            <button style={styles.bhDownloadBtnCombined} onClick={() => downloadFile('assets', { businessHead: 'all' })}>
              Download combined asset details
            </button>
          </div>
        </div>

        {isSuperAdmin && !centerId && Array.isArray(stats?.byCenter) && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Center Overview</h2>
                <p style={styles.sectionText}>Live activity across {centers.length === 1 ? "the center" : `all ${centers.length} centers`}.</p>
              </div>
            </div>
            <div style={styles.tableWrap}>
              <div style={styles.tableScroller}>
                <div style={styles.tableHead}>
                  <span>Center</span>
                  <span>Line Items</span>
                  <span>Stock</span>
                  <span>Pending Orders</span>
                  <span>Approved Orders</span>
                  <span>Students</span>
                </div>
                {stats.byCenter.map(center => (
                  <div key={center.centerId} style={styles.tableRow}>
                    <span style={styles.orderId}>{center.centerName}</span>
                    <span>{center.totalComponents}</span>
                    <span>{center.totalStock}</span>
                    <span>{center.pendingOrders}</span>
                    <span>{center.approvedOrders}</span>
                    <span>{center.students}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
  liveRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' },
  liveBadge: { color: '#2e7d32', fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em' },
  liveLabel: { fontSize: '12px', color: '#64748b' },
  statCard: { background: '#fff', borderRadius: '16px', padding: '18px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  statAccent: { display: 'inline-flex', padding: '5px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, marginBottom: '14px' },
  statValue: { fontFamily: "'DM Sans', sans-serif", fontSize: '30px', fontWeight: 800, lineHeight: 1 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' },
  quickCard: { background: '#fff', border: 'none', borderRadius: '18px', padding: '22px', textAlign: 'left', cursor: 'pointer', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  quickTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '19px', fontWeight: 800, marginBottom: '8px' },
  quickDescription: { fontSize: '13px', color: '#64748b', lineHeight: 1.6, marginBottom: '14px' },
  quickCta: { fontSize: '13px', fontWeight: 700 },
  section: { background: '#fff', borderRadius: '18px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  bhGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px', marginBottom: '18px' },
  bhGridMobile: { gridTemplateColumns: '1fr' },
  bhColumn: { border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  bhHeader: { padding: '14px 18px', fontFamily: "'DM Sans', sans-serif", fontSize: '17px', fontWeight: 800 },
  bhBody: { padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' },
  bhRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#334155' },
  bhRowTotal: { borderTop: '1px dashed #e2e8f0', paddingTop: '10px', marginTop: '2px', fontSize: '14px', fontWeight: 700 },
  bhDownloadBtn: { margin: '0 18px 16px', background: '#fff', border: '1.5px solid', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
  bhUnspecifiedNote: { fontSize: '12px', color: '#92400e', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px' },
  bhCombinedRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', background: '#eef2ff', borderRadius: '14px', padding: '16px 20px' },
  bhCombinedLabel: { fontSize: '12px', color: '#4338ca', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' },
  bhCombinedValue: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a237e' },
  bhCombinedGst: { fontSize: '13px', fontWeight: 600, color: '#5b21b6' },
  bhDownloadBtnCombined: { background: '#1a237e', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  superBar: { background: '#fff', borderRadius: '16px', padding: '16px 18px', marginBottom: '18px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  filterBarRow: { display: 'flex', gap: '20px', flexWrap: 'wrap' },
  superLabel: { display: 'inline-flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: '#334155', fontWeight: 700 },
  superSelect: { minWidth: '260px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' },
  filterNote: { marginTop: '12px', fontSize: '12px', color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 12px', lineHeight: 1.5 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '18px', flexWrap: 'wrap' },
  sectionTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 800, color: '#1a1a2e' },
  sectionText: { fontSize: '13px', color: '#64748b', marginTop: '6px' },
  downloadFilters: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' },
  filterLabel: { display: 'inline-flex', flexDirection: 'column', fontSize: '12px', color: '#334155' },
  filterInput: { marginTop: '6px', padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '13px' },
  secondaryActionSmall: { background: '#e2e8f0', color: '#1e3a8a', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  downloadGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  // Darkened from the original #3b82f6->#1d4ed8 gradient -- the lighter end
  // gave the subtitle text (originally #64748b, ~1.3:1 contrast) nowhere
  // near enough contrast to read even after switching it to white.
  downloadCard: { background: 'linear-gradient(135deg, #1d4ed8 0%, #1a3fc4 100%)', border: 'none', borderRadius: '14px', padding: '16px', textAlign: 'left', cursor: 'pointer', color: '#fff', boxShadow: '0 8px 20px rgba(30, 64, 175, 0.25)', display: 'flex', flexDirection: 'column', gap: '6px' },
  downloadTitle: { fontSize: '14px', fontWeight: 800, color: '#fff', lineHeight: 1.3 },
  downloadNote: { fontSize: '12px', color: 'rgba(255,255,255,0.88)', lineHeight: 1.5 },
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
