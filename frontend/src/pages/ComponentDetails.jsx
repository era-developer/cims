import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import SmartImage from '../components/SmartImage';
import useViewport from '../hooks/useViewport';

const CATEGORY_ICONS = {
  Microcontroller: 'MCU',
  'Single Board Computer': 'SBC',
  Sensors: 'SNS',
  Actuators: 'ACT',
  'Motor Drivers': 'DRV',
  Display: 'DSP',
  'Passive Components': 'PSC',
  'Input Devices': 'INP',
  'Cables & Power': 'PWR',
  Prototyping: 'PRT',
  default: 'CMP',
};

export default function ComponentDetails() {
  const { id } = useParams();
  const { isMobile } = useViewport();
  const navigate = useNavigate();
  const { addToCart, cart, totalItems, updateQty } = useCart();

  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [desiredQty, setDesiredQty] = useState(1);

  useEffect(() => {
    fetchComponents();
  }, [id]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [id]);

  useEffect(() => {
    setDesiredQty(1);
  }, [id]);

  async function fetchComponents() {
    try {
      const { data } = await axios.get('/api/components');
      setComponents(data);
    } catch {
      setComponents([]);
    } finally {
      setLoading(false);
    }
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 2200);
  }

  function handleAddToCart(component, qty = 1) {
    addToCart(component, qty);
    showToast(`${qty} ${component.unit || 'item'} added for ${component.name}.`);
  }

  const component = components.find(item => item.id === id);
  const inCart = component ? cart.find(item => item.id === component.id) : null;

  function changeMainQuantity(delta) {
    if (!component) return;

    if (inCart) {
      const nextQty = Math.max(0, Math.min(inCart.qty + delta, component.stock));
      updateQty(component.id, nextQty);
      if (nextQty > 0) {
        showToast(`${component.name} cart quantity updated to ${nextQty}.`);
      } else {
        showToast(`${component.name} removed from cart.`);
      }
      return;
    }

    setDesiredQty(current => Math.max(1, Math.min(current + delta, component.stock || 1)));
  }

  const similarItems = component
    ? [
        ...components
          .filter(item => item.id !== component.id && item.category === component.category)
          .sort((a, b) => (b.stock || 0) - (a.stock || 0) || String(a.name).localeCompare(String(b.name))),
        ...components
          .filter(item => item.id !== component.id && item.category !== component.category)
          .sort((a, b) => (b.stock || 0) - (a.stock || 0) || String(a.name).localeCompare(String(b.name))),
      ].slice(0, 4)
    : [];

  if (loading) {
    return <div style={styles.loading}>Loading component details...</div>;
  }

  if (!component) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.notFound}>
            <div style={styles.notFoundLabel}>Item Not Found</div>
            <h1 style={styles.notFoundTitle}>This component is no longer available.</h1>
            <p style={styles.notFoundText}>It may have been removed or hidden from the student catalog.</p>
            <button style={styles.primaryBtn} onClick={() => navigate('/dashboard')}>Back to Browse</button>
          </div>
        </div>
      </div>
    );
  }

  const stockColor = component.stock > 10 ? '#2e7d32' : component.stock > 0 ? '#ef6c00' : '#c62828';
  const stockBg = component.stock > 10 ? '#e8f5e9' : component.stock > 0 ? '#fff3e0' : '#fce4ec';
  const stockLabel = component.stock > 10 ? 'Ready to issue' : component.stock > 0 ? 'Limited stock' : 'Currently unavailable';
  const displayedQty = inCart ? inCart.qty : desiredQty;

  return (
    <div style={styles.page}>
      {toast && <div style={{ ...styles.toast, ...(isMobile ? styles.toastMobile : {}) }}>{toast}</div>}

      <div style={styles.container}>
        <div style={{ ...styles.topBar, ...(isMobile ? styles.topBarMobile : {}) }}>
          <button style={{ ...styles.backBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/dashboard')}>Back to Browse</button>
          <button style={{ ...styles.cartBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/cart')}>Cart ({totalItems})</button>
        </div>

        <div style={styles.heroCard}>
          <div style={{ ...styles.mediaPanel, ...(isMobile ? styles.mediaPanelMobile : {}) }}>
            {component.image ? (
              <SmartImage
                src={component.image}
                alt={component.name}
                style={styles.heroImage}
                fallback={
                  <div style={styles.heroPlaceholder}>
                    <div style={styles.heroBadge}>{CATEGORY_ICONS[component.category] || CATEGORY_ICONS.default}</div>
                  </div>
                }
              />
            ) : (
              <div style={styles.heroPlaceholder}>
                <div style={styles.heroBadge}>{CATEGORY_ICONS[component.category] || CATEGORY_ICONS.default}</div>
              </div>
            )}
          </div>

          <div style={styles.infoPanel}>
            <div style={styles.breadcrumb}>Components / {component.category || 'General'}</div>
            <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>{component.name}</h1>
            <p style={styles.subtitle}>
              {component.description || 'Component information will appear here once added by the admin.'}
            </p>

            <div style={styles.metaWrap}>
              <span style={styles.metaChip}>{component.category || 'General'}</span>
              <span style={styles.metaChip}>{component.location || 'Location not set'}</span>
              <span style={styles.metaChip}>{component.unit || 'pcs'}</span>
            </div>

            <div style={styles.stockPanel}>
              <div>
                <div style={styles.stockTitle}>Availability</div>
                <div style={styles.stockRow}>
                  <span style={{ ...styles.stockPill, background: stockBg, color: stockColor }}>{stockLabel}</span>
                  <span style={styles.stockCount}>{component.stock} available</span>
                </div>
              </div>
            </div>

            <div style={{ ...styles.actionRow, ...(isMobile ? styles.actionRowMobile : {}) }}>
              <div style={{ ...styles.qtyPanel, ...(isMobile ? styles.fullWidthBtn : {}) }}>
                <div style={styles.qtyLabel}>{inCart ? 'Cart Quantity' : 'Select Quantity'}</div>
                <div style={styles.qtyControls}>
                  <button
                    style={{ ...styles.qtyBtn, ...(!inCart && displayedQty <= 1 ? styles.qtyBtnDisabled : {}) }}
                    onClick={() => changeMainQuantity(-1)}
                    disabled={!inCart && displayedQty <= 1}>
                    -
                  </button>
                  <span style={styles.qtyValue}>{displayedQty}</span>
                  <button
                    style={{ ...styles.qtyBtn, ...(component.stock === 0 || displayedQty >= component.stock ? styles.qtyBtnDisabled : {}) }}
                    onClick={() => changeMainQuantity(1)}
                    disabled={component.stock === 0 || displayedQty >= component.stock}>
                    +
                  </button>
                </div>
              </div>

              {inCart ? (
                <div style={styles.inCartBadge}>In cart and ready to request</div>
              ) : (
                <button
                  style={{ ...styles.primaryBtn, ...(isMobile ? styles.fullWidthBtn : {}), ...(component.stock === 0 ? styles.primaryBtnDisabled : {}) }}
                  onClick={() => handleAddToCart(component, desiredQty)}
                  disabled={component.stock === 0}>
                  {component.stock === 0 ? 'Unavailable' : `Add ${desiredQty} to Cart`}
                </button>
              )}
              <button style={{ ...styles.secondaryBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/cart')}>Go to Cart</button>
            </div>

            {component.stock > 0 && (
              <div style={styles.actionHint}>
                Adjust the quantity here itself before sending the component request.
              </div>
            )}

            <div style={styles.detailGrid}>
              <div style={styles.detailCard}>
                <div style={styles.detailLabel}>Description</div>
                <p style={styles.detailText}>{component.description || 'No description added for this component yet.'}</p>
              </div>
              <div style={styles.detailCard}>
                <div style={styles.detailLabel}>Quick Info</div>
                <div style={styles.infoList}>
                  <div style={styles.infoRow}><span>Category</span><strong>{component.category || '-'}</strong></div>
                  <div style={styles.infoRow}><span>Unit</span><strong>{component.unit || '-'}</strong></div>
                  <div style={styles.infoRow}><span>Storage</span><strong>{component.location || '-'}</strong></div>
                  <div style={styles.infoRow}><span>Stock</span><strong>{component.stock}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Similar Suggestions</div>
              <h2 style={styles.sectionTitle}>Students who request this also check these components</h2>
            </div>
          </div>

          {similarItems.length === 0 ? (
            <div style={styles.emptyState}>No similar components are available right now.</div>
          ) : (
            <div style={styles.suggestionGrid}>
              {similarItems.map(item => {
                const itemInCart = cart.find(entry => entry.id === item.id);
                return (
                  <div
                    key={item.id}
                    style={styles.suggestionCard}
                    onClick={() => navigate(`/components/${item.id}`)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/components/${item.id}`);
                      }
                    }}
                    role="button"
                    tabIndex={0}>
                    <div style={styles.suggestionMedia}>
                      {item.image ? (
                        <SmartImage
                          src={item.image}
                          alt={item.name}
                          style={styles.suggestionImage}
                          fallback={
                            <div style={styles.suggestionPlaceholder}>
                              {CATEGORY_ICONS[item.category] || CATEGORY_ICONS.default}
                            </div>
                          }
                        />
                      ) : (
                        <div style={styles.suggestionPlaceholder}>
                          {CATEGORY_ICONS[item.category] || CATEGORY_ICONS.default}
                        </div>
                      )}
                    </div>
                    <div style={styles.suggestionBody}>
                      <div style={styles.suggestionCategory}>{item.category}</div>
                      <div style={styles.suggestionName}>{item.name}</div>
                      <div style={styles.suggestionDesc}>{item.description || 'No description available yet.'}</div>
                    <div style={{ ...styles.suggestionFooter, ...(isMobile ? styles.suggestionFooterMobile : {}) }}>
                      <span style={styles.suggestionStock}>{item.stock} available</span>
                      <button
                          type="button"
                          style={{ ...styles.miniAddBtn, ...(isMobile ? styles.fullWidthBtn : {}), ...(item.stock === 0 ? styles.miniAddBtnDisabled : {}) }}
                          onClick={event => {
                            event.stopPropagation();
                            if (item.stock > 0) handleAddToCart(item);
                          }}
                          disabled={item.stock === 0}>
                          {itemInCart ? `In Cart (${itemInCart.qty})` : item.stock === 0 ? 'Unavailable' : 'Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '30px 24px 40px' },
  container: { maxWidth: '1280px', margin: '0 auto' },
  loading: { padding: '80px', textAlign: 'center', color: '#6b7280', fontFamily: "'DM Sans', sans-serif" },
  toast: { position: 'fixed', top: '92px', right: '24px', background: '#17355f', color: '#fff', padding: '12px 20px', borderRadius: '10px', zIndex: 999, fontWeight: 700, fontSize: '14px', boxShadow: '0 4px 20px rgba(26,35,126,0.3)' },
  toastMobile: { left: '14px', right: '14px', top: '82px' },
  topBar: { display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' },
  topBarMobile: { flexDirection: 'column' },
  fullWidthBtn: { width: '100%' },
  backBtn: { background: '#fff', color: '#17355f', border: '1px solid #dbe3f0', borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  cartBtn: { background: '#eef2ff', color: '#1e3a8a', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  heroCard: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '22px', background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 12px 32px rgba(26,35,126,0.08)', marginBottom: '24px' },
  mediaPanel: { background: 'linear-gradient(135deg, #e8eef8, #f7f9ff)', borderRadius: '20px', minHeight: '420px', overflow: 'hidden' },
  mediaPanelMobile: { minHeight: '280px' },
  heroImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  heroPlaceholder: { width: '100%', height: '100%', minHeight: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  heroBadge: { background: 'rgba(255,255,255,0.88)', color: '#17355f', padding: '16px 22px', borderRadius: '999px', fontWeight: 800, fontSize: '20px', letterSpacing: '0.12em' },
  infoPanel: { display: 'flex', flexDirection: 'column' },
  breadcrumb: { fontSize: '12px', color: '#64748b', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '34px', fontWeight: 800, color: '#13233f', lineHeight: 1.15, marginBottom: '12px' },
  titleMobile: { fontSize: '28px' },
  subtitle: { color: '#64748b', fontSize: '15px', lineHeight: 1.7, marginBottom: '16px' },
  metaWrap: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' },
  metaChip: { background: '#f1f5f9', color: '#334155', padding: '6px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 },
  stockPanel: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '16px', marginBottom: '18px' },
  stockTitle: { fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' },
  stockRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  stockPill: { padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 800 },
  stockCount: { fontSize: '14px', fontWeight: 700, color: '#17355f' },
  actionRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' },
  actionRowMobile: { flexDirection: 'column' },
  actionHint: { fontSize: '13px', color: '#64748b', lineHeight: 1.6, marginBottom: '18px' },
  qtyPanel: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px 14px', minWidth: '170px' },
  qtyLabel: { fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' },
  qtyControls: { display: 'flex', alignItems: 'center', gap: '10px' },
  qtyBtn: { width: '34px', height: '34px', borderRadius: '10px', border: 'none', background: '#17355f', color: '#fff', fontSize: '20px', fontWeight: 700, cursor: 'pointer', lineHeight: 1 },
  qtyBtnDisabled: { background: '#e5e7eb', color: '#94a3b8', cursor: 'not-allowed' },
  qtyValue: { minWidth: '34px', textAlign: 'center', fontSize: '20px', fontWeight: 800, color: '#17355f', fontFamily: "'DM Sans', sans-serif" },
  primaryBtn: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 800, fontSize: '14px' },
  primaryBtnDisabled: { background: '#e5e7eb', color: '#94a3b8', cursor: 'not-allowed' },
  secondaryBtn: { background: '#17355f', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' },
  inCartBadge: { background: '#e8f5e9', color: '#2e7d32', padding: '12px 16px', borderRadius: '12px', fontSize: '14px', fontWeight: 800 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' },
  detailCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '16px' },
  detailLabel: { fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' },
  detailText: { fontSize: '14px', color: '#334155', lineHeight: 1.7 },
  infoList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '14px', color: '#334155' },
  section: { background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 12px 32px rgba(26,35,126,0.08)' },
  sectionHeader: { marginBottom: '18px' },
  sectionKicker: { fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' },
  sectionTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#13233f', lineHeight: 1.2 },
  suggestionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' },
  suggestionCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '18px', padding: '0', overflow: 'hidden', textAlign: 'left', cursor: 'pointer' },
  suggestionMedia: { height: '150px', background: 'linear-gradient(135deg, #e8eef8, #f7f9ff)' },
  suggestionImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  suggestionPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#17355f', fontWeight: 800, letterSpacing: '0.12em' },
  suggestionBody: { padding: '14px' },
  suggestionCategory: { fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' },
  suggestionName: { fontSize: '16px', fontWeight: 800, color: '#13233f', lineHeight: 1.3, marginBottom: '8px' },
  suggestionDesc: { fontSize: '12px', color: '#64748b', lineHeight: 1.6, minHeight: '58px', marginBottom: '12px' },
  suggestionFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  suggestionFooterMobile: { flexDirection: 'column', alignItems: 'stretch' },
  suggestionStock: { fontSize: '12px', fontWeight: 700, color: '#17355f' },
  miniAddBtn: { background: '#17355f', color: '#fff', border: 'none', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  miniAddBtnDisabled: { background: '#e5e7eb', color: '#94a3b8', cursor: 'not-allowed' },
  emptyState: { padding: '26px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' },
  notFound: { maxWidth: '620px', margin: '80px auto', background: '#fff', borderRadius: '24px', padding: '36px', textAlign: 'center', boxShadow: '0 12px 32px rgba(26,35,126,0.08)' },
  notFoundLabel: { display: 'inline-block', padding: '6px 12px', borderRadius: '999px', background: '#fff3e0', color: '#ef6c00', fontWeight: 800, fontSize: '12px', marginBottom: '16px' },
  notFoundTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '28px', fontWeight: 800, color: '#13233f', marginBottom: '12px' },
  notFoundText: { fontSize: '14px', color: '#64748b', marginBottom: '22px' },
};
