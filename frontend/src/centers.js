export const CENTERS = [
  { id: 'jp_nagar', name: 'J P Nagar, Bengaluru', subdomain: 'jpnagar', brand: { primaryColor: '#1a237e', logo: '/logos/jp_nagar.png' } },
  { id: 'yelahanka', name: 'Yelahanka, Bengaluru', subdomain: 'yelahanka', brand: { primaryColor: '#ff6d00', logo: '/logos/yelahanka.png' } },
  { id: 'gopalan_mall', name: 'Gopalan Mall, Bengaluru', subdomain: 'gopalan', brand: { primaryColor: '#2e7d32', logo: '/logos/gopalan.png' } },
  { id: 'mysore', name: 'Mysore', subdomain: 'mysore', brand: { primaryColor: '#8e24aa', logo: '/logos/mysore.png' } },
  { id: 'tumkur', name: 'Tumkur', subdomain: 'tumkur', brand: { primaryColor: '#f57f17', logo: '/logos/tumkur.png' } },
  { id: 'mangalore', name: 'Mangalore', subdomain: 'mangalore', brand: { primaryColor: '#1565c0', logo: '/logos/mangalore.png' } },
  { id: 'hubballi', name: 'Hubballi', subdomain: 'hubballi', brand: { primaryColor: '#ef6c00', logo: '/logos/hubballi.png' } },
  { id: 'belagavi', name: 'Belagavi', subdomain: 'belagavi', brand: { primaryColor: '#1a237e', logo: '/logos/belagavi.png' } },
  { id: 'kalaburagi', name: 'Kalaburagi', subdomain: 'kalaburagi', brand: { primaryColor: '#2e7d32', logo: '/logos/kalaburagi.png' } },
];

export function getCenterName(centerId) {
  return CENTERS.find(center => center.id === centerId)?.name || '';
}

export function getCenterBySubdomain(subdomain) {
  return CENTERS.find(center => center.subdomain === subdomain) || null;
}

export function getCurrentCenter() {
  const hostname = window.location.hostname;
  const subdomain = hostname.split('.')[0];
  return getCenterBySubdomain(subdomain);
}
