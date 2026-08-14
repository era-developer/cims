// Supersedes import-8-centers-inventory.js. That script only recorded each
// center's CURRENT remaining stock as fresh 'available' assets, silently
// dropping everything the audit trail shows as lost/consumed along the way
// -- inconsistent with how JP Nagar itself was actually built (see
// rebuild-jp-nagar-full-history.js), where roughly half of all historical
// units ended up as real 'damaged' assets with dated lifecycle events, not
// deleted from history. This script applies that exact same methodology
// to the other 8 centers, from "All 9 center inventory (1).xlsx".
//
// Per-row quantity history, mirroring rebuild-jp-nagar-full-history.js's
// computeRowQuantities() exactly (see that file's header comment for full
// rationale) -- deliberately NOT using the sheet's own cached AB/AK
// formula results (missing on ~19% of cells, and not even uniform: the
// "Comedk " sheet silently switches which columns feed the formula
// partway through, see git history on import-8-centers-inventory.js for
// how that was discovered). Instead this recomputes directly from the
// columns that are always literal in every row:
//   originalQty   = Bill Qty (col 9/I), or the July-2024 final qty
//                   (col 19/S) when Bill Qty itself is blank (item has no
//                   original-purchase record, only shows up from its
//                   first audit onward)
//   period1Loss   = originalQty - (col 19/S, or originalQty if S blank)
//   period2Loss   = col 27/AA (literal "qty consumed" 2024->2025)
//   period3Loss   = col 36/AJ (literal "qty consumed" 2025->2026)
//   available     = originalQty - period1Loss - period2Loss - period3Loss
// The "ERA Foundation" sheet only has one snapshot (no 3-period history):
//   originalQty = Bill Qty (col 8/H), loss = col 17/Q, available = col 18/R.
//
// Each historically-lost unit gets its own asset with a lifecycle event
// dated at the audit checkpoint where the loss was detected (exact date
// within that window isn't knowable from the source data, and the event
// notes say so explicitly) -- stops at 'damaged', not 'disposed', same as
// JP Nagar: these are audit-detected losses, not confirmed write-offs. An
// admin reviews and moves each one on via the app.
//
// "Interior Furnishing" is NOT excluded here (unlike the superseded
// script) -- civil/fit-out work becomes ONE fixed, non-exploded asset per
// line item at the full scope value, same as JP Nagar.
//
// Name-dedup, center-name normalization, classification mapping, and
// business-head attribution are unchanged from import-8-centers-
// inventory.js (those parts were correct) -- reused verbatim below.
//
// Usage:
//   node rebuild-8-centers-full-history.js <db-path>              (dry run, report only)
//   node rebuild-8-centers-full-history.js <db-path> --apply       (writes, in a transaction)

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { openDatabase } = require('../utils/db');
const { CENTERS } = require('../utils/centers');
const { createAssetTagGenerator } = require('../utils/assetTag');

const WORKBOOK_PATH = 'D:/cims/All 9 center inventory (1).xlsx';

// 'electronic components' and 'electronics' are the same real-world
// category under two spellings in the source sheet -- both map to the
// single "Electronic components" classification (verified: the live DB
// has no separate "Electronics" row, so this was never actually split at
// the data level, just in the raw sheet text).
// 'interior furnishing' and 'signages' are excluded entirely (mapped to
// null) per explicit instruction -- civil/fit-out work and signage boards
// aren't lendable component inventory. This matches the precedent already
// applied to JP Nagar (see remove-interior-furnishing.js): those items
// were added once for insurance-value reconciliation, then removed after
// review. Not worth creating in the first place here.
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
  signages: null,
  'computers & accessories': 'Computer and accessories',
  chemical: 'Single use Consumables', // no dedicated category; user-confirmed mapping
  'interior furnishing': null,
};

const CONSUMABLE_CLASSIFICATIONS = new Set(['single use consumables', 'plywood and hardware']);

