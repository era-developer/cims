// Targeted pricing correction for JP Nagar: rebuild-jp-nagar-full-history.js
// (like the original 8-center import script) silently dropped Installation
// charges and Freight charges columns entirely -- the sheet's own "Taxable
// value" formula is qty*price + installation + freight, but only qty*price
// ever made it into invoice_line_items.taxable_value / assets.unit_value.
//
// Scope: only 32 of JP Nagar's 908 usable sheet rows have a non-zero
// installation or freight charge (verified directly against the source
// workbook). This is a targeted patch, NOT a full rebuild -- JP Nagar's
// ~66,000 assets are already live and their tags may already be printed on
// physical labels, so regenerating them from scratch (as the 8-center
// rebuild safely does, since those tags are brand new) is not appropriate
// here. Only the value fields change; no asset_tag is touched.
//
// Of the 32 affected rows:
//  - 25 are real components (Bill Qty > 0, matched 1:1 against their
//    existing invoice_line_item by vendor+invoice+name+quantity) -- these
//    get their own taxable/gst/total_value corrected, and their linked
//    assets' unit_value gets a fair per-unit share of the install+freight
//    added on top of the existing per-unit price.
//  - 6 are pure shipping/packing/transportation CHARGE lines (Bill Qty=0
//    or the row was never created as its own catalog item/asset at all --
//    "Transportation Charge" has Bill Qty=1 but price=0, and never became
//    a line item in the original rebuild either) -- these have no unit to
//    attach a per-unit value to, so their charge is added directly to
//    their invoice's taxable_value/gst_value/total_bill_value instead.
//  - 1 is classified "Interior Furnishing" ("One Time Transportation
//    Charges At Customers Site") -- skipped entirely, consistent with that
//    whole classification being removed from JP Nagar already.
//
// Usage: node fix-jp-nagar-install-freight.js <db-path> [--apply]

const ExcelJS = require('exceljs');
const { openDatabase } = require('../utils/db');

const WORKBOOK_PATH = 'D:/cims/JP_Nagar_Center_new_listJuly2026.xlsx';

function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  return 0;
}
function text(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s || null;
}

async function loadAffectedRows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK_PATH);
  const ws = wb.worksheets[0];
  const rows = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const install = num(row.getCell(13).value);
    const freight = num(row.getCell(14).value);
    if (!install && !freight) continue;
    const classification = text(row.getCell(2).value) || '';
    rows.push({
      row: r,
      name: text(row.getCell(8).value) || text(row.getCell(9).value),
      vendor: text(row.getCell(3).value),
      invoiceNo: text(row.getCell(4).value),
      billQty: num(row.getCell(10).value),
      install, freight,
      gstFraction: num(row.getCell(16).value),
      isInteriorFurnishing: classification.toLowerCase().trim() === 'interior furnishing',
    });
  }
  return rows;
}

