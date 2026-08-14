import React from 'react';

// A row per physical asset tag with a 3-way toggle (not returned / good /
// damaged), used wherever a return is being recorded (Orders, Internal Use).
// Replaces bare quantity inputs -- the admin picks exactly which tag came
// back in which condition, instead of the backend guessing which of the
// "first N issued" units to mark damaged.
const OPTIONS = [
  { value: 'skip', label: 'Not returned' },
  { value: 'good', label: 'Good' },
  { value: 'damaged', label: 'Damaged' },
];

const ACTIVE_STYLE = {
  skip: { background: '#f1f5f9', borderColor: '#cbd5e1', color: '#475569' },
  good: { background: '#e8f5e9', borderColor: '#2e7d32', color: '#2e7d32' },
  damaged: { background: '#fce4ec', borderColor: '#c62828', color: '#c62828' },
};

export default function AssetConditionPicker({ assets, onChange }) {
  if (!assets.length) {
    return <div style={styles.empty}>No assigned units found for this item -- contact an admin before recording this return.</div>;
  }

  return (
    <div style={styles.list}>
      {assets.map(asset => (
        <div key={asset.id} style={styles.row}>
          <span style={styles.tag}>
            {asset.assetTag}{asset.serialNumber ? ` (SN: ${asset.serialNumber})` : ''}
          </span>
          <div style={styles.options}>
            {OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(asset.id, opt.value)}
                style={{
                  ...styles.optBtn,
                  ...((asset.condition || 'skip') === opt.value ? ACTIVE_STYLE[opt.value] : {}),
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  list: { display: 'flex', flexDirection: 'column', gap: '4px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '5px 0', borderBottom: '1px solid #f0f2f8', flexWrap: 'wrap' },
  tag: { fontSize: '12px', fontFamily: "'DM Mono', 'Consolas', monospace", color: '#334155', fontWeight: 600 },
  options: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  optBtn: { border: '1px solid #e2e8f0', background: '#fff', color: '#6b7280', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' },
  empty: { fontSize: '12px', color: '#c2410c', fontWeight: 600, padding: '6px 0' },
};
