import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import InternalReturnDialog from './InternalReturnDialog';

// The full internal-use register, shown on the Orders page under its own
// tab: every record (open and closed) with who took what, when, the units
// and their return state, and a Record return button for anything still out.
// Before this the only place to see internal use was the "Return" list on
// Inventory, which shows open records only -- there was no history at all.
const STATUS_META = {
  issued: { label: 'Out', bg: '#fff3e0', color: '#e65100' },
  'partially returned': { label: 'Partially returned', bg: '#e8f0fe', color: '#1d4ed8' },
  returned: { label: 'Returned', bg: '#e8f5e9', color: '#2e7d32' },
};

export default function InternalUseList({ centerId, search, onCount, onChanged }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [returning, setReturning] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/internal-issues', { params: centerId ? { centerId } : {} });
      setIssues(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load internal use records.');
    } finally {
      setLoading(false);
    }
  }, [centerId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onCount?.(issues.length); }, [issues, onCount]);

  const query = String(search || '').trim().toLowerCase();
  const visible = issues.filter(issue => {
    const status = String(issue.status || '').toLowerCase();
    if (statusFilter === 'open' && status === 'returned') return false;
    if (statusFilter === 'returned' && status !== 'returned') return false;
    if (!query) return true;
    const hay = [issue.issueCode, issue.takenBy, issue.programName, issue.reason, issue.instituteName, issue.issuedBy,
      ...(issue.items || []).map(i => i.name), ...(issue.items || []).flatMap(i => (i.assets || []).map(a => a.assetTag))]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  });

  async function handleSaved(issue) {
    setReturning(null);
    setMessage(`${issue?.issueCode || 'Internal use'} return recorded.`);
    await load();
    onChanged?.();
  }

  const openCount = issues.filter(i => String(i.status).toLowerCase() !== 'returned').length;

  return (
    <div>
      <div style={styles.bar}>
        <div style={styles.chips}>
          {[['all', `All ${issues.length}`], ['open', `Still out ${openCount}`], ['returned', `Returned ${issues.length - openCount}`]].map(([key, label]) => (
            <button key={key} type="button" style={{ ...styles.chip, ...(statusFilter === key ? styles.chipActive : {}) }} onClick={() => setStatusFilter(key)}>{label}</button>
          ))}
        </div>
        <span style={styles.hint}>To pull components for a session, use Inventory → Internal Use.</span>
      </div>

      {message && <div style={styles.info}>{message}</div>}
      {error && <div style={styles.error}>{error}</div>}
      {loading && <div style={styles.empty}>Loading internal use records…</div>}
      {!loading && !visible.length && <div style={styles.empty}>{issues.length ? 'No records match.' : 'No internal use recorded yet.'}</div>}

      <div style={styles.list}>
        {visible.map(issue => {
          const meta = STATUS_META[String(issue.status || '').toLowerCase()] || { label: issue.status, bg: '#f1f3f9', color: '#374151' };
          const isOpen = expanded === issue.id;
          const outstanding = (issue.items || []).reduce((n, i) => n + (i.outstandingQty || 0), 0);
          const totalQty = (issue.items || []).reduce((n, i) => n + (i.qty || 0), 0);
          return (
            <div key={issue.id} style={styles.card}>
              <div style={styles.top} onClick={() => setExpanded(isOpen ? null : issue.id)} role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(isOpen ? null : issue.id); } }}>
                <div style={styles.main}>
                  <div style={styles.codeRow}>
                    <span style={styles.code}>{issue.issueCode}</span>
                    <span style={{ ...styles.badge, background: meta.bg, color: meta.color }}>{meta.label}</span>
                    {issue.centerName && !centerId && <span style={styles.center}>{issue.centerName}</span>}
                  </div>
                  <div style={styles.who}>{issue.takenBy}</div>
                  <div style={styles.meta}>
                    {[issue.programName, issue.reason, issue.instituteName].filter(Boolean).join(' · ') || 'No reason recorded'}
                  </div>
                </div>
                <div style={styles.right}>
                  <div style={styles.date}>{formatDateTime(issue.issuedAt)}</div>
                  <div style={styles.count}>{(issue.items || []).length} item(s) · {totalQty} unit(s){outstanding ? ` · ${outstanding} out` : ''}</div>
                  <div style={styles.chevron}>{isOpen ? '▲' : '▼'}</div>
                </div>
              </div>

              {isOpen && (
                <div style={styles.body}>
                  <div style={styles.details}>
                    <Detail label="Issued by" value={issue.issuedBy} />
                    <Detail label="Issued at" value={formatDateTime(issue.issuedAt)} />
                    <Detail label="Program" value={issue.programName || '—'} />
                    <Detail label="Returned at" value={issue.returnedAt ? formatDateTime(issue.returnedAt) : '—'} />
                    {(issue.studentCount != null || issue.teamCount != null) && (
                      <Detail label="Session" value={[issue.studentCount != null && `${issue.studentCount} students`, issue.teamCount != null && `${issue.teamCount} teams`].filter(Boolean).join(' · ')} />
                    )}
                  </div>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Component</th>
                        <th style={styles.th}>Qty</th>
                        <th style={styles.th}>Back good</th>
                        <th style={styles.th}>Damaged</th>
                        <th style={styles.th}>Still out</th>
                        <th style={styles.th}>Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(issue.items || []).map(item => (
                        <tr key={item.id}>
                          <td style={styles.td}>{item.name}</td>
                          <td style={styles.td}>{item.qty}</td>
                          <td style={styles.td}>{item.returnedGoodQty}</td>
                          <td style={{ ...styles.td, color: item.returnedDamagedQty ? '#c62828' : undefined }}>{item.returnedDamagedQty}</td>
                          <td style={{ ...styles.td, fontWeight: item.outstandingQty ? 700 : 400 }}>{item.outstandingQty}</td>
                          <td style={{ ...styles.td, fontFamily: "'DM Mono', Consolas, monospace", fontSize: '11.5px' }}>
                            {(item.assets || []).map(a => (
                              <span key={a.id} style={{ ...styles.unit, ...(a.status === 'issued' ? styles.unitOut : a.status === 'damaged' ? styles.unitDamaged : {}) }} title={a.status}>
                                {a.assetTag}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {outstanding > 0 && (
                    <div style={styles.actions}>
                      <button type="button" style={styles.returnBtn} onClick={() => setReturning(issue)}>Record return</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {returning && (
        <InternalReturnDialog issueId={returning.id} onClose={() => setReturning(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div style={styles.detail}>
      <span style={styles.dl}>{label}</span>
      <span>{value || '—'}</span>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('en-IN');
}

const styles = {
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' },
  chips: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  chip: { padding: '6px 12px', borderRadius: '999px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#374151', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  chipActive: { background: '#2d2a6e', borderColor: '#2d2a6e', color: '#fff' },
  hint: { fontSize: '12px', color: '#6b7280' },
  info: { background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', marginBottom: '12px', fontWeight: 600 },
  error: { background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', marginBottom: '12px', fontWeight: 600 },
  empty: { background: '#fff', borderRadius: '14px', padding: '40px', textAlign: 'center', color: '#6b7280' },
  list: { display: 'flex', flexDirection: 'column', gap: '12px' },
  card: { background: '#fff', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  top: { display: 'flex', justifyContent: 'space-between', padding: '16px 20px', gap: '12px', flexWrap: 'wrap', cursor: 'pointer' },
  main: { minWidth: 0 },
  codeRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' },
  code: { fontWeight: 700, fontSize: '13px', color: '#1a237e' },
  badge: { padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 },
  center: { fontSize: '11px', color: '#6b7280', fontWeight: 600 },
  who: { fontWeight: 700, fontSize: '15px', color: '#1a1a2e' },
  meta: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  right: { textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' },
  date: { fontSize: '12px', color: '#6b7280' },
  count: { fontSize: '12px', color: '#374151', fontWeight: 600 },
  chevron: { fontSize: '14px', color: '#6b7280' },
  body: { borderTop: '1px solid #f0f2f8', padding: '14px 20px 18px' },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' },
  detail: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13px' },
  dl: { fontSize: '10px', fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.4px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #eef1f7', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f3f9', verticalAlign: 'top' },
  unit: { display: 'inline-block', padding: '2px 7px', borderRadius: '6px', background: '#f1f3f9', color: '#374151', marginRight: '4px', marginBottom: '4px' },
  unitOut: { background: '#fff3e0', color: '#e65100' },
  unitDamaged: { background: '#fce4ec', color: '#c62828' },
  actions: { display: 'flex', justifyContent: 'flex-end', marginTop: '12px' },
  returnBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '9px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
};
