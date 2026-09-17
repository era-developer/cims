import React, { useCallback, useEffect, useRef, useState } from 'react';
import QrScanner from './QrScanner';
import { extractTagFromScan } from '../utils/scan';

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
  // The unit just scanned: its row is highlighted and scrolled into view,
  // and the admin picks Good / Damaged by hand. Scanning never decides the
  // condition -- it only finds the row.
  const [focusedId, setFocusedId] = useState(null);
  const rowRefs = useRef({});

  const handleScan = useCallback(text => {
    const tag = extractTagFromScan(text);
    const hit = assets.find(a => String(a.assetTag).toUpperCase() === tag);
    if (!hit) {
      setScanMsg(`"${tag}" is not one of this order's units.`);
      return;
    }
    setFocusedId(hit.id);
    setScanning(false);
    setScanMsg(`${hit.assetTag} found -- choose its condition below.`);
  }, [assets]);

  useEffect(() => {
    if (focusedId && rowRefs.current[focusedId]) {
      rowRefs.current[focusedId].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusedId]);

  if (!assets.length) {
    return <div style={styles.empty}>No assigned units found for this item -- contact an admin before recording this return.</div>;
  }

  return (
    <div style={styles.list}>
      <div style={styles.scanRow}>
        <button type="button" style={styles.scanBtn} onClick={() => { setScanMsg(''); setScanning(true); }}>Scan a returned unit</button>
        {scanMsg && <span style={styles.scanMsg}>{scanMsg}</span>}
      </div>
      {scanning && (
        <QrScanner
          title="Scan a returned unit"
          hint="Scanning finds the unit's row; you then choose Good or Damaged for it."
          onScan={handleScan}
          onClose={() => setScanning(false)}
        />
      )}
      {assets.map(asset => (
        <div
          key={asset.id}
          ref={el => { rowRefs.current[asset.id] = el; }}
          style={{ ...styles.row, ...(focusedId === asset.id ? styles.rowFocused : {}) }}
        >
          <span style={styles.tag}>
            {focusedId === asset.id && <span style={styles.scannedBadge}>scanned</span>}
            {asset.assetTag}{asset.serialNumber ? ` (SN: ${asset.serialNumber})` : ''}
          </span>
          <div style={styles.options}>
            {OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(asset.id, opt.value); if (focusedId === asset.id) setFocusedId(null); }}
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
  rowFocused: { background: '#fffbeb', outline: '2px solid #f59e0b', outlineOffset: '-2px', borderRadius: '8px', padding: '5px 8px' },
  scannedBadge: { background: '#f59e0b', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '2px 6px', borderRadius: '999px', marginRight: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' },
  scanRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingBottom: '4px' },
  scanBtn: { background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '8px', padding: '5px 12px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' },
  scanMsg: { fontSize: '11px', color: '#334155', fontWeight: 600 },
  empty: { fontSize: '12px', color: '#c2410c', fontWeight: 600, padding: '6px 0' },
};
