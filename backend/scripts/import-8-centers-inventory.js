// One-off backfill: real physical stock for the 8 non-JP-Nagar centers,
// sourced from "All 9 center inventory (1).xlsx" (two sheets: "Comedk "
// with 4 layered stock-check snapshots back to 2023, and "ERA Foundation"
// with a single more recent snapshot for VTU/VRIF-funded purchases).
//
// JP Nagar rows in both sheets are skipped entirely -- JP Nagar's stock was
// already reconciled via import-jp-nagar-july2026.js and must not be
// touched again here.
//
// Every one of the 8 centers already carries JP Nagar's full catalog
// structure mirrored onto it at zero stock (see VERSION_2_PLAN.md /
// reset-other-centers-to-jp-nagar-structure.js). So "new item" here means
// "not in that CENTER's own catalog", matched by normalized name --
// existing 0-stock catalog rows are REUSED (never duplicated), and this
// script is what gives them their first real assets.
//
// Quantity handling: the "Comedk " sheet keeps a chain of literal, human
// -entered numbers (never formulas) for the qty-consumed-this-period and
// running-final-qty columns at each snapshot; the current (May 2026) final
// qty is recomputed here directly from those literals rather than trusting
// the sheet's own cached formula results, because ~1,750 of ~9,363 rows
// have no cached result for that cell (a real gap in the source file, not
// a bug in this script) -- see header comment on parseComedkSheet().
//
// Usage:
//   node import-8-centers-inventory.js <db-path>              (dry run, report only)
//   node import-8-centers-inventory.js <db-path> --apply       (writes, in a transaction)

const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const { openDatabase } = require('../utils/db');
const { CENTERS } = require('../utils/centers');
const { createAssetTagGenerator } = require('../utils/assetTag');

const WORKBOOK_PATH = 'D:/cims/All 9 center inventory (1).xlsx';

const CLASSIFICATION_MAP = {
  'center infrasructure': 'Center Infrastructure',
  'single use consumables': 'Single use Consumables',
  'plywood and hardware': 'Plywood and Hardware',
  'safety tools': 'Safety tools',
  'electronic components': 'Electronic components',
  electronics: 'Electronic components',
  machines: 'Machines',
  'other handtools & spares': 'Other hand tools & Spares',
  'power tools': 'Power tools',
  furniture: 'Furniture',
  'hand tools': 'Hand tools',
  signages: 'Sinages',
  'computers & accessories': 'Computer and accessories',
  chemical: 'Single use Consumables', // no dedicated category; user-confirmed mapping
  'interior furnishing': null, // civil/interior fit-out work, not lendable inventory
};

// Center-name spelling variants seen across the two sheets -> internal id.
// "comedk office in stock" (head-office equipment, not a lending center)
// and any name not listed here are excluded, per user decision.
const CENTER_NAME_MAP = {
  belgaum: 'belagavi',
  belagavi: 'belagavi',
  'gopalan mall': 'gopalan_mall',
  kalburgi: 'kalaburagi',
  kalaburagi: 'kalaburagi',
  mangalore: 'mangalore',
  mysore: 'mysore',
  yalahanka: 'yelahanka',
  yelahanka: 'yelahanka',
  tumakuru: 'tumkur',
  tumkur: 'tumkur',
  hubballi: 'hubballi',
  huballi: 'hubballi',
  'jp nagar': 'jp_nagar', // present in the sheet, explicitly skipped below
  'mysore road': 'gopalan_mall', // user-confirmed: Gopalan Mall sits on Mysore Road
};

const TARGET_CENTER_IDS = new Set(CENTERS.map(c => c.id).filter(id => id !== 'jp_nagar'));

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCenter(raw) {
  const key = normalizeName(raw);
  return CENTER_NAME_MAP[key] || null;
}

function cellNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null; // formula cell with no usable literal text
  const s = String(v).trim();
  return s || null;
}

function cellDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// "Comedk " sheet: 4 layered snapshots, but NOT one uniform formula down
// the whole sheet -- items added after the July-2024 audit have no July-
// 2024 baseline (column S blank for them), so the sheet switches formula
// mid-column: early rows compute "Final Qty July 2025" (col 28/AB) as
// S-AA, later-added rows as BillQty-AA (col 9/I minus col 27/AA); "Final
// Qty May 2026" (col 37/AK) is almost always AB-AJ, except one trailing
// region (rows 8177+, items added even more recently) which is BillQty-AJ
// directly. There are 14 distinct AB formula regions and 16 AK regions in
// this file. Around 19% of cells in both columns have no cached formula
// result at all (a gap in the source file), so this can't be read off the
// sheet directly -- collectFormulaRegions()/resolveColumn() below rebuild
// the correct per-row value from each region's actual formula text rather
// than assuming a single fixed rule, which an earlier version of this
// script got wrong (see git history) and silently zeroed out real stock
// for items added after the original audit (e.g. Hubballi's laser cutter
// and 3D printers).
function collectFormulaRegions(ws, col) {
  const regions = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(col).value;
    if (v && typeof v === 'object' && typeof v.formula === 'string') {
      let end = r;
      if (v.ref && v.ref.includes(':')) {
        end = parseInt(v.ref.split(':')[1].replace(/\D/g, ''), 10);
      }
      regions.push({ start: r, end, formula: v.formula });
    }
  }
  return regions;
}

