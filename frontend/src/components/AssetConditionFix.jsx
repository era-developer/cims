import React, { useState } from 'react';
import axios from 'axios';

// Lets an admin correct an already-resolved asset's status (available <->
// damaged) right where its tag is shown -- Orders, Internal Use -- without
// navigating to Inventory. For the real scenario this exists for: a unit
// gets marked damaged/lost when a return was processed, but the student
// later actually brings it back in good condition (or the mark was simply
// a mistake). Only shown once a unit is past mid-flow (available/damaged),
// not for reserved/issued units, which have their own flows.
export default function AssetConditionFix({ asset, onFixed }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!['available', 'damaged'].includes(asset.status)) return null;
  const targetStatus = asset.status === 'damaged' ? 'available' : 'damaged';
  const targetLabel = targetStatus === 'available' ? 'Available' : 'Damaged/Consumed';

  async function submit() {
    if (!reason.trim()) {
      setError('A reason is required for this correction.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.put(`/api/assets/${asset.id}/status`, { toStatus: targetStatus, notes: reason.trim() });
      setOpen(false);
      setReason('');
      onFixed?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update this unit.');
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    setOpen(false);
    setReason('');
    setError('');
  }

  return (
    <span style={styles.wrap}>
      <button type="button" style={styles.btn} onClick={() => setOpen(true)}>Fix Status</button>
      {open && (
        <div style={styles.overlay} onClick={close}>
          <div style={styles.panel} onClick={e => e.stopPropagation()}>
            <div style={styles.title}>{asset.assetTag}</div>
            <p style={styles.hint}>
              Currently marked "{asset.status === 'damaged' ? 'Damaged/Consumed' : 'Available'}". Use this only to
              correct a mistake -- e.g. it was marked damaged but the student actually returned it in good condition,
              or it was marked back wrongly.
            </p>
            <input
              style={styles.input}
              placeholder="Reason for this correction"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.actions}>
              <button type="button" style={styles.cancelBtn} onClick={close}>Cancel</button>
              <button
                type="button"
                style={{ ...styles.confirmBtn, opacity: submitting ? 0.7 : 1 }}
                onClick={submit}
                disabled={submitting}>
                {submitting ? 'Saving...' : `Confirm: Mark ${targetLabel}`}
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
  btn: { background: 'none', border: '1px solid #fbbf24', color: '#92400e', borderRadius: '6px', padding: '1px 7px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px' },
  panel: { background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 800, color: '#1a1a2e', marginBottom: '6px' },
  hint: { fontSize: '12px', color: '#64748b', marginBottom: '12px', lineHeight: 1.5 },
  input: { width: '100%', padding: '9px 10px', border: '1.5px solid #dbe3f0', borderRadius: '8px', fontSize: '13px', marginBottom: '10px', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' },
  error: { color: '#c62828', fontSize: '12px', marginBottom: '10px', fontWeight: 600 },
  actions: { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
  cancelBtn: { background: '#f0f2f8', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151' },
  confirmBtn: { background: 'linear-gradient(135deg, #92400e, #b45309)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
};
