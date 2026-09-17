import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import useViewport from '../hooks/useViewport';

const STATUS_STYLES = {
  Pending: { bg: '#fff9c4', color: '#f57f17', label: 'Pending' },
  Approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Approved' },
  Rejected: { bg: '#fce4ec', color: '#c62828', label: 'Rejected' },
  'Return Requested': { bg: '#fff3e0', color: '#ef6c00', label: 'Return Requested' },
  'Partially Returned': { bg: '#e8f0fe', color: '#1d4ed8', label: 'Partially Returned' },
  Returned: { bg: '#e3f2fd', color: '#1565c0', label: 'Returned' },
};

const RETURN_FLOW_STATUSES = new Set(['Return Requested', 'Partially Returned', 'Returned']);

// Status filter chips. Keys travel in the URL (?status=active) so the
// dashboard tiles can deep-link straight to a slice.
const STATUS_FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'active', label: 'Active', match: o => !['Returned', 'Rejected'].includes(o.status) },
  { key: 'pending', label: 'Pending', match: o => o.status === 'Pending' },
  { key: 'approved', label: 'Approved / to return', match: o => o.status === 'Approved' },
  { key: 'return-requested', label: 'Return requested', match: o => o.status === 'Return Requested' },
  { key: 'partial', label: 'Partially returned', match: o => o.status === 'Partially Returned' },
  { key: 'returned', label: 'Returned', match: o => o.status === 'Returned' },
  { key: 'rejected', label: 'Rejected', match: o => o.status === 'Rejected' },
];

