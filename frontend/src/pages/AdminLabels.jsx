import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { useAuth } from '../context/AuthContext';
import { APP_SHORT_NAME } from '../brand';
import { unitLabelUrl } from '../utils/scan';
import BackBar from '../components/BackBar';

// Printable sheet of QR labels for physical units.
//
// Opened from Inventory ("Print QR labels" on a component) with
// ?catalogId=..&centerId=.., or with ?assetIds=1,2,3 for specific units. Each
// label carries the QR (encoding the asset tag only -- what the scanner
// expects), the tag in text, and the component name. Sized for 38 x 21 mm
// labels; the browser's print dialog handles paper and scaling.

// The QR encodes a link (~60 chars), so it needs a little more area than a
// bare tag would; the tag text is the one thing that must never be cut off,
// so it gets its own, smaller monospace size and is allowed to wrap.
// Label stock, smallest first. `qr` is the code's printed side in mm -- the
// thing that decides whether a phone can read it. A ~47-character unit URL is
// a 33x33-module QR at error level M, so 11 mm is about 0.33 mm per module:
// readable close up, and the floor for these presets. On the two smallest the
// component name and org line are dropped and the padding tightened, because
// only the QR and the asset tag actually fit; `stack` puts the tag under the
// code instead of beside it.
const SIZES = {
  micro: { w: 20, h: 20, qr: 14, font: 3.8, tagFont: 3.8, cols: 8, pad: 0.8, gap: 0.5, stack: true, showName: false, showOrg: false, label: '20 × 20 mm — QR + tag (8 per row)' },
  tiny: { w: 25, h: 15, qr: 11.5, font: 4.6, tagFont: 4.6, cols: 7, pad: 1, gap: 1.2, showName: false, showOrg: false, label: '25 × 15 mm — QR + tag (7 per row)' },
  small: { w: 38, h: 21, qr: 16, font: 6, tagFont: 5.2, cols: 5, label: '38 × 21 mm (5 per row)' },
  medium: { w: 50, h: 30, qr: 22, font: 7.5, tagFont: 6.8, cols: 4, label: '50 × 30 mm (4 per row)' },
  large: { w: 70, h: 40, qr: 30, font: 10, tagFont: 9, cols: 3, label: '70 × 40 mm (3 per row)' },
};