function findRegion(regions, row) {
  return regions.find(reg => row >= reg.start && row <= reg.end) || null;
}

// Resolves "Final Qty July 2025" (col 28) for one row: S-AA or I-AA.
function resolveAB(row, abRegions) {
  const cell = row.getCell(28).value;
  if (typeof cell === 'number') return cell;
  if (cell && typeof cell.result === 'number') return cell.result;
  const region = findRegion(abRegions, row.number);
  if (!region) return null;
  const aa = cellNumber(row.getCell(27).value);
  const base = region.formula.trim().charAt(0) === 'I' ? cellNumber(row.getCell(9).value) : cellNumber(row.getCell(19).value);
  return base - aa;
}

// Resolves "Final Qty May 2026" (col 37) for one row: AB-AJ or I-AJ.
function resolveAK(row, akRegions, abRegions) {
  const cell = row.getCell(37).value;
  if (typeof cell === 'number') return cell;
  if (cell && typeof cell.result === 'number') return cell.result;
  const region = findRegion(akRegions, row.number);
  if (!region) return null;
  const aj = cellNumber(row.getCell(36).value);
  const base = region.formula.trim().charAt(0) === 'I'
    ? cellNumber(row.getCell(9).value)
    : resolveAB(row, abRegions);
  if (base === null) return null;
  return base - aj;
}

function parseComedkSheet(ws) {
  const abRegions = collectFormulaRegions(ws, 28);
  const akRegions = collectFormulaRegions(ws, 37);
  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const centerRaw = row.getCell(45).value;
    if (!cellText(centerRaw)) continue;
    const resolved = resolveAK(row, akRegions, abRegions);
    const finalQty = resolved === null ? 0 : resolved;
    rows.push({
      sourceSheet: 'Comedk',
      row: r,
      classification: cellText(row.getCell(2).value),
      vendor: cellText(row.getCell(3).value),
      invoiceNo: cellText(row.getCell(4).value),
      invoiceDate: cellDate(row.getCell(6).value),
      name: cellText(row.getCell(7).value) || cellText(row.getCell(8).value),
      desc: cellText(row.getCell(8).value),
      unitPrice: cellNumber(row.getCell(10).value),
      gstFraction: cellNumber(row.getCell(15).value),
      qty: finalQty,
      centerRaw: String(centerRaw).trim(),
      programName: null,
      comments: cellText(row.getCell(46).value),
    });
  }
  return rows;
}

// "ERA Foundation" sheet: single snapshot. Final qty (col 18/R) = Bill Qty
// (col 8/H, always literal) - Qty Consumed (col 17/Q, always literal),
// recomputed the same way for the same reason (27 of 317 rows missing a
// cached result on column 18).
function parseEraSheet(ws) {
  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const centerRaw = row.getCell(26).value;
    if (!cellText(centerRaw)) continue;
    const billQty = cellNumber(row.getCell(8).value);
    const consumed = cellNumber(row.getCell(17).value);
    const finalQty = billQty - consumed;
    rows.push({
      sourceSheet: 'ERA Foundation',
      row: r,
      classification: cellText(row.getCell(2).value),
      vendor: cellText(row.getCell(3).value),
      invoiceNo: cellText(row.getCell(4).value),
      invoiceDate: cellDate(row.getCell(5).value),
      name: cellText(row.getCell(6).value) || cellText(row.getCell(7).value),
      desc: cellText(row.getCell(7).value),
      unitPrice: cellNumber(row.getCell(9).value),
      gstFraction: cellNumber(row.getCell(14).value),
      qty: finalQty,
      centerRaw: String(centerRaw).trim(),
      programName: cellText(row.getCell(27).value),
      comments: cellText(row.getCell(28).value),
    });
  }
  return rows;
}

async function parseWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK_PATH);
  const comedk = parseComedkSheet(wb.worksheets[0]);
  const era = parseEraSheet(wb.worksheets[1]);
  return [...comedk, ...era];
}

function getOrCreateByName(db, table, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(trimmed);
  if (existing) return existing.id;
  return db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(trimmed).lastInsertRowid;
}

