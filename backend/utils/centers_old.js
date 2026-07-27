console.log('centers.js loaded');

const CENTERS = [
  { id: 'jp_nagar', code: 'JPN', name: 'J P Nagar, Bengaluru' },
  { id: 'yelahanka', code: 'YLK', name: 'Yelahanka, Bengaluru' },
  { id: 'gopalan_mall', code: 'GPM', name: 'Gopalan Mall, Bengaluru' },
  { id: 'mysore', code: 'MYS', name: 'Mysore' },
  { id: 'tumkur', code: 'TMK', name: 'Tumkur' },
  { id: 'mangalore', code: 'MLR', name: 'Mangalore' },
  { id: 'hubballi', code: 'HBL', name: 'Hubballi' },
  { id: 'belagavi', code: 'BLG', name: 'Belagavi' },
  { id: 'kalaburagi', code: 'KLB', name: 'Kalaburagi' },
];

function getCenterById(centerId) {
  return CENTERS.find(center => center.id === centerId) || null;
}

function requireCenter(centerId) {
  const center = getCenterById(centerId);
  if (!center) {
    throw new Error(`Unknown center: ${centerId}`);
  }
  return center;
}

module.exports = {
  CENTERS,
  getCenterById,
  requireCenter,
};

module.exports = {
  CENTERS,
  getCenterById,
  requireCenter,
};
