import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import QrScanner from './QrScanner';
import QrIcon from './QrIcon';
import { extractTagFromScan } from '../utils/scan';

// Approve & Issue: the admin decides, per component, how many units go out
// and exactly WHICH ones -- ticked from the list of available units or
// scanned off the shelf, supermarket-checkout style. Confirm is only
// possible once every component has exactly its quantity selected, so the
// record can never disagree with what left the room.
//
// Props: order { orderId, items:[{id (catalogId), name, qty}] }, onConfirm(payload), onClose, remarks/setRemarks, processing.

export default function IssueUnitsDialog({ order, onConfirm, onClose, remarks, setRemarks, processing, isMobile }) {
  const [lines, setLines] = useState([]);      // [{ catalogId, name, qtyRequested, qty, units:[...], selected:Set }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`/api/orders/${encodeURIComponent(order.orderId)}/issuable-units`);
        if (cancelled) return;
        setLines(data.items.map(item => ({
          catalogId: String(item.catalogId),
          name: item.name,
          qtyRequested: item.qtyRequested,
          qty: item.qtyRequested,
          units: item.units,
          selected: new Set(),
        })));
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Unable to load units for this order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [order.orderId]);

  function update(catalogId, fn) {
    setLines(current => current.map(l => (l.catalogId === catalogId ? fn(l) : l)));
  }

  function setQty(catalogId, raw) {
    update(catalogId, l => {
      const qty = Math.max(0, Math.min(l.qtyRequested, Number(raw) || 0));
      // Shrinking below the selection drops the most recently added units.
      const selected = new Set([...l.selected].slice(0, qty));
      return { ...l, qty, selected };
    });
  }

  function toggleUnit(catalogId, unitId) {
    update(catalogId, l => {
      const selected = new Set(l.selected);
      if (selected.has(unitId)) selected.delete(unitId);
      else if (selected.size < l.qty) selected.add(unitId);
      return { ...l, selected };
    });
  }

  function autoPick(catalogId) {
    update(catalogId, l => {
      const selected = new Set(l.selected);
      for (const u of l.units) { if (selected.size >= l.qty) break; selected.add(u.id); }
      return { ...l, selected };
    });
  }

  function clearLine(catalogId) {
    update(catalogId, l => ({ ...l, selected: new Set() }));
  }

  const handleScan = useCallback(text => {
    const tag = extractTagFromScan(text);
    setLines(current => {
      const line = current.find(l => l.units.some(u => String(u.assetTag).toUpperCase() === tag));
      if (!line) {
        setScanNote(`"${tag}" is not an available unit of anything on this order.`);
        return current;
      }
      const unit = line.units.find(u => String(u.assetTag).toUpperCase() === tag);
      if (line.selected.has(unit.id)) {
        setScanNote(`${unit.assetTag} is already selected.`);
        return current;
      }
      if (line.qty === 0) {
        setScanNote(`${line.name} is set to 0 -- raise its quantity first.`);
        return current;
      }
      if (line.selected.size >= line.qty) {
        setScanNote(`${line.name}: already ${line.qty} of ${line.qty} selected.`);
        return current;
      }
      const selected = new Set(line.selected);
      selected.add(unit.id);
      setScanNote(`${unit.assetTag} → ${line.name} (${selected.size} of ${line.qty}).`);
      return current.map(l => (l === line ? { ...l, selected } : l));
    });
  }, []);

  const progress = useMemo(() => lines.map(l => ({ name: l.name, have: l.selected.size, need: l.qty })), [lines]);
  const allDone = lines.length > 0 && lines.every(l => l.selected.size === l.qty);
  const anyIssuing = lines.some(l => l.qty > 0);
  const missing = lines.filter(l => l.selected.size !== l.qty);

  function confirm() {
    onConfirm({
      approvedItems: lines.map(l => ({ id: l.catalogId, qty: l.qty, assetIds: [...l.selected] })),
    });
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, ...(isMobile ? styles.modalMobile : {}) }} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>Approve &amp; issue — {order.orderId}</h3>
            <p style={styles.sub}>Set how many of each component you are issuing, then pick or scan exactly those units.</p>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading && <div style={styles.muted}>Loading available units…</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={styles.scanBar}>
              <div style={styles.progressWrap}>
                {progress.map(p => (
                  <span key={p.name} style={{ ...styles.progressPill, ...(p.have === p.need ? styles.progressDone : {}) }}>
                    {p.name}: {p.have}/{p.need}
                  </span>
                ))}
              </div>
              <button type="button" style={styles.scanBtn} onClick={() => { setScanNote(''); setScanning(true); }}>
                <QrIcon size={15} /> Scan QR code
              </button>
            </div>

            {scanning && (
              <QrScanner
                title="Scan units to issue"
                hint="Scan each unit as you hand it over."
                onScan={handleScan}
                onClose={() => setScanning(false)}
                doneLabel={allDone ? 'Done — all units selected' : 'Done for now'}
                onDone={() => setScanning(false)}
              >
                <div style={styles.scanNote}>{scanNote || 'Waiting for a label…'}</div>
                <div style={styles.scanList}>
                  {lines.filter(l => l.qty > 0).map((l, i) => {
                    const done = l.selected.size === l.qty;
                    const chosen = l.units.filter(u => l.selected.has(u.id));
                    return (
                      <div key={l.catalogId} style={{ ...styles.scanRow, ...(done ? styles.scanRowDone : {}) }}>
                        <div style={styles.scanRowHead}>
                          <span style={styles.scanRowIndex}>{i + 1}</span>
                          <span style={styles.scanRowName}>{l.name}</span>
                          <span style={{ ...styles.scanRowCount, color: done ? '#86efac' : '#fde68a' }}>{l.selected.size}/{l.qty}</span>
                        </div>
                        <div style={styles.scanRowTags}>
                          {chosen.map(u => <span key={u.id} style={styles.scanTag}>{u.assetTag}</span>)}
                          {Array.from({ length: l.qty - chosen.length }).map((_, k) => <span key={'slot' + k} style={styles.scanSlot}>— scan —</span>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </QrScanner>
            )}

            <div style={styles.lines}>
              {lines.map(line => {
                const done = line.selected.size === line.qty;
                const selectedUnits = line.units.filter(u => line.selected.has(u.id));
                return (
                  <div key={line.catalogId} style={{ ...styles.card, ...(done ? styles.cardDone : {}) }}>
                    <div style={styles.cardHead}>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.cardName}>{line.name}</div>
                        <div style={styles.cardMeta}>Requested {line.qtyRequested} · {line.units.length} unit{line.units.length === 1 ? '' : 's'} available</div>
                      </div>
                      <label style={styles.qtyWrap}>
                        <span style={styles.qtyLabel}>Issuing</span>
                        <input type="number" min="0" max={line.qtyRequested} value={line.qty}
                          onChange={e => setQty(line.catalogId, e.target.value)} style={styles.qtyInput} />
                      </label>
                    </div>

                    {line.qty === 0 ? (
                      <div style={styles.notIssuing}>Not issuing this component.</div>
                    ) : (
                      <>
                        <div style={styles.selectedRow}>
                          <span style={{ ...styles.count, color: done ? '#2e7d32' : '#b45309' }}>
                            {line.selected.size} of {line.qty} selected
                          </span>
                          {selectedUnits.map(u => (
                            <span key={u.id} style={styles.chip}>
                              {u.assetTag}
                              <button type="button" style={styles.chipX} onClick={() => toggleUnit(line.catalogId, u.id)} aria-label={`Remove ${u.assetTag}`}>✕</button>
                            </span>
                          ))}
                        </div>
                        <div style={styles.lineActions}>
                          {!done && (
                            <select
                              style={styles.unitSelect}
                              value=""
                              onChange={e => { if (e.target.value) toggleUnit(line.catalogId, e.target.value); }}
                            >
                              <option value="">Add a unit… ({line.units.length - line.selected.size} available)</option>
                              {line.units.filter(u => !line.selected.has(u.id)).map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.assetTag}{u.reservedForThisOrder ? '  (reserved for this order)' : ''}{u.serialNumber ? `  SN ${u.serialNumber}` : ''}{u.location ? `  · ${u.location}` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                          {!done && <button type="button" style={styles.linkBtn} onClick={() => autoPick(line.catalogId)}>Auto-pick remaining {line.qty - line.selected.size}</button>}
                          {line.selected.size > 0 && <button type="button" style={styles.linkBtnMuted} onClick={() => clearLine(line.catalogId)}>Clear</button>}
                          {line.units.length < line.qty && <span style={styles.warn}>Only {line.units.length} available — lower the quantity.</span>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <input style={styles.remarks} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Approval remarks (optional)" />

            {!allDone && anyIssuing && (
              <div style={styles.hintBar}>
                Still to select: {missing.map(l => `${l.name} (${l.selected.size}/${l.qty})`).join(', ')}
              </div>
            )}

            <div style={styles.actions}>
              <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={processing}>Cancel</button>
              <button
                type="button"
                style={{ ...styles.confirmBtn, opacity: processing || !allDone ? 0.55 : 1, cursor: processing || !allDone ? 'default' : 'pointer' }}
                onClick={confirm}
                disabled={processing || !allDone}
                title={allDone ? '' : 'Select every unit being issued first'}
              >
                {processing ? 'Issuing…' : anyIssuing ? `Confirm & issue ${lines.reduce((n, l) => n + l.qty, 0)} unit(s)` : 'Reject (nothing issued)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(16,37,72,0.55)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' },
  modal: { background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '760px', maxHeight: '94vh', overflowY: 'auto', padding: '20px', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 30px 80px rgba(0,0,0,0.35)' },
  modalMobile: { padding: '14px', borderRadius: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 800, color: '#1a1a2e' },
  sub: { margin: '4px 0 0', fontSize: '13px', color: '#6b7280' },
  closeBtn: { background: '#f1f3f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', color: '#374151', flexShrink: 0 },
  scanBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px', position: 'sticky', top: 0, background: '#fff', paddingBottom: '6px', zIndex: 1 },
  progressWrap: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  progressPill: { fontSize: '11px', fontWeight: 700, padding: '4px 9px', borderRadius: '999px', background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  progressDone: { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' },
  scanBtn: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '7px', background: '#2d2a6e', color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 14px', fontWeight: 800, fontSize: '13px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  scanNote: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: '8px' },
  scanList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  scanRow: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '8px 10px' },
  scanRowDone: { borderColor: 'rgba(134,239,172,0.6)', background: 'rgba(46,125,50,0.18)' },
  scanRowHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  scanRowIndex: { width: '20px', height: '20px', borderRadius: '50%', background: '#f9a825', color: '#102548', fontSize: '11px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scanRowName: { fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  scanRowCount: { fontWeight: 800, fontSize: '14px', fontFamily: "'DM Mono', Consolas, monospace" },
  scanRowTags: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', paddingLeft: '28px' },
  scanTag: { background: 'rgba(134,239,172,0.18)', color: '#bbf7d0', border: '1px solid rgba(134,239,172,0.5)', borderRadius: '999px', padding: '2px 9px', fontSize: '12px', fontWeight: 700, fontFamily: "'DM Mono', Consolas, monospace" },
  scanSlot: { border: '1px dashed rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.4)', borderRadius: '999px', padding: '2px 9px', fontSize: '11px' },
  unitSelect: { padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #d7dde9', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", maxWidth: '100%', background: '#fff' },
  scanStatus: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  scanProgressRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '8px' },
  scanProgressPill: { fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', color: '#fde68a' },
  scanProgressDone: { background: 'rgba(46,125,50,0.35)', color: '#bbf7d0' },
  scanAllDone: { marginTop: '8px', color: '#bbf7d0', fontWeight: 700 },
  lines: { display: 'flex', flexDirection: 'column', gap: '10px' },
  card: { border: '1px solid #e3e8f2', borderRadius: '12px', padding: '12px 14px', background: '#fff' },
  cardDone: { borderColor: '#a7f3d0', background: '#f6fdf9' },
  cardHead: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' },
  cardName: { fontWeight: 800, color: '#1a1a2e', fontSize: '15px' },
  cardMeta: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },
  qtyWrap: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  qtyLabel: { fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' },
  qtyInput: { width: '64px', padding: '8px', borderRadius: '8px', border: '1.5px solid #d7dde9', fontSize: '15px', fontWeight: 700, textAlign: 'center', fontFamily: "'DM Sans', sans-serif" },
  notIssuing: { fontSize: '12px', color: '#9097a6', marginTop: '8px', fontStyle: 'italic' },
  selectedRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '10px' },
  count: { fontSize: '12px', fontWeight: 800, marginRight: '4px' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700, fontFamily: "'DM Mono', Consolas, monospace" },
  chipX: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '11px', padding: 0, lineHeight: 1 },
  lineActions: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' },
  linkBtn: { background: 'none', border: 'none', color: '#2d2a6e', fontWeight: 700, fontSize: '12px', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif" },
  linkBtnMuted: { background: 'none', border: 'none', color: '#6b7280', fontWeight: 600, fontSize: '12px', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif" },
  warn: { fontSize: '12px', color: '#c62828', fontWeight: 600 },
  unitList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '4px', marginTop: '8px', maxHeight: '220px', overflowY: 'auto', padding: '6px', background: '#f8fafc', borderRadius: '8px' },
  unitRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '5px 6px', borderRadius: '6px', cursor: 'pointer' },
  unitTag: { fontFamily: "'DM Mono', Consolas, monospace", fontWeight: 700, color: '#1a1a2e' },
  unitMeta: { color: '#6b7280', fontSize: '11px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  reservedBadge: { background: '#fff3e0', color: '#b45309', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, marginRight: '4px' },
  remarks: { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #d7dde9', fontSize: '13px', marginTop: '12px', boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif" },
  hintBar: { marginTop: '10px', fontSize: '12px', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' },
  cancelBtn: { background: '#f1f3f9', color: '#374151', border: '1px solid #d7dde9', padding: '11px 16px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  confirmBtn: { background: '#2e7d32', color: '#fff', border: 'none', padding: '11px 18px', borderRadius: '10px', fontWeight: 800, fontFamily: "'DM Sans', sans-serif" },
  muted: { fontSize: '13px', color: '#6b7280', padding: '6px 0' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: '10px' },
};
