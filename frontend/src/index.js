import React from 'react';
import ReactDOM from 'react-dom/client';
import './api';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Service worker: makes CIMS installable ("Add to Home Screen") and lets the
// app shell open instantly and offline. Production only -- in development it
// would serve stale bundles and fight the dev server.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      // A new build was deployed: activate it on next navigation rather than
      // leaving the old shell running until every tab is closed.
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {});
  });
}
