import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCenters } from '../context/CentersContext';
import { APP_LONG_NAME, APP_SUBTITLE, PRIMARY_COLOR, LOGO_URL } from '../brand';

export default function RegisterLanding() {
  const { centerId } = useParams();
  const { centers, loading } = useCenters();
  const center = centers.find(c => c.id === centerId);

  // The center list is fetched, so an unknown id is only genuinely unknown
  // once loading has finished -- otherwise every visit flashes "not found".
  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!center) {
    return <div className="p-6">Center not found</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
        <div className="text-center mb-6">
          <img src={LOGO_URL} alt="Logo" className="mx-auto h-12 w-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">{APP_SUBTITLE}</h1>
          <p className="text-gray-600">{APP_LONG_NAME}</p>
        </div>
        
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Welcome to {center.name}</h2>
          <p className="text-gray-600">
            Register as a student to access the component inventory and place orders for your projects.
          </p>
        </div>

        <div className="space-y-4">
          <Link
            to={`/?register=1&centerId=${centerId}`}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 block text-center"
            style={{ backgroundColor: PRIMARY_COLOR }}
          >
            Register Now
          </Link>
          <Link
            to="/"
            className="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300 block text-center"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}