const PERIOD_LABELS = [
  { key: 'period1', date: '2024-07-06', desc: 'between the original purchase and the July 2024 stock audit' },
  { key: 'period2', date: '2025-06-20', desc: 'between the July 2024 and ~June 2025 stock audits' },
  { key: 'period3', date: '2026-07-01', desc: 'between the ~2025 stock audit and the July 2026 stock audit' },
];
// The "ERA Foundation" sheet has one snapshot, not three -- its single
// loss checkpoint is dated at the same final audit as JP Nagar's period 3.
const ERA_SINGLE_PERIOD = { desc: 'between original purchase and the July 2026 stock check', date: '2026-07-01' };

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
  return CENTER_NAME_MAP[normalizeName(raw)] || null;
}

function cellNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cellRaw(v) {
  // Like cellNumber but preserves "blank" (null) vs "explicit zero" --
  // needed for originalQty's fallback rule, which cares whether Bill Qty
  // was ever recorded at all.
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('').trim() || null;
    return null;
  }
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

function computeComedkQuantities(row) {
  const billQty = cellRaw(row.getCell(9).value); // I
  const afterP1Raw = cellRaw(row.getCell(19).value); // S
  const period2Loss = cellNumber(row.getCell(27).value); // AA
  const period3Loss = cellNumber(row.getCell(36).value); // AJ

  let originalQty;
  let afterP1;
  let period1Loss;
  if (billQty !== null) {
    originalQty = billQty;
    afterP1 = afterP1Raw !== null ? afterP1Raw : billQty;
    period1Loss = originalQty - afterP1;
  } else if (afterP1Raw !== null) {
    originalQty = afterP1Raw;
    afterP1 = afterP1Raw;
    period1Loss = 0;
  } else {
    return null;
  }

  const afterP2 = afterP1 - period2Loss;
  const afterP3 = afterP2 - period3Loss;

  const flooredOriginal = Math.floor(originalQty);
  const flooredLoss1 = Math.max(0, Math.floor(period1Loss));
  const flooredLoss2 = Math.max(0, Math.floor(period2Loss));
  const flooredLoss3 = Math.max(0, Math.floor(period3Loss));
  const available = Math.max(0, flooredOriginal - flooredLoss1 - flooredLoss2 - flooredLoss3);
  return { originalQty: flooredOriginal, period1Loss: flooredLoss1, period2Loss: flooredLoss2, period3Loss: flooredLoss3, available, periods: 3 };
}

function computeEraQuantities(row) {
  const billQty = cellRaw(row.getCell(8).value); // H
  if (billQty === null) return null;
  const loss = cellNumber(row.getCell(17).value); // Q
  const flooredOriginal = Math.floor(billQty);
  const flooredLoss = Math.max(0, Math.floor(loss));
  const available = Math.max(0, flooredOriginal - flooredLoss);
  return { originalQty: flooredOriginal, period1Loss: flooredLoss, period2Loss: 0, period3Loss: 0, available, periods: 1 };
}

function parseComedkSheet(ws) {
  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const centerRaw = row.getCell(45).value;
    if (!cellText(centerRaw)) continue;
    const q = computeComedkQuantities(row);
    rows.push({
      sourceSheet: 'Comedk',
      row: r,
      classification: cellText(row.getCell(2).value),
      vendor: cellText(row.getCell(3).value),
      invoiceNo: cellText(row.getCell(4).value),
      serialRaw: cellText(row.getCell(5).value),
      invoiceDate: cellDate(row.getCell(6).value),
      name: cellText(row.getCell(7).value) || cellText(row.getCell(8).value),
      desc: cellText(row.getCell(8).value),
      billQty: cellRaw(row.getCell(9).value),
      unitPrice: cellNumber(row.getCell(10).value),
      installationCharges: cellNumber(row.getCell(12).value),
      freightCharges: cellNumber(row.getCell(13).value),
      gstPercent: cellNumber(row.getCell(15).value) * 100,
      q,
      centerRaw: String(centerRaw).trim(),
    });
  }
  return rows;
}