export default function MyOrders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useViewport();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [processingId, setProcessingId] = useState('');
  const [pageMsg, setPageMsg] = useState('');
  const [search, setSearch] = useState('');
  const [statusKey, setStatusKey] = useState('all');
  const [downloadingId, setDownloadingId] = useState('');

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
    const wanted = searchParams.get('status') || 'all';
    setStatusKey(STATUS_FILTERS.some(f => f.key === wanted) ? wanted : 'all');
  }, [searchParams]);

  function handleStatusChange(key) {
    setStatusKey(key);
    const next = new URLSearchParams(searchParams);
    if (key && key !== 'all') next.set('status', key);
    else next.delete('status');
    setSearchParams(next, { replace: true });
  }

  async function fetchOrders() {
    try {
      const { data } = await axios.get('/api/orders');
      setOrders(data.reverse());
    } catch {
      setOrders([]);
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

  const activeFilter = STATUS_FILTERS.find(f => f.key === statusKey) || STATUS_FILTERS[0];
  const countFor = filter => orders.filter(filter.match).length;
  const filteredOrders = orders.filter(order => {
    if (!activeFilter.match(order)) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;

    const itemText = Array.isArray(order.items)
      ? order.items.map(item => `${item.name || ''} ${item.unit || ''}`).join(' ')
      : '';

    return (
      String(order.orderId || '').toLowerCase().includes(query) ||
      String(order.college || '').toLowerCase().includes(query) ||
      String(order.programName || '').toLowerCase().includes(query) ||
      String(order.projectName || '').toLowerCase().includes(query) ||
      String(order.courseName || '').toLowerCase().includes(query) ||
      String(order.status || '').toLowerCase().includes(query) ||
      itemText.toLowerCase().includes(query)
    );
  });

  async function downloadOrderPdf(orderId) {
    setDownloadingId(orderId);
    try {
      const response = await axios.get(`/api/orders/${orderId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setPageMsg('Unable to download this order right now.');
    } finally {
      setDownloadingId('');
    }
  }

  async function handleReturnRequest(orderId) {
    setProcessingId(orderId);
    setPageMsg('');
    try {
      const { data } = await axios.put(`/api/orders/${orderId}/return-request`);
      setPageMsg(data.message || 'Return request submitted.');
      await fetchOrders();
      setExpanded(orderId);
    } catch (err) {
      setPageMsg(err.response?.data?.message || 'Unable to request return right now.');
    } finally {
      setProcessingId('');
    }
  }

  if (loading) return <div style={styles.loading}>Loading your orders...</div>;

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>My Orders</h1>
            <p style={styles.sub}>Track requested, returned, damaged/consumed, and pending components here.</p>
          </div>
          <div style={{ ...styles.countBadge, ...(isMobile ? styles.fullWidthBadge : {}) }}>{orders.length} Total</div>
        </div>

        {pageMsg && <div style={styles.infoBox}>{pageMsg}</div>}

        <div style={styles.searchBar}>
          <input
            style={styles.searchInput}
            placeholder="Search order ID, project, college, component..."
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
          />
        </div>

        <div style={styles.chips} role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map(filter => {
            const active = filter.key === statusKey;
            const n = countFor(filter);
            return (
              <button
                type="button"
                key={filter.key}
                role="tab"
                aria-selected={active}
                onClick={() => handleStatusChange(filter.key)}
                style={{ ...styles.chip, ...(active ? styles.chipActive : {}), ...(n === 0 && !active ? styles.chipEmpty : {}) }}>
                {filter.label} <span style={{ ...styles.chipCount, ...(active ? styles.chipCountActive : {}) }}>{n}</span>
              </button>
            );
          })}
        </div>

        {filteredOrders.length === 0 ? (
          <div style={styles.empty}>
            <h3>{orders.length === 0 ? 'No orders yet' : 'No matching orders'}</h3>
            <p>{orders.length === 0 ? 'You have not placed any component requests.' : statusKey !== 'all' && !search.trim() ? `No orders are "${activeFilter.label}" right now.` : 'Try a different search term or filter.'}</p>
          </div>
        ) : (
          <div style={styles.list}>
            {filteredOrders.map(order => {
              const statusStyle = STATUS_STYLES[order.status] || STATUS_STYLES.Pending;
              const isOpen = expanded === order.orderId;
              const showReturnTracking = RETURN_FLOW_STATUSES.has(order.status);
              const returnSummary = showReturnTracking ? getReturnSummary(order) : [];
              const outstandingItems = showReturnTracking && Array.isArray(order.outstandingItems) ? order.outstandingItems : [];
              const damagedTotal = returnSummary.reduce((sum, item) => sum + (item.damagedQty || 0), 0);

              return (
                <div key={order.orderId} style={styles.orderCard}>
                  <div style={{ ...styles.orderHeader, ...(isMobile ? styles.orderHeaderMobile : {}) }} onClick={() => setExpanded(isOpen ? null : order.orderId)}>
                    <div style={{ ...styles.orderLeft, ...(isMobile ? styles.orderLeftMobile : {}) }}>
                      <div style={{ ...styles.statusDot, background: statusStyle.bg, color: statusStyle.color }}>
                        {statusStyle.label}
                      </div>
                      <div>
                        <div style={styles.orderId}>{order.orderId}</div>
                        <div style={styles.orderDate}>{formatDateTime(order.createdAt)}</div>
                      </div>
                    </div>
                    <div style={{ ...styles.orderRight, ...(isMobile ? styles.orderRightMobile : {}) }}>
                      <div style={styles.orderMeta}>
                        <span style={styles.tag}>{order.college}</span>
                        <span style={styles.tag}>{order.totalItems} items</span>
                      </div>
                      <span style={styles.chevron}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={styles.orderBody}>
                      <div style={{ ...styles.actionBar, ...(isMobile ? styles.actionBarMobile : {}), marginBottom: '14px' }}>
                        <button
                          style={{ ...styles.downloadBtn, ...(isMobile ? styles.fullWidthBadge : {}), opacity: downloadingId === order.orderId ? 0.7 : 1 }}
                          onClick={event => { event.stopPropagation(); downloadOrderPdf(order.orderId); }}
                          disabled={downloadingId === order.orderId}>
                          {downloadingId === order.orderId ? 'Preparing PDF...' : 'Download Order Summary (PDF)'}
                        </button>
                      </div>
                      <div style={styles.detailGrid}>
                        <div style={styles.detailItem}><span style={styles.detailLabel}>Program</span><span>{order.programName}</span></div>
                        {order.projectName && <div style={styles.detailItem}><span style={styles.detailLabel}>Project</span><span>{order.projectName}</span></div>}
                        <div style={styles.detailItem}><span style={styles.detailLabel}>Course</span><span>{order.courseName}</span></div>
                        <div style={styles.detailItem}><span style={styles.detailLabel}>Team</span><span>{order.teamName || '-'}</span></div>
                        <div style={styles.detailItem}><span style={styles.detailLabel}>Faculty Guide</span><span>{order.facultyGuide || '-'}</span></div>
                        {order.issuedAt && <div style={styles.detailItem}><span style={styles.detailLabel}>Issued At</span><span>{formatDateTime(order.issuedAt)}</span></div>}
                        {showReturnTracking && order.returnRequestedAt && <div style={styles.detailItem}><span style={styles.detailLabel}>Return Requested</span><span>{formatDateTime(order.returnRequestedAt)}</span></div>}
                        {showReturnTracking && order.lastReturnAt && <div style={styles.detailItem}><span style={styles.detailLabel}>Last Return Update</span><span>{formatDateTime(order.lastReturnAt)}</span></div>}
                        {showReturnTracking && order.returnedAt && <div style={styles.detailItem}><span style={styles.detailLabel}>Closed At</span><span>{formatDateTime(order.returnedAt)}</span></div>}
                        <div style={{ ...styles.detailItem, gridColumn: '1 / -1' }}>
                          <span style={styles.detailLabel}>Ordered Components</span>
                          {renderItemsTable(order.items, order.components)}
                        </div>
                        {showReturnTracking && (
                          <div style={{ ...styles.detailItem, gridColumn: '1 / -1' }}>
                            <span style={styles.detailLabel}>Return Tracking</span>
                            {renderReturnSummaryTable(returnSummary)}
                          </div>
                        )}
                        {showReturnTracking && outstandingItems.length > 0 && (
                          <div style={{ ...styles.detailItem, gridColumn: '1 / -1' }}>
                            <span style={styles.detailLabel}>Pending Balance</span>
                            <div style={styles.outstandingWrap}>
                              {outstandingItems.map(item => (
                                <span key={`${order.orderId}-${item.id}`} style={styles.outstandingTag}>
                                  {item.name}: {item.qty} {item.unit || 'pcs'}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {order.adminRemarks && (
                          <div style={{ ...styles.detailItem, gridColumn: '1 / -1' }}>
                            <span style={styles.detailLabel}>Admin Remarks</span>
                            <span style={{ color: statusStyle.color, fontWeight: 600 }}>{order.adminRemarks}</span>
                          </div>
                        )}
                      </div>

                      {order.status === 'Approved' && (
                        <div style={{ ...styles.actionBar, ...(isMobile ? styles.actionBarMobile : {}) }}>
                          <button
                            style={{ ...styles.returnBtn, ...(isMobile ? styles.fullWidthBadge : {}), opacity: processingId === order.orderId ? 0.7 : 1 }}
                            onClick={() => handleReturnRequest(order.orderId)}
                            disabled={processingId === order.orderId}>
                            {processingId === order.orderId ? 'Submitting...' : 'Request Return'}
                          </button>
                          <span style={styles.actionHint}>Use this after your work is complete and you are ready to hand the components back.</span>
                        </div>
                      )}

                      {order.status === 'Return Requested' && (
                        <div style={styles.waitingBox}>
                          Return requested. Please hand the components to the admin so they can verify the returned and damaged quantities.
                        </div>
                      )}

                      {order.status === 'Partially Returned' && (
                        <div style={styles.waitingBox}>
                          Some items are still pending with you. Remaining components must be handed back to close the order fully.
                          {damagedTotal > 0 && <div style={styles.damageNote}>Damaged/Consumed quantity recorded so far: {damagedTotal}</div>}
                        </div>
                      )}

                      {order.status === 'Returned' && damagedTotal > 0 && (
                        <div style={styles.damageBox}>
                          This order was closed with {damagedTotal} damaged/consumed component(s) recorded by the admin.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function getReturnSummary(order) {
  if (Array.isArray(order.returnSummary) && order.returnSummary.length) {
    return order.returnSummary;
  }
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.map(item => ({
      id: item.id,
      name: item.name,
      unit: item.unit || 'pcs',
      orderedQty: item.qty,
      returnedQty: order.status === 'Returned' ? item.qty : 0,
      damagedQty: 0,
      pendingQty: order.status === 'Returned' ? 0 : item.qty,
    }));
  }
  return [];
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('en-IN');
}

function renderItemsTable(items, fallback) {
  if (!Array.isArray(items) || !items.length) {
    return <span style={{ fontWeight: 600 }}>{fallback}</span>;
  }

  return (
    <div style={styles.tableScroll}>
      <table style={styles.itemTable}>
        <thead>
          <tr>
            <th style={styles.itemTh}>Component</th>
            <th style={styles.itemTh}>Qty</th>
            <th style={styles.itemTh}>Unit</th>
            <th style={styles.itemTh}>Assigned Unit(s)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.id || item.name}-${index}`}>
              <td style={styles.itemTd}>{item.name}</td>
              <td style={styles.itemTd}>{item.qty}</td>
              <td style={styles.itemTd}>{item.unit || 'pcs'}</td>
              <td style={{ ...styles.itemTd, fontSize: '12px', color: '#475569' }}>
                {Array.isArray(item.assets) && item.assets.length
                  ? item.assets.map(a => (
                      <div key={a.id} style={{ marginBottom: '4px' }}>
                        {a.assetTag}{a.serialNumber ? ` (SN: ${a.serialNumber})` : ''}
                        {a.correctionReason && (
                          <div style={{ fontSize: '10.5px', color: '#92400e' }}>Note: {a.correctionReason}</div>
                        )}
                      </div>
                    ))
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderReturnSummaryTable(summary) {
  if (!summary.length) {
    return <span style={{ fontWeight: 600 }}>Return tracking will appear after admin processes the return.</span>;
  }

  return (
    <div style={styles.tableScroll}>
      <table style={styles.itemTable}>
        <thead>
          <tr>
            <th style={styles.itemTh}>Component</th>
            <th style={styles.itemTh}>Ordered</th>
            <th style={styles.itemTh}>Returned</th>
            <th style={styles.itemTh}>Damaged/Consumed</th>
            <th style={styles.itemTh}>Pending</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((item, index) => (
            <tr key={`${item.id || item.name}-${index}`}>
              <td style={styles.itemTd}>{item.name}</td>
              <td style={styles.itemTd}>{item.orderedQty}</td>
              <td style={styles.itemTd}>{item.returnedQty}</td>
              <td style={styles.itemTd}>{item.damagedQty}</td>
              <td style={styles.itemTd}>{item.pendingQty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '980px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', gap: '16px', flexWrap: 'wrap' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '26px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '14px', marginTop: '4px' },
  countBadge: { background: '#1a237e', color: '#fff', padding: '6px 16px', borderRadius: '20px', fontWeight: 700, fontSize: '14px' },
  fullWidthBadge: { width: '100%', textAlign: 'center' },
  infoBox: { background: '#eef2ff', border: '1px solid #c7d2fe', color: '#1e3a8a', padding: '12px 14px', borderRadius: '12px', marginBottom: '18px', fontSize: '13px', fontWeight: 600 },
  searchBar: { marginBottom: '12px' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '999px', border: '1.5px solid #dbe3f0', background: '#fff', color: '#1a1a2e', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  chipActive: { background: '#2d2a6e', borderColor: '#2d2a6e', color: '#fff' },
  chipEmpty: { color: '#9ca3af' },
  chipCount: { background: '#f1f3f9', color: '#4b5563', borderRadius: '999px', padding: '1px 7px', fontSize: '11px', fontWeight: 800 },
  chipCountActive: { background: 'rgba(255,255,255,0.2)', color: '#fff' },
  searchInput: { width: '100%', padding: '12px 14px', border: '1.5px solid #dbe3f0', borderRadius: '12px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
  loading: { padding: '80px', textAlign: 'center', color: '#6b7280', fontSize: '16px' },
  empty: { textAlign: 'center', padding: '80px 20px', color: '#6b7280', background: '#fff', borderRadius: '16px' },
  list: { display: 'flex', flexDirection: 'column', gap: '12px' },
  orderCard: { background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  orderHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', cursor: 'pointer', gap: '12px', flexWrap: 'wrap' },
  orderHeaderMobile: { alignItems: 'flex-start' },
  orderLeft: { display: 'flex', alignItems: 'center', gap: '14px' },
  orderLeftMobile: { alignItems: 'flex-start' },
  statusDot: { padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' },
  orderId: { fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '14px', color: '#1a237e' },
  orderDate: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  orderRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  orderRightMobile: { width: '100%', justifyContent: 'space-between' },
  orderMeta: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  tag: { background: '#f0f2f8', color: '#374151', fontSize: '12px', padding: '4px 10px', borderRadius: '8px' },
  chevron: { color: '#6b7280', fontSize: '12px' },
  orderBody: { borderTop: '1px solid #f0f2f8', padding: '18px 20px', background: '#fafbff' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  detailItem: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '13px', color: '#374151' },
  detailLabel: { fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' },
  tableScroll: { overflowX: 'auto' },
  itemTable: { width: '100%', minWidth: '420px', borderCollapse: 'collapse', marginTop: '8px', background: '#fff', borderRadius: '10px', overflow: 'hidden' },
  itemTh: { textAlign: 'left', fontSize: '11px', color: '#17355f', background: '#e8eef8', padding: '8px 10px', borderBottom: '1px solid #dbe3f0' },
  itemTd: { padding: '8px 10px', borderBottom: '1px solid #eef2f7', fontSize: '12px', color: '#334155' },
  outstandingWrap: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' },
  outstandingTag: { background: '#fff3e0', color: '#9a3412', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  actionBar: { marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  actionBarMobile: { flexDirection: 'column', alignItems: 'stretch' },
  returnBtn: { background: 'linear-gradient(135deg, #1565c0, #1e88e5)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '9px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  downloadBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '9px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  actionHint: { fontSize: '12px', color: '#6b7280', maxWidth: '460px' },
  waitingBox: { marginTop: '16px', background: '#fff3e0', border: '1px solid #fdba74', color: '#9a3412', padding: '12px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600 },
  damageNote: { marginTop: '8px', color: '#b91c1c' },
  damageBox: { marginTop: '16px', background: '#fce4ec', border: '1px solid #f48fb1', color: '#c62828', padding: '12px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600 },
};
