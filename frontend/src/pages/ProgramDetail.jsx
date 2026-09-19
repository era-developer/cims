import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import AssetConditionFix from '../components/AssetConditionFix';

const STATUS_META = {
  planning: { label: 'Planning', color: '#1d4ed8', bg: '#dbeafe' },
  ongoing: { label: 'Ongoing', color: '#b45309', bg: '#fef3c7' },
  completed: { label: 'Completed', color: '#047857', bg: '#d1fae5' },
};

function money(value) {
  const n = Number(value) || 0;
  return `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export default function ProgramDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [expandedAsset, setExpandedAsset] = useState(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`/api/programs/${id}/report`);
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load this program.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  async function downloadReport() {
    setDownloading(true);
    try {
      const response = await axios.get(`/api/programs/${id}/report.xlsx`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `program-${report?.program?.name || id}-report.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Unable to download the report right now.');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div style={styles.page}><p style={styles.helperText}>Loading program...</p></div>;
  }
  if (error || !report) {
    return (
      <div style={styles.page}>
        <button type="button" style={styles.backBtn} onClick={() => navigate('/admin/my-center')}>← Back to My Center</button>
        <div style={styles.error}>{error || 'Program not found.'}</div>
      </div>
    );
  }

  const { program, invoices, damagedAssets, studentOrders, internalIssues, procurementRequests, totals } = report;
  const meta = STATUS_META[program.status] || STATUS_META.planning;

  return (
    <div style={styles.page}>
      <button type="button" style={styles.backBtn} onClick={() => navigate('/admin/my-center')}>← Back to My Center</button>

      <div style={styles.hero}>
        <div>
          <div style={styles.heroRow}>
            <h1 style={styles.title}>{program.name}</h1>
            <span style={{ ...styles.statusBadge, color: meta.color, background: meta.bg }}>{meta.label}</span>
          </div>
          <p style={styles.subtitle}>
            Handled by {program.handled_by || '-'} {program.institute_name ? `• ${program.institute_name}` : ''}
          </p>
          <p style={styles.subtitle}>
            {program.start_date || 'Start date not set'} → {program.expected_end_date || 'no expected end date'}
            {program.completion_date ? ` • Completed ${program.completion_date}` : ''}
          </p>
          {program.notes && <p style={styles.subtitle}>{program.notes}</p>}
        </div>
        <button type="button" style={styles.exportBtn} onClick={downloadReport} disabled={downloading}>
          {downloading ? 'Preparing...' : 'Export full report (Excel)'}
        </button>
      </div>

      <div style={styles.statGrid}>
        <div style={styles.statCard}>
          <span style={styles.statLabel}>Invoiced value</span>
          <span style={styles.statValue}>{money(totals.invoicedValue)}</span>
          <span style={styles.helperText}>{totals.invoiceCount} invoice(s)</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statLabel}>Damaged units</span>
          <span style={styles.statValue}>{totals.damagedCount}</span>
          <span style={styles.helperText}>{money(totals.damagedValue)} in value</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statLabel}>Student orders</span>
          <span style={styles.statValue}>{totals.studentOrderCount}</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statLabel}>Internal component issues</span>
          <span style={styles.statValue}>{totals.internalIssueCount}</span>
        </div>
        <div style={styles.statCard}>
          <span style={styles.statLabel}>Component requests</span>
          <span style={styles.statValue}>{totals.procurementRequestCount}</span>
        </div>
      </div>

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Procurement (Invoices)</div>
        {!invoices.length ? (
          <p style={styles.helperText}>No invoices linked to this program yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Invoice #</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Vendor</th>
                  <th style={styles.th}>Items</th>
                  <th style={styles.th}>Total value</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{inv.invoice_date || '-'}</td>
                    <td style={styles.td}>{inv.vendor_name || '-'}</td>
                    <td style={styles.td}>
                      {inv.lineItems.map(li => `${li.asset_name} x${li.bill_quantity}`).join(', ') || '-'}
                    </td>
                    <td style={styles.td}>{money(inv.total_bill_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Damaged components & lifecycle</div>
        {!damagedAssets.length ? (
          <p style={styles.helperText}>No components have been marked damaged under this program.</p>
        ) : (
          <div style={styles.historyList}>
            {damagedAssets.map(asset => (
              <div key={asset.assetId} style={styles.historyItem}>
                <div style={styles.historyRow}>
                  <span style={styles.historyTitle}>{asset.name} ({asset.assetTag})</span>
                  <span>{money(asset.unitValue)}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>Damaged on {formatDate(asset.occurredAt)} by {asset.performedBy || '-'}</span>
                  <span>{asset.location || ''}</span>
                </div>
                {asset.notes && <div style={styles.historyRow}><span>{asset.notes}</span></div>}
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => setExpandedAsset(expandedAsset === asset.assetId ? null : asset.assetId)}
                >
                  {expandedAsset === asset.assetId ? 'Hide full lifecycle' : 'View full lifecycle'}
                </button>
                {expandedAsset === asset.assetId && (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Event</th>
                          <th style={styles.th}>From → To</th>
                          <th style={styles.th}>When</th>
                          <th style={styles.th}>By</th>
                          <th style={styles.th}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asset.lifecycle.map((event, idx) => (
                          <tr key={idx}>
                            <td style={styles.td}>{event.event_type}</td>
                            <td style={styles.td}>{event.from_status || '-'} → {event.to_status}</td>
                            <td style={styles.td}>{formatDate(event.occurred_at)}</td>
                            <td style={styles.td}>{event.performed_by || '-'}</td>
                            <td style={styles.td}>{event.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Student issue / return activity</div>
        <p style={styles.helperText}>Matched to this program by the project name entered at checkout.</p>
        {!studentOrders.length ? (
          <p style={styles.helperText}>No student orders recorded under this program yet.</p>
        ) : (
          <div style={styles.historyList}>
            {studentOrders.map(order => (
              <div key={order.orderId} style={styles.historyItem}>
                <div style={styles.historyRow}>
                  <span style={styles.historyTitle}>{order.orderId}</span>
                  <span>{order.status}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>{order.studentName} • {order.mobile || 'no mobile'} • {order.studentEmail || 'no email'}</span>
                  <span>{formatDate(order.createdAt)}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>{order.college || '-'} {order.department ? `• ${order.department}` : ''}</span>
                  <span>{order.teamName ? `Team: ${order.teamName}` : ''} {order.facultyGuide ? `• Guide: ${order.facultyGuide}` : ''}</span>
                </div>
                <div style={styles.componentList}>
                  {(order.items || []).map(item => (
                    <span key={item.id} style={styles.componentPill}>{item.name} × {item.qty}</span>
                  ))}
                </div>
                {(order.returnSummary || []).some(i => Number(i.damagedQty) > 0) && (
                  <div style={styles.historyRow}>
                    <span style={styles.helperTextError}>
                      Damaged: {order.returnSummary.filter(i => i.damagedQty > 0).map(i => `${i.name} x${i.damagedQty}`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Internal component use</div>
        <p style={styles.helperText}>Components pulled by staff for a session or internal project, not a student checkout.</p>
        {!internalIssues.length ? (
          <p style={styles.helperText}>No internal component use recorded under this program yet.</p>
        ) : (
          <div style={styles.historyList}>
            {internalIssues.map(issue => (
              <div key={issue.id} style={styles.historyItem}>
                <div style={styles.historyRow}>
                  <span style={styles.historyTitle}>{issue.issueCode}</span>
                  <span>{issue.status}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>Taken by: {issue.takenBy}</span>
                  <span>{formatDate(issue.issuedAt)}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>Reason: {issue.reason}</span>
                </div>
                <div style={styles.componentList}>
                  {(issue.items || []).map(item => (
                    <span key={item.id} style={styles.componentPill}>{item.name} × {item.qty}</span>
                  ))}
                </div>
                {(issue.items || []).some(item => Array.isArray(item.assets) && item.assets.length > 0) && (
                  <div style={styles.historyRow}>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
                      {issue.items.flatMap(item => (item.assets || []).map(a => (
                        <span key={a.id} style={{ fontSize: '12px', color: a.status === 'damaged' ? '#c62828' : '#475569' }}>
                          {a.assetTag}{a.serialNumber ? ` (SN: ${a.serialNumber})` : ''} -- {a.status}
                          <AssetConditionFix asset={a} onFixed={fetchReport} />
                          {a.correctionReason && (
                            <div style={{ fontSize: '10.5px', color: '#92400e' }}>
                              Note{a.correctionBy ? ` (${a.correctionBy})` : ''}: {a.correctionReason}
                            </div>
                          )}
                        </span>
                      )))}
                    </span>
                  </div>
                )}
                {(issue.items || []).some(i => Number(i.returnedDamagedQty) > 0) && (
                  <div style={styles.historyRow}>
                    <span style={styles.helperTextError}>
                      Damaged on return: {issue.items.filter(i => i.returnedDamagedQty > 0).map(i => `${i.name} x${i.returnedDamagedQty}`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.sectionHeading}>Component requests to super admin</div>
        <p style={styles.helperText}>New components requested for this program, distinct from moving existing stock between centers.</p>
        {!procurementRequests.length ? (
          <p style={styles.helperText}>No component requests under this program yet.</p>
        ) : (
          <div style={styles.historyList}>
            {procurementRequests.map(request => (
              <div key={request.id} style={styles.historyItem}>
                <div style={styles.historyRow}>
                  <span style={styles.historyTitle}>Request #{request.id}</span>
                  <span>{request.status}</span>
                </div>
                <div style={styles.historyRow}>
                  <span>Requested by: {request.requestedBy}</span>
                  <span>{formatDate(request.createdAt)}</span>
                </div>
                <div style={styles.componentList}>
                  {(request.items || []).map((item, idx) => (
                    <span key={idx} style={styles.componentPill}>{item.componentName} × {item.qtyRequested}</span>
                  ))}
                </div>
                {request.adminRemarks && (
                  <div style={styles.historyRow}><span>Remarks: {request.adminRemarks}</span></div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}

const styles = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: '24px 28px 60px' },
  backBtn: {
    background: 'transparent', border: 'none', color: '#1a237e', fontWeight: 600,
    cursor: 'pointer', padding: 0, marginBottom: 14, fontSize: 14,
  },
  hero: {
    marginBottom: 18, padding: '24px', borderRadius: 20,
    background: 'linear-gradient(135deg, #15264a, #1a3f82)', color: '#f5f7ff',
    display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'center', flexWrap: 'wrap',
  },
  heroRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 28, margin: '0 0 8px', lineHeight: 1.25 },
  subtitle: { margin: '4px 0 0', maxWidth: 640, fontSize: 14, lineHeight: 1.6, color: '#dfe6ff' },
  exportBtn: {
    background: '#f9a825', border: 'none', borderRadius: 12, color: '#102548', fontWeight: 700,
    cursor: 'pointer', padding: '12px 20px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
  },
  statusBadge: { display: 'inline-flex', padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 },
  statCard: {
    background: '#fff', borderRadius: 16, padding: '16px 20px', boxShadow: '0 10px 26px rgba(15,23,42,0.06)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  statLabel: { fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  statValue: { fontSize: 22, fontWeight: 800, color: '#0f172a' },
  card: { background: '#fff', borderRadius: 20, padding: '24px', boxShadow: '0 14px 40px rgba(15,23,42,0.08)', marginBottom: 20 },
  sectionHeading: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1c2564' },
  helperText: { fontSize: 12, color: '#475569' },
  helperTextError: { fontSize: 12, color: '#c62828' },
  tableWrap: { overflowX: 'auto', marginTop: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid #eef2f7', color: '#1e293b' },
  historyList: { display: 'flex', flexDirection: 'column', gap: 12 },
  historyItem: { border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', background: '#f8fafc' },
  historyRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#1e1b4b', marginBottom: 6, gap: 12, flexWrap: 'wrap' },
  historyTitle: { fontWeight: 700, color: '#0f172a' },
  componentList: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  componentPill: { display: 'inline-flex', padding: '4px 8px', borderRadius: 8, background: '#fff', border: '1px solid #d1d5db', fontSize: 12 },
  linkBtn: {
    background: 'transparent', border: 'none', color: '#1a237e', fontWeight: 600,
    cursor: 'pointer', padding: 0, fontSize: 12, marginTop: 4,
  },
  error: { background: '#fee2e2', color: '#b91c1c', borderRadius: 12, padding: '10px 14px' },
};
