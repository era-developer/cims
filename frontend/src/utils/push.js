import axios from 'axios';

// Browser notifications (Web Push) from the client's side: ask permission,
// subscribe this browser through the service worker, and tell the server.
// Everything here is best-effort -- a browser without push support just
// reports `supported: false` and the UI hides itself.

const DISMISS_KEY = 'kims.pushPromptDismissedAt';
const DISMISS_DAYS = 7;

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && window.isSecureContext;
}

// iOS Safari only allows Web Push for pages added to the Home Screen.
export function isIosBrowserWithoutInstall() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return ios && !standalone;
}

export function permissionState() {
  return isPushSupported() ? Notification.permission : 'unsupported';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

async function getRegistration() {
  // In production index.js registers /sw.js; `ready` waits for it to activate.
  // In development nothing is registered, so register on demand.
  if (process.env.NODE_ENV !== 'production') {
    try { await navigator.serviceWorker.register('/sw.js'); } catch { /* fall through to ready */ }
  }
  return navigator.serviceWorker.ready;
}

export async function getCurrentSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await getRegistration();
    return reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Where this browser stands for the signed-in user.
//   { supported, permission, subscribed, devices, configured }
export async function getPushStatus() {
  if (!isPushSupported()) return { supported: false, permission: 'unsupported', subscribed: false, devices: 0, configured: false };
  const sub = await getCurrentSubscription();
  try {
    const res = await axios.get('/api/push/status', { params: { endpoint: sub?.endpoint || '' } });
    return { supported: true, permission: Notification.permission, subscribed: !!(sub && res.data.subscribed), devices: res.data.devices || 0, configured: !!res.data.configured };
  } catch {
    return { supported: true, permission: Notification.permission, subscribed: false, devices: 0, configured: false };
  }
}

// Ask, subscribe, register. Throws with a human message on failure.
export async function enablePush() {
  if (!isPushSupported()) throw new Error('This browser cannot show notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.'
      : 'Notification permission was not granted.');
  }
  const { data } = await axios.get('/api/push/public-key');
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.publicKey) });
  }
  const res = await axios.post('/api/push/subscribe', { subscription: sub.toJSON() });
  return res.data;
}

export async function disablePush() {
  const sub = await getCurrentSubscription();
  if (sub) {
    try { await axios.delete('/api/push/subscribe', { data: { endpoint: sub.endpoint } }); } catch { /* server row may already be gone */ }
    try { await sub.unsubscribe(); } catch { /* browser may already have dropped it */ }
  }
}

export async function sendTestPush() {
  const res = await axios.post('/api/push/test');
  return res.data;
}

// The dashboard nudge is dismissable for a week; the full switch lives in
// My Profile / Settings for whenever the person changes their mind.
export function isPromptDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function dismissPrompt() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
}
