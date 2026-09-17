import React, { useCallback, useState } from 'react';
import QrScanner from './QrScanner';
import QrIcon from './QrIcon';
import { extractTagFromScan } from '../utils/scan';

// A row per physical asset tag with a 3-way toggle (not returned / good /
// damaged), used wherever a return is being recorded (Orders, Internal Use).
// Replaces bare quantity inputs -- the admin picks exactly which tag came
// back in which condition, instead of the backend guessing which of the
// "first N issued" units to mark damaged.
//
// Scanning: the scanner stays open for the whole return. Each scanned label
// shows up inside the scanner window with Good / Damaged buttons; the admin
// chooses, and the next unit can be scanned straight away. A scan never sets
// a condition by itself.
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
  const [scanned, setScanned] = useState(null);   // asset just scanned, awaiting a choice
  const [scanNote, setScanNote] = useState('');
  const [doneCount, setDoneCount] = useState(0);

  const handleScan = useCallback(text => {
    const tag = extractTagFromScan(text);
    const hit = assets.find(a => String(a.assetTag).toUpperCase() === tag);
    if (!hit) {
      setScanNote(`"${tag}" is not one of this order's units.`);
      setScanned(null);
      return;
    }
    setScanNote('');
    setScanned(hit);
  }, [assets]);

  function choose(value) {
    if (!scanned) return;
    onChange(scanned.id, value);
    setDoneCount(n => n + 1);
    setScanNote(`${scanned.assetTag} → ${OPTIONS.find(o => o.value === value)?.label}. Scan the next unit.`);
    setScanned(null);
  }

  if (!assets.length) {
    return <div style={styles.empty}>No assigned units found for this item -- contact an admin before recording this return.</div>;
  }

  const decided = assets.filter(a => a.condition && a.condition !== 'skip').length;

  return (
    <div style={styles.list}>
      <div style={styles.scanRow}>
        <span style={styles.progress}>{decided} of {assets.length} unit{assets.length === 1 ? '' : 's'} recorded</span>
        <button type="button" style={styles.scanBtn} onClick={() => { setScanNote(''); setScanned(null); setScanning(true); }}>
          <QrIcon size={15} /> Scan QR code
        </button>
      </div>

      {scanning && (
        <QrScanner
          title="Scan returned units"
          hint={`Scan each unit as it comes back. ${assets.length - decided} still to record.`}
          paused={!!scanned}
          onScan={handleScan}
          onClose={() => setScanning(false)}
        >
          {scanned ? (
            <div style={styles.scanCard}>
              <div style={styles.scanCardTitle}>Scanned</div>
              <div style={styles.scanCardTag}>{scanned.assetTag}{scanned.serialNumber ? ` · SN ${scanned.serialNumber}` : ''}</div>
              <div style={styles.scanCardQuestion}>How did it come back?</div>
              <div style={styles.scanChoices}>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceGood }} onClick={() => choose('good')}>Good</button>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceDamaged }} onClick={() => choose('damaged')}>Damaged</button>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceSkip }} onClick={() => setScanned(null)}>Skip</button>
              </div>
            </div>
          ) : (
            <div style={styles.scanStatus}>
              {scanNote || (doneCount ? `${doneCount} recorded so far. Scan the next unit.` : 'Waiting for a label…')}
            </div>
          )}
        </QrScanner>
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
  scanRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', paddingBottom: '6px' },
  progress: { fontSize: '11px', color: '#6b7280', fontWeight: 600 },
  scanBtn: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2d2a6e', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  scanCard: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(249,168,37,0.6)', borderRadius: '12px', padding: '12px 14px' },
  scanCardTitle: { fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f9a825', fontWeight: 800 },
  scanCardTag: { fontFamily: "'DM Mono', Consolas, monospace", fontSize: '15px', fontWeight: 700, margin: '4px 0 8px' },
  scanCardQuestion: { fontSize: '13px', color: 'rgba(255,255,255,0.8)', marginBottom: '8px' },
  scanChoices: { display: 'flex', gap: '8px' },
  choiceBtn: { flex: 1, border: '2px solid', borderRadius: '10px', padding: '11px 8px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  choiceGood: { background: '#2e7d32', borderColor: '#2e7d32', color: '#fff' },
  choiceDamaged: { background: '#c62828', borderColor: '#c62828', color: '#fff' },
  choiceSkip: { background: 'transparent', borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.8)', flex: '0 0 auto' },
  scanStatus: { fontSize: '13px', color: 'rgba(255,255,255,0.75)', textAlign: 'center', padding: '6px 0' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '5px 0', borderBottom: '1px solid #f0f2f8', flexWrap: 'wrap' },
  tag: { fontSize: '12px', fontFamily: "'DM Mono', 'Consolas', monospace", color: '#334155', fontWeight: 600 },
  options: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  optBtn: { border: '1px solid #e2e8f0', background: '#fff', color: '#6b7280', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' },
  empty: { fontSize: '12px', color: '#c2410c', fontWeight: 600, padding: '6px 0' },
};
