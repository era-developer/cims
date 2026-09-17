import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import QrScanner from './QrScanner';

// Navbar "Scan": point the phone at any unit's label and see what it is,
// its status, and who has it -- then jump to the order or the inventory row.

const STATUS_LABEL = {
  available: ['Available', '#2e7d32', '#e8f5e9'],
  reserved: ['Reserved', '#ef6c00', '#fff3e0'],
  issued: ['Issued', '#1565c0', '#e3f2fd'],
  return_requested: ['Return requested', '#b45309', '#fffbeb'],
  under_repair: ['Under repair', '#6a1b9a', '#f3e5f5'],
  damaged: ['Damaged', '#c62828', '#fce4ec'],
  disposed: ['Disposed', '#6b7280', '#f3f4f6'],
};

export default function ScanLookup({ onClose }) {
  const navigate = useNavigate();
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleScan = useCallback(async tag => {
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.get(`/api/assets/by-tag/${encodeURIComponent(tag)}`);
      setAsset(data);
    } catch (err) {
      setError(err?.response?.data?.message || `Could not look up "${tag}"`);
    } finally {
      setBusy(false);
    }
  }, []);

  function go(path) {
    onClose();
    navigate(path);
  }

  if (!asset) {
    return (
      <>
        <QrScanner onScan={handleScan} onClose={onClose} />
        {(error || busy) && (
          <div style={styles.toast}>{busy ? 'Looking up...' : error}</div>
        )}
      </>
    );
  }

  const [label, color, bg] = STATUS_LABEL[asset.status] || [asset.status, '#374151', '#f3f4f6'];
  const holder = asset.holder;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.card} onClick={e => e.stopPropagation()}>
        <div style={styles.top}>
          {asset.catalog_image && <img src={asset.catalog_image} alt="" style={styles.photo} />}
          <div style={{ minWidth: 0 }}>
            <div style={styles.name}>{asset.name}</div>
            <div style={styles.tag}>{asset.asset_tag}</div>
            <span style={{ ...styles.pill, color, background: bg }}>{label}</span>
          </div>
        </div>

        <div style={styles.facts}>
          <Fact label="Classification" value={asset.classification_name} />
          <Fact label="Center" value={asset.center_name} />
          {asset.serial_number && <Fact label="Serial no." value={asset.serial_number} />}
          {asset.location && <Fact label="Location" value={asset.location} />}
          {asset.has_warranty ? <Fact label="Warranty until" value={asset.warranty_until || '-'} /> : null}
          {asset.lastEvent && (
            <Fact label="Last event" value={`${asset.lastEvent.event_type} → ${asset.lastEvent.to_status || ''} · ${String(asset.lastEvent.occurred_at).slice(0, 16)}${asset.lastEvent.performed_by ? ` · ${asset.lastEvent.performed_by}` : ''}`} />
          )}
        </div>

        {holder && (
          <div style={styles.holder}>
            <div style={styles.holderTitle}>Currently with</div>
            <div><strong>{holder.student_name || holder.student_username || 'a student'}</strong> · order {holder.order_id}</div>
            <div style={styles.holderMeta}>{holder.status}{holder.expected_return_date ? ` · due ${holder.expected_return_date}` : ''}</div>
          </div>
        )}

        <div style={styles.actions}>
          {holder && (
            <button type="button" style={styles.primaryBtn} onClick={() => go(`/admin/orders?q=${encodeURIComponent(holder.order_id)}`)}>
              Open order {holder.order_id}
            </button>
          )}
          <button type="button" style={holder ? styles.secondaryBtn : styles.primaryBtn} onClick={() => go(`/admin/inventory?q=${encodeURIComponent(asset.name)}`)}>
            Open in Inventory
          </button>
          <button type="button" style={styles.secondaryBtn} onClick={() => { setAsset(null); setError(''); }}>
            Scan another
          </button>
          <button type="button" style={styles.linkBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div style={styles.fact}>
      <span style={styles.factLabel}>{label}</span>
      <span style={styles.factValue}>{value || '-'}</span>
    </div>
  );
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(16,37,72,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' },
  card: { background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '18px', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 30px 80px rgba(0,0,0,0.35)' },
  top: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px' },
  photo: { width: '72px', height: '72px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #e5e7eb', flexShrink: 0 },
  name: { fontSize: '17px', fontWeight: 800, color: '#1a1a2e', lineHeight: 1.2 },
  tag: { fontFamily: "'DM Mono', Consolas, monospace", fontSize: '13px', color: '#334155', margin: '4px 0 6px' },
  pill: { display: 'inline-block', fontSize: '11px', fontWeight: 800, padding: '3px 9px', borderRadius: '999px' },
  facts: { display: 'grid', gap: '6px', marginBottom: '12px' },
  fact: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px', borderBottom: '1px solid #f1f3f9', padding: '4px 0' },
  factLabel: { color: '#6b7280' },
  factValue: { color: '#1a1a2e', fontWeight: 600, textAlign: 'right' },
  holder: { background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', marginBottom: '12px' },
  holderTitle: { fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#3730a3', fontWeight: 800, marginBottom: '3px' },
  holderMeta: { fontSize: '12px', color: '#4b5563', marginTop: '2px' },
  actions: { display: 'flex', flexDirection: 'column', gap: '8px' },
  primaryBtn: { background: '#2d2a6e', color: '#fff', border: 'none', padding: '11px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  secondaryBtn: { background: '#f1f3f9', color: '#1a1a2e', border: '1px solid #d7dde9', padding: '11px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  linkBtn: { background: 'none', border: 'none', color: '#6b7280', padding: '6px', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" },
  toast: { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', background: '#111629', color: '#fecaca', padding: '10px 16px', borderRadius: '10px', fontSize: '13px', zIndex: 2100, maxWidth: '90vw', textAlign: 'center' },
};
