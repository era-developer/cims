import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
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

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '80px', textAlign: 'center', color: '#6b7280', fontFamily: "'DM Sans', sans-serif" }}>Loading CIMS...</div>;
  if (!user) return <Navigate to="/" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
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
              <PrivateRoute role="admin">
                <AppLayout><AdminDashboard /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/inventory" element={
              <PrivateRoute role="admin">
                <AppLayout><AdminInventory /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/orders" element={
              <PrivateRoute role="admin">
                <AppLayout><AdminOrders /></AppLayout>
              </PrivateRoute>
            } />
            <Route path="/admin/users" element={
              <PrivateRoute role="admin">
                <AppLayout><AdminUsers /></AppLayout>
              </PrivateRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
