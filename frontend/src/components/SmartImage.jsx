import React, { useEffect, useMemo, useState } from 'react';

function extractDriveFileId(url) {
  if (!url) return '';

  const fileMatch = url.match(/\/file\/d\/([^/]+)/i);
  if (fileMatch) return fileMatch[1];

  const openMatch = url.match(/[?&]id=([^&]+)/i);
  if (openMatch) return openMatch[1];

  const userContentMatch = url.match(/[?&]id=([^&]+)/i);
  if (userContentMatch) return userContentMatch[1];

  const googleContentMatch = url.match(/\/d\/([^/=]+)(?:=|$)/i);
  if (googleContentMatch) return googleContentMatch[1];

  return '';
}

function buildImageCandidates(src) {
  const raw = String(src || '').trim();
  if (!raw) return [];

  const driveId = extractDriveFileId(raw);
  const candidates = [];

  if (driveId) {
    const directImage = `https://lh3.googleusercontent.com/d/${driveId}=w1600`;
    const thumbnailImage = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`;
    candidates.push(directImage);
    candidates.push(thumbnailImage);
    candidates.push(raw);
    candidates.push(`/api/components/image?src=${encodeURIComponent(directImage)}`);
    candidates.push(`/api/components/image?src=${encodeURIComponent(thumbnailImage)}`);
    candidates.push(`/api/components/image?src=${encodeURIComponent(raw)}`);
  }
  else {
    candidates.push(raw);
  }

  return [...new Set(candidates)];
}

export default function SmartImage({ src, alt, style, fallback = null, ...imgProps }) {
  const candidates = useMemo(() => buildImageCandidates(src), [src]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  if (!candidates.length || candidateIndex >= candidates.length) {
    return fallback;
  }

  return (
    <img
      {...imgProps}
      src={candidates[candidateIndex]}
      alt={alt}
      style={style}
      loading={imgProps.loading || 'lazy'}
      referrerPolicy={imgProps.referrerPolicy || 'no-referrer'}
      onError={() => setCandidateIndex(current => current + 1)}
    />
  );
}
