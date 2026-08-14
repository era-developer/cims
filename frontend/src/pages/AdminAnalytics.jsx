import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext';

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    fetchAnalytics();
  }, [user]);

  async function fetchAnalytics() {
    try {
      const res = await axios.get('/api/admin/analytics');
      setAnalytics(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (user?.role !== 'super_admin') {
    return <div className="p-6">Access denied</div>;
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!analytics) {
    return <div className="p-6">Failed to load analytics</div>;
  }

  const chartData = Object.values(analytics.centers).map(center => ({
    name: center.name,
    Users: center.users,
    Orders: center.orders,
    'Line Items': center.inventory,
    'Damaged/Consumed Units': center.damagedUnits || 0,
    'Damaged/Consumed Components': center.damagedComponents || 0,
  }));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Super Admin Analytics</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-blue-100 p-4 rounded">
          <h3 className="text-lg font-semibold">Total Users</h3>
          <p className="text-2xl">{analytics.totalUsers}</p>
        </div>
        <div className="bg-green-100 p-4 rounded">
          <h3 className="text-lg font-semibold">Total Orders</h3>
          <p className="text-2xl">{analytics.totalOrders}</p>
        </div>
        <div className="bg-yellow-100 p-4 rounded">
          <h3 className="text-lg font-semibold">Total Line Items</h3>
          <p className="text-2xl">{analytics.totalInventory}</p>
        </div>
        <div className="bg-red-100 p-4 rounded">
          <h3 className="text-lg font-semibold">Damaged/Consumed Units</h3>
          <p className="text-2xl">{analytics.totalDamagedUnits || 0}</p>
        </div>
        <div className="bg-orange-100 p-4 rounded">
          <h3 className="text-lg font-semibold">Damaged/Consumed Components</h3>
          <p className="text-2xl">{analytics.totalDamagedComponents || 0}</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-xl font-semibold mb-4">Center-wise Statistics</h2>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="Users" fill="#8884d8" />
            <Bar dataKey="Orders" fill="#82ca9d" />
            <Bar dataKey="Line Items" fill="#ffc658" />
            <Bar dataKey="Damaged/Consumed Units" fill="#ef4444" />
            <Bar dataKey="Damaged/Consumed Components" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
