import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SmartImage from './SmartImage';

// Lets an admin either paste a photo URL (e.g. Google Drive share link) or
// capture one live from the device camera. Camera captures are compressed
// client-side, then uploaded as an actual file (POST /api/assets/upload
// -image) rather than stored as base64 text in product_catalog.image --
// keeps the database small and lets browsers cache photos across visits,
// the same way invoice document uploads already work on disk rather than
// in the database.

const MAX_DIMENSION_PX = 1000;
const JPEG_QUALITY = 0.75;

// A raw phone-camera capture can be several thousand pixels wide and land in
// the multi-megabyte range for what's ultimately shown as a small thumbnail
// (the largest one found in the live catalog was 3.86MB). This resizes/
// recompresses client-side before it's uploaded -- same photo the admin
// took, just not a multi-megapixel original nobody needed at thumbnail size.
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
          const scale = MAX_DIMENSION_PX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/jpeg', JPEG_QUALITY);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// onUploadStateChange(true/false) is optional -- forms that want to block
// Save while a photo is still mid-upload (so they never submit a stale/
// empty image value) can wire it up; PhotoInput works fine without it too.
// `name` is the component's name; sent with the upload so the file on disk
// is called after the component (data/components/<name>.jpg) instead of a UUID.
export default function PhotoInput({ value, onChange, label = 'Photo', onUploadStateChange, name = '' }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [localPreviewUrl, setLocalPreviewUrl] = useState('');
  const localPreviewRef = useRef('');

  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  }, []);

  function setLocalPreview(blob) {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    const url = blob ? URL.createObjectURL(blob) : '';
    localPreviewRef.current = url;
    setLocalPreviewUrl(url);
  }

  async function handleFile(file) {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    onUploadStateChange?.(true);
    try {
      const blob = await compressImageFile(file);
      setLocalPreview(blob);
      const formData = new FormData();
      // Field order matters: multer only sees fields that arrive BEFORE the file.
      if (name) formData.append('name', String(name).trim());
      formData.append('image', blob, 'photo.jpg');
      const { data } = await axios.post('/api/assets/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(data.path);
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Upload failed -- please try again.');
      setLocalPreview(null);
    } finally {
      setUploading(false);
      onUploadStateChange?.(false);
    }
  }

  function handleRemove() {
    setLocalPreview(null);
    setUploadError('');
    onChange('');
  }

  const previewSrc = localPreviewUrl || value;

  return (
    <div style={styles.wrap}>
      <label style={styles.label}>{label}</label>
      <div style={styles.row}>
        <input
          style={styles.urlInput}
          value={value}
          placeholder="Paste a photo URL (e.g. Google Drive link)..."
          onChange={e => { setLocalPreview(null); onChange(e.target.value); }}
        />
        <label style={{ ...styles.cameraBtn, ...(uploading ? styles.cameraBtnDisabled : {}) }}>
          {uploading ? 'Uploading…' : 'Take Photo'}
          <input type="file" accept="image/*" capture="environment" style={styles.hiddenInput} disabled={uploading}
            onChange={e => handleFile(e.target.files?.[0])} />
        </label>
      </div>
      {uploadError && <span style={styles.previewError}>{uploadError}</span>}
      {previewSrc?.trim() && !uploadError && (
        <div style={styles.previewRow}>
          {localPreviewUrl
            ? <img src={localPreviewUrl} alt="Preview" style={styles.preview} />
            : <SmartImage src={value} alt="Preview" style={styles.preview}
                fallback={<span style={styles.previewError}>Couldn't load a preview — the link may not be a shareable image.</span>} />}
          <button type="button" style={styles.removeBtn} onClick={handleRemove} disabled={uploading}>Remove</button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', fontWeight: 700, color: '#475569' },
  row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  urlInput: { flex: 1, minWidth: '180px', padding: '10px 12px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  cameraBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#e8eef8', color: '#17355f', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  cameraBtnDisabled: { opacity: 0.6, cursor: 'default' },
  hiddenInput: { display: 'none' },
  previewRow: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' },
  preview: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #dbe3f0' },
  previewError: { fontSize: '11px', color: '#ef6c00', fontWeight: 600 },
  removeBtn: { background: '#fce4ec', color: '#c62828', border: 'none', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' },
};
