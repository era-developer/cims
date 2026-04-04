import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import SmartImage from '../components/SmartImage';
import useViewport from '../hooks/useViewport';

const EMPTY_FORM = { name: '', category: '', description: '', stock: '', totalProcured: '', unit: 'pcs', location: '', image: '', active: true };

export default function AdminInventory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useViewport();
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState([]);

  function updateNameSuggestions(name) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      setNameSuggestions([]);
      return;
    }
    const matches = items
      .filter(item => item.name && item.name.toLowerCase().includes(normalized) && item.name.toLowerCase() !== normalized)
      .slice(0, 5)
      .map(item => item.name);
    setNameSuggestions(matches);
  }


  useEffect(() => {
    fetchItems();
    const timer = setInterval(fetchItems, 10000);
    const handleFocus = () => fetchItems();
    const handleVisibility = () => {
      if (!document.hidden) fetchItems();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    const query = search.toLowerCase();
    setFiltered(query
      ? items.filter(item =>
          item.name?.toLowerCase().includes(query) ||
          item.category?.toLowerCase().includes(query) ||
          item.location?.toLowerCase().includes(query))
      : items);
  }, [search, items]);

  async function fetchItems() {
    try {
      const { data } = await axios.get('/api/components');
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSearchChange(value) {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setMsg('');
    setNameSuggestions([]);
    setModal('add');
  }

  function openEdit(item) {
    setForm({
      name: item.name,
      category: item.category,
      description: item.description,
      stock: item.stock,
      totalProcured: item.totalProcured,
      unit: item.unit,
      location: item.location,
      image: item.image || '',
      active: item.active !== false,
    });
    setEditId(item.id);
    setMsg('');
    setNameSuggestions([]);
    setModal('edit');
  }

  async function handleSave() {
    if (!form.name || !form.category || form.stock === '') {
      setMsg('Name, category and stock are required.');
      return;
    }

    const normalizedName = form.name.trim().toLowerCase();
    if (modal === 'add' && items.some(item => item.name?.toLowerCase() === normalizedName)) {
      setMsg('Component name already exists. Please choose a unique name or edit existing component.');
      return;
    }

    setSaving(true);
    setMsg('');
    try {
      if (modal === 'add') {
        await axios.post('/api/components', {
          ...form,
          stock: Number(form.stock),
          totalProcured: Number(form.stock),
        });
      } else {
        await axios.put(`/api/components/${editId}`, {
          ...form,
          stock: Number(form.stock),
          totalProcured: Number(form.totalProcured),
        });
      }
      setNameSuggestions([]);
      await fetchItems();
      setModal(null);
    } catch (err) {
      setMsg(err.response?.data?.message || 'Error saving component.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/components/${id}`);
      await fetchItems();
    } catch {
      alert('Error deleting component.');
    }
  }

  async function quickUpdateStock(id, delta) {
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    const newStock = Math.max(0, item.stock + delta);
    try {
      await axios.put(`/api/components/${id}`, {
        stock: newStock,
        totalProcured: delta > 0 ? item.totalProcured + delta : item.totalProcured,
      });
      await fetchItems();
    } catch {
      // keep current UI state on failure
    }
  }

  function handleImageUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(current => ({ ...current, image: reader.result }));
    reader.readAsDataURL(file);
  }

  const totalDamaged = items.reduce((sum, item) => sum + (item.damagedCount || 0), 0);

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Inventory Management</h1>
            <p style={styles.sub}>{items.length} components · {items.filter(item => item.stock < 5).length} low stock · {totalDamaged} damaged total</p>
          </div>
          <button style={{ ...styles.addBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={openAdd}>+ Add New Component</button>
        </div>

        <div style={{ ...styles.toolbar, ...(isMobile ? styles.toolbarStack : {}) }}>
          <input
            style={{ ...styles.search, ...(isMobile ? styles.searchMobile : {}) }}
            placeholder="Search components..."
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
          />
          <div style={styles.legend}>
            <span style={styles.dot('#2e7d32')} /> Good
            <span style={styles.dot('#f57f17')} /> Low
            <span style={styles.dot('#c62828')} /> Out
          </div>
        </div>

        {loading ? (
          <div style={styles.loading}>Loading inventory...</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={styles.th}>Component</th>
                  <th style={styles.th}>Photo</th>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Location</th>
                  <th style={styles.th}>Stock</th>
                  <th style={styles.th}>Procured</th>
                  <th style={styles.th}>Issued</th>
                  <th style={styles.th}>Damaged</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const stockColor = item.stock > 10 ? '#2e7d32' : item.stock > 0 ? '#f57f17' : '#c62828';
                  const stockBg = item.stock > 10 ? '#e8f5e9' : item.stock > 0 ? '#fff9c4' : '#fce4ec';
                  return (
                    <tr key={item.id} style={{ ...styles.tr, background: index % 2 === 0 ? '#fff' : '#fafbff' }}>
                      <td style={styles.td}>
                        <div style={styles.compName}>{item.name}</div>
                        <div style={styles.compDesc}>{item.description?.substring(0, 60) || 'No description'}...</div>
                      </td>
                      <td style={styles.td}>
                        {item.image
                          ? (
                            <SmartImage
                              src={item.image}
                              alt={item.name}
                              style={styles.thumb}
                              fallback={<div style={styles.thumbPlaceholder}>No photo</div>}
                            />
                          )
                          : <div style={styles.thumbPlaceholder}>No photo</div>}
                      </td>
                      <td style={styles.td}><span style={styles.catTag}>{item.category}</span></td>
                      <td style={{ ...styles.td, color: '#6b7280', fontSize: '13px' }}>{item.location}</td>
                      <td style={styles.td}>
                        <div style={styles.stockCtrl}>
                          <button style={styles.sBtn} onClick={() => quickUpdateStock(item.id, -1)}>-</button>
                          <span style={{ ...styles.stockNum, color: stockColor, background: stockBg }}>{item.stock}</span>
                          <button style={styles.sBtn} onClick={() => quickUpdateStock(item.id, 1)}>+</button>
                        </div>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700, color: '#1a237e' }}>{item.totalProcured}</td>
                      <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700, color: '#e65100' }}>{item.totalIssued || 0}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.damageBadge, ...(item.damagedCount ? styles.damageBadgeWarn : styles.damageBadgeOk) }}>
                          {item.damagedCount || 0}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: item.active ? '#e8f5e9' : '#f5f5f5', color: item.active ? '#2e7d32' : '#9e9e9e' }}>
                          {item.active ? 'Active' : 'Hidden'}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          <button style={styles.editBtn} onClick={() => openEdit(item)}>Edit</button>
                          <button style={styles.delBtn} onClick={() => handleDelete(item.id, item.name)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div style={styles.overlay} onClick={() => setModal(null)}>
          <div style={{ ...styles.modal, ...(isMobile ? styles.modalMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{modal === 'add' ? 'Add New Component' : 'Edit Component'}</h3>
              <button style={styles.closeBtn} onClick={() => setModal(null)}>X</button>
            </div>
            {msg && <div style={styles.msgBox}>{msg}</div>}
            <div style={{ ...styles.modalGrid, ...(isMobile ? styles.modalGridSingle : {}) }}>
              <FField
                label="Component Name *"
                value={form.name}
                onChange={value => {
                  setForm(current => ({ ...current, name: value }));
                  updateNameSuggestions(value);
                }}
                placeholder="e.g. Arduino Uno R3"
                fullWidth
              />
              {nameSuggestions.length > 0 && (
                <div style={styles.suggestions}>
                  <span style={styles.suggestionsLabel}>Similar names found:</span>
                  {nameSuggestions.map((suggestion, i) => (
                    <button
                      key={`${suggestion}-${i}`}
                      type="button"
                      style={styles.suggestionBtn}
                      onClick={() => {
                        setForm(current => ({ ...current, name: suggestion }));
                        setNameSuggestions([]);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <FField label="Category *" value={form.category} onChange={value => setForm(current => ({ ...current, category: value }))} placeholder="e.g. Microcontroller" />
              <FField label="Unit" value={form.unit} onChange={value => setForm(current => ({ ...current, unit: value }))} placeholder="pcs / kits / packs" />
              <FField label="Location / Bin *" value={form.location} onChange={value => setForm(current => ({ ...current, location: value }))} placeholder="e.g. Bin-A1" />
              <FField label={modal === 'add' ? 'Initial Stock *' : 'Current Stock *'} value={form.stock} onChange={value => setForm(current => ({ ...current, stock: value }))} type="number" placeholder="0" />
              {modal === 'edit' && (
                <FField
                  label="Total Procured Qty"
                  value={form.totalProcured}
                  onChange={value => setForm(current => ({ ...current, totalProcured: value }))}
                  type="number"
                  placeholder="0"
                />
              )}
              <FField label="Description" value={form.description} onChange={value => setForm(current => ({ ...current, description: value }))} placeholder="Brief component description..." textarea fullWidth />
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={styles.uploadLabel}>Component Photo</label>
                <div style={styles.uploadRow}>
                  <label style={styles.uploadBtn}>
                    Upload Photo
                    <input type="file" accept="image/*" style={styles.hiddenInput} onChange={event => handleImageUpload(event.target.files?.[0])} />
                  </label>
                  {form.image && <button type="button" style={styles.removeImageBtn} onClick={() => setForm(current => ({ ...current, image: '' }))}>Remove Photo</button>}
                </div>
                {form.image
                  ? (
                    <SmartImage
                      src={form.image}
                      alt="Preview"
                      style={styles.previewImage}
                      fallback={<div style={styles.previewPlaceholder}>No photo selected</div>}
                    />
                  )
                  : <div style={styles.previewPlaceholder}>No photo selected</div>}
              </div>
            </div>
            <div style={{ ...styles.modalFooter, ...(isMobile ? styles.modalFooterStack : {}) }}>
              <label style={styles.activeToggle}>
                <input type="checkbox" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))} />
                <span style={{ marginLeft: '6px' }}>Visible to students</span>
              </label>
              <div style={{ ...styles.modalActions, ...(isMobile ? styles.modalActionsStack : {}) }}>
                <button style={{ ...styles.cancelBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => setModal(null)}>Cancel</button>
                <button style={{ ...styles.saveBtn, ...(isMobile ? styles.fullWidthBtn : {}), opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : modal === 'add' ? 'Add Component' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FField({ label, value, onChange, placeholder, textarea, fullWidth, type }) {
  const base = {
    width: '100%',
    padding: '9px 13px',
    border: '1.5px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    resize: 'vertical',
  };

  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>{label}</label>
      {textarea
        ? <textarea style={{ ...base, minHeight: '70px' }} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
        : <input style={base} type={type || 'text'} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1400px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px' },
  addBtn: { background: 'linear-gradient(135deg, #ff6d00, #ff9a3c)', color: '#fff', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  toolbarStack: { alignItems: 'stretch' },
  fullWidthBtn: { width: '100%' },
  search: { flex: 1, minWidth: '260px', padding: '11px 16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
  searchMobile: { minWidth: 0 },
  legend: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#6b7280' },
  dot: color => ({ width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block', marginRight: '3px' }),
  loading: { padding: '60px', textAlign: 'center', color: '#6b7280' },
  tableWrap: { background: '#fff', borderRadius: '14px', overflowX: 'auto', overflowY: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  table: { width: '100%', minWidth: '1080px', borderCollapse: 'collapse' },
  thead: { background: '#1a237e' },
  th: { padding: '12px 14px', color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'left' },
  tr: { borderBottom: '1px solid #f0f2f8' },
  td: { padding: '12px 14px', fontSize: '13px', color: '#374151', verticalAlign: 'middle' },
  compName: { fontWeight: 600, color: '#1a1a2e', fontSize: '14px' },
  compDesc: { color: '#6b7280', fontSize: '11px', marginTop: '2px' },
  suggestions: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '8px', padding: '8px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' },
  suggestionsLabel: { fontSize: '12px', color: '#283046', fontWeight: 600, marginRight: '8px' },
  suggestionBtn: { background: '#eef2ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '999px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' },
  thumb: { width: '56px', height: '56px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0' },
  thumbPlaceholder: { width: '56px', height: '56px', borderRadius: '10px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#94a3b8', textAlign: 'center', padding: '4px' },
  catTag: { background: '#e8eaf6', color: '#1a237e', padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 },
  stockCtrl: { display: 'flex', alignItems: 'center', gap: '6px' },
  sBtn: { background: '#f0f2f8', border: 'none', borderRadius: '6px', width: '24px', height: '24px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: '#1a237e' },
  stockNum: { padding: '2px 10px', borderRadius: '10px', fontWeight: 800, fontSize: '14px', fontFamily: "'DM Sans', sans-serif" },
  damageBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  damageBadgeWarn: { background: '#fce4ec', color: '#c62828' },
  damageBadgeOk: { background: '#f1f5f9', color: '#64748b' },
  badge: { padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 },
  actions: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  editBtn: { background: '#e8eaf6', color: '#1a237e', border: 'none', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  delBtn: { background: '#fce4ec', color: '#c62828', border: 'none', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '20px' },
  modal: { background: '#fff', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '560px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalMobile: { padding: '22px 18px' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  modalTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '17px', fontWeight: 700, color: '#1a1a2e' },
  closeBtn: { background: '#f0f2f8', border: 'none', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b7280' },
  msgBox: { background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
  modalGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' },
  modalGridSingle: { gridTemplateColumns: '1fr' },
  uploadLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' },
  uploadRow: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' },
  uploadBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#e8eef8', color: '#17355f', borderRadius: '9px', padding: '9px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  hiddenInput: { display: 'none' },
  removeImageBtn: { background: '#fce4ec', color: '#c62828', border: 'none', borderRadius: '9px', padding: '9px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  previewImage: { width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '14px', border: '1px solid #e2e8f0' },
  previewPlaceholder: { border: '1px dashed #cbd5e1', borderRadius: '14px', padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  modalFooterStack: { alignItems: 'stretch' },
  activeToggle: { display: 'flex', alignItems: 'center', fontSize: '13px', color: '#374151', cursor: 'pointer' },
  modalActions: { display: 'flex', gap: '10px' },
  modalActionsStack: { width: '100%', flexDirection: 'column' },
  cancelBtn: { background: '#f0f2f8', border: 'none', padding: '9px 18px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151' },
  saveBtn: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 },
};
