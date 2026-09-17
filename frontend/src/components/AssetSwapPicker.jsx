import React, { useState } from 'react';
import axios from 'axios';
import QrScanner from './QrScanner';

// Small "Swap" action shown next to a system-assigned asset tag, used by
// Orders, Internal Use, and Transfers wherever a specific unit is displayed.
// If the physical unit can't actually be found, this lets an admin pick a
// different available unit of the same component instead of being stuck.
// The three flows validate the swap differently server-side (whether the
// original status is expected to be "issued/reserved" vs "available"), so
// this component only needs a catalogId + the endpoint to PUT to.
export default function AssetSwapPicker({ asset, catalogId, swapUrl, onSwapped }) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newAssetId, setNewAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  // Scanning the label of the unit actually in hand selects it -- no need to
  // read a tag off a shelf and find it in the dropdown.
  function handleScan(tag) {
    const hit = candidates.find(c => String(c.assetTag).toUpperCase() === String(tag).toUpperCase());
    if (!hit) {
      setError(`"${tag}" is not an available unit of this component.`);
      return;
    }
    setNewAssetId(String(hit.id));
    setError('');
    setScanning(false);
  }

  async function openPicker() {
    setOpen(true);
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.get('/api/assets/swap-candidates', {
        params: { catalogId, excludeAssetId: asset.id },
      });
      setCandidates(data);
      setNewAssetId(data[0]?.id ? String(data[0].id) : '');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load other available units.');
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setCandidates([]);
    setNewAssetId('');
    setReason('');
    setError('');
  }

  async function confirmSwap() {
    if (!newAssetId) return;
    if (!reason.trim()) {
      setError('A reason is required (e.g. "not found on shelf").');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.put(swapUrl, { oldAssetId: asset.id, newAssetId, reason: reason.trim() });
      close();
      onSwapped?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to swap this unit.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span style={styles.wrap}>
      <button type="button" style={styles.swapBtn} onClick={openPicker}>Swap</button>
      {open && (
        <div style={styles.overlay} onClick={close}>
          <div style={styles.panel} onClick={e => e.stopPropagation()}>
            <div style={styles.title}>Not found: {asset.assetTag}</div>
            <p style={styles.hint}>
              Pick a different available unit of the same component to use instead.
              The original unit is marked back to Available (it may just be misplaced —
              if it's really lost, use Dispose separately).
            </p>
            {loading ? (
              <div style={styles.hint}>Loading available units...</div>
            ) : candidates.length === 0 ? (
              <div style={styles.hint}>No other available units of this component right now.</div>
            ) : (
              <div style={styles.pickRow}>
                <select style={{ ...styles.select, flex: 1 }} value={newAssetId} onChange={e => setNewAssetId(e.target.value)}>
                  {candidates.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.assetTag}{c.serialNumber ? ` (SN: ${c.serialNumber})` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" style={styles.scanBtn} onClick={() => setScanning(true)}>Scan</button>
              </div>
            )}
            <input
              style={styles.input}
              placeholder="Reason (e.g. not found on shelf)"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            {error && <div style={styles.error}>{error}</div>}
            {scanning && (
              <QrScanner title="Scan replacement unit" hint="Scan the label of the unit you are issuing instead." onScan={handleScan} onClose={() => setScanning(false)} />
            )}
            <div style={styles.actions}>
              <button type="button" style={styles.cancelBtn} onClick={close}>Cancel</button>
              <button
                type="button"
                style={{ ...styles.confirmBtn, opacity: submitting || !candidates.length ? 0.7 : 1 }}
                onClick={confirmSwap}
                disabled={submitting || !candidates.length}>
                Confirm Swap
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

const styles = {
  wrap: { display: 'inline-block', marginLeft: '6px' },
  swapBtn: {
    background: 'none', border: '1px solid #c7d2fe', color: '#1a237e', borderRadius: '6px',
    padding: '1px 7px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px',
  },
  panel: { background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 800, color: '#1a1a2e', marginBottom: '6px' },
  hint: { fontSize: '12px', color: '#64748b', marginBottom: '12px', lineHeight: 1.5 },
  pickRow: { display: 'flex', gap: '8px', alignItems: 'flex-start' },
  scanBtn: { background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '8px', padding: '9px 12px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' },
  select: { width: '100%', padding: '9px 10px', border: '1.5px solid #dbe3f0', borderRadius: '8px', fontSize: '13px', marginBottom: '10px', fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' },
  input: { width: '100%', padding: '9px 10px', border: '1.5px solid #dbe3f0', borderRadius: '8px', fontSize: '13px', marginBottom: '10px', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' },
  error: { color: '#c62828', fontSize: '12px', marginBottom: '10px', fontWeight: 600 },
  actions: { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
  cancelBtn: { background: '#f0f2f8', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151' },
  confirmBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
};
