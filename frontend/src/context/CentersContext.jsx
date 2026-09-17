import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

// Centers used to be a hardcoded array in src/centers.js, mirrored by hand
// from backend/utils/centers.js. They are now rows a super admin creates at
// runtime, so the list has to be fetched rather than compiled in.
//
// Loaded from the public /api/centers endpoint because the login and
// registration screens need the center picker before a token exists.

const CentersContext = createContext({
  centers: [],
  loading: true,
  error: '',
  refresh: () => {},
  getCenterName: () => '',
});

export function CentersProvider({ children }) {
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/centers');
      setCenters(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      // A failed center fetch is not fatal on its own -- screens that can
      // work without the list (an admin already scoped to one center) should
      // still render, so the error is surfaced rather than thrown.
      setError(err?.response?.data?.message || 'Unable to load centers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const getCenterName = useCallback(
    centerId => centers.find(center => center.id === centerId)?.name || '',
    [centers]
  );

  const value = useMemo(
    () => ({ centers, loading, error, refresh, getCenterName }),
    [centers, loading, error, refresh, getCenterName]
  );

  return <CentersContext.Provider value={value}>{children}</CentersContext.Provider>;
}

export function useCenters() {
  return useContext(CentersContext);
}

export default CentersContext;
