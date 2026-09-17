import React, { useCallback, useState } from 'react';
import QrScanner from './QrScanner';

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
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  // Scanning a label marks that unit as returned in good condition -- the
  // common case at the counter. Damage is still recorded by tapping
  // "Damaged" on the row. A tag that is not part of this order is refused.
  const handleScan = useCallback(tag => {
    const hit = assets.find(a => String(a.assetTag).toUpperCase() === String(tag).toUpperCase());
    if (!hit) {
      setScanMsg(`"${tag}" is not one of this order's units.`);
      return;
    }
    onChange(hit.id, 'good');
    setScanMsg(`${hit.assetTag} marked Good.`);
  }, [assets, onChange]);

  if (!assets.length) {
    return <div style={styles.empty}>No assigned units found for this item -- contact an admin before recording this return.</div>;
  }

  return (
    <div style={styles.list}>
      <div style={styles.scanRow}>
        <button type="button" style={styles.scanBtn} onClick={() => { setScanMsg(''); setScanning(true); }}>Scan returned unit</button>
        {scanMsg && <span style={styles.scanMsg}>{scanMsg}</span>}
      </div>
      {scanning && (
        <QrScanner
          title="Scan returned unit"
          hint="Each scanned label is marked Good. Close when done; use the row buttons for damaged units."
          onScan={handleScan}
          onClose={() => setScanning(false)}
        />
      )}
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
  scanRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingBottom: '4px' },
  scanBtn: { background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '8px', padding: '5px 12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' },
  scanMsg: { fontSize: '11px', color: '#334155', fontWeight: 600 },
  empty: { fontSize: '12px', color: '#c2410c', fontWeight: 600, padding: '6px 0' },
};
