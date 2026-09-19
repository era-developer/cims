import React, { useEffect, useState } from 'react';
import axios from 'axios';
import AssetConditionPicker from './AssetConditionPicker';
import AssetSwapPicker from './AssetSwapPicker';
import ReturnScanner from './ReturnScanner';
import useViewport from '../hooks/useViewport';

// Record a return against an internal-use record: one scanner for the whole
// record (scan → Good/Damaged → next), plus the per-unit toggles for manual
// entry. Shared by Inventory (the "Return Internal Use" list) and Orders
// (the Internal use tab), so both places behave identically.
//
//   issueId: the internal_issues id to load
//   onClose(): dismiss without saving
//   onSaved(issue): a return was recorded (the dialog closes itself)
export default function InternalReturnDialog({ issueId, onClose, onSaved }) {
  const { isMobile } = useViewport();
  const [issue, setIssue] = useState(null);
  const [form, setForm] = useState({});         // itemId -> [{ ...asset, condition }]
  const [damageReason, setDamageReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    axios.get(`/api/internal-issues/${issueId}`)
      .then(({ data }) => { if (alive) load(data); })
      .catch(err => { if (alive) setError(err.response?.data?.message || 'Unable to load this record.'); });
    return () => { alive = false; };
  }, [issueId]);

  function load(data) {
    setIssue(data);
    const initial = {};
    data.items.forEach(item => {
      const issued = Array.isArray(item.assets) ? item.assets.filter(a => a.status === 'issued') : [];
      initial[item.id] = issued.map(a => ({ ...a, condition: 'skip' }));
    });
    setForm(initial);
  }

  function setCondition(itemId, assetId, condition) {
    setForm(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || []).map(a => (a.id === assetId ? { ...a, condition } : a)),
    }));
  }

  async function refresh() {
    try {
      const { data } = await axios.get(`/api/internal-issues/${issueId}`);
      // A swap changes which asset ids exist -- rebuild from the fresh list.
      load(data);
    } catch { /* swap already succeeded server-side */ }
  }

  async function submit() {
    setError('');
    const items = Object.entries(form)
      .map(([itemId, assets]) => ({
        itemId: Number(itemId),
        returnedAssetIds: assets.filter(a => a.condition === 'good').map(a => a.id),
        damagedAssetIds: assets.filter(a => a.condition === 'damaged').map(a => a.id),
      }))
      .filter(e => e.returnedAssetIds.length || e.damagedAssetIds.length);
    if (!items.length) { setError('Select the condition for at least one returned unit.'); return; }
    if (items.some(e => e.damagedAssetIds.length) && !damageReason.trim()) {
      setError('Enter a reason for the unit(s) being returned damaged.');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/api/internal-issues/${issueId}/return`, { items, damageReason: damageReason.trim() });
      const { data } = await axios.get(`/api/internal-issues/${issueId}`).catch(() => ({ data: issue }));
      onSaved?.(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to record the return.');
    } finally {
      setSaving(false);
    }
  }

  const outstanding = issue ? issue.items.filter(item => item.outstandingQty > 0) : [];
  const groups = outstanding.map(item => ({ id: item.id, name: item.name, assets: form[item.id] || [] }));
  const anyDamaged = Object.values(form).some(assets => assets.some(a => a.condition === 'damaged'));

  return (
    <div style={styles.overlay} onClick={() => !saving && onClose()}>
      <div style={{ ...styles.drawer, ...(isMobile ? styles.drawerMobile : {}) }} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>{issue ? issue.issueCode : 'Internal use'}</h3>
            {issue && <p style={styles.sub}>Taken by {issue.takenBy}{issue.programName ? ` · ${issue.programName}` : ''}{issue.reason ? ` -- ${issue.reason}` : ''}</p>}
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} disabled={saving} aria-label="Close">X</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {!issue && !error && <div style={styles.loading}>Loading…</div>}

        {issue && !outstanding.length && <p style={styles.sub}>Nothing outstanding on this record -- everything is back.</p>}

        {issue && outstanding.length > 0 && (
          <>
            <p style={styles.hint}>Scan each unit as it comes back and pick its condition, or use the buttons per unit. Leave a unit as "Not returned" if it is still out.</p>
            <ReturnScanner groups={groups} onChange={setCondition} style={{ marginBottom: '12px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {outstanding.map(item => (
                <div key={item.id} style={styles.itemCard}>
                  <div style={styles.itemTitle}>{item.name} -- {item.outstandingQty} outstanding</div>
                  {item.assets.filter(a => a.status === 'issued').length > 0 && (
                    <div style={styles.swapRow}>
                      Not the right physical unit?{' '}
                      {item.assets.filter(a => a.status === 'issued').map(a => (
                        <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', marginRight: '10px' }}>
                          {a.assetTag}{a.serialNumber ? ` (SN: ${a.serialNumber})` : ''}
                          <AssetSwapPicker
                            asset={a}
                            catalogId={item.catalogId}
                            swapUrl={`/api/internal-issues/${issue.id}/items/${item.id}/swap-asset`}
                            onSwapped={refresh}
                          />
                        </span>
                      ))}
                    </div>
                  )}
                  <AssetConditionPicker assets={form[item.id] || []} onChange={(assetId, condition) => setCondition(item.id, assetId, condition)} />
                </div>
              ))}
            </div>
            {anyDamaged && (
              <label style={styles.field}>
                <span style={styles.label}>Reason for the damaged unit(s) (required)</span>
                <input style={styles.input} value={damageReason} onChange={e => setDamageReason(e.target.value)} placeholder="What happened to it?" />
              </label>
            )}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" style={styles.primary} disabled={saving} onClick={submit}>{saving ? 'Saving...' : 'Record Return'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 300, padding: '20px', overflowY: 'auto' },
  drawer: { background: '#fff', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '620px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '20px 0', fontFamily: "'DM Sans', sans-serif" },
  drawerMobile: { padding: '22px 18px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px', gap: '16px' },
  title: { fontSize: '17px', fontWeight: 700, color: '#1a1a2e', margin: 0 },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px' },
  hint: { color: '#6b7280', fontSize: '12.5px', margin: '0 0 10px' },
  closeBtn: { background: '#f0f2f8', border: 'none', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b7280', flexShrink: 0 },
  error: { padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px', fontWeight: 600, background: '#fce4ec', color: '#c62828' },
  loading: { padding: '30px', textAlign: 'center', color: '#6b7280' },
  itemCard: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' },
  itemTitle: { fontWeight: 700, fontSize: '13px', marginBottom: '4px' },
  swapRow: { fontSize: '11px', color: '#64748b', marginBottom: '10px' },
  field: { display: 'block', marginTop: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px' },
  input: { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1.5px solid #dbe3f0', fontSize: '13px', fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' },
  primary: { background: 'linear-gradient(135deg, #ff6d00, #ff9a3c)', color: '#fff', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', fontFamily: 'inherit' },
  secondary: { background: '#e8eaf6', color: '#1a237e', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', fontFamily: 'inherit' },
};
