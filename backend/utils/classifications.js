// The fixed classification list from the v2 requirements doc (VERSION_2_PLAN.md).
// Abbreviations are used in generated asset tags, e.g. JPN-ELEC-00001.
const CLASSIFICATIONS = [
  { name: 'Electronic components', abbr: 'ELEC' },
  { name: 'Safety tools', abbr: 'SAFE' },
  { name: 'Plywood and Hardware', abbr: 'PLYW' },
  { name: 'Single use Consumables', abbr: 'CONS' },
  { name: 'Computer and accessories', abbr: 'COMP' },
  { name: 'Power tools', abbr: 'PWTL' },
  { name: 'Machines', abbr: 'MACH' },
  { name: 'Hand tools', abbr: 'HAND' },
  { name: 'Other hand tools & Spares', abbr: 'HTSP' },
  { name: 'Furniture', abbr: 'FURN' },
  { name: 'Center Infrastructure', abbr: 'CINF' },
  { name: 'Interior infrastructure', abbr: 'IINF' },
  { name: 'Sinages', abbr: 'SIGN' },
];

const LEGACY_CLASSIFICATION = { name: 'Unclassified (Legacy)', abbr: 'LEGACY' };

// Classifications whose items get explicit serial-number tracking by default
// (requirement 2: "unique IDs to critical electronic components... for lifecycle tracking").
const CRITICAL_NAME_KEYWORDS = [
  'raspberry pi', 'jetson nano', 'jetson', 'esp32', 'esp8266', 'arduino', 'sensor',
];

function isCriticalAssetName(name) {
  const normalized = String(name || '').toLowerCase();
  return CRITICAL_NAME_KEYWORDS.some(keyword => normalized.includes(keyword));
}

module.exports = { CLASSIFICATIONS, LEGACY_CLASSIFICATION, isCriticalAssetName };
