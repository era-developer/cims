import React, { useEffect, useRef, useState } from 'react';

// Camera QR scanner for asset-tag labels.
//
// Detection uses the browser's built-in BarcodeDetector when it exists
// (Chrome on Android and desktop -- fast, hardware-assisted) and falls back
// to jsQR decoding video frames on a canvas everywhere else (Safari on
// iPhone). Either way the camera stream never leaves the device. A manual
// entry box covers a torn label or a device with no usable camera.
//
// Emits each distinct code once; the same code is ignored for a couple of
// seconds so holding the phone over a label does not fire repeatedly.
export default function QrScanner({ onScan, onClose, title = 'Scan asset tag', hint = 'Point the camera at the QR label on the unit.' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastRef = useRef({ code: '', at: 0 });
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [engine, setEngine] = useState('');

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let detector = null;
    let jsQR = null;

    function emit(code) {
      const text = String(code || '').trim();
      if (!text) return;
      const now = Date.now();
      if (lastRef.current.code === text && now - lastRef.current.at < 2500) return;
      lastRef.current = { code: text, at: now };
      if (navigator.vibrate) navigator.vibrate(60);
      onScan(text);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot access the camera. Type the tag below instead.');
        return;
      }
      try {
        // Rear camera on phones; any camera on a laptop.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow camera access for this site, or type the tag below.'
          : 'Could not start the camera. Type the tag below instead.');
        return;
      }

      if ('BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if (!formats || formats.includes('qr_code')) {
            detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128'] });
            setEngine('native');
          }
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        jsQR = (await import('jsqr')).default;
        setEngine('jsqr');
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      async function tick() {
        if (cancelled) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length) emit(codes[0].rawValue);
            } else if (jsQR) {
              // Decode at reduced resolution: plenty for a label, much cheaper.
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.floor(video.videoWidth * scale);
              canvas.height = Math.floor(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
              if (found?.data) emit(found.data);
            }
          } catch {
            // A single bad frame is not worth surfacing.
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
    if (manual.trim()) onScan(manual.trim());
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>{title}</div>
            <div style={styles.hint}>{hint}</div>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={styles.viewport}>
          <video ref={videoRef} style={styles.video} muted playsInline autoPlay />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {!error && <div style={styles.reticle} />}
          {error && <div style={styles.errorOverlay}>{error}</div>}
        </div>

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
        {engine && <div style={styles.engine}>{engine === 'native' ? 'Using device scanner' : 'Using in-page decoder'}</div>}
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(10,14,30,0.82)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' },
  panel: { background: '#111629', color: '#fff', borderRadius: '16px', width: '100%', maxWidth: '460px', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 30px 80px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', padding: '14px 16px 10px' },
  title: { fontSize: '16px', fontWeight: 800 },
  hint: { fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '3px' },
  closeBtn: { background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px', flexShrink: 0 },
  viewport: { position: 'relative', background: '#000', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  reticle: { position: 'absolute', width: '62%', aspectRatio: '1', border: '3px solid rgba(249,168,37,0.95)', borderRadius: '14px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)', pointerEvents: 'none' },
  errorOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center', fontSize: '13px', color: '#fecaca', background: 'rgba(0,0,0,0.6)' },
  manualRow: { display: 'flex', gap: '8px', padding: '12px 16px 6px' },
  manualInput: { flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '14px', fontFamily: "'DM Mono', Consolas, monospace", outline: 'none' },
  manualBtn: { background: '#f9a825', color: '#102548', border: 'none', borderRadius: '10px', padding: '0 16px', fontWeight: 800, cursor: 'pointer' },
  engine: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '0 0 10px' },
};
