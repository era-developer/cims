import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { useCenters } from '../context/CentersContext';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import AssetSwapPicker from '../components/AssetSwapPicker';
import AssetConditionFix from '../components/AssetConditionFix';
import AssetConditionPicker from '../components/AssetConditionPicker';
import ReturnScanner from '../components/ReturnScanner';
import InternalUseList from '../components/InternalUseList';
import IssueUnitsDialog from '../components/IssueUnitsDialog';

const STATUS_STYLES = {
  Pending: { bg: '#fff9c4', color: '#f57f17', label: 'Pending' },
  Approved: { bg: '#e8f5e9', color: '#2e7d32', label: 'Approved' },
  Rejected: { bg: '#fce4ec', color: '#c62828', label: 'Rejected' },
  'Return Requested': { bg: '#fff3e0', color: '#ef6c00', label: 'Return Requested' },
  'Partially Returned': { bg: '#e8f0fe', color: '#1d4ed8', label: 'Partially Returned' },
  Returned: { bg: '#e3f2fd', color: '#1565c0', label: 'Returned' },
};

const RETURN_FLOW_STATUSES = new Set(['Return Requested', 'Partially Returned', 'Returned']);

export default function AdminOrders() {
  const { centers } = useCenters();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useViewport();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(searchParams.get('tab') === 'internal' ? 'Internal use' : 'All');
  const [internalCount, setInternalCount] = useState(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [editorMode, setEditorMode] = useState('');
  const [remarks, setRemarks] = useState('');
  const [returnDraft, setReturnDraft] = useState([]);
  const [returnDamageReason, setReturnDamageReason] = useState('');
  const [approvalModal, setApprovalModal] = useState(null); // State for the new approval modal
  const [processing, setProcessing] = useState(false);
  const [pageMsg, setPageMsg] = useState('');
  const [centerId, setCenterId] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    setCenterId(isSuperAdmin ? '' : (user?.centerId || ''));
  }, [isSuperAdmin, user]);

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 30000);
    return () => clearInterval(timer);
  }, [centerId]);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    let data = orders;
    if (filter !== 'All' && filter !== 'Internal use') data = data.filter(order => order.status === filter);
    if (search) {
      const query = search.toLowerCase();
      data = data.filter(order =>
        order.studentName?.toLowerCase().includes(query) ||
        order.orderId?.toLowerCase().includes(query) ||
        order.college?.toLowerCase().includes(query) ||
        order.programName?.toLowerCase().includes(query) ||
        order.projectName?.toLowerCase().includes(query));
    }
    setFiltered(data);
  }, [orders, filter, search]);

  async function fetchOrders() {
    try {
      const { data } = await axios.get('/api/orders', { params: centerId ? { centerId } : {} });
      setOrders(data.reverse());
      // The tab badge should be right before the tab is ever opened.
      axios.get('/api/internal-issues', { params: centerId ? { centerId } : {} })
        .then(res => setInternalCount(Array.isArray(res.data) ? res.data.length : 0))
        .catch(() => {});
    } catch (err) {
      setPageMsg(err.response?.data?.message || 'Unable to load orders right now.');
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

  function toggleOrderDetails(orderId) {
    setExpandedOrderId(prevId => (prevId === orderId ? null : orderId));
  }

  function closeEditor() {
    setSelected(null);
    setEditorMode('');
    setRemarks('');
    setReturnDraft([]);
    setApprovalModal(null);
  }

  function openReview(order) {
    setSelected(order.orderId);
    setEditorMode('review');
    setRemarks(order.adminRemarks || '');
    setReturnDraft([]);
  }

  function openApprovalModal(order) {
    closeEditor();
    setApprovalModal(order);
  }

  function openReturnEditor(order) {
    setSelected(order.orderId);
    setEditorMode('return');
    setRemarks(order.adminRemarks || '');
    setReturnDraft(buildReturnDraft(order));
    setReturnDamageReason('');
  }

  async function handleStatus(orderId, status, payload = {}) {
    setProcessing(true);
    setPageMsg('');
    try {
      const { data } = await axios.put(`/api/orders/${orderId}/status`, {
        centerId,
        status,
        remarks,
        ...payload,
      });
      await fetchOrders();
      closeEditor();
      setPageMsg(`Order ${orderId} marked as ${data.status || status}.`);
    } catch (err) {
      setPageMsg(err.response?.data?.message || 'Error updating status.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleReturnUpdate(order) {
    const returnItems = returnDraft
      .map(item => ({
        id: item.id,
        returnedAssetIds: item.assets.filter(a => a.condition === 'good').map(a => a.id),
        damagedAssetIds: item.assets.filter(a => a.condition === 'damaged').map(a => a.id),
      }))
      .filter(item => item.returnedAssetIds.length || item.damagedAssetIds.length);

    if (!returnItems.length) {
      setPageMsg('Select at least one returned or damaged unit before saving.');
      return;
    }
    const anyDamaged = returnItems.some(item => item.damagedAssetIds.length);
    if (anyDamaged && !returnDamageReason.trim()) {
      setPageMsg('Enter a reason for the unit(s) being returned damaged.');
      return;
    }

    await handleStatus(order.orderId, 'Returned', { returnItems, damageReason: returnDamageReason.trim() });
  }

  function setAssetCondition(itemId, assetId, condition) {
    setReturnDraft(current => current.map(item => (
      item.id !== itemId ? item : { ...item, assets: item.assets.map(a => (a.id === assetId ? { ...a, condition } : a)) }
    )));
  }

  const counts = {
    All: orders.length,
    Pending: orders.filter(order => order.status === 'Pending').length,
    Approved: orders.filter(order => order.status === 'Approved').length,
    'Return Requested': orders.filter(order => order.status === 'Return Requested').length,
    'Partially Returned': orders.filter(order => order.status === 'Partially Returned').length,
    Returned: orders.filter(order => order.status === 'Returned').length,
    Rejected: orders.filter(order => order.status === 'Rejected').length,
  };

  if (loading) return <div style={styles.loading}>Loading orders...</div>;

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Order Management</h1>
            <p style={styles.sub}>Approve requests, record returns, and track partially returned items. The Internal use tab holds every component pulled by staff for sessions and projects.</p>
          </div>
        </div>

        {isSuperAdmin && (
          <div style={styles.centerRow}>
            <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.centerSelect}>
              <option value="">All Centers</option>
              {centers.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
          </div>
        )}

        {pageMsg && <div style={styles.infoBox}>{pageMsg}</div>}

        <div style={{ ...styles.tabs, ...(isMobile ? styles.tabsMobile : {}) }}>
          {['All', 'Pending', 'Approved', 'Return Requested', 'Partially Returned', 'Returned', 'Rejected', 'Internal use'].map(tab => (
            <button
              key={tab}
              style={{ ...styles.tab, ...(filter === tab ? styles.tabActive : {}), ...(tab === 'Internal use' ? styles.tabInternal : {}), ...(tab === 'Internal use' && filter === tab ? styles.tabInternalActive : {}) }}
              onClick={() => setFilter(tab)}>
              {tab} <span style={styles.tabCount}>{tab === 'Internal use' ? (internalCount ?? '…') : counts[tab]}</span>
            </button>
          ))}
        </div>

        <div style={styles.searchBar}>
          <input
            style={styles.search}
            placeholder={filter === 'Internal use' ? 'Search by code, who took it, program, component...' : 'Search by student, order ID, college, project...'}
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
          />
        </div>

        {filter === 'Internal use' && (
          <InternalUseList centerId={centerId} search={search} onCount={setInternalCount} onChanged={fetchOrders} />
        )}

        <div style={{ ...styles.list, ...(filter === 'Internal use' ? { display: 'none' } : {}) }}>
          {filtered.length === 0 ? (
            <div style={styles.empty}>No orders found</div>
          ) : filtered.map(order => {
            const statusStyle = STATUS_STYLES[order.status] || STATUS_STYLES.Pending;
            const showReturnTracking = RETURN_FLOW_STATUSES.has(order.status);
            const returnSummary = showReturnTracking ? getReturnSummary(order) : [];
            const outstandingItems = showReturnTracking && Array.isArray(order.outstandingItems) ? order.outstandingItems : [];
            const isSelectedForReview = selected === order.orderId && editorMode === 'review';
            const isExpanded = expandedOrderId === order.orderId;

            return (
              <div key={order.orderId} style={styles.orderCard}>
                <div style={{ ...styles.orderTop, cursor: 'pointer' }} onClick={() => toggleOrderDetails(order.orderId)}>
                  <div style={styles.orderMain}>
                    <div style={styles.orderIdRow}>
                      <span style={styles.orderId}>{order.orderId}</span>
                      <span style={{ ...styles.statusBadge, background: statusStyle.bg, color: statusStyle.color }}>
                        {statusStyle.label}
                      </span>
                    </div>
                    <div style={styles.orderName}>{order.studentName}</div>
                    <div style={styles.orderMeta}>{order.mobile} · {order.college} · {order.department}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ ...styles.orderRight, ...(isMobile ? styles.orderRightMobile : {}) }}>
                      <div style={styles.orderDate}>{formatDateTime(order.createdAt)}</div>
                      <div style={styles.itemCount}>{order.totalItems} item(s)</div>
                    </div>
                    <div style={{ fontSize: '16px', color: '#6b7280' }}>
                      {isExpanded ? '▲' : '▼'}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <>
                    <div style={styles.orderDetails}>
                      <div style={styles.detailRow}><span style={styles.dl}>Program</span><span>{order.programName}</span></div>
                      {order.projectName && <div style={styles.detailRow}><span style={styles.dl}>Project</span><span>{order.projectName}</span></div>}
                      <div style={styles.detailRow}><span style={styles.dl}>Course</span><span>{order.courseName}</span></div>
                      <div style={styles.detailRow}><span style={styles.dl}>Team</span><span>{order.teamName || '-'}</span></div>
                      {order.teamMembers?.length > 0 && (
                        <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                          <span style={styles.dl}>Team Members</span>
                          <span>{order.teamMembers.map(m => `${m.name}${m.mobile ? ` (${m.mobile})` : ''}`).join(', ')}</span>
                        </div>
                      )}
                      <div style={styles.detailRow}><span style={styles.dl}>Guide</span><span>{order.facultyGuide || '-'}</span></div>
                      {order.termsAcceptedAt && <div style={styles.detailRow}><span style={styles.dl}>Terms Accepted</span><span>{formatDateTime(order.termsAcceptedAt)}</span></div>}
                      {order.reservedAt && <div style={styles.detailRow}><span style={styles.dl}>Reserved At</span><span>{formatDateTime(order.reservedAt)}</span></div>}
                      {order.issuedAt && <div style={styles.detailRow}><span style={styles.dl}>Issued At</span><span>{formatDateTime(order.issuedAt)}</span></div>}
                      {showReturnTracking && order.returnRequestedAt && <div style={styles.detailRow}><span style={styles.dl}>Return Requested</span><span>{formatDateTime(order.returnRequestedAt)}</span></div>}
                      {showReturnTracking && order.lastReturnAt && <div style={styles.detailRow}><span style={styles.dl}>Last Return Update</span><span>{formatDateTime(order.lastReturnAt)}</span></div>}
                      {showReturnTracking && order.returnedAt && <div style={styles.detailRow}><span style={styles.dl}>Closed At</span><span>{formatDateTime(order.returnedAt)}</span></div>}
                      <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                        <span style={styles.dl}>Ordered Components</span>
                        {renderItemsTable(order.items, order.components, order.orderId, fetchOrders)}
                      </div>
                      {showReturnTracking && (
                        <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                          <span style={styles.dl}>Return Tracking</span>
                          {renderReturnSummaryTable(returnSummary)}
                        </div>
                      )}
                      {showReturnTracking && outstandingItems.length > 0 && (
                        <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                          <span style={styles.dl}>Outstanding Items</span>
                          <div style={styles.outstandingWrap}>
                            {outstandingItems.map(item => (
                              <span key={`${order.orderId}-${item.id}`} style={styles.outstandingTag}>
                                {item.name}: {item.qty} {item.unit || 'pcs'}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {order.purpose && (
                        <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                          <span style={styles.dl}>Purpose</span>
                          <span style={{ color: '#374151' }}>{order.purpose}</span>
                        </div>
                      )}
                      {order.adminRemarks && (
                        <div style={{ ...styles.detailRow, gridColumn: '1 / -1' }}>
                          <span style={styles.dl}>Remarks</span>
                          <span style={{ color: statusStyle.color, fontWeight: 600 }}>{order.adminRemarks}</span>
                        </div>
                      )}
                    </div>

                    {order.status === 'Pending' && (
                      <div style={styles.actionArea}>
                        {isSelectedForReview ? (
                          <div style={styles.actionExpanded}>
                            <input
                              style={styles.remarksInput}
                              value={remarks}
                              onChange={event => setRemarks(event.target.value)}
                              placeholder="Admin remarks (optional)"
                            />
                            <div style={styles.actionBtns}>
                              <button style={styles.cancelBtn} onClick={closeEditor}>Cancel</button>
                              <button
                                style={{ ...styles.rejectBtn, opacity: processing ? 0.7 : 1 }}
                                onClick={() => handleStatus(order.orderId, 'Rejected')}
                                disabled={processing}>
                                Reject
                              </button>
                              <button
                                style={{ ...styles.approveBtn, opacity: processing ? 0.7 : 1 }}
                                onClick={() => openApprovalModal(order)}
                                disabled={processing || !order.items.length}>
                                Approve
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button style={styles.reviewBtn} onClick={() => openReview(order)}>
                            Review Request
                          </button>
                        )}
                      </div>
                    )}

                    {['Return Requested', 'Partially Returned'].includes(order.status) && (
                      <div style={styles.actionArea}>
                        {selected === order.orderId && editorMode === 'return' ? (
                          <div style={styles.actionExpanded}>
                            <div style={styles.returnPanelTitle}>Return Entry</div>
                            <p style={styles.returnPanelHint}>Scan each unit as it comes back and pick its condition, or use the buttons per unit. Leave a unit as "Not returned" if the student still has it.</p>
                            <ReturnScanner
                              groups={returnDraft.map(item => ({ id: item.id, name: item.name, assets: item.assets }))}
                              onChange={setAssetCondition}
                              style={{ marginBottom: '10px' }}
                            />
                            <div style={styles.returnItemList}>
                              {returnDraft.map(item => (
                                <div key={`${order.orderId}-${item.id}`} style={styles.returnItemCard}>
                                  <div style={styles.returnItemHeader}>
                                    <span style={styles.returnItemName}>{item.name}</span>
                                    <span style={styles.returnItemMeta}>
                                      Ordered {item.orderedQty} · Returned {item.returnedQty} · Damaged {item.damagedQty} · Pending {item.pendingQty}
                                    </span>
                                  </div>
                                  <AssetConditionPicker
                                    assets={item.assets}
                                    onChange={(assetId, condition) => setAssetCondition(item.id, assetId, condition)}
                                  />
                                </div>
                              ))}
                            </div>

                            {returnDraft.some(item => item.assets.some(a => a.condition === 'damaged')) && (
                              <input
                                style={styles.remarksInput}
                                value={returnDamageReason}
                                onChange={event => setReturnDamageReason(event.target.value)}
                                placeholder="Reason for the damaged unit(s) -- required"
                              />
                            )}
                            <input
                              style={styles.remarksInput}
                              value={remarks}
                              onChange={event => setRemarks(event.target.value)}
                              placeholder="Return notes or damage remarks (optional)"
                            />
                            <div style={styles.actionBtns}>
                              <button style={styles.cancelBtn} onClick={closeEditor}>Cancel</button>
                              <button
                                style={{ ...styles.returnConfirmBtn, opacity: processing ? 0.7 : 1 }}
                                onClick={() => handleReturnUpdate(order)}
                                disabled={processing}>
                                Save Return Update
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button style={styles.reviewBtn} onClick={() => openReturnEditor(order)}>
                            {order.status === 'Partially Returned' ? 'Continue Return Entry' : 'Record Returned Items'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {approvalModal && (
          <IssueUnitsDialog
            order={approvalModal}
            remarks={remarks}
            setRemarks={setRemarks}
            processing={processing}
            isMobile={isMobile}
            onClose={() => setApprovalModal(null)}
            onConfirm={payload => handleStatus(approvalModal.orderId, 'Approved', payload)}
          />
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

function buildReturnDraft(order) {
  const itemsById = new Map((order.items || []).map(item => [item.id, item]));
  return getReturnSummary(order)
    .filter(item => item.pendingQty > 0)
    .map(item => {
      const sourceItem = itemsById.get(item.id);
      const issuedAssets = Array.isArray(sourceItem?.assets) ? sourceItem.assets.filter(a => a.status === 'issued') : [];
      return { ...item, assets: issuedAssets.map(a => ({ ...a, condition: 'skip' })) };
    });
}

function renderItemsTable(items, fallback, orderId, onSwapped) {
  const safeItems = Array.isArray(items) && items.length ? items : parseFallbackItems(fallback);
  if (!safeItems.length) {
    return <span style={{ fontWeight: 600 }}>{fallback || 'No component details available'}</span>;
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
          {safeItems.map((item, index) => (
            <tr key={`${item.id || item.name}-${index}`}>
              <td style={styles.itemTd}>{item.name}</td>
              <td style={styles.itemTd}>{item.qty}</td>
              <td style={styles.itemTd}>{item.unit || 'pcs'}</td>
              <td style={{ ...styles.itemTd, fontSize: '12px', color: '#475569' }}>
                {Array.isArray(item.assets) && item.assets.length
                  ? item.assets.map(a => (
                      <span key={a.id} style={{ display: 'inline-block', marginRight: '10px', marginBottom: '4px', verticalAlign: 'top' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {a.assetTag}{a.serialNumber ? ` (SN: ${a.serialNumber})` : ''}
                          {orderId && (
                            <>
                              <AssetSwapPicker
                                asset={a}
                                catalogId={item.id}
                                swapUrl={`/api/orders/${orderId}/items/${item.id}/swap-asset`}
                                onSwapped={onSwapped}
                              />
                              <AssetConditionFix asset={a} onFixed={onSwapped} />
                            </>
                          )}
                        </span>
                        {a.correctionReason && (
                          <div style={{ fontSize: '10.5px', color: '#92400e', maxWidth: '220px' }}>
                            Note{a.correctionBy ? ` (${a.correctionBy})` : ''}: {a.correctionReason}
                          </div>
                        )}
                      </span>
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

function parseFallbackItems(fallback) {
  const text = String(fallback || '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const match = entry.match(/^(.*)\(x(\d+)\)$/i);
      return {
        id: `fallback-${index + 1}`,
        name: match ? match[1].trim() : entry,
        qty: match ? Number(match[2]) || 1 : 1,
        unit: 'pcs',
      };
    });
}

function renderReturnSummaryTable(summary) {
  if (!summary.length) {
    return <span style={{ fontWeight: 600 }}>Return tracking will appear once the admin starts processing returns.</span>;
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
  container: { maxWidth: '1120px', margin: '0 auto' },
  header: { marginBottom: '24px' },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px' },
  infoBox: { background: '#eef2ff', border: '1px solid #c7d2fe', color: '#1e3a8a', padding: '12px 14px', borderRadius: '12px', marginBottom: '18px', fontSize: '13px', fontWeight: 600 },
  tabs: { display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' },
  tabsMobile: { flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '6px' },
  tab: { padding: '9px 16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' },
  tabActive: { background: '#1a237e', borderColor: '#1a237e', color: '#fff' },
  tabInternal: { marginLeft: 'auto', borderColor: '#f9a825', color: '#92400e' },
  tabInternalActive: { background: '#f9a825', borderColor: '#f9a825', color: '#102548' },
  tabCount: { background: 'rgba(255,255,255,0.25)', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' },
  searchBar: { marginBottom: '16px' },
  search: { width: '100%', padding: '11px 16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
  loading: { padding: '60px', textAlign: 'center', color: '#6b7280' },
  empty: { padding: '60px', textAlign: 'center', color: '#6b7280', background: '#fff', borderRadius: '14px' },
  list: { display: 'flex', flexDirection: 'column', gap: '14px' },
  orderCard: { background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  orderTop: { display: 'flex', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #f0f2f8', gap: '12px', flexWrap: 'wrap' },
  orderMain: { flex: 1 },
  orderIdRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' },
  orderId: { fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '13px', color: '#1a237e' },
  statusBadge: { padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 },
  orderName: { fontWeight: 700, fontSize: '16px', color: '#1a1a2e', marginBottom: '4px' },
  orderMeta: { fontSize: '12px', color: '#6b7280' },
  orderRight: { textAlign: 'right', flexShrink: 0 },
  orderRightMobile: { width: '100%', textAlign: 'left' },
  orderDate: { fontSize: '12px', color: '#6b7280' },
  itemCount: { fontSize: '13px', fontWeight: 600, color: '#1a237e', marginTop: '4px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '20px' },
  modal: { background: '#fff', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalMobile: { padding: '22px 18px' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  modalTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '18px', fontWeight: 800, color: '#1a1a2e' },
  modalSub: { fontSize: '13px', color: '#64748b', marginBottom: '16px' },
  closeBtn: { background: '#f0f2f8', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: '#6b7280' },
  orderDetails: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', padding: '14px 20px', background: '#fafbff', fontSize: '13px' },
  detailRow: { display: 'flex', flexDirection: 'column', gap: '2px' },
  dl: { fontSize: '10px', fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.4px' },
  tableScroll: { overflowX: 'auto' },
  itemTable: { width: '100%', minWidth: '420px', borderCollapse: 'collapse', marginTop: '8px', background: '#fff', borderRadius: '10px', overflow: 'hidden' },
  itemTh: { textAlign: 'left', fontSize: '11px', color: '#17355f', background: '#e8eef8', padding: '8px 10px', borderBottom: '1px solid #dbe3f0' },
  itemTd: { padding: '8px 10px', borderBottom: '1px solid #eef2f7', fontSize: '12px', color: '#334155' },
  outstandingWrap: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' },
  outstandingTag: { background: '#fff3e0', color: '#9a3412', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  actionArea: { padding: '12px 20px', borderTop: '1px solid #f0f2f8', background: '#fafbff' },
  reviewBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '9px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  actionExpanded: { display: 'flex', flexDirection: 'column', gap: '12px' },
  returnPanelTitle: { fontSize: '13px', fontWeight: 700, color: '#17355f' },
  returnPanelHint: { fontSize: '12px', color: '#6b7280', margin: '2px 0 0' },
  returnItemList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  returnItemCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' },
  returnItemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' },
  returnItemName: { fontSize: '13px', fontWeight: 700, color: '#1a1a2e' },
  returnItemMeta: { fontSize: '11px', color: '#6b7280' },
  returnEditTable: { width: '100%', minWidth: '760px', borderCollapse: 'collapse', background: '#fff', borderRadius: '10px', overflow: 'hidden' },
  returnEditTh: { textAlign: 'left', fontSize: '11px', color: '#17355f', background: '#e8eef8', padding: '8px 10px', borderBottom: '1px solid #dbe3f0' },
  returnEditTd: { padding: '8px 10px', borderBottom: '1px solid #eef2f7', fontSize: '12px', color: '#334155' },
  qtyInput: { width: '74px', padding: '7px 8px', border: '1.5px solid #dbe3f0', borderRadius: '8px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  approvalInputRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  removeQtyBtn: { background: 'none', border: 'none', color: '#c62828', fontSize: '11px', cursor: 'pointer', padding: '0', margin: '0', fontWeight: 600 },
  remarksInput: { width: '100%', padding: '9px 13px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  actionBtns: { display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' },
  cancelBtn: { background: '#f0f2f8', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151' },
  approveBtn: { background: 'linear-gradient(135deg, #2e7d32, #43a047)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  rejectBtn: { background: 'linear-gradient(135deg, #c62828, #e53935)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  returnConfirmBtn: { background: 'linear-gradient(135deg, #1565c0, #1e88e5)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
};