function parseEraSheet(ws) {
  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const centerRaw = row.getCell(26).value;
    if (!cellText(centerRaw)) continue;
    const q = computeEraQuantities(row);
    rows.push({
      sourceSheet: 'ERA Foundation',
      row: r,
      classification: cellText(row.getCell(2).value),
      vendor: cellText(row.getCell(3).value),
      invoiceNo: cellText(row.getCell(4).value),
      serialRaw: null,
      invoiceDate: cellDate(row.getCell(5).value),
      name: cellText(row.getCell(6).value) || cellText(row.getCell(7).value),
      desc: cellText(row.getCell(7).value),
      billQty: cellRaw(row.getCell(8).value),
      unitPrice: cellNumber(row.getCell(9).value),
      installationCharges: cellNumber(row.getCell(11).value),
      freightCharges: cellNumber(row.getCell(12).value),
      gstPercent: cellNumber(row.getCell(14).value) * 100,
      q,
      centerRaw: String(centerRaw).trim(),
      programName: cellText(row.getCell(27).value),
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
    skippedNoUsableQty: 0,
    skippedExcludedClassification: 0,
    chargeOnlyRowsFolded: 0,
    unknownClassification: [],
    byCenter: {},
    invoicesCreated: 0,
    lineItemsCreated: 0,
    assetsCreated: 0,
    assetsAvailable: 0,
    assetsDamagedHistorical: 0,
    totalOriginalUnitsAcrossHistory: 0,
    newCatalogItemsCreated: 0,
    matchedExistingCatalogItems: 0,
    applied: false,
    fatalError: null,
  };
  for (const id of TARGET_CENTER_IDS) {
    report.byCenter[id] = {
      rows: 0, invoicesCreated: 0, assetsAvailable: 0, assetsDamaged: 0, newCatalogItems: 0, matchedExistingItems: 0,
    };
  }

  const catalogByCenter = new Map();
  for (const centerId of TARGET_CENTER_IDS) {
    const existing = db.prepare('SELECT id, name, tag_code FROM product_catalog WHERE center_id = ?').all(centerId);
    catalogByCenter.set(centerId, new Map(existing.map(c => [normalizeName(c.name), c])));
  }

  function getOrCreateCatalog(centerId, name, classificationId) {
    const byNorm = catalogByCenter.get(centerId);
    const norm = normalizeName(name);
    const existing = byNorm.get(norm);
    if (existing) return { id: existing.id, tagCode: existing.tag_code, isNew: false };
    const id = db.prepare(`
      INSERT INTO product_catalog (center_id, name, classification_id, unit) VALUES (?, ?, ?, 'pcs')
    `).run(centerId, name, classificationId).lastInsertRowid;
    byNorm.set(norm, { id, name, tag_code: null });
    return { id, tagCode: null, isNew: true };
  }

  const usable = [];
  for (const r of allRows) {
    const centerId = normalizeCenter(r.centerRaw);
    if (centerId === 'jp_nagar') { report.skippedJpNagar++; continue; }
    if (!centerId || !TARGET_CENTER_IDS.has(centerId)) {
      report.skippedUnrecognizedCenter.push({ row: r.row, sheet: r.sourceSheet, centerRaw: r.centerRaw });
      continue;
    }
    if (!r.name) { report.skippedNoUsableQty++; continue; }

    const classificationKey = normalizeName(r.classification);
    const mappedClassName = CLASSIFICATION_MAP[classificationKey];
    if (mappedClassName === undefined) {
      report.unknownClassification.push({ row: r.row, sheet: r.sourceSheet, name: r.name, classification: r.classification });
      continue;
    }
    if (mappedClassName === null) { report.skippedExcludedClassification++; continue; }
    const classificationId = classIdByName.get(mappedClassName);

    const q = r.q;
    const extraCharges = (r.installationCharges || 0) + (r.freightCharges || 0);
    if (!q || q.originalQty <= 0) {
      // No real quantity, but a real installation/freight charge was still
      // recorded on this row (e.g. a standalone "Transportation charges"
      // or "Mesh Bins" packing-charge line) -- keep it as a charge-only
      // entry that contributes to its invoice group's totals but never
      // becomes its own catalog item/line item/asset (there's no unit to
      // attach a per-item value to). Previously dropped silently.
      if (extraCharges > 0) {
        report.byCenter[centerId].rows++;
        usable.push({ ...r, centerId, classificationId, classificationKey, isChargeOnly: true, originalQty: 0, period1Loss: 0, period2Loss: 0, period3Loss: 0, available: 0 });
      } else {
        report.skippedNoUsableQty++;
      }
      continue;
    }

    report.byCenter[centerId].rows++;
    usable.push({ ...r, centerId, classificationId, classificationKey, isChargeOnly: false, ...q });
  }

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
    const insertAsset = db.prepare(`
      INSERT INTO assets
        (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name, description,
         unit, unit_value, serial_number, status, is_legacy, active, added_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pcs', ?, ?, ?, 1, 1, ?)
    `);
    const insertEvent = db.prepare(`
      INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let anonSeq = 0;
    for (const items of groups.values()) {
      const first = items[0];
      const center = centerById.get(first.centerId);
      const isEra = first.sourceSheet === 'ERA Foundation';
      const createdBy = isEra ? 'system:all_centers_inventory_import_era' : 'system:all_centers_inventory_import';
      const businessHeadId = isEra ? ERA_BUSINESS_HEAD_ID : COMEDK_BUSINESS_HEAD_ID;
      const vendorId = getOrCreateByName(db, 'vendors', first.vendor || `Unknown Vendor (${first.sourceSheet} import)`);
      const sourceTag = isEra ? 'ERA' : 'AUDIT';
      const baseInvoiceNumber = first.invoiceNo || `${sourceTag}-${++anonSeq}`;
      let invoiceNumber = baseInvoiceNumber;
      let suffix = 0;
      while (db.prepare('SELECT id FROM invoices WHERE center_id = ? AND invoice_number = ?').get(center.id, invoiceNumber)) {
        suffix += 1;
        invoiceNumber = `${baseInvoiceNumber}-${sourceTag}${suffix}`;
      }

      let taxableTotal = 0;
      let gstTotal = 0;
      // Taxable value = qty*price + installation + freight, matching the
      // sheet's own formula chain exactly (its "Taxable value" column adds
      // both charges on top of the qty*price subtotal before GST). Each
      // unit's stored value gets a fair per-unit share of the installation
      // +freight lump sum added on top of its own price, so SUM(unit_value)
      // across a line item's units reconciles exactly with that line's
      // taxable_value -- previously these two charges were silently
      // dropped entirely, understating both invoice totals and asset value.
      const computed = items.map(li => {
        const qtyForInvoice = li.originalQty;
        const unitPriceForInvoice = li.unitPrice;
        const extraCharges = (li.installationCharges || 0) + (li.freightCharges || 0);
        const taxable = qtyForInvoice * (unitPriceForInvoice || 0) + extraCharges;
        const gst = taxable * ((li.gstPercent || 0) / 100);
        const perUnitValue = unitPriceForInvoice + (qtyForInvoice > 0 ? extraCharges / qtyForInvoice : 0);
        taxableTotal += taxable;
        gstTotal += gst;
        return { ...li, qtyForInvoice, unitPriceForInvoice, perUnitValue, taxable, gst };
      });
      const totalBillValue = taxableTotal + gstTotal;

      const invoiceId = db.prepare(`
        INSERT INTO invoices
          (center_id, invoice_number, invoice_date, vendor_id, business_head_id, taxable_value, gst_value, total_bill_value, is_legacy, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(center.id, invoiceNumber, first.invoiceDate || null, vendorId, businessHeadId, taxableTotal, gstTotal, totalBillValue, createdBy).lastInsertRowid;
      report.invoicesCreated += 1;
      report.byCenter[center.id].invoicesCreated += 1;

      for (const li of computed) {
        if (li.isChargeOnly) {
          // Already folded into this invoice's taxable/gst totals above --
          // no catalog item, line item, or asset for a shipping/packing
          // charge that isn't a real lendable unit.
          report.chargeOnlyRowsFolded = (report.chargeOnlyRowsFolded || 0) + 1;
          continue;
        }
        const purposeNote = li.programName
          ? `${first.sourceSheet} import -- Program: ${li.programName}`
          : `${first.sourceSheet} import (all-centers full-history backfill)`;
        const lineItemId = db.prepare(`
          INSERT INTO invoice_line_items
            (invoice_id, classification_id, asset_name, bill_quantity, unit, unit_price, taxable_value, gst_percent, gst_value, total_value, purchased_for)
          VALUES (?, ?, ?, ?, 'pcs', ?, ?, ?, ?, ?, ?)
        `).run(invoiceId, li.classificationId, li.name, li.qtyForInvoice, li.unitPriceForInvoice, li.taxable, li.gstPercent, li.gst,
               li.taxable + li.gst, purposeNote).lastInsertRowid;
        report.lineItemsCreated += 1;

        const catalog = getOrCreateCatalog(li.centerId, li.name, li.classificationId);
        if (catalog.isNew) { report.newCatalogItemsCreated++; report.byCenter[center.id].newCatalogItems++; }
        else { report.matchedExistingCatalogItems++; report.byCenter[center.id].matchedExistingItems++; }

        const classification = classById.get(li.classificationId);
        const isConsumable = CONSUMABLE_CLASSIFICATIONS.has(li.classificationKey);
        const procuredAt = li.invoiceDate ? `${li.invoiceDate.slice(0, 10)}T00:00:00.000Z` : new Date().toISOString();
        const serials = li.serialRaw ? li.serialRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        let serialCursor = 0;
        function nextSerial() { return serialCursor < serials.length ? serials[serialCursor++] : null; }

        function createUnit(status, lossPeriodIndex) {
          const assetId = crypto.randomUUID();
          const assetTag = nextAssetTag(center.code, center.id, li.classificationId, classification.name, catalog.id, catalog.tagCode);
          insertAsset.run(assetId, assetTag, center.id, catalog.id, lineItemId, li.classificationId, li.name,
                          li.desc || null, li.perUnitValue, nextSerial(), status, procuredAt);
          insertEvent.run(assetId, 'procured', null, 'available', center.id,
                           `Backfilled from ${first.sourceSheet} all-centers inventory import (original procurement)`, createdBy, procuredAt);
          report.assetsCreated += 1;
          if (lossPeriodIndex === null) {
            report.assetsAvailable += 1;
            report.byCenter[center.id].assetsAvailable += 1;
            return;
          }
          const period = isEra ? ERA_SINGLE_PERIOD : PERIOD_LABELS[lossPeriodIndex];
          const reason = isConsumable
            ? `Consumed/used in normal project or workshop activity ${period.desc}`
            : `Marked unavailable during stock audit reconciliation, ${period.desc} (exact reason not recorded in source data)`;
          const ts = `${period.date}T00:00:00.000Z`;
          insertEvent.run(assetId, 'damaged', 'available', 'damaged', center.id, `${reason}. Exact date within this window is not known.`, createdBy, ts);
          report.assetsDamagedHistorical += 1;
          report.byCenter[center.id].assetsDamaged += 1;
        }

        for (let i = 0; i < li.available; i += 1) createUnit('available', null);
        for (let i = 0; i < li.period1Loss; i += 1) createUnit('damaged', 0);
        for (let i = 0; i < li.period2Loss; i += 1) createUnit('damaged', 1);
        for (let i = 0; i < li.period3Loss; i += 1) createUnit('damaged', 2);

        report.totalOriginalUnitsAcrossHistory += li.originalQty;
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

module.exports = { run, parseWorkbook, normalizeName, normalizeCenter, CLASSIFICATION_MAP, CENTER_NAME_MAP, computeComedkQuantities, computeEraQuantities };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const [dbPath] = args.filter(a => a !== '--apply');
    if (!dbPath) {
      console.error('Usage: node rebuild-8-centers-full-history.js <db-path> [--apply]');
      process.exit(1);
    }
    const rows = await parseWorkbook();
    const report = run(dbPath, rows, { apply });
    console.log(JSON.stringify(report, null, 2));
  })();
}
