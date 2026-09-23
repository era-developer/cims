import React, { useCallback, useEffect, useRef, useState } from 'react';
import QrIcon from './QrIcon';

// Camera QR scanner for asset-tag labels.
//
// Decoding: the browser's BarcodeDetector is used only when it reports
// actual QR support -- Chrome on Windows/Linux exposes the API but decodes
// nothing, which looked like "the webcam does not work". Everywhere else
// (and as a watchdog fallback if the native path stays silent) frames are
// decoded in-page with jsQR. The camera stream never leaves the device.
//
// Camera choice: a PC with a virtual camera installed (DroidCam, OBS, Iriun)
// often hands "environment" to that virtual device, which streams a static
// "Start DroidCam" placeholder -- a live picture that never decodes, with no
// way out. So every camera is listed and the chosen one is remembered.
//
// Emits each distinct code once (a code is ignored for a couple of seconds
// after it fires). `children` render below the viewfinder -- callers use it
// to show what was just scanned and act on it without leaving the scanner.
// `paused` stops decoding while the caller is asking something.

const DEVICE_KEY = 'cims.scanner.deviceId';

function readStoredDeviceId() {
  try {
    return localStorage.getItem(DEVICE_KEY) || '';
  } catch {
    // Private mode / blocked storage: just use the browser's default camera.
    return '';
  }
}

function storeDeviceId(id) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Not being able to remember the choice is not worth an error.
  }
}