function run(dbPath, affectedRows, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = {
    totalAffectedRows: affectedRows.length,
    skippedInteriorFurnishing: 0,
    realComponentRowsMatched: 0,
    realComponentRowsUnmatched: [],
    chargeOnlyRowsMatched: 0,
    chargeOnlyRowsUnmatched: [],
    totalTaxableAdded: 0,
    totalGstAdded: 0,
    assetsUpdated: 0,
    lineItemsUpdated: 0,
    invoicesUpdated: 0,
    applied: false,
    fatalError: null,
  };

  function attributeToInvoice(r, extra, gstOnExtra) {
    const invoices = db.prepare(`
      SELECT DISTINCT i.id, i.taxable_value, i.gst_value, i.total_bill_value
      FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.center_id = 'jp_nagar' AND v.name = ? AND i.invoice_number LIKE ?
    `).all(r.vendor, `${r.invoiceNo}%`);
    if (invoices.length !== 1) {
      report.chargeOnlyRowsUnmatched.push({ row: r.row, name: r.name, vendor: r.vendor, invoiceNo: r.invoiceNo, candidateCount: invoices.length });
      return;
    }
    const inv = invoices[0];
    const newTaxable = inv.taxable_value + extra;
    const newGst = inv.gst_value + gstOnExtra;
    db.prepare('UPDATE invoices SET taxable_value = ?, gst_value = ?, total_bill_value = ? WHERE id = ?')
      .run(newTaxable, newGst, newTaxable + newGst, inv.id);
    report.invoicesUpdated++;
    report.chargeOnlyRowsMatched++;
    report.totalTaxableAdded += extra;
    report.totalGstAdded += gstOnExtra;
  }

  db.exec('BEGIN TRANSACTION');
  try {
    for (const r of affectedRows) {
      if (r.isInteriorFurnishing) { report.skippedInteriorFurnishing++; continue; }
      const extra = r.install + r.freight;
      const gstOnExtra = extra * r.gstFraction;

      if (r.billQty > 0) {
        // Real component: exact single match on vendor + invoice-number
        // prefix + asset name + bill quantity.
        const candidates = db.prepare(`
          SELECT li.id AS lineItemId, li.taxable_value, li.gst_value, li.total_value, li.bill_quantity, li.gst_percent,
                 i.id AS invoiceId, i.taxable_value AS invTaxable, i.gst_value AS invGst, i.total_bill_value AS invTotal
          FROM invoice_line_items li
          JOIN invoices i ON i.id = li.invoice_id
          JOIN vendors v ON v.id = i.vendor_id
          WHERE i.center_id = 'jp_nagar' AND v.name = ? AND i.invoice_number LIKE ?
            AND li.asset_name = ? AND li.bill_quantity = ?
        `).all(r.vendor, `${r.invoiceNo}%`, r.name, r.billQty);
        if (candidates.length === 0) {
          // Row never became its own line item at all (e.g. a nominally
          // "qty 1" charge line with zero price, like "Transportation
          // Charge") -- fall through to invoice-level attribution, same as
          // a true charge-only row.
          attributeToInvoice(r, extra, gstOnExtra);
          continue;
        }
        if (candidates.length !== 1) {
          report.realComponentRowsUnmatched.push({ row: r.row, name: r.name, vendor: r.vendor, invoiceNo: r.invoiceNo, candidateCount: candidates.length });
          continue;
        }
        const li = candidates[0];
        const newTaxable = li.taxable_value + extra;
        const newGst = li.gst_value + gstOnExtra;
        db.prepare('UPDATE invoice_line_items SET taxable_value = ?, gst_value = ?, total_value = ? WHERE id = ?')
          .run(newTaxable, newGst, newTaxable + newGst, li.lineItemId);
        report.lineItemsUpdated++;

        // The line item's own increase must also be reflected in its
        // parent invoice's totals -- invoices.taxable_value/gst_value/
        // total_bill_value are stored (not derived at read time), so
        // fixing only the line item would leave the invoice's own totals
        // silently understated relative to the sum of its own line items.
        const newInvTaxable = li.invTaxable + extra;
        const newInvGst = li.invGst + gstOnExtra;
        db.prepare('UPDATE invoices SET taxable_value = ?, gst_value = ?, total_bill_value = ? WHERE id = ?')
          .run(newInvTaxable, newInvGst, newInvTaxable + newInvGst, li.invoiceId);
        report.invoicesUpdated++;

        const perUnitExtra = extra / li.bill_quantity;
        const assets = db.prepare('SELECT id, unit_value FROM assets WHERE invoice_line_item_id = ?').all(li.lineItemId);
        const updateAsset = db.prepare('UPDATE assets SET unit_value = ? WHERE id = ?');
        for (const asset of assets) {
          updateAsset.run((asset.unit_value || 0) + perUnitExtra, asset.id);
          report.assetsUpdated++;
        }
        report.realComponentRowsMatched++;
        report.totalTaxableAdded += extra;
        report.totalGstAdded += gstOnExtra;
      } else {
        // Pure shipping/packing/transportation charge row -- no unit to
        // attach value to. Add straight to the invoice's own totals.
        attributeToInvoice(r, extra, gstOnExtra);
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

module.exports = { run, loadAffectedRows };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const [dbPath] = args.filter(a => a !== '--apply');
    if (!dbPath) {
      console.error('Usage: node fix-jp-nagar-install-freight.js <db-path> [--apply]');
      process.exit(1);
    }
    const rows = await loadAffectedRows();
    const report = run(dbPath, rows, { apply });
    console.log(JSON.stringify(report, null, 2));
  })();
}
