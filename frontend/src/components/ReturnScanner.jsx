import React, { useCallback, useState } from 'react';
import QrScanner from './QrScanner';
import QrIcon from './QrIcon';
import { extractTagFromScan } from '../utils/scan';

// One scanner for a whole return (a student order or an internal-use
// record). The admin taps Scan once, then for every unit that comes back:
// scan → the label is matched against every component in the return → pick
// Good / Damaged → the scanner is immediately ready for the next unit. The
// scanner window shows numbered per-component progress so it is obvious what
// is still outstanding. A scan never sets a condition on its own.
//
//   groups: [{ id, name, assets: [{ id, assetTag, serialNumber, condition }] }]
//   onChange(groupId, assetId, 'good' | 'damaged')
export default function ReturnScanner({ groups, onChange, title = 'Scan returned units', buttonLabel = 'Scan QR code', style }) {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(null);   // { group, asset } awaiting a choice
  const [note, setNote] = useState('');
  const [doneCount, setDoneCount] = useState(0);

  const totalUnits = groups.reduce((n, g) => n + g.assets.length, 0);
  const decided = groups.reduce((n, g) => n + g.assets.filter(a => a.condition && a.condition !== 'skip').length, 0);

  const handleScan = useCallback(text => {
    const tag = extractTagFromScan(text);
    for (const group of groups) {
      const asset = group.assets.find(a => String(a.assetTag).toUpperCase() === tag);
      if (asset) {
        setNote('');
        setScanned({ group, asset });
        return;
      }
    }
    setNote(`"${tag}" is not one of the units in this return.`);
    setScanned(null);
  }, [groups]);

  function choose(value) {
    if (!scanned) return;
    onChange(scanned.group.id, scanned.asset.id, value);
    setDoneCount(n => n + 1);
    setNote(`${scanned.asset.assetTag} → ${value === 'good' ? 'Good' : 'Damaged'}. Scan the next unit.`);
    setScanned(null);
  }

  if (!totalUnits) return null;

  return (
    <div style={{ ...styles.wrap, ...style }}>
      <span style={styles.progress}>{decided} of {totalUnits} unit{totalUnits === 1 ? '' : 's'} recorded</span>
      <button type="button" style={styles.scanBtn} onClick={() => { setNote(''); setScanned(null); setScanning(true); }}>
        <QrIcon size={15} /> {buttonLabel}
      </button>

      {scanning && (
        <QrScanner
          title={title}
          hint={`Scan each unit as it comes back. ${totalUnits - decided} still to record.`}
          paused={!!scanned}
          onScan={handleScan}
          onClose={() => setScanning(false)}
          doneLabel="Done"
          onDone={() => setScanning(false)}
        >
          {scanned ? (
            <div style={styles.scanCard}>
              <div style={styles.scanCardTitle}>Scanned · {scanned.group.name}</div>
              <div style={styles.scanCardTag}>{scanned.asset.assetTag}{scanned.asset.serialNumber ? ` · SN ${scanned.asset.serialNumber}` : ''}</div>
              {scanned.asset.condition && scanned.asset.condition !== 'skip' && (
                <div style={styles.scanCardWarn}>Already recorded as {scanned.asset.condition}. Choosing again overwrites it.</div>
              )}
              <div style={styles.scanCardQuestion}>How did it come back?</div>
              <div style={styles.scanChoices}>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceGood }} onClick={() => choose('good')}>Good</button>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceDamaged }} onClick={() => choose('damaged')}>Damaged</button>
                <button type="button" style={{ ...styles.choiceBtn, ...styles.choiceSkip }} onClick={() => setScanned(null)}>Skip</button>
              </div>
            </div>
          ) : (
            <div style={styles.scanStatus}>
              {note || (doneCount ? `${doneCount} recorded so far. Scan the next unit.` : 'Waiting for a label…')}
            </div>
          )}
          <ol style={styles.progressList}>
            {groups.map((g, i) => {
              const done = g.assets.filter(a => a.condition && a.condition !== 'skip').length;
              return (
                <li key={g.id} style={styles.progressRow}>
                  <span style={styles.progressIndex}>{i + 1}</span>
                  <span style={styles.progressName}>{g.name}</span>
                  <span style={{ ...styles.progressCount, ...(done === g.assets.length ? styles.progressDone : {}) }}>{done}/{g.assets.length}</span>
                </li>
              );
            })}
          </ol>
        </QrScanner>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' },
  progress: { fontSize: '12px', color: '#6b7280', fontWeight: 600 },
  scanBtn: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2d2a6e', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 13px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  scanCard: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(249,168,37,0.6)', borderRadius: '12px', padding: '12px 14px' },
  scanCardTitle: { fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f9a825', fontWeight: 800 },
  scanCardTag: { fontFamily: "'DM Mono', Consolas, monospace", fontSize: '15px', fontWeight: 700, margin: '4px 0 8px' },
  scanCardWarn: { fontSize: '12px', color: '#fbbf24', marginBottom: '6px' },
  scanCardQuestion: { fontSize: '13px', color: 'rgba(255,255,255,0.8)', marginBottom: '8px' },
  scanChoices: { display: 'flex', gap: '8px' },
  choiceBtn: { flex: 1, border: '2px solid', borderRadius: '10px', padding: '11px 8px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  choiceGood: { background: '#2e7d32', borderColor: '#2e7d32', color: '#fff' },
  choiceDamaged: { background: '#c62828', borderColor: '#c62828', color: '#fff' },
  choiceSkip: { background: 'transparent', borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.8)', flex: '0 0 auto' },
  scanStatus: { fontSize: '13px', color: 'rgba(255,255,255,0.75)', textAlign: 'center', padding: '6px 0' },
  progressList: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  progressRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'rgba(255,255,255,0.85)' },
  progressIndex: { width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  progressCount: { fontFamily: "'DM Mono', Consolas, monospace", fontWeight: 700 },
  progressDone: { color: '#81c784' },
};
