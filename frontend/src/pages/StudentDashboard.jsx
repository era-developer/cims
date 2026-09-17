import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import SmartImage from '../components/SmartImage';
import useViewport from '../hooks/useViewport';
import NotificationsCard from '../components/NotificationsCard';

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

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { isMobile, isTablet } = useViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const [components, setComponents] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [orderStats, setOrderStats] = useState({
    totalOrders: 0,
    activeOrders: 0,
    returnables: 0,
    partiallyReturned: 0,
  });
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const { addToCart, cart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    fetchDashboardData();
    const timer = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    let data = components;
    if (selectedCat !== 'All') data = data.filter(component => component.category === selectedCat);
    if (search) {
      data = data.filter(component =>
        component.name.toLowerCase().includes(search.toLowerCase()) ||
        component.description?.toLowerCase().includes(search.toLowerCase()) ||
        component.category?.toLowerCase().includes(search.toLowerCase())
      );
    }
    setFiltered(data);
  }, [components, selectedCat, search]);

  async function fetchDashboardData() {
    try {
      const [componentsRes, ordersRes] = await Promise.all([
        axios.get('/api/components'),
        axios.get('/api/orders'),
      ]);

      const componentData = componentsRes.data;
      const orderData = ordersRes.data;

      setComponents(componentData);
      setCategories(['All', ...new Set(componentData.map(component => component.category).filter(Boolean))]);
      setOrderStats({
        totalOrders: orderData.length,
        activeOrders: orderData.filter(order => !['Returned', 'Rejected'].includes(order.status)).length,
        returnables: orderData.filter(order => order.status === 'Approved').length,
        partiallyReturned: orderData.filter(order => order.status === 'Partially Returned').length,
      });
    } catch {
      setOrderStats({
        totalOrders: 0,
        activeOrders: 0,
        returnables: 0,
        partiallyReturned: 0,
      });
    } finally {
      setLoading(false);
    }
  }

  function handleAddToCart(component) {
    if (component.checkoutEligible === false) return;
    addToCart(component, 1);
    setToast(`${component.name} added to cart.`);
    setTimeout(() => setToast(''), 2200);
  }

  function findInCart(id) {
    return cart.find(item => item.id === id);
  }

  function handleSearchChange(value) {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  return (
    <div style={styles.page}>
      {toast && <div style={{ ...styles.toast, ...(isMobile ? styles.toastMobile : {}) }}>{toast}</div>}

      <div style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        <div style={styles.heroInner}>
          <div>
            <h1 style={{ ...styles.heroTitle, ...(isMobile ? styles.heroTitleMobile : {}) }}>Welcome, {user.fullName?.split(' ')[0] || user.username}</h1>
            <p style={styles.heroSub}>Browse available components, check live availability, and add them to your cart.</p>
          </div>
          <div style={{ ...styles.heroStats, ...(isMobile ? styles.heroStatsMobile : {}) }}>
            <div style={{ ...styles.statPill, ...(isMobile ? styles.statPillMobile : {}) }}>{orderStats.totalOrders} Total Orders</div>
            <div style={{ ...styles.statPill, ...(isMobile ? styles.statPillMobile : {}) }}>{orderStats.activeOrders} Active Orders</div>
            <div style={{ ...styles.statPill, ...(isMobile ? styles.statPillMobile : {}) }}>{orderStats.returnables} Returnables</div>
            <div style={{ ...styles.statPill, ...(isMobile ? styles.statPillMobile : {}) }}>{orderStats.partiallyReturned} Partially Returned</div>
          </div>
        </div>
      </div>

      <div style={{ ...styles.content, ...(isMobile ? styles.contentMobile : {}) }}>
        <NotificationsCard compact style={{ marginBottom: '14px' }} />
        <div style={{ ...styles.toolbar, ...(isMobile ? styles.toolbarMobile : {}) }}>
          <div style={styles.searchWrap}>
            <span style={styles.searchIcon}>Search</span>
            <input
              style={styles.searchInput}
              placeholder="Search components, sensors, modules..."
              value={search}
              onChange={event => handleSearchChange(event.target.value)}
            />
          </div>

          <div style={styles.catScroll}>
            {categories.map(category => (
              <button
                key={category}
                onClick={() => setSelectedCat(category)}
                style={{ ...styles.catBtn, ...(selectedCat === category ? styles.catBtnActive : {}) }}>
                {category}
              </button>
            ))}
          </div>
        </div>

        <div style={{ ...styles.resultsBar, ...(isMobile ? styles.resultsBarMobile : {}) }}>
          <span style={styles.resultsCount}>
            {loading ? 'Loading...' : `${filtered.length} component${filtered.length !== 1 ? 's' : ''} found`}
          </span>
          {selectedCat !== 'All' && <span style={styles.filterTag}>{selectedCat}</span>}
        </div>

        {loading ? (
          <div style={styles.loadingGrid}>
            {[...Array(8)].map((_, index) => <div key={index} style={styles.skeleton} />)}
          </div>
        ) : (
          <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : isTablet ? styles.gridTablet : {}) }}>
            {filtered.map(component => {
              const inCart = findInCart(component.id);
              return (
                <ComponentCard
                  key={component.id}
                  comp={component}
                  inCart={!!inCart}
                  cartQty={inCart?.qty || 0}
                  isMobile={isMobile}
                  onOpenDetails={() => navigate(`/components/${component.id}`)}
                  onAddToCart={() => handleAddToCart(component)}
                />
              );
            })}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>No Match</div>
            <h3>No components found</h3>
            <p>Try a different search or category filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentCard({ comp, inCart, cartQty, onAddToCart, onOpenDetails, isMobile }) {
  const canCheckout = comp.checkoutEligible !== false;
  const stockColor = comp.stock > 10 ? '#2e7d32' : comp.stock > 0 ? '#f57f17' : '#c62828';
  const stockBg = comp.stock > 10 ? '#e8f5e9' : comp.stock > 0 ? '#fff9c4' : '#fce4ec';
  const stockLabel = comp.stock > 10 ? 'In Stock' : comp.stock > 0 ? 'Low Stock' : 'Out of Stock';

  return (
    <div
      style={styles.card}
      onClick={onOpenDetails}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      role="button"
      tabIndex={0}>
      <div style={styles.cardImgArea}>
        {comp.image ? (
          <SmartImage
            src={comp.image}
            alt={comp.name}
            style={styles.cardImage}
            fallback={
              <div style={styles.cardImgPlaceholder}>
                <span style={styles.cardIcon}>{CATEGORY_ICONS[comp.category] || CATEGORY_ICONS.default}</span>
              </div>
            }
          />
        ) : (
          <div style={styles.cardImgPlaceholder}>
            <span style={styles.cardIcon}>{CATEGORY_ICONS[comp.category] || CATEGORY_ICONS.default}</span>
          </div>
        )}
        <div style={{ ...styles.stockBadge, ...(canCheckout ? { background: stockBg, color: stockColor } : styles.infoBadge) }}>
          {canCheckout ? stockLabel : 'Info Only'}
        </div>
      </div>

      <div style={styles.cardBody}>
        <div style={styles.cardCat}>{comp.category}</div>
        <h3 style={styles.cardName}>{comp.name}</h3>
        <p style={styles.cardDesc}>{comp.description}</p>
        <div style={styles.cardMeta}>
          <span style={styles.metaChip}>{comp.unit}</span>
        </div>
        <div style={{ ...styles.cardFooter, ...(isMobile ? styles.cardFooterMobile : {}) }}>
          {canCheckout ? (
            <div style={styles.stockInfo}>
              <span style={{ ...styles.stockNum, color: stockColor }}>{comp.stock}</span>
              <span style={styles.stockLabel}>available</span>
            </div>
          ) : (
            <div style={styles.stockInfo}>
              <span style={styles.infoOnlyNote}>For information only</span>
            </div>
          )}
          <div style={{ ...styles.cardActions, ...(isMobile ? styles.cardActionsMobile : {}) }}>
            <button
              style={styles.detailBtn}
              onClick={event => {
                event.stopPropagation();
                onOpenDetails();
              }}>
              View Details
            </button>
            {!canCheckout ? null : inCart ? (
              <div style={styles.inCartBadge}>In Cart ({cartQty})</div>
            ) : (
              <button
                style={{ ...styles.addBtn, ...(comp.stock === 0 ? styles.addBtnDisabled : {}) }}
                onClick={event => {
                  event.stopPropagation();
                  onAddToCart();
                }}
                disabled={comp.stock === 0}>
                {comp.stock === 0 ? 'Unavailable' : 'Add to Cart'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8' },
  toast: { position: 'fixed', top: '90px', right: '24px', background: '#17355f', color: '#fff', padding: '12px 20px', borderRadius: '10px', zIndex: 999, fontWeight: 700, fontSize: '14px', boxShadow: '0 4px 20px rgba(26,35,126,0.3)' },
  toastMobile: { left: '14px', right: '14px', top: '82px' },
  hero: { background: 'linear-gradient(135deg, #17355f 0%, #234d81 60%, #335f97 100%)', padding: '36px 0 32px' },
  heroMobile: { padding: '28px 0 24px' },
  heroInner: { maxWidth: '1400px', margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' },
  heroTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '28px', fontWeight: 800, color: '#fff', marginBottom: '8px' },
  heroTitleMobile: { fontSize: '24px' },
  heroSub: { color: 'rgba(255,255,255,0.80)', fontSize: '14px', maxWidth: '500px', lineHeight: 1.6 },
  heroStats: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  heroStatsMobile: { width: '100%' },
  statPill: { background: 'rgba(255,255,255,0.15)', color: '#fff', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' },
  statPillMobile: { flex: '1 1 150px', textAlign: 'center' },
  content: { maxWidth: '1400px', margin: '0 auto', padding: '28px 24px' },
  contentMobile: { padding: '22px 14px 28px' },
  toolbar: { background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)', marginBottom: '20px' },
  toolbarMobile: { padding: '16px 14px' },
  searchWrap: { position: 'relative', marginBottom: '16px' },
  searchIcon: { position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' },
  searchInput: { width: '100%', padding: '12px 16px 12px 72px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', outline: 'none', fontFamily: "'DM Sans', sans-serif", color: '#1a1a2e', background: '#f8f9ff' },
  catScroll: { display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' },
  catBtn: { padding: '7px 14px', border: '1.5px solid #e2e8f0', borderRadius: '20px', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' },
  catBtnActive: { background: '#17355f', borderColor: '#17355f', color: '#fff' },
  resultsBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' },
  resultsBarMobile: { flexWrap: 'wrap' },
  resultsCount: { fontSize: '14px', color: '#6b7280', fontWeight: 600 },
  filterTag: { background: '#e8eef8', color: '#17355f', fontSize: '12px', padding: '4px 10px', borderRadius: '12px', fontWeight: 700 },
  loadingGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' },
  skeleton: { height: '320px', background: 'linear-gradient(90deg, #e8eaf6 25%, #f0f2ff 50%, #e8eaf6 75%)', borderRadius: '16px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' },
  gridTablet: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' },
  gridMobile: { gridTemplateColumns: '1fr', gap: '16px' },
  card: { background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)', cursor: 'pointer', border: '1px solid transparent' },
  cardImgArea: { position: 'relative', height: '160px', background: 'linear-gradient(135deg, #e8eaf6, #f0f2ff)' },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardImgPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardIcon: { fontSize: '18px', fontWeight: 800, color: '#17355f', background: 'rgba(255,255,255,0.84)', padding: '12px 16px', borderRadius: '999px', letterSpacing: '0.08em' },
  stockBadge: { position: 'absolute', top: '10px', right: '10px', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 },
  infoBadge: { background: '#eef2ff', color: '#3730a3' },
  infoOnlyNote: { fontSize: '12px', color: '#6b7280', fontStyle: 'italic' },
  cardBody: { padding: '16px' },
  cardCat: { fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
  cardName: { fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 800, color: '#1a1a2e', marginBottom: '8px', lineHeight: '1.3' },
  cardDesc: { fontSize: '12px', color: '#6b7280', lineHeight: '1.5', marginBottom: '10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardMeta: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' },
  metaChip: { background: '#f0f2f8', color: '#6b7280', fontSize: '11px', padding: '3px 8px', borderRadius: '6px' },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid #f0f2f8', gap: '12px' },
  cardFooterMobile: { flexDirection: 'column', alignItems: 'flex-start' },
  cardActions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  cardActionsMobile: { width: '100%', justifyContent: 'flex-start' },
  stockInfo: { display: 'flex', alignItems: 'baseline', gap: '4px' },
  stockNum: { fontSize: '22px', fontWeight: 800, fontFamily: "'DM Sans', sans-serif" },
  stockLabel: { fontSize: '12px', color: '#6b7280' },
  detailBtn: { background: '#eef2ff', color: '#1e3a8a', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 800 },
  addBtn: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 800 },
  addBtnDisabled: { background: '#e0e0e0', color: '#9e9e9e', cursor: 'not-allowed' },
  inCartBadge: { background: '#e8f5e9', color: '#2e7d32', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700 },
  empty: { textAlign: 'center', padding: '80px 20px', color: '#6b7280' },
  emptyIcon: { fontSize: '18px', fontWeight: 800, marginBottom: '16px', color: '#17355f' },
};