function run(dbPath, allRows, { apply = false } = {}) {
  const db = openDatabase(dbPath);

  const businessHeadByName = new Map(db.prepare('SELECT id, name FROM business_heads').all().map(b => [b.name, b.id]));
  const COMEDK_BUSINESS_HEAD_ID = businessHeadByName.get('ComedK') || null;
  const ERA_BUSINESS_HEAD_ID = businessHeadByName.get('ERA Foundation') || null;

  const classifications = db.prepare('SELECT id, name FROM classifications').all();
  const classIdByName = new Map(classifications.map(c => [c.name, c.id]));
  const classById = new Map(classifications.map(c => [c.id, c]));

  const report = {
    totalRows: allRows.length,
    skippedJpNagar: 0,
    skippedUnrecognizedCenter: [],
    skippedInteriorFurnishing: 0,
    skippedZeroOrNegativeQty: 0,
    skippedNoName: 0,
    flaggedFractionalQty: [],
    unknownClassification: [],
    byCenter: {},
    invoicesCreated: 0,
    lineItemsCreated: 0,
    assetsCreated: 0,
    newCatalogItemsCreated: 0,
    matchedExistingCatalogItems: 0,
    applied: false,
    fatalError: null,
  };
  for (const id of TARGET_CENTER_IDS) {
    report.byCenter[id] = {
      rows: 0, invoicesCreated: 0, assetsCreated: 0, newCatalogItems: 0, matchedExistingItems: 0,
    };
  }

  // Per-center normalized-name -> catalog row map, seeded from each
  // center's EXISTING catalog (the 618 JP-Nagar-mirrored, zero-stock
  // placeholder rows). Matches here are reused, never duplicated -- this
  // is the "name duplication" check.
  const catalogByCenter = new Map();
  for (const centerId of TARGET_CENTER_IDS) {
    const existing = db.prepare('SELECT id, name, tag_code, classification_id FROM product_catalog WHERE center_id = ?').all(centerId);
    const byNorm = new Map(existing.map(c => [normalizeName(c.name), c]));
    catalogByCenter.set(centerId, byNorm);
  }

  function getOrCreateCatalog(centerId, name, classificationId) {
    const byNorm = catalogByCenter.get(centerId);
    const norm = normalizeName(name);
    const existing = byNorm.get(norm);
    if (existing) return { id: existing.id, tagCode: existing.tag_code, isNew: false };
    const id = db.prepare(`
      INSERT INTO product_catalog (center_id, name, classification_id, unit) VALUES (?, ?, ?, 'pcs')
    `).run(centerId, name, classificationId).lastInsertRowid;
    const created = { id, name, tag_code: null, classification_id: classificationId };
    byNorm.set(norm, created);
    return { id, tagCode: null, isNew: true };
  }

  // Filter + resolve center/classification for every row first.
  const usable = [];
  for (const r of allRows) {
    const centerId = normalizeCenter(r.centerRaw);
    if (centerId === 'jp_nagar') { report.skippedJpNagar++; continue; }
    if (!centerId || !TARGET_CENTER_IDS.has(centerId)) {
      report.skippedUnrecognizedCenter.push({ row: r.row, sheet: r.sourceSheet, centerRaw: r.centerRaw });
      continue;
    }
    if (normalizeName(r.classification) === 'interior furnishing') { report.skippedInteriorFurnishing++; continue; }
    if (!r.name) { report.skippedNoName++; continue; }

    let qty = r.qty;
    if (qty === null || qty <= 0) { report.skippedZeroOrNegativeQty++; continue; }
    if (!Number.isInteger(qty)) {
      report.flaggedFractionalQty.push({ row: r.row, sheet: r.sourceSheet, name: r.name, rawQty: qty, roundedTo: Math.floor(qty) });
      qty = Math.floor(qty);
      if (qty <= 0) continue;
    }

    const mappedClassName = CLASSIFICATION_MAP[normalizeName(r.classification)];
    if (mappedClassName === undefined) {
      report.unknownClassification.push({ row: r.row, sheet: r.sourceSheet, name: r.name, classification: r.classification });
      continue;
    }
    if (mappedClassName === null) { report.skippedInteriorFurnishing++; continue; }
    const classificationId = classIdByName.get(mappedClassName);

    report.byCenter[centerId].rows++;
    usable.push({ ...r, centerId, qty, classificationId });
  }

  // Group into invoices by center + vendor + invoice number (mirrors
  // import-jp-nagar-july2026.js) so procurement history (vendor, GST,
  // price, date) is preserved rather than creating orphan assets.
  const groups = new Map();
  for (const r of usable) {
    const key = `${r.centerId}::${r.vendor || 'Unknown'}::${r.invoiceNo || 'NA'}::${r.sourceSheet}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const nextAssetTag = createAssetTagGenerator(db);
  const centerById = new Map(CENTERS.map(c => [c.id, c]));

  db.exec('BEGIN TRANSACTION');
  try {
    let anonSeq = 0;
    for (const items of groups.values()) {
      const first = items[0];
      const center = centerById.get(first.centerId);
      const vendorId = getOrCreateByName(db, 'vendors', first.vendor || `Unknown Vendor (${first.sourceSheet} import)`);
      const sourceTag = first.sourceSheet === 'ERA Foundation' ? 'ERA' : 'AUDIT';
      const baseInvoiceNumber = first.invoiceNo || `${sourceTag}-${++anonSeq}`;
      let invoiceNumber = baseInvoiceNumber;
      let suffix = 0;
      while (db.prepare('SELECT id FROM invoices WHERE center_id = ? AND invoice_number = ?').get(center.id, invoiceNumber)) {
        suffix += 1;
        invoiceNumber = `${baseInvoiceNumber}-${sourceTag}${suffix}`;
      }

      let taxableTotal = 0;
      let gstTotal = 0;
      const computed = items.map(li => {
        const gstPercent = li.gstFraction * 100;
        const taxable = li.qty * (li.unitPrice || 0);
        const gst = taxable * (gstPercent / 100);
        taxableTotal += taxable;
        gstTotal += gst;
        return { ...li, gstPercent, taxable, gst };
      });
      const totalBillValue = taxableTotal + gstTotal;
      const isEra = first.sourceSheet === 'ERA Foundation';
      const createdBy = isEra ? 'system:all_centers_inventory_import_era' : 'system:all_centers_inventory_import';
      const businessHeadId = isEra ? ERA_BUSINESS_HEAD_ID : COMEDK_BUSINESS_HEAD_ID;

      const invoiceId = db.prepare(`
        INSERT INTO invoices
          (center_id, invoice_number, invoice_date, vendor_id, business_head_id, taxable_value, gst_value, total_bill_value, is_legacy, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(center.id, invoiceNumber, first.invoiceDate || null, vendorId, businessHeadId, taxableTotal, gstTotal, totalBillValue, createdBy).lastInsertRowid;
      report.invoicesCreated += 1;
      report.byCenter[center.id].invoicesCreated += 1;

      for (const li of computed) {
        const purposeNote = li.programName
          ? `${first.sourceSheet} import -- Program: ${li.programName}`
          : `${first.sourceSheet} import (all-centers inventory backfill)`;
        const lineItemId = db.prepare(`
          INSERT INTO invoice_line_items
            (invoice_id, classification_id, asset_name, bill_quantity, unit, unit_price, taxable_value, gst_percent, gst_value, total_value, purchased_for)
          VALUES (?, ?, ?, ?, 'pcs', ?, ?, ?, ?, ?, ?)
        `).run(invoiceId, li.classificationId, li.name, li.qty, li.unitPrice, li.taxable, li.gstPercent, li.gst,
               li.taxable + li.gst, purposeNote).lastInsertRowid;
        report.lineItemsCreated += 1;

        const catalog = getOrCreateCatalog(li.centerId, li.name, li.classificationId);
        if (catalog.isNew) { report.newCatalogItemsCreated++; report.byCenter[center.id].newCatalogItems++; }
        else { report.matchedExistingCatalogItems++; report.byCenter[center.id].matchedExistingItems++; }

        const classification = classById.get(li.classificationId);
        const now = new Date().toISOString();
        for (let i = 0; i < li.qty; i += 1) {
          const assetId = crypto.randomUUID();
          const assetTag = nextAssetTag(center.code, center.id, li.classificationId, classification.name, catalog.id, catalog.tagCode);
          db.prepare(`
            INSERT INTO assets
              (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name, description,
               unit, unit_value, status, is_legacy, active, added_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pcs', ?, 'available', 1, 1, ?)
          `).run(assetId, assetTag, center.id, catalog.id, lineItemId, li.classificationId, li.name, li.desc || null,
                 li.unitPrice, now);
          db.prepare(`
            INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
            VALUES (?, 'procured', NULL, 'available', ?, ?, ?, ?)
          `).run(assetId, center.id, `Backfilled from ${first.sourceSheet} all-centers inventory import`, createdBy, now);
          report.assetsCreated += 1;
          report.byCenter[center.id].assetsCreated += 1;
        }
      }
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
    report.fatalStack = err.stack;
  }

  return report;
}

module.exports = { run, parseWorkbook, normalizeName, normalizeCenter, CLASSIFICATION_MAP, CENTER_NAME_MAP };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const [dbPath] = args.filter(a => a !== '--apply');
    if (!dbPath) {
      console.error('Usage: node import-8-centers-inventory.js <db-path> [--apply]');
      process.exit(1);
    }
    const rows = await parseWorkbook();
    const report = run(dbPath, rows, { apply });
    console.log(JSON.stringify(report, null, 2));
  })();
}
