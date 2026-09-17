import React, { useEffect, useRef, useState } from 'react';
import QrIcon from './QrIcon';

// Camera QR scanner for asset-tag labels.
//
// Decoding: the browser's BarcodeDetector is used only when it reports
// actual QR support -- Chrome on Windows/Linux exposes the API but decodes
// nothing, which looked like "the webcam does not work". Everywhere else
// (and as a watchdog fallback if the native path stays silent) frames are
// decoded in-page with jsQR. The camera stream never leaves the device.
//
// Emits each distinct code once (a code is ignored for a couple of seconds
// after it fires). `children` render below the viewfinder -- callers use it
// to show what was just scanned and act on it without leaving the scanner.
// `paused` stops decoding while the caller is asking something.
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
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [engine, setEngine] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

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
      onScan(text);
    }

    async function loadJsQr() {
      if (!jsQR) jsQR = (await import('jsqr')).default;
      detector = null;
      setEngine('jsqr');
    }

    async function start() {
      if (!window.isSecureContext) {
        setError('The camera only works on a secure address. Open the portal via its https link, or type the tag below.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot access the camera. Type the tag below instead.');
        return;
      }
      try {
        // Rear camera on phones; on a laptop "environment" simply falls back
        // to whatever webcam exists. Higher resolution helps small labels.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow camera access for this site (padlock icon in the address bar), or type the tag below.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device. Type the tag below instead.'
            : 'Could not start the camera. Type the tag below instead.');
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
    };
  }, [onScan]);

  function submitManual(event) {
    event.preventDefault();
    if (manual.trim()) { onScan(manual.trim()); setManual(''); }
  }

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

        <div style={styles.viewport}>
          <video ref={videoRef} style={styles.video} muted playsInline autoPlay />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {!error && ready && <div style={{ ...styles.reticle, opacity: paused ? 0.35 : 1 }} />}
          {!error && !ready && <div style={styles.starting}>Starting camera…</div>}
          {error && <div style={styles.errorOverlay}>{error}</div>}
        </div>

        {children && <div style={styles.resultArea}>{children}</div>}

        <form onSubmit={submitManual} style={styles.manualRow}>
          <input
            style={styles.manualInput}
            value={manual}
            onChange={e => setManual(e.target.value)}
            placeholder="or type the tag, e.g. AKTU-ELEC-00012"
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