export default function AdminLabels() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [size, setSize] = useState('medium');
  const [statusFilter, setStatusFilter] = useState('all');
  // Units whose invoice line was marked "no QR labels" (bulk consumables) are
  // hidden until asked for, so a reel of resistors does not swamp the list.
  const [includeBulk, setIncludeBulk] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    async function load() {
      try {
        const catalogId = params.get('catalogId');
        const invoiceId = params.get('invoiceId');
        const assetIds = params.get('assetIds');
        const centerId = params.get('centerId') || user?.centerId || '';
        let rows = [];
        if (catalogId) {
          const { data } = await axios.get('/api/assets', { params: { catalogId, centerId } });
          rows = data;
        } else if (invoiceId) {
          // Every unit created by one invoice -- the "new stock just arrived" case.
          const { data } = await axios.get('/api/assets', { params: { invoiceId, centerId } });
          rows = data;
        } else if (assetIds) {
          const ids = assetIds.split(',').map(s => s.trim()).filter(Boolean);
          rows = (await Promise.all(ids.map(id => axios.get(`/api/assets/${id}`).then(r => r.data).catch(() => null)))).filter(Boolean);
        }
        rows.sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag), undefined, { numeric: true }));
        setAssets(rows);
        setSelected(new Set(rows.filter(r => r.status !== 'disposed' && r.needs_label !== 0).map(r => r.id)));
      } catch (err) {
        setError(err?.response?.data?.message || 'Unable to load units');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params, user]);

  const bulkCount = useMemo(() => assets.filter(a => a.needs_label === 0).length, [assets]);
  const visible = useMemo(
    () => assets.filter(a => (statusFilter === 'all' || a.status === statusFilter) && (includeBulk || a.needs_label !== 0)),
    [assets, statusFilter, includeBulk]
  );
  const toPrint = visible.filter(a => selected.has(a.id));
  const s = SIZES[size];
  const invoiceNumber = assets[0]?.invoice_number || '';
  const distinctNames = [...new Set(assets.map(a => a.name))];
  const componentName = params.get('invoiceId')
    ? `invoice ${invoiceNumber || params.get('invoiceId')} (${distinctNames.length} component${distinctNames.length === 1 ? '' : 's'})`
    : (assets[0]?.name || '');

  function toggle(id) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const backTo = params.get('invoiceId') ? '/admin/invoices' : '/admin/inventory';
  const backLabel = params.get('invoiceId') ? 'Back to invoices' : 'Back to inventory';
  if (loading) return <div style={styles.page}><BackBar to={backTo} label={backLabel} />Loading units...</div>;
  if (error) return <div style={styles.page}><BackBar to={backTo} label={backLabel} /><div style={styles.error}>{error}</div></div>;

  return (
    <div style={styles.page}>
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .label-sheet { gap: 0 !important; padding: 0 !important; }
          .label { break-inside: avoid; page-break-inside: avoid; border: 1px dashed #bbb !important; }
          nav { display: none !important; }
        }
      `}</style>

      <div className="no-print"><BackBar to={backTo} label={backLabel} /></div>
      <div className="no-print" style={styles.toolbar}>
        <div>
          <h1 style={styles.title}>QR labels{componentName ? ` — ${componentName}` : ''}</h1>
          <p style={styles.sub}>{toPrint.length} of {assets.length} units selected. Each QR is a link to the unit's page in {APP_SHORT_NAME} — any phone camera opens it; staff and students see what their role allows.</p>
          <p style={styles.sub}>
            Small components? The 20 × 20 and 25 × 15 mm labels carry the QR and asset tag only.
            Print a test sheet at 100% scale (no "fit to page") and scan one before doing a whole batch.
          </p>
        </div>
        <div style={styles.controls}>
          <label style={styles.control}>
            Label size
            <select style={styles.select} value={size} onChange={e => setSize(e.target.value)}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label style={styles.control}>
            Status
            <select style={styles.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All (except disposed by default)</option>
              <option value="available">Available</option>
              <option value="issued">Issued</option>
              <option value="reserved">Reserved</option>
              <option value="under_repair">Under repair</option>
              <option value="damaged">Damaged</option>
            </select>
          </label>
          {bulkCount > 0 && (
            <label style={{ ...styles.control, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={includeBulk} onChange={e => setIncludeBulk(e.target.checked)} />
              Include {bulkCount} bulk unit{bulkCount === 1 ? '' : 's'} (no labels by default)
            </label>
          )}
          <button type="button" style={styles.secondaryBtn} onClick={() => setSelected(new Set(visible.map(a => a.id)))}>Select all</button>
          <button type="button" style={styles.secondaryBtn} onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" style={styles.primaryBtn} onClick={() => window.print()} disabled={!toPrint.length}>Print {toPrint.length} label{toPrint.length === 1 ? '' : 's'}</button>
        </div>
      </div>

      <div className="no-print" style={styles.pickList}>
        {visible.map(a => (
          <label key={a.id} style={{ ...styles.pick, opacity: selected.has(a.id) ? 1 : 0.5 }}>
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
            <span style={styles.pickTag}>{a.asset_tag}</span>
            {params.get('invoiceId') && <span style={styles.pickStatus}>{a.name}</span>}
            <span style={styles.pickStatus}>{a.status.replace('_', ' ')}</span>
          </label>
        ))}
        {!visible.length && <div style={styles.sub}>No units match.</div>}
      </div>

      <div className="label-sheet" style={{ ...styles.sheet, gridTemplateColumns: `repeat(${s.cols}, ${s.w}mm)` }}>
        {toPrint.map(a => (
          <div
            key={a.id}
            className="label"
            style={{
              ...styles.label,
              width: `${s.w}mm`,
              height: `${s.h}mm`,
              padding: `${s.pad ?? 1.5}mm`,
              gap: `${s.gap ?? 2}mm`,
              flexDirection: s.stack ? 'column' : 'row',
              justifyContent: s.stack ? 'center' : 'flex-start',
            }}
          >
            <div style={{ width: `${s.qr}mm`, height: `${s.qr}mm`, flexShrink: 0 }}>
              <QRCode value={unitLabelUrl(a.asset_tag)} size={256} style={{ width: '100%', height: '100%' }} level="M" />
            </div>
            <div style={{ ...styles.labelText, fontSize: `${s.font}pt`, ...(s.stack ? styles.labelTextStacked : {}) }}>
              <div style={{ ...styles.labelTag, fontSize: `${s.tagFont}pt` }}>{a.asset_tag}</div>
              {s.showName !== false && <div style={styles.labelName}>{a.name}</div>}
              {s.showOrg !== false && (
                <div style={styles.labelOrg}>{APP_SHORT_NAME}{a.serial_number ? ` · SN ${a.serial_number}` : ''}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '22px 20px 60px', fontFamily: "'DM Sans', sans-serif" },
  toolbar: { display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' },
  title: { fontSize: '22px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
  sub: { color: '#6b7280', fontSize: '13px', margin: '4px 0 0' },
  controls: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' },
  control: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#374151' },
  select: { padding: '8px 10px', borderRadius: '8px', border: '1px solid #d7dde9', fontSize: '13px', fontFamily: "'DM Sans', sans-serif" },
  primaryBtn: { background: '#2d2a6e', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  secondaryBtn: { background: '#f1f3f9', color: '#1a1a2e', border: '1px solid #d7dde9', padding: '10px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  pickList: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' },
  pick: { display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #e3e8f2', borderRadius: '8px', padding: '5px 9px', fontSize: '12px', cursor: 'pointer' },
  pickTag: { fontFamily: "'DM Mono', Consolas, monospace", fontWeight: 700, color: '#1a1a2e' },
  pickStatus: { color: '#6b7280', fontSize: '11px' },
  sheet: { display: 'grid', gap: '3mm', padding: '6mm', background: '#fff', border: '1px solid #e3e8f2', borderRadius: '12px', justifyContent: 'start' },
  label: { display: 'flex', alignItems: 'center', gap: '2mm', padding: '1.5mm', border: '1px dashed #cbd5e1', borderRadius: '1.5mm', boxSizing: 'border-box', overflow: 'hidden', background: '#fff' },
  labelText: { display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25, color: '#111' },
  labelTextStacked: { alignItems: 'center', textAlign: 'center', width: '100%' },
  labelTag: { fontFamily: "'DM Mono', Consolas, monospace", fontWeight: 800, wordBreak: 'break-all', lineHeight: 1.15, letterSpacing: '-0.01em' },
  labelName: { fontWeight: 600, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  labelOrg: { color: '#555', fontSize: '0.85em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '11px 14px', borderRadius: '10px' },
};
