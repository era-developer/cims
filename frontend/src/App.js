import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { CentersProvider } from './context/CentersContext';
import { APP_SHORT_NAME } from './brand';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import StudentDashboard from './pages/StudentDashboard';
import ComponentDetails from './pages/ComponentDetails';
import Cart from './pages/Cart';
import MyOrders from './pages/MyOrders';
import MyProfile from './pages/MyProfile';
import AdminDashboard from './pages/AdminDashboard';
import AdminInventory from './pages/AdminInventory';
import AdminOrders from './pages/AdminOrders';
import AdminUsers from './pages/AdminUsers';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminInvoiceEntry from './pages/AdminInvoiceEntry';
import AdminTransfers from './pages/AdminTransfers';
import AdminProcurement from './pages/AdminProcurement';
import MyCenter from './pages/MyCenter';
import ProgramDetail from './pages/ProgramDetail';
import RegisterLanding from './pages/RegisterLanding';
import AdminSettings from './pages/AdminSettings';

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '80px', textAlign: 'center', color: '#6b7280', fontFamily: "'DM Sans', sans-serif" }}>Loading {APP_SHORT_NAME}...</div>;
  if (!user) return <Navigate to="/" replace />;
  const allowedRoles = Array.isArray(role) ? role : role ? [role] : [];
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    return <Navigate to={['admin', 'super_admin'].includes(user.role) ? '/admin' : '/dashboard'} replace />;
  }
  return children;
}

function AppLayout({ children }) {
  return <>
    <Navbar />
    {children}
  </>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CentersProvider>
        <CartProvider>
          <Routes>
            <Route path="/" element={<Login />} />

            {/* Student Routes */}
            <Route path="/dashboard" element={
              <PrivateRoute role="student">
                <AppLayout><StudentDashboard /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/components/:id" element={
              <PrivateRoute role="student">
                <AppLayout><ComponentDetails /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/cart" element={
              <PrivateRoute role="student">
                <AppLayout><Cart /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/my-orders" element={
              <PrivateRoute role="student">
                <AppLayout><MyOrders /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/my-profile" element={
              <PrivateRoute role="student">
                <AppLayout><MyProfile /></AppLayout>
              </PrivateRoute>
            } />

            {/* Admin Routes */}
            <Route path="/admin" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><AdminDashboard /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/inventory" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><AdminInventory /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/invoices" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><AdminInvoiceEntry /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/orders" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><AdminOrders /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/transfers" element={
              <PrivateRoute role="super_admin">
                <AppLayout><AdminTransfers /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/procurement" element={
              <PrivateRoute role="super_admin">
                <AppLayout><AdminProcurement /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/users" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><AdminUsers /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/settings" element={
              <PrivateRoute role="super_admin">
                <AppLayout><AdminSettings /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/analytics" element={
              <PrivateRoute role="super_admin">
                <AppLayout><AdminAnalytics /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/my-center" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><MyCenter /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/programs/:id" element={
              <PrivateRoute role={['admin', 'super_admin']}>
                <AppLayout><ProgramDetail /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/register/:centerId" element={<RegisterLanding />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CartProvider>
        </CentersProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
