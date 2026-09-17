import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import BackBar from '../components/BackBar';

// Org-wide numbers for the super admin. Styled inline like every other page
// -- this file used to carry Tailwind class names, which the project has
// never had, so it rendered as unstyled text.

const TILES = [
  { key: 'totalUsers', label: 'Users', tone: '#1565c0', bg: '#e3f2fd' },
  { key: 'totalOrders', label: 'Orders', tone: '#2e7d32', bg: '#e8f5e9' },
  { key: 'totalInventory', label: 'Catalog line items', tone: '#b45309', bg: '#fff7ed' },
  { key: 'totalDamagedUnits', label: 'Damaged / consumed units', tone: '#c62828', bg: '#fce4ec' },
  { key: 'totalDamagedComponents', label: 'Components with damage', tone: '#ef6c00', bg: '#fff3e0' },
];

export default function AdminAnalytics() {
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    (async () => {
      try {
        const res = await axios.get('/api/admin/analytics');
        setAnalytics(res.data);
      } catch (err) {
        setError(err?.response?.data?.message || 'Unable to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (user?.role !== 'super_admin') {
    return <div style={styles.page}><BackBar to="/admin" label="Back to dashboard" /><div style={styles.card}>Super admin access required.</div></div>;
  }

  const centers = analytics ? Object.values(analytics.centers) : [];
  const chartData = centers.map(center => ({
    name: center.name,
    Users: center.users,
    Orders: center.orders,
    'Line items': center.inventory,
    'Damaged units': center.damagedUnits || 0,
  }));

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <BackBar to="/admin" label="Back to dashboard" />
      <h1 style={styles.title}>Analytics</h1>
      <p style={styles.sub}>Organisation-wide totals across {centers.length || 'all'} center{centers.length === 1 ? '' : 's'}.</p>

      {loading && <div style={styles.card}>Loading…</div>}
      {error && <div style={styles.error}>{error}</div>}

      {analytics && (
        <>
          <div style={styles.tiles}>
            {TILES.map(t => (
              <div key={t.key} style={{ ...styles.tile, background: t.bg }}>
                <div style={{ ...styles.tileValue, color: t.tone }}>{analytics[t.key] || 0}</div>
                <div style={styles.tileLabel}>{t.label}</div>
              </div>
            ))}
          </div>

          <div style={styles.card}>
            <h2 style={styles.cardTitle}>By center</h2>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Center</th>
                    <th style={styles.thNum}>Users</th>
                    <th style={styles.thNum}>Orders</th>
                    <th style={styles.thNum}>Line items</th>
                    <th style={styles.thNum}>Damaged units</th>
                    <th style={styles.thNum}>Components with damage</th>
                  </tr>
                </thead>
                <tbody>
                  {centers.map(c => (
                    <tr key={c.name}>
                      <td style={styles.td}><strong>{c.name}</strong></td>
                      <td style={styles.tdNum}>{c.users}</td>
                      <td style={styles.tdNum}>{c.orders}</td>
                      <td style={styles.tdNum}>{c.inventory}</td>
                      <td style={{ ...styles.tdNum, color: c.damagedUnits ? '#c62828' : undefined }}>{c.damagedUnits || 0}</td>
                      <td style={styles.tdNum}>{c.damagedComponents || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {centers.length > 1 && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Comparison</h2>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Users" fill="#1565c0" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Orders" fill="#2e7d32" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Line items" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Damaged units" fill="#c62828" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '22px 24px 60px', fontFamily: "'DM Sans', sans-serif" },
  pageMobile: { padding: '14px 14px 40px' },
  title: { fontSize: '26px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
  sub: { color: '#6b7280', fontSize: '14px', margin: '6px 0 18px' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' },
  tile: { borderRadius: '14px', padding: '16px 18px' },
  tileValue: { fontSize: '28px', fontWeight: 800, lineHeight: 1.1 },
  tileLabel: { fontSize: '12px', color: '#374151', fontWeight: 600, marginTop: '6px' },
  card: { background: '#fff', borderRadius: '14px', border: '1px solid #e3e8f2', padding: '20px', marginBottom: '18px', boxShadow: '0 1px 3px rgba(16,37,72,0.04)' },
  cardTitle: { fontSize: '16px', fontWeight: 800, color: '#1a1a2e', margin: '0 0 12px' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #eef1f7', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  thNum: { textAlign: 'right', padding: '10px 12px', borderBottom: '2px solid #eef1f7', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '11px 12px', borderBottom: '1px solid #f1f3f9', color: '#1a1a2e' },
  tdNum: { padding: '11px 12px', borderBottom: '1px solid #f1f3f9', textAlign: 'right', fontWeight: 600, color: '#1a1a2e', fontVariantNumeric: 'tabular-nums' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '11px 14px', borderRadius: '10px' },
};
