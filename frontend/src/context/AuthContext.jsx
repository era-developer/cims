import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cims_token');
    const savedUser = localStorage.getItem('cims_user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    localStorage.setItem('cims_token', data.token);
    localStorage.setItem('cims_user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    setUser(data.user);
    return data.user;
  };

  const refreshProfile = async () => {
    const { data } = await axios.get('/api/auth/profile');
    localStorage.setItem('cims_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const updateProfile = async (payload) => {
    const { data } = await axios.put('/api/auth/profile', payload);
    localStorage.setItem('cims_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await axios.post('/api/auth/register', payload);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('cims_token');
    localStorage.removeItem('cims_user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, refreshProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
