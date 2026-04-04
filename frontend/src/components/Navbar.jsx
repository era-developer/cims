import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import useViewport from '../hooks/useViewport';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { totalItems } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const { width } = useViewport();
  const [searchValue, setSearchValue] = useState('');
  const isCompact = width <= 1180;
  const isMobile = width <= 720;
  const isAdmin = user?.role === 'admin';
  const navLinks = isAdmin
    ? [
        { path: '/admin', label: 'Dashboard' },
        { path: '/admin/inventory', label: 'Inventory' },
        { path: '/admin/orders', label: 'Orders' },
        { path: '/admin/users', label: 'Users' },
      ]
    : [
        { path: '/dashboard', label: 'Browse' },
        { path: '/my-orders', label: 'My Orders' },
        { path: '/my-profile', label: 'My Profile' },
      ];

  function handleLogout() {
    logout();
    navigate('/');
  }

  function getSearchConfig() {
    if (isAdmin) {
      if (location.pathname.startsWith('/admin/users')) {
        return { path: '/admin/users', placeholder: 'Search users...' };
      }
      if (location.pathname.startsWith('/admin/orders')) {
        return { path: '/admin/orders', placeholder: 'Search orders...' };
      }
      return { path: '/admin/inventory', placeholder: 'Search inventory...' };
    }

    if (location.pathname.startsWith('/my-orders')) {
      return { path: '/my-orders', placeholder: 'Search your orders...' };
    }

    return { path: '/dashboard', placeholder: 'Search components...' };
  }

  const searchConfig = getSearchConfig();

  useEffect(() => {
    const currentQuery = new URLSearchParams(location.search).get('q') || '';
    setSearchValue(currentQuery);
  }, [location.pathname, location.search]);

  if (!user) return null;

  function handleSearchSubmit(event) {
    event.preventDefault();
    const nextSearch = new URLSearchParams();
    if (searchValue.trim()) nextSearch.set('q', searchValue.trim());
    const queryString = nextSearch.toString();
    navigate(queryString ? `${searchConfig.path}?${queryString}` : searchConfig.path);
  }

  function isLinkActive(path) {
    if (location.pathname === path) return true;
    if (!isAdmin && path === '/dashboard' && location.pathname.startsWith('/components/')) return true;
    if (isAdmin && path !== '/admin' && location.pathname.startsWith(path)) return true;
    return false;
  }

  return (
    <nav style={styles.nav}>
      <div style={{ ...styles.inner, ...(isCompact ? styles.innerCompact : {}), ...(isMobile ? styles.innerMobile : {}) }}>
        <div style={{ ...styles.brand, ...(isMobile ? styles.brandMobile : {}) }} onClick={() => navigate(isAdmin ? '/admin' : '/dashboard')}>
          <BrandLogo compact dark showSystemName={false} />
          <span style={styles.brandBadge}>{isAdmin ? 'Admin' : 'Student'}</span>
        </div>

        <div style={{ ...styles.links, ...(isCompact ? styles.linksCompact : {}) }}>
          {navLinks.map(link => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              style={{ ...styles.link, ...(isLinkActive(link.path) ? styles.linkActive : {}) }}>
              {link.label}
            </button>
          ))}
        </div>

        <form style={{ ...styles.searchForm, ...(isCompact ? styles.searchFormCompact : {}) }} onSubmit={handleSearchSubmit}>
          <input
            style={styles.searchInput}
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            placeholder={searchConfig.placeholder}
          />
          <button type="submit" style={styles.searchBtn}>Search</button>
        </form>

        <div style={{ ...styles.right, ...(isCompact ? styles.rightCompact : {}), ...(isMobile ? styles.rightMobile : {}) }}>
          {!isAdmin && (
            <button style={styles.cartBtn} onClick={() => navigate('/cart')}>
              Cart
              {totalItems > 0 && <span style={styles.badge}>{totalItems}</span>}
            </button>
          )}
          <div style={{ ...styles.userInfo, ...(isMobile ? styles.userInfoMobile : {}) }}>
            <div style={styles.avatar}>{user.fullName?.[0] || user.username[0].toUpperCase()}</div>
            <div style={styles.userText}>
              <div style={styles.userName}>{user.fullName || user.username}</div>
              <div style={styles.userRole}>{user.role}</div>
            </div>
          </div>
          <button style={styles.logoutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      </div>
    </nav>
  );
}

const styles = {
  nav: { background: '#17355f', boxShadow: '0 2px 12px rgba(26,35,126,0.3)', position: 'sticky', top: 0, zIndex: 100 },
  inner: { maxWidth: '1400px', margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '14px', minHeight: '80px', flexWrap: 'wrap' },
  innerCompact: { alignItems: 'stretch' },
  innerMobile: { padding: '12px 14px' },
  brand: { display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', flexShrink: 0 },
  brandMobile: { width: '100%' },
  brandBadge: { background: 'rgba(249,168,37,0.86)', color: '#102548', fontSize: '10px', fontWeight: 800, padding: '4px 9px', borderRadius: '999px', letterSpacing: '0.08em', textTransform: 'uppercase' },
  links: { display: 'flex', gap: '6px', flex: '0 1 auto', marginLeft: '8px', flexWrap: 'nowrap', overflowX: 'auto' },
  linksCompact: { order: 2, width: '100%', flex: '1 1 100%', marginLeft: 0, paddingBottom: '2px' },
  searchForm: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 260px', width: '260px', minWidth: '200px', marginLeft: 'auto' },
  searchFormCompact: { order: 3, width: '100%', flex: '1 1 100%', minWidth: 0, marginLeft: 0 },
  searchInput: { width: '100%', padding: '9px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  searchBtn: { background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', padding: '9px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, flexShrink: 0 },
  link: { background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.78)', padding: '8px 13px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s', whiteSpace: 'nowrap' },
  linkActive: { background: 'rgba(255,255,255,0.16)', color: '#fff' },
  right: { display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 },
  rightCompact: { order: 4, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' },
  rightMobile: { gap: '10px' },
  cartBtn: { background: 'rgba(249,168,37,0.95)', color: '#102548', border: 'none', padding: '9px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' },
  badge: { background: '#fff', color: '#17355f', borderRadius: '999px', minWidth: '18px', height: '18px', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' },
  userInfo: { display: 'flex', alignItems: 'center', gap: '8px' },
  userInfoMobile: { flex: '1 1 auto', minWidth: 0 },
  userText: { minWidth: 0 },
  avatar: { width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(249,168,37,0.95)', color: '#102548', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px' },
  userName: { color: '#fff', fontSize: '13px', fontWeight: 700, lineHeight: '1.2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { color: 'rgba(255,255,255,0.62)', fontSize: '11px', textTransform: 'capitalize' },
  logoutBtn: { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.88)', border: '1px solid rgba(255,255,255,0.22)', padding: '8px 14px', borderRadius: '9px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 },
};
