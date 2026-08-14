// Recovers component photos from the archived v1 Excel inventory
// (legacy_excel_data_archive/jp_nagar_inventory.xlsx) and attaches them to
// the matching current catalog row by name. The v1 sheet's names were more
// elaborate/inconsistently worded than the July 2026 rebuild's, so matching
// runs in two passes:
//   1. Exact match after normalizing case/punctuation/whitespace.
//   2. Fuzzy "word subset" match (every significant word of the shorter
//      name appears in the longer one) with a manually-reviewed exclude
//      list for the two pairs that looked right by word-overlap but are
//      actually different components (a board vs. its accessory cable).
// Applied to every center's catalog row with that name (not just JP Nagar),
// since all 9 centers currently share the identical catalog structure --
// only fills in rows that don't already have an image, never overwrites.
//
// Usage: node backfill-photos-from-legacy.js <db-path> <legacy-xlsx-path> [--apply]

const path = require('path');
const ExcelJS = require('exceljs');
const { openDatabase } = require('../utils/db');

const MANUAL_EXCLUDE = new Set([
  'Arduino Mega',       // fuzzy-matched "Cable For Arduino Mega" -- a cable, not the board itself
  'BeagleBone Black',   // fuzzy-matched generic "Black" -- unrelated item, false positive on the word "black"
]);

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function words(s) {
  return normalize(s).split(' ').filter(w => w.length > 1);
}
function codeTokens(s) {
  return words(s).filter(w => /[a-z]/.test(w) && /[0-9]/.test(w));
}

async function loadLegacyPhotoRows(xlsxPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, num) => {
    if (num === 1) return;
    const name = row.getCell(4).value;
    const image = row.getCell(13).value;
    if (name && image && String(image).trim()) {
      rows.push({ name: String(name).trim(), image: String(image).trim() });
    }
  });
  return rows;
}

function buildMatchPlan(legacyRows, currentCatalogNames) {
  const byNorm = new Map();
  for (const name of currentCatalogNames) {
    const n = normalize(name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(name);
  }

  const plan = []; // { legacyName, catalogName, image, matchType }
  const matchedLegacyNames = new Set();

  for (const row of legacyRows) {
    if (MANUAL_EXCLUDE.has(row.name)) continue;
    const n = normalize(row.name);
    const exact = byNorm.get(n);
    if (exact && exact.length === 1) {
      plan.push({ legacyName: row.name, catalogName: exact[0], image: row.image, matchType: 'exact' });
      matchedLegacyNames.add(row.name);
    }
  }

  const stillUnmatched = legacyRows.filter(r => !matchedLegacyNames.has(r.name) && !MANUAL_EXCLUDE.has(r.name));
  for (const row of stillUnmatched) {
    const oldWords = new Set(words(row.name));
    const oldCodes = new Set(codeTokens(row.name));
    const candidates = [];
    for (const catalogName of currentCatalogNames) {
      const curWords = new Set(words(catalogName));
      const curCodes = new Set(codeTokens(catalogName));
      if (curWords.size === 0) continue;
      const [shorter, longer] = curWords.size <= oldWords.size ? [curWords, oldWords] : [oldWords, curWords];
      const allContained = [...shorter].every(w => longer.has(w));
      const ratio = shorter.size / longer.size;
      if (!allContained || ratio < 0.5) continue;
      const allCodes = new Set([...oldCodes, ...curCodes]);
      let codeConflict = false;
      for (const code of allCodes) {
        const inOld = oldCodes.has(code) || normalize(row.name).includes(code);
        const inCur = curCodes.has(code) || normalize(catalogName).includes(code);
        if (!(inOld && inCur)) { codeConflict = true; break; }
      }
      if (codeConflict) continue;
      candidates.push(catalogName);
    }
    if (candidates.length === 1) {
      plan.push({ legacyName: row.name, catalogName: candidates[0], image: row.image, matchType: 'fuzzy' });
    }
  }

  return plan;
}

function run(dbPath, xlsxPath, { apply = false } = {}) {
  return loadLegacyPhotoRows(xlsxPath).then(legacyRows => {
    const db = openDatabase(dbPath);
    const currentCatalog = db.prepare("SELECT DISTINCT name FROM product_catalog").all().map(r => r.name);
    const plan = buildMatchPlan(legacyRows, currentCatalog);

    const report = { legacyRowsWithImages: legacyRows.length, planned: plan.length, exactMatches: 0, fuzzyMatches: 0, applied: false, updatedRows: 0, fatalError: null, skippedAlreadyHasImage: 0 };
    plan.forEach(p => { if (p.matchType === 'exact') report.exactMatches++; else report.fuzzyMatches++; });

    db.exec('BEGIN TRANSACTION');
    try {
      for (const p of plan) {
        const result = db.prepare(`
          UPDATE product_catalog SET image = ? WHERE name = ? AND (image IS NULL OR image = '')
        `).run(p.image, p.catalogName);
        report.updatedRows += result.changes;
      }
      if (apply) {
        db.exec('COMMIT');
        report.applied = true;
      } else {
        db.exec('ROLLBACK');
      }
    } catch (err) {
      db.exec('ROLLBACK');
      report.fatalError = err.message;
    }

    report.plan = plan;
    return report;
  });
}

module.exports = { run, buildMatchPlan, loadLegacyPhotoRows, MANUAL_EXCLUDE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath, xlsxPath] = args.filter(a => a !== '--apply');
  if (!dbPath || !xlsxPath) {
    console.error('Usage: node backfill-photos-from-legacy.js <db-path> <legacy-xlsx-path> [--apply]');
    process.exit(1);
  }
  run(dbPath, xlsxPath, { apply }).then(report => {
    const { plan, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
  });
}