export default function QrScanner({
  onScan,
  onClose,
  title = 'Scan QR code',
  hint = 'Point the camera at the QR label on the unit.',
  paused = false,
  children,
  // Optional "I'm finished" button under the panel, for multi-scan flows
  // where closing with the X feels like cancelling.
  doneLabel = '',
  onDone,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastRef = useRef({ code: '', at: 0 });
  const pausedRef = useRef(paused);
  // Callers pass an inline arrow for onScan, so keeping it in a ref stops the
  // camera being torn down and restarted on every parent render.
  const onScanRef = useRef(onScan);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [engine, setEngine] = useState('');
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState([]);
  // '' means "let the browser choose"; otherwise a specific deviceId.
  const [deviceId, setDeviceId] = useState(readStoredDeviceId);
  // Which camera actually ended up streaming -- not always the one asked for.
  const [activeDeviceId, setActiveDeviceId] = useState('');
  // Bumped by Retry / "switch camera" to re-run the start effect.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  // Labels are only populated once camera permission has been granted, so
  // this is called after the stream starts (and on device plug/unplug).
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter(d => d.kind === 'videoinput'));
    } catch {
      // Listing cameras is a convenience; the stream still works without it.
    }
  }, []);

  function chooseDevice(id) {
    storeDeviceId(id);
    setDeviceId(id);
    setReloadKey(k => k + 1);
  }

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let detector = null;
    let jsQR = null;
    let nativeFrames = 0;

    function emit(code) {
      const text = String(code || '').trim();
      if (!text || pausedRef.current) return;
      const now = Date.now();
      if (lastRef.current.code === text && now - lastRef.current.at < 2500) return;
      lastRef.current = { code: text, at: now };
      if (navigator.vibrate) navigator.vibrate(60);
      onScanRef.current(text);
    }

    async function loadJsQr() {
      if (!jsQR) jsQR = (await import('jsqr')).default;
      detector = null;
      setEngine('jsqr');
    }

    // Rear camera on phones; on a laptop "environment" simply falls back to
    // whatever webcam exists. Higher resolution helps small labels.
    function constraintsFor(id) {
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      if (id) video.deviceId = { exact: id };
      else video.facingMode = { ideal: 'environment' };
      return { video, audio: false };
    }

    async function openStream() {
      try {
        return await navigator.mediaDevices.getUserMedia(constraintsFor(deviceId));
      } catch (err) {
        // A remembered camera that has since been unplugged (or a virtual one
        // whose app is closed) must not lock the scanner out for good: forget
        // it and fall back to the browser's default.
        if (deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError' || err?.name === 'NotReadableError')) {
          storeDeviceId('');
          if (!cancelled) setDeviceId('');
          return navigator.mediaDevices.getUserMedia(constraintsFor(''));
        }
        throw err;
      }
    }

    async function start() {
      setError('');
      setReady(false);
      if (!window.isSecureContext) {
        setError('The camera only works on a secure address. Open the portal via its https link, or type the tag below.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot access the camera. Type the tag below instead.');
        return;
      }
      try {
        const stream = await openStream();
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          setActiveDeviceId(track.getSettings?.().deviceId || '');
          // Unplugged mid-scan: say so rather than freezing on the last frame.
          track.addEventListener('ended', () => {
            if (cancelled) return;
            setError('That camera stopped. Pick another one above, or type the tag below.');
            setReady(false);
            refreshDevices();
          });
        }
        const video = videoRef.current;
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          // Switching cameras quickly aborts the pending play(); harmless.
          if (err?.name !== 'AbortError') throw err;
        }
        setReady(true);
        refreshDevices();
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow camera access for this site (padlock icon in the address bar), or type the tag below.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device. Type the tag below instead.'
            : err?.name === 'NotReadableError'
              ? 'That camera is already in use by another app. Close it (or pick another camera above) and try again.'
              : 'Could not start the camera. Try another camera above, or type the tag below.');
        refreshDevices();
        return;
      }

      // Native detector only when it *says* it can do QR. Chrome on Windows
      // has the class but getSupportedFormats() returns [] -- using it there
      // means a live video and nothing ever detected.
      if ('BarcodeDetector' in window && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (Array.isArray(formats) && formats.includes('qr_code')) {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            setEngine('native');
          }
        } catch {
          detector = null;
        }
      }
      if (!detector) await loadJsQr();

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      async function tick() {
        if (cancelled) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && !pausedRef.current) {
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length) emit(codes[0].rawValue);
              // Watchdog: a native detector that never fires in ~8s of live
              // video is treated as broken and replaced with jsQR.
              nativeFrames += 1;
              if (nativeFrames > 240 && lastRef.current.at === 0) await loadJsQr();
            } else if (jsQR) {
              const scale = Math.min(1, 960 / video.videoWidth);
              canvas.width = Math.floor(video.videoWidth * scale);
              canvas.height = Math.floor(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
              if (found?.data) emit(found.data);
            }
          } catch {
            // A bad frame is not worth surfacing.
          }
        }
        rafId = requestAnimationFrame(tick);
      }
      tick();
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [deviceId, reloadKey, refreshDevices]);

  // A camera plugged in or removed while the scanner is open.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    md.addEventListener('devicechange', refreshDevices);
    return () => md.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  function submitManual(event) {
    event.preventDefault();
    if (manual.trim()) { onScan(manual.trim()); setManual(''); }
  }

  // The <select> follows the camera actually in use, so "Automatic" does not
  // keep showing after the browser resolved it to a specific device.
  const selectValue = deviceId || (devices.some(d => d.deviceId === activeDeviceId) ? activeDeviceId : '');
  const showPicker = devices.length > 1 || (!!error && devices.length > 0);

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <QrIcon size={18} style={{ color: '#f9a825' }} />
            <div>
              <div style={styles.title}>{title}</div>
              <div style={styles.hint}>{hint}</div>
            </div>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {showPicker && (
          <div style={styles.cameraRow}>
            <label style={styles.cameraLabel} htmlFor="qr-scanner-camera">Camera</label>
            <select
              id="qr-scanner-camera"
              style={styles.cameraSelect}
              value={selectValue}
              onChange={e => chooseDevice(e.target.value)}
            >
              <option value="">Automatic</option>
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
            <button type="button" style={styles.retryBtn} onClick={() => setReloadKey(k => k + 1)}>Retry</button>
          </div>
        )}

        <div style={styles.viewport}>
          <video ref={videoRef} style={styles.video} muted playsInline autoPlay />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {!error && ready && <div style={{ ...styles.reticle, opacity: paused ? 0.35 : 1 }} />}
          {!error && !ready && <div style={styles.starting}>Starting camera…</div>}
          {error && <div style={styles.errorOverlay}>{error}</div>}
        </div>

        {!error && ready && devices.length > 1 && (
          <div style={styles.cameraNote}>
            Seeing a still image or the wrong camera? Pick another one above.
          </div>
        )}

        {children && <div style={styles.resultArea}>{children}</div>}

        <form onSubmit={submitManual} style={styles.manualRow}>
          <input
            style={styles.manualInput}
            value={manual}
            onChange={e => setManual(e.target.value)}
            placeholder="or type the tag, e.g. JPN-ELEC-00012"
            autoComplete="off"
            autoCapitalize="characters"
          />
          <button type="submit" style={styles.manualBtn} disabled={!manual.trim()}>Go</button>
        </form>
        {doneLabel && (
          <div style={styles.doneRow}>
            <button type="button" style={styles.doneBtn} onClick={onDone || onClose}>{doneLabel}</button>
          </div>
        )}
        {engine && <div style={styles.engine}>{engine === 'native' ? 'Using device scanner' : 'Using in-page decoder'}</div>}
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(10,14,30,0.82)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' },
  panel: { background: '#111629', color: '#fff', borderRadius: '16px', width: '100%', maxWidth: '460px', maxHeight: '96vh', overflowY: 'auto', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 30px 80px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', padding: '14px 16px 10px' },
  titleRow: { display: 'flex', gap: '10px', alignItems: 'flex-start' },
  title: { fontSize: '16px', fontWeight: 800 },
  hint: { fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '3px' },
  closeBtn: { background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px', flexShrink: 0 },
  cameraRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px 10px' },
  cameraLabel: { fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', flexShrink: 0 },
  cameraSelect: { flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '9px', border: '1px solid rgba(255,255,255,0.18)', background: '#1b2237', color: '#fff', fontSize: '12.5px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  retryBtn: { background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', borderRadius: '9px', padding: '8px 12px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 },
  cameraNote: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', textAlign: 'center', padding: '8px 16px 0' },
  viewport: { position: 'relative', background: '#000', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  reticle: { position: 'absolute', width: '62%', aspectRatio: '1', border: '3px solid rgba(249,168,37,0.95)', borderRadius: '14px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)', pointerEvents: 'none', transition: 'opacity 0.2s' },
  starting: { position: 'absolute', color: 'rgba(255,255,255,0.7)', fontSize: '13px' },
  errorOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center', fontSize: '13px', color: '#fecaca', background: 'rgba(0,0,0,0.6)' },
  resultArea: { padding: '12px 16px 0' },
  manualRow: { display: 'flex', gap: '8px', padding: '12px 16px 6px' },
  manualInput: { flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '14px', fontFamily: "'DM Mono', Consolas, monospace", outline: 'none' },
  manualBtn: { background: '#f9a825', color: '#102548', border: 'none', borderRadius: '10px', padding: '0 16px', fontWeight: 800, cursor: 'pointer' },
  doneRow: { padding: '4px 16px 12px' },
  doneBtn: { width: '100%', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  engine: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '0 0 10px' },
};
