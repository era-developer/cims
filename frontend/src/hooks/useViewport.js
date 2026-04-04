import { useEffect, useState } from 'react';

function getViewportWidth() {
  if (typeof window === 'undefined') return 1280;
  return window.innerWidth;
}

export default function useViewport() {
  const [width, setWidth] = useState(getViewportWidth);

  useEffect(() => {
    function handleResize() {
      setWidth(getViewportWidth());
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    width,
    isTablet: width <= 1024,
    isMobile: width <= 768,
  };
}
