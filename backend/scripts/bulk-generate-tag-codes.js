// One-time bulk rewrite: give every existing catalog item at a center a
// readable Tag Code (e.g. "ARDU" for Arduino Uno, "BUZZ" for Buzzer) and
// re-tag every physical unit under it to the new
// <CENTER>/<CLASS>/<TAGCODE>-<SEQ> scheme, instead of requiring an admin to
// set this one component at a time via the Edit Component modal.
//
// Usage: node bulk-generate-tag-codes.js <db-path> <center-id> [--apply]

const { openDatabase } = require('../utils/db');
const { requireCenter } = require('../utils/centers');
const { classificationAbbr } = require('../utils/assetTag');

const STOPWORDS = new Set(['and', 'or', 'for', 'of', 'the', 'a', 'an', 'to', 'no', 'per', 'with', 'without']);

function significantWords(name) {
  const cleaned = String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  // Pure numbers ("300" in "Bo Motor 300 Rpm", "9" in "9V Battery") are kept
  // -- they're often exactly the value that distinguishes one variant from
  // another -- just never picked as the base/prefix word below.
  return cleaned.split(/\s+/).filter(w => w && !STOPWORDS.has(w.toLowerCase()));
}

function cleanToken(word) {
  return String(word || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Many families differ only by a value/model token after a shared first
// word (Resistor 1K / 10K / 150K, Screw M3 / M4, HSS Drill Bit 6mm/8mm) --
// for those, a code built from that value reads far better and stays
// consistent across the whole family than an arbitrary collision counter.
function generateTagCode(name, usedCodes) {
  const words = significantWords(name);
  if (!words.length) {
    let n = 1;
    while (usedCodes.has(`ITEM${n}`)) n += 1;
    return `ITEM${n}`;
  }
  const firstIdx = words.findIndex(w => !/^\d+$/.test(w));
  const first = firstIdx >= 0 ? words[firstIdx] : words[0];
  const firstClean = cleanToken(first);
  const rest = words.filter((w, i) => i !== (firstIdx >= 0 ? firstIdx : 0));
  const digitWords = rest.filter(w => /\d/.test(w));

  const candidates = [];
  // Two varying dimensions at once (e.g. "Screw M4*16Mm" -- thread size AND
  // length both matter, since M3 and M4 versions can share the same
  // length): combine every value token, not just one.
  if (digitWords.length >= 2) {
    candidates.push((firstClean.slice(0, 2) + digitWords.map(w => cleanToken(w)).join('')).slice(0, 10));
  }
  // One varying dimension, and prefer the LAST digit-bearing word over the
  // first: in "Screw M3*16Mm" the thread size (M3) is shared across the
  // whole family while the trailing length (16Mm) is what distinguishes it.
  if (digitWords.length >= 1) {
    const valueWord = digitWords[digitWords.length - 1];
    candidates.push((firstClean.slice(0, 3) + cleanToken(valueWord).slice(0, 5)).slice(0, 8));
  }
  candidates.push(firstClean.slice(0, 4));
  if (rest[0]) candidates.push((firstClean.slice(0, 3) + cleanToken(rest[0]).slice(0, 3)).slice(0, 8));
  for (let len = 5; len <= 8; len += 1) candidates.push(firstClean.slice(0, len));

  for (const candidate of candidates) {
    if (candidate && candidate.length >= 2 && !usedCodes.has(candidate)) return candidate;
  }
  const base = firstClean.slice(0, 4) || 'ITEM';
  let n = 2;
  while (usedCodes.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

function run(dbPath, centerId, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const center = requireCenter(centerId);

  const classifications = db.prepare('SELECT id, name FROM classifications').all();
  const classById = new Map(classifications.map(c => [c.id, c]));

  const items = db.prepare(`
    SELECT id, name, classification_id FROM product_catalog WHERE center_id = ? ORDER BY name
  `).all(center.id);

  const report = { totalItems: items.length, codes: [], assetsRetagged: 0, fatalError: null, applied: false };

  db.exec('BEGIN TRANSACTION');
  try {
    const usedCodes = new Set();
    const updateCatalog = db.prepare('UPDATE product_catalog SET tag_code = ? WHERE id = ?');
    const updateAssetTag = db.prepare('UPDATE assets SET asset_tag = ? WHERE id = ?');

    for (const item of items) {
      const code = generateTagCode(item.name, usedCodes);
      usedCodes.add(code);
      updateCatalog.run(code, item.id);

      const classification = classById.get(item.classification_id);
      const abbr = classificationAbbr(classification ? classification.name : '');
      const units = db.prepare('SELECT id FROM assets WHERE catalog_id = ? ORDER BY added_date, id').all(item.id);
      units.forEach((unit, index) => {
        const newTag = `${center.code}/${abbr}/${code}-${String(index + 1).padStart(2, '0')}`;
        updateAssetTag.run(newTag, unit.id);
      });
      report.assetsRetagged += units.length;
      report.codes.push({ name: item.name, code, units: units.length });
    }

    if (apply) {
      db.exec('COMMIT');
      report.applied = true;
    } else {
      db.exec('ROLLBACK');
      report.applied = false;
    }
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
  }

  return report;
}

module.exports = { run, generateTagCode };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath, centerId] = args.filter(a => a !== '--apply');
  if (!dbPath || !centerId) {
    console.error('Usage: node bulk-generate-tag-codes.js <db-path> <center-id> [--apply]');
    process.exit(1);
  }
  const report = run(dbPath, centerId, { apply });
  console.log(JSON.stringify({ ...report, codes: undefined }, null, 2));
  console.log('Sample codes:', JSON.stringify(report.codes.slice(0, 40), null, 2));
}
