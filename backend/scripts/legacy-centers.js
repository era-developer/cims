// The nine Comedkare centers, frozen as they existed when the Excel -> SQLite
// migration ran.
//
// Centers are now rows in the `centers` table, managed by a super admin
// through the UI (see utils/centers.js). The one-off scripts in this
// directory, however, are historical artifacts: they reconcile specific
// legacy spreadsheets ("All 9 center inventory.xlsx", the JP Nagar July 2026
// list) against a specific set of centers, and several of them open their own
// database handle from an argv path rather than the app's default. Pointing
// them at the live centers table would make a replay of a historical migration
// depend on today's center list -- and on the wrong database. They read from
// this frozen copy instead, so their behaviour is reproducible and they cannot
// touch the live `centers` table, which a super admin now edits from Settings.
//
// Do not add new centers here. Add them through the Centers admin screen.

const LEGACY_CENTERS = [
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
  return LEGACY_CENTERS.find(center => center.id === centerId) || null;
}

function requireCenter(centerId) {
  const center = getCenterById(centerId);
  if (!center) {
    throw new Error(`Unknown center: ${centerId}`);
  }
  return center;
}

module.exports = {
  CENTERS: LEGACY_CENTERS,
  LEGACY_CENTERS,
  getCenterById,
  requireCenter,
};